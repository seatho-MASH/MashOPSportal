import { getStore } from '@netlify/blobs';
import { EVENTS, CFG_KEY, STORE_NAME, readEventConfig, loadEvents } from './_shows.mjs';
import { appendAudit, whoFrom } from './_audit.mjs';

// Admin: which HubSpot "Joining Instructions" value feeds each event — and which
// calendar events are in Ops at all.
//
// GET  /api/admin-events                  -> { events:[...], options:[{label,value}]|null, optionsError }
//        events: every Ops event, plus upcoming calendar events not yet in Ops (inOps:false)
// POST { action:'set',   eventId, ji }    -> bundled event: save an override
//                                            calendar event: add it to Ops with this JI value
// POST { action:'reset', eventId }        -> bundled event: back to the bundled default
//                                            added event:   take it out of Ops (its data is kept)
// POST { action:'check', ji }             -> { total } contacts currently matching that value
//
// Settings live in their own Blobs key so /api/store's whole-object writes can't clobber them.

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
    let options = null, optionsError = null;
    try { options = await jiOptions(); }
    catch (e) { optionsError = String(e.message || e); }

    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const events = (await loadEvents({ includeCalendarOnly: true }))
      .filter(e => e.ji || (e.date || '') >= since)          // not-yet-added: upcoming only
      .map(e => ({
        id: e.id, calId: e.calId, brand: e.brand, name: e.name, short: e.short, date: e.date,
        venue: e.venue, cancelled: e.cancelled, source: e.source,
        ji: e.ji, jiDefault: e.jiDefault,
        bundled: !e.added && !!e.jiDefault,
        inOps: !!e.ji,
        overridden: !!e.jiDefault && !!cfg.ji[e.id] && cfg.ji[e.id] !== e.jiDefault,
      }));
    return json({ events, options, optionsError, updatedAt: cfg.updatedAt || null });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let b;
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const by = whoFrom(req);

  try {
    if (b.action === 'check') {
      const ji = String(b.ji || '').trim();
      if (!ji) return json({ error: 'ji is required' }, 400);
      return json({ ji, total: await countFor(ji) });
    }

    const eventId = String(b.eventId || '').trim();
    if (!eventId) return json({ error: 'eventId is required' }, 400);
    const bundled = EVENTS.find(e => e.id === eventId);
    const known = bundled || (await loadEvents({ includeCalendarOnly: true })).find(e => e.id === eventId);
    if (!known) return json({ error: `Unknown event: ${eventId} (not bundled, not on the calendar)` }, 404);
    const cfg = await readEventConfig();
    cfg.ji = cfg.ji || {};
    const before = cfg.ji[eventId] || (bundled ? bundled.ji : '');

    if (b.action === 'set') {
      const ji = String(b.ji || '').trim();
      if (!ji) return json({ error: 'ji is required' }, 400);
      if (bundled && ji === bundled.ji) delete cfg.ji[eventId];   // same as default -> no override needed
      else cfg.ji[eventId] = ji;
      await writeEventConfig(cfg);
      await appendAudit(eventId, [before
        ? { by, area: 'Admin', action: 'changed', item: 'Joining Instructions value', field: 'ji', from: before, to: ji }
        : { by, area: 'Admin', action: 'added', item: 'Event added to Ops (JI: ' + ji + ')' }]);
      let total = null;
      try { total = await countFor(ji); } catch { /* count is advisory only */ }
      return json({ ok: true, eventId, ji, overridden: !!bundled && ji !== bundled.ji, inOps: true, total });
    }

    if (b.action === 'reset') {
      delete cfg.ji[eventId];
      await writeEventConfig(cfg);
      await appendAudit(eventId, [bundled
        ? { by, area: 'Admin', action: 'changed', item: 'Joining Instructions value', field: 'ji', from: before, to: bundled.ji }
        : { by, area: 'Admin', action: 'removed', item: 'Event taken out of Ops (data kept)' }]);
      return json({ ok: true, eventId, ji: bundled ? bundled.ji : '', overridden: false, inOps: !!bundled });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
};

export const config = { path: '/api/admin-events' };
