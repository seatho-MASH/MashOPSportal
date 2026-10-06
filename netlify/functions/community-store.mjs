import { getStore } from '@netlify/blobs';
import { STORE_NAME, loadEvents } from './_shows.mjs';
import { COMMUNITY_KEY, readCommunity } from './_community.mjs';

// Community planner state (see _community.mjs for the shape).
// GET  /api/community-store                         → { packages, events }
// POST /api/community-store  { event, data }        → replaces ONE event's settings only
//
// Saves are per event, merged server-side, so two people on different events can
// no longer overwrite each other (the old portal POSTed the whole blob).
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }

const clean = (d) => ({
  slots: d.slots === '' || d.slots == null ? 10 : (+d.slots || 0),
  maxPerDelegate: d.maxPerDelegate === '' || d.maxPerDelegate == null ? '' : (+d.maxPerDelegate || 0),
  delegateOverride: d.delegateOverride == null ? '' : String(d.delegateOverride).trim(),
  packages: (Array.isArray(d.packages) ? d.packages : []).filter(p => p && p.id).map(p => ({ id: String(p.id), name: String(p.name || '').trim(), meetings: +p.meetings || 0 })),
  assign: Object.fromEntries(Object.entries(d.assign && typeof d.assign === 'object' ? d.assign : {}).filter(([k, v]) => k && v).map(([k, v]) => [String(k), String(v)])),
});

export default async (req) => {
  let store;
  try { store = getStore(STORE_NAME); } catch (e) { return json({ error: 'Blobs unavailable: ' + String(e.message || e) }, 500); }

  if (req.method === 'GET') return json(await readCommunity(store));

  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const id = String(b.event || '').trim();
    if (!id) return json({ error: 'event is required' }, 400);
    if (!(await loadEvents()).some(e => e.id === id)) return json({ error: `Unknown event: ${id}` }, 404);
    if (!b.data || typeof b.data !== 'object') return json({ error: 'data is required' }, 400);
    const st = await readCommunity(store);
    st.events[id] = { ...clean(b.data), updatedAt: new Date().toISOString() };
    st.updatedAt = st.events[id].updatedAt;
    await store.setJSON(COMMUNITY_KEY, st);
    return json({ ok: true, event: id, data: st.events[id] });
  }
  return json({ error: 'Method not allowed' }, 405);
};

export const config = { path: '/api/community-store' };
