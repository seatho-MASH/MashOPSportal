import { getStore } from '@netlify/blobs';
import { loadEvents } from './_shows.mjs';

const KEY = 'portal-state-v1';
// Set PORTAL_ORIGIN to the calendar's URL to lock this down; defaults to open.
const ORIGIN = process.env.PORTAL_ORIGIN || '*';

function cors(extra = {}) {
  return { 'access-control-allow-origin': ORIGIN, 'cache-control': 'no-store', ...extra };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...cors() },
  });
}

// Read-only staffing + on-site details for the calendar. Names only — no emails/PII.
export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: cors({ 'access-control-allow-methods': 'GET,OPTIONS', 'access-control-allow-headers': 'content-type' }) });
  }
  let store;
  try { store = getStore('mash-attendee-portal'); }
  catch (e) { return json({ error: 'Blobs unavailable' }, 500); }

  const st = (await store.get(KEY, { type: 'json' })) || {};
  const staffAll = st.staff || {};
  const onsiteAll = st.onsite || {};
  const roomsAll = st.rooms || {};
  const speakersAll = st.speakers || {};
  const sponsorsAll = st.sponsors || {};
  const delegatesAll = st.delegates || {};
  // Rooms are keyed per person ("e:email" | "s:scanId" | "r:recordId"), so someone in two lists
  // counts once. Classify with Speaker > Sponsor > Delegate > Staff, and ignore removed people.
  const PRI = { Speaker: 1, Sponsor: 2, Delegate: 3, Staff: 4 };
  const nrm = v => String(v == null ? '' : v).trim().toLowerCase();
  const roomCtx = k => {
    const Ae = {}, As = {}, Ai = {}, De = new Set(), Ds = new Set(), Di = new Set();
    const best = (m, kk, t) => { if (kk && (!m[kk] || PRI[t] < PRI[m[kk]])) m[kk] = t; };
    const active = (email, scan, id, t) => { best(Ae, nrm(email), t); best(As, scan, t); best(Ai, id, t); };
    const dead = (email, scan, id) => { const e = nrm(email); if (e) De.add(e); if (scan) Ds.add(scan); if (id) Di.add(id); };
    (delegatesAll[k] || []).forEach(d => (d.deleted ? dead : active)(d.email, d.scanId, d.id, 'Delegate'));
    (sponsorsAll[k] || []).forEach(sp => (sp.contacts || []).forEach(c => ((sp.deleted || c.deleted) ? dead : active)(c.email, c.scanId, c.id, 'Sponsor')));
    (speakersAll[k] || []).forEach(x => (x.deleted ? dead : active)(x.email, x.scanId, x.id, 'Speaker'));
    (staffAll[k] || []).forEach(x => (x.deleted ? dead : active)(x.email, x.scanId, x.id, 'Staff'));
    const typeOf = key => key.startsWith('e:') ? Ae[key.slice(2)] : key.startsWith('s:') ? As[key.slice(2)] : key.startsWith('r:') ? Ai[key.slice(2)] : Ai[key];
    const isOrphan = key => typeOf(key) ? false : (key.startsWith('e:') ? De.has(key.slice(2)) : key.startsWith('s:') ? Ds.has(key.slice(2)) : key.startsWith('r:') ? Di.has(key.slice(2)) : Di.has(key));
    return { typeOf, isOrphan };
  };
  // Unticked rooms are stored as false (see index.html setRoom), so only true values count.
  const roomsReq = k => { const ctx = roomCtx(k), m = roomsAll[k] || {}; return Object.keys(m).filter(key => m[key] && !ctx.isOrphan(key)).length; };
  const roomsByType = k => {
    const ctx = roomCtx(k), by = { Delegate: 0, Sponsor: 0, Speaker: 0, Staff: 0 };
    for (const key of Object.keys(roomsAll[k] || {})) { if (!roomsAll[k][key] || ctx.isOrphan(key)) continue; by[ctx.typeOf(key) || 'Delegate']++; }
    return by;
  };
  // The calendar asks with its own ids; a few Ops events are stored under older ids.
  let evs = [];
  try { evs = await loadEvents(); } catch { /* aliases are best-effort */ }
  const asked = new URL(req.url).searchParams.get('event');
  const id = asked ? ((evs.find(e => e.id === asked) || evs.find(e => e.calId === asked) || {}).id || asked) : null;

  if (id) {
    const staff = (staffAll[id] || [])
      .filter(x => !x.deleted)
      .map(x => ({ name: x.name, jobtitle: x.jobtitle || '', external: !!x.external }));
    return json({ event: asked, staff, onsite: onsiteAll[id] || {}, roomsRequired: roomsReq(id), roomsByType: roomsByType(id) });
  }

  // Summary for all events: count + on-site details (used to badge the calendar).
  const events = {};
  for (const k of new Set([...Object.keys(staffAll), ...Object.keys(onsiteAll), ...Object.keys(roomsAll)])) {
    events[k] = { count: (staffAll[k] || []).filter(x => !x.deleted).length, onsite: onsiteAll[k] || {}, roomsRequired: roomsReq(k) };
  }
  for (const e of evs) if (e.calId && e.calId !== e.id && events[e.id] && !events[e.calId]) events[e.calId] = events[e.id];
  return json({ events });
};

export const config = { path: '/api/public-staffing' };
