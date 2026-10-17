// Browser pass over every screen, with the real API handlers and database
// behind it and a stand-in for Microsoft sign-in.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { handle } from '../lib/router.mjs';
import { q } from '../lib/db.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname, OUT = process.env.SHOTS || '/tmp/shots';
const U = { email: 'tester@mashmedia.net', name: 'Tester', admin: true };
const SHOW = 'zz-ui-show', AW = 'zz-ui-awards';
const FAKE_MSAL = `window.msal={PublicClientApplication:class{constructor(){}async initialize(){}getAllAccounts(){return[{username:'tester@mashmedia.net',name:'Test User'}]}async acquireTokenSilent(){return{idToken:'test'}}async loginPopup(){return{account:this.getAllAccounts()[0]}}async logoutPopup(){}}}`;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

async function seed() {
  await cleanup();
  await q(`insert into event (id, name, short_name, starts_on, ends_on, kind, ops_enabled, venue) values
    ($1,'UI Test Show 2027','UI Show','2027-03-03','2027-03-04','show',true,'ExCeL London'),
    ($2,'UI Test Awards 2027','UI Awards','2027-03-25','2027-03-25','awards',true,'Grosvenor House')`, [SHOW, AW]);
  const call = (m, p, b) => handle(new Request('http://x' + p, { method: m, body: b ? JSON.stringify(b) : undefined }), U).then(r => r.json());
  const T = []; for (const n of ['Theatre 1', 'Theatre 2', 'Workshop room']) T.push((await call('POST', `/api/events/${SHOW}/theatres`, { name: n })).theatre);
  await call('POST', `/api/events/${SHOW}/sessions/import`, { rows: [
    { title: 'Opening keynote', theatre: 'Theatre 1', day: '2027-03-03', start: '09:30', end: '10:30' },
    { title: 'Sustainable builds panel', theatre: 'Theatre 2', day: '2027-03-03', start: '10:00', end: '11:00' },
    { title: 'Tech showcase', theatre: 'Theatre 2', day: '2027-03-03', start: '11:00', end: '12:30' },
    { title: 'Workshop A', theatre: 'Workshop room', day: '2027-03-03', start: '10:00', end: '11:30' }] });
  const crew = [['Priya', 'Shah', 'Stage manager'], ['Tom', 'Clarke', 'Mic runner'], ['Aisha', 'Khan', 'Stage manager'], ['Ben', 'Ross', 'Mic runner'], ['Zoe', 'Hart', 'Steward'], ['Leo', 'Turner', 'Steward'], ['Mia', 'Owen', 'Host'], ['Ella', 'Morgan', 'Mic runner']];
  await call('POST', `/api/events/${SHOW}/crew/import`, { rows: crew.map(([f, l, r]) => ({ first_name: f, last_name: l, email: `${f.toLowerCase()}@example.test`, role: r })) });
  const P = Object.fromEntries((await q("select id, first_name from person where email like '%@example.test'")).map(r => [r.first_name, r.id]));
  const L = (h) => `2027-03-03T${h}:00Z`;
  await call('POST', `/api/events/${SHOW}/rules`, { role: 'Mic runner', min_count: 1, from_at: L('09:30'), to_at: L('12:30') });
  await call('POST', `/api/events/${SHOW}/rules`, { theatre_id: T[0].id, role: 'Stage manager', min_count: 1, from_at: L('09:00'), to_at: L('17:00') });
  const sh = (p, t, r, s, e) => call('POST', `/api/events/${SHOW}/assignments`, { person_id: P[p], theatre_id: T[t].id, role: r, starts_at: L(s), ends_at: L(e) });
  await sh('Priya', 0, 'Stage manager', '09:00', '17:00'); await sh('Tom', 0, 'Mic runner', '09:00', '13:00'); await sh('Aisha', 1, 'Stage manager', '09:00', '15:00');
  await sh('Ben', 1, 'Mic runner', '09:00', '11:00'); await sh('Zoe', 1, 'Steward', '09:00', '13:00'); await sh('Mia', 2, 'Host', '09:00', '13:00'); await sh('Ella', 2, 'Mic runner', '09:30', '12:30');
  await call('POST', `/api/events/${SHOW}/checkin`, { items: [{ client_id: 'zz-ui-1', person_id: P.Priya, day: '2027-03-03', present: true, at: L('08:40') }] });
  await call('POST', '/api/kit', { sticker: 'ZZ-14', kind: 'phone' }); await call('POST', '/api/kit', { sticker: 'ZZ-15', kind: 'charger' });
  await call('POST', `/api/kit/ZZ-14/issue`, { event_id: SHOW, person_id: P.Zoe });
  // scan check: Reftech + Grip uploads (HubSpot isn't reachable in the test)
  const ppl = [['Amy', 'Lane', 'Visitor', 'R100', 'R100'], ['Raj', 'Patel', 'VIP', 'R101', 'R911'], ['Sue', 'Bell', 'Visitor', 'R102', null], ['Kai', 'Moss', 'Exhibitor', 'R103', 'R103']];
  const up = await call('POST', `/api/events/${SHOW}/scans/upload`, { source: 'reftech', filename: 'reftech-export.csv', rows: ppl.map(([f, l, b, r]) => ({ email: `${f.toLowerCase()}.s@example.test`, first_name: f, last_name: l, company: 'Sample Co', badge: b, scan_id: r })) });
  await call('POST', `/api/events/${SHOW}/scans/upload`, { source: 'grip', filename: 'grip-export.csv', rows: ppl.filter(x => x[4]).map(([f, l, b, , g]) => ({ email: `${f.toLowerCase()}.s@example.test`, first_name: f, last_name: l, badge: f === 'Kai' ? 'Visitor' : b, scan_id: g })) });
  await call('POST', `/api/events/${AW}/tables`, { count: 6, seats: 10 });
  const orgs = [['Sample Agency', 10, 'Vegetarian'], ['Sample Media', 7, 'gluten free'], ['Sample Live', 5, ''], ['Sample Venues', 2, 'vegan'], ['Judges', 8, '']];
  await call('POST', `/api/events/${AW}/guests`, { rows: orgs.flatMap(([o, n, d]) => Array.from({ length: n }, (_, i) => ({ name: `${o.split(' ')[1] || o} Guest ${i + 1}`, organisation: o, dietary: i === 0 ? d : '' }))) });
  await call('POST', `/api/events/${AW}/sponsors`, { company: 'Manual Sponsor Ltd', tier: 'Headline' });
  await call('PUT', '/api/programmes/cn-agency100/2026-27/rules', { rules: [{ activity: 'Attended summit', points: 40 }, { activity: "Attended members' lunch", points: 20 }, { activity: 'Referral', points: 50 }] });
  for (const [f, pts] of [['Priya', 330], ['Tom', 300], ['Aisha', 280]]) await call('POST', '/api/programmes/cn-agency100/2026-27/import', { rows: [{ email: `${f.toLowerCase()}@example.test`, points: pts }] });
  await call('POST', '/api/programmes/cn-agency100/2026-27/entries', { person_id: P.Tom, activity: 'Referral', note: 'Referred a new member' });
  await call('POST', '/api/programmes/cn-agency100/2026-27/entries', { person_id: P.Tom, activity: 'Attended summit', event_id: SHOW });
}
async function cleanup() {
  await q("delete from points_entry where person_id in (select id from person where email like '%@example.test')");
  await q("delete from programme_member where person_id in (select id from person where email like '%@example.test')");
  await q("delete from points_rule where programme_id='cn-agency100' and season='2026-27'");
  await q("delete from kit_item where sticker like 'ZZ-%'");
  await q('delete from event where id = any($1)', [[SHOW, AW]]);
  await q("delete from person where email like '%@example.test'");
  await q("delete from audit_log where actor=$1", [U.email]);
  await q("delete from scan_template where by_user=$1 and event_id = any($2)", [U.email, [SHOW, AW]]);
}

const errors = [];
try {
  await seed();
  const b = await chromium.launch({ executablePath: process.env.CHR });
  const ctxB = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctxB.addInitScript(() => { try { if (!localStorage.getItem('ops-event')) localStorage.setItem('ops-event', 'zz-ui-show'); } catch {} });
  const page = await ctxB.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push('console ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'alcdn.msauth.net') return route.fulfill({ body: FAKE_MSAL, contentType: 'text/javascript' });
    if (url.hostname === 'ops.test' && url.pathname.startsWith('/api/v2/')) {
      if (req.headers()['authorization'] !== 'Bearer test') return route.fulfill({ status: 401, body: '{"error":"no token"}' });
      const r = await handle(new Request(req.url(), { method: req.method(), body: ['GET', 'DELETE'].includes(req.method()) ? undefined : req.postData() }), U);
      return route.fulfill({ status: r.status, body: await r.text(), contentType: 'application/json' });
    }
    if (url.hostname === 'ops.test') {
      const f = join(ROOT, url.pathname === '/v2/' ? 'v2/index.html' : url.pathname);
      return existsSync(f) ? route.fulfill({ body: readFileSync(f), contentType: types[extname(f)] || 'application/octet-stream' }) : route.fulfill({ status: 404, body: 'nf' });
    }
    if (/fonts\.(googleapis|gstatic)/.test(url.hostname)) return route.fulfill({ body: '', contentType: 'text/css' });
    return route.abort();
  });
  const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); };
  await page.goto('http://ops.test/v2/#/home'); await page.waitForSelector('h1'); await page.waitForTimeout(800);
  console.log('home h1:', await page.textContent('main h1'), '| attention items:', await page.locator('.list .item').count());
  await shot('1-home');
  await page.goto('http://ops.test/v2/#/rota?day=2027-03-03'); await page.waitForSelector('.rota');
  console.log('rota gaps:', await page.locator('.p-gap').count(), '| cells:', await page.locator('.rota .cell').count());
  await shot('2-rota');
  // add a shift through the dialog into a gap
  await page.locator('.rota .cell .p-gap').first().click(); await page.waitForSelector('#dlg[open] #f');
  await page.selectOption('#p', { label: 'Ben Ross — Mic runner' });
  await page.click('#dlg button.pri'); await page.waitForTimeout(1200);
  console.log('after adding shift, toast/gaps:', await page.locator('.p-gap').count(), await page.locator('.toast').allTextContents());
  await page.click('#propose'); await page.waitForSelector('#dlg[open]'); await page.waitForTimeout(300);
  console.log('breaks dialog:', (await page.textContent('#dlg-b')).replace(/\s+/g, ' ').slice(0, 160));
  await shot('3-breaks'); await page.click('#acc').catch(() => page.click('[data-close]')); await page.waitForTimeout(1000);
  for (const t of ['crew', 'agenda', 'rules', 'schedules']) { await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(900); await shot('4-rota-' + t); }
  await page.click('[data-prev]'); await page.waitForSelector('#dlg[open] iframe'); await page.waitForTimeout(600); await shot('5-schedule-preview'); await page.keyboard.press('Escape');
  // check-in on a phone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://ops.test/v2/#/checkin?day=2027-03-03'); await page.waitForSelector('.ci .person');
  const before = await page.textContent('.ci .num');
  await page.locator('.ci input[type=checkbox]').first().click(); await page.waitForTimeout(1200);
  console.log('check-in here count', before.trim(), '->', (await page.textContent('.ci .num')).trim());
  await shot('6-checkin-phone');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://ops.test/v2/#/kit'); await page.waitForSelector('#kt'); await shot('7-kit');
  await page.goto('http://ops.test/v2/#/scans'); await page.waitForSelector('#tb'); await shot('7b-scans-missing');
  console.log('scan check KPIs:', (await page.locator('.kpi .n').allTextContents()).join(' / '));
  await page.click('[data-tab="scan"]'); await page.waitForSelector('#tb'); await shot('7c-scans-scanid');
  await page.click('[data-tab="badge"]'); await page.waitForSelector('#tb'); await shot('7d-scans-badge');
  await page.click('#tpl'); await page.waitForSelector('#dlg[open]');
  await page.setInputFiles('[data-tpl="grip"]', process.env.GRIP_TPL || { name: 'grip-template.csv', mimeType: 'text/csv', buffer: Buffer.from('First Name,Last Name,Email Address,Badge Type,Barcode,Event Code\n') });
  await page.waitForSelector('[data-save="grip"]'); await shot('7e-scans-template');
  console.log('template guesses:', await page.$$eval('[data-cols="grip"] select', s => s.map(x => x.value).join(',')));
  await page.check('[data-cols="grip"] [data-forev]'); await page.click('[data-save="grip"]'); await page.waitForTimeout(1200);
  await page.click('[data-tab="scan"]'); await page.waitForSelector('[data-fx]');
  await page.click('[data-fx]'); await page.waitForSelector('#dlg[open] [data-dl]'); await shot('7f-scans-fixfiles');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-dl]')]);
  console.log('fix file:', dl.suggestedFilename(), JSON.stringify(readFileSync(await dl.path(), 'utf8')));
  // awards event: tables
  await page.evaluate(() => localStorage.setItem('ops-event', 'zz-ui-awards')); await page.goto('http://ops.test/v2/#/tables'); await page.reload(); await page.waitForSelector('.tgrid');
  await page.click('#auto'); await page.waitForTimeout(1500);
  console.log('tables seated:', (await page.locator('.kpi .n').nth(1).textContent()).replace(/\s+/g, ' '));
  await shot('8-tables');
  await page.goto('http://ops.test/v2/#/sponsors'); await page.waitForSelector('main h1'); await shot('9-sponsors');
  await page.goto('http://ops.test/v2/#/leaderboards'); await page.waitForSelector('table.t'); await page.waitForTimeout(600);
  console.log('leaderboard first row:', (await page.locator('table.t tbody tr').first().innerText()).replace(/\s+/g, ' '));
  await shot('10-leaderboard');
  await page.goto('http://ops.test/v2/#/admin'); await page.waitForSelector('main h1'); await shot('11-admin');
  await page.goto('http://ops.test/v2/#/history'); await page.waitForSelector('main h1'); await shot('12-history');
  await b.close();
} catch (e) { errors.push('CRASH ' + e.stack); }
finally { await cleanup(); console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No browser errors.'); process.exit(errors.length ? 1 : 0); }
