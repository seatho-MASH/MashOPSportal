import { getStore } from '@netlify/blobs';
import { EVENTS, CFG_KEY, STORE_NAME, readEventConfig } from './_shows.mjs';

// Admin: change which HubSpot "Joining Instructions" value feeds each event's delegate list.
//
// GET  /api/admin-events                  -> { events:[...], options:[{label,value}]|null, optionsError }
// POST { action:'set',   eventId, ji }    -> save an override
// POST { action:'reset', eventId }        -> drop the override, back to the bundled default
// POST { action:'check', ji }             -> { total } contacts currently matching that value
//
// Overrides live in their own Blobs key so /api/store's whole-object writes can't clobber them.

const TOKEN =
  process.env.HUBSPOT_TOKEN ||
  process.env.HUBSPOT_PRIVATE_APP_TOKEN ||
  process.env.HUBSPOT_ACCESS_TOKEN;

const BASE = 'https://api.hubapi.com';
const SEARCH_URL = BASE + '/crm/v3/objects/contacts/search';
const PROP_URL = BASE + '/crm/v3/properties/contacts/joining_instructions';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// Read the dropdown options straight off the HubSpot property definition, so the
// admin picks a real value and can never typo one. Needs crm.schemas.contacts.read
// on the private app token — if that scope is missing we degrade to free text.
async function jiOptions() {
  const res = await fetch(PROP_URL, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (res.status === 403) {
      throw new Error(
        'HubSpot rejected the property lookup (403). The private app token needs the ' +
        '"crm.schemas.contacts.read" scope to list Joining Instructions options.'
      );
    }
    throw new Error(`HubSpot ${res.status}: ${detail}`);
  }
  const p = await res.json();
  return (p.options || [])
    .filter(o => !o.hidden)
    .map(o => ({ label: o.label || o.value, value: o.value }));
}

async function countFor(ji) {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'joining_instructions', operator: 'CONTAINS_TOKEN', value: ji }] }],
      properties: ['hs_object_id'],
      limit: 1,
    }),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.total ?? 0;
}

async function writeEventConfig(cfg) {
  const store = getStore(STORE_NAME);
  cfg.updatedAt = new Date().toISOString();
  await store.setJSON(CFG_KEY, cfg);
  return cfg;
}

export default async (req) => {
  if (!TOKEN) return json({ error: 'HUBSPOT_TOKEN not set on this site.' }, 500);

  if (req.method === 'GET') {
    const cfg = await readEventConfig();
    const ov = cfg.ji || {};

    let options = null, optionsError = null;
    try { options = await jiOptions(); }
    catch (e) { optionsError = String(e.message || e); }

    const events = EVENTS.map(e => ({
      id: e.id, brand: e.brand, name: e.name, short: e.short, date: e.date,
      ji: ov[e.id] || e.ji,
      jiDefault: e.ji,
      overridden: !!ov[e.id] && ov[e.id] !== e.ji,
    }));

    return json({ events, options, optionsError, updatedAt: cfg.updatedAt || null });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let b;
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  try {
    if (b.action === 'check') {
      const ji = String(b.ji || '').trim();
      if (!ji) return json({ error: 'ji is required' }, 400);
      return json({ ji, total: await countFor(ji) });
    }

    if (b.action === 'set') {
      const eventId = String(b.eventId || '').trim();
      const ji = String(b.ji || '').trim();
      if (!eventId) return json({ error: 'eventId is required' }, 400);
      if (!ji) return json({ error: 'ji is required' }, 400);
      const base = EVENTS.find(e => e.id === eventId);
      if (!base) return json({ error: `Unknown event: ${eventId}` }, 404);

      const cfg = await readEventConfig();
      cfg.ji = cfg.ji || {};
      if (ji === base.ji) delete cfg.ji[eventId];   // same as default -> no override needed
      else cfg.ji[eventId] = ji;
      await writeEventConfig(cfg);

      let total = null;
      try { total = await countFor(ji); } catch { /* count is advisory only */ }
      return json({ ok: true, eventId, ji, overridden: ji !== base.ji, total });
    }

    if (b.action === 'reset') {
      const eventId = String(b.eventId || '').trim();
      if (!eventId) return json({ error: 'eventId is required' }, 400);
      const base = EVENTS.find(e => e.id === eventId);
      if (!base) return json({ error: `Unknown event: ${eventId}` }, 404);

      const cfg = await readEventConfig();
      cfg.ji = cfg.ji || {};
      delete cfg.ji[eventId];
      await writeEventConfig(cfg);
      return json({ ok: true, eventId, ji: base.ji, overridden: false });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
};

export const config = { path: '/api/admin-events' };
