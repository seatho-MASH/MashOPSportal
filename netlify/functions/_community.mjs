// Community planner (merged in from the old Community Portal, Oct 2026).
//
// State lives in this site's Blobs store under its OWN key, never inside
// portal-state-v1 (store.mjs rebuilds that object from a fixed list of fields
// and would silently drop anything else):
//
//   community-v1 = {
//     packages: [{id,name,meetings}]            // org-wide seed for new events
//     events: { [eventId]: {
//       slots, maxPerDelegate, delegateOverride,
//       packages: [{id,name,meetings}],         // per-event packages
//       assign:   { [sponsorId]: packageId },   // sponsor ids are Ops sponsor ids
//       updatedAt
//     } }
//   }
//
// Sponsors themselves are the Ops sponsors (portal-state-v1.sponsors) — there is
// no second copy. required / count / demand are computed on read, never stored,
// so the calendar always sees live figures (the old portal only refreshed them
// while someone had the page open).
import { getStore } from '@netlify/blobs';
import { STORE_NAME } from './_shows.mjs';

export const COMMUNITY_KEY = 'community-v1';
export const DEFAULT_PACKAGES = [
  { name: 'Headline', meetings: 15 },
  { name: 'Engagement', meetings: 10 },
  { name: 'Content', meetings: 10 },
];

// One-off migration source: the retired mashcommunity.netlify.app site. Only read
// when this store has no community state yet. Safe to remove once migrated.
const SEED_URL = process.env.COMMUNITY_SEED_URL ?? 'https://mashcommunity.netlify.app/api/community-store';

function norm(x) {
  x = x && typeof x === 'object' ? x : {};
  const events = x.events && typeof x.events === 'object' ? { ...x.events } : {};
  delete events['']; // phantom key written by the old portal before an event was selected
  for (const ev of Object.values(events)) if (ev) delete ev.computed; // now computed on read
  return { packages: Array.isArray(x.packages) ? x.packages : [], events, updatedAt: x.updatedAt || null };
}

export async function readCommunity(store = getStore(STORE_NAME)) {
  const cur = await store.get(COMMUNITY_KEY, { type: 'json' });
  if (cur) return norm(cur);
  if (SEED_URL) {
    try {
      const r = await fetch(SEED_URL);
      if (r.ok) {
        const seeded = norm(await r.json());
        if (Object.keys(seeded.events).length || seeded.packages.length) {
          seeded.migratedFrom = SEED_URL;
          seeded.updatedAt = new Date().toISOString();
          await store.setJSON(COMMUNITY_KEY, seeded);
          return seeded;
        }
      }
    } catch { /* old site gone or unreachable: start empty */ }
  }
  return norm(null);
}

// Same maths as the UI: the larger of the biggest single package and
// total meetings ÷ meetings-per-delegate (capped by the slot count).
export function computeEvent(evState, sponsors, liveCount) {
  const ev = evState || {};
  const pk = Array.isArray(ev.packages) ? ev.packages : [];
  const assign = ev.assign || {};
  const byId = Object.fromEntries(pk.map(p => [p.id, p]));
  const byName = Object.fromEntries(pk.map(p => [String(p.name || '').toLowerCase().trim(), p]));
  const meetings = (sponsors || []).filter(s => !s.deleted).map(s => {
    const p = byId[assign[s.id]] || byName[String(s.tier || '').toLowerCase().trim()];
    return p ? (+p.meetings || 0) : 0;
  });
  const demand = meetings.reduce((a, b) => a + b, 0);
  const maxSingle = meetings.length ? Math.max(...meetings) : 0;
  const slots = +ev.slots || 0, maxPd = +ev.maxPerDelegate || 0;
  const cap = maxPd > 0 ? (slots > 0 ? Math.min(maxPd, slots) : maxPd) : slots;
  const required = cap > 0 ? Math.max(maxSingle, Math.ceil(demand / cap)) : (demand > 0 ? null : maxSingle);
  const ov = String(ev.delegateOverride ?? '').trim();
  const count = ov !== '' ? (+ov || 0) : (liveCount ?? null);
  return { required, count, demand };
}
