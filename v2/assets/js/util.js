export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const TZ = 'Europe/London';
export const fmtTime = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
export const fmtDate = (d, o = {}) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', ...o }).format(new Date(String(d).length === 10 ? d + 'T12:00:00Z' : d)) : '';
export const fmtDay = (d) => fmtDate(d, { weekday: 'short', year: undefined });
export const fmtDateTime = (d) => `${fmtDate(d, { year: undefined })} ${fmtTime(d)}`;
// London wall clock → ISO (UTC), same maths as the server.
export function londonISO(day, hhmm) {
  const [y, m, dd] = day.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, dd, h, mi);
  const off = (ms) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {}); return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms) / 60000; };
  return new Date(guess - off(guess - off(guess) * 60000) * 60000).toISOString();
}
export const todayLondon = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function toast(msg, bad = false) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), bad ? 6000 : 2800);
}
// CSV → array of objects keyed by lower-case header. Handles quotes and commas in fields.
export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',' || c === '\t') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const clean = rows.filter(r => r.some(v => v.trim()));
  if (!clean.length) return [];
  const head = clean[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
export function toCSV(rows, cols) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map(c => q(c.label)).join(','), ...rows.map(r => cols.map(c => q(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
}
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
