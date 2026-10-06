// Event list for the Ops portal.
//
// Names, dates, venues and cancellations come from the event calendar
// (mashportal /api/calendar = the SharePoint Events list), so a moved or renamed
// event updates here on its own. Ops adds one thing on top: the HubSpot
// "Joining Instructions" (JI) value that decides which contacts are delegates.
//
// An event appears in Ops when it has a JI value:
//   - the bundled EVENTS below (the events Ops had before the calendar feed), or
//   - any calendar event given a JI value from the Admin tab (no code change).
//
// Bundled ids are kept for good: every stored record (sponsors, staff, rooms,
// community) is keyed by them. `cal` links the ones whose calendar id differs.
// If the calendar is unreachable, the bundled list is used as-is.
import { getStore } from '@netlify/blobs';

export const EVENTS = [
  { id: 'cn-mc-ice',        cal: 'cn-mc-internal-comms-events',            brand: 'CN',     name: 'Masterclass – Internal Comms Events',      short: 'MC ICE',         date: '2026-07-10', ji: 'CN - MC - 26 - ICE' },
  { id: 'cn-cls',                                                          brand: 'CN',     name: 'Creative Leaders Summit',                   short: 'CLS',            date: '2026-07-29', ji: 'CN CLS 26' },
  { id: 'cn-mc-incentives',                                                brand: 'CN',     name: 'Masterclass – Incentives',                 short: 'MC Incentives',  date: '2026-08-11', ji: 'CN - MC - 26 - Incentives' },
  { id: 'cn-als',                                                          brand: 'CN',     name: 'Agency Leaders Summit',                     short: 'ALS',            date: '2026-09-09', ji: 'CN ALS 26' },
  { id: 'cn-mc-bea',        cal: 'cn-mc-brand-events-activations',         brand: 'CN',     name: 'Masterclass – Brand Events & Activations', short: 'MC BE&A',        date: '2026-10-08', ji: 'CN - MC - 26 - BE&A' },
  { id: 'cn-cels',                                                         brand: 'CN',     name: 'Corporate Event Leaders Summit',            short: 'CELS',           date: '2026-11-25', ji: 'CN - CELS - 26' },
  { id: 'cn-mc-pe',         cal: 'cn-mc-public-events',                    brand: 'CN',     name: 'Masterclass – Public Events',              short: 'MC PE',          date: '2027-01-12', ji: 'CN - MC - 26 - PE' },

  { id: 'en-lc-consumer',   cal: 'en-lc-cs',                               brand: 'EN',     name: 'Launch Club – Consumer Shows',             short: 'LC Consumer',    date: '2026-06-26', ji: 'EN - LC CS - 26' },
  { id: 'en-lc-trade',      cal: 'en-lc-ts',                               brand: 'EN',     name: 'Launch Club – Trade Shows',                short: 'LC Trade',       date: '2026-08-26', ji: 'EN - LC TS - 26' },
  { id: 'en-ols',                                                          brand: 'EN',     name: 'Operations Leaders Summit',                 short: 'OLS',            date: '2026-09-13', ji: 'EN - OLS - 26' },
  { id: 'en-lc-conferences',cal: 'en-lc-conf',                             brand: 'EN',     name: 'Launch Club – Conferences',                short: 'LC Conferences', date: '2026-10-08', ji: 'EN - LC Conferences - 26' },
  { id: 'en-indy-expo',                                                    brand: 'EN',     name: 'Indy Summit',                               short: 'Indy Summit',    date: '2026-10-21', ji: 'EN - Indy Summit - 26' },
  { id: 'en-mls',                                                          brand: 'EN',     name: 'Marketing Leaders Summit',                  short: 'MLS',            date: '2027-01-14', ji: 'EN - MLS - 27' },
  { id: 'en-sls',                                                          brand: 'EN',     name: 'Sales Leaders Summit',                      short: 'SLS',            date: '2027-01-14', ji: 'EN - SLS - 27' },
  { id: 'en-lc-awards',                                                    brand: 'EN',     name: 'Launch Club – Awards',                     short: 'LC Awards',      date: '2027-01-28', ji: 'EN - LC Awards - 27' },

  { id: 'aaa-ls',                                                          brand: 'AAA',    name: 'Leaders Summit',                            short: 'LS',             date: '2026-10-07', ji: 'AAA - LS - 26' },
  { id: 'aaa-eps',          cal: 'aaa-event-producers-summit',             brand: 'AAA',    name: 'Event Producers Summit',                    short: 'EPS',            date: '2027-01-21', ji: 'AAA - Event Producers Summit - 27' },

  { id: 'pas-dc-legal',                                                    brand: 'PAS',    name: 'Diners Club – Legal',                      short: 'DC Legal',       date: '2026-06-11', ji: 'PAS - DC Legal - 26' },
  { id: 'pas-dc-financial', cal: 'pas-dc-financial-professional-services', brand: 'PAS',    name: 'Diners Club – Financial & Prof. Services', short: 'DC Financial',   date: '2026-09-10', ji: 'PAS - DC Financial - 26' },
  { id: 'pas-dc-medical',                                                  brand: 'PAS',    name: 'Diners Club – Medical',                    short: 'DC Medical',     date: '2026-11-10', ji: 'PAS - DC Medical - 26' },
  { id: 'pas-dc-hnwi',                                                     brand: 'PAS',    name: 'Diners Club – HNWI',                       short: 'DC HNWI',        date: '2027-01-14', ji: 'PAS - DC HNWI - 27' },

  { id: 'cfx-gets',                                                        brand: 'CONFEX', name: 'GETS',                                      short: 'GETS',           date: '2026-07-09', ji: 'CFX GETS 26' },
];

export const BRANDS = ['CN', 'EN', 'AAA', 'PAS', 'CONFEX'];
export const eventById = (id) => EVENTS.find(e => e.id === id);

// ---------------------------------------------------------------------------
// Admin-tab settings. Lives in Blobs under its own key (NOT in portal-state-v1,
// whose writes replace the whole object and would clobber it).
//   ji: { [eventId]: value }  — override for a bundled event, OR the JI value
//                               that adds a calendar event to Ops (keyed by
//                               its calendar id).
// ---------------------------------------------------------------------------
export const STORE_NAME = 'mash-attendee-portal';
export const CFG_KEY = 'event-config-v1';

export async function readEventConfig() {
  try {
    const store = getStore(STORE_NAME);
    const cfg = await store.get(CFG_KEY, { type: 'json' });
    return cfg && typeof cfg === 'object'
      ? { ji: cfg.ji || {}, updatedAt: cfg.updatedAt || null }
      : { ji: {}, updatedAt: null };
  } catch {
    return { ji: {}, updatedAt: null };   // Blobs unavailable -> fall back to defaults
  }
}

// ---------------------------------------------------------------------------
// Calendar feed (cached 5 min per warm function instance)
// ---------------------------------------------------------------------------
const CAL_URL = process.env.CAL_FEED_URL || 'https://mashportal.netlify.app/api/calendar';
const PORTFOLIO_BRAND = { CFX: 'CONFEX' };
export const brandOf = (portfolio) => PORTFOLIO_BRAND[portfolio] || portfolio || 'OTHER';

let _cal = null, _calAt = 0;
export async function readCalendar() {
  if (_cal && Date.now() - _calAt < 300000) return _cal;
  try {
    const r = await fetch(CAL_URL, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('calendar ' + r.status);
    const d = await r.json();
    _cal = (d.events || []).filter(e => e && e.id && !e.isSales && !e.isPrint);
    _calAt = Date.now();
  } catch { /* keep the last good copy, or null -> bundled list only */ }
  return _cal;
}

// The effective event list.
//   includeCalendarOnly: also return calendar events not yet in Ops (ji: '') — Admin tab only.
export async function loadEvents({ includeCalendarOnly = false } = {}) {
  const [{ ji }, cal] = await Promise.all([readEventConfig(), readCalendar()]);
  const byCal = new Map((cal || []).map(c => [c.id, c]));
  const out = EVENTS.map(e => {
    const calId = e.cal || e.id, c = byCal.get(calId);
    const ev = {
      id: e.id, calId, brand: e.brand,
      name: (c && (c.fullName || c.name)) || e.name,
      short: (c && c.name) || e.short,
      date: (c && c.start) || e.date,
      end: (c && c.end) || '',
      venue: (c && c.location) || '',
      cancelled: !!(c && c.cancelled),
      ji: ji[e.id] || e.ji, jiDefault: e.ji,
      source: c ? 'calendar' : 'bundled',
    };
    return ev;
  });
  const taken = new Set(EVENTS.flatMap(e => [e.id, e.cal].filter(Boolean)));
  for (const c of cal || []) {
    if (taken.has(c.id)) continue;
    const v = ji[c.id] || '';
    if (!v && (!includeCalendarOnly || c.cancelled)) continue;
    out.push({
      id: c.id, calId: c.id, brand: brandOf(c.portfolio),
      name: c.fullName || c.name, short: c.name || c.fullName,
      date: c.start, end: c.end || '', venue: c.location || '', cancelled: !!c.cancelled,
      ji: v, jiDefault: '', source: 'calendar', added: true,
    });
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Accepts an Ops id or a calendar id.
export async function loadEventById(id) {
  const evs = await loadEvents();
  return evs.find(e => e.id === id) || evs.find(e => e.calId === id);
}
