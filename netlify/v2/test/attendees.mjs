// Checks for the tabs moved over from the current portal, against the real database
// with HubSpot mocked and a fake copy of the old Blobs store. Cleans up after itself.
import { handle } from '../lib/router.mjs';
import { publicHandle } from '../lib/public.mjs';
import { q } from '../lib/db.mjs';
import { briefingICS } from '../lib/staff.mjs';

const EV = 'zz-att-test', LEG = 'zz-att-old', U = { email: 'tester@mashmedia.net', name: 'Tester', admin: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
async function call(method, path, body, user = U) {
  const r = await handle(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined }), user);
  const j = await r.json(); if (r.status >= 400) j.__status = r.status; return j;
}
// --- HubSpot mock
const DELS = [
  { id: '501', properties: { firstname: 'Dana', lastname: 'Live', email: 'dana@example.test', jobtitle: 'Head of Events', associatedcompanyid: '9', pas_scan_id: 'ID501', dietary_requirements: 'Vegan', createdate: '2026-09-01' } },
  { id: '502', properties: { firstname: 'Eli', lastname: 'Live', email: 'eli@example.test', jobtitle: 'Producer', company: 'Eli Co', pas_scan_id: 'ID502' } },
  { id: '503', properties: { firstname: 'Spk', lastname: 'Both', email: 'both@example.test', pas_scan_id: 'ID503' } }];
let extraDel = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  if (!u.includes('api.hubapi.com')) return realFetch(u, o);
  const b = o.body ? JSON.parse(o.body) : {};
  const res = (x) => new Response(JSON.stringify(x), { status: 200 });
  if (u.includes('/companies/batch/read')) return res({ results: [{ id: '9', properties: { name: 'Dana Ltd' } }] });
  if (u.includes('/properties/contacts/joining_instructions')) return res({ options: [{ label: 'Test JI', value: 'ZZ JI 26' }, { label: 'Hidden', value: 'x', hidden: true }] });
  const f = b.filterGroups?.[0]?.filters?.[0] || {};
  if (f.propertyName === 'joining_instructions') { const list = extraDel ? [...DELS, { id: '504', properties: { firstname: 'New', lastname: 'Comer', email: 'new@example.test' } }] : DELS; return res({ total: list.length, results: b.limit === 1 ? [] : list }); }
  if (f.propertyName === 'email' && f.operator === 'IN') return res({ results: f.values.includes('matched@example.test') ? [{ id: '777', properties: { firstname: 'Mat', lastname: 'Ched', email: 'matched@example.test', pas_scan_id: 'ID777', jobtitle: 'CEO' } }] : [] });
  if (f.propertyName === 'email' && f.operator === 'CONTAINS_TOKEN') return res({ results: [{ id: '880', properties: { firstname: 'Staff', lastname: 'One', email: 'tester@mashmedia.net', pas_scan_id: 'ID880', jobtitle: 'Ops' } }, { id: '881', properties: { email: 'notonroster@mashmedia.net' } }] });
  return res({ results: [] });
};
process.env.HUBSPOT_TOKEN = 'test';

async function cleanup() {
  await q('delete from event where id = any($1)', [[EV, LEG + '-v2']]);
  await q('delete from event_alias where legacy_id=$1', [LEG]);
  await q("delete from audit_log where actor=$1 or (legacy and event_id = any($2))", [U.email, [EV, LEG + '-v2']]);
  await q("delete from staff_roster where email='tester@mashmedia.net'");
}
const savedSettings = await q('select * from setting');
try {
  await cleanup();
  await q(`insert into event (id, name, short_name, starts_on, ends_on, kind, ops_enabled, ops_ji, venue, rooms_total, build_days, breakdown_days)
           values ($1,'Attendee Test Summit','ATS','2027-04-14','2027-04-15','summit',true,'ZZ JI 26','Test Hall, London EC1A 1BB',5,1,1)`, [EV]);

  // delegates: live + first-seen baseline, then a newcomer gets today's date
  let d = await call('GET', `/api/events/${EV}/delegates`);
  ok(d.live === 3 && d.rows.find(r => r.email === 'dana@example.test').company === 'Dana Ltd', 'live delegates with company names ' + JSON.stringify(d.liveError));
  ok(d.rows.every(r => !r.addedAt), 'first load is the baseline (no added dates)');
  extraDel = true;
  d = await call('GET', `/api/events/${EV}/delegates?fresh=1`);
  ok(d.rows.find(r => r.email === 'new@example.test')?.addedAt, 'newcomer after the baseline gets a first-seen date');
  // walk-ins: matched by email vs generated badge
  const w = await call('POST', `/api/events/${EV}/people/delegate`, { rows: [{ name: 'Mat Ched', email: 'MATCHED@example.test' }, { name: 'Walk In', email: 'walk@example.test', dietary: 'None' }] });
  ok(w.matched === 1 && w.added[0].scanId === 'ID777' && w.added[0].idSource === 'hubspot', 'walk-in matched to HubSpot by email');
  ok(/^ATS0001$/.test(w.added[1].scanId) && w.added[1].idSource === 'generated', 'unmatched walk-in gets a generated badge ID ' + w.added[1].scanId);
  const w2 = await call('POST', `/api/events/${EV}/people/speaker`, { rows: [{ name: 'Spk Both', email: 'both@example.test', session: 'Keynote' }, { name: 'Gen Two', email: 'g2@example.test' }] });
  ok(w2.added[0].scanId === 'ATS0002' && w2.added[1].scanId === 'ATS0003', 'badge numbering carries on across lists');
  // sponsor + reps
  const sp = (await call('POST', `/api/events/${EV}/sponsors`, { company: 'Acme', tier: 'Headline' })).sponsor;
  const rep = await call('POST', `/api/events/${EV}/people/sponsor`, { rows: [{ name: 'Rep One', email: 'rep@example.test' }], sponsor_id: sp.id });
  ok(rep.added[0].company === 'Acme' && rep.added[0].sponsorId === sp.id, 'sponsor rep added under the sponsor');
  const noSp = await call('POST', `/api/events/${EV}/people/sponsor`, { rows: [{ name: 'X' }] });
  ok(noSp.__status === 400, 'rep needs a sponsor');
  const sl = await call('GET', `/api/events/${EV}/sponsors`);
  ok(sl.sponsors[0].reps.length === 1, 'sponsors list carries their reps');
  // rooms: per person, counted once across lists
  await call('PUT', `/api/events/${EV}/rooms`, { key: 'e:both@example.test', on: true });
  const r2 = await call('PUT', `/api/events/${EV}/rooms`, { key: 'e:walk@example.test', on: true });
  ok(r2.rooms.allocated === 2 && r2.rooms.total === 5, 'rooms allocated vs total from the calendar');
  const everyone = await call('GET', `/api/events/${EV}/everyone`);
  const both = everyone.rows.filter(r => r.email === 'both@example.test');
  ok(both.length === 1 && both[0].type === 'Speaker' && both[0].room, 'merged list: speaker wins over delegate, room shows once');
  ok(everyone.counts.Delegate === 5 && everyone.counts.Speaker === 2 && everyone.counts.Sponsor === 1, 'merged counts ' + JSON.stringify(everyone.counts));
  // notes on a live delegate; edit and remove a walk-in (room drops with them)
  await call('PUT', `/api/events/${EV}/delegate-notes/501`, { note: 'VIP table' });
  d = await call('GET', `/api/events/${EV}/delegates`);
  ok(d.rows.find(r => r.hubspotId === '501').note === 'VIP table', 'note on a live delegate');
  const walk = w.added[1];
  const up = await call('PATCH', `/api/people/${walk.id}`, { jobtitle: 'Buyer', dietary: 'Halal' });
  ok(up.person.jobtitle === 'Buyer' && up.person.dietary === 'Halal', 'edit a walk-in');
  await call('DELETE', `/api/people/${walk.id}`);
  const after = await call('GET', `/api/events/${EV}/people/delegate`);
  ok(!after.rows.some(r => r.id === walk.id) && after.rooms.allocated === 1, 'removed walk-in drops out and their room is freed');
  // staff: roster, tick on/off, on-site, station, briefing
  await call('POST', '/api/admin/roster', { email: 'tester@mashmedia.net' });
  ok((await call('POST', '/api/admin/roster', { email: 'x@gmail.com' })).__status === 400, 'roster only takes Mash addresses');
  const ro = await call('GET', '/api/staff-roster?fresh=1');
  ok(ro.staff.length === 1 && ro.staff[0].email === 'tester@mashmedia.net', 'roster is HubSpot staff filtered by the roster list');
  await call('PUT', `/api/events/${EV}/staff/880`, { on: true });
  await call('PUT', `/api/events/${EV}/staff/880`, { on: true });
  let stf = await call('GET', `/api/events/${EV}/people/staff`);
  ok(stf.rows.length === 1 && stf.rows[0].scanId === 'ID880' && stf.rows[0].idSource === 'roster', 'ticking staff on is idempotent, scan ID from roster');
  await call('PATCH', `/api/people/${stf.rows[0].id}`, { role: 'Registration', build: true });
  await call('PUT', `/api/events/${EV}/onsite`, { dress_code: 'Branded polo', arrival: '07:30', finish: '18:00', station: 'St Pauls' });
  const ext = await call('POST', `/api/events/${EV}/people/staff`, { rows: [{ name: 'Crew Ext', email: 'crew@example.test', external: true }] });
  ok(ext.added[0].external, 'external crew added');
  const st = await call('GET', `/api/events/${EV}/nearest-station`);
  ok(st.venue && Array.isArray(st.options), 'nearest station answers (' + (st.options[0]?.name || st.note) + ')');
  const br = await call('POST', `/api/events/${EV}/briefing`, {});
  const ob = await q("select to_email, subject, attachments from outbox where event_id=$1 and kind='briefing' order by to_email", [EV]);
  ok(br.queued === 2 && ob.length === 2 && ob[0].attachments[0].name === 'invite.ics', 'briefing queued with an invite for each attending staff');
  const ics = Buffer.from(ob.find(o => o.to_email === 'tester@mashmedia.net').attachments[0].content, 'base64').toString();
  ok(/Build: Attendee Test Summit/.test(ics) && /DTSTART;TZID=Europe\/London:20270414T073000/.test(ics) && /day 2 of 2/.test(ics) && !/Breakdown:/.test(ics), 'invite: build day for build crew, timed working days, no breakdown');
  // community planner
  let cm = await call('GET', `/api/events/${EV}/community`);
  ok(cm.packages.length === 3 && cm.sponsors[0].package_id && cm.sponsors[0].meetings === 15, 'default packages seeded; sponsor picks its package from its tier');
  const s2 = (await call('POST', `/api/events/${EV}/sponsors`, { company: 'Beta', tier: 'Engagement' })).sponsor;
  cm = await call('PUT', `/api/events/${EV}/community`, { slots: 8, max_per_delegate: 6 });
  ok(cm.result.demand === 25 && cm.result.cap === 6 && cm.result.required === 15, 'minimum = max(15, ceil(25/6)=5) = 15 ' + JSON.stringify(cm.result));
  cm = await call('PUT', `/api/events/${EV}/community`, { delegate_override: 12 });
  ok(cm.result.have === 12, 'override used instead of live count');
  const pk = cm.packages.find(p => p.name === 'Engagement');
  cm = await call('PATCH', `/api/community/packages/${encodeURIComponent(pk.id)}`, { name: 'Engage+', meetings: 4 });
  const beta = (await call('GET', `/api/events/${EV}/sponsors`)).sponsors.find(x => x.id === s2.id);
  ok(beta.tier === 'Engage+', 'renaming a package renames the manual sponsor tier');
  await call('PUT', `/api/sponsors/${sp.id}/delivered`, { delivered: 13 });
  const cov = await call('GET', '/api/community-cover');
  const mine = cov.events.find(e => e.id === EV);
  ok(mine && mine.required === 15 && mine.count === 12 && mine.delivered === 13, 'cross-event cover ' + JSON.stringify(mine));
  // public endpoints for the calendar
  const pub = async (p) => (await publicHandle(new Request('http://x/api/v2-public' + p))).json();
  const ps = await pub('/staffing?event=' + EV);
  ok(ps.staff.length === 2 && ps.onsite.arrival === '07:30' && ps.roomsRequired === 1 && ps.roomsByType.Speaker === 1 && !JSON.stringify(ps).includes('@'), 'public staffing: names only, rooms by type ' + JSON.stringify(ps.roomsByType));
  const pc = await pub('/community-summary');
  ok(pc.events[EV] && pc.events[EV].required === 15, 'public community summary');
  // admin JI dropdown + check
  const jo = await call('GET', '/api/admin/ji-options');
  ok(jo.options.length === 1 && jo.options[0].value === 'ZZ JI 26', 'JI dropdown values from HubSpot');
  ok((await call('POST', '/api/admin/ji-check', { ji: 'ZZ JI 26' })).total === 4, 'JI check counts matching contacts');
  // import from a fake old store
  await q(`insert into event (id, name, short_name, starts_on, kind, ops_enabled) values ($1,'Legacy Summit','LGS','2027-05-01','show',false)`, [LEG + '-v2']);
  await q('insert into event_alias (legacy_id, event_id) values ($1,$2)', [LEG, LEG + '-v2']);
  const blobs = {
    'portal-state-v1': {
      sponsors: { [LEG]: [{ id: 'sp1', company: 'Old Sponsor', tier: 'Headline', addedAt: '2026-08-01T10:00:00Z', contacts: [{ id: 'c1', name: 'Old Rep', email: 'OLDREP@example.test', scanId: 'LGS0003', idSource: 'generated' }, { id: 'c2', name: 'Gone Rep', deleted: true }] },
                            { id: 'sp2', company: 'Dropped', deleted: true, contacts: [] }] },
      speakers: { [LEG]: [{ id: 'k1', name: 'Old Speaker', email: 'spk@example.test', session: 'Panel', scanId: 'ID9' }] },
      delegates: { [LEG]: [{ id: 'd1', name: 'Old Walkin', email: 'ow@example.test', scanId: 'LGS0007', idSource: 'generated' }] },
      staff: { [LEG]: [{ id: 's1', rosterId: '880', name: 'Staff One', email: 'tester@mashmedia.net', scanId: 'ID880', role: 'Host', build: true }] },
      notes: { [LEG]: { 'd1': 'walk-in note', '9001': 'live note' } },
      seen: { [LEG]: { baseline: { '9000': 1 }, added: { '9001': '2026-09-20' } } },
      onsite: { [LEG]: { dressCode: 'Black', arrival: '08:00' } },
      rooms: { [LEG]: { 'e:oldrep@example.test': true, 'd1': true } },
    },
    'community-v1': { packages: [{ id: 'g1', name: 'Headline', meetings: 20 }], events: { [LEG]: { slots: 9, maxPerDelegate: 5, delegateOverride: '', packages: [{ id: 'p1', name: 'Headline', meetings: 20 }], assign: { sp1: 'p1' }, delivered: { sp1: 18 } } } },
    'event-config-v1': { ji: { [LEG]: 'LEGACY JI 27' } },
    ['audit-v1/' + LEG]: [{ at: '2026-10-07T09:00:00Z', by: 'someone@mashmedia.net', area: 'Sponsors', action: 'added', item: 'Old Sponsor' }, { at: '2026-10-08T09:00:00Z', by: 'someone@mashmedia.net', area: 'Speakers', action: 'changed', item: 'Old Speaker', field: 'session', from: 'Talk', to: 'Panel' }],
  };
  const store = { get: async (k) => blobs[k] ?? null };
  const { importLegacy } = await import('../lib/legacy.mjs');
  const rep1 = await importLegacy(U, { store, bundled: false });
  const rep2 = await importLegacy(U, { store, bundled: false });                     // re-runnable
  const L2 = LEG + '-v2';
  const evRow = (await q('select ops_ji, ops_enabled, kind from event where id=$1', [L2]))[0];
  ok(evRow.ops_ji === 'LEGACY JI 27' && evRow.ops_enabled && evRow.kind === 'summit', 'import sets JI, switches on, fixes a mis-guessed show');
  const spRows = await q('select company, removed_at, meetings_delivered from sponsor where event_id=$1 order by company', [L2]);
  ok(spRows.length === 2 && spRows.find(s => s.company === 'Dropped').removed_at && spRows.find(s => s.company === 'Old Sponsor').meetings_delivered === 18, 'sponsors imported once, deleted ones marked removed, delivered carried');
  const att = await q('select kind, name, email, scan_id, note, removed_at, role, build from attendee where event_id=$1 order by kind, name', [L2]);
  ok(att.length === 5 && att.find(a => a.name === 'Gone Rep').removed_at && att.find(a => a.name === 'Old Rep').email === 'oldrep@example.test', 'reps, speakers, walk-ins, staff imported once ' + att.length);
  ok(att.find(a => a.name === 'Old Walkin').note === 'walk-in note' && att.find(a => a.kind === 'staff').role === 'Host', 'walk-in note and staff role carried');
  ok((await q('select note from delegate_note where event_id=$1', [L2]))[0]?.note === 'live note', 'live delegate note carried');
  const seenRows = await q('select contact_id, first_seen from delegate_seen where event_id=$1 order by contact_id', [L2]);
  ok(seenRows.length === 2 && seenRows[0].first_seen === null && seenRows[1].first_seen, 'first-seen baseline and dates carried');
  const rk = (await q('select person_key from room_need where event_id=$1 order by 1', [L2])).map(r => r.person_key);
  ok(rk.length === 2 && rk.includes('e:oldrep@example.test') && rk.includes('e:ow@example.test'), 'rooms carried; old record-id keys become person keys ' + rk);
  const cmL = await call('GET', `/api/events/${L2}/community`);
  ok(cmL.settings.slots === 9 && cmL.result.required === 20 && cmL.sponsors[0].package_id, 'community plan carried with assignments');
  const hist = await call('GET', `/api/events/${L2}/history`);
  ok(hist.entries.filter(h => h.actor === 'someone@mashmedia.net').length === 2 && hist.entries.some(h => h.detail && h.detail.from === 'Talk'), 'old history imported once with original details');
  ok(rep1.events >= 1 && rep2.sponsors === rep1.sponsors, 'import report ' + JSON.stringify(rep1));
  const notAdmin = await call('POST', '/api/admin/import', null, { ...U, admin: false });
  ok(notAdmin.__status === 403, 'only admins can import');
  ok(typeof briefingICS === 'function', 'ics builder exported');
} catch (e) { fail++; console.log('  CRASH', e.stack); }
finally {
  globalThis.fetch = realFetch;
  await cleanup().catch(e => console.log('cleanup failed', e.message));
  await q('delete from setting');
  for (const r of savedSettings) await q('insert into setting (key, value, updated_at) values ($1,$2,$3)', [r.key, JSON.stringify(r.value), r.updated_at]);
  console.log(`\nattendees: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
