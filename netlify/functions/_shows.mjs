export const EVENTS = [
  { id: 'cn-mc-ice',        brand: 'CN',     name: 'Masterclass – Internal Comms Events',      short: 'MC ICE',         date: '2026-07-10', ji: 'CN - MC - 26 - ICE' },
  { id: 'cn-cls',           brand: 'CN',     name: 'Creative Leaders Summit',                   short: 'CLS',            date: '2026-07-29', ji: 'CN CLS 26' },
  { id: 'cn-mc-incentives', brand: 'CN',     name: 'Masterclass – Incentives',                 short: 'MC Incentives',  date: '2026-08-11', ji: 'CN - MC - 26 - Incentives' },
  { id: 'cn-als',           brand: 'CN',     name: 'Agency Leaders Summit',                     short: 'ALS',            date: '2026-09-09', ji: 'CN ALS 26' },
  { id: 'cn-mc-bea',        brand: 'CN',     name: 'Masterclass – Brand Events & Activations', short: 'MC BE&A',        date: '2026-10-08', ji: 'CN - MC - 26 - BE&A' },
  { id: 'cn-cels',          brand: 'CN',     name: 'Corporate Event Leaders Summit',            short: 'CELS',           date: '2026-11-25', ji: 'CN - CELS - 26' },
  { id: 'cn-mc-pe',         brand: 'CN',     name: 'Masterclass – Public Events',              short: 'MC PE',          date: '2027-01-12', ji: 'CN - MC - 26 - PE' },

  { id: 'en-lc-consumer',   brand: 'EN',     name: 'Launch Club – Consumer Shows',             short: 'LC Consumer',    date: '2026-06-26', ji: 'EN - LC CS - 26' },
  { id: 'en-lc-trade',      brand: 'EN',     name: 'Launch Club – Trade Shows',                short: 'LC Trade',       date: '2026-08-26', ji: 'EN - LC TS - 26' },
  { id: 'en-ols',           brand: 'EN',     name: 'Operations Leaders Summit',                 short: 'OLS',            date: '2026-09-13', ji: 'EN - OLS - 26' },
  { id: 'en-lc-conferences',brand: 'EN',     name: 'Launch Club – Conferences',                short: 'LC Conferences', date: '2026-10-08', ji: 'EN - LC Conferences - 26' },
  { id: 'en-indy-expo',     brand: 'EN',     name: 'Indy Summit',                               short: 'Indy Summit',    date: '2026-10-21', ji: 'EN - Indy Summit - 26' },
  { id: 'en-mls',           brand: 'EN',     name: 'Marketing Leaders Summit',                  short: 'MLS',            date: '2027-01-14', ji: 'EN - MLS - 27' },
  { id: 'en-sls',           brand: 'EN',     name: 'Sales Leaders Summit',                      short: 'SLS',            date: '2027-01-14', ji: 'EN - SLS - 27' },
  { id: 'en-lc-awards',     brand: 'EN',     name: 'Launch Club – Awards',                     short: 'LC Awards',      date: '2027-01-28', ji: 'EN - LC Awards - 27' },

  { id: 'aaa-ls',           brand: 'AAA',    name: 'Leaders Summit',                            short: 'LS',             date: '2026-10-07', ji: 'AAA - LS - 26' },
  { id: 'aaa-eps',          brand: 'AAA',    name: 'Event Producers Summit',                    short: 'EPS',            date: '2027-01-21', ji: 'AAA - Event Producers Summit - 27' },

  { id: 'pas-dc-legal',     brand: 'PAS',    name: 'Diners Club – Legal',                      short: 'DC Legal',       date: '2026-06-11', ji: 'PAS - DC Legal - 26' },
  { id: 'pas-dc-financial', brand: 'PAS',    name: 'Diners Club – Financial & Prof. Services', short: 'DC Financial',   date: '2026-09-10', ji: 'PAS - DC Financial - 26' },
  { id: 'pas-dc-medical',   brand: 'PAS',    name: 'Diners Club – Medical',                    short: 'DC Medical',     date: '2026-11-10', ji: 'PAS - DC Medical - 26' },
  { id: 'pas-dc-hnwi',      brand: 'PAS',    name: 'Diners Club – HNWI',                       short: 'DC HNWI',        date: '2027-01-14', ji: 'PAS - DC HNWI - 27' },

  { id: 'cfx-gets',         brand: 'CONFEX', name: 'GETS',                                      short: 'GETS',           date: '2026-07-09', ji: 'CFX GETS 26' },
];

export const BRANDS = ['CN', 'EN', 'AAA', 'PAS', 'CONFEX'];
export const eventById = (id) => EVENTS.find(e => e.id === id);

// ---------------------------------------------------------------------------
// Joining Instructions overrides
//
// The list above is the bundled default. Ops can repoint any event's JI value
// from the portal's Admin tab without a code change; those overrides live in
// Blobs under their own key (NOT in portal-state-v1, whose writes replace the
// whole object and would clobber them).
//
// Use loadEvents() anywhere the *effective* JI value matters. EVENTS stays the
// static default so nothing breaks if Blobs is unavailable.
// ---------------------------------------------------------------------------
import { getStore } from '@netlify/blobs';

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

// The bundled list with any saved JI overrides applied.
export async function loadEvents() {
  const { ji } = await readEventConfig();
  if (!ji || !Object.keys(ji).length) return EVENTS;
  return EVENTS.map(e => (ji[e.id] ? { ...e, ji: ji[e.id] } : e));
}

export async function loadEventById(id) {
  return (await loadEvents()).find(e => e.id === id);
}
