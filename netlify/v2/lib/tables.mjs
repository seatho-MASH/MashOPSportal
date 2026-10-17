// Table planner — summits, awards and lunches.
import { q, one, tx } from './db.mjs';
import { bad, notFound, str, int } from './http.mjs';
import { audit } from './audit.mjs';
import { resolveEvent } from './events.mjs';

const DIETS = [['Vegetarian', /veggie|vegetarian/i], ['Vegan', /vegan/i], ['Gluten-free', /gluten|coeliac|celiac|\bgf\b/i],
  ['Nut allergy', /nut/i], ['Dairy-free', /dairy|lactose/i], ['Halal', /halal/i], ['Kosher', /kosher/i]];
const NONE = /^(none|n\/?a|no|nil|-|)$/i;
export function dietKey(s) {
  const v = String(s || '').trim();
  if (NONE.test(v)) return null;
  for (const [k, re] of DIETS) if (re.test(v)) return k;
  return 'Other';
}

export async function getTables(eventId) {
  const ev = await resolveEvent(eventId);
  const [tables, guests] = await Promise.all([
    q('select * from dining_table where event_id=$1 order by number', [ev.id]),
    q(`select g.*, s.table_id from guest g left join seating s on s.guest_id=g.id where g.event_id=$1 order by g.organisation nulls last, g.name`, [ev.id])
  ]);
  const diet = {}, access = {};
  for (const g of guests) {
    const k = dietKey(g.dietary); if (k) diet[k] = (diet[k] || 0) + 1;
    if (g.access && !NONE.test(g.access.trim())) access[g.access.trim()] = (access[g.access.trim()] || 0) + 1;
  }
  return { event: ev, tables, guests, totals: { guests: guests.length, seated: guests.filter(g => g.table_id).length, seats: tables.reduce((n, t) => n + t.seats, 0) }, diet, access };
}
export async function addTables(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const count = Math.min(200, Math.max(1, int(b.count, 1))), seats = Math.min(30, Math.max(1, int(b.seats, 10)));
  const start = (await one('select coalesce(max(number),0) n from dining_table where event_id=$1', [ev.id])).n;
  for (let i = 1; i <= count; i++) await q('insert into dining_table (event_id, number, seats) values ($1,$2,$3)', [ev.id, start + i, seats]);
  await audit(user, ev.id, 'Tables', 'added', `${count} table${count === 1 ? '' : 's'} of ${seats}`);
  return { ok: true };
}
export async function updateTable(user, id, b) {
  const t = await one('select * from dining_table where id=$1', [id]); if (!t) throw notFound();
  await q('update dining_table set label=$2, seats=$3 where id=$1', [id, b.label != null ? (str(b.label, 100) || null) : t.label, b.seats != null ? Math.max(1, int(b.seats, t.seats)) : t.seats]);
  await audit(user, t.event_id, 'Tables', 'changed', `Table ${t.number}`, b);
  return { ok: true };
}
export async function removeTable(user, id) {
  const t = await one('delete from dining_table where id=$1 returning *', [id]); if (!t) throw notFound();
  await audit(user, t.event_id, 'Tables', 'removed', `Table ${t.number}`);
  return { ok: true };
}
export async function addGuests(user, eventId, rows) {
  const ev = await resolveEvent(eventId);
  if (!Array.isArray(rows) || !rows.length) throw bad('No guests to add');
  let n = 0;
  for (const r of rows.slice(0, 2000)) {
    const name = str(r.name || [r.first_name, r.last_name].filter(Boolean).join(' '), 200);
    if (!name && !r.organisation) continue;
    await q('insert into guest (event_id, name, organisation, booking_ref, dietary, access, source) values ($1,$2,$3,$4,$5,$6,$7)',
      [ev.id, name, str(r.organisation || r.company, 200) || null, str(r.booking_ref, 100) || null, str(r.dietary, 300) || null, str(r.access, 300) || null, r.source === 'csv' ? 'csv' : 'manual']);
    n++;
  }
  await audit(user, ev.id, 'Guests', 'added', `${n} guest${n === 1 ? '' : 's'}`);
  return { added: n };
}
export async function updateGuest(user, id, b) {
  const g = await one('select * from guest where id=$1', [id]); if (!g) throw notFound();
  const v = (k, max) => (b[k] != null ? (str(b[k], max) || null) : g[k]);
  await q('update guest set name=$2, organisation=$3, dietary=$4, access=$5 where id=$1', [id, v('name', 200) || '', v('organisation', 200), v('dietary', 300), v('access', 300)]);
  await audit(user, g.event_id, 'Guests', 'changed', g.name || 'Guest');
  return { ok: true };
}
export async function removeGuest(user, id) {
  const g = await one('delete from guest where id=$1 returning *', [id]); if (!g) throw notFound();
  await audit(user, g.event_id, 'Guests', 'removed', g.name || 'Guest');
  return { ok: true };
}
export async function seat(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const g = await one('select * from guest where id=$1 and event_id=$2', [b.guest_id, ev.id]); if (!g) throw bad('Unknown guest');
  if (!b.table_id) { await q('delete from seating where guest_id=$1', [g.id]); return { ok: true }; }
  const t = await one(`select t.*, (select count(*)::int from seating s where s.table_id=t.id and s.guest_id<>$2) used from dining_table t where t.id=$1 and t.event_id=$3`, [b.table_id, g.id, ev.id]);
  if (!t) throw bad('Unknown table');
  if (t.used >= t.seats) throw bad(`Table ${t.number} is full`);
  await q('insert into seating (guest_id, table_id) values ($1,$2) on conflict (guest_id) do update set table_id=excluded.table_id', [g.id, t.id]);
  return { ok: true };
}
// Keep each organisation together: biggest party first into the table with the
// most room that fits them whole; parties bigger than a table fill whole tables.
export async function autoSeat(user, eventId) {
  const data = await getTables(eventId);
  const room = new Map(data.tables.map(t => [t.id, t.seats - data.guests.filter(g => g.table_id === t.id).length]));
  const groups = new Map();
  for (const g of data.guests.filter(g => !g.table_id)) { const k = (g.organisation || g.name || '').toLowerCase(); (groups.get(k) || groups.set(k, []).get(k)).push(g); }
  const order = [...groups.values()].sort((a, b) => b.length - a.length);
  const moves = []; const unseated = [];
  for (const grp of order) {
    let left = [...grp];
    while (left.length) {
      const fits = [...room.entries()].filter(([, r]) => r >= left.length).sort((a, b) => a[1] - b[1])[0];
      const target = fits || [...room.entries()].filter(([, r]) => r > 0).sort((a, b) => b[1] - a[1])[0];
      if (!target) { unseated.push(...left); break; }
      const take = left.splice(0, target[1]);
      take.forEach(g => moves.push([g.id, target[0]]));
      room.set(target[0], target[1] - take.length);
    }
  }
  if (moves.length) await tx(moves.map(([gid, tid]) => ['insert into seating (guest_id, table_id) values ($1,$2) on conflict (guest_id) do update set table_id=excluded.table_id', [gid, tid]]));
  await audit(user, data.event.id, 'Tables', 'changed', `Auto-seated ${moves.length} guests`);
  return { seated: moves.length, unseated: unseated.length };
}
