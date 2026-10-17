// Sponsors come from the Mash Ledger. Ops keeps its own manual additions
// (flagged ledger_ref = null) and never edits a Ledger row's company or tier.
//
// Needs LEDGER_API_URL + LEDGER_API_KEY (a key scoped to ops-sponsors:read).
// Expected Ledger endpoint (to add in MASH-LEDGER): GET /api/v1/ops-sponsors?entry=<calendar id>
//   → { sponsors: [{ ref, company, tier, contact_name, contact_email }] }
import { q, one } from './db.mjs';
import { bad, notFound, str } from './http.mjs';
import { audit } from './audit.mjs';
import { resolveEvent } from './events.mjs';

export const ledgerConfigured = () => !!(process.env.LEDGER_API_URL && process.env.LEDGER_API_KEY);

export async function listSponsors(eventId) {
  const ev = await resolveEvent(eventId);
  const sponsors = await q('select * from sponsor where event_id=$1 and removed_at is null order by company', [ev.id]);
  const last = await one("select finished_at, ok, error, counts from sync_run where source='ledger' and counts->>'event' = $1 order by started_at desc limit 1", [ev.id]);
  return { sponsors, ledger: { configured: ledgerConfigured(), lastSync: last } };
}

export async function syncLedgerSponsors(eventId) {
  const ev = await resolveEvent(eventId);
  if (!ledgerConfigured()) throw bad('The Ledger is not connected yet (LEDGER_API_URL / LEDGER_API_KEY).');
  const run = await one("insert into sync_run (source, counts) values ('ledger', $1) returning id", [JSON.stringify({ event: ev.id })]);
  try {
    const url = `${process.env.LEDGER_API_URL.replace(/\/$/, '')}/api/v1/ops-sponsors?entry=${encodeURIComponent(ev.id)}`;
    const r = await fetch(url, { headers: { 'x-mash-key': process.env.LEDGER_API_KEY }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Ledger ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const list = ((await r.json()).sponsors || []).filter(s => s && s.ref && s.company);
    const seen = [];
    for (const s of list) {
      await q(`insert into sponsor (event_id, company, tier, ledger_ref, contact_name, contact_email, synced_at, removed_at) values ($1,$2,$3,$4,$5,$6,now(),null)
               on conflict (event_id, ledger_ref) do update set company=excluded.company, tier=excluded.tier, contact_name=excluded.contact_name,
                 contact_email=excluded.contact_email, synced_at=now(), removed_at=null`,
        [ev.id, str(s.company, 200), str(s.tier, 60) || null, String(s.ref), str(s.contact_name, 200) || null, str(s.contact_email, 200) || null]);
      seen.push(String(s.ref));
    }
    // Gone from the Ledger (cancelled, moved): mark removed, never delete.
    const gone = await q('update sponsor set removed_at=now() where event_id=$1 and ledger_ref is not null and removed_at is null and not (ledger_ref = any($2)) returning id', [ev.id, seen]);
    await q('update sync_run set finished_at=now(), ok=true, counts=$2 where id=$1', [run.id, JSON.stringify({ event: ev.id, sponsors: list.length, removed: gone.length })]);
    return { sponsors: list.length, removed: gone.length };
  } catch (e) {
    await q('update sync_run set finished_at=now(), ok=false, error=$2 where id=$1', [run.id, String(e.message || e)]);
    throw e;
  }
}

export async function addManualSponsor(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const company = str(b.company, 200); if (!company) throw bad('Company is required');
  const row = await one('insert into sponsor (event_id, company, tier, contact_name, contact_email) values ($1,$2,$3,$4,$5) returning *',
    [ev.id, company, str(b.tier, 60) || null, str(b.contact_name, 200) || null, str(b.contact_email, 200) || null]);
  await audit(user, ev.id, 'Sponsors', 'added', `${company} (manual)`);
  return { sponsor: row };
}
export async function removeSponsor(user, id) {
  const s = await one('select * from sponsor where id=$1', [id]); if (!s) throw notFound();
  if (s.ledger_ref) throw bad('This sponsor comes from the Ledger — change it there.');
  await q('update sponsor set removed_at=now() where id=$1', [id]);
  await audit(user, s.event_id, 'Sponsors', 'removed', s.company);
  return { ok: true };
}
