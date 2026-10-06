import { getStore } from '@netlify/blobs';
import { STORE_NAME, loadEvents } from './_shows.mjs';
import { readCommunity, computeEvent } from './_community.mjs';

// Read-only per-event community figures for the event calendar drawer.
// GET /api/community-summary → { events: { [eventId]: { required, count, demand, sponsors, delivered } } }
// Keyed by the Ops id AND, where it differs, the calendar id (the calendar drawer looks up by its own id).
//
// Everything is computed on request: sponsors from the Ops store, packages and
// agenda from the community state, delegates live from HubSpot (or the override).
// Response shape is unchanged from the old mashcommunity site, so the calendar
// only needs its base URL repointed.
const TOKEN = process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_PRIVATE_APP_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN;
// Same lock-down as public-staffing: set PORTAL_ORIGIN to the calendar's URL.
const ORIGIN = process.env.PORTAL_ORIGIN || '*';
const CORS = { 'access-control-allow-origin': ORIGIN, 'cache-control': 'no-store' };
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', ...CORS } }); }

const cache = new Map(); // ji -> { n, at }  (warm instances only; 60s)
async function liveCount(ji) {
  const hit = cache.get(ji);
  if (hit && Date.now() - hit.at < 60000) return hit.n;
  const r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'joining_instructions', operator: 'CONTAINS_TOKEN', value: ji }] }], properties: ['hs_object_id'], limit: 1 }),
  });
  if (!r.ok) throw new Error('HubSpot ' + r.status);
  const n = (await r.json()).total ?? 0;
  cache.set(ji, { n, at: Date.now() });
  return n;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET,OPTIONS', 'access-control-allow-headers': 'content-type' } });
  let store;
  try { store = getStore(STORE_NAME); } catch { return json({ error: 'Blobs unavailable' }, 500); }

  const [community, ops, events] = await Promise.all([
    readCommunity(store),
    store.get('portal-state-v1', { type: 'json' }).then(x => x || {}),
    loadEvents(),
  ]);
  const sponsorsAll = ops.sponsors || {};
  const jiById = Object.fromEntries(events.map(e => [e.id, e.ji]));
  // Only events someone has actually planned (or that have sponsors) get a row.
  const ids = [...new Set([...Object.keys(community.events), ...Object.keys(sponsorsAll).filter(k => (sponsorsAll[k] || []).some(s => !s.deleted))])]
    .filter(id => jiById[id]);

  const counts = {};
  const queue = ids.filter(id => String(community.events[id]?.delegateOverride ?? '').trim() === '');
  async function worker() { while (queue.length) { const id = queue.shift(); try { counts[id] = TOKEN ? await liveCount(jiById[id]) : null; } catch { counts[id] = null; } } }
  await Promise.all([worker(), worker(), worker(), worker()]);

  const calOf = Object.fromEntries(events.map(e => [e.id, e.calId]));
  const out = {};
  for (const id of ids) {
    const c = computeEvent(community.events[id], sponsorsAll[id], counts[id]);
    if (c.demand || c.required || c.count != null) { out[id] = c; if (calOf[id] && calOf[id] !== id) out[calOf[id]] = c; }
  }
  return json({ events: out, updatedAt: new Date().toISOString() });
};

export const config = { path: '/api/community-summary' };
