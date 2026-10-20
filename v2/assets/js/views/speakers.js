// Speakers: added one at a time or bulk-pasted, matched to HubSpot by email.
import { esc, $, $$, toast, parseCSV } from '../util.js';
import { dash, fmtAdded, slug, roomBar, roomBox, wireRooms, cell, wireCells, wireRemove, wireSearch, sortRows, sortSelect, exportCSV, idChip, addForm, formData, STD_COLS } from './_people.js';

let sort = 'name';
// Rows like the current portal took: Name, Job title, Company, Email, Session, Dietary, Accessibility (header optional).
export function parseSpeakers(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  if (/^\s*"?name"?\s*[,\t]/i.test(lines[0])) {
    return parseCSV(lines.join('\n')).map(r => ({ name: r.name || r.full_name || '', jobtitle: r.job_title || r.jobtitle || '', company: r.company || '', email: r.email || '',
      session: r.session || r.talk || '', dietary: r.dietary || r.dietary_requirements || '', accessibility: r.accessibility || r.accessibility_requirements || '' })).filter(r => r.name);
  }
  return lines.map(l => { const [name, jobtitle = '', company = '', email = '', session = '', dietary = '', accessibility = ''] = l.split(/,|\t/).map(c => c.trim());
    return { name, jobtitle, company, email, session, dietary, accessibility }; }).filter(r => r.name);
}
export async function render(el, ctx) {
  const ev = ctx.ev, E = encodeURIComponent(ev.id);
  const d = await ctx.api(`/api/events/${E}/people/speaker`);
  const rows = sortRows(d.rows, sort);
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Speakers</h1></div><div class="pills"><span class="chip brand">${rows.length}</span></div></header>
    <div class="row2" style="align-items:stretch">
      <div style="flex:1 1 380px;min-width:0">${addForm('add', 'Add a speaker', 'Matched to HubSpot by email; if they aren’t there a badge ID is generated.',
        [['name', 'Full name', 'required'], ['jobtitle', 'Job title'], ['company', 'Company'], ['email', 'Email', 'type="email"'], ['session', 'Session / talk'], ['dietary', 'Dietary requirements'], ['accessibility', 'Accessibility requirements']], 'Add speaker')}</div>
      <details class="card" style="flex:1 1 380px;min-width:0;margin-bottom:14px"><summary style="cursor:pointer;font-weight:700">Bulk upload</summary>
        <p class="small mut" style="margin:6px 0 8px">Paste rows or choose a CSV. Columns: <b>Name, Job title, Company, Email, Session, Dietary, Accessibility</b>. A header row is optional and trailing columns can be left off.</p>
        <label class="sr" for="bulk">Speakers to add</label><textarea class="input" id="bulk" rows="5" placeholder="Jane Smith, Head of Events, Acme Ltd, jane@acme.com, Opening keynote"></textarea>
        <div class="actions"><label class="btn" style="cursor:pointer">Choose CSV<input type="file" id="file" accept=".csv,text/csv" hidden></label><button class="btn pri" id="imp">Import</button></div></details></div>
    ${roomBar(d.rooms)}
    <section class="card"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px">
      <label class="sr" for="q">Search</label><input class="input grow" id="q" placeholder="Search speakers…" style="min-width:200px">${sortSelect(sort)}<span class="small mut" id="cnt"></span><button class="btn sm" id="exp">Export CSV</button></div>
      ${rows.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Name</th><th>Scan ID</th><th>Added</th><th>Job title</th><th>Company</th><th>Email</th><th>Session</th><th>Dietary</th><th>Accessibility</th><th class="c">Room</th><th>Notes</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-s="${esc((r.name + ' ' + r.company + ' ' + r.session + ' ' + r.email).toLowerCase())}"><td><b>${esc(r.name)}</b></td><td>${idChip(r)}</td><td class="small">${fmtAdded(r.addedAt) || dash}</td>
        <td>${cell(r, 'jobtitle')}</td><td>${cell(r, 'company')}</td><td>${cell(r, 'email')}</td><td>${cell(r, 'session')}</td><td>${cell(r, 'dietary')}</td><td>${cell(r, 'accessibility')}</td>
        <td class="c">${roomBox(r)}</td><td>${cell(r, 'note', 'Add note…')}</td><td class="r"><button class="btn sm ghost" data-rmp="${r.id}" data-name="${esc(r.name)}" aria-label="Remove ${esc(r.name)}">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><b>No speakers yet</b>Add them one at a time or bulk upload a list.</div>'}</section></div>`;
  const f = $('#add', el);
  f.onsubmit = async (e) => { e.preventDefault(); const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Checking HubSpot…';
    try { await ctx.api(`/api/events/${E}/people/speaker`, { method: 'POST', body: { rows: [formData(f)] } }); toast('Speaker added'); render(el, ctx); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Add speaker'; } };
  $('#file', el).onchange = async (e) => { const file = e.target.files[0]; if (file) $('#bulk', el).value = await file.text(); };
  $('#imp', el).onclick = async () => {
    const list = parseSpeakers($('#bulk', el).value);
    if (!list.length) return toast('No rows found, check the format', true);
    const b = $('#imp', el); b.disabled = true; b.textContent = 'Matching against HubSpot…';
    try { const r = await ctx.api(`/api/events/${E}/people/speaker`, { method: 'POST', body: { rows: list } });
      toast(`Imported ${list.length}: ${r.matched} matched HubSpot, ${r.generated} given a badge ID`); render(el, ctx); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Import'; }
  };
  $('#sort', el).onchange = (e) => { sort = e.target.value; render(el, ctx); };
  $('#exp', el).onclick = () => exportCSV(`${slug(ev)}-speakers.csv`, rows, [{ label: 'Type', get: () => 'Speaker' }, ...STD_COLS(ev.id).slice(0, 6), { label: 'Session', key: 'session' }, ...STD_COLS(ev.id).slice(6)]);
  if (rows.length) wireSearch(el, $('#q', el), () => $$('tr[data-s]', el), $('#cnt', el), rows.length);
  wireRooms(el, ctx); wireCells(el, ctx); wireRemove(el, ctx, () => render(el, ctx));
}
