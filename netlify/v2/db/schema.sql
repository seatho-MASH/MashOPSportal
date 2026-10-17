-- Mash Ops (v2) — Neon Postgres schema.
-- Idempotent: safe to run on every deploy (`npm run migrate`). Never drops anything.
-- Times are timestamptz (UTC); the UI shows Europe/London.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- events
-- One row per calendar event, keyed by the calendar's own id. Filled by the
-- calendar sync (netlify/functions/sync-calendar.mjs); Ops-only settings live
-- in the `ops_*` columns, which the sync never touches.
create table if not exists event (
  id            text primary key,              -- calendar id, e.g. 'eps-event-production-show'
  series_id     text,
  edition       text,
  portfolio     text,
  name          text not null,
  short_name    text,
  starts_on     date,
  ends_on       date,
  venue         text,
  cancelled     boolean not null default false,
  provisional   boolean not null default false,
  kind          text not null default 'other',   -- show | summit | awards | lunch | other (Ops sets it)
  ops_enabled   boolean not null default false,  -- shown in Ops
  ops_ji        text,                            -- HubSpot Joining Instructions value (summits)
  ops_notes     text,
  synced_at     timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists event_starts_idx on event (starts_on);

-- Old Mash Ops ids (cn-mc-ice …) that differ from the calendar's.
create table if not exists event_alias (
  legacy_id text primary key,
  event_id  text not null references event(id) on delete cascade
);

-- ---------------------------------------------------------------- people
create table if not exists person (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  first_name         text not null default '',
  last_name          text not null default '',
  phone              text,
  organisation       text,
  job_title          text,
  hubspot_contact_id text,
  is_mash_staff      boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists person_email_uq on person (lower(email)) where email is not null and email <> '';

-- Restricted: dietary / access. Only planners and admins read this.
create table if not exists person_needs (
  person_id uuid not null references person(id) on delete cascade,
  event_id  text not null references event(id) on delete cascade,
  dietary   text,
  access    text,
  primary key (person_id, event_id)
);

-- ---------------------------------------------------------------- crew & theatres (shows)
create table if not exists crew_role (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  sort  int not null default 0
);

create table if not exists crew_member (           -- a person working an event
  event_id  text not null references event(id) on delete cascade,
  person_id uuid not null references person(id) on delete cascade,
  kind      text not null default 'volunteer',     -- staff | volunteer
  default_role_id uuid references crew_role(id) on delete set null,
  notes     text,
  primary key (event_id, person_id)
);

create table if not exists theatre (
  id        uuid primary key default gen_random_uuid(),
  event_id  text not null references event(id) on delete cascade,
  name      text not null,
  ninja_location text,                              -- Lineup Ninja location this theatre maps to
  sort      int not null default 0,
  unique (event_id, name)
);

create table if not exists session (
  id         uuid primary key default gen_random_uuid(),
  event_id   text not null references event(id) on delete cascade,
  theatre_id uuid references theatre(id) on delete set null,
  ninja_id   text,                                  -- stable Lineup Ninja session id, once connected
  title      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  source     text not null default 'manual',        -- manual | csv | ninja
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create unique index if not exists session_ninja_uq on session (event_id, ninja_id) where ninja_id is not null;

-- "Theatre X needs N of role R between from and to." theatre_id null = every theatre.
create table if not exists coverage_rule (
  id         uuid primary key default gen_random_uuid(),
  event_id   text not null references event(id) on delete cascade,
  theatre_id uuid references theatre(id) on delete cascade,
  role_id    uuid not null references crew_role(id) on delete cascade,
  min_count  int not null default 1 check (min_count >= 0),
  from_at    timestamptz not null,
  to_at      timestamptz not null,
  check (to_at > from_at)
);

create table if not exists break_rule (
  event_id         text primary key references event(id) on delete cascade,
  window_from      time not null default '12:00',
  window_to        time not null default '14:00',
  break_minutes    int  not null default 30,
  max_continuous   int  not null default 240     -- minutes on shift before a break is due
);

create table if not exists assignment (
  id         uuid primary key default gen_random_uuid(),
  event_id   text not null references event(id) on delete cascade,
  person_id  uuid not null references person(id) on delete cascade,
  theatre_id uuid references theatre(id) on delete cascade,
  role_id    uuid references crew_role(id) on delete set null,
  kind       text not null default 'work',      -- work | break
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  source     text not null default 'manual',    -- manual | engine
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists assignment_event_idx on assignment (event_id, starts_at);

-- What each person was last sent, so a later change shows who needs re-notifying.
create table if not exists schedule_send (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null references event(id) on delete cascade,
  person_id   uuid not null references person(id) on delete cascade,
  fingerprint text not null,
  sent_at     timestamptz not null default now(),
  outbox_id   uuid
);
create index if not exists schedule_send_idx on schedule_send (event_id, person_id, sent_at desc);

-- Grip app accounts Mash creates per volunteer. Password encrypted with OPS_SECRET_KEY.
create table if not exists credential (
  event_id   text not null references event(id) on delete cascade,
  person_id  uuid not null references person(id) on delete cascade,
  system     text not null default 'Grip',
  username   text not null,
  secret_enc text,
  updated_at timestamptz not null default now(),
  primary key (event_id, person_id, system)
);
create table if not exists credential_view (
  at        timestamptz not null default now(),
  viewer    text not null,
  event_id  text not null,
  person_id uuid not null,
  system    text not null
);

-- ---------------------------------------------------------------- on the day
-- Append-only. client_id makes an offline retry from a tablet safe.
create table if not exists checkin (
  id        uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  event_id  text not null references event(id) on delete cascade,
  person_id uuid not null references person(id) on delete cascade,
  day       date not null,
  present   boolean not null,                   -- false = an un-tick
  at        timestamptz not null,
  by_user   text not null
);
create index if not exists checkin_idx on checkin (event_id, day, person_id, at desc);

create table if not exists kit_item (
  id        uuid primary key default gen_random_uuid(),
  sticker   text not null unique,               -- the number on the sticker on the back
  kind      text not null,                      -- phone | charger | scanner | other
  label     text,
  retired   boolean not null default false
);
create table if not exists kit_loan (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references kit_item(id) on delete cascade,
  event_id    text not null references event(id) on delete cascade,
  person_id   uuid not null references person(id) on delete cascade,
  issued_at   timestamptz not null default now(),
  issued_by   text not null,
  returned_at timestamptz,
  returned_by text,
  note        text
);
create unique index if not exists kit_one_open_loan on kit_loan (item_id) where returned_at is null;

-- ---------------------------------------------------------------- tables (summits, awards, lunches)
create table if not exists guest (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null references event(id) on delete cascade,
  person_id    uuid references person(id) on delete set null,
  name         text not null default '',
  organisation text,
  booking_ref  text,                              -- Ledger booking / line id for awards
  dietary      text,
  access       text,
  source       text not null default 'manual',    -- manual | csv | ledger | hubspot
  created_at   timestamptz not null default now()
);
create index if not exists guest_event_idx on guest (event_id);

create table if not exists dining_table (
  id        uuid primary key default gen_random_uuid(),
  event_id  text not null references event(id) on delete cascade,
  number    int not null,
  label     text,
  seats     int not null default 10 check (seats > 0),
  unique (event_id, number)
);
create table if not exists seating (
  guest_id uuid primary key references guest(id) on delete cascade,
  table_id uuid not null references dining_table(id) on delete cascade
);

-- ---------------------------------------------------------------- 100 leaderboards
create table if not exists programme (
  id    text primary key,                         -- cn-agency100 | cn-corporate100 | en100 | aaa100
  name  text not null,
  sort  int not null default 0
);
create table if not exists points_rule (
  id           uuid primary key default gen_random_uuid(),
  programme_id text not null references programme(id) on delete cascade,
  season       text not null,                     -- '2026-27'
  activity     text not null,
  points       int not null,
  unique (programme_id, season, activity)
);
create table if not exists programme_member (
  programme_id text not null references programme(id) on delete cascade,
  season       text not null,
  person_id    uuid not null references person(id) on delete cascade,
  primary key (programme_id, season, person_id)
);
create table if not exists points_entry (
  id           uuid primary key default gen_random_uuid(),
  programme_id text not null references programme(id) on delete cascade,
  season       text not null,
  person_id    uuid not null references person(id) on delete cascade,
  activity     text not null,
  points       int not null,
  on_date      date not null default current_date,
  event_id     text references event(id) on delete set null,
  note         text,
  awarded_by   text not null,
  source       text not null default 'manual',    -- manual | import | checkin
  created_at   timestamptz not null default now()
);
create index if not exists points_idx on points_entry (programme_id, season, person_id);

-- ---------------------------------------------------------------- sponsors (from the Ledger)
create table if not exists sponsor (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null references event(id) on delete cascade,
  company      text not null,
  tier         text,
  ledger_ref   text,                              -- the Ledger's company/booking key; null = manual
  contact_name text,
  contact_email text,
  removed_at   timestamptz,
  synced_at    timestamptz,
  unique (event_id, ledger_ref)
);

-- ---------------------------------------------------------------- platform
create table if not exists outbox (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                      -- schedule | invite | guest-link | reminder
  event_id    text references event(id) on delete cascade,
  person_id   uuid references person(id) on delete cascade,
  to_email    text not null,
  subject     text not null,
  html        text not null,
  fingerprint text,
  status      text not null default 'queued',     -- queued | sending | sent | failed
  attempts    int not null default 0,
  last_error  text,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists outbox_status_idx on outbox (status, created_at);

create table if not exists sync_run (
  id        uuid primary key default gen_random_uuid(),
  source    text not null,                        -- calendar | ledger | ninja
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok        boolean,
  counts    jsonb,
  error     text
);

create table if not exists audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     text not null,                        -- verified email
  event_id  text,
  area      text not null,
  action    text not null,                        -- added | changed | removed | sent | checked-in …
  item      text not null,
  detail    jsonb
);
create index if not exists audit_event_idx on audit_log (event_id, at desc);

-- ---------------------------------------------------------------- seed reference data
insert into crew_role (name, sort) values
  ('Stage manager', 1), ('Tech', 2), ('Mic runner', 3), ('Steward', 4), ('Host', 5), ('Scanner', 6)
on conflict (name) do nothing;

insert into programme (id, name, sort) values
  ('cn-agency100', 'CN Agency100', 1), ('cn-corporate100', 'CN Corporate100', 2),
  ('en100', 'EN100', 3), ('aaa100', 'AAA100', 4)
on conflict (id) do nothing;

-- Old Ops ids whose calendar id differs (aliases only resolve once the event exists).
create or replace function ops_seed_aliases() returns void language sql as $$
  insert into event_alias (legacy_id, event_id)
  select a.legacy_id, a.event_id from (values
    ('cn-mc-ice','cn-mc-internal-comms-events'), ('cn-mc-bea','cn-mc-brand-events-activations'),
    ('cn-mc-pe','cn-mc-public-events'), ('en-lc-consumer','en-lc-cs'), ('en-lc-trade','en-lc-ts'),
    ('en-lc-conferences','en-lc-conf'), ('aaa-eps','aaa-event-producers-summit'),
    ('pas-dc-financial','pas-dc-financial-professional-services')
  ) as a(legacy_id, event_id)
  where exists (select 1 from event e where e.id = a.event_id)
  on conflict (legacy_id) do nothing;
$$;

-- ---------------------------------------------------------------- scan check (shows)
-- Which HubSpot registration code a show uses (CFX / EPS / PAS). Admin can override.
alter table event add column if not exists ops_reg_code text;

-- One upload (or HubSpot pull) per source per show; the latest one is what's compared.
create table if not exists scan_upload (
  id         uuid primary key default gen_random_uuid(),
  event_id   text not null references event(id) on delete cascade,
  source     text not null check (source in ('hubspot','reftech','grip')),
  rows       int not null default 0,
  filename   text,
  by_user    text not null,
  at         timestamptz not null default now()
);
create index if not exists scan_upload_idx on scan_upload (event_id, source, at desc);
create table if not exists scan_row (
  upload_id  uuid not null references scan_upload(id) on delete cascade,
  email      text,                 -- lower-cased, trimmed
  first_name text, last_name text, company text,
  scan_id    text,
  badge_raw  text,                 -- as the source wrote it
  ext_id     text                  -- HubSpot record id etc.
);
create index if not exists scan_row_idx on scan_row (upload_id);
-- Badge names differ between systems ("Confex - Visitor" vs "VISITOR"): map each to one type.
create table if not exists badge_map (
  event_id  text not null references event(id) on delete cascade,
  source    text not null,
  raw       text not null,
  canonical text not null,
  primary key (event_id, source, raw)
);
-- Exceptions someone has looked at and accepted, so they stop showing.
create table if not exists scan_ack (
  event_id text not null references event(id) on delete cascade,
  kind     text not null,
  key      text not null,
  note     text,
  by_user  text not null,
  at       timestamptz not null default now(),
  primary key (event_id, kind, key)
);

-- Scan check: which source is right when they disagree, and upload templates for fix files.
alter table event add column if not exists ops_scan_settings jsonb not null default '{}'::jsonb;
create table if not exists scan_template (
  source   text primary key check (source in ('reftech','grip')),
  columns  jsonb not null,           -- [{ header, field }] field = email|first_name|last_name|company|scan_id|badge|badge_type|ext_id|=literal
  filename text,
  by_user  text not null,
  at       timestamptz not null default now()
);

-- Grip templates come with instruction rows above the header, differ per show (custom
-- profile fields), and Grip imports one data type (badge type) per file.
alter table scan_row add column if not exists job_title text;
alter table scan_template add column if not exists event_id text not null default '';
alter table scan_template add column if not exists preamble jsonb not null default '[]'::jsonb;
alter table scan_template add column if not exists split_by_badge boolean not null default false;
do $$ begin
  if exists (select 1 from pg_constraint where conname='scan_template_pkey' and array_length(conkey,1)=1) then
    alter table scan_template drop constraint scan_template_pkey;
    alter table scan_template add primary key (source, event_id);
  end if;
end $$;
