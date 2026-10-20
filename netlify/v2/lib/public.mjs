// Read-only data the event calendar shows, without sign-in (same shapes as the
// current portal's /api/public-staffing and /api/community-summary, so the calendar
// only needs its URLs repointed). Names and counts only, no emails or needs.
import { q } from './db.mjs';
import { json } from './http.mjs';
import { cover } from './community.mjs';
import { roomSummary } from './attendees.mjs';
import { personKey } from './legacy.mjs';

const ORIGIN = () => process.env.PORTAL_ORIGIN || '*';
const cors = (extra = {}) => ({ 'access-control-allow-origin': ORIGIN(), 'cache-control': 'no-store', ...extra });
const out = (b, s = 200) => json(b, s, cors());

// Event ids the calendar asks with → v2 ids, and v2 ids → every id to answer under.
async function ids() {
  const al = await q('select legacy_id, event_id from event_alias');
  return { toV2: Object.fromEntries(al.map(a => [a.legacy_id, a.event_id])), legacyOf: al.reduce((m, a) => ((m[a.event_id] ||= []).push(a.legacy_id), m), {}) };
}
async function roomsByType(ev) {
  const keys = (await q('select person_key from room_need where event_id=$1', [ev.id])).map(r => r.person_key);
  const rows = await q('select kind, email, scan_id, legacy_id, id, removed_at from attendee where event_id=$1', [ev.id]);
  const PRI = { speaker: 1, sponsor: 2, delegate: 3, staff: 4 }, T = { speaker: 'Speaker', sponsor: 'Sponsor', delegate: 'Delegate', staff: 'Staff' };
  const type = {}, dead = new Set();
  for (const r of rows) { const k = personKey({ email: r.email, scanId: r.scan_id, id: r.legacy_id || r.id }); if (r.removed_at) { dead.add(k); continue; } if (!type[k] || PRI[r.kind] < PRI[type[k]]) type[k] = r.kind; }
  const by = { Delegate: 0, Sponsor: 0, Speaker: 0, Staff: 0 };
  for (const k of keys) { if (!type[k] && dead.has(k)) continue; by[T[type[k] || 'delegate']]++; }
  return by;
}
const onsiteOf = (o) => (o ? { dressCode: o.dress_code || '', arrival: o.arrival || '', finish: o.finish || '', station: o.station || '' } : {});

export async function publicHandle(req) {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors({ 'access-control-allow-methods': 'GET,OPTIONS', 'access-control-allow-headers': 'content-type' }) });
  if (req.method !== 'GET') return out({ error: 'Method not allowed' }, 405);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/v2-public/, '');
  try {
    const { toV2, legacyOf } = await ids();
    if (path === '/staffing') {
      const asked = url.searchParams.get('event');
      if (asked) {
        const id = toV2[asked] || asked;
        const ev = (await q('select * from event where id=$1', [id]))[0];
        if (!ev) return out({ event: asked, staff: [], onsite: {}, roomsRequired: 0, roomsByType: { Delegate: 0, Sponsor: 0, Speaker: 0, Staff: 0 } });
        const staff = (await q("select name, job_title, external from attendee where event_id=$1 and kind='staff' and removed_at is null order by name", [id])).map(s => ({ name: s.name, jobtitle: s.job_title || '', external: s.external }));
        const o = (await q('select * from event_onsite where event_id=$1', [id]))[0];
        return out({ event: asked, staff, onsite: onsiteOf(o), roomsRequired: (await roomSummary(ev)).allocated, roomsByType: await roomsByType(ev) });
      }
      const evs = await q(`select e.* from event e where exists (select 1 from attendee a where a.event_id=e.id and a.kind='staff')
                             or exists (select 1 from event_onsite o where o.event_id=e.id) or exists (select 1 from room_need r where r.event_id=e.id)`);
      const events = {};
      for (const ev of evs) {
        const n = (await q("select count(*)::int n from attendee where event_id=$1 and kind='staff' and removed_at is null", [ev.id]))[0].n;
        const o = (await q('select * from event_onsite where event_id=$1', [ev.id]))[0];
        const v = { count: n, onsite: onsiteOf(o), roomsRequired: (await roomSummary(ev)).allocated };
        events[ev.id] = v; for (const l of legacyOf[ev.id] || []) events[l] = v;
      }
      return out({ events });
    }
    if (path === '/community-summary') {
      const c = await cover({ past: true });
      const events = {};
      for (const e of c.events) {
        if (!(e.demand || e.required || e.count != null)) continue;
        const v = { required: e.required, count: e.count, demand: e.demand, sponsors: e.sponsors, delivered: e.delivered };
        events[e.id] = v; for (const l of legacyOf[e.id] || []) events[l] = v;
      }
      return out({ events, updatedAt: new Date().toISOString() });
    }
    return out({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('public', path, e);
    return out({ error: 'Unavailable' }, 500);
  }
}
