export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const bad = (m) => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'Not allowed') => new HttpError(403, m);
export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
}
export const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
export const int = (v, d = 0) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : d; };
export function isoOrThrow(v, what) {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw bad(`${what} is not a valid date/time`);
  return d.toISOString();
}
export const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
