// Kit register: every phone, charger and scanner by the number on its sticker.
import { esc, $, $$, fmtDateTime, toast } from '../util.js';

export async function render(el, ctx) {
  const ev = ctx.ev;
  const personPre = new URLSearchParams(location.hash.split('?')[1] || '').get('person');
  const [kit, ci] = await Promise.all([ctx.api(`/api/kit${ev ? '?event=' + encodeURIComponent(ev.id) : ''}`), ev ? ctx.api(`/api/events/${encodeURIComponent(ev.id)}/checkin`).catch(() => null) : null]);
  const people = ci ? ci.people : [];
  const out = kit.items.filter(i => i.loan_id);
  const pre = people.find(p => p.id === personPre);
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev ? ev.short_name || ev.name : 'All events')}</div><h1>Kit register</h1></div>
      <div class="pills"><span class="chip ${out.length ? 'warn' : 'good'}">${out.length} out</span><span class="chip">${kit.items.length} items</span></div></header>
    ${pre ? `<div class="banner">Issuing to <b>${esc(pre.name)}</b> — tap Issue next to an item.</div>` : ''}
    <div class="row2">
      <section class="card" style="flex:3 1 520px;min-width:0"><div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><h2 class="grow">Items</h2><label class="sr" for="kq">Find a sticker</label><input class="input" id="kq" placeholder="Sticker number or name" style="max-width:240px"></div>
        <div class="scroll-x"><table class="t"><thead><tr><th>Sticker</th><th>Item</th><th>With</th><th>Since</th><th></th></tr></thead><tbody id="kt">
        ${kit.items.map(i => `<tr data-s="${esc((i.sticker + ' ' + i.kind + ' ' + (i.label || '') + ' ' + (i.holder || '')).toLowerCase())}"><td><b class="num">#${esc(i.sticker)}</b></td><td>${esc(i.kind)}${i.label ? ' · ' + esc(i.label) : ''}</td>
          <td>${i.holder ? `<b>${esc(i.holder)}</b>` : '<span class="good-t">In the box</span>'}</td><td class="small mut">${i.issued_at ? fmtDateTime(i.issued_at) : ''}</td>
          <td class="r">${i.loan_id ? `<button class="btn sm" data-ret="${i.id}">Returned</button>` : ev ? `<button class="btn sm pri" data-iss="${i.id}">Issue</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No kit registered yet.</td></tr>'}</tbody></table></div></section>
      <section class="card" style="flex:2 1 300px;min-width:0"><h2 style="margin-bottom:10px">Register an item</h2>
        <form id="add" class="form"><div class="field"><label for="st">Sticker number</label><input class="input" id="st" required></div>
          <div class="field"><label for="kd">Kind</label><select class="input" id="kd"><option>phone</option><option>charger</option><option>scanner</option><option>tablet</option><option>other</option></select></div>
          <div class="field" style="grid-column:1/-1"><label for="lb">Label (optional)</label><input class="input" id="lb" placeholder="e.g. iPhone SE, white case"></div>
          <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">Add</button></div></form>
        ${ev ? `<h3 style="margin:18px 0 8px">Still out at ${esc(ev.short_name || ev.name)}</h3>${out.filter(i => i.loan_event === ev.id).map(i => `<div class="small" style="padding:4px 0">#${esc(i.sticker)} ${esc(i.kind)} — <b>${esc(i.holder)}</b></div>`).join('') || '<p class="small good-t">Everything is back.</p>'}` : ''}
      </section></div></div>`;
  $('#kq').oninput = (e) => { const v = e.target.value.toLowerCase(); $$('#kt tr[data-s]').forEach(r => { r.style.display = r.dataset.s.includes(v) ? '' : 'none'; }); };
  const f = $('#add');
  f.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api('/api/kit', { method: 'POST', body: { sticker: f.st.value, kind: f.kd.value, label: f.lb.value } }); render(el, ctx); } catch (err) { toast(err.message, true); } };
  $$('[data-ret]', el).forEach(b => b.onclick = async () => { try { await ctx.api(`/api/kit/${b.dataset.ret}/return`, { method: 'POST' }); toast('Marked as returned'); render(el, ctx); } catch (e) { toast(e.message, true); } });
  $$('[data-iss]', el).forEach(b => b.onclick = () => {
    const issue = async (pid) => { try { await ctx.api(`/api/kit/${b.dataset.iss}/issue`, { method: 'POST', body: { event_id: ev.id, person_id: pid } }); ctx.closeDialog(); toast('Issued'); render(el, ctx); } catch (e) { toast(e.message, true); } };
    if (pre) return issue(pre.id);
    ctx.dialog('Issue to…', people.length ? `<label class="sr" for="pq">Search</label><input class="input" id="pq" placeholder="Search name" style="margin-bottom:8px"><div style="max-height:50vh;overflow:auto">${people.map(p => `<button class="btn" data-pp="${p.id}" style="width:100%;justify-content:flex-start;margin-bottom:6px">${esc(p.name)}</button>`).join('')}</div>` : '<p>No crew on this event yet.</p>', (d) => {
      d.querySelectorAll('[data-pp]').forEach(x => x.onclick = () => issue(x.dataset.pp));
      const pq = d.querySelector('#pq'); if (pq) pq.oninput = () => d.querySelectorAll('[data-pp]').forEach(x => { x.style.display = x.textContent.toLowerCase().includes(pq.value.toLowerCase()) ? '' : 'none'; });
    });
  });
}
