import { getStore } from '@netlify/blobs';

// Read/write sponsors for an event, shared with the Community Portal (CORS-enabled).
// GET  /api/community-sponsors?event=EN100        → { event, sponsors:[{id,company,tier,contacts}] }
// POST { action:'add', event, company, tier }     → creates a sponsor in the Ops store
// POST { action:'update', event, id, company, tier }
// POST { action:'delete', event, id }
const KEY = 'portal-state-v1';
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', ...CORS } }); }
async function save(store, st) { st.updatedAt = new Date().toISOString(); await store.setJSON(KEY, st); }

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' } });
  let store;
  try { store = getStore('mash-attendee-portal'); } catch (e) { return json({ error: 'Blobs unavailable' }, 500); }
  const st = (await store.get(KEY, { type: 'json' })) || {};
  st.sponsors = st.sponsors || {};

  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('event');
    if (!id) return json({ error: 'event is required' }, 400);
    const sponsors = (st.sponsors[id] || []).filter(x => !x.deleted).map(sp => ({
      id: sp.id, company: sp.company || '', tier: sp.tier || '',
      contacts: (sp.contacts || []).filter(c => !c.deleted).length,
    }));
    return json({ event: id, sponsors });
  }

  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const ev = b.event; if (!ev) return json({ error: 'event is required' }, 400);
    st.sponsors[ev] = st.sponsors[ev] || [];
    if (b.action === 'add') {
      const company = String(b.company || '').trim(); if (!company) return json({ error: 'company is required' }, 400);
      const sp = { id: 'sp' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), company, tier: String(b.tier || '').trim(), contacts: [], addedAt: new Date().toISOString() };
      st.sponsors[ev].push(sp); await save(store, st); return json({ ok: true, sponsor: { id: sp.id, company: sp.company, tier: sp.tier, contacts: 0 } });
    }
    if (b.action === 'update') {
      const sp = st.sponsors[ev].find(x => x.id === b.id); if (!sp) return json({ error: 'sponsor not found' }, 404);
      if (b.company != null) sp.company = String(b.company).trim();
      if (b.tier != null) sp.tier = String(b.tier).trim();
      await save(store, st); return json({ ok: true });
    }
    if (b.action === 'delete') {
      const sp = st.sponsors[ev].find(x => x.id === b.id); if (sp) sp.deleted = true;
      await save(store, st); return json({ ok: true });
    }
    return json({ error: 'Unknown action' }, 400);
  }
  return json({ error: 'Method not allowed' }, 405);
};

export const config = { path: '/api/community-sponsors' };
