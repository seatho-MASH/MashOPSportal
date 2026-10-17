// Scan check — HubSpot vs Reftech vs Grip: who's missing, badge types, scan IDs.
// Produces fix files in each system's own upload template.
import { esc, $, $$, fmtDateTime, toast, toCSV, download, plural } from '../util.js';

const L = { hubspot: 'HubSpot', reftech: 'Reftech', grip: 'Grip' };
const FIELDS = [['', '— leave blank —'], ['email', 'Email'], ['first_name', 'First name'], ['last_name', 'Last name'], ['company', 'Company'],
  ['job_title', 'Job title'], ['headline', 'Headline (Job title - Company)'], ['scan_id', 'Scan ID'], ['badge', 'Badge type (as that system spells it)'],
  ['badge_type', 'Badge type (tidy name)'], ['registration_id', 'Registration ID (theirs, or HS + HubSpot ID if new)'], ['ext_id', 'Their record ID']];
let tab = 'missing', filter = '', showAcked = false;

// Full CSV → array of rows (arrays), handling quoted commas and line breaks.
export function csvRows(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
// Templates and exports can have instruction rows above the real header (Grip does):
// the header is the first row with an email column.
export function splitHeader(rows) {
  const i = rows.findIndex(r => r.some(v => guessField(v) === 'email'));
  const at = i < 0 ? rows.findIndex(r => r.some(v => v.trim())) : i;
  return { preamble: at > 0 ? rows.slice(0, at) : [], header: (rows[at] || []).map(h => h.trim()), body: rows.slice(at + 1).filter(r => r.some(v => String(v).trim())) };
}
// Same guesses as the server (netlify/v2/lib/scans.mjs guessField).
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
const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(f); });

export async function render(el, ctx) {
  const ev = ctx.ev; const enc = encodeURIComponent(ev.id);
  if (ev.kind !== 'show') { el.innerHTML = `<div class="wrap"><div class="card empty">Scan check is for shows.</div></div>`; return; }
  el.innerHTML = '<div class="wrap"><div class="card empty">Checking…</div></div>';
  const d = await ctx.api(`/api/events/${enc}/scans`);
  const s = d.summary, have = Object.keys(d.sources);
  const card = (src) => { const u = d.sources[src];
    return `<section class="card" style="flex:1 1 220px;min-width:0">
      <div style="display:flex;align-items:center;gap:8px"><h3 class="grow">${L[src]}</h3>${u ? `<span class="chip good">${u.rows.toLocaleString()}</span>` : '<span class="chip warn">Not loaded</span>'}</div>
      <p class="small mut" style="margin:6px 0 10px">${u ? `${fmtDateTime(u.at)} · ${esc(u.by.split('@')[0])}${u.filename ? '<br>' + esc(u.filename) : ''}${u.noEmail ? `<br><span class="warn-t">${u.noEmail} rows without an email</span>` : ''}${u.dupEmails ? `<br><span class="warn-t">${plural(u.dupEmails, 'duplicate email')}</span>` : ''}`
        : src === 'hubspot' ? `Approved registrations${d.regCode ? ' for ' + d.regCode : ''}` : `Upload the ${L[src]} export (CSV)`}</p>
      ${src === 'hubspot' ? `<button class="btn ${u ? '' : 'pri'}" id="hs" ${d.regCode ? '' : 'disabled title="Set the registration code in Admin"'}>Pull from HubSpot</button>`
        : `<label class="btn ${u ? '' : 'pri'}" style="cursor:pointer">Upload CSV<input type="file" accept=".csv,text/csv" data-up="${src}" hidden></label>`}</section>`; };
  const kpi = (k, n, label, note) => `<button class="card kpi ${tab === k ? 'on' : ''}" data-tab="${k}" style="text-align:left;cursor:pointer">
      <div class="n ${n ? 'warn-t' : 'good-t'}">${n == null ? '—' : n.toLocaleString()}</div><div class="l">${label}</div>${note ? `<div class="small mut">${note}</div>` : ''}</button>`;
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Scan check</h1></div>
      <div class="pills"><button class="btn" id="tpl">Upload templates</button><button class="btn" id="bm">Badge types</button><button class="btn" id="set">Which is right?</button></div></header>
    ${!d.regCode ? '<div class="banner">This event has no registration code. Set CFX, EPS or PAS in Admin to pull from HubSpot.</div>' : ''}
    <div class="row2">${['hubspot', 'reftech', 'grip'].map(card).join('')}</div>
    ${have.length < 2 ? '<div class="card empty" style="margin-top:14px">Load at least two sources to compare.</div>' : `
    <div class="kpis" style="margin-top:14px">
      ${kpi('missing', s.missing, 'Not in every system', `${d.people.toLocaleString()} people across ${have.length} sources`)}
      ${kpi('badge', s.badge, 'Badge type differs')}
      ${kpi('scan', s.scanReady ? s.scan : null, 'Scan ID differs', s.scanReady ? (d.settings.scanTruth === 'hubspot' ? 'Grip, Reftech and HubSpot' : 'Grip vs Reftech') : 'Needs Grip and Reftech')}
    </div>
    <section class="card" style="margin-top:14px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <h2 class="grow">${{ missing: 'Not in every system', badge: 'Badge type differs', scan: 'Scan ID differs' }[tab]}</h2>
        <label class="sr" for="sq">Filter</label><input class="input" id="sq" placeholder="Name, email, company" value="${esc(filter)}" style="max-width:240px">
        <label class="small"><input type="checkbox" id="sa" ${showAcked ? 'checked' : ''}> Show accepted</label>
        <button class="btn sm" id="exp">Export list</button>
      </div>
      <div id="fixes" class="pills" style="margin-bottom:10px"></div>
      <div class="scroll-x"><table class="t"><thead id="th"></thead><tbody id="tb"></tbody></table></div>
      ${d.dupScan && Object.values(d.dupScan).some(l => l.length) ? `<h3 style="margin:16px 0 6px">Scan IDs used twice</h3>${Object.entries(d.dupScan).filter(([, l]) => l.length).map(([src, l]) =>
        l.slice(0, 50).map(x => `<div class="small">${L[src]}: <b class="num">${esc(x.scan)}</b> — ${x.emails.map(esc).join(', ')}</div>`).join('')).join('')}` : ''}
    </section>`}</div>`;

  // ---- source loading
  const hs = $('#hs'); if (hs) hs.onclick = async () => { hs.disabled = true; hs.textContent = 'Pulling…';
    try { const r = await ctx.api(`/api/events/${enc}/scans/hubspot`, { method: 'POST' }); toast(`${r.upload.rows.toLocaleString()} approved registrations`); render(el, ctx); }
    catch (e) { toast(e.message, true); hs.disabled = false; hs.textContent = 'Pull from HubSpot'; } };
  $$('[data-up]', el).forEach(inp => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return; const src = inp.dataset.up;
    const sp = splitHeader(csvRows(await readFile(f))); const heads = sp.header;
    const keys = heads.map((_, i) => String(i));
    const rows = sp.body.map(r => Object.fromEntries(keys.map(k => [k, String(r[+k] ?? '').trim()])));
    if (!rows.length) return toast('That file has no rows', true);
    const want = [['email', 'Email'], ['first_name', 'First name'], ['last_name', 'Last name'], ['company', 'Company'], ['job_title', 'Job title'], ['scan_id', 'Scan ID'], ['badge', 'Badge type'], ['ext_id', 'Their Registration / record ID']];
    const auto = {}; heads.forEach((h, i) => { let g = guessField(h); if (g === 'registration_id') g = 'ext_id'; if (g && !auto[g]) auto[g] = String(i); });
    if (!auto.ext_id) { const i = heads.findIndex(h => /^(id|attendee id|contact id|record id|user id)$/i.test(h.trim())); if (i >= 0) auto.ext_id = String(i); }
    ctx.dialog(`${L[src]} columns`, `<p class="small mut" style="margin-top:0">${plural(rows.length, 'row')} in ${esc(f.name)}. Check each field points at the right column.</p>
      <div class="form">${want.map(([k, lab]) => `<div class="field"><label for="m-${k}">${lab}</label><select class="input" id="m-${k}"><option value="">—</option>
        ${keys.map((c, i) => `<option value="${esc(c)}" ${auto[k] === c ? 'selected' : ''}>${esc(heads[i] || c)}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="actions"><button class="btn pri" id="go">Load ${plural(rows.length, 'row')}</button></div>`, (dl) => {
      dl.querySelector('#go').onclick = async () => {
        const m = Object.fromEntries(want.map(([k]) => [k, dl.querySelector('#m-' + k).value]));
        if (!m.email) return toast('Choose the email column', true);
        const out = rows.map(r => Object.fromEntries(want.map(([k]) => [k, m[k] ? r[m[k]] : ''])));
        const go = dl.querySelector('#go'); go.disabled = true;
        try { let append = null;
          for (let i = 0; i < out.length; i += 10000) { go.textContent = `Loading ${Math.min(i + 10000, out.length).toLocaleString()} of ${out.length.toLocaleString()}…`;
            const r = await ctx.api(`/api/events/${enc}/scans/upload`, { method: 'POST', body: { source: src, filename: f.name, rows: out.slice(i, i + 10000), append } }); append = r.upload.id; }
          ctx.closeDialog(); toast(`${L[src]} loaded`); render(el, ctx); } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Try again'; }
      };
    });
  });

  // ---- settings
  $('#set').onclick = () => ctx.dialog('When they disagree, which is right?', `<div class="form">
      <div class="field"><label for="bt">Badge type comes from</label><select class="input" id="bt">${['hubspot', 'reftech', 'grip'].map(x => `<option value="${x}" ${d.settings.badgeTruth === x ? 'selected' : ''}>${L[x]}</option>`).join('')}</select></div>
      <div class="field"><label for="st">Scan IDs come from</label><select class="input" id="st">${['hubspot', 'reftech', 'grip'].map(x => `<option value="${x}" ${d.settings.scanTruth === x ? 'selected' : ''}>${L[x]}</option>`).join('')}</select></div></div>
      <p class="small mut">Fix files correct the other systems to match these. If HubSpot is picked for scan IDs, anyone without one in HubSpot (e.g. exhibitors) falls back to Reftech.</p><div class="actions"><button class="btn pri" id="sv">Save</button></div>`, (dl) => {
    dl.querySelector('#sv').onclick = async () => { try { await ctx.api(`/api/events/${enc}/scans/settings`, { method: 'PUT', body: { badgeTruth: dl.querySelector('#bt').value, scanTruth: dl.querySelector('#st').value } }); ctx.closeDialog(); render(el, ctx); } catch (e) { toast(e.message, true); } };
  });

  // ---- templates
  $('#tpl').onclick = () => {
    const body = ['reftech', 'grip'].map(src => { const t = d.templates[src];
      return `<section style="margin-bottom:16px"><div style="display:flex;align-items:center;gap:8px"><h3 class="grow">${L[src]}</h3>
        ${t ? `<button class="btn sm" data-tdel="${src}">Remove</button>` : ''}
        <label class="btn sm" style="cursor:pointer">${t ? 'Replace' : 'Upload'} template<input type="file" accept=".csv,text/csv" data-tpl="${src}" hidden></label></div>
        <p class="small mut" style="margin:4px 0">${t ? `${esc(t.filename || '')} · ${t.columns.length} columns · ${t.event_id ? 'this event only' : 'default for all events'}${t.split_by_badge ? ' · one file per badge type' : ''} · ${fmtDateTime(t.at)}` : 'Not set — fix files use a plain layout.'}</p>
        <div data-cols="${src}"></div></section>`; }).join('');
    ctx.dialog('Upload templates', `<p class="small mut" style="margin-top:0">Upload each system's import template as CSV. Instruction rows above the header are kept, and fix files are written in that exact layout, ready to import.</p>${body}`, (dl) => {
      const editor = (src, t) => {
        const box = dl.querySelector(`[data-cols="${src}"]`); const cols = t.columns;
        const forEv = t.event_id != null ? !!t.event_id : false, split = t.split_by_badge != null ? t.split_by_badge : src === 'grip';
        box.innerHTML = `${t.preamble && t.preamble.length ? `<p class="small mut">${plural(t.preamble.length, 'instruction row')} above the header will be kept.</p>` : ''}
          <div class="form">${cols.map((c, i) => `<div class="field"><label for="tc-${src}-${i}">${esc(c.header)}</label>
          <select class="input" id="tc-${src}-${i}">${FIELDS.map(([v, lab]) => `<option value="${v}" ${c.field === v ? 'selected' : ''}>${lab}</option>`).join('')}
          ${c.field && c.field.startsWith('=') ? `<option value="${esc(c.field)}" selected>Fixed: ${esc(c.field.slice(1))}</option>` : ''}<option value="=?">Fixed value…</option></select></div>`).join('')}</div>
          <label class="small" style="display:block;margin-top:10px"><input type="checkbox" data-split ${split ? 'checked' : ''}> One file per badge type ${src === 'grip' ? '(Grip imports one data type at a time)' : ''}</label>
          <label class="small" style="display:block;margin-top:6px"><input type="checkbox" data-forev ${forEv ? 'checked' : ''}> Only for ${esc(ev.short_name || ev.name)} (otherwise the default for every show)</label>
          <div class="actions"><button class="btn pri sm" data-save="${src}">Save ${L[src]} template</button></div>`;
        box.querySelectorAll('select').forEach(sel => sel.onchange = () => { if (sel.value === '=?') { const v = prompt('Value to put in every row'); if (v != null) { const o = new Option('Fixed: ' + v, '=' + v, true, true); sel.add(o); } else sel.value = ''; } });
        box.querySelector('[data-save]').onclick = async () => {
          const out = cols.map((c, i) => ({ header: c.header, field: box.querySelector(`#tc-${src}-${i}`).value }));
          try { await ctx.api(`/api/scan-templates/${src}`, { method: 'PUT', body: { columns: out, filename: t.filename, preamble: t.preamble || [],
              split_by_badge: box.querySelector('[data-split]').checked, event_id: box.querySelector('[data-forev]').checked ? ev.id : null } });
            toast(`${L[src]} template saved`); ctx.closeDialog(); render(el, ctx); } catch (e) { toast(e.message, true); }
        };
      };
      ['reftech', 'grip'].forEach(src => { if (d.templates[src]) editor(src, d.templates[src]); });
      dl.querySelectorAll('[data-tdel]').forEach(btn => btn.onclick = async () => { const t = d.templates[btn.dataset.tdel];
        try { await ctx.api(`/api/scan-templates/${btn.dataset.tdel}${t.event_id ? '?event=' + encodeURIComponent(t.event_id) : ''}`, { method: 'DELETE' }); ctx.closeDialog(); render(el, ctx); } catch (e) { toast(e.message, true); } });
      dl.querySelectorAll('[data-tpl]').forEach(inp => inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return; const sp = splitHeader(csvRows(await readFile(f)));
        if (!sp.header.filter(Boolean).length) return toast('No header row in that file', true);
        const used = new Set();
        editor(inp.dataset.tpl, { filename: f.name, preamble: sp.preamble, columns: sp.header.filter(Boolean).map(h => { let g = guessField(h); if (g && used.has(g)) g = ''; if (g) used.add(g); return { header: h, field: g }; }) });
      });
    });
  };

  // ---- badge map
  $('#bm').onclick = async () => {
    const b = await ctx.api(`/api/events/${enc}/scans/badges`);
    ctx.dialog('Badge types', `<p class="small mut" style="margin-top:0">Each system spells badge types its own way. Give values that mean the same thing the same tidy name.</p>
      <div style="max-height:55vh;overflow:auto"><table class="t"><thead><tr><th>System</th><th>Their value</th><th class="r">People</th><th>Tidy name</th></tr></thead><tbody>
      ${b.values.map((v, i) => `<tr><td>${L[v.source]}</td><td>${esc(v.raw || '(blank)')}</td><td class="r num">${v.n}</td>
        <td><input class="input" data-bi="${i}" value="${esc(v.canonical)}" list="canon" style="min-width:160px"></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Load a source first.</td></tr>'}</tbody></table>
      <datalist id="canon">${[...new Set(b.values.map(v => v.canonical).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="actions"><button class="btn pri" id="bs">Save</button></div>`, (dl) => {
      dl.querySelector('#bs').onclick = async () => {
        const map = b.values.map((v, i) => ({ source: v.source, raw: v.raw, canonical: dl.querySelector(`[data-bi="${i}"]`).value })).filter((m, i) => m.canonical !== b.values[i].canonical || b.values[i].mapped);
        try { await ctx.api(`/api/events/${enc}/scans/badges`, { method: 'PUT', body: { map } }); ctx.closeDialog(); render(el, ctx); } catch (e) { toast(e.message, true); }
      };
    });
  };

  if (have.length < 2) return;
  // ---- results table
  const list = () => d[tab].filter(x => (showAcked || !x.acked) && (!filter || `${x.name} ${x.email} ${x.company}`.toLowerCase().includes(filter.toLowerCase())));
  const who = (x) => `<b>${esc(x.name || x.email)}</b><div class="small mut">${esc(x.email)}${x.company ? ' · ' + esc(x.company) : ''}</div>`;
  const yes = (on) => on ? '<span class="good-t">✓</span>' : '<span class="warn-t">✗</span>';
  const draw = () => {
    const rows = list();
    $('#th').innerHTML = tab === 'missing' ? `<tr><th>Person</th>${have.map(x => `<th>${L[x]}</th>`).join('')}<th></th></tr>`
      : tab === 'badge' ? `<tr><th>Person</th>${have.map(x => `<th>${L[x]}</th>`).join('')}<th></th></tr>`
      : `<tr><th>Person</th>${d.sources.hubspot ? '<th>HubSpot</th>' : ''}<th>Reftech</th><th>Grip</th><th>Should be</th><th>Problem</th><th></th></tr>`;
    $('#tb').innerHTML = rows.slice(0, 1000).map((x, i) => `<tr class="${x.acked ? 'mut' : ''}"><td>${who(x)}${x.maybe && x.maybe.length ? `<div class="small warn-t">Same name as ${x.maybe.map(esc).join(', ')}</div>` : ''}</td>
      ${tab === 'missing' ? have.map(s => `<td>${yes(x.in.includes(s))}</td>`).join('')
        : tab === 'badge' ? have.map(s => `<td>${x.types[s] ? `${esc(x.types[s].type || '(blank)')}${x.types[s].raw && x.types[s].raw !== x.types[s].type ? `<div class="small mut">${esc(x.types[s].raw)}</div>` : ''}` : '<span class="mut">—</span>'}${s === d.settings.badgeTruth ? ' <span class="chip">right</span>' : ''}</td>`).join('')
        : `${d.sources.hubspot ? `<td class="num">${esc(x.hubspot || '—')}</td>` : ''}<td class="num">${esc(x.reftech == null ? 'not in' : x.reftech || '—')}</td><td class="num">${esc(x.grip == null ? 'not in' : x.grip || '—')}</td><td class="num"><b>${esc(x.right || '?')}</b></td><td class="small">${esc(x.problem)}</td>`}
      <td class="r"><button class="btn sm" data-ack="${i}">${x.acked ? 'Reopen' : 'Accept'}</button></td></tr>`).join('')
      || `<tr><td colspan="6" class="empty good-t">${filter ? 'Nothing matches.' : 'All clear.'}</td></tr>`;
    if (rows.length > 1000) $('#tb').insertAdjacentHTML('beforeend', `<tr><td colspan="6" class="small mut">Showing 1,000 of ${rows.length.toLocaleString()} — export for the full list.</td></tr>`);
    $$('[data-ack]', el).forEach(btn => btn.onclick = async () => { const x = rows[+btn.dataset.ack];
      const note = x.acked ? null : prompt('Why is this OK? (optional)', ''); if (note === null && !x.acked) return;
      try { await ctx.api(`/api/events/${enc}/scans/ack`, { method: 'POST', body: { kind: tab, key: x.key, note, undo: x.acked } }); render(el, ctx); } catch (e) { toast(e.message, true); } });
    // fix files for this check
    const fx = [];
    if (tab === 'missing') ['reftech', 'grip'].forEach(t => { const n = d.missing.filter(m => !m.acked && m.notIn.includes(t)).length; if (n && d.sources[t]) fx.push([t, 'add', `Add ${plural(n, 'person', 'people')} to ${L[t]}`]); });
    if (tab === 'badge') ['reftech', 'grip'].filter(t => t !== d.settings.badgeTruth && d.sources[t]).forEach(t => fx.push([t, 'badge', `${L[t]} badge fixes`]));
    const ns = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
    if (tab === 'scan') ['reftech', 'grip'].filter(t => t !== d.settings.scanTruth && d.sources[t]).forEach(t => {
      const n = d.scan.filter(x => !x.acked && x[t] != null && x.right && ns(x[t]) !== ns(x.right)).length;
      if (n) fx.push([t, 'scan', `${L[t]} scan ID fixes (${n})`]); });
    $('#fixes').innerHTML = fx.map(([t, k, lab]) => `<button class="btn sm pri" data-fx="${t}/${k}">⬇ ${lab}</button>`).join('')
      + (fx.length ? `<span class="small mut" style="align-self:center">${fx.some(([t]) => !d.templates[t]) ? 'Plain layout — upload templates to get ready-to-import files.' : 'In each system’s upload template.'}</span>` : '');
    $$('[data-fx]', el).forEach(btn => btn.onclick = async () => { try { const r = await ctx.api(`/api/events/${enc}/scans/fix/${btn.dataset.fx}`);
      if (!r.rows) return toast('Nothing to fix there');
      const warn = r.missingRegistrationIds ? `<p class="small warn-t">${plural(r.missingRegistrationIds, 'row')} without a Registration ID — Grip needs one.</p>` : '';
      if (r.files.length === 1 && !warn) { download(r.filename, r.csv); return toast(`${plural(r.rows, 'row')} — ${r.filename}`); }
      ctx.dialog('Fix files', `<p class="small mut" style="margin-top:0">${r.split ? 'One file per badge type — import each into its matching data type.' : ''}</p>${warn}
        ${r.files.map((x, i) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0"><div class="grow"><b>${esc(x.badge || 'All')}</b><div class="small mut">${esc(x.filename)}</div></div>
          <span class="chip">${x.rows}</span><button class="btn sm pri" data-dl="${i}">Download</button></div>`).join('')}`, (dl) => {
        dl.querySelectorAll('[data-dl]').forEach(b2 => b2.onclick = () => { const x = r.files[+b2.dataset.dl]; download(x.filename, x.csv); b2.textContent = 'Downloaded'; });
      }); } catch (e) { toast(e.message, true); } });
  };
  draw();
  $$('[data-tab]', el).forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el, ctx); });
  $('#sq').oninput = (e) => { filter = e.target.value; draw(); };
  $('#sa').onchange = (e) => { showAcked = e.target.checked; draw(); };
  $('#exp').onclick = () => {
    const rows = list(); const base = [{ label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Company', key: 'company' }];
    const cols = tab === 'missing' ? [...base, ...have.map(s => ({ label: 'In ' + L[s], get: r => r.in.includes(s) ? 'Yes' : 'No' })), { label: 'Same name as', get: r => (r.maybe || []).join('; ') }]
      : tab === 'badge' ? [...base, ...have.flatMap(s => [{ label: L[s] + ' badge', get: r => r.types[s]?.raw || '' }, { label: L[s] + ' tidy', get: r => r.types[s]?.type || '' }])]
      : [...base, { label: 'HubSpot scan ID', key: 'hubspot' }, { label: 'Reftech scan ID', key: 'reftech' }, { label: 'Grip scan ID', key: 'grip' }, { label: 'Should be', key: 'right' }, { label: 'Problem', key: 'problem' }];
    download(`${(ev.short_name || ev.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-scan-check-${tab}.csv`, '﻿' + toCSV(rows, cols.map(c => ({ ...c, get: c.get || (r => r[c.key]) }))));
  };
}
