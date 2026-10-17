// Scan check — HubSpot vs Reftech vs Grip for a show.
//   1. Who's in one but not the others          (all three, matched on email)
//   2. Does everyone's badge type match          (all three, via a badge-name map)
//   3. Does everyone's scan ID match             (Grip vs Reftech only)
// Reftech and Grip come in as CSV uploads until their APIs are available;
// HubSpot is pulled live (approved registrations for the show).
import { q, one } from './db.mjs';
import { bad, str } from './http.mjs';
import { audit } from './audit.mjs';
import { resolveEvent } from './events.mjs';

export const SOURCES = ['hubspot', 'reftech', 'grip'];
const LABEL = { hubspot: 'HubSpot', reftech: 'Reftech', grip: 'Grip' };
const APPROVED = { CFX: ['Approved - CFX'], EPS: ['Approved - EPS', 'Approved Supplier - EPS'], PAS: ['Approved - PAS'] };
const TOKEN = () => process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_PRIVATE_APP_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN;

export function regCode(ev) {
  if (ev.ops_reg_code) return ev.ops_reg_code;
  const s = `${ev.id} ${ev.name}`.toLowerCase();
  if (/confex|\bcfx\b|cfx-/.test(s)) return 'CFX';
  if (/\beps\b|eps-|event production show/.test(s)) return 'EPS';
  if (/pa show|pas-the-pa-show/.test(s)) return 'PAS';
  return null;
}
export const normEmail = (e) => String(e || '').trim().toLowerCase().replace(/^mailto:/, '');
export const normScan = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
// "Confex - Visitor" / "PA Show - Day 1 Delegate" / "VISITOR" → "Visitor" / "Day 1 Delegate" / "Visitor"
export function defaultBadge(raw) {
  const v = String(raw || '').trim().replace(/^(confex|international confex|eps|event production show|pa show|the pa show)\s*[-–:]\s*/i, '');
  return v ? v.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '';
}

// ------------------------------------------------------------------ loading
async function saveUpload(user, ev, source, rows, filename, appendTo = null) {
  const up = appendTo
    ? await one('update scan_upload set rows=rows+$2 where id=$1 and event_id=$3 and source=$4 returning *', [appendTo, rows.length, ev.id, source])
    : await one('insert into scan_upload (event_id, source, rows, filename, by_user) values ($1,$2,$3,$4,$5) returning *', [ev.id, source, rows.length, filename || null, user.email]);
  if (!up) throw bad('That upload has gone — start again');
  const cols = { email: [], first: [], last: [], company: [], scan: [], badge: [], ext: [], job: [] };
  for (const r of rows) {
    cols.email.push(normEmail(r.email) || null); cols.first.push(str(r.first_name, 100) || null); cols.last.push(str(r.last_name, 100) || null);
    cols.company.push(str(r.company, 200) || null); cols.scan.push(str(r.scan_id, 100) || null); cols.badge.push(str(r.badge, 120) || null); cols.ext.push(str(r.ext_id, 60) || null); cols.job.push(str(r.job_title, 200) || null);
  }
  for (let i = 0; i < rows.length; i += 2000) {
    const sl = (a) => a.slice(i, i + 2000);
    await q(`insert into scan_row (upload_id, email, first_name, last_name, company, scan_id, badge_raw, ext_id, job_title)
             select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])`,
      [up.id, sl(cols.email), sl(cols.first), sl(cols.last), sl(cols.company), sl(cols.scan), sl(cols.badge), sl(cols.ext), sl(cols.job)]);
  }
  if (appendTo) return up;
  // Keep the last 5 uploads per source; older ones are history nobody reads.
  await q(`delete from scan_upload where id in (select id from scan_upload where event_id=$1 and source=$2 order by at desc offset 5)`, [ev.id, source]);
  await audit(user, ev.id, 'Scan check', 'added', `${LABEL[source]}: ${rows.length} rows${filename ? ' from ' + filename : ''}`);
  return up;
}

// Big files arrive in chunks: the first call returns the upload id, later calls pass it as append.
export async function uploadSource(user, eventId, source, rows, filename, append = null) {
  const ev = await resolveEvent(eventId);
  if (!['reftech', 'grip'].includes(source)) throw bad('Upload is for Reftech or Grip');
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows in that file');
  if (rows.length > 20000) throw bad('Send at most 20,000 rows per request');
  const withEmail = rows.filter(r => normEmail(r.email)).length;
  if (withEmail < rows.length * 0.5) throw bad(`Only ${withEmail} of ${rows.length} rows have an email — check the email column is mapped`);
  const up = await saveUpload(user, ev, source, rows, filename, append);
  return { upload: up };
}

async function hsSearch(body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', { method: 'POST',
      headers: { authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429) { await new Promise(res => setTimeout(res, 1100 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`HubSpot ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('HubSpot is rate-limiting — try again in a minute');
}

// Approved registrations for the show. Pages by record id so it isn't capped at
// HubSpot search's 10,000-result limit.
export async function pullHubspot(user, eventId) {
  const ev = await resolveEvent(eventId);
  const code = regCode(ev);
  if (!code || !APPROVED[code]) throw bad('This event has no registration code — set CFX, EPS or PAS in Admin.');
  if (!TOKEN()) throw bad('HUBSPOT_TOKEN is not set on this site.');
  const props = ['email', 'firstname', 'lastname', 'company', 'jobtitle', 'pas_scan_id', 'registration_badging__27'];
  const rows = []; let lastId = '0';
  for (let guard = 0; guard < 400; guard++) {
    const d = await hsSearch({ filterGroups: [{ filters: [
        { propertyName: 'registration_status__27', operator: 'IN', values: APPROVED[code] },
        { propertyName: 'hs_object_id', operator: 'GT', value: lastId }] }],
      sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }], properties: props, limit: 200 });
    const res = d.results || [];
    for (const c of res) {
      const p = c.properties || {};
      rows.push({ email: p.email, first_name: p.firstname, last_name: p.lastname, company: p.company, scan_id: p.pas_scan_id, badge: p.registration_badging__27, ext_id: c.id, job_title: p.jobtitle });
    }
    if (res.length < 200) break;
    lastId = res[res.length - 1].id;
  }
  const up = await saveUpload(user, ev, 'hubspot', rows, `HubSpot: ${APPROVED[code].join(' / ')}`);
  return { upload: up, statuses: APPROVED[code] };
}

// ------------------------------------------------------------------ badge map
async function latestUploads(evId) {
  const ups = await q(`select distinct on (source) * from scan_upload where event_id=$1 order by source, at desc`, [evId]);
  return Object.fromEntries(ups.map(u => [u.source, u]));
}
export async function badgeValues(eventId) {
  const ev = await resolveEvent(eventId);
  const ups = await latestUploads(ev.id);
  const map = await q('select * from badge_map where event_id=$1', [ev.id]);
  const out = [];
  for (const s of SOURCES) {
    if (!ups[s]) continue;
    const vals = await q(`select coalesce(badge_raw,'') raw, count(*)::int n from scan_row where upload_id=$1 group by 1 order by 2 desc`, [ups[s].id]);
    for (const v of vals) {
      const m = map.find(x => x.source === s && x.raw === v.raw);
      out.push({ source: s, raw: v.raw, n: v.n, canonical: m ? m.canonical : defaultBadge(v.raw), mapped: !!m });
    }
  }
  return { values: out };
}
export async function putBadgeMap(user, eventId, list) {
  const ev = await resolveEvent(eventId);
  if (!Array.isArray(list)) throw bad('Send a list');
  for (const m of list) {
    if (!SOURCES.includes(m.source)) continue;
    const c = str(m.canonical, 120);
    if (c) await q(`insert into badge_map (event_id, source, raw, canonical) values ($1,$2,$3,$4) on conflict (event_id, source, raw) do update set canonical=excluded.canonical`, [ev.id, m.source, String(m.raw ?? ''), c]);
    else await q('delete from badge_map where event_id=$1 and source=$2 and raw=$3', [ev.id, m.source, String(m.raw ?? '')]);
  }
  await audit(user, ev.id, 'Scan check', 'changed', 'Badge type mapping');
  return { ok: true };
}

// ------------------------------------------------------------------ the check
export async function scanCheck(eventId, internal = false) {
  const ev = await resolveEvent(eventId);
  const ups = await latestUploads(ev.id);
  const map = await q('select * from badge_map where event_id=$1', [ev.id]);
  const acks = new Set((await q('select kind, key from scan_ack where event_id=$1', [ev.id])).map(a => `${a.kind}|${a.key}`));
  const canon = (s, raw) => { const m = map.find(x => x.source === s && x.raw === (raw || '')); return m ? m.canonical : defaultBadge(raw); };
  const people = new Map();            // email → { email, name, company, by: { source: row } }
  const noEmail = {}, dupEmail = {}, dupScan = {};
  for (const s of SOURCES) {
    if (!ups[s]) continue;
    const rows = await q('select * from scan_row where upload_id=$1', [ups[s].id]);
    noEmail[s] = rows.filter(r => !r.email).length;
    const seen = new Map(), scans = new Map();
    for (const r of rows) {
      if (!r.email) continue;
      if (seen.has(r.email)) { (dupEmail[s] = dupEmail[s] || []).push(r.email); continue; }
      seen.set(r.email, r);
      const p = people.get(r.email) || { email: r.email, name: '', company: '', by: {} };
      p.by[s] = { scan: r.scan_id || '', badge: r.badge_raw || '', type: canon(s, r.badge_raw), ext: r.ext_id, first: r.first_name || '', last: r.last_name || '', company: r.company || '', job: r.job_title || '' };
      if (!p.name) p.name = [r.first_name, r.last_name].filter(Boolean).join(' ');
      if (!p.company) p.company = r.company || '';
      people.set(r.email, p);
      const sc = normScan(r.scan_id);
      if (sc && s !== 'hubspot') { (scans.get(sc) || scans.set(sc, []).get(sc)).push(r.email); }
    }
    dupScan[s] = [...scans.entries()].filter(([, es]) => es.length > 1).map(([scan, emails]) => ({ scan, emails }));
  }
  const have = SOURCES.filter(s => ups[s]);
  const all = [...people.values()];
  // 1 — presence
  const missing = all.filter(p => have.some(s => !p.by[s])).map(p => ({
    email: p.email, name: p.name, company: p.company,
    in: have.filter(s => p.by[s]), notIn: have.filter(s => !p.by[s]), key: p.email, acked: acks.has(`missing|${p.email}`)
  }));
  // Possible same person under a different email: same name + company, present in complementary sources.
  const byName = new Map();
  for (const m of missing) { const k = (m.name + '|' + m.company).toLowerCase().replace(/\s+/g, ' '); if (m.name) (byName.get(k) || byName.set(k, []).get(k)).push(m); }
  for (const list of byName.values()) if (list.length > 1) for (const m of list) m.maybe = list.filter(x => x !== m && !x.in.some(s => m.in.includes(s))).map(x => x.email);
  // 2 — badge type
  const badge = all.filter(p => { const t = have.filter(s => p.by[s] && p.by[s].type).map(s => p.by[s].type.toLowerCase()); return new Set(t).size > 1; })
    .map(p => ({ email: p.email, name: p.name, company: p.company, types: Object.fromEntries(have.filter(s => p.by[s]).map(s => [s, { raw: p.by[s].badge, type: p.by[s].type }])), key: p.email, acked: acks.has(`badge|${p.email}`) }));
  // 3 — scan ID. Grip and Reftech must agree. When HubSpot is the source of record
  // (delegates carry pas_scan_id), both must also match HubSpot where it has an ID.
  // People with no HubSpot ID (exhibitors, until their source is decided) fall back to Reftech.
  const settings0 = scanSettings(ev);
  const scan = [];
  for (const p of all) {
    const r = p.by.reftech, g = p.by.grip, h = p.by.hubspot;
    const rightId = rightScan(p, settings0);
    const probs = [];
    if (r && g && normScan(r.scan) !== normScan(g.scan)) probs.push(!r.scan ? 'No scan ID in Reftech' : !g.scan ? 'No scan ID in Grip' : 'Grip and Reftech differ');
    if (settings0.scanTruth === 'hubspot' && h && normScan(h.scan)) {
      const off = ['reftech', 'grip'].filter(s => p.by[s] && normScan(p.by[s].scan) !== normScan(h.scan)).map(s => LABEL[s]);
      if (off.length) probs.push(`${off.join(' and ')} ${off.length > 1 ? "don't" : "doesn't"} match HubSpot`);
    }
    if (!probs.length) continue;
    const key = `${p.email}|${normScan(r?.scan)}|${normScan(g?.scan)}|${normScan(h?.scan)}`;
    scan.push({ email: p.email, name: p.name, company: p.company, reftech: r ? r.scan : null, grip: g ? g.scan : null, hubspot: h ? h.scan : null,
      right: rightId, problem: probs.join('; '), key, acked: acks.has(`scan|${key}`) });
  }
  const counts = Object.fromEntries(have.map(s => [s, { rows: ups[s].rows, at: ups[s].at, by: ups[s].by_user, filename: ups[s].filename, noEmail: noEmail[s] || 0, dupEmails: (dupEmail[s] || []).length }]));
  const open = (l) => l.filter(x => !x.acked).length;
  const settings = scanSettings(ev);
  const templates = Object.fromEntries(await Promise.all(['reftech', 'grip'].map(async s => [s, await templateFor(s, ev.id)])));
  if (internal) return { ev, have, all, missing, badge, scan, settings, ups };
  return {
    event: ev, regCode: regCode(ev), settings, templates, sources: counts, people: all.length,
    summary: { missing: open(missing), badge: open(badge), scan: open(scan), scanReady: !!(ups.grip && ups.reftech) || !!(ups.hubspot && (ups.grip || ups.reftech) && settings0.scanTruth === 'hubspot') },
    missing, badge, scan, dupScan, dupEmail
  };
}

export async function ack(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  if (!['missing', 'badge', 'scan'].includes(b.kind)) throw bad('Unknown check');
  const key = str(b.key, 400); if (!key) throw bad('key is required');
  if (b.undo) await q('delete from scan_ack where event_id=$1 and kind=$2 and key=$3', [ev.id, b.kind, key]);
  else await q(`insert into scan_ack (event_id, kind, key, note, by_user) values ($1,$2,$3,$4,$5)
                on conflict (event_id, kind, key) do update set note=excluded.note, by_user=excluded.by_user, at=now()`, [ev.id, b.kind, key, str(b.note, 300) || null, user.email]);
  await audit(user, ev.id, 'Scan check', b.undo ? 'changed' : 'added', `${b.undo ? 'Reopened' : 'Accepted'} ${b.kind}: ${key.split('|')[0]}`);
  return { ok: true };
}

// ------------------------------------------------------------------ settings + fix files
// Which source is right when two disagree. Sean's defaults: HubSpot holds the
// badge type of record; Reftech issues scan IDs, so Grip is corrected to match.
export function scanSettings(ev) {
  const s = ev.ops_scan_settings || {};
  return { badgeTruth: SOURCES.includes(s.badgeTruth) ? s.badgeTruth : 'hubspot', scanTruth: SOURCES.includes(s.scanTruth) ? s.scanTruth : 'hubspot' };
}
// The scan ID a person should have: the source of record's, else Reftech's, else Grip's.
export function rightScan(p, settings) {
  for (const s of [settings.scanTruth, 'reftech', 'grip']) if (p.by[s] && normScan(p.by[s].scan)) return p.by[s].scan;
  return '';
}
export async function putSettings(user, eventId, b) {
  const ev = await resolveEvent(eventId);
  const next = { ...scanSettings(ev) };
  if (b.badgeTruth != null) { if (!SOURCES.includes(b.badgeTruth)) throw bad('Unknown source'); next.badgeTruth = b.badgeTruth; }
  if (b.scanTruth != null) { if (!SOURCES.includes(b.scanTruth)) throw bad('Unknown source'); next.scanTruth = b.scanTruth; }
  await q('update event set ops_scan_settings=$2 where id=$1', [ev.id, JSON.stringify(next)]);
  await audit(user, ev.id, 'Scan check', 'changed', `Badge types from ${LABEL[next.badgeTruth]}, scan IDs from ${LABEL[next.scanTruth]}`);
  return next;
}

export const FIELDS = ['email', 'first_name', 'last_name', 'company', 'job_title', 'headline', 'scan_id', 'badge', 'badge_type', 'registration_id', 'ext_id'];
const GENERIC = [
  { header: 'Email', field: 'email' }, { header: 'First name', field: 'first_name' }, { header: 'Last name', field: 'last_name' },
  { header: 'Company', field: 'company' }, { header: 'Badge type', field: 'badge' }, { header: 'Scan ID', field: 'scan_id' }];

// A template is the system's own import file: any instruction rows above the header
// (kept as they are), the header row with each column pointed at one of our fields
// (or a fixed value "=value", or blank), and whether the system wants one file per
// badge type (Grip imports by data type). Saved for one event, or as the default.
export async function templateFor(source, eventId) {
  return one(`select source, event_id, columns, preamble, split_by_badge, filename, at from scan_template
              where source=$1 and event_id = any($2) order by event_id desc limit 1`, [source, [eventId || '', '']]);
}
export async function putTemplate(user, source, b) {
  if (!['reftech', 'grip'].includes(source)) throw bad('Templates are for Reftech or Grip');
  const cols = (b.columns || []).map(c => ({ header: str(c.header, 120), field: str(c.field, 200) }))
    .filter(c => c.header && (!c.field || FIELDS.includes(c.field) || c.field.startsWith('=')));
  if (!cols.length) throw bad('The template needs at least one column');
  if (!cols.some(c => c.field === 'email')) throw bad('Point one column at the email address so rows can be matched');
  const pre = Array.isArray(b.preamble) ? b.preamble.slice(0, 10).map(r => (Array.isArray(r) ? r : []).slice(0, 200).map(v => String(v ?? '').slice(0, 2000))) : [];
  const evId = b.event_id ? (await resolveEvent(b.event_id)).id : '';
  await q(`insert into scan_template (source, event_id, columns, preamble, split_by_badge, filename, by_user) values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (source, event_id) do update set columns=excluded.columns, preamble=excluded.preamble, split_by_badge=excluded.split_by_badge,
             filename=excluded.filename, by_user=excluded.by_user, at=now()`,
    [source, evId, JSON.stringify(cols), JSON.stringify(pre), !!b.split_by_badge, str(b.filename, 200) || null, user.email]);
  await audit(user, evId || null, 'Scan check', 'changed', `${LABEL[source]} upload template${evId ? '' : ' (default)'}`);
  return { ok: true };
}
export async function removeTemplate(user, source, eventId) {
  const evId = eventId ? (await resolveEvent(eventId)).id : '';
  await q('delete from scan_template where source=$1 and event_id=$2', [source, evId]);
  await audit(user, evId || null, 'Scan check', 'removed', `${LABEL[source] || source} upload template`);
  return { ok: true };
}
// Guesses which of our fields a template header means.
export function guessField(h) {
  const k = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (k.length <= 24 && k.includes('email')) return 'email';
  if (/^(first|firstname|forename|givenname)$/.test(k)) return 'first_name';
  if (/^(last|lastname|surname|familyname)$/.test(k)) return 'last_name';
  if (/^(registrationid|regid|attendeeid|delegateid|participantid)$/.test(k)) return 'registration_id';
  if (/^(company|companyname|organisation|organization|organisationname|organizationname|employer)$/.test(k)) return 'company';
  if (/^(jobtitle|title|position|role)$/.test(k)) return 'job_title';
  if (k === 'headline') return 'headline';
  if (/^(scanid|scan|barcode|badgeid|badgenumber|badgebarcode|qr|qrcode|ticketid|ticketnumber)$/.test(k)) return 'scan_id';
  if (/^(badge|badgetype|tickettype|ticket|category|attendeetype|registrationtype|delegatetype|datatype|participanttype)$/.test(k)) return 'badge';
  return '';
}

// Rows the target system needs uploaded so it matches the others.
//   add   — people in the other sources but not in the target
//   badge — target's badge type differs from the source of record
//   scan  — target's scan ID differs from the scan-ID source (Grip/Reftech only)
export async function fixFile(eventId, target, kind) {
  if (!['reftech', 'grip'].includes(target)) throw bad('Fix files are for Reftech or Grip');
  const c = await scanCheck(eventId, true);
  if (!c.ups[target]) throw bad(`Upload the ${LABEL[target]} export first`);
  const tplRow = await templateFor(target, c.ev.id); const tpl = tplRow?.columns || GENERIC;
  // canonical type → the raw value the target uses for it (its most common spelling)
  const rawFor = new Map();
  for (const p of c.all) { const r = p.by[target]; if (r && r.type) { const k = r.type.toLowerCase(); const m = rawFor.get(k) || rawFor.set(k, new Map()).get(k); m.set(r.badge, (m.get(r.badge) || 0) + 1); } }
  const targetBadge = (type) => { const m = rawFor.get(String(type || '').toLowerCase()); return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : type || ''; };
  const pick = (p, order) => { for (const s of order) if (p.by[s]) return p.by[s]; return {}; };
  const order = [c.settings.badgeTruth, ...SOURCES.filter(s => s !== c.settings.badgeTruth)];
  const scanOrder = [c.settings.scanTruth, ...SOURCES.filter(s => s !== c.settings.scanTruth && s !== 'hubspot'), 'hubspot'];
  const recs = [];
  const people = new Map(c.all.map(p => [p.email, p]));
  const record = (p, extra = {}) => {
    const b = pick(p, order); const sc = pick(p, scanOrder); const t = p.by[target] || {};
    const type = b.type || '';
    const company = t.company || b.company || p.company || '', job = t.job || b.job || pick(p, SOURCES.filter(s => p.by[s]?.job)).job || '';
    // Registration ID: the target's own ID for people already in it; for new people the HubSpot record ID.
    const regId = t.ext || (p.by.hubspot?.ext ? 'HS' + p.by.hubspot.ext : '');
    return { email: p.email, first_name: t.first || b.first || '', last_name: t.last || b.last || '', company, job_title: job,
      headline: [job, company].filter(Boolean).join(' - '), scan_id: sc.scan || t.scan || '', badge_type: type, badge: targetBadge(type),
      registration_id: regId, ext_id: t.ext || '', ...extra,
      // Updates only carry what identifies the person plus the fix, so nothing people edited
      // in the target (Grip headlines especially) gets overwritten.
      ...(kind === 'add' ? {} : { company: '', job_title: '', headline: '' }) };
  };
  if (kind === 'add') {
    for (const m of c.missing) if (!m.acked && m.notIn.includes(target)) recs.push(record(people.get(m.email)));
  } else if (kind === 'badge') {
    if (c.settings.badgeTruth === target) throw bad(`${LABEL[target]} is the source of record for badge types — fix the others instead`);
    for (const m of c.badge) { if (m.acked) continue; const p = people.get(m.email); const truth = p.by[c.settings.badgeTruth]; const t = p.by[target];
      if (truth && t && truth.type && truth.type.toLowerCase() !== (t.type || '').toLowerCase()) recs.push(record(p)); }
  } else if (kind === 'scan') {
    if (c.settings.scanTruth === target) throw bad(`${LABEL[target]} is the source of record for scan IDs — fix the others instead`);
    for (const m of c.scan) { if (m.acked) continue; const p = people.get(m.email); const t = p.by[target]; const v = rightScan(p, c.settings);
      if (t && v && normScan(t.scan) !== normScan(v)) recs.push(record(p, { scan_id: v })); }
  } else throw bad('kind must be add, badge or scan');
  const cell = (v) => { v = String(v ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const write = (list) => ['\ufeff' + [...(tplRow?.preamble || []), tpl.map(t => t.header), ...list.map(r => tpl.map(t => !t.field ? '' : t.field.startsWith('=') ? t.field.slice(1) : (r[t.field] ?? '')))]
    .map(row => row.map(cell).join(',')).join('\r\n')][0];
  const slug = (x) => String(x || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const base = `${slug(c.ev.short_name || c.ev.id)}-${target}-${kind === 'add' ? 'add-people' : kind === 'badge' ? 'badge-fixes' : 'scan-id-fixes'}`;
  const missingReg = tpl.some(t => t.field === 'registration_id') ? recs.filter(r => !r.registration_id).length : 0;
  let files;
  if (tplRow?.split_by_badge) {
    const groups = new Map();
    for (const r of recs) { const k = r.badge || '(no badge type)'; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
    files = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([badge, list]) => ({ badge, rows: list.length, filename: `${base}-${slug(badge) || 'no-badge'}.csv`, csv: write(list) }));
  } else files = [{ badge: null, rows: recs.length, filename: `${base}.csv`, csv: write(recs) }];
  return { rows: recs.length, files, csv: files[0]?.csv, filename: files[0]?.filename, templated: !!tplRow, split: !!tplRow?.split_by_badge,
    template: tplRow ? { filename: tplRow.filename, forEvent: !!tplRow.event_id } : null, missingRegistrationIds: missingReg };
}
