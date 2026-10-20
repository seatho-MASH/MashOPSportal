// All attendees: delegates, sponsor reps, speakers and staff in one list, with Scan IDs
// for badging. Each person shows once (Speaker > Sponsor > Delegate; staff separate).
import { esc, $, $$, fmtDateTime } from '../util.js';
import { dash, fmtAdded, slug, wireSearch, sortRows, sortSelect, exportCSV } from './_people.js';

let sort = 'name', type = '';
const CLS = { Delegate: 'brand', Sponsor: 'good', Speaker: 'warn', Staff: '' };
export async function render(el, ctx) {
  const ev = ctx.ev, E = encodeURIComponent(ev.id);
  const d = await ctx.api(`/api/events/${E}/everyone`);
  const rows = sortRows(d.rows, sort).filter(r => !type || r.type === type);
  const c = d.counts;
  el.innerHTML = `<div class="wrap">
    <header class="pagehead noprint"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>All attendees</h1></div>
      <div class="pills">${['Delegate', 'Sponsor', 'Speaker', 'Staff'].map(t => `<span class="chip ${CLS[t]}">${c[t] || 0} ${t.toLowerCase()}${(c[t] || 0) === 1 ? '' : 's'}</span>`).join('')}</div></header>
    ${d.liveError ? `<div class="banner warn noprint">${esc(d.liveError)}</div>` : ''}
    <div class="banner noprint">Everyone for this event in one place, with Scan IDs for badging. Someone on more than one list shows once: Speaker, then Sponsor, then Delegate. Rooms: <b>${d.rooms.allocated}</b>${d.rooms.total != null ? ` of ${d.rooms.total}` : ''}.</div>
    <div class="printhead"><b>${esc(ev.name)}: All attendees</b><br><span class="small">${rows.length} people · printed ${fmtDateTime(new Date())}</span></div>
    <section class="card"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px" class="noprint">
      <label class="sr" for="q">Search</label><input class="input grow" id="q" placeholder="Search everyone…" style="min-width:200px">
      <label class="sr" for="ty">Type</label><select class="input" id="ty" style="width:auto"><option value="">Everyone</option>${['Delegate', 'Sponsor', 'Speaker', 'Staff'].map(t => `<option ${type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${sortSelect(sort)}<span class="small mut" id="cnt"></span><button class="btn sm" id="pr">Print sheet</button><button class="btn sm pri" id="exp">Export CSV</button></div>
      ${rows.length ? `<div class="scroll-x"><table class="t"><thead><tr><th class="c printonly" style="width:30px">In</th><th>Name</th><th>Scan ID</th><th>Type</th><th>Job title</th><th>Company</th><th class="noprint">Email</th><th>Dietary</th><th>Accessibility</th><th class="c">Room</th><th>Notes</th><th>Detail</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-s="${esc((r.name + ' ' + r.company + ' ' + r.jobtitle + ' ' + r.type + ' ' + r.email).toLowerCase())}"><td class="printonly"><span class="tickbox"></span></td><td><b>${esc(r.name)}</b></td>
        <td class="num small">${esc(r.scanId) || dash}</td><td><span class="chip ${CLS[r.type]}">${r.type}</span></td><td>${esc(r.jobtitle) || dash}</td><td>${esc(r.company) || dash}</td>
        <td class="small noprint">${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : dash}</td><td>${esc(r.dietary) || dash}</td><td>${esc(r.accessibility) || dash}</td>
        <td class="c">${r.room ? 'Yes' : dash}</td><td class="small">${esc(r.note) || dash}</td><td class="small">${esc(r.detail) || dash}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><b>Nobody to list yet</b>Delegates, sponsor attendees, speakers and staff appear here as they are added.</div>'}</section></div>`;
  $('#sort', el).onchange = (e) => { sort = e.target.value; render(el, ctx); };
  $('#ty', el).onchange = (e) => { type = e.target.value; render(el, ctx); };
  $('#pr', el).onclick = () => window.print();
  $('#exp', el).onclick = () => exportCSV(`${slug(ev)}-all-attendees.csv`, rows, [{ label: 'Type', key: 'type' }, { label: 'Scan ID', key: 'scanId' }, { label: 'Added', get: r => fmtAdded(r.addedAt) },
    { label: 'Name', key: 'name' }, { label: 'Job title', key: 'jobtitle' }, { label: 'Company', key: 'company' }, { label: 'Email', key: 'email' },
    { label: 'Dietary requirements', key: 'dietary' }, { label: 'Accessibility requirements', key: 'accessibility' }, { label: 'Room required', get: r => r.room ? 'Yes' : '' },
    { label: 'Build', get: r => r.build ? 'Yes' : '' }, { label: 'Breakdown', get: r => r.breakdown ? 'Yes' : '' }, { label: 'Notes', key: 'note' }, { label: 'Detail', key: 'detail' }]);
  if (rows.length) wireSearch(el, $('#q', el), () => $$('tr[data-s]', el), $('#cnt', el), rows.length);
}
