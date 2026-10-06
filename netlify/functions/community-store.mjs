import { getStore } from '@netlify/blobs';
import { STORE_NAME, loadEvents } from './_shows.mjs';
import { COMMUNITY_KEY, readCommunity } from './_community.mjs';
import { appendAudit, whoFrom } from './_audit.mjs';

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
  delivered: Object.fromEntries(Object.entries(d.delivered && typeof d.delivered === 'object' ? d.delivered : {}).filter(([k, v]) => k && v !== '' && v != null && isFinite(+v)).map(([k, v]) => [String(k), Math.max(0, Math.round(+v))])),
});

// History entries for one event's community settings.
function diffCommunity(a, b, by, sponsorName) {
  a = a || {}; const out = [];
  const A = 'Community';
  for (const [k, lbl] of [['slots', 'Meeting slots'], ['maxPerDelegate', 'Max meetings / delegate'], ['delegateOverride', 'Delegates available (override)']])
    if (String(a[k] ?? '') !== String(b[k] ?? '')) out.push({ by, area: A, action: 'changed', item: lbl, field: k, from: a[k] ?? '', to: b[k] ?? '' });
  const pa = new Map((a.packages || []).map(p => [p.id, p])), pb = new Map((b.packages || []).map(p => [p.id, p]));
  const pname = id => (pb.get(id) || pa.get(id) || {}).name || '—';
  for (const [id, p] of pb) {
    const o = pa.get(id);
    if (!o) { if (a.packages) out.push({ by, area: A, action: 'added', item: 'Package ' + p.name + ' (' + p.meetings + ' meetings)' }); continue; }
    if (o.name !== p.name) out.push({ by, area: A, action: 'changed', item: 'Package ' + o.name, field: 'name', from: o.name, to: p.name });
    if (+o.meetings !== +p.meetings) out.push({ by, area: A, action: 'changed', item: 'Package ' + p.name, field: 'meetings', from: o.meetings, to: p.meetings });
  }
  for (const [id, o] of pa) if (!pb.has(id)) out.push({ by, area: A, action: 'removed', item: 'Package ' + o.name });
  const aa = a.assign || {}, ab = b.assign || {};
  for (const k of new Set([...Object.keys(aa), ...Object.keys(ab)]))
    if (aa[k] !== ab[k]) out.push({ by, area: A, action: 'changed', item: sponsorName(k), field: 'package', from: aa[k] ? pname(aa[k]) : '', to: ab[k] ? pname(ab[k]) : '' });
  const da = a.delivered || {}, db = b.delivered || {};
  for (const k of new Set([...Object.keys(da), ...Object.keys(db)]))
    if (String(da[k] ?? '') !== String(db[k] ?? '')) out.push({ by, area: 'Fulfilment', action: 'changed', item: sponsorName(k), field: 'delivered', from: da[k] ?? '', to: db[k] ?? '' });
  return out;
}

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
    const prev = st.events[id];
    st.events[id] = { ...clean(b.data), updatedAt: new Date().toISOString() };
    st.updatedAt = st.events[id].updatedAt;
    await store.setJSON(COMMUNITY_KEY, st);
    const ops = (await store.get('portal-state-v1', { type: 'json' })) || {};
    const names = Object.fromEntries(((ops.sponsors || {})[id] || []).map(s => [s.id, s.company]));
    await appendAudit(id, diffCommunity(prev, st.events[id], whoFrom(req), sid => names[sid] || 'Sponsor ' + sid), store);
    return json({ ok: true, event: id, data: st.events[id] });
  }
  return json({ error: 'Method not allowed' }, 405);
};

export const config = { path: '/api/community-store' };
