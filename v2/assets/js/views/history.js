import { esc, $, $$, fmtDateTime } from '../util.js';
export async function render(el, ctx) {
  const ev = ctx.ev;
  const d = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/history`);
  const areas = [...new Set(d.entries.map(e => e.area))].sort();
  el.innerHTML = `<div class="wrap"><header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>History</h1></div></header>
    <div class="banner">Every change, with the person who made it, taken from their Microsoft sign-in and checked on the server. Entries from the current portal (imported) show who it says made them, which that portal didn't check.</div>
    <section class="card"><div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px"><label class="sr" for="hq">Search</label><input class="input grow" id="hq" placeholder="Search people, items…"><label class="sr" for="ha">Area</label><select class="input" id="ha" style="width:auto"><option value="">All areas</option>${areas.map(a => `<option>${esc(a)}</option>`).join('')}</select></div>
    <div class="scroll-x"><table class="t"><thead><tr><th>When</th><th>Who</th><th>Area</th><th>Change</th></tr></thead><tbody>
    ${d.entries.map(e => `<tr data-a="${esc(e.area)}"><td class="small num">${fmtDateTime(e.at)}</td><td class="small">${esc(e.actor)}</td><td><span class="chip">${esc(e.area)}</span></td><td><b>${esc(e.action)}</b> ${esc(e.item)}${e.detail && e.detail.field ? ` <span class="small mut">· ${esc(e.detail.field)}: “${esc(e.detail.from ?? '')}” → “${esc(e.detail.to ?? '')}”</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>'}</tbody></table></div></section></div>`;
  const f = () => { const qv = $('#hq').value.toLowerCase(), av = $('#ha').value; $$('tr[data-a]', el).forEach(r => { r.style.display = (!qv || r.textContent.toLowerCase().includes(qv)) && (!av || r.dataset.a === av) ? '' : 'none'; }); };
  $('#hq').oninput = f; $('#ha').onchange = f;
}
