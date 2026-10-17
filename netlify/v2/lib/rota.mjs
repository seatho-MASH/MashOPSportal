// Theatre rota: theatres, sessions, crew, cover rules, assignments, gaps, breaks.
import { q, one } from './db.mjs';
import { bad, notFound, str, isoOrThrow, isDay, int } from './http.mjs';
import { audit } from './audit.mjs';
import { resolveEvent } from './events.mjs';
import { londonToUtc, londonDay, londonTime } from './time.mjs';
import { seal, open, sha } from './crypto.mjs';

const SLOT = 15 * 60000;   // gap + break maths runs in 15-minute steps

// ------------------------------------------------------------------ people
export async function upsertPerson(p) {
  const email = str(p.email, 200).toLowerCase() || null;
  const first = str(p.first_name, 100), last = str(p.last_name, 100);
  if (!email && !first && !last) throw bad('A person needs a name or an email');
  if (email) {
    const row = await one(`insert into person (email, first_name, last_name, phone, organisation, job_title, is_mash_staff)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (lower(email)) where email is not null and email <> '' do update set
        first_name = coalesce(nullif(excluded.first_name,''), person.first_name),
        last_name  = coalesce(nullif(excluded.last_name,''), person.last_name),
        phone      = coalesce(excluded.phone, person.phone),
        organisation = coalesce(excluded.organisation, person.organisation),
        job_title  = coalesce(excluded.job_title, person.job_title),
        is_mash_staff = person.is_mash_staff or excluded.is_mash_staff,
        updated_at = now()
      returning *`, [email, first, last, str(p.phone, 40) || null, str(p.organisation, 200) || null, str(p.job_title, 200) || null, email.endsWith('@mashmedia.net')]);
    return row;
  }
  return one('insert into person (first_name, last_name, phone, organisation, job_title) values ($1,$2,$3,$4,$5) returning *',
    [first, last, str(p.phone, 40) || null, str(p.organisation, 200) || null, str(p.job_title, 200) || null]);
}
const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Unnamed';

async function roleId(nameOrId) {
  if (!nameOrId) return null;
  const r = await one('select id from crew_role where id::text = $1 or lower(name) = lower($1)', [String(nameOrId)]);
  if (r) return r.id;
  return (await one('insert into crew_role (name, sort) values ($1, 99) returning id', [str(nameOrId, 60)])).id;
}

// ------------------------------------------------------------------ crew
export async function addCrew(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const p = await upsertPerson(b);
  const kind = b.kind === 'staff' || p.is_mash_staff ? 'staff' : 'volunteer';
  await q(`insert into crew_member (event_id, person_id, kind, default_role_id) values ($1,$2,$3,$4)
           on conflict (event_id, person_id) do update set kind=excluded.kind, default_role_id=coalesce(excluded.default_role_id, crew_member.default_role_id)`,
    [ev.id, p.id, kind, await roleId(b.role)]);
  await audit(user, ev.id, 'Crew', 'added', fullName(p), { kind });
  return { ok: true, person: p };
}
export async function importCrew(user, eventId, rows) {
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows to import');
  if (rows.length > 1000) throw bad('Import at most 1,000 rows at a time');
  let n = 0; const errors = [];
  for (const [i, r] of rows.entries()) {
    try { await addCrew({ ...user, quiet: true }, eventId, r); n++; } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
  }
  return { imported: n, errors };
}
export async function removeCrew(user, eventId, personId) {
  const ev = await resolveEvent(eventId);
  const p = await one('select * from person where id=$1', [personId]);
  if (!p) throw notFound();
  await q('delete from assignment where event_id=$1 and person_id=$2', [ev.id, personId]);
  await q('delete from crew_member where event_id=$1 and person_id=$2', [ev.id, personId]);
  await audit(user, ev.id, 'Crew', 'removed', fullName(p));
  return { ok: true };
}

// ------------------------------------------------------------------ theatres
export async function addTheatre(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const name = str(b.name, 100); if (!name) throw bad('Theatre name is required');
  const sort = (await one('select coalesce(max(sort),0)+1 n from theatre where event_id=$1', [ev.id])).n;
  const t = await one('insert into theatre (event_id, name, ninja_location, sort) values ($1,$2,$3,$4) on conflict (event_id, name) do update set name=excluded.name returning *',
    [ev.id, name, str(b.ninja_location, 200) || null, sort]);
  await audit(user, ev.id, 'Theatres', 'added', name);
  return { theatre: t };
}
export async function updateTheatre(user, id, b) {
  const t = await one('select * from theatre where id=$1', [id]); if (!t) throw notFound();
  const name = b.name != null ? str(b.name, 100) : t.name;
  if (!name) throw bad('Theatre name is required');
  await q('update theatre set name=$2, ninja_location=$3 where id=$1', [id, name, b.ninja_location != null ? (str(b.ninja_location, 200) || null) : t.ninja_location]);
  await audit(user, t.event_id, 'Theatres', 'changed', t.name, { name });
  return { ok: true };
}
export async function removeTheatre(user, id) {
  const t = await one('delete from theatre where id=$1 returning *', [id]); if (!t) throw notFound();
  await audit(user, t.event_id, 'Theatres', 'removed', t.name);
  return { ok: true };
}

// ------------------------------------------------------------------ sessions
async function theatreFor(eventId, b) {
  if (b.theatre_id) return b.theatre_id;
  const name = str(b.theatre || b.location, 100);
  if (!name) return null;
  const t = await one('select id from theatre where event_id=$1 and (lower(name)=lower($2) or lower(ninja_location)=lower($2))', [eventId, name]);
  return t ? t.id : (await addTheatre({ email: 'import' }, eventId, { name, ninja_location: name })).theatre.id;
}
export async function addSession(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const title = str(b.title, 300); if (!title) throw bad('Session title is required');
  const s = isoOrThrow(b.starts_at, 'Start'), e = isoOrThrow(b.ends_at, 'End');
  if (e <= s) throw bad('A session must end after it starts');
  const tid = await theatreFor(ev.id, b);
  const ninja = str(b.ninja_id, 100) || null;
  const row = ninja
    ? await one(`insert into session (event_id, theatre_id, ninja_id, title, starts_at, ends_at, source) values ($1,$2,$3,$4,$5,$6,$7)
                 on conflict (event_id, ninja_id) where ninja_id is not null do update set theatre_id=excluded.theatre_id, title=excluded.title,
                   starts_at=excluded.starts_at, ends_at=excluded.ends_at, removed_at=null, updated_at=now() returning *`,
                [ev.id, tid, ninja, title, s, e, b.source || 'csv'])
    : await one('insert into session (event_id, theatre_id, title, starts_at, ends_at, source) values ($1,$2,$3,$4,$5,$6) returning *',
                [ev.id, tid, title, s, e, b.source || 'manual']);
  if (!user.quiet) await audit(user, ev.id, 'Agenda', 'added', title, { starts_at: s });
  return { session: row };
}
// CSV rows: title, theatre/location, day, start, end, ninja_id (optional). Times are London wall clock.
export async function importSessions(user, eventId, rows) {
  const ev = await resolveEvent(eventId);
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows to import');
  let n = 0; const errors = [];
  for (const [i, r] of rows.entries()) {
    try {
      const day = isDay(r.day) ? r.day : ev.days[0];
      if (!day) throw new Error('no day and the event has no date');
      const starts_at = r.starts_at || londonToUtc(day, r.start).toISOString();
      const ends_at = r.ends_at || londonToUtc(day, r.end).toISOString();
      await addSession({ ...user, quiet: true }, ev.id, { ...r, starts_at, ends_at, source: r.ninja_id ? 'csv' : 'csv' });
      n++;
    } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
  }
  await audit(user, ev.id, 'Agenda', 'added', `${n} sessions imported`);
  return { imported: n, errors };
}
export async function removeSession(user, id) {
  const s = await one('update session set removed_at=now(), updated_at=now() where id=$1 returning *', [id]); if (!s) throw notFound();
  await audit(user, s.event_id, 'Agenda', 'removed', s.title);
  return { ok: true };
}

// ------------------------------------------------------------------ cover rules
export async function addRule(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const rid = await roleId(b.role_id || b.role); if (!rid) throw bad('Pick a role');
  const from_at = isoOrThrow(b.from_at, 'From'), to_at = isoOrThrow(b.to_at, 'To');
  if (to_at <= from_at) throw bad('"To" must be after "From"');
  const r = await one('insert into coverage_rule (event_id, theatre_id, role_id, min_count, from_at, to_at) values ($1,$2,$3,$4,$5,$6) returning *',
    [ev.id, b.theatre_id || null, rid, Math.max(0, int(b.min_count, 1)), from_at, to_at]);
  await audit(user, ev.id, 'Cover rules', 'added', `${r.min_count} × role`, { theatre_id: r.theatre_id, from_at, to_at });
  return { rule: r };
}
export async function removeRule(user, id) {
  const r = await one('delete from coverage_rule where id=$1 returning *', [id]); if (!r) throw notFound();
  await audit(user, r.event_id, 'Cover rules', 'removed', 'Cover rule');
  return { ok: true };
}
export async function putBreakRule(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const t = (v, d) => (/^\d{2}:\d{2}$/.test(v || '') ? v : d);
  await q(`insert into break_rule (event_id, window_from, window_to, break_minutes, max_continuous) values ($1,$2,$3,$4,$5)
           on conflict (event_id) do update set window_from=excluded.window_from, window_to=excluded.window_to,
             break_minutes=excluded.break_minutes, max_continuous=excluded.max_continuous`,
    [ev.id, t(b.window_from, '12:00'), t(b.window_to, '14:00'), Math.min(240, Math.max(5, int(b.break_minutes, 30))), Math.max(30, int(b.max_continuous, 240))]);
  await audit(user, ev.id, 'Breaks', 'changed', 'Break rules', b);
  return { ok: true };
}

// ------------------------------------------------------------------ assignments
export async function addAssignment(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const p = await one('select * from person where id=$1', [b.person_id]); if (!p) throw bad('Unknown person');
  const s = isoOrThrow(b.starts_at, 'Start'), e = isoOrThrow(b.ends_at, 'End');
  if (e <= s) throw bad('A shift must end after it starts');
  const kind = b.kind === 'break' ? 'break' : 'work';
  // A person can't be in two places at once.
  const clash = await one(`select a.*, t.name theatre from assignment a left join theatre t on t.id=a.theatre_id
     where a.event_id=$1 and a.person_id=$2 and a.kind=$3 and a.starts_at < $5 and a.ends_at > $4 limit 1`, [ev.id, p.id, kind, s, e]);
  if (clash && !b.allowOverlap) throw bad(`${fullName(p)} is already on ${clash.kind === 'break' ? 'a break' : (clash.theatre || 'shift')} ${londonTime(clash.starts_at)}–${londonTime(clash.ends_at)}`);
  await q(`insert into crew_member (event_id, person_id, kind) values ($1,$2,$3) on conflict do nothing`, [ev.id, p.id, p.is_mash_staff ? 'staff' : 'volunteer']);
  const a = await one(`insert into assignment (event_id, person_id, theatre_id, role_id, kind, starts_at, ends_at, source)
                       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [ev.id, p.id, b.theatre_id || null, kind === 'work' ? await roleId(b.role_id || b.role) : null, kind, s, e, b.source === 'engine' ? 'engine' : 'manual']);
  if (!user.quiet) await audit(user, ev.id, 'Rota', 'added', `${fullName(p)} — ${kind === 'break' ? 'break' : 'shift'} ${londonTime(s)}–${londonTime(e)}`);
  return { assignment: a };
}
export async function removeAssignment(user, id) {
  const a = await one(`delete from assignment a using person p where a.id=$1 and p.id=a.person_id
                       returning a.*, p.first_name, p.last_name, p.email`, [id]);
  if (!a) throw notFound();
  await audit(user, a.event_id, 'Rota', 'removed', `${fullName(a)} — ${a.kind} ${londonTime(a.starts_at)}–${londonTime(a.ends_at)}`);
  return { ok: true };
}

// ------------------------------------------------------------------ reading the rota
async function load(ev, day) {
  const from = londonToUtc(day, '00:00').toISOString(), to = londonToUtc(day, '23:59').toISOString();
  const [theatres, sessions, assignments, rules, roles, crew, brk] = await Promise.all([
    q('select * from theatre where event_id=$1 order by sort, name', [ev.id]),
    q('select * from session where event_id=$1 and removed_at is null and starts_at < $3 and ends_at > $2 order by starts_at', [ev.id, from, to]),
    q(`select a.*, p.first_name, p.last_name, p.email, r.name role_name from assignment a join person p on p.id=a.person_id
       left join crew_role r on r.id=a.role_id where a.event_id=$1 and a.starts_at < $3 and a.ends_at > $2 order by a.starts_at`, [ev.id, from, to]),
    q(`select c.*, r.name role_name from coverage_rule c join crew_role r on r.id=c.role_id
       where c.event_id=$1 and c.from_at < $3 and c.to_at > $2`, [ev.id, from, to]),
    q('select * from crew_role order by sort, name'),
    q(`select p.*, c.kind, r.name default_role from crew_member c join person p on p.id=c.person_id
       left join crew_role r on r.id=c.default_role_id where c.event_id=$1 order by p.first_name, p.last_name`, [ev.id]),
    one('select * from break_rule where event_id=$1', [ev.id])
  ]);
  return { theatres, sessions, assignments, rules, roles, crew, breakRule: brk || { window_from: '12:00', window_to: '14:00', break_minutes: 30, max_continuous: 240 } };
}

// Who covers (theatre, role) at instant t — working, and not on a break.
function coverAt(assignments, theatreId, roleId, t, exclude = new Set()) {
  const onBreak = new Set(assignments.filter(a => a.kind === 'break' && +new Date(a.starts_at) <= t && +new Date(a.ends_at) > t).map(a => a.person_id));
  return assignments.filter(a => a.kind === 'work' && a.theatre_id === theatreId && a.role_id === roleId &&
    +new Date(a.starts_at) <= t && +new Date(a.ends_at) > t && !onBreak.has(a.person_id) && !exclude.has(a.person_id)).length;
}

export function findGaps(data) {
  const out = [];
  for (const r of data.rules) {
    const ths = r.theatre_id ? data.theatres.filter(t => t.id === r.theatre_id) : data.theatres;
    for (const th of ths) {
      let open = null;
      for (let t = +new Date(r.from_at); t < +new Date(r.to_at); t += SLOT) {
        const have = coverAt(data.assignments, th.id, r.role_id, t);
        const short = r.min_count - have;
        if (short > 0) {
          if (open && open.short === short) open.to = t + SLOT;
          else { if (open) out.push(open); open = { theatre_id: th.id, theatre: th.name, role_id: r.role_id, role: r.role_name, short, from: t, to: t + SLOT }; }
        } else if (open) { out.push(open); open = null; }
      }
      if (open) out.push(open);
    }
  }
  return out.map(g => ({ ...g, from: new Date(g.from).toISOString(), to: new Date(g.to).toISOString() }));
}

export async function getRota(eventId, day) {
  const ev = await resolveEvent(eventId);
  const d = isDay(day) ? day : (ev.days[0] || londonDay(new Date()));
  const data = await load(ev, d);
  const gaps = findGaps(data);
  // Free crew at each gap = on the crew list, not working anywhere in that window.
  for (const g of gaps) {
    const busy = new Set(data.assignments.filter(a => a.kind === 'work' && +new Date(a.starts_at) < +new Date(g.to) && +new Date(a.ends_at) > +new Date(g.from)).map(a => a.person_id));
    g.free = data.crew.filter(p => !busy.has(p.id)).slice(0, 12).map(p => ({ id: p.id, name: fullName(p), kind: p.kind, role: p.default_role }));
  }
  return { event: ev, day: d, ...data, gaps };
}

// ------------------------------------------------------------------ break engine
// For everyone working through the break window without a break, find the
// earliest slot in the window where taking them off still leaves every cover
// rule met (allowing for breaks already proposed). Never splits a person's
// break across two slots; reports anyone it could not place.
export async function proposeBreaks(eventId, day) {
  const ev = await resolveEvent(eventId);
  const d = isDay(day) ? day : ev.days[0];
  const data = await load(ev, d);
  const br = data.breakRule;
  const len = br.break_minutes * 60000;
  const wFrom = +londonToUtc(d, String(br.window_from).slice(0, 5)), wTo = +londonToUtc(d, String(br.window_to).slice(0, 5));
  const working = new Map();
  for (const a of data.assignments.filter(a => a.kind === 'work')) {
    const s = +new Date(a.starts_at), e = +new Date(a.ends_at);
    if (s < wTo && e > wFrom) (working.get(a.person_id) || working.set(a.person_id, []).get(a.person_id)).push(a);
  }
  const already = new Set(data.assignments.filter(a => a.kind === 'break' && +new Date(a.starts_at) < wTo && +new Date(a.ends_at) > wFrom).map(a => a.person_id));
  const proposals = [], unplaced = [];
  const sim = [...data.assignments];
  const rulesFor = (theatreId, roleId, t) => data.rules.filter(r => (r.theatre_id === theatreId || !r.theatre_id) && r.role_id === roleId && +new Date(r.from_at) <= t && +new Date(r.to_at) > t);
  for (const [pid, shifts] of working) {
    if (already.has(pid)) continue;
    const person = data.crew.find(c => c.id === pid) || shifts[0];
    let placed = null;
    for (let t = wFrom; t + len <= wTo && !placed; t += SLOT) {
      const shift = shifts.find(a => +new Date(a.starts_at) <= t && +new Date(a.ends_at) >= t + len);
      if (!shift) continue;                                      // only breaks inside a shift they're actually on
      let ok = true;
      for (let s = t; s < t + len && ok; s += SLOT) {
        for (const r of rulesFor(shift.theatre_id, shift.role_id, s)) {
          if (coverAt(sim, shift.theatre_id, shift.role_id, s, new Set([pid])) < r.min_count) { ok = false; break; }
        }
      }
      if (ok) placed = { person_id: pid, name: fullName(person), theatre: (data.theatres.find(x => x.id === shift.theatre_id) || {}).name || '', starts_at: new Date(t).toISOString(), ends_at: new Date(t + len).toISOString() };
    }
    if (placed) { proposals.push(placed); sim.push({ ...placed, kind: 'break' }); }
    else unplaced.push({ person_id: pid, name: fullName(person), reason: 'No slot in the break window keeps their theatre covered — add cover, or place this break by hand.' });
  }
  return { day: d, window: `${String(br.window_from).slice(0, 5)}–${String(br.window_to).slice(0, 5)}`, breakMinutes: br.break_minutes, proposals, unplaced };
}
export async function acceptBreaks(user, eventId, list) {
  if (!Array.isArray(list) || !list.length) throw bad('Nothing to accept');
  let n = 0;
  for (const p of list) { await addAssignment({ ...user, quiet: true }, eventId, { person_id: p.person_id, kind: 'break', starts_at: p.starts_at, ends_at: p.ends_at, source: 'engine' }); n++; }
  const ev = await resolveEvent(eventId);
  await audit(user, ev.id, 'Breaks', 'added', `${n} breaks from the break engine`);
  return { added: n };
}

// ------------------------------------------------------------------ schedules
// A person's schedule = their shifts and breaks, plus the sessions running in
// their theatre while they're on. The fingerprint changes when any of that does.
export async function personSchedule(ev, personId) {
  const shifts = await q(`select a.*, t.name theatre, r.name role from assignment a left join theatre t on t.id=a.theatre_id
     left join crew_role r on r.id=a.role_id where a.event_id=$1 and a.person_id=$2 order by a.starts_at`, [ev.id, personId]);
  const sessions = await q(`select s.id, s.title, s.starts_at, s.ends_at, s.theatre_id from session s
     where s.event_id=$1 and s.removed_at is null and exists (select 1 from assignment a where a.event_id=s.event_id and a.person_id=$2
       and a.kind='work' and a.theatre_id=s.theatre_id and a.starts_at < s.ends_at and a.ends_at > s.starts_at) order by s.starts_at`, [ev.id, personId]);
  const fp = sha(JSON.stringify([shifts.map(a => [a.kind, a.theatre, a.role, a.starts_at, a.ends_at]), sessions.map(s => [s.title, s.theatre_id, s.starts_at, s.ends_at])]));
  return { shifts, sessions, fingerprint: fp };
}

export async function scheduleStatus(eventId) {
  const ev = await resolveEvent(eventId);
  const crew = await q(`select p.*, c.kind from crew_member c join person p on p.id=c.person_id where c.event_id=$1 order by p.first_name, p.last_name`, [ev.id]);
  const sends = await q(`select distinct on (person_id) person_id, fingerprint, sent_at from schedule_send where event_id=$1 order by person_id, sent_at desc`, [ev.id]);
  const queued = new Set((await q("select person_id from outbox where event_id=$1 and kind='schedule' and status in ('queued','sending')", [ev.id])).map(r => r.person_id));
  const last = new Map(sends.map(s => [s.person_id, s]));
  const out = [];
  for (const p of crew) {
    const s = await personSchedule(ev, p.id);
    const prev = last.get(p.id);
    const status = queued.has(p.id) ? 'queued' : !s.shifts.length ? 'no-shifts' : !prev ? 'never-sent' : prev.fingerprint === s.fingerprint ? 'up-to-date' : 'changed';
    out.push({ person_id: p.id, name: fullName(p), email: p.email, kind: p.kind, shifts: s.shifts.length, status, sent_at: prev ? prev.sent_at : null });
  }
  return { people: out };
}

// ------------------------------------------------------------------ Grip logins
export async function putCredential(user, eventId, personId, b) {
  const ev = await resolveEvent(eventId);
  const username = str(b.username, 200); if (!username) throw bad('Username is required');
  await q(`insert into credential (event_id, person_id, system, username, secret_enc) values ($1,$2,'Grip',$3,$4)
           on conflict (event_id, person_id, system) do update set username=excluded.username,
             secret_enc=coalesce(excluded.secret_enc, credential.secret_enc), updated_at=now()`,
    [ev.id, personId, username, b.password ? seal(b.password) : null]);
  await audit(user, ev.id, 'Grip logins', 'changed', 'Grip login', { person_id: personId });
  return { ok: true };
}
export async function revealCredential(user, eventId, personId) {
  const ev = await resolveEvent(eventId);
  const c = await one("select * from credential where event_id=$1 and person_id=$2 and system='Grip'", [ev.id, personId]);
  if (!c) return { credential: null };
  await q("insert into credential_view (viewer, event_id, person_id, system) values ($1,$2,$3,'Grip')", [user.email, ev.id, personId]);
  return { credential: { username: c.username, password: c.secret_enc ? open(c.secret_enc) : '' } };
}
export async function credentialFor(ev, personId) {
  const c = await one("select * from credential where event_id=$1 and person_id=$2 and system='Grip'", [ev.id, personId]);
  return c ? { username: c.username, password: c.secret_enc ? open(c.secret_enc) : '' } : null;
}
export { fullName };
