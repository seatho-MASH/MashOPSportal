// Change log ("History" tab). One Blobs key per event: audit-v1/<eventId>,
// an array of entries, newest last, capped. Writers call appendAudit() after a
// successful save; readers use /api/audit.
//
// Entry: { at, by, area, action: 'added'|'removed'|'changed', item, field?, from?, to? }
//
// `by` is the signed-in user's email as sent by the page (x-portal-user header).
// It is self-reported, not verified server-side — good enough for "who did this?",
// not for security.
import { getStore } from '@netlify/blobs';
import { STORE_NAME } from './_shows.mjs';

const PREFIX = 'audit-v1/';
const CAP = 2000;
const MERGE_MS = 3 * 60 * 1000; // typing bursts on one field collapse into one entry

export function whoFrom(req) {
  const h = (req.headers.get('x-portal-user') || '').toLowerCase();
  return h.replace(/[^a-z0-9.@+_\- ]/g, '').slice(0, 120) || 'unknown';
}

const short = v => { const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return s.length > 120 ? s.slice(0, 117) + '…' : s; };

export async function appendAudit(eventId, entries, store) {
  if (!eventId || !entries || !entries.length) return;
  try {
    store = store || getStore(STORE_NAME);
    const key = PREFIX + eventId;
    const log = (await store.get(key, { type: 'json' })) || [];
    const at = new Date().toISOString(), now = Date.now();
    for (const raw of entries) {
      const e = { at, ...raw, from: raw.from === undefined ? undefined : short(raw.from), to: raw.to === undefined ? undefined : short(raw.to) };
      const last = log[log.length - 1];
      if (last && e.action === 'changed' && last.action === 'changed' && last.by === e.by && last.area === e.area &&
          last.item === e.item && last.field === e.field && now - Date.parse(last.at) < MERGE_MS) {
        last.to = e.to; last.at = at;              // keep the original `from`
        if (last.from === last.to) log.pop();      // edited back to where it started
        continue;
      }
      log.push(e);
    }
    await store.setJSON(key, log.slice(-CAP));
  } catch { /* the log must never break a save */ }
}

export async function readAudit(eventId, store) {
  store = store || getStore(STORE_NAME);
  return (await store.get(PREFIX + eventId, { type: 'json' })) || [];
}

// ---------------------------------------------------------------------------
// Diff of the Ops store (portal-state-v1) → { [eventId]: [entries] }
// ---------------------------------------------------------------------------
const SKIP = new Set(['id', 'addedAt', 'contacts', 'deleted', 'idSource', 'hubspotId', 'firstname', 'lastname']);
const LISTS = [
  ['sponsors', 'Sponsors', x => x.company],
  ['speakers', 'Speakers', x => x.name],
  ['delegates', 'Delegates (manual)', x => x.name],
  ['staff', 'Staff', x => x.name],
];
const ONSITE_LABEL = k => k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

function diffList(before, after, area, label, by, out) {
  const old = new Map((before || []).filter(Boolean).map(x => [x.id, x]));
  for (const x of after || []) {
    if (!x) continue;
    const o = old.get(x.id), name = label(x) || '(unnamed)';
    if (!o) { if (!x.deleted) out.push({ by, area, action: 'added', item: name }); }
    else if (!o.deleted && x.deleted) out.push({ by, area, action: 'removed', item: name });
    else if (o.deleted && !x.deleted) out.push({ by, area, action: 'added', item: name, field: 'restored' });
    else if (!x.deleted) {
      for (const k of new Set([...Object.keys(o), ...Object.keys(x)])) {
        if (SKIP.has(k)) continue;
        const a = o[k], b = x[k];
        if (typeof a === 'object' || typeof b === 'object') continue;
        if (String(a ?? '') !== String(b ?? '')) out.push({ by, area, action: 'changed', item: name, field: k, from: a ?? '', to: b ?? '' });
      }
    }
    if (area === 'Sponsors' && !x.deleted) diffList(o && o.contacts, x.contacts, 'Sponsor attendees', c => (c.name || c.email || '') + ' (' + name + ')', by, out);
  }
}

export function diffPortalState(before, after, by) {
  before = before || {}; after = after || {};
  const res = {};
  const push = (ev, list) => { if (list.length) (res[ev] = res[ev] || []).push(...list); };
  for (const [key, area, label] of LISTS) {
    const B = before[key] || {}, A = after[key] || {};
    for (const ev of Object.keys(A)) { const out = []; diffList(B[ev], A[ev], area, label, by, out); push(ev, out); }
  }
  const OB = before.onsite || {}, OA = after.onsite || {};
  for (const ev of Object.keys(OA)) {
    const a = OB[ev] || {}, b = OA[ev] || {}, out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (typeof a[k] === 'object' || typeof b[k] === 'object') continue;
      if (String(a[k] ?? '') !== String(b[k] ?? '')) out.push({ by, area: 'On-site details', action: 'changed', item: ONSITE_LABEL(k), field: k, from: a[k] ?? '', to: b[k] ?? '' });
    }
    push(ev, out);
  }
  const RB = before.rooms || {}, RA = after.rooms || {};
  for (const ev of new Set([...Object.keys(RB), ...Object.keys(RA)])) {
    const a = new Set(Object.keys(RB[ev] || {})), b = new Set(Object.keys(RA[ev] || {}));
    const on = [...b].filter(k => !a.has(k)).length, off = [...a].filter(k => !b.has(k)).length;
    if (on || off) push(ev, [{ by, area: 'Rooms', action: 'changed', item: 'Room allocation', field: 'rooms', from: a.size, to: b.size }]);
  }
  const NB = before.notes || {}, NA = after.notes || {};
  for (const ev of Object.keys(NA)) {
    const out = [];
    for (const [rec, v] of Object.entries(NA[ev] || {})) {
      const o = (NB[ev] || {})[rec];
      if (String(o ?? '') !== String(v ?? '')) out.push({ by, area: 'Delegates', action: 'changed', item: 'Delegate note (record ' + rec + ')', field: 'note', from: o ?? '', to: v ?? '' });
    }
    push(ev, out);
  }
  return res;
}
