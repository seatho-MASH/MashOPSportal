// Event home: key numbers and the "needs attention" list, all computed live.
import { q, one } from './db.mjs';
import { resolveEvent } from './events.mjs';
import { getRota, scheduleStatus } from './rota.mjs';
import { londonDay } from './time.mjs';
import { ledgerConfigured } from './sponsors.mjs';

export async function eventHome(eventId) {
  const ev = await resolveEvent(eventId);
  const today = londonDay(new Date());
  const [crew, sponsors, guests, tables, kitOut, theatres] = await Promise.all([
    q(`select kind, count(*)::int n from crew_member where event_id=$1 group by kind`, [ev.id]),
    q(`select (ledger_ref is null) manual, count(*)::int n from sponsor where event_id=$1 and removed_at is null group by 1`, [ev.id]),
    one(`select count(*)::int n, count(s.guest_id)::int seated from guest g left join seating s on s.guest_id=g.id where g.event_id=$1`, [ev.id]),
    one(`select count(*)::int n from dining_table where event_id=$1`, [ev.id]),
    one(`select count(*)::int n from kit_loan where event_id=$1 and returned_at is null`, [ev.id]),
    one(`select count(*)::int n from theatre where event_id=$1`, [ev.id])
  ]);
  const crewN = crew.reduce((n, r) => n + r.n, 0);
  const out = {
    event: ev,
    daysToGo: ev.starts_on ? Math.round((Date.parse(ev.starts_on) - Date.parse(today)) / 86400000) : null,
    numbers: {
      crew: { total: crewN, staff: (crew.find(r => r.kind === 'staff') || {}).n || 0, volunteers: (crew.find(r => r.kind === 'volunteer') || {}).n || 0 },
      sponsors: { total: sponsors.reduce((n, r) => n + r.n, 0), manual: (sponsors.find(r => r.manual) || {}).n || 0, ledgerConnected: ledgerConfigured() },
      guests: { total: guests.n, seated: guests.seated, tables: tables.n },
      kitOut: kitOut.n, theatres: theatres.n
    },
    attention: [], theatreCover: []
  };
  if (theatres.n && ev.days.length) {
    let gapCount = 0;
    const byTheatre = new Map();
    for (const day of ev.days) {
      const r = await getRota(ev.id, day);
      for (const t of r.theatres) if (!byTheatre.has(t.id)) byTheatre.set(t.id, { name: t.name, gaps: 0 });
      for (const g of r.gaps) { gapCount++; byTheatre.get(g.theatre_id).gaps++; if (out.attention.length < 6) out.attention.push({ type: 'gap', title: `${g.theatre} needs ${g.short} more ${g.role.toLowerCase()}`, day, from: g.from, to: g.to, free: g.free.length }); }
    }
    out.theatreCover = [...byTheatre.values()];
    out.numbers.gaps = gapCount;
    const sched = (await scheduleStatus(ev.id)).people;
    const changed = sched.filter(p => p.status === 'changed').length, never = sched.filter(p => p.status === 'never-sent').length;
    if (changed) out.attention.push({ type: 'moved', title: `${changed} ${changed === 1 ? 'person needs' : 'people need'} an updated schedule`, detail: 'Their shifts or sessions changed after their schedule went out' });
    if (never) out.attention.push({ type: 'send', title: `${never} crew haven't had their schedule yet`, detail: "Each email includes that person's own Grip login only" });
  }
  const noAtt = sponsors.length ? (await one(`select count(*)::int n from sponsor s where s.event_id=$1 and s.removed_at is null
      and not exists (select 1 from guest g where g.event_id=s.event_id and lower(g.organisation)=lower(s.company))`, [ev.id])).n : 0;
  if (noAtt && ev.kind !== 'show') out.attention.push({ type: 'ledger', title: `${noAtt} sponsor${noAtt === 1 ? ' has' : 's have'} no guests listed yet`, detail: 'From the sponsor list' });
  return out;
}
