// Europe/London wall-clock ↔ UTC, without a timezone library.
const TZ = 'Europe/London';
function offsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).reduce((o, p) => (o[p.type] = p.value, o), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60000);
}
// '2027-03-03', '12:30' (London) → Date (UTC)
export function londonToUtc(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number), [h, mi] = String(hhmm).split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = offsetMinutes(guess - offsetMinutes(guess) * 60000);
  return new Date(guess - off * 60000);
}
export function londonDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}
export function londonTime(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));
}
export function londonDate(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));
}
// A Postgres `date` arrives as a JS Date at local midnight; turn it back into 'YYYY-MM-DD'.
export function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
}
// Each day an event spans, as 'YYYY-MM-DD'.
export function eventDays(ev) {
  if (!ev.starts_on) return [];
  const out = [], s = new Date(isoDate(ev.starts_on) + 'T12:00:00Z'), e = new Date(isoDate(ev.ends_on || ev.starts_on) + 'T12:00:00Z');
  for (let d = s; d <= e && out.length < 14; d = new Date(d.getTime() + 86400000)) out.push(d.toISOString().slice(0, 10));
  return out;
}
