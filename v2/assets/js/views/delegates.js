// Delegates: live from HubSpot (Joining Instructions signed) plus walk-ins added here.
import { esc, $, $$, toast } from '../util.js';
import { dash, fmtAdded, slug, roomBar, roomBox, wireRooms, cell, wireCells, wireRemove, wireSearch, sortRows, sortSelect, exportCSV, idChip, addForm, formData, STD_COLS } from './_people.js';

let sort = 'name', search = '';
export async function render(el, ctx, fresh = false) {
  const ev = ctx.ev, E = encodeURIComponent(ev.id);
  const d = await ctx.api(`/api/events/${E}/delegates${fresh ? '?fresh=1' : ''}`);
  const rows = sortRows(d.rows, sort);
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Delegates</h1></div>
      <div class="pills"><span class="chip brand">${d.live} from HubSpot</span><span class="chip">${d.walkins} walk-in${d.walkins === 1 ? '' : 's'}</span></div></header>
    ${d.liveError ? `<div class="banner warn">${esc(d.liveError)}</div>` : `<div class="banner">Delegates appear here once their <b>Joining Instructions are signed</b> in HubSpot (${esc(ev.ops_ji)}). Approvals stay with marketing.</div>`}
    ${addForm('add', 'Add a walk-in', 'Checked against HubSpot by email: if they’re there, their Scan ID and details come through. If not, a badge ID is generated.',
      [['name', 'Full name', 'required'], ['jobtitle', 'Job title'], ['company', 'Company'], ['email', 'Email', 'type="email"'], ['dietary', 'Dietary requirements'], ['accessibility', 'Accessibility requirements']], 'Add delegate')}
    ${roomBar(d.rooms)}
    <section class="card"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px">
      <label class="sr" for="q">Search</label><input class="input grow" id="q" placeholder="Search name, company, job title…" value="${esc(search)}" style="min-width:200px">
      ${sortSelect(sort)}<span class="small mut" id="cnt"></span><button class="btn sm" id="exp">Export CSV</button><button class="btn sm" id="rel" title="Reload from HubSpot">Reload</button></div>
      ${rows.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Name</th><th>Scan ID</th><th>Added</th><th>Job title</th><th>Company</th><th>Email</th><th>Dietary</th><th>Accessibility</th><th class="c">Room</th><th>Notes</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-s="${esc((r.name + ' ' + r.company + ' ' + r.jobtitle + ' ' + r.email).toLowerCase())}">
        <td><b>${esc(r.name)}</b>${r.manual ? ' <span class="chip">walk-in</span>' : ''}</td><td>${idChip(r)}</td><td class="small">${fmtAdded(r.addedAt) || dash}</td>
        ${r.manual ? `<td>${cell(r, 'jobtitle')}</td><td>${cell(r, 'company')}</td><td>${cell(r, 'email')}</td><td>${cell(r, 'dietary')}</td><td>${cell(r, 'accessibility')}</td>`
          : `<td>${esc(r.jobtitle) || dash}</td><td>${esc(r.company) || dash}</td><td class="small">${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : dash}</td><td>${esc(r.dietary) || dash}</td><td>${esc(r.accessibility) || dash}</td>`}
        <td class="c">${roomBox(r)}</td>
        <td>${r.manual ? cell(r, 'note', 'Add note…') : `<input class="input cellin" data-pid="${esc(r.hubspotId)}" data-k="note" data-method="PUT" value="${esc(r.note)}" placeholder="Add note…" aria-label="Note for ${esc(r.name)}">`}</td>
        <td class="r">${r.manual ? `<button class="btn sm ghost" data-rmp="${r.id}" data-name="${esc(r.name)}" aria-label="Remove ${esc(r.name)}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><b>No delegates yet</b>They appear as joining instructions are signed, or add walk-ins above.</div>'}</section></div>`;
  const f = $('#add', el);
  f.onsubmit = async (e) => { e.preventDefault(); const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Checking HubSpot…';
    try { const r = await ctx.api(`/api/events/${E}/people/delegate`, { method: 'POST', body: { rows: [formData(f)] } });
      toast(r.matched ? 'Added, matched in HubSpot' : `Added with badge ID ${r.added[0].scanId}`); render(el, ctx); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Add delegate'; } };
  $('#sort', el).onchange = (e) => { sort = e.target.value; render(el, ctx); };
  $('#rel', el).onclick = () => render(el, ctx, true);
  $('#exp', el).onclick = () => exportCSV(`${slug(ev)}-delegates.csv`, rows, [{ label: 'Type', get: r => r.manual ? 'Walk-in' : 'Delegate' }, ...STD_COLS(ev.id)]);
  const q = $('#q', el); if (q) { wireSearch(el, q, () => $$('tr[data-s]', el), $('#cnt', el), rows.length); q.addEventListener('input', () => { search = q.value; }); }
  wireRooms(el, ctx);
  wireCells(el, ctx, (pid, k) => ($$(`input.cellin[data-pid="${CSS.escape(pid)}"][data-method]`, el).length ? `/api/events/${E}/delegate-notes/${pid}` : `/api/people/${pid}`));
  wireRemove(el, ctx, () => render(el, ctx));
}
