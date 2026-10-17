import { esc, $, $$, fmtDateTime, toast } from '../util.js';

export async function render(el, ctx) {
  const ev = ctx.ev, E = encodeURIComponent(ev.id);
  const d = await ctx.api(`/api/events/${E}/sponsors`);
  const L = d.ledger, last = L.lastSync;
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Sponsors</h1></div>
      <div class="pills" style="gap:8px">${L.configured ? `<button class="btn pri" id="sync">Sync from the Ledger</button>` : ''}</div></header>
    <div class="banner ${L.configured ? (last && last.ok === false ? 'bad' : '') : 'warn'}">${!L.configured ? 'The Ledger isn\'t connected yet, so only manually added sponsors show here. Once it is, sponsors sold on this event appear automatically.'
      : last ? (last.ok ? `Last synced from the Ledger ${fmtDateTime(last.finished_at)} · ${last.counts.sponsors ?? 0} sponsors` : `Last Ledger sync failed: ${esc(last.error || '')}`) : 'Not synced from the Ledger yet.'}</div>
    <div class="row2">
      <section class="card" style="flex:3 1 520px;min-width:0"><h2 style="margin-bottom:10px">${d.sponsors.length} sponsor${d.sponsors.length === 1 ? '' : 's'}</h2>
        ${d.sponsors.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Company</th><th>Tier</th><th>Contact</th><th>Source</th><th></th></tr></thead><tbody>
        ${d.sponsors.map(s => `<tr><td><b>${esc(s.company)}</b></td><td>${s.tier ? `<span class="chip brand">${esc(s.tier)}</span>` : '—'}</td><td class="small">${esc(s.contact_name || '')}${s.contact_email ? `<br><a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>` : ''}</td>
          <td>${s.ledger_ref ? '<span class="chip good">Ledger</span>' : '<span class="chip">Manual</span>'}</td><td class="r">${s.ledger_ref ? '' : `<button class="btn sm danger" data-rm="${s.id}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>No sponsors yet</b></div>'}
      </section>
      <section class="card" style="flex:2 1 300px;min-width:0"><h2 style="margin-bottom:4px">Add a sponsor by hand</h2><p class="small mut" style="margin:0 0 10px">Only for anything not sold through the Ledger (e.g. contra). It's marked as manual.</p>
        <form id="f" class="form"><div class="field" style="grid-column:1/-1"><label for="c">Company</label><input class="input" id="c" required></div>
          <div class="field"><label for="t">Tier</label><input class="input" id="t" list="tiers"><datalist id="tiers"><option>Headline</option><option>Engagement</option><option>Content</option></datalist></div>
          <div class="field"><label for="n">Contact name</label><input class="input" id="n"></div><div class="field" style="grid-column:1/-1"><label for="e">Contact email</label><input class="input" id="e" type="email"></div>
          <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">Add</button></div></form></section></div></div>`;
  const s = $('#sync', el); if (s) s.onclick = async () => { s.disabled = true; try { const r = await ctx.api(`/api/events/${E}/sponsors/sync`, { method: 'POST' }); toast(`${r.sponsors} from the Ledger${r.removed ? `, ${r.removed} no longer there` : ''}`); render(el, ctx); } catch (e) { toast(e.message, true); s.disabled = false; } };
  const f = $('#f', el);
  f.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${E}/sponsors`, { method: 'POST', body: { company: f.c.value, tier: f.t.value, contact_name: f.n.value, contact_email: f.e.value } }); render(el, ctx); } catch (err) { toast(err.message, true); } };
  $$('[data-rm]', el).forEach(b => b.onclick = async () => { try { await ctx.api(`/api/sponsors/${b.dataset.rm}`, { method: 'DELETE' }); render(el, ctx); } catch (e) { toast(e.message, true); } });
}
