import { getStore } from '@netlify/blobs';

const KEY = 'portal-state-v1';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function readState(store) {
  const existing = await store.get(KEY, { type: 'json' });
  return existing && typeof existing === 'object'
    ? { sponsors: existing.sponsors || {}, speakers: existing.speakers || {}, delegates: existing.delegates || {}, seen: existing.seen || {}, notes: existing.notes || {}, staff: existing.staff || {} }
    : { sponsors: {}, speakers: {}, delegates: {}, seen: {}, notes: {}, staff: {} };
}

export default async (req) => {
  let store;
  try {
    store = getStore('mash-attendee-portal');
  } catch (e) {
    return json({ error: 'Blobs unavailable: ' + String(e.message || e) }, 500);
  }

  if (req.method === 'GET') {
    return json(await readState(store));
  }

  if (req.method === 'POST') {
    let incoming;
    try { incoming = await req.json(); }
    catch { return json({ error: 'Invalid JSON body' }, 400); }

    const current = await readState(store);
    const next = {
      sponsors: incoming.sponsors ?? current.sponsors,
      speakers: incoming.speakers ?? current.speakers,
      delegates: incoming.delegates ?? current.delegates,
      seen: incoming.seen ?? current.seen,
      notes: incoming.notes ?? current.notes,
      staff: incoming.staff ?? current.staff,
      updatedAt: new Date().toISOString(),
    };
    await store.setJSON(KEY, next);
    return json(next);
  }

  return json({ error: 'Method not allowed' }, 405);
};

export const config = { path: '/api/store' };
