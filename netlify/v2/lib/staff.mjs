// Staff attending an event: the Mash roster (HubSpot contacts on staff_roster),
// external crew, on-site details, nearest station and the briefing email + invite.
import { q, one } from './db.mjs';
import { bad, str } from './http.mjs';
import { audit } from './audit.mjs';
import { requireAdmin } from './auth.mjs';
import { resolveEvent } from './events.mjs';
import { staffContacts } from './hubspot.mjs';
import { addPeople } from './attendees.mjs';
import { STATIONS } from './stations.mjs';

let _roster = null, _rosterAt = 0;
export async function roster({ fresh = false } = {}) {
  if (!fresh && _roster && Date.now() - _rosterAt < 300000) return _roster;
  const emails = (await q('select email from staff_roster order by email')).map(r => r.email);
  const people = await staffContacts(emails);
  const found = new Set(people.map(p => p.email));
  _roster = { staff: people, missing: emails.filter(e => !found.has(e)) };
  _rosterAt = Date.now();
  return _roster;
}
export async function rosterEmails() { return { emails: (await q('select email, added_by, at from staff_roster order by email')) }; }
export async function addRosterEmail(user, email) {
  requireAdmin(user);
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@mashmedia\.net$/.test(e)) throw bad('Use a @mashmedia.net address');
  await q('insert into staff_roster (email, added_by) values ($1,$2) on conflict do nothing', [e, user.email]);
  _roster = null; await audit(user, null, 'Admin', 'added', 'Staff roster: ' + e);
  return rosterEmails();
}
export async function removeRosterEmail(user, email) {
  requireAdmin(user);
  await q('delete from staff_roster where email=$1', [String(email || '').toLowerCase()]);
  _roster = null; await audit(user, null, 'Admin', 'removed', 'Staff roster: ' + email);
  return rosterEmails();
}

// Tick a roster person onto the event (or off it).
export async function setAttending(user, eventId, rosterId, on) {
  const ev = await resolveEvent(eventId);
  if (!on) {
    const rows = await q("update attendee set removed_at=now() where event_id=$1 and kind='staff' and roster_id=$2 and removed_at is null returning name", [ev.id, String(rosterId)]);
    if (rows.length) await audit(user, ev.id, 'Staff', 'removed', rows[0].name);
    return { ok: true };
  }
  const already = await one("select id from attendee where event_id=$1 and kind='staff' and roster_id=$2 and removed_at is null", [ev.id, String(rosterId)]);
  if (already) return { ok: true };
  const p = (await roster()).staff.find(x => x.id === String(rosterId));
  if (!p) throw bad('That person is not on the staff roster');
  return addPeople(user, ev.id, 'staff', [{ name: p.name, firstname: p.firstname, lastname: p.lastname, email: p.email, jobtitle: p.jobtitle,
    company: 'Mash Media', dietary: p.dietary, accessibility: p.accessibility, scanId: p.scanId, idSource: 'roster', rosterId: p.id }]);
}

// ---------------------------------------------------------------- on-site details
export async function getOnsite(eventId) {
  const ev = await resolveEvent(eventId);
  const o = await one('select dress_code, arrival, finish, station from event_onsite where event_id=$1', [ev.id]);
  return { onsite: o || { dress_code: '', arrival: '', finish: '', station: '' }, venue: ev.venue || '', build_days: ev.build_days, breakdown_days: ev.breakdown_days };
}
export async function putOnsite(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const before = (await one('select * from event_onsite where event_id=$1', [ev.id])) || {};
  const v = { dress_code: str(b.dress_code, 200) || null, arrival: str(b.arrival, 40) || null, finish: str(b.finish, 40) || null, station: str(b.station, 200) || null };
  await q(`insert into event_onsite (event_id, dress_code, arrival, finish, station) values ($1,$2,$3,$4,$5)
           on conflict (event_id) do update set dress_code=excluded.dress_code, arrival=excluded.arrival, finish=excluded.finish, station=excluded.station, updated_at=now()`,
    [ev.id, v.dress_code, v.arrival, v.finish, v.station]);
  for (const k of Object.keys(v)) if (String(before[k] ?? '') !== String(v[k] ?? '')) await audit(user, ev.id, 'On-site', 'changed', k.replace('_', ' '), { field: k, from: before[k] ?? '', to: v[k] ?? '' });
  return getOnsite(ev.id);
}

// Nearest stations to the venue (postcodes.io + the bundled station list).
async function geocode(loc) {
  const pc = (loc.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i) || [])[0];
  const tryUrl = async (u) => { try { const j = await (await fetch(u, { signal: AbortSignal.timeout(6000) })).json(); return j?.result?.latitude != null ? { lat: j.result.latitude, lon: j.result.longitude } : null; } catch { return null; } };
  if (pc) { const g = await tryUrl('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc.replace(/\s+/g, ''))); if (g) return g; }
  const out = (loc.match(/\b[A-Z]{1,2}\d[A-Z\d]?\b/i) || [])[0];
  if (out) return tryUrl('https://api.postcodes.io/outcodes/' + encodeURIComponent(out));
  return null;
}
const km = (a1, o1, a2, o2) => { const R = 6371, dl = (a2 - a1) * Math.PI / 180, dn = (o2 - o1) * Math.PI / 180;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dn / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
export async function nearestStation(eventId) {
  const ev = await resolveEvent(eventId);
  if (!ev.venue) return { venue: '', options: [], note: 'No venue on the calendar for this event.' };
  const g = await geocode(ev.venue);
  if (!g) return { venue: ev.venue, options: [], note: 'No postcode found in the venue address.' };
  const seen = new Set(), options = [];
  for (const s of STATIONS.map(s => ({ name: s[0], label: s[3], dist: +km(g.lat, g.lon, s[1], s[2]).toFixed(2) })).sort((a, b) => a.dist - b.dist)) {
    if (seen.has(s.name.toLowerCase())) continue; seen.add(s.name.toLowerCase()); options.push(s); if (options.length >= 3) break;
  }
  return { venue: ev.venue, options };
}

// ---------------------------------------------------------------- briefing
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const hhmm = (t) => { const m = String(t || '').match(/(\d{1,2})\D?(\d{2})/); return m ? m[1].padStart(2, '0') + m[2] : null; };
const ymd = (d) => String(d || '').slice(0, 10).replace(/-/g, '');
const addDays = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nice = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Separate build / working-day / breakdown entries. Times are London wall-clock.
export function briefingICS(ev, o, person) {
  const start = ev.starts_on, end = ev.ends_on || ev.starts_on;
  if (!start) return null;
  const a = hhmm(o.arrival), f = hhmm(o.finish), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const desc = [ev.name, ev.venue ? 'Venue: ' + ev.venue : '', o.arrival ? 'Arrive: ' + o.arrival : '', o.finish ? 'Finish: ' + o.finish : '', o.dress_code ? 'Dress: ' + o.dress_code : '', o.station ? 'Nearest station: ' + o.station : ''].filter(Boolean).join('\n');
  const base = `${ev.id}-${(person.email || '').replace(/[^a-z0-9]/gi, '')}`;
  const ve = (uid, s, e, summary) => ['BEGIN:VEVENT', `UID:${uid}@mashmedia.net`, `DTSTAMP:${stamp}Z`, s, e, 'SUMMARY:' + icsEsc(summary), 'LOCATION:' + icsEsc(ev.venue || ''), 'DESCRIPTION:' + icsEsc(desc), 'END:VEVENT'];
  const blocks = [];
  if (ev.build_days > 0 && person.build) blocks.push(ve(base + '-build', 'DTSTART;VALUE=DATE:' + ymd(addDays(start, -ev.build_days)), 'DTEND;VALUE=DATE:' + ymd(start), 'Build: ' + ev.name));
  const days = []; for (let d = start, n = 0; d <= end && n < 60; d = addDays(d, 1), n++) days.push(d);
  if (a) days.forEach((d, i) => blocks.push(ve(`${base}-day${i}`, `DTSTART;TZID=Europe/London:${ymd(d)}T${a}00`, `DTEND;TZID=Europe/London:${ymd(d)}T${f || a}00`,
    'Working: ' + ev.name + (days.length > 1 ? ` (day ${i + 1} of ${days.length})` : ''))));
  else blocks.push(ve(base + '-event', 'DTSTART;VALUE=DATE:' + ymd(start), 'DTEND;VALUE=DATE:' + ymd(addDays(end, 1)), 'Working: ' + ev.name));
  if (ev.breakdown_days > 0 && person.breakdown) blocks.push(ve(base + '-breakdown', 'DTSTART;VALUE=DATE:' + ymd(addDays(end, 1)), 'DTEND;VALUE=DATE:' + ymd(addDays(end, ev.breakdown_days + 1)), 'Breakdown: ' + ev.name));
  const tz = ['BEGIN:VTIMEZONE', 'TZID:Europe/London', 'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'END:DAYLIGHT', 'END:VTIMEZONE'];
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mash Media//Mash Ops//EN', 'METHOD:PUBLISH', ...tz, ...blocks.flat(), 'END:VCALENDAR'].join('\r\n');
}
export function briefingEmail(ev, o, person) {
  const P = '#574596';
  const dates = ev.ends_on && ev.ends_on !== ev.starts_on ? `${nice(ev.starts_on)} – ${nice(ev.ends_on)}` : nice(ev.starts_on);
  const row = (k, v) => v ? `<tr><td style="padding:6px 16px 6px 0;color:#5E616B;font:14px Arial,sans-serif;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font:700 14px Arial,sans-serif;color:#1A1C21">${esc(v)}</td></tr>` : '';
  const extra = [person.build && ev.build_days > 0 ? `build (${ev.build_days} day${ev.build_days === 1 ? '' : 's'} before)` : '', person.breakdown && ev.breakdown_days > 0 ? `breakdown (${ev.breakdown_days} day${ev.breakdown_days === 1 ? '' : 's'} after)` : ''].filter(Boolean).join(' and ');
  const html = `<!doctype html><html><body style="margin:0;background:#F5F4F0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F0;padding:24px 0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
    <tr><td style="background:${P};padding:26px 28px;color:#fff;font:700 13px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase">Mash Media · ${esc(ev.short_name || ev.name)}
      <div style="font:800 26px/1.2 Arial,sans-serif;letter-spacing:0;text-transform:none;margin-top:6px">You're working ${esc(ev.short_name || ev.name)}</div></td></tr>
    <tr><td style="padding:24px 28px 8px;font:15px/1.55 Arial,sans-serif;color:#1A1C21">Hi ${esc((person.name || '').split(' ')[0] || 'there')},<br>you're booked to work <strong>${esc(ev.name)}</strong>${person.role ? ` as <strong>${esc(person.role)}</strong>` : ''}${extra ? `, including ${esc(extra)}` : ''}. The calendar invite is attached.</td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" cellpadding="0" cellspacing="0">${row('Dates', dates)}${row('Venue', ev.venue)}${row('Arrive on site', o.arrival)}${row('Finish', o.finish)}${row('Dress code', o.dress_code)}${row('Nearest station', o.station)}</table></td></tr>
    <tr><td style="padding:20px 28px 28px;font:12px/1.5 Arial,sans-serif;color:#5E616B">Sent from Mash Ops. Reply to this email if anything looks wrong.</td></tr>
  </table></td></tr></table></body></html>`;
  return { subject: `You're working ${ev.short_name || ev.name}`, html };
}
export async function queueBriefing(user, eventId, ids) {
  const ev = await resolveEvent(eventId);
  const o = (await one('select * from event_onsite where event_id=$1', [ev.id])) || {};
  const people = await q("select * from attendee where event_id=$1 and kind='staff' and removed_at is null and email is not null" + (Array.isArray(ids) && ids.length ? ' and id = any($2)' : ''),
    Array.isArray(ids) && ids.length ? [ev.id, ids] : [ev.id]);
  if (!people.length) throw bad('No attending staff with an email address');
  for (const p of people) {
    const { subject, html } = briefingEmail(ev, o, p);
    const ics = briefingICS(ev, o, p);
    await q(`insert into outbox (kind, event_id, to_email, subject, html, attachments, created_by) values ('briefing',$1,$2,$3,$4,$5,$6)`,
      [ev.id, p.email, subject, html, ics ? JSON.stringify([{ name: 'invite.ics', contentType: 'text/calendar; charset=utf-8; method=PUBLISH', content: Buffer.from(ics, 'utf8').toString('base64') }]) : null, user.email]);
  }
  await audit(user, ev.id, 'Staff', 'sent', `Briefing queued for ${people.length} staff`);
  return { queued: people.length, venue: ev.venue || '' };
}
