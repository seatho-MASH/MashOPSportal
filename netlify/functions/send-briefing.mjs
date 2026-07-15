import { graphToken, eventFromSharePoint, sendMail } from './_graph.mjs';

const SENDER = process.env.OPS_MAIL_SENDER; // mailbox the briefing is sent from

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const icsEsc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const hhmm = t => { const m = String(t || '').match(/(\d{1,2})\D?(\d{2})/); return m ? String(m[1]).padStart(2, '0') + m[2] : null; };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

const icsDate = d => (d || '').slice(0, 10).replace(/-/g, '');
function dAdd(d, n) { const x = new Date((d || '').slice(0, 10) + 'T00:00:00Z'); if (isNaN(x.getTime())) return (d || '').slice(0, 10); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function vevent(uid, dtStart, dtEnd, summary, ev) {
  return [
    'BEGIN:VEVENT', 'UID:' + uid + '@mashmedia.net', 'DTSTAMP:' + stamp() + 'Z', dtStart, dtEnd,
    'SUMMARY:' + icsEsc(summary), 'LOCATION:' + icsEsc(ev.venue || ''),
    'DESCRIPTION:' + icsEsc([ev.name, ev.venue ? 'Venue: ' + ev.venue : '', ev.arrival ? 'Arrive: ' + ev.arrival : '', ev.finish ? 'Finish: ' + ev.finish : '', ev.dressCode ? 'Dress: ' + ev.dressCode : '', ev.station ? 'Nearest station: ' + ev.station : ''].filter(Boolean).join('\n')),
    'END:VEVENT',
  ];
}
// Separate build / event / breakdown calendar entries.
function buildICS(ev, opts) {
  opts = opts || {};
  const start = (ev.startDate || ev.date || '').slice(0, 10);
  if (!start) return null;
  const end = (ev.endDate || ev.startDate || ev.date || '').slice(0, 10) || start;
  const a = hhmm(ev.arrival), f = hhmm(ev.finish);
  const bd = +ev.buildDays || 0, kd = +ev.breakdownDays || 0;
  const base = (ev.eventId || 'ev') + '-' + Date.now();
  const blocks = [];
  if (bd > 0 && opts.build) blocks.push(vevent(base + '-build', 'DTSTART;VALUE=DATE:' + icsDate(dAdd(start, -bd)), 'DTEND;VALUE=DATE:' + icsDate(start), 'Build: ' + (ev.name || ev.eventId), ev));
  let es, ee;
  if (a) { es = 'DTSTART:' + icsDate(start) + 'T' + a + '00'; ee = 'DTEND:' + icsDate(end) + 'T' + (f || a) + '00'; }
  else { es = 'DTSTART;VALUE=DATE:' + icsDate(start); ee = 'DTEND;VALUE=DATE:' + icsDate(dAdd(end, 1)); }
  blocks.push(vevent(base + '-event', es, ee, 'Working: ' + (ev.name || ev.eventId), ev));
  if (kd > 0 && opts.breakdown) blocks.push(vevent(base + '-breakdown', 'DTSTART;VALUE=DATE:' + icsDate(dAdd(end, 1)), 'DTEND;VALUE=DATE:' + icsDate(dAdd(end, kd + 1)), 'Breakdown: ' + (ev.name || ev.eventId), ev));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mash Media//Ops Portal//EN', 'METHOD:REQUEST'].concat(...blocks).concat(['END:VCALENDAR']).join('\r\n');
}

function emailHTML(ev, name, role) {
  const row = (k, v) => v ? `<tr><td style="padding:4px 14px 4px 0;color:#66707d">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>` : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2733;font-size:14px;line-height:1.5">
    <p>Hi ${esc((name || '').split(' ')[0] || 'there')},</p>
    <p>You're booked to work <strong>${esc(ev.name || ev.eventId)}</strong>${role ? ` as <strong>${esc(role)}</strong>` : ''}. Here are your on-site details — a calendar invite is attached.</p>
    <table style="border-collapse:collapse;margin:14px 0">
      ${row('Your role', role)}
      ${row('Date', ev.dateLabel || ev.date)}
      ${row('Venue', ev.venue)}
      ${row('Arrive on site', ev.arrival)}
      ${row('Finish', ev.finish)}
      ${row('Dress code', ev.dressCode)}
      ${row('Nearest station', ev.station)}
    </table>
    <p style="color:#66707d;font-size:12.5px">Sent from the Mash Ops portal. Reply to this email if anything looks off.</p>
  </div>`;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SENDER) return json({ error: 'OPS_MAIL_SENDER not set on this site.' }, 500);

  let b;
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const recipients = (b.recipients || []).filter(r => r && r.email);
  if (!recipients.length) return json({ error: 'No recipients with an email.' }, 400);

  const ev = {
    eventId: b.eventId, name: b.name, date: b.date, dateLabel: b.dateLabel,
    arrival: (b.onsite || {}).arrival, finish: (b.onsite || {}).finish,
    dressCode: (b.onsite || {}).dressCode, station: (b.onsite || {}).station,
    venue: b.venue || '',
  };

  let tok;
  try { tok = await graphToken(); } catch (e) { return json({ error: String(e.message || e) }, 500); }

  // Pull venue + dates (and build/breakdown days) live from SharePoint.
  if (ev.eventId) {
    try { const sp = await eventFromSharePoint(ev.eventId, tok);
      if (sp) { if (!ev.venue && sp.location) ev.venue = sp.location; ev.startDate = sp.startDate; ev.endDate = sp.endDate; ev.buildDays = sp.buildDays; ev.breakdownDays = sp.breakdownDays; }
    } catch (e) { /* non-fatal */ }
  }

  const sent = [], failed = [];
  for (const r of recipients) {
    const ics = buildICS(ev, { build: !!r.build, breakdown: !!r.breakdown });
    const attachments = ics ? [{
      '@odata.type': '#microsoft.graph.fileAttachment', name: 'invite.ics',
      contentType: 'text/calendar; method=REQUEST', contentBytes: Buffer.from(ics, 'utf-8').toString('base64'),
    }] : [];
    const message = {
      message: {
        subject: 'You’re working ' + (ev.name || ev.eventId),
        body: { contentType: 'HTML', content: emailHTML(ev, r.name, r.role) },
        toRecipients: [{ emailAddress: { address: r.email } }],
        attachments,
      },
      saveToSentItems: true,
    };
    try { await sendMail(tok, SENDER, message); sent.push(r.email); }
    catch (e) { failed.push({ email: r.email, error: String(e.message || e) }); }
  }
  return json({ sent, failed, venue: ev.venue, hadInvite: !!ics });
};

export const config = { path: '/api/send-briefing' };
