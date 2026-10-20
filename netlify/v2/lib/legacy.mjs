// Import from the current portal (Netlify Blobs store "mash-attendee-portal") into v2.
//
// Re-runnable. Until cut-over the current portal is the master: every run writes
// the old values over the imported rows (matched by their old ids), marks rows the
// old portal deleted as removed, and leaves anything that only exists in v2 alone.
//
//   portal-state-v1  → sponsor, attendee (reps, speakers, walk-ins, staff), delegate_note,
//                      delegate_seen, event_onsite, room_need
//   community-v1     → community_event, community_package, community_assign, sponsor.meetings_delivered
//   event-config-v1  → event.ops_ji (with the bundled defaults below), ops_enabled
//   audit-v1/<id>    → audit_log (legacy = true, original times)
import { q, one, tx } from './db.mjs';
import { audit } from './audit.mjs';
import { requireAdmin } from './auth.mjs';

const STORE = 'mash-attendee-portal';
// The JI values the old portal had built in (_shows.mjs), keyed by its event ids.
export const BUNDLED_JI = {
  'cn-mc-ice': 'CN - MC - 26 - ICE', 'cn-cls': 'CN CLS 26', 'cn-mc-incentives': 'CN - MC - 26 - Incentives', 'cn-als': 'CN ALS 26',
  'cn-mc-bea': 'CN - MC - 26 - BE&A', 'cn-cels': 'CN - CELS - 26', 'cn-mc-pe': 'CN - MC - 26 - PE',
  'en-lc-consumer': 'EN - LC CS - 26', 'en-lc-trade': 'EN - LC TS - 26', 'en-ols': 'EN - OLS - 26', 'en-lc-conferences': 'EN - LC Conferences - 26',
  'en-indy-expo': 'EN - Indy Summit - 26', 'en-mls': 'EN - MLS - 27', 'en-sls': 'EN - SLS - 27', 'en-lc-awards': 'EN - LC Awards - 27',
  'aaa-ls': 'AAA - LS - 26', 'aaa-eps': 'AAA - Event Producers Summit - 27',
  'pas-dc-legal': 'PAS - DC Legal - 26', 'pas-dc-financial': 'PAS - DC Financial - 26', 'pas-dc-medical': 'PAS - DC Medical - 26', 'pas-dc-hnwi': 'PAS - DC HNWI - 27',
  'cfx-gets': 'CFX GETS 26',
};
// Badge prefixes the old portal used for generated IDs, so numbering carries on.
export const BADGE_PREFIX = { 'cn-mc-ice': 'ICE', 'cn-cls': 'CLS', 'cn-mc-incentives': 'INC', 'cn-als': 'ALS', 'cn-mc-bea': 'BEA', 'cn-cels': 'CELS', 'cn-mc-pe': 'PE',
  'en-lc-consumer': 'LCCS', 'en-lc-trade': 'LCTS', 'en-ols': 'OLS', 'en-lc-conferences': 'LCCONF', 'en-mls': 'MLS', 'en-sls': 'SLS', 'en-lc-awards': 'LCAW',
  'aaa-ls': 'LS', 'aaa-eps': 'EPS', 'pas-dc-legal': 'DCLEG', 'pas-dc-financial': 'DCFIN', 'pas-dc-medical': 'DCMED', 'pas-dc-hnwi': 'DCHNWI', 'cfx-gets': 'GETS' };

const s = (v, n = 500) => (v == null ? null : (String(v).trim().slice(0, n) || null));
const ts = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toISOString() : null; };
const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);
const nrm = (v) => String(v == null ? '' : v).trim().toLowerCase();
export function personKey(r) {
  const e = nrm(r.email); if (e) return 'e:' + e;
  const sc = r.scanId || r.scan_id || r.hubspotId || ''; if (sc) return 's:' + sc;
  return 'r:' + (r.id || r.legacy_id || '');
}

async function openStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore(STORE);
}

// Old event id → v2 event id (via the calendar id or an alias), or null.
async function eventMap(ids) {
  const rows = await q(`select x.id as old, coalesce(e.id, a.event_id) as id
                        from unnest($1::text[]) as x(id)
                        left join event e on e.id = x.id
                        left join event_alias a on a.legacy_id = x.id`, [ids]);
  return Object.fromEntries(rows.filter(r => r.id).map(r => [r.old, r.id]));
}

export async function importLegacy(user, opts = {}) {
  requireAdmin(user);
  const store = opts.store || await openStore();
  const [state, community, cfg] = await Promise.all([
    store.get('portal-state-v1', { type: 'json' }).then(x => x || {}),
    store.get('community-v1', { type: 'json' }).then(x => x || {}),
    store.get('event-config-v1', { type: 'json' }).then(x => x || {}),
  ]);
  const lists = ['sponsors', 'speakers', 'delegates', 'staff', 'notes', 'seen', 'onsite', 'rooms'];
  const ji = { ...(opts.bundled === false ? {} : BUNDLED_JI), ...(cfg.ji || {}) };   // tests pass bundled:false
  const oldIds = [...new Set([
    ...Object.keys(ji),
    ...lists.flatMap(k => Object.keys(state[k] || {})),
    ...Object.keys(community.events || {}),
  ])].filter(Boolean);
  const map = await eventMap(oldIds);
  const report = { events: 0, skipped: [], sponsors: 0, reps: 0, speakers: 0, walkins: 0, staff: 0, notes: 0, rooms: 0, community: 0, history: 0 };

  for (const old of oldIds) {
    const ev = map[old];
    const has = lists.some(k => state[k] && state[k][old] && (Array.isArray(state[k][old]) ? state[k][old].length : Object.keys(state[k][old]).length))
      || (community.events || {})[old];
    if (!ev) { if (has || ji[old]) report.skipped.push(old); continue; }
    const st = [];
    // Event settings: JI value switches the event on (kind stays as set, except a mis-guessed "show").
    if (ji[old]) {
      st.push([`update event set ops_ji=$2, ops_enabled=true,
                 kind = case when kind='show' and id !~ '^(eps-event-production-show|cfx-international-confex|pas-the-pa-show)' then 'summit' else kind end
               where id=$1`, [ev, s(ji[old], 200)]]);
    }
    // Sponsors and their reps
    for (const sp of (state.sponsors || {})[old] || []) {
      if (!sp || !sp.id) continue;
      st.push([`insert into sponsor (event_id, legacy_id, company, tier, added_at, removed_at) values ($1,$2,$3,$4,coalesce($5::timestamptz, now()),$6)
                on conflict (event_id, legacy_id) where legacy_id is not null do update set company=excluded.company, tier=excluded.tier, removed_at=excluded.removed_at`,
        [ev, String(sp.id), s(sp.company, 200) || '(no name)', s(sp.tier, 60), ts(sp.addedAt), sp.deleted ? new Date().toISOString() : null]]);
      report.sponsors++;
      for (const c of sp.contacts || []) {
        if (!c || !c.id) continue;
        st.push(attendeeUpsert(ev, 'sponsor', c, `(select id from sponsor where event_id=$1 and legacy_id='${String(sp.id).replace(/'/g, "''")}')`, sp.deleted || c.deleted));
        report.reps++;
      }
    }
    for (const x of (state.speakers || {})[old] || []) if (x && x.id) { st.push(attendeeUpsert(ev, 'speaker', x, null, x.deleted)); report.speakers++; }
    for (const x of (state.delegates || {})[old] || []) if (x && x.id) { st.push(attendeeUpsert(ev, 'delegate', x, null, x.deleted)); report.walkins++; }
    for (const x of (state.staff || {})[old] || []) if (x && x.id) { st.push(attendeeUpsert(ev, 'staff', x, null, x.deleted)); report.staff++; }
    // Notes: on a walk-in they're the walk-in's note; otherwise they belong to a live HubSpot delegate.
    const walkIds = new Set(((state.delegates || {})[old] || []).map(d => d && d.id));
    for (const [rec, note] of Object.entries((state.notes || {})[old] || {})) {
      if (!rec) continue;
      if (walkIds.has(rec)) st.push(['update attendee set note=$3 where event_id=$1 and legacy_id=$2', [ev, rec, s(note, 2000)]]);
      else if (s(note)) st.push(['insert into delegate_note (event_id, contact_id, note) values ($1,$2,$3) on conflict (event_id, contact_id) do update set note=excluded.note', [ev, rec, s(note, 2000)]]);
      else st.push(['delete from delegate_note where event_id=$1 and contact_id=$2', [ev, rec]]);
      report.notes++;
    }
    const seen = (state.seen || {})[old];
    if (seen) {
      const base = Object.keys(seen.baseline || {}), added = Object.entries(seen.added || {});
      if (base.length) st.push([`insert into delegate_seen (event_id, contact_id, first_seen) select $1, unnest($2::text[]), null on conflict do nothing`, [ev, base]]);
      if (added.length) st.push([`insert into delegate_seen (event_id, contact_id, first_seen) select $1, k, v::date from unnest($2::text[], $3::text[]) as t(k, v)
                                   on conflict (event_id, contact_id) do update set first_seen=excluded.first_seen`, [ev, added.map(a => a[0]), added.map(a => day(a[1]) || new Date().toISOString().slice(0, 10))]]);
    }
    const os = (state.onsite || {})[old];
    if (os && Object.keys(os).length) st.push([`insert into event_onsite (event_id, dress_code, arrival, finish, station) values ($1,$2,$3,$4,$5)
        on conflict (event_id) do update set dress_code=excluded.dress_code, arrival=excluded.arrival, finish=excluded.finish, station=excluded.station, updated_at=now()`,
      [ev, s(os.dressCode, 200), s(os.arrival, 40), s(os.finish, 40), s(os.station, 200)]]);
    // Rooms: person keys as-is; old raw record ids become the person key of that record.
    const rooms = (state.rooms || {})[old];
    if (rooms) {
      const recs = [...((state.delegates || {})[old] || []), ...((state.speakers || {})[old] || []), ...((state.staff || {})[old] || []),
        ...((state.sponsors || {})[old] || []).flatMap(sp => sp.contacts || [])].filter(Boolean);
      const byId = Object.fromEntries(recs.map(r => [r.id, r]));
      const keys = [...new Set(Object.keys(rooms).filter(k => rooms[k]).map(k => (/^[esr]:/.test(k) ? k : (byId[k] ? personKey(byId[k]) : 'r:' + k))))];
      st.push(['delete from room_need where event_id=$1', [ev]]);
      if (keys.length) st.push(['insert into room_need (event_id, person_key, by_user) select $1, unnest($2::text[]), $3 on conflict do nothing', [ev, keys, 'import']]);
      report.rooms += keys.length;
    }
    // Community planner
    const ce = (community.events || {})[old];
    if (ce) {
      const ov = String(ce.delegateOverride ?? '').trim();
      st.push([`insert into community_event (event_id, slots, max_per_delegate, delegate_override) values ($1,$2,$3,$4)
                on conflict (event_id) do update set slots=excluded.slots, max_per_delegate=excluded.max_per_delegate, delegate_override=excluded.delegate_override, updated_at=now()`,
        [ev, ce.slots === '' || ce.slots == null ? 10 : (parseInt(ce.slots, 10) || 0), ce.maxPerDelegate === '' || ce.maxPerDelegate == null ? null : (parseInt(ce.maxPerDelegate, 10) || null), ov === '' ? null : (parseInt(ov, 10) || 0)]]);
      st.push(['delete from community_assign where event_id=$1', [ev]]);
      st.push(['delete from community_package where event_id=$1', [ev]]);
      (ce.packages || []).forEach((p, i) => p && p.id && st.push(['insert into community_package (id, event_id, name, meetings, sort) values ($1,$2,$3,$4,$5)',
        [`${ev}:${p.id}`, ev, s(p.name, 100) || '', parseInt(p.meetings, 10) || 0, i]]));
      for (const [sid, pid] of Object.entries(ce.assign || {})) if (sid && pid && (ce.packages || []).some(p => p && p.id === pid)) st.push([
        `insert into community_assign (event_id, sponsor_id, package_id) select $1, sp.id, $3 from sponsor sp where sp.event_id=$1 and sp.legacy_id=$2 on conflict do nothing`, [ev, sid, `${ev}:${pid}`]]);
      st.push(['update sponsor set meetings_delivered=null where event_id=$1 and legacy_id is not null', [ev]]);
      for (const [sid, n] of Object.entries(ce.delivered || {})) if (n !== '' && n != null && isFinite(+n)) st.push([
        'update sponsor set meetings_delivered=$3 where event_id=$1 and legacy_id=$2', [ev, sid, Math.max(0, Math.round(+n))]]);
      report.community++;
    }
    // History
    let log = [];
    try { log = (await store.get('audit-v1/' + old, { type: 'json' })) || []; } catch { log = []; }
    st.push(['delete from audit_log where event_id=$1 and legacy', [ev]]);
    if (log.length) {
      const L = log.filter(x => x && x.at);
      st.push([`insert into audit_log (at, actor, event_id, area, action, item, detail, legacy)
                select a::timestamptz, b, $1, c, d, e, case when f is null then null else f::jsonb end, true
                from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) as t(a, b, c, d, e, f)`,
        [ev, L.map(x => x.at), L.map(x => s(x.by, 120) || 'unknown'), L.map(x => s(x.area, 60) || 'Ops'), L.map(x => s(x.action, 20) || 'changed'),
         L.map(x => s(x.item, 300) || ''), L.map(x => (x.field != null || x.from != null || x.to != null) ? JSON.stringify({ field: x.field ?? null, from: x.from ?? null, to: x.to ?? null }) : null)]]);
      report.history += L.length;
    }
    if (st.length) { await tx(st); report.events++; }
  }
  if (Array.isArray(community.packages) && community.packages.length)
    await q(`insert into setting (key, value) values ('community_default_packages', $1) on conflict (key) do update set value=excluded.value, updated_at=now()`,
      [JSON.stringify(community.packages.map(p => ({ name: s(p.name, 100) || '', meetings: parseInt(p.meetings, 10) || 0 })))]);
  await q("insert into setting (key, value) values ('legacy_import', $1) on conflict (key) do update set value=excluded.value, updated_at=now()",
    [JSON.stringify({ at: new Date().toISOString(), by: user.email, report })]);
  await audit(user, null, 'Admin', 'changed', `Imported from the current portal: ${report.events} events`, report);
  return report;
}

function attendeeUpsert(ev, kind, x, sponsorExpr, deleted) {
  const scan = x.scanId || x.hubspotId || null;
  return [`insert into attendee (event_id, kind, legacy_id, sponsor_id, name, first_name, last_name, email, job_title, company, scan_id, id_source,
             roster_id, external, dietary, access, session, role, build, breakdown, note, added_at, removed_at)
           values ($1,$2,$3,${sponsorExpr || 'null'},$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,coalesce($21::timestamptz, now()),$22)
           on conflict (event_id, legacy_id) where legacy_id is not null do update set kind=excluded.kind, sponsor_id=excluded.sponsor_id, name=excluded.name,
             first_name=excluded.first_name, last_name=excluded.last_name, email=excluded.email, job_title=excluded.job_title, company=excluded.company,
             scan_id=excluded.scan_id, id_source=excluded.id_source, roster_id=excluded.roster_id, external=excluded.external, dietary=excluded.dietary,
             access=excluded.access, session=excluded.session, role=excluded.role, build=excluded.build, breakdown=excluded.breakdown,
             note=coalesce(excluded.note, attendee.note), removed_at=excluded.removed_at`,
    [ev, kind, String(x.id), s(x.name, 200) || s(x.email, 200) || '(no name)', s(x.firstname, 100), s(x.lastname, 100), s(x.email, 200) ? nrm(x.email) : null,
     s(x.jobtitle, 200), s(x.company, 200), s(scan, 100), s(x.idSource, 20) || (kind === 'staff' && x.rosterId ? 'roster' : null),
     s(x.rosterId, 60), !!x.external, s(x.dietary, 300), s(x.accessibility, 300), s(x.session, 300), s(x.role, 200), !!x.build, !!x.breakdown,
     s(x.note, 2000), ts(x.addedAt), deleted ? new Date().toISOString() : null]];
}

export async function lastImport() {
  return (await one("select value, updated_at from setting where key='legacy_import'"))?.value || null;
}
