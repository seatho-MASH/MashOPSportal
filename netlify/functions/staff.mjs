const TOKEN =
  process.env.HUBSPOT_TOKEN ||
  process.env.HUBSPOT_PRIVATE_APP_TOKEN ||
  process.env.HUBSPOT_ACCESS_TOKEN;
const BASE = 'https://api.hubapi.com';
const SEARCH_URL = BASE + '/crm/v3/objects/contacts/search';
const PROPS = ['firstname','lastname','email','jobtitle','pas_scan_id','dietary_requirements','accessibility_requirements'];

// Approved staff roster (edit this list to add/remove people).
const KEEP = new Set([
  'aagostini@mashmedia.net',
  'apragnell@mashmedia.net',
  'cbarrett@mashmedia.net',
  'ccarter@mashmedia.net',
  'cfewlass@mashmedia.net',
  'cforkes@mashmedia.net',
  'cgoodey@mashmedia.net',
  'dkilic@mashmedia.net',
  'ebatesproduction@mashmedia.net',
  'eparker@mashmedia.net',
  'fsampson@mashmedia.net',
  'gagostini@mashmedia.net',
  'gkay@mashmedia.net',
  'hjoseph@mashmedia.net',
  'hnicholls@mashmedia.net',
  'istirling@mashmedia.net',
  'jagostini@mashmedia.net',
  'jbelcher@mashmedia.net',
  'jbrosnan@mashmedia.net',
  'jgreen@mashmedia.net',
  'jhammond@mashmedia.net',
  'jlenny@mashmedia.net',
  'jnewey@mashmedia.net',
  'kadedeji@mashmedia.net',
  'lagostini@mashmedia.net',
  'lelliot@mashmedia.net',
  'lfarnfield@mashmedia.net',
  'magostini@mashmedia.net',
  'mbalasingham@mashmedia.net',
  'mhicks@mashmedia.net',
  'mhodgson@mashmedia.net',
  'msteventon@mashmedia.net',
  'pcolston@mashmedia.net',
  'rbandara@mashmedia.net',
  'rmccrae@mashmedia.net',
  'sboucher@mashmedia.net',
  'sshafeeq@mashmedia.net',
  'ssiddiqui@mashmedia.net',
  'stevet@mashmedia.net',
  'sthornton@mashmedia.net',
  'treilly@mashmedia.net',
  'ysarpong@mashmedia.net',
]);

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

export default async () => {
  if (!TOKEN) return json({ error: 'HUBSPOT_TOKEN not set on this site.' }, 500);
  try {
    const out = [];
    let after;
    for (let g = 0; g < 20; g++) {
      const data = await hs(SEARCH_URL, {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: '*@mashmedia.net' }] }],
        properties: PROPS, limit: 100, ...(after ? { after } : {}),
      });
      for (const r of data.results || []) {
        const p = r.properties || {};
        const email = (p.email || '').toLowerCase();
        if (!KEEP.has(email)) continue;
        out.push({
          id: r.id,
          firstname: p.firstname || '',
          lastname: p.lastname || '',
          name: [p.firstname, p.lastname].filter(Boolean).join(' ') || email,
          email: p.email || '',
          scanId: p.pas_scan_id || ('STAFF' + r.id),
          jobtitle: p.jobtitle || '',
          dietary: p.dietary_requirements || '',
          accessibility: p.accessibility_requirements || '',
        });
      }
      after = data.paging?.next?.after;
      if (!after) break;
    }
    out.sort((a, b) => (a.lastname || a.name).localeCompare(b.lastname || b.name));
    return json({ staff: out, updatedAt: new Date().toISOString() });
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
};

export const config = { path: '/api/staff' };
