// On the day: check-in ticks and the kit register.
import { q, one } from './db.mjs';
import { bad, notFound, str, isDay } from './http.mjs';
import { audit } from './audit.mjs';
import { resolveEvent } from './events.mjs';
import { londonToUtc, londonDay } from './time.mjs';
import { fullName } from './rota.mjs';

export async function checkinList(eventId, day) {
  const ev = await resolveEvent(eventId);
  const d = isDay(day) ? day : (ev.days.includes(londonDay(new Date())) ? londonDay(new Date()) : ev.days[0]);
  const from = londonToUtc(d, '00:00').toISOString(), to = londonToUtc(d, '23:59').toISOString();
  const people = await q(`
    select p.id, p.first_name, p.last_name, p.email, p.phone, c.kind,
      (select min(a.starts_at) from assignment a where a.event_id=c.event_id and a.person_id=p.id and a.kind='work' and a.starts_at between $2 and $3) first_start,
      (select string_agg(distinct coalesce(t.name,'Floor'), ', ') from assignment a left join theatre t on t.id=a.theatre_id
         where a.event_id=c.event_id and a.person_id=p.id and a.kind='work' and a.starts_at between $2 and $3) theatres,
      (select string_agg(distinct r.name, ', ') from assignment a join crew_role r on r.id=a.role_id
         where a.event_id=c.event_id and a.person_id=p.id and a.kind='work' and a.starts_at between $2 and $3) roles,
      (select ch.present from checkin ch where ch.event_id=c.event_id and ch.person_id=p.id and ch.day=$4 order by ch.at desc limit 1) present,
      (select ch.at from checkin ch where ch.event_id=c.event_id and ch.person_id=p.id and ch.day=$4 and ch.present order by ch.at desc limit 1) checked_at
    from crew_member c join person p on p.id=c.person_id where c.event_id=$1 order by first_start nulls last, p.first_name`, [ev.id, from, to, d]);
  const loans = await q(`select l.person_id, i.sticker, i.kind from kit_loan l join kit_item i on i.id=l.item_id where l.event_id=$1 and l.returned_at is null`, [ev.id]);
  const now = Date.now();
  for (const p of people) {
    p.name = fullName(p);
    p.present = !!p.present;
    p.late = !p.present && p.first_start && +new Date(p.first_start) < now && londonDay(new Date()) === d;
    p.kit = loans.filter(l => l.person_id === p.id).map(l => `${l.kind} #${l.sticker}`);
  }
  const scheduled = people.filter(p => p.first_start);
  return { event: ev, day: d, people, counts: { total: people.length, scheduled: scheduled.length, here: people.filter(p => p.present).length, late: people.filter(p => p.late).length } };
}

// Batch from a tablet, possibly replayed after being offline. client_id makes replays harmless.
export async function recordCheckins(user, eventId, items) {
  const ev = await resolveEvent(eventId);
  if (!Array.isArray(items) || !items.length) throw bad('Nothing to record');
  let saved = 0;
  for (const it of items.slice(0, 500)) {
    const cid = str(it.client_id, 80); if (!cid) continue;
    if (!isDay(it.day)) continue;
    const at = new Date(it.at && !Number.isNaN(+new Date(it.at)) ? it.at : Date.now());
    const r = await q(`insert into checkin (client_id, event_id, person_id, day, present, at, by_user) values ($1,$2,$3,$4,$5,$6,$7)
                       on conflict (client_id) do nothing returning id`, [cid, ev.id, it.person_id, it.day, !!it.present, at.toISOString(), user.email]);
    if (r.length) saved++;
  }
  if (saved) await audit(user, ev.id, 'Check-in', 'checked-in', `${saved} tick${saved === 1 ? '' : 's'} recorded`);
  return { saved, received: items.length };
}

// ---------------------------------------------------------------- kit
export async function kitList(eventId) {
  const items = await q(`select i.*, l.id loan_id, l.issued_at, l.issued_by, l.event_id loan_event, p.id person_id, p.first_name, p.last_name, p.email
     from kit_item i left join kit_loan l on l.item_id=i.id and l.returned_at is null left join person p on p.id=l.person_id
     where not i.retired order by i.kind, length(i.sticker), i.sticker`);
  for (const i of items) i.holder = i.person_id ? fullName(i) : null;
  const history = eventId ? await q(`select l.*, i.sticker, i.kind, p.first_name, p.last_name, p.email from kit_loan l join kit_item i on i.id=l.item_id
     join person p on p.id=l.person_id where l.event_id=(select e.id from event e left join event_alias a on a.event_id=e.id where e.id=$1 or a.legacy_id=$1 limit 1)
     order by l.issued_at desc limit 300`, [eventId]) : [];
  for (const h of history) h.holder = fullName(h);
  return { items, history };
}
export async function addKit(user, b) {
  const sticker = str(b.sticker, 30); if (!sticker) throw bad('Sticker number is required');
  const kind = str(b.kind, 30).toLowerCase() || 'other';
  const row = await one(`insert into kit_item (sticker, kind, label) values ($1,$2,$3) on conflict (sticker) do update set kind=excluded.kind, label=excluded.label, retired=false returning *`,
    [sticker, kind, str(b.label, 100) || null]);
  await audit(user, null, 'Kit', 'added', `${kind} #${sticker}`);
  return { item: row };
}
export async function issueKit(user, itemId, b) {
  const ev = await resolveEvent(b.event_id);
  const item = await one('select * from kit_item where id::text=$1 or sticker=$1', [String(itemId)]); if (!item) throw notFound('No kit with that sticker');
  const open = await one('select l.*, p.first_name, p.last_name, p.email from kit_loan l join person p on p.id=l.person_id where l.item_id=$1 and l.returned_at is null', [item.id]);
  if (open) throw bad(`#${item.sticker} is already out with ${fullName(open)} — return it first`);
  const p = await one('select * from person where id=$1', [b.person_id]); if (!p) throw bad('Unknown person');
  await q('insert into kit_loan (item_id, event_id, person_id, issued_by, note) values ($1,$2,$3,$4,$5)', [item.id, ev.id, p.id, user.email, str(b.note, 200) || null]);
  await audit(user, ev.id, 'Kit', 'added', `${item.kind} #${item.sticker} issued to ${fullName(p)}`);
  return { ok: true };
}
export async function returnKit(user, itemId) {
  const l = await one(`update kit_loan l set returned_at=now(), returned_by=$2 from kit_item i
     where i.id=l.item_id and (i.id::text=$1 or i.sticker=$1) and l.returned_at is null returning l.*, i.sticker, i.kind`, [String(itemId), user.email]);
  if (!l) throw bad('That item is not out');
  await audit(user, l.event_id, 'Kit', 'removed', `${l.kind} #${l.sticker} returned`);
  return { ok: true };
}
