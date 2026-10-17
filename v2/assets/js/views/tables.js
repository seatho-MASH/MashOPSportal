// Table planner — summits, awards and lunches. Pick a guest (or a whole
// company) then a table, or drag. Auto-seat keeps companies together.
import { esc, $, $$, parseCSV, toCSV, download, toast, plural } from '../util.js';

let selected = null;   // { type:'guest'|'org', id }

export async function render(el, ctx) {
  const ev = ctx.ev, E = encodeURIComponent(ev.id);
  const d = await ctx.api(`/api/events/${E}/tables`);
  const un = d.guests.filter(g => !g.table_id);
  const groups = [...un.reduce((m, g) => { const k = g.organisation || '(no company)'; (m.get(k) || m.set(k, []).get(k)).push(g); return m; }, new Map()).entries()].sort((a, b) => b[1].length - a[1].length);
  const at = (tid) => d.guests.filter(g => g.table_id === tid);
  const fill = (t) => at(t.id).length;
  const dietTags = (list) => { const c = {}; list.forEach(g => { const k = dietKey(g.dietary); if (k) c[k] = (c[k] || 0) + 1; }); return Object.entries(c).map(([k, n]) => `<span class="chip ${k === 'Vegetarian' || k === 'Vegan' ? 'good' : 'warn'}">${n} ${esc(k)}</span>`).join(''); };
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Table planner</h1></div>
      <div class="pills" style="gap:8px"><button class="btn" id="auto">Auto-seat by company</button><button class="btn" id="xven">Export for venue</button><button class="btn" id="xcard">Place cards CSV</button><button class="btn pri" id="print">Print seating plan</button></div></header>
    <section class="grid-kpi">
      <div class="card tight kpi"><div class="l">Guests</div><div class="n">${d.totals.guests}</div></div>
      <div class="card tight kpi"><div class="l">Seated</div><div class="n">${d.totals.seated}<span class="mut" style="font-size:15px"> / ${d.totals.seats} seats</span></div></div>
      <div class="card tight kpi"><div class="l">Tables</div><div class="n">${d.tables.length}</div></div>
      <div class="card tight kpi"><div class="l">Not seated</div><div class="n ${un.length ? 'warn-t' : ''}">${un.length}</div></div></section>
    ${selected ? `<div class="banner" role="status">Selected <b>${selected.type === 'org' ? esc(selected.id) + ' (whole company)' : esc((d.guests.find(g => g.id === selected.id) || {}).name || '')}</b> — now click a table. <button class="btn sm" id="clear">Cancel</button></div>` : ''}
    <div class="row2">
      <aside class="card" style="flex:1 1 280px;max-width:360px" aria-labelledby="un"><h2 id="un">Not seated yet</h2><p class="small mut" style="margin:4px 0 10px">Click a company to move them all, or a name for one person. Drag works too.</p>
        ${groups.map(([org, list]) => `<div style="border:1px solid #E4E1DA;border-radius:12px;padding:10px 12px;margin-bottom:10px">
          <button class="btn sm ghost" data-org="${esc(org)}" style="padding:0;min-height:28px;font-weight:800">${esc(org)} <span class="chip">${list.length}</span></button>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${list.map(g => `<span class="g${selected && selected.id === g.id ? ' sel' : ''}" draggable="true" data-g="${g.id}" tabindex="0" role="button">${esc(g.name || 'Unnamed')}${dietKey(g.dietary) ? ' · ' + esc(dietKey(g.dietary)) : ''}</span>`).join('')}</div></div>`).join('') || '<p class="good-t">Everyone is seated.</p>'}
        <details style="margin-top:12px"><summary style="font-weight:700;cursor:pointer">Add guests</summary>
          <form id="ag" class="form" style="margin-top:10px"><div class="field"><label for="gn">Name</label><input class="input" id="gn"></div><div class="field"><label for="go">Company</label><input class="input" id="go"></div>
            <div class="field"><label for="gd">Dietary</label><input class="input" id="gd"></div><div class="field"><label for="ga">Access</label><input class="input" id="ga"></div>
            <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">Add guest</button></div></form>
          <p class="small mut" style="margin:10px 0 6px">Or paste a CSV: name, organisation, dietary, access</p><textarea class="input" id="gcsv" aria-label="Guests CSV"></textarea><div class="actions"><button class="btn" id="gimp">Import</button></div></details>
      </aside>
      <section style="flex:999 1 520px;min-width:0">
        <div class="tgrid">${d.tables.map(t => { const n = fill(t), list = at(t.id); return `<div class="dt" data-t="${t.id}">
            <div class="ring ${n >= t.seats ? 'full' : n ? 'part' : ''}"><span class="small mut" style="font-weight:700">Table</span><b style="font-size:24px;line-height:1">${t.number}</b><span class="small ${n > t.seats ? 'bad-t' : 'mut'}" style="font-weight:700">${n} / ${t.seats}</span></div>
            <div style="text-align:center;font-weight:700">${esc(t.label || [...new Set(list.map(g => g.organisation).filter(Boolean))].join(' · ') || 'Empty')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center">${dietTags(list)}</div>
            <div style="display:flex;flex-direction:column;gap:3px">${list.map(g => `<span class="g" draggable="true" data-g="${g.id}" title="${esc(g.organisation || '')}">${esc(g.name || 'Unnamed')}<button class="btn ghost sm" data-unseat="${g.id}" style="margin-left:auto;min-height:24px;padding:0 6px" aria-label="Unseat ${esc(g.name)}">✕</button></span>`).join('')}</div>
            <div style="display:flex;gap:6px;justify-content:center"><button class="btn sm" data-edit="${t.id}">Edit</button></div></div>`; }).join('')}
          <div class="dt" style="justify-content:center;align-items:stretch"><form id="at" class="form" style="grid-template-columns:1fr 1fr"><div class="field"><label for="tc">Add tables</label><input class="input" id="tc" type="number" min="1" value="1"></div><div class="field"><label for="ts">Seats each</label><input class="input" id="ts" type="number" min="1" value="10"></div><button class="btn pri" style="grid-column:1/-1">Add</button></form></div>
        </div></section>
      <aside class="card" style="flex:1 1 220px;max-width:260px" aria-labelledby="cat"><h2 id="cat" style="margin-bottom:10px">For the caterer</h2>
        ${Object.entries(d.diet).map(([k, n]) => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${esc(k)}</span><b>${n}</b></div>`).join('') || '<p class="small mut">No dietary needs recorded.</p>'}
        <h2 style="margin:16px 0 10px">Access</h2>${Object.entries(d.access).map(([k, n]) => `<div style="display:flex;justify-content:space-between;padding:4px 0;gap:8px"><span>${esc(k)}</span><b>${n}</b></div>`).join('') || '<p class="small mut">None recorded.</p>'}</aside>
    </div></div>`;
  const again = () => render(el, ctx);
  const seatOne = async (gid, tid) => ctx.api(`/api/events/${E}/seating`, { method: 'POST', body: { guest_id: gid, table_id: tid } });
  const seatSel = async (tid) => {
    if (!selected) return;
    const ids = selected.type === 'org' ? un.filter(g => (g.organisation || '(no company)') === selected.id).map(g => g.id) : [selected.id];
    let done = 0;
    for (const id of ids) { try { await seatOne(id, tid); done++; } catch (e) { toast(e.message, true); break; } }
    selected = null; if (done) toast(`${plural(done, 'guest')} seated`); again();
  };
  $$('[data-org]', el).forEach(b => b.onclick = () => { selected = { type: 'org', id: b.dataset.org }; again(); });
  $$('.g[data-g]', el).forEach(g => {
    g.onclick = (e) => { if (e.target.closest('[data-unseat]')) return; selected = { type: 'guest', id: g.dataset.g }; again(); };
    g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.click(); } };
    g.ondragstart = (e) => e.dataTransfer.setData('text/plain', g.dataset.g);
  });
  $$('.dt[data-t]', el).forEach(t => {
    t.onclick = (e) => { if (e.target.closest('button,.g')) return; seatSel(t.dataset.t); };
    t.ondragover = (e) => { e.preventDefault(); t.classList.add('drop'); };
    t.ondragleave = () => t.classList.remove('drop');
    t.ondrop = async (e) => { e.preventDefault(); t.classList.remove('drop'); try { await seatOne(e.dataTransfer.getData('text/plain'), t.dataset.t); again(); } catch (err) { toast(err.message, true); } };
  });
  $$('[data-unseat]', el).forEach(b => b.onclick = async () => { try { await seatOne(b.dataset.unseat, null); again(); } catch (e) { toast(e.message, true); } });
  $$('[data-edit]', el).forEach(b => b.onclick = () => { const t = d.tables.find(x => x.id === b.dataset.edit);
    ctx.dialog(`Table ${t.number}`, `<form id="f" class="form"><div class="field"><label for="l">Label</label><input class="input" id="l" value="${esc(t.label || '')}" placeholder="e.g. Headline sponsor"></div><div class="field"><label for="s">Seats</label><input class="input" id="s" type="number" min="1" value="${t.seats}"></div>
      <div class="actions" style="grid-column:1/-1"><button type="button" class="btn danger" id="del">Delete table</button><button class="btn pri">Save</button></div></form>`, (bb) => {
      const f = bb.querySelector('#f');
      f.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/tables/${t.id}`, { method: 'PATCH', body: { label: f.l.value, seats: f.s.value } }); ctx.closeDialog(); again(); } catch (err) { toast(err.message, true); } };
      bb.querySelector('#del').onclick = async () => { if (!confirm('Delete this table? Its guests go back to "not seated".')) return; try { await ctx.api(`/api/tables/${t.id}`, { method: 'DELETE' }); ctx.closeDialog(); again(); } catch (e) { toast(e.message, true); } };
    }); });
  const clr = $('#clear', el); if (clr) clr.onclick = () => { selected = null; again(); };
  $('#auto').onclick = async () => { try { const r = await ctx.api(`/api/events/${E}/seating/auto`, { method: 'POST' }); toast(`${r.seated} seated${r.unseated ? `, ${r.unseated} didn't fit — add tables` : ''}`, !!r.unseated); again(); } catch (e) { toast(e.message, true); } };
  const fa = $('#at'); fa.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${E}/tables`, { method: 'POST', body: { count: fa.tc.value, seats: fa.ts.value } }); again(); } catch (err) { toast(err.message, true); } };
  const fg = $('#ag'); fg.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${E}/guests`, { method: 'POST', body: { name: fg.gn.value, organisation: fg.go.value, dietary: fg.gd.value, access: fg.ga.value } }); again(); } catch (err) { toast(err.message, true); } };
  $('#gimp').onclick = async () => { const rows = parseCSV($('#gcsv').value).map(r => ({ ...r, source: 'csv' })); if (!rows.length) return toast('Paste a CSV with a header row first', true);
    try { const r = await ctx.api(`/api/events/${E}/guests`, { method: 'POST', body: { rows } }); toast(`${r.added} added`); again(); } catch (e) { toast(e.message, true); } };
  const tnum = (g) => (d.tables.find(t => t.id === g.table_id) || {}).number || '';
  $('#xven').onclick = () => download(`${ev.id}-tables.csv`, toCSV([...d.guests].sort((a, b) => (tnum(a) || 999) - (tnum(b) || 999)), [{ label: 'Table', get: tnum }, { label: 'Name', key: 'name' }, { label: 'Company', key: 'organisation' }, { label: 'Dietary', key: 'dietary' }, { label: 'Access', key: 'access' }]));
  $('#xcard').onclick = () => download(`${ev.id}-place-cards.csv`, toCSV(d.guests.filter(g => g.table_id), [{ label: 'Name', key: 'name' }, { label: 'Company', key: 'organisation' }, { label: 'Table', get: tnum }]));
  $('#print').onclick = () => {
    const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
    w.document.write(`<!doctype html><title>Seating plan</title><style>body{font:13px Arial;margin:24px}h1{font-size:20px}.t{break-inside:avoid;border:1px solid #ccc;border-radius:8px;padding:10px;margin:0 0 10px;display:inline-block;width:30%;vertical-align:top;margin-right:2%}</style><h1>${esc(ev.name)} — seating plan</h1>${d.tables.map(t => `<div class="t"><b>Table ${t.number}${t.label ? ' · ' + esc(t.label) : ''}</b><br>${at(t.id).map(g => `${esc(g.name)}${g.dietary && dietKey(g.dietary) ? ' (' + esc(dietKey(g.dietary)) + ')' : ''}`).join('<br>')}</div>`).join('')}`);
    w.document.close(); w.focus(); w.print();
  };
}
function dietKey(s) {
  const v = String(s || '').trim(); if (/^(none|n\/?a|no|nil|-|)$/i.test(v)) return null;
  for (const [k, re] of [['Vegetarian', /veggie|vegetarian/i], ['Vegan', /vegan/i], ['Gluten-free', /gluten|coeliac|celiac|\bgf\b/i], ['Nut allergy', /nut/i], ['Dairy-free', /dairy|lactose/i], ['Halal', /halal/i], ['Kosher', /kosher/i]]) if (re.test(v)) return k;
  return 'Other';
}
