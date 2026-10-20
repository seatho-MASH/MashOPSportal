import { q, one } from './db.mjs';
import { notFound, bad, str } from './http.mjs';
import { requireAdmin } from './auth.mjs';
import { audit } from './audit.mjs';
import { eventDays, isoDate } from './time.mjs';

const CAL_URL = process.env.CAL_FEED_URL || 'https://mashportal.netlify.app/api/calendar';
const KINDS = ['show', 'summit', 'awards', 'lunch', 'other'];
const SHOW_IDS = /^(eps-event-production-show|cfx-international-confex|pas-the-pa-show)/i;

export function guessKind(e) {
  const n = `${e.fullName || ''} ${e.name || ''}`.toLowerCase();
  if (SHOW_IDS.test(e.id) || /production show|international confex|pa show spring/.test(n)) return 'show';
  if (/award|epa\b/.test(n)) return 'awards';
  if (/lunch|dinner|dining club/.test(n)) return 'lunch';
  if (/summit|masterclass|launch club|conference/.test(n)) return 'summit';
  return 'other';
}

// Calendar → event table. Never touches the ops_* columns or kind once set.
export async function syncCalendar() {
  const run = await one("insert into sync_run (source) values ('calendar') returning id");
  try {
    const r = await fetch(CAL_URL, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('calendar feed ' + r.status);
    const d = await r.json();
    const evs = (d.events || []).filter(e => e && e.id && !e.isSales && !e.isPrint && e.start);
    if (evs.length < 5) throw new Error(`calendar returned only ${evs.length} events — not applied`);
    let n = 0;
    for (const e of evs) {
      await q(`insert into event (id, series_id, edition, portfolio, name, short_name, starts_on, ends_on, venue, cancelled, provisional, kind, rooms_total, build_days, breakdown_days, synced_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
               on conflict (id) do update set series_id=excluded.series_id, edition=excluded.edition, portfolio=excluded.portfolio,
                 name=excluded.name, short_name=excluded.short_name, starts_on=excluded.starts_on, ends_on=excluded.ends_on,
                 venue=excluded.venue, cancelled=excluded.cancelled, provisional=excluded.provisional, rooms_total=excluded.rooms_total, build_days=excluded.build_days, breakdown_days=excluded.breakdown_days, synced_at=now()`,
        [e.id, e.seriesId || null, e.edition || null, e.portfolio || null, e.fullName || e.name, e.name || null,
         e.start, e.end || e.start, e.location || null, !!e.cancelled, !!e.dateProvisional, guessKind(e),
         e.roomsTotal == null || e.roomsTotal === '' ? null : (parseInt(e.roomsTotal, 10) || 0),
         parseInt(e.buildDays, 10) || 0, parseInt(e.breakdownDays, 10) || 0]);
      n++;
    }
    await q('select ops_seed_aliases()');
    await q('update sync_run set finished_at=now(), ok=true, counts=$2 where id=$1', [run.id, JSON.stringify({ events: n })]);
    return { ok: true, events: n };
  } catch (e) {
    await q('update sync_run set finished_at=now(), ok=false, error=$2 where id=$1', [run.id, String(e.message || e)]);
    throw e;
  }
}

export async function resolveEvent(id) {
  const ev = await one(`select e.* from event e left join event_alias a on a.event_id = e.id
                        where e.id = $1 or a.legacy_id = $1 limit 1`, [id]);
  if (!ev) throw notFound('Unknown event: ' + id);
  ev.starts_on = isoDate(ev.starts_on); ev.ends_on = isoDate(ev.ends_on);
  ev.days = eventDays(ev);
  return ev;
}

export async function listEvents(user, all) {
  const rows = await q(`select id, name, short_name, portfolio, starts_on, ends_on, venue, cancelled, provisional, kind, ops_enabled, ops_ji, ops_reg_code, rooms_total
                        from event ${all ? '' : 'where ops_enabled'} order by starts_on nulls last, name`);
  for (const r of rows) { r.starts_on = isoDate(r.starts_on); r.ends_on = isoDate(r.ends_on); }
  const last = await one("select finished_at, ok, error from sync_run where source='calendar' order by started_at desc limit 1");
  return { events: rows, calendarSync: last };
}

export async function updateEvent(user, id, b) {
  requireAdmin(user);
  const ev = await resolveEvent(id);
  const kind = b.kind != null ? str(b.kind, 20) : ev.kind;
  if (!KINDS.includes(kind)) throw bad('kind must be one of ' + KINDS.join(', '));
  const enabled = b.ops_enabled != null ? !!b.ops_enabled : ev.ops_enabled;
  const ji = b.ops_ji != null ? (str(b.ops_ji, 200) || null) : ev.ops_ji;
  const notes = b.ops_notes != null ? (str(b.ops_notes, 2000) || null) : ev.ops_notes;
  const reg = b.ops_reg_code != null ? (str(b.ops_reg_code, 10).toUpperCase() || null) : ev.ops_reg_code;
  if (reg && !['CFX', 'EPS', 'PAS'].includes(reg)) throw bad('Registration code must be CFX, EPS or PAS');
  await q('update event set kind=$2, ops_enabled=$3, ops_ji=$4, ops_notes=$5, ops_reg_code=$6 where id=$1', [ev.id, kind, enabled, ji, notes, reg]);
  await audit(user, ev.id, 'Admin', 'changed', 'Event settings', { kind, ops_enabled: enabled, ops_ji: ji, ops_reg_code: reg });
  return { ok: true };
}

export async function history(id) {
  const ev = await resolveEvent(id);
  return { entries: await q('select at, actor, area, action, item, detail from audit_log where event_id=$1 order by at desc limit 500', [ev.id]) };
}
