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
  const roomsAll = st.rooms || {};
  const speakersAll = st.speakers || {};
  const sponsorsAll = st.sponsors || {};
  const delegatesAll = st.delegates || {};
  const roomsReq = k => Object.keys(roomsAll[k] || {}).length;
  // Split the allocated rooms by attendee type (live delegates aren't in the store, so unknown ids fall to Delegate).
  const roomsByType = k => {
    const by = { Delegate: 0, Sponsor: 0, Speaker: 0, Staff: 0 };
    const staffIds = new Set((staffAll[k] || []).map(x => x.id));
    const spkIds = new Set((speakersAll[k] || []).map(x => x.id));
    const spoIds = new Set(); (sponsorsAll[k] || []).forEach(sp => (sp.contacts || []).forEach(c => spoIds.add(c.id)));
    for (const pid of Object.keys(roomsAll[k] || {})) {
      if (staffIds.has(pid)) by.Staff++;
      else if (spkIds.has(pid)) by.Speaker++;
      else if (spoIds.has(pid)) by.Sponsor++;
      else by.Delegate++;
    }
    return by;
  };
  const id = new URL(req.url).searchParams.get('event');

  if (id) {
    const staff = (staffAll[id] || [])
      .filter(x => !x.deleted)
      .map(x => ({ name: x.name, jobtitle: x.jobtitle || '', external: !!x.external }));
    return json({ event: id, staff, onsite: onsiteAll[id] || {}, roomsRequired: roomsReq(id), roomsByType: roomsByType(id) });
  }

  // Summary for all events: count + on-site details (used to badge the calendar).
  const events = {};
  for (const k of new Set([...Object.keys(staffAll), ...Object.keys(onsiteAll), ...Object.keys(roomsAll)])) {
    events[k] = { count: (staffAll[k] || []).filter(x => !x.deleted).length, onsite: onsiteAll[k] || {}, roomsRequired: roomsReq(k) };
  }
  return json({ events });
};

export const config = { path: '/api/public-staffing' };
