// =============================================================
// Contact lookup — match manually-added / bulk-uploaded people
// against HubSpot so sponsors & speakers get a Record ID (badging
// scan ID) and any known details.
//
//   GET  /api/lookup?email=jane@acme.com   -> single match or null
//   POST /api/lookup   { emails:[...] }     -> { "jane@acme.com": {...}, ... }
//
// Match key is EMAIL (the reliable badging identifier).
// Returns: id (Record ID), firstname, lastname, email, company
// (primary associated company), jobtitle, dietary, accessibility.
// =============================================================
const TOKEN =
  process.env.HUBSPOT_TOKEN ||
  process.env.HUBSPOT_PRIVATE_APP_TOKEN ||
  process.env.HUBSPOT_ACCESS_TOKEN;

const BASE = 'https://api.hubapi.com';
const SEARCH_URL = BASE + '/crm/v3/objects/contacts/search';
const PROPS = ['firstname','lastname','email','jobtitle','company','associatedcompanyid','dietary_requirements','accessibility_requirements'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
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
    try {
      const data = await hs(BASE + '/crm/v3/objects/companies/batch/read', {
        properties: ['name'], inputs: unique.slice(i, i + 100).map(id => ({ id })),
      });
      for (const c of data.results || []) map[c.id] = c.properties?.name || '';
    } catch {}
  }
  return map;
}
const shape = (r, names) => {
  const p = r.properties || {};
  return {
    id: r.id,
    firstname: p.firstname || '',
    lastname: p.lastname || '',
    email: p.email || '',
    company: names[p.associatedcompanyid] || p.company || '',
    jobtitle: p.jobtitle || '',
    dietary: p.dietary_requirements || '',
    accessibility: p.accessibility_requirements || '',
  };
};

// Look up a batch of emails; returns { lowercasedEmail: contact }.
async function lookupEmails(emails) {
  const clean = [...new Set(emails.map(e => (e || '').trim().toLowerCase()).filter(Boolean))];
  const found = {};
  for (let i = 0; i < clean.length; i += 100) {
    const chunk = clean.slice(i, i + 100);
    const data = await hs(SEARCH_URL, {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'IN', values: chunk }] }],
      properties: PROPS, limit: 100,
    });
    const results = data.results || [];
    const names = await companyNames(results.map(r => r.properties?.associatedcompanyid));
    for (const r of results) {
      const key = (r.properties?.email || '').trim().toLowerCase();
      if (key && !found[key]) found[key] = shape(r, names);
    }
  }
  return found;
}

export default async (req) => {
  if (!TOKEN) return json({ error: 'HUBSPOT_TOKEN not set on this site.' }, 500);
  try {
    if (req.method === 'GET') {
      const email = new URL(req.url).searchParams.get('email');
      if (!email) return json({ match: null });
      const m = await lookupEmails([email]);
      return json({ match: m[email.trim().toLowerCase()] || null });
    }
    if (req.method === 'POST') {
      const { emails = [] } = await req.json();
      return json({ matches: await lookupEmails(emails) });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
};

export const config = { path: '/api/lookup' };
