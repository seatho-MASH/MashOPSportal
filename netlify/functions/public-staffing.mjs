import { getStore } from '@netlify/blobs';

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
  const id = new URL(req.url).searchParams.get('event');

  if (id) {
    const staff = (staffAll[id] || [])
      .filter(x => !x.deleted)
      .map(x => ({ name: x.name, jobtitle: x.jobtitle || '', external: !!x.external }));
    return json({ event: id, staff, onsite: onsiteAll[id] || {} });
  }

  // Summary for all events: count + on-site details (used to badge the calendar).
  const events = {};
  for (const k of new Set([...Object.keys(staffAll), ...Object.keys(onsiteAll)])) {
    events[k] = { count: (staffAll[k] || []).filter(x => !x.deleted).length, onsite: onsiteAll[k] || {} };
  }
  return json({ events });
};

export const config = { path: '/api/public-staffing' };
