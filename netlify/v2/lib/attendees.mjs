// Delegates, sponsor reps, speakers, staff, and the merged "All attendees" list,
// moved over from the current portal. Rules kept from there:
//   - delegates are live from HubSpot (Joining Instructions), plus walk-ins added here
//   - anyone added by hand is matched to HubSpot by email; no match → a generated
//     badge ID (event prefix + 4 digits, numbering carries on from the old portal)
//   - a room belongs to a person (email, else scan ID, else record), so someone on
//     two lists counts once
//   - the merged list shows each person once: Speaker > Sponsor > Delegate; staff kept separate
import { q, one } from './db.mjs';
import { bad, notFound, str } from './http.mjs';
import { audit } from './audit.mjs';
import { resolveEvent } from './events.mjs';
import { delegatesFor, lookupEmails, hubspotConfigured } from './hubspot.mjs';
import { BADGE_PREFIX, personKey } from './legacy.mjs';

export const KINDS = ['delegate', 'sponsor', 'speaker', 'staff'];
const LABEL = { delegate: 'Delegates', sponsor: 'Sponsor attendees', speaker: 'Speakers', staff: 'Staff' };
const nrm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- badge IDs
export async function badgePrefix(ev) {
  const legacy = await q('select legacy_id from event_alias where event_id=$1', [ev.id]);
  for (const id of [ev.id, ...legacy.map(r => r.legacy_id)]) if (BADGE_PREFIX[id]) return BADGE_PREFIX[id];
  return String(ev.short_name || ev.name || 'BADGE').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'BADGE';
}
async function nextBadges(ev, n) {
  const pre = await badgePrefix(ev);
  const r = await one(`select coalesce(max((substring(scan_id from $2))::int), 0) as mx from attendee where event_id=$1 and scan_id ~ $3`,
    [ev.id, '^' + pre + '(\\d{4,})$', '^' + pre + '\\d{4,}$']);
  return Array.from({ length: n }, (_, i) => pre + String((r?.mx || 0) + i + 1).padStart(4, '0'));
}

// ---------------------------------------------------------------- rooms
export async function roomSummary(ev) {
  const keys = (await q('select person_key from room_need where event_id=$1', [ev.id])).map(r => r.person_key);
  // A key only stops counting when everyone it belonged to has been removed.
  const rows = await q('select email, scan_id, legacy_id, id, removed_at from attendee where event_id=$1', [ev.id]);
  const act = new Set(), dead = new Set();
  for (const r of rows) { const k = personKey({ email: r.email, scanId: r.scan_id, id: r.legacy_id || r.id }); (r.removed_at ? dead : act).add(k); }
  const allocated = keys.filter(k => act.has(k) || !dead.has(k)).length;
  return { allocated, total: ev.rooms_total ?? null };
}
export async function setRoom(user, eventId, key, on) {
  const ev = await resolveEvent(eventId);
  key = str(key, 300); if (!/^[esr]:./.test(key)) throw bad('Bad person key');
  if (on) await q('insert into room_need (event_id, person_key, by_user) values ($1,$2,$3) on conflict do nothing', [ev.id, key, user.email]);
  else await q('delete from room_need where event_id=$1 and person_key=$2', [ev.id, key]);
  const rooms = await roomSummary(ev);
  await audit(user, ev.id, 'Rooms', 'changed', `Room ${on ? 'added' : 'removed'}: ${key.slice(2)}`, { allocated: rooms.allocated });
  return { rooms };
}
async function roomKeys(ev) { return new Set((await q('select person_key from room_need where event_id=$1', [ev.id])).map(r => r.person_key)); }

// ---------------------------------------------------------------- reading
function row(a) {
  return { id: a.id, kind: a.kind, name: a.name, firstname: a.first_name || '', lastname: a.last_name || '', email: a.email || '', jobtitle: a.job_title || '',
    company: a.company || '', scanId: a.scan_id || '', idSource: a.id_source || '', dietary: a.dietary || '', accessibility: a.access || '',
    session: a.session || '', role: a.role || '', external: a.external, build: a.build, breakdown: a.breakdown, note: a.note || '',
    sponsorId: a.sponsor_id, rosterId: a.roster_id || '', addedAt: a.added_at, manual: true,
    key: personKey({ email: a.email, scanId: a.scan_id, id: a.legacy_id || a.id }) };
}
export async function listKind(eventId, kind) {
  const ev = await resolveEvent(eventId);
  const rows = (await q('select * from attendee where event_id=$1 and kind=$2 and removed_at is null order by name', [ev.id, kind])).map(row);
  const rk = await roomKeys(ev);
  for (const r of rows) r.room = rk.has(r.key);
  return { event: ev, rows, rooms: await roomSummary(ev) };
}

// Live delegates from HubSpot + walk-ins, with notes, first-seen dates and rooms.
export async function delegates(eventId, { fresh = false } = {}) {
  const ev = await resolveEvent(eventId);
  let live = [], liveError = null;
  if (!ev.ops_ji) liveError = 'This event has no Joining Instructions value yet. Set it in Admin.';
  else if (!hubspotConfigured()) liveError = 'HUBSPOT_TOKEN is not set on this site.';
  else { try { live = await delegatesFor(ev.ops_ji, { fresh }); } catch (e) { liveError = String(e.message || e); } }
  // First-seen tracking: the first load is the baseline, later arrivals get today's date.
  if (live.length) {
    const any = await one('select 1 as x from delegate_seen where event_id=$1 limit 1', [ev.id]);
    await q(`insert into delegate_seen (event_id, contact_id, first_seen) select $1, unnest($2::text[]), $3::date on conflict do nothing`,
      [ev.id, live.map(d => d.id), any ? today() : null]);
  }
  const seen = Object.fromEntries((await q('select contact_id, first_seen from delegate_seen where event_id=$1', [ev.id])).map(r => [r.contact_id, r.first_seen]));
  const notes = Object.fromEntries((await q('select contact_id, note from delegate_note where event_id=$1', [ev.id])).map(r => [r.contact_id, r.note]));
  const rk = await roomKeys(ev);
  const out = live.map(d => {
    const r = { ...d, kind: 'delegate', manual: false, hubspotId: d.id, addedAt: seen[d.id] || '', note: notes[d.id] || '' };
    r.key = personKey(r); r.room = rk.has(r.key); return r;
  });
  const walk = (await q("select * from attendee where event_id=$1 and kind='delegate' and removed_at is null order by name", [ev.id])).map(row);
  for (const r of walk) r.room = rk.has(r.key);
  return { event: ev, rows: [...out, ...walk], live: out.length, walkins: walk.length, liveError, rooms: await roomSummary(ev) };
}

// ---------------------------------------------------------------- writing
const FIELDS = { name: 200, email: 200, jobtitle: 200, company: 200, dietary: 300, accessibility: 300, session: 300, role: 200, note: 2000 };
const COL = { jobtitle: 'job_title', accessibility: 'access' };

export async function addPeople(user, eventId, kind, list, opts = {}) {
  const ev = await resolveEvent(eventId);
  if (!KINDS.includes(kind)) throw bad('Unknown list');
  list = (Array.isArray(list) ? list : [list]).map(x => ({ ...x, name: str(x.name, 200), email: nrm(x.email).slice(0, 200) })).filter(x => x.name || x.email);
  if (!list.length) throw bad('Name is required');
  if (list.length > 2000) throw bad('That is more than 2,000 rows');
  let sponsor = null;
  if (kind === 'sponsor') {
    sponsor = await one('select * from sponsor where id=$1 and event_id=$2 and removed_at is null', [opts.sponsorId || null, ev.id]);
    if (!sponsor) throw bad('Choose the sponsor this person is with');
  }
  let matches = {};
  try { matches = await lookupEmails(list.map(x => x.email)); } catch { matches = {}; }
  const need = list.filter(x => !(matches[x.email] && (matches[x.email].scanId || matches[x.email].id)) && !x.scanId).length;
  const badges = await nextBadges(ev, need);
  const made = []; let matched = 0;
  for (const x of list) {
    const m = matches[x.email];
    const scan = x.scanId || (m ? (m.scanId || m.id) : badges.shift());
    const src = x.scanId ? (x.idSource || 'roster') : (m ? 'hubspot' : 'generated'); if (m) matched++;
    const name = x.name || (m && m.name) || x.email;
    const a = await one(`insert into attendee (event_id, kind, sponsor_id, name, first_name, last_name, email, job_title, company, scan_id, id_source, hubspot_id,
                          roster_id, external, dietary, access, session, role, note)
                         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
      [ev.id, kind, sponsor?.id || null, name, str(x.firstname, 100) || (m && m.firstname) || name.split(' ')[0] || null,
       str(x.lastname, 100) || (m && m.lastname) || name.split(' ').slice(1).join(' ') || null, x.email || null,
       str(x.jobtitle, 200) || (m && m.jobtitle) || null, str(x.company, 200) || (kind === 'sponsor' ? sponsor.company : (m && m.company)) || null,
       scan, src, m ? m.id : null, str(x.rosterId, 60) || null, !!x.external,
       str(x.dietary, 300) || (m && m.dietary) || null, str(x.accessibility, 300) || (m && m.accessibility) || null,
       str(x.session, 300) || null, str(x.role, 200) || null, str(x.note, 2000) || null]);
    made.push(row(a));
  }
  await audit(user, ev.id, LABEL[kind], 'added', list.length === 1 ? `${made[0].name}${sponsor ? ' (' + sponsor.company + ')' : ''}` : `${list.length} people`,
    { matched, generated: list.length - matched });
  return { added: made, matched, generated: list.length - matched };
}

export async function updatePerson(user, id, patch) {
  const a = await one('select * from attendee where id=$1', [id]); if (!a) throw notFound();
  const sets = [], vals = [id], changed = {};
  for (const [k, max] of Object.entries(FIELDS)) {
    if (patch[k] === undefined) continue;
    const v = k === 'email' ? (nrm(patch[k]).slice(0, max) || null) : (str(patch[k], max) || null);
    if (k === 'name' && !v) throw bad('Name cannot be blank');
    vals.push(v); sets.push(`${COL[k] || k}=$${vals.length}`); changed[k] = v;
  }
  for (const k of ['build', 'breakdown']) if (patch[k] !== undefined) { vals.push(!!patch[k]); sets.push(`${k}=$${vals.length}`); changed[k] = !!patch[k]; }
  if (!sets.length) return { person: row(a) };
  const b = await one(`update attendee set ${sets.join(', ')} where id=$1 returning *`, vals);
  for (const [k, v] of Object.entries(changed)) {
    const before = a[COL[k] || k];
    if (String(before ?? '') !== String(v ?? '')) await audit(user, a.event_id, LABEL[a.kind], 'changed', a.name, { field: k, from: before ?? '', to: v ?? '' });
  }
  return { person: row(b) };
}
export async function removePerson(user, id) {
  const a = await one('update attendee set removed_at=now() where id=$1 and removed_at is null returning *', [id]); if (!a) throw notFound();
  const key = personKey({ email: a.email, scanId: a.scan_id, id: a.legacy_id || a.id });
  const still = await one('select 1 as x from attendee where event_id=$1 and removed_at is null and (($2::text is not null and email=$2) or ($3::text is not null and scan_id=$3)) limit 1', [a.event_id, a.email, a.scan_id]);
  if (!still) await q('delete from room_need where event_id=$1 and person_key=$2', [a.event_id, key]);
  await audit(user, a.event_id, LABEL[a.kind], 'removed', a.name);
  return { ok: true };
}
export async function setDelegateNote(user, eventId, contactId, note) {
  const ev = await resolveEvent(eventId); contactId = str(contactId, 40); if (!contactId) throw bad('contact id required');
  const v = str(note, 2000);
  const before = (await one('select note from delegate_note where event_id=$1 and contact_id=$2', [ev.id, contactId]))?.note || '';
  if (v) await q('insert into delegate_note (event_id, contact_id, note) values ($1,$2,$3) on conflict (event_id, contact_id) do update set note=excluded.note', [ev.id, contactId, v]);
  else await q('delete from delegate_note where event_id=$1 and contact_id=$2', [ev.id, contactId]);
  if (before !== v) await audit(user, ev.id, 'Delegates', 'changed', 'Note on delegate ' + contactId, { field: 'note', from: before, to: v });
  return { ok: true };
}

// ---------------------------------------------------------------- everyone
export async function everyone(eventId) {
  const d = await delegates(eventId);
  const ev = d.event;
  const spons = Object.fromEntries((await q('select id, company, tier from sponsor where event_id=$1', [ev.id])).map(s => [s.id, s]));
  const others = (await q(`select a.* from attendee a left join sponsor s on s.id = a.sponsor_id
                           where a.event_id=$1 and a.kind <> 'delegate' and a.removed_at is null and (a.sponsor_id is null or s.removed_at is null) order by a.name`, [ev.id])).map(row);
  const rk = await roomKeys(ev);
  const T = { delegate: 'Delegate', sponsor: 'Sponsor', speaker: 'Speaker', staff: 'Staff' };
  const rows = [...d.rows, ...others].map(r => {
    const sp = r.sponsorId ? spons[r.sponsorId] : null;
    const key = r.key || personKey(r);
    return { type: T[r.kind], kind: r.kind, id: r.id, scanId: r.scanId, name: r.name, jobtitle: r.jobtitle, company: sp ? sp.company : r.company, email: r.email,
      dietary: r.dietary, accessibility: r.accessibility, addedAt: r.addedAt, note: r.note,
      detail: r.kind === 'sponsor' ? (sp?.tier || '') : r.kind === 'speaker' ? r.session : r.kind === 'staff' ? (r.external ? 'external' : 'staff') : (r.manual ? 'walk-in' : ''),
      build: !!r.build, breakdown: !!r.breakdown, room: rk.has(key), key };
  });
  const prio = { Speaker: 1, Sponsor: 2, Delegate: 3 }, seen = {}, out = [];
  for (const r of rows) {
    const e = nrm(r.email);
    if (!e || !(r.type in prio)) { out.push(r); continue; }
    const ex = seen[e];
    if (!ex) { seen[e] = r; out.push(r); }
    else if (prio[r.type] < prio[ex.type]) { out[out.indexOf(ex)] = r; seen[e] = r; }
  }
  const counts = out.reduce((m, r) => (m[r.type] = (m[r.type] || 0) + 1, m), {});
  return { event: ev, rows: out, counts, liveError: d.liveError, rooms: d.rooms };
}

// Tab badges for one event.
export async function tabCounts(eventId) {
  const ev = await resolveEvent(eventId);
  const r = Object.fromEntries((await q(`select a.kind, count(*)::int n from attendee a left join sponsor s on s.id=a.sponsor_id
                                         where a.event_id=$1 and a.removed_at is null and (a.sponsor_id is null or s.removed_at is null) group by 1`, [ev.id])).map(x => [x.kind, x.n]));
  const sponsors = (await one('select count(*)::int n from sponsor where event_id=$1 and removed_at is null', [ev.id])).n;
  return { walkins: r.delegate || 0, reps: r.sponsor || 0, speakers: r.speaker || 0, staff: r.staff || 0, sponsors };
}
