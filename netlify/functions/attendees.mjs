import { EVENTS, eventById } from './_shows.mjs';

const TOKEN =
  process.env.HUBSPOT_TOKEN ||
  process.env.HUBSPOT_PRIVATE_APP_TOKEN ||
  process.env.HUBSPOT_ACCESS_TOKEN;

const BASE = 'https://api.hubapi.com';
const SEARCH_URL = BASE + '/crm/v3/objects/contacts/search';
const PROPS = [
  'firstname', 'lastname', 'email', 'jobtitle',
  'company', 'associatedcompanyid',
  'dietary_requirements', 'accessibility_requirements',
  'joining_instructions',
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function hs(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function companyNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = {};
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    try {
      const data = await hs(BASE + '/crm/v3/objects/companies/batch/read', {
        properties: ['name'],
        inputs: chunk.map(id => ({ id })),
      });
      for (const c of data.results || []) map[c.id] = c.properties?.name || '';
    } catch { /* leave unresolved ids blank */ }
  }
  return map;
}

async function fetchAttendees(jiCode) {
  const raw = [];
  let after;
  for (let guard = 0; guard < 60; guard++) {
    const data = await hs(SEARCH_URL, {
      filterGroups: [{ filters: [{ propertyName: 'joining_instructions', operator: 'CONTAINS_TOKEN', value: jiCode }] }],
      properties: PROPS,
      limit: 100,
      ...(after ? { after } : {}),
    });
    raw.push(...(data.results || []));
    after = data.paging?.next?.after;
    if (!after) break;
  }

  const names = await companyNames(raw.map(r => r.properties?.associatedcompanyid));

  const out = raw.map(r => {
    const p = r.properties || {};
    const company = names[p.associatedcompanyid] || p.company || '';
    return {
      id: r.id,
      type: 'Delegate',
      firstname: p.firstname || '',
      lastname: p.lastname || '',
      name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || '(no name)',
      email: p.email || '',
      company,
      jobtitle: p.jobtitle || '',
      dietary: p.dietary_requirements || '',
      accessibility: p.accessibility_requirements || '',
    };
  });
  out.sort((a, b) => (a.lastname || a.name).localeCompare(b.lastname || b.name));
  return out;
}

async function fetchCount(jiCode) {
  const data = await hs(SEARCH_URL, {
    filterGroups: [{ filters: [{ propertyName: 'joining_instructions', operator: 'CONTAINS_TOKEN', value: jiCode }] }],
    properties: ['hs_object_id'],
    limit: 1,
  });
  return data.total ?? 0;
}

export default async (req) => {
  if (!TOKEN) return json({ error: 'HUBSPOT_TOKEN not set on this site.' }, 500);
  const url = new URL(req.url);
  const eventId = url.searchParams.get('event');

  try {
    if (eventId) {
      const ev = eventById(eventId);
      if (!ev) return json({ error: `Unknown event: ${eventId}` }, 404);
      const attendees = await fetchAttendees(ev.ji);
      return json({ event: ev, total: attendees.length, attendees, updatedAt: new Date().toISOString() });
    }
    const results = [];
    const queue = [...EVENTS];
    async function worker() {
      while (queue.length) {
        const ev = queue.shift();
        try { results.push({ id: ev.id, count: await fetchCount(ev.ji) }); }
        catch { results.push({ id: ev.id, count: null }); }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    return json({ events: EVENTS, counts: Object.fromEntries(results.map(r => [r.id, r.count])), updatedAt: new Date().toISOString() });
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
};

export const config = { path: '/api/attendees' };
