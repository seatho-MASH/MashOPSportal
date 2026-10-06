import { loadEventById } from './_shows.mjs';
import { readAudit } from './_audit.mjs';

// GET /api/audit?event=<id>  → { event, entries:[…newest first] }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const id = new URL(req.url).searchParams.get('event');
  if (!id) return json({ error: 'event is required' }, 400);
  const ev = await loadEventById(id);
  if (!ev) return json({ error: `Unknown event: ${id}` }, 404);
  try { return json({ event: ev.id, entries: (await readAudit(ev.id)).slice().reverse() }); }
  catch (e) { return json({ error: String(e.message || e) }, 500); }
};

export const config = { path: '/api/audit' };
