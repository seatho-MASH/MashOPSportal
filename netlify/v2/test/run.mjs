// End-to-end checks against a real database. Uses its own throwaway event and
// people (…@example.test) and removes them at the end.
//   DATABASE_URL=… OPS_SECRET_KEY=… npm test
import { handle } from '../lib/router.mjs';
import { q } from '../lib/db.mjs';
import apiFn from '../../functions/v2-api.mjs';

const EV = 'zz-ops-test-event', U = { email: 'tester@mashmedia.net', name: 'Tester', admin: true };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
async function call(method, path, body, user = U) {
  const r = await handle(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined }), user);
  const j = await r.json(); if (r.status >= 400) j.__status = r.status; return j;
}
const L = (hhmm) => `2027-03-03T${hhmm}:00Z`;   // March: London = UTC

async function cleanup() {
  await q("delete from points_entry where person_id in (select id from person where email like '%@example.test')");
  await q("delete from kit_item where sticker like 'ZZ-%'");
  await q('delete from event where id=$1', [EV]);
  await q("delete from person where email like '%@example.test'");
  await q("delete from audit_log where actor=$1", [U.email]);
}
try {
  await cleanup();
  await q(`insert into event (id, name, short_name, starts_on, ends_on, kind, ops_enabled, venue) values ($1,'Test Show 2027','TS27','2027-03-03','2027-03-04','show',true,'Test Venue')`, [EV]);

  // auth: no token → 401 from the real function
  const r401 = await apiFn(new Request('http://x/api/me'));
  ok(r401.status === 401, 'no token is refused');
  const rBad = await apiFn(new Request('http://x/api/me', { headers: { authorization: 'Bearer abc.def.ghi' } }));
  ok(rBad.status === 401, 'forged token is refused');

  // calendar sync (live feed)
  const sync = await call('POST', '/api/sync/calendar');
  ok(sync.ok && sync.events > 20, 'calendar sync ' + JSON.stringify(sync));
  const notAdmin = await call('POST', '/api/sync/calendar', null, { ...U, admin: false });
  ok(notAdmin.__status === 403, 'non-admin cannot sync');
  const evs = await call('GET', '/api/events?all=1');
  ok(evs.events.some(e => e.id === 'eps-event-production-show' && e.kind === 'show'), 'EPS synced as a show');

  // theatres, sessions
  const t1 = (await call('POST', `/api/events/${EV}/theatres`, { name: 'Theatre 1' })).theatre;
  const t2 = (await call('POST', `/api/events/${EV}/theatres`, { name: 'Theatre 2', ninja_location: 'Main Hall B' })).theatre;
  const imp = await call('POST', `/api/events/${EV}/sessions/import`, { rows: [
    { title: 'Keynote', theatre: 'Theatre 1', day: '2027-03-03', start: '10:00', end: '11:00', ninja_id: 'N1' },
    { title: 'Panel', location: 'Main Hall B', day: '2027-03-03', start: '11:00', end: '12:00', ninja_id: 'N2' },
    { title: 'Broken', theatre: 'Theatre 1', day: '2027-03-03', start: '13:00', end: '12:00' }]});
  ok(imp.imported === 2 && imp.errors.length === 1, 'session import 2 ok 1 error ' + JSON.stringify(imp));
  const re = await call('POST', `/api/events/${EV}/sessions/import`, { rows: [{ title: 'Keynote (moved)', theatre: 'Theatre 1', day: '2027-03-03', start: '10:30', end: '11:30', ninja_id: 'N1' }] });
  const sessN = (await q('select count(*)::int n from session where event_id=$1', [EV]))[0].n;
  ok(re.imported === 1 && sessN === 2, 're-import by Ninja id updates, not duplicates');

  // crew
  const ci = await call('POST', `/api/events/${EV}/crew/import`, { rows: [
    { first_name: 'Ana', last_name: 'One', email: 'ana@example.test', role: 'Steward' },
    { first_name: 'Ben', last_name: 'Two', email: 'ben@example.test', role: 'Mic runner' },
    { first_name: 'Cal', last_name: 'Three', email: 'cal@example.test', role: 'Steward' },
    { first_name: 'Dee', last_name: 'Four', email: 'dee@example.test' }]});
  ok(ci.imported === 4, 'crew import');
  const ppl = Object.fromEntries((await q("select id, first_name from person where email like '%@example.test'")).map(r => [r.first_name, r.id]));

  // rules + assignments + gaps
  const roles = Object.fromEntries((await q('select id, name from crew_role')).map(r => [r.name, r.id]));
  await call('POST', `/api/events/${EV}/rules`, { theatre_id: t1.id, role: 'Steward', min_count: 2, from_at: L('09:00'), to_at: L('17:00') });
  await call('POST', `/api/events/${EV}/rules`, { theatre_id: null, role: 'Mic runner', min_count: 1, from_at: L('10:00'), to_at: L('12:00') });
  await call('POST', `/api/events/${EV}/assignments`, { person_id: ppl.Ana, theatre_id: t1.id, role: 'Steward', starts_at: L('09:00'), ends_at: L('17:00') });
  await call('POST', `/api/events/${EV}/assignments`, { person_id: ppl.Cal, theatre_id: t1.id, role: 'Steward', starts_at: L('09:00'), ends_at: L('13:00') });
  await call('POST', `/api/events/${EV}/assignments`, { person_id: ppl.Dee, theatre_id: t1.id, role: 'Steward', starts_at: L('12:00'), ends_at: L('17:00') });
  await call('POST', `/api/events/${EV}/assignments`, { person_id: ppl.Ben, theatre_id: t1.id, role: 'Mic runner', starts_at: L('10:00'), ends_at: L('12:00') });
  const clash = await call('POST', `/api/events/${EV}/assignments`, { person_id: ppl.Ben, theatre_id: t2.id, role: 'Mic runner', starts_at: L('11:00'), ends_at: L('12:00') });
  ok(clash.__status === 400 && /already on/.test(clash.error), 'double-booking refused');
  let rota = await call('GET', `/api/events/${EV}/rota?day=2027-03-03`);
  const g2 = rota.gaps.filter(g => g.theatre === 'Theatre 2');
  ok(g2.length === 1 && g2[0].role === 'Mic runner' && +new Date(g2[0].from) === +new Date(L('10:00')) && +new Date(g2[0].to) === +new Date(L('12:00')), 'Theatre 2 mic runner gap 10–12 ' + JSON.stringify(g2.map(g => [g.from, g.to])));
  ok(!rota.gaps.some(g => g.theatre === 'Theatre 1'), 'Theatre 1 fully covered');
  ok(g2[0].free.some(f => f.name === 'Dee Four') && !g2[0].free.some(f => f.name === 'Ana One'), 'free crew suggested for the gap, busy crew not');

  // breaks: window 12–14, 30 min. Ana can only go 12:00–13:00 (Cal+Dee cover), Dee only after 13:00 if Ana back… engine must keep 2 stewards
  await call('PUT', `/api/events/${EV}/break-rule`, { window_from: '12:00', window_to: '14:00', break_minutes: 30 });
  const prop = await call('POST', `/api/events/${EV}/breaks/propose`, { day: '2027-03-03' });
  const names = prop.proposals.map(p => p.name);
  ok(prop.proposals.length >= 1, 'break proposals made ' + JSON.stringify(prop));
  const acc = await call('POST', `/api/events/${EV}/breaks/accept`, { proposals: prop.proposals });
  rota = await call('GET', `/api/events/${EV}/rota?day=2027-03-03`);
  ok(acc.added === prop.proposals.length && !rota.gaps.some(g => g.theatre === 'Theatre 1'), 'accepted breaks leave Theatre 1 covered');
  console.log('   breaks:', prop.proposals.map(p => `${p.name} ${p.starts_at.slice(11,16)}`).join(', '), '| unplaced:', prop.unplaced.map(u => u.name).join(', ') || 'none');

  // schedules + fingerprint
  let st = await call('GET', `/api/events/${EV}/schedules`);
  ok(st.people.find(p => p.name === 'Ana One').status === 'never-sent', 'schedule never sent');
  process.env.OPS_MAIL_DRY_RUN = '1';
  const qd = await call('POST', `/api/events/${EV}/schedules/send`, { person_ids: [ppl.Ana, ppl.Ben] });
  ok(qd.queued === 2, 'schedules queued');
  const ob = await q("select * from outbox where event_id=$1 and kind='schedule'", [EV]);
  ok(ob.length === 2 && ob.every(m => m.html.includes('Test Show 2027')), 'outbox rows built');
  // simulate a send then a session move → "changed"
  for (const m of ob) await q("update outbox set status='sent' where id=$1", [m.id]), await q('insert into schedule_send (event_id, person_id, fingerprint) values ($1,$2,$3)', [EV, m.person_id, m.fingerprint]);
  st = await call('GET', `/api/events/${EV}/schedules`);
  ok(st.people.find(p => p.name === 'Ana One').status === 'up-to-date', 'up to date after send');
  await call('POST', `/api/events/${EV}/sessions/import`, { rows: [{ title: 'Keynote (moved again)', theatre: 'Theatre 1', day: '2027-03-03', start: '14:00', end: '15:00', ninja_id: 'N1' }] });
  st = await call('GET', `/api/events/${EV}/schedules`);
  ok(st.people.find(p => p.name === 'Ana One').status === 'changed', 'session move flags re-notify');

  // Grip login encryption
  process.env.OPS_SECRET_KEY = process.env.OPS_SECRET_KEY || Buffer.alloc(32, 7).toString('base64');
  await call('PUT', `/api/events/${EV}/credentials/${ppl.Ana}`, { username: 'ana.grip', password: 's3cret!' });
  const raw = (await q('select secret_enc from credential where person_id=$1', [ppl.Ana]))[0].secret_enc;
  ok(raw && !raw.includes('s3cret'), 'password stored encrypted');
  const rv = await call('GET', `/api/events/${EV}/credentials/${ppl.Ana}`);
  ok(rv.credential.password === 's3cret!', 'password decrypts for staff');
  ok((await q('select count(*)::int n from credential_view where person_id=$1', [ppl.Ana]))[0].n === 1, 'reveal is logged');
  const q2 = await call('POST', `/api/events/${EV}/schedules/send`, { person_ids: [ppl.Ana] });
  const mails = await q("select to_email, html from outbox where event_id=$1 and person_id=$2 order by created_at desc limit 1", [EV, ppl.Ana]);
  ok(mails[0].html.includes('ana.grip') && mails[0].to_email === 'ana@example.test', "Ana's email has Ana's login");
  const benMail = (await q("select html from outbox where event_id=$1 and person_id=$2", [EV, ppl.Ben]))[0].html;
  ok(!benMail.includes('ana.grip'), "Ben's email does not contain Ana's login");

  // check-in with offline replay
  const items = [{ client_id: 'zz-c1', person_id: ppl.Ana, day: '2027-03-03', present: true, at: L('08:40') }];
  const c1 = await call('POST', `/api/events/${EV}/checkin`, { items });
  const c2 = await call('POST', `/api/events/${EV}/checkin`, { items });
  ok(c1.saved === 1 && c2.saved === 0, 'offline replay is idempotent');
  const cl = await call('GET', `/api/events/${EV}/checkin?day=2027-03-03`);
  ok(cl.counts.here === 1 && cl.people.find(p => p.name === 'Ana One').present, 'Ana shows as here');
  await call('POST', `/api/events/${EV}/checkin`, { items: [{ client_id: 'zz-c2', person_id: ppl.Ana, day: '2027-03-03', present: false, at: L('08:45') }] });
  ok((await call('GET', `/api/events/${EV}/checkin?day=2027-03-03`)).counts.here === 0, 'un-tick works');

  // kit
  await call('POST', '/api/kit', { sticker: 'ZZ-14', kind: 'phone' });
  const iss = await call('POST', '/api/kit/ZZ-14/issue', { event_id: EV, person_id: ppl.Ana });
  const iss2 = await call('POST', '/api/kit/ZZ-14/issue', { event_id: EV, person_id: ppl.Ben });
  ok(iss.ok && iss2.__status === 400 && /already out with Ana/.test(iss2.error), 'kit cannot be issued twice');
  ok((await call('GET', `/api/events/${EV}/checkin?day=2027-03-03`)).people.find(p => p.name === 'Ana One').kit[0] === 'phone #ZZ-14', 'kit shows on check-in');
  const ret = await call('POST', '/api/kit/ZZ-14/return');
  ok(ret.ok && (await call('GET', `/api/kit?event=${EV}`)).history.some(h => h.returned_at), 'kit return recorded');

  // tables
  await call('POST', `/api/events/${EV}/tables`, { count: 3, seats: 4 });
  await call('POST', `/api/events/${EV}/guests`, { rows: [
    ...['A1','A2','A3'].map(n => ({ name: n, organisation: 'Alpha', dietary: 'Vegetarian' })),
    ...['B1','B2'].map(n => ({ name: n, organisation: 'Beta', dietary: 'none' })),
    ...['C1','C2','C3','C4','C5'].map(n => ({ name: n, organisation: 'Gamma', dietary: n === 'C1' ? 'gluten free' : '' }))]});
  const au = await call('POST', `/api/events/${EV}/seating/auto`);
  const tb = await call('GET', `/api/events/${EV}/tables`);
  const byOrg = (o) => new Set(tb.guests.filter(g => g.organisation === o).map(g => g.table_id));
  ok(au.seated === 10 && tb.totals.seated === 10, 'auto-seat fills 10 of 12 seats');
  ok(byOrg('Alpha').size === 1 && byOrg('Beta').size === 1, 'small parties kept together');
  ok(tb.diet.Vegetarian === 3 && tb.diet['Gluten-free'] === 1 && !tb.diet.Other, 'dietary totals ' + JSON.stringify(tb.diet));
  const full = tb.tables.find(t => tb.guests.filter(g => g.table_id === t.id).length === 4);
  const extra = (await call('POST', `/api/events/${EV}/guests`, { name: 'Late', organisation: 'Delta' })).added;
  const lateId = (await q("select id from guest where event_id=$1 and name='Late'", [EV]))[0].id;
  const over = await call('POST', `/api/events/${EV}/seating`, { guest_id: lateId, table_id: full.id });
  ok(extra === 1 && over.__status === 400 && /full/.test(over.error), 'cannot overfill a table');

  // leaderboards
  const pg = 'cn-agency100', se = '2026-27';
  await call('PUT', `/api/programmes/${pg}/${se}/rules`, { rules: [{ activity: 'Attended summit', points: 40 }, { activity: 'Referral', points: 50 }] });
  await call('POST', `/api/programmes/${pg}/${se}/import`, { rows: [{ email: 'ana@example.test', points: 300 }, { email: 'ben@example.test', points: 320 }, { email: '', points: 5 }] });
  await call('POST', `/api/programmes/${pg}/${se}/entries`, { email: 'ana@example.test', activity: 'Attended summit', event_id: EV });
  const noRule = await call('POST', `/api/programmes/${pg}/${se}/entries`, { email: 'ana@example.test', activity: 'Something else' });
  ok(noRule.__status === 400, 'activity without a rule needs points');
  await call('POST', `/api/programmes/${pg}/${se}/entries`, { email: 'cal@example.test', activity: 'Referral' });
  const lb = await call('GET', `/api/programmes/${pg}/${se}`);
  const mine = lb.rows.filter(r => /@example\.test$/.test(r.email));
  const ana = mine.find(r => r.name === 'Ana One');
  ok(ana.points === 340 && ana.entries === 2, 'Ana total 340 from 2 entries');
  const anaRank = ana.rank, benRow = mine.find(r => r.name === 'Ben Two');
  ok(anaRank < benRow.rank, 'ranked by points');
  const me = await call('GET', `/api/programmes/${pg}/${se}/people/${ppl.Ana}`);
  ok(me.byActivity['Attended summit'] === 40 && me.total === 340, 'breakdown by activity');

  // sponsors (manual; Ledger not configured)
  delete process.env.LEDGER_API_URL;
  await call('POST', `/api/events/${EV}/sponsors`, { company: 'Manual Co', tier: 'Headline' });
  const sp = await call('GET', `/api/events/${EV}/sponsors`);
  ok(sp.sponsors.length === 1 && sp.ledger.configured === false, 'manual sponsor, Ledger not connected');
  const syncNo = await call('POST', `/api/events/${EV}/sponsors/sync`);
  ok(syncNo.__status === 400 && /not connected/.test(syncNo.error), 'Ledger sync explains it is not connected');

  // scan check
  {
    const savedTpl = await q('select * from scan_template'); await q('delete from scan_template');
    try {
      await q("update event set ops_reg_code='EPS' where id=$1", [EV]);
      const realFetch = globalThis.fetch; process.env.HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || 'test';
      let hsBody = null;
      globalThis.fetch = async (u, o) => { if (String(u).includes('api.hubapi.com')) { hsBody = JSON.parse(o.body); return new Response(JSON.stringify({ results: [
        { id: '1', properties: { email: 'Ana@example.test', firstname: 'Ana', lastname: 'One', company: 'A Co', pas_scan_id: 'S1', registration_badging__27: 'EPS - Visitor' } },
        { id: '2', properties: { email: 'ben@example.test', firstname: 'Ben', lastname: 'Two', company: 'B Co', pas_scan_id: 'S2', registration_badging__27: 'EPS - VIP' } },
        { id: '3', properties: { email: 'cat@example.test', firstname: 'Cat', lastname: 'Three', company: 'C Co', pas_scan_id: 'S3', registration_badging__27: 'EPS - Visitor' } }] }), { status: 200 }); } return realFetch(u, o); };
      const hs = await call('POST', `/api/events/${EV}/scans/hubspot`);
      globalThis.fetch = realFetch;
      ok(hs.upload && hs.upload.rows === 3 && hsBody.filterGroups[0].filters[0].values.includes('Approved Supplier - EPS'), 'HubSpot pull uses EPS approved statuses');
      const big = await call('POST', `/api/events/${EV}/scans/upload`, { source: 'reftech', filename: 'r.csv', rows: [
        { email: 'ana@example.test', first_name: 'Ana', last_name: 'One', scan_id: 'S1', badge: 'VISITOR' },
        { email: 'ben@example.test', first_name: 'Ben', last_name: 'Two', scan_id: 'S2', badge: 'Visitor' }] });
      await call('POST', `/api/events/${EV}/scans/upload`, { source: 'reftech', rows: [{ email: 'dan@example.test', first_name: 'Dan', last_name: 'Four', company: 'D Co', scan_id: 'S4', badge: 'Visitor' }], append: big.upload.id });
      await call('POST', `/api/events/${EV}/scans/upload`, { source: 'grip', filename: 'g.csv', rows: [
        { email: 'ana@example.test', scan_id: 's1', badge: 'Visitor' }, { email: 'ben@example.test', scan_id: 'S9', badge: 'Visitor' }, { email: 'dan@example.test', scan_id: '', badge: 'Visitor' }] });
      const noMail = await call('POST', `/api/events/${EV}/scans/upload`, { source: 'grip', rows: [{ first_name: 'x' }, { first_name: 'y' }] });
      ok(noMail.__status === 400 && /email/.test(noMail.error), 'upload without emails is refused');
      let sc = await call('GET', `/api/events/${EV}/scans`);
      ok(sc.sources.reftech.rows === 3, 'chunked upload adds up');
      const miss = Object.fromEntries(sc.missing.map(m => [m.email, m.notIn.join(',')]));
      ok(miss['cat@example.test'] === 'reftech,grip' && miss['dan@example.test'] === 'hubspot' && !miss['ana@example.test'], 'missing per source ' + JSON.stringify(miss));
      ok(sc.badge.length === 1 && sc.badge[0].email === 'ben@example.test', 'badge mismatch: Ben VIP vs Visitor; case and prefix ignored');
      const scanBy = Object.fromEntries(sc.scan.map(x => [x.email, x.problem]));
      ok(/Grip and Reftech differ/.test(scanBy['ben@example.test']) && scanBy['dan@example.test'] === 'No scan ID in Grip' && !scanBy['ana@example.test'], 'scan ID check Grip vs Reftech, case-insensitive');
      // fix files
      let fx = await call('GET', `/api/events/${EV}/scans/fix/grip/scan`);
      ok(fx.rows === 2 && fx.csv.includes('S2') && fx.csv.includes('S4') && !fx.templated, 'Grip scan fixes from Reftech (plain layout)');
      fx = await call('GET', `/api/events/${EV}/scans/fix/reftech/add`);
      ok(fx.rows === 1 && fx.csv.includes('cat@example.test') && fx.csv.includes('S3'), 'add Cat to Reftech with HubSpot details');
      await call('PUT', '/api/scan-templates/grip', { filename: 'grip-template.csv', columns: [{ header: 'Email Address', field: 'email' }, { header: 'Badge Number', field: 'scan_id' }, { header: 'Event', field: '=TS27' }, { header: 'Notes', field: '' }] });
      fx = await call('GET', `/api/events/${EV}/scans/fix/grip/badge`);
      ok(fx.templated && fx.csv.split('\r\n')[0].endsWith('Email Address,Badge Number,Event,Notes') && fx.csv.includes('ben@example.test,S2,TS27,'), 'Grip fix file in its template ' + JSON.stringify(fx.csv));
      // Grip-style template: instruction rows kept, one file per badge type, event-specific beats default
      await call('PUT', '/api/scan-templates/grip', { event_id: EV, filename: 'Delegate_Confex-upload-template.csv', split_by_badge: true,
        preamble: [['* Indicates A Mandatory Field'], ['Registration IDs must be unique,\nno spaces', 'A unique email']],
        columns: [{ header: 'Registration ID*', field: 'registration_id' }, { header: 'Email*', field: 'email' }, { header: 'First Name*', field: 'first_name' },
          { header: 'Last Name*', field: 'last_name' }, { header: 'Headline', field: 'headline' }, { header: 'Scan ID', field: 'scan_id' }, { header: 'Job Function', field: '' }] });
      fx = await call('GET', `/api/events/${EV}/scans/fix/grip/add`);
      const lines = fx.files[0].csv.replace(/^\ufeff/, '').split('\r\n');
      ok(fx.split && fx.files.length === 1 && fx.files[0].badge === 'Visitor' && /add-people-visitor\.csv$/.test(fx.files[0].filename), 'split by badge type ' + JSON.stringify(fx.files.map(f => f.filename)));
      ok(lines[0] === '* Indicates A Mandatory Field' && lines[1].startsWith('"Registration IDs must be unique,') && lines[2].startsWith('Registration ID*,Email*'), 'instruction rows kept above header');
      ok(lines[3] === 'HS3,cat@example.test,Cat,Three,C Co,S3,', 'new person gets HS + HubSpot ID as Registration ID ' + JSON.stringify(lines[3]));
      await call('DELETE', `/api/scan-templates/grip?event=${EV}`);
      fx = await call('GET', `/api/events/${EV}/scans/fix/grip/add`);
      ok(!fx.split && fx.files[0].csv.includes('Email Address,Badge Number'), 'removing the event template falls back to the default');
      const tplBad = await call('PUT', '/api/scan-templates/grip', { columns: [{ header: 'X', field: 'company' }] });
      ok(tplBad.__status === 400, 'template needs an email column');
      const hsRow = sc.scan.find(x => x.email === 'ben@example.test');
      ok(sc.settings.scanTruth === 'hubspot' && hsRow.right === 'S2' && /match HubSpot/.test(hsRow.problem), 'HubSpot is the scan ID of record by default ' + JSON.stringify(hsRow));
      ok(sc.scan.find(x => x.email === 'dan@example.test').right === 'S4', 'no HubSpot ID (exhibitor) falls back to Reftech');
      await call('PUT', `/api/events/${EV}/scans/settings`, { scanTruth: 'reftech' });
      const own = await call('GET', `/api/events/${EV}/scans/fix/reftech/scan`);
      ok(own.__status === 400, 'no scan fix file for the source of record');
      // badge map + ack
      await call('PUT', `/api/events/${EV}/scans/badges`, { map: [{ source: 'hubspot', raw: 'EPS - VIP', canonical: 'Visitor' }] });
      await call('POST', `/api/events/${EV}/scans/ack`, { kind: 'missing', key: 'dan@example.test', note: 'Walk-up' });
      sc = await call('GET', `/api/events/${EV}/scans`);
      ok(sc.summary.badge === 0, 'badge map clears the mismatch');
      ok(sc.summary.missing === 1 && sc.missing.find(m => m.email === 'dan@example.test').acked, 'accepted exception drops out of the count');
      await call('PUT', `/api/events/${EV}/scans/settings`, { scanTruth: 'grip' });
      fx = await call('GET', `/api/events/${EV}/scans/fix/reftech/scan`);
      ok(fx.rows === 1 && fx.csv.includes('S9'), 'scan truth switch: Reftech fixed from Grip (Dan has no Grip ID)');
    } finally {
      await q('delete from scan_template');
      for (const t of savedTpl) await q('insert into scan_template (source, event_id, columns, preamble, split_by_badge, filename, by_user, at) values ($1,$2,$3,$4,$5,$6,$7,$8)', [t.source, t.event_id, JSON.stringify(t.columns), JSON.stringify(t.preamble), t.split_by_badge, t.filename, t.by_user, t.at]);
    }
  }

  // home + history
  const home = await call('GET', `/api/events/${EV}/home`);
  ok(home.numbers.crew.total === 4 && home.numbers.theatres === 2 && home.attention.some(a => a.type === 'gap'), 'home numbers + gap in attention');
  ok(home.attention.some(a => a.type === 'moved'), 'home shows re-notify');
  const hist = await call('GET', `/api/events/${EV}/history`);
  ok(hist.entries.length > 10 && hist.entries.every(h => h.actor === U.email), 'history recorded with the verified user');
  const bad404 = await call('GET', '/api/events/nope/home');
  ok(bad404.__status === 404, 'unknown event 404');
} catch (e) { fail++; console.log('  CRASH', e.stack); }
finally {
  await cleanup().catch(e => console.log('cleanup failed', e.message));
  await q("delete from points_rule where programme_id='cn-agency100' and season='2026-27'");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
