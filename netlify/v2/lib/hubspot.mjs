// HubSpot reads for the attendee tabs. One token, read-only.
import { bad } from './http.mjs';

const TOKEN = () => process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_PRIVATE_APP_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN;
const BASE = 'https://api.hubapi.com';
export const hubspotConfigured = () => !!TOKEN();

async function hs(path, body, method = 'POST') {
  if (!TOKEN()) throw bad('HUBSPOT_TOKEN is not set on this site.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    if (r.status === 429) { await new Promise(res => setTimeout(res, 1000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`HubSpot ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('HubSpot is rate-limiting, try again in a minute');
}
const search = (body) => hs('/crm/v3/objects/contacts/search', body);

const PROPS = ['firstname', 'lastname', 'email', 'jobtitle', 'company', 'associatedcompanyid', 'dietary_requirements', 'accessibility_requirements', 'pas_scan_id', 'createdate'];
async function companyNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))], out = {};
  for (let i = 0; i < unique.length; i += 100) {
    try {
      const d = await hs('/crm/v3/objects/companies/batch/read', { properties: ['name'], inputs: unique.slice(i, i + 100).map(id => ({ id })) });
      for (const c of d.results || []) out[c.id] = c.properties?.name || '';
    } catch { /* leave blank */ }
  }
  return out;
}
function shape(r, names) {
  const p = r.properties || {};
  return { id: r.id, scanId: p.pas_scan_id || '', createdAt: p.createdate || '', firstname: p.firstname || '', lastname: p.lastname || '',
    name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || '(no name)', email: (p.email || '').toLowerCase(),
    company: names[p.associatedcompanyid] || p.company || '', jobtitle: p.jobtitle || '',
    dietary: p.dietary_requirements || '', accessibility: p.accessibility_requirements || '' };
}
const jiFilter = (ji) => ({ filterGroups: [{ filters: [{ propertyName: 'joining_instructions', operator: 'CONTAINS_TOKEN', value: ji }] }] });

// Delegates: contacts whose Joining Instructions contain the event's value. Cached briefly per warm instance.
const cache = new Map();
export async function delegatesFor(ji, { fresh = false } = {}) {
  const hit = cache.get(ji);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.list;
  const raw = []; let after;
  for (let g = 0; g < 60; g++) {
    const d = await search({ ...jiFilter(ji), properties: PROPS, limit: 100, ...(after ? { after } : {}) });
    raw.push(...(d.results || []));
    after = d.paging?.next?.after; if (!after) break;
  }
  const names = await companyNames(raw.map(r => r.properties?.associatedcompanyid));
  const list = raw.map(r => shape(r, names)).sort((a, b) => (a.lastname || a.name).localeCompare(b.lastname || b.name));
  cache.set(ji, { at: Date.now(), list });
  return list;
}
export async function countFor(ji) {
  const hit = cache.get(ji);
  if (hit && Date.now() - hit.at < 60000) return hit.list.length;
  const d = await search({ ...jiFilter(ji), properties: ['hs_object_id'], limit: 1 });
  return d.total ?? 0;
}
export async function lookupEmails(emails) {
  const clean = [...new Set(emails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))], found = {};
  if (!clean.length || !TOKEN()) return found;
  for (let i = 0; i < clean.length; i += 100) {
    const d = await search({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'IN', values: clean.slice(i, i + 100) }] }], properties: PROPS, limit: 100 });
    const names = await companyNames((d.results || []).map(r => r.properties?.associatedcompanyid));
    for (const r of d.results || []) { const k = (r.properties?.email || '').toLowerCase(); if (k && !found[k]) found[k] = shape(r, names); }
  }
  return found;
}
// The Joining Instructions dropdown values (needs crm.schemas.contacts.read).
export async function jiOptions() {
  const p = await hs('/crm/v3/properties/contacts/joining_instructions', null, 'GET');
  return (p.options || []).filter(o => !o.hidden).map(o => ({ label: o.label || o.value, value: o.value }));
}
// Mash staff in HubSpot whose email is on the roster.
export async function staffContacts(rosterEmails) {
  const keep = new Set(rosterEmails.map(e => e.toLowerCase())), out = []; let after;
  for (let g = 0; g < 30; g++) {
    const d = await search({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: '*@mashmedia.net' }] }],
      properties: ['firstname', 'lastname', 'email', 'jobtitle', 'pas_scan_id', 'dietary_requirements', 'accessibility_requirements'], limit: 100, ...(after ? { after } : {}) });
    for (const r of d.results || []) {
      const p = r.properties || {}, email = (p.email || '').toLowerCase();
      if (!keep.has(email)) continue;
      out.push({ id: r.id, firstname: p.firstname || '', lastname: p.lastname || '', name: [p.firstname, p.lastname].filter(Boolean).join(' ') || email,
        email, company: 'Mash Media', scanId: p.pas_scan_id || ('STAFF' + r.id), jobtitle: p.jobtitle || '',
        dietary: p.dietary_requirements || '', accessibility: p.accessibility_requirements || '' });
    }
    after = d.paging?.next?.after; if (!after) break;
  }
  return out.sort((a, b) => (a.lastname || a.name).localeCompare(b.lastname || b.name));
}
