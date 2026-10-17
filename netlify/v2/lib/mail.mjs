// Outbox: anything that sends writes a row here; the outbox-tick scheduled
// function sends them through Microsoft Graph at a pace Exchange accepts.
import { q, one } from './db.mjs';
import { bad } from './http.mjs';
import { audit } from './audit.mjs';
import { resolveEvent } from './events.mjs';
import { personSchedule, credentialFor, fullName } from './rota.mjs';
import { londonTime, londonDate, londonDay } from './time.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PURPLE = '#574596';

// One person's schedule as an email. Only their OWN Grip login is ever included.
export function scheduleEmail(ev, person, sched, cred) {
  const byDay = new Map();
  for (const a of sched.shifts) { const d = londonDay(a.starts_at); (byDay.get(d) || byDay.set(d, []).get(d)).push(a); }
  const sessionsFor = (a) => sched.sessions.filter(s => s.theatre_id === a.theatre_id && s.starts_at < a.ends_at && s.ends_at > a.starts_at);
  const days = [...byDay.entries()].map(([d, list]) => `
    <tr><td style="padding:18px 0 6px;font:700 15px/1.3 Arial,sans-serif;color:#1A1C21">${esc(londonDate(d + 'T12:00:00Z'))}</td></tr>
    ${list.map(a => `<tr><td style="padding:10px 14px;border-radius:10px;background:${a.kind === 'break' ? '#FFF4E0' : '#F3F1FA'};font:14px/1.45 Arial,sans-serif;color:#1A1C21">
      <strong>${londonTime(a.starts_at)}–${londonTime(a.ends_at)}</strong> &nbsp;${a.kind === 'break' ? 'Break' : `${esc(a.theatre || 'Floor')} · ${esc(a.role || 'Crew')}`}
      ${a.kind === 'work' && sessionsFor(a).length ? `<div style="margin-top:6px;color:#4A4D55;font-size:13px">${sessionsFor(a).map(s => `${londonTime(s.starts_at)} ${esc(s.title)}`).join('<br>')}</div>` : ''}
    </td></tr><tr><td style="height:6px"></td></tr>`).join('')}`).join('');
  const login = cred ? `<tr><td style="padding:16px 18px;border:1px solid #E4E1DA;border-radius:12px;font:14px/1.5 Arial,sans-serif;color:#1A1C21">
      <div style="font-weight:700;margin-bottom:4px">Your Grip app login</div>
      Username: <strong>${esc(cred.username)}</strong><br>${cred.password ? `Password: <strong>${esc(cred.password)}</strong><br>` : ''}
      <span style="color:#5E616B;font-size:12px">This login is just for you, so your scans are tracked to you. Please don't share it.</span></td></tr>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#F5F4F0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F0;padding:24px 0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden">
    <tr><td style="background:${PURPLE};padding:26px 28px;color:#FFFFFF;font:700 13px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase">Mash Media · ${esc(ev.short_name || ev.name)}
      <div style="font:800 26px/1.2 Arial,sans-serif;letter-spacing:0;text-transform:none;margin-top:6px">Your schedule</div></td></tr>
    <tr><td style="padding:24px 28px 8px;font:15px/1.55 Arial,sans-serif;color:#1A1C21">Hi ${esc(person.first_name || fullName(person))},<br>here is where you're needed at <strong>${esc(ev.name)}</strong>${ev.venue ? `, ${esc(ev.venue)}` : ''}.</td></tr>
    <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${days || '<tr><td style="font:14px Arial,sans-serif;color:#5E616B;padding:12px 0">No shifts yet.</td></tr>'}</table></td></tr>
    ${login ? `<tr><td style="padding:18px 28px 0"><table role="presentation" width="100%">${login}</table></td></tr>` : ''}
    ${ev.ops_notes ? `<tr><td style="padding:18px 28px 0;font:14px/1.55 Arial,sans-serif;color:#1A1C21"><div style="font-weight:700;margin-bottom:4px">Event information</div>${esc(ev.ops_notes).replace(/\n/g, '<br>')}</td></tr>` : ''}
    <tr><td style="padding:24px 28px 28px;font:12px/1.5 Arial,sans-serif;color:#5E616B">If anything changes we'll send you an updated schedule. Questions? Reply to this email.</td></tr>
  </table></td></tr></table></body></html>`;
  return { subject: `Your schedule — ${ev.short_name || ev.name}`, html };
}

export async function queueSchedules(user, eventId, personIds) {
  const ev = await resolveEvent(eventId);
  if (!Array.isArray(personIds) || !personIds.length) throw bad('Choose who to send to');
  let queued = 0; const skipped = [];
  for (const pid of personIds.slice(0, 500)) {
    const p = await one('select * from person where id=$1', [pid]);
    if (!p) continue;
    if (!p.email) { skipped.push(`${fullName(p)} — no email`); continue; }
    const s = await personSchedule(ev, pid);
    if (!s.shifts.length) { skipped.push(`${fullName(p)} — no shifts`); continue; }
    const { subject, html } = scheduleEmail(ev, p, s, await credentialFor(ev, pid));
    await q(`insert into outbox (kind, event_id, person_id, to_email, subject, html, fingerprint, created_by) values ('schedule',$1,$2,$3,$4,$5,$6,$7)`,
      [ev.id, pid, p.email, subject, html, s.fingerprint, user.email]);
    queued++;
  }
  await audit(user, ev.id, 'Schedules', 'sent', `${queued} schedule email${queued === 1 ? '' : 's'} queued`, { skipped });
  return { queued, skipped };
}

// ---------------------------------------------------------------- Graph sender
let _tok = null, _exp = 0;
async function graphToken() {
  if (_tok && Date.now() < _exp - 60000) return _tok;
  const { TENANT_ID, OPS_GRAPH_CLIENT_ID, OPS_GRAPH_CLIENT_SECRET } = process.env;
  if (!TENANT_ID || !OPS_GRAPH_CLIENT_ID || !OPS_GRAPH_CLIENT_SECRET) throw new Error('Graph credentials not set (TENANT_ID / OPS_GRAPH_CLIENT_ID / OPS_GRAPH_CLIENT_SECRET).');
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, { method: 'POST',
    body: new URLSearchParams({ client_id: OPS_GRAPH_CLIENT_ID, client_secret: OPS_GRAPH_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) });
  if (!r.ok) throw new Error('Graph token ' + r.status);
  const j = await r.json(); _tok = j.access_token; _exp = Date.now() + j.expires_in * 1000; return _tok;
}

// Sends up to `max` queued emails. Called every minute by outbox-tick.
export async function drainOutbox(max = 20) {
  const sender = process.env.OPS_MAIL_SENDER;
  if (!sender) return { sent: 0, note: 'OPS_MAIL_SENDER not set' };
  if (process.env.OPS_MAIL_DRY_RUN === '1') return { sent: 0, note: 'dry run' };
  const batch = await q(`update outbox set status='sending', attempts=attempts+1 where id in (
      select id from outbox where status='queued' or (status='failed' and attempts < 3) order by created_at limit $1 for update skip locked) returning *`, [max]);
  let sent = 0;
  for (const m of batch) {
    try {
      const tok = await graphToken();
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, { method: 'POST',
        headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { subject: m.subject, body: { contentType: 'HTML', content: m.html }, toRecipients: [{ emailAddress: { address: m.to_email } }] }, saveToSentItems: true }) });
      if (!r.ok) throw new Error(`sendMail ${r.status}: ${(await r.text()).slice(0, 200)}`);
      await q("update outbox set status='sent', sent_at=now(), last_error=null where id=$1", [m.id]);
      if (m.kind === 'schedule' && m.person_id) await q('insert into schedule_send (event_id, person_id, fingerprint, outbox_id) values ($1,$2,$3,$4)', [m.event_id, m.person_id, m.fingerprint, m.id]);
      sent++;
    } catch (e) {
      await q("update outbox set status='failed', last_error=$2 where id=$1", [m.id, String(e.message || e).slice(0, 500)]);
    }
  }
  return { sent, tried: batch.length };
}
