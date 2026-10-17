// 100 leaderboards. Points are entries — who, what for, when, by whom — and a
// total is only ever their sum, so "who has points and for what" is answerable.
import { q, one } from './db.mjs';
import { bad, notFound, str, int, isDay } from './http.mjs';
import { audit } from './audit.mjs';
import { upsertPerson, fullName } from './rota.mjs';

export function currentSeason(d = new Date()) {                  // financial year, 1 Apr – 31 Mar
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const s = m >= 3 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
const SEASON = /^\d{4}-\d{2}$/;
async function prog(id) { const p = await one('select * from programme where id=$1', [id]); if (!p) throw notFound('Unknown programme'); return p; }

export async function programmes() {
  const progs = await q('select * from programme order by sort');
  const seasons = await q(`select programme_id, season from (select programme_id, season from points_entry union select programme_id, season from programme_member
     union select programme_id, season from points_rule) x group by 1,2 order by 2 desc`);
  return { programmes: progs, seasons, current: currentSeason() };
}

function rankRows(rows) {
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  let last = null, rank = 0;
  rows.forEach((r, i) => { if (r.points !== last) { rank = i + 1; last = r.points; } r.rank = rank; });
  const counts = rows.reduce((m, r) => (m[r.rank] = (m[r.rank] || 0) + 1, m), {});
  rows.forEach(r => { r.rankLabel = counts[r.rank] > 1 ? `${r.rank}=` : String(r.rank); });
  return rows;
}

export async function leaderboard(programmeId, season) {
  const p = await prog(programmeId);
  if (!SEASON.test(season)) throw bad('Season looks like 2026-27');
  const rows = await q(`
    with people as (select person_id from programme_member where programme_id=$1 and season=$2
                    union select person_id from points_entry where programme_id=$1 and season=$2)
    select pe.id person_id, pe.first_name, pe.last_name, pe.email, pe.organisation, pe.job_title,
      coalesce(sum(e.points),0)::int points,
      coalesce(sum(e.points) filter (where e.on_date >= date_trunc('month', current_date)),0)::int month_points,
      coalesce(sum(e.points) filter (where e.on_date < current_date - 30),0)::int points_30d_ago,
      count(e.id)::int entries
    from people pp join person pe on pe.id=pp.person_id
    left join points_entry e on e.person_id=pe.id and e.programme_id=$1 and e.season=$2
    group by pe.id`, [p.id, season]);
  rows.forEach(r => { r.name = fullName(r); });
  const before = rankRows(rows.map(r => ({ person_id: r.person_id, name: r.name, points: r.points_30d_ago })));
  const prev = new Map(before.map(r => [r.person_id, r.rank]));
  // Movement only means something for people who had points a month ago.
  rankRows(rows).forEach(r => { r.move = r.points_30d_ago > 0 && prev.has(r.person_id) ? prev.get(r.person_id) - r.rank : 0; });
  const rules = await q('select * from points_rule where programme_id=$1 and season=$2 order by points desc, activity', [p.id, season]);
  return { programme: p, season, rows, rules };
}

export async function memberEntries(programmeId, season, personId) {
  const person = await one('select * from person where id=$1', [personId]); if (!person) throw notFound();
  const entries = await q(`select e.*, ev.short_name event_name from points_entry e left join event ev on ev.id=e.event_id
     where e.programme_id=$1 and e.season=$2 and e.person_id=$3 order by e.on_date desc, e.created_at desc`, [programmeId, season, personId]);
  const byActivity = {};
  for (const e of entries) byActivity[e.activity] = (byActivity[e.activity] || 0) + e.points;
  return { person: { ...person, name: fullName(person) }, entries, byActivity, total: entries.reduce((n, e) => n + e.points, 0) };
}

export async function awardPoints(user, programmeId, season, b) {
  const p = await prog(programmeId);
  if (!SEASON.test(season)) throw bad('Season looks like 2026-27');
  const activity = str(b.activity, 120); if (!activity) throw bad('What are the points for?');
  let points = b.points === '' || b.points == null ? null : int(b.points, NaN);
  if (points == null) {
    const r = await one('select points from points_rule where programme_id=$1 and season=$2 and lower(activity)=lower($3)', [p.id, season, activity]);
    if (!r) throw bad(`No rule for "${activity}" this season — enter the points`);
    points = r.points;
  }
  if (!Number.isFinite(points)) throw bad('Points must be a whole number');
  const person = b.person_id ? await one('select * from person where id=$1', [b.person_id]) : await upsertPerson(b);
  if (!person) throw bad('Unknown person');
  const row = await one(`insert into points_entry (programme_id, season, person_id, activity, points, on_date, event_id, note, awarded_by, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [p.id, season, person.id, activity, points, isDay(b.on_date) ? b.on_date : new Date().toISOString().slice(0, 10), b.event_id || null, str(b.note, 500) || null, user.email, b.source || 'manual']);
  await q('insert into programme_member (programme_id, season, person_id) values ($1,$2,$3) on conflict do nothing', [p.id, season, person.id]);
  if (!user.quiet) await audit(user, null, 'Leaderboards', 'added', `${points} pts to ${fullName(person)} — ${activity}`, { programme: p.id, season });
  return { entry: row };
}

// Opening balances from the old Google Sheets: one entry per member carrying their total.
export async function importBalances(user, programmeId, season, rows) {
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows');
  let n = 0; const errors = [];
  for (const [i, r] of rows.entries()) {
    try {
      if (!r.email) throw new Error('no email');
      const pts = int(r.points, NaN); if (!Number.isFinite(pts)) throw new Error('points missing');
      // Dated to the season's start so it never shows as "this month".
      await awardPoints({ ...user, quiet: true }, programmeId, season, { ...r, points: pts, on_date: `${season.slice(0, 4)}-04-01`, activity: 'Opening balance (imported from the Google Sheet)', source: 'import', note: 'The sheet only held a total, so no breakdown.' });
      n++;
    } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
  }
  await audit(user, null, 'Leaderboards', 'added', `${n} opening balances imported`, { programme: programmeId, season });
  return { imported: n, errors };
}

export async function removeEntry(user, id) {
  const e = await one('delete from points_entry where id=$1 returning *', [id]); if (!e) throw notFound();
  await audit(user, null, 'Leaderboards', 'removed', `${e.points} pts — ${e.activity}`, { programme: e.programme_id, person_id: e.person_id });
  return { ok: true };
}

export async function putRules(user, programmeId, season, rules) {
  await prog(programmeId);
  if (!SEASON.test(season)) throw bad('Season looks like 2026-27');
  if (!Array.isArray(rules)) throw bad('rules must be a list');
  await q('delete from points_rule where programme_id=$1 and season=$2', [programmeId, season]);
  for (const r of rules) {
    const a = str(r.activity, 120), pts = int(r.points, NaN);
    if (a && Number.isFinite(pts)) await q('insert into points_rule (programme_id, season, activity, points) values ($1,$2,$3,$4) on conflict do nothing', [programmeId, season, a, pts]);
  }
  await audit(user, null, 'Leaderboards', 'changed', `Scoring rules ${programmeId} ${season}`, { rules });
  return { ok: true };
}
