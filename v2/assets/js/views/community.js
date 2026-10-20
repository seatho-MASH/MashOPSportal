// Community planner: minimum community delegates needed to cover every sponsor's 1-2-1s.
import { esc, $, $$, toast } from '../util.js';
import { slug, exportCSV } from './_people.js';

export async function render(el, ctx, data) {
  const ev = ctx.ev, E = encodeURIComponent(ev.id);
  const d = data || await ctx.api(`/api/events/${E}/community`);
  const r = d.result, s = d.settings;
  const minTxt = r.required == null ? '∞' : r.required;
  let verdict;
  if (r.required == null) verdict = ['warn', 'Set the meeting slots (and optionally max meetings per delegate) to work it out.'];
  else if (r.have == null) verdict = ['warn', `Need <b>${r.required}</b> delegate${r.required === 1 ? '' : 's'} minimum. No delegate count yet.`];
  else if (r.have >= r.required) verdict = ['good', `Covered: <b>${r.have}</b> delegates available vs <b>${r.required}</b> needed${r.have > r.required ? ` (${r.have - r.required} spare)` : ''}.`];
  else verdict = ['bad', `Short by <b>${r.required - r.have}</b>: need <b>${r.required}</b>, have <b>${r.have}</b>.`];
  const warns = [];
  if (r.slots > 0) d.sponsors.forEach(sp => { if (sp.meetings > r.slots) warns.push(`${esc(sp.company)} needs ${sp.meetings} meetings but there are only ${r.slots} slots, so it can't be fully met.`); });
  const un = d.sponsors.filter(sp => !sp.package_id).length; if (un) warns.push(`${un} sponsor${un === 1 ? ' has' : 's have'} no package (counted as 0 meetings).`);
  const groups = d.packages.map(p => ({ p, n: d.sponsors.filter(sp => sp.package_id === p.id).length })).filter(g => g.n);
  const logged = d.sponsors.filter(sp => sp.meetings_delivered != null);
  const prom = d.sponsors.reduce((n, sp) => n + sp.meetings, 0), dv = logged.reduce((n, sp) => n + sp.meetings_delivered, 0);
  const pct = (a, b) => (b > 0 ? Math.round(100 * a / b) + '%' : '—');
  const capLbl = r.maxPd > 0 && r.slots > 0 && r.maxPd < r.slots ? `${r.cap} (capped at ${r.maxPd} per delegate)` : (r.cap || '—');
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Community planner</h1></div><a class="btn" href="#/sponsors">Sponsors</a></header>
    <div class="banner">The minimum community delegates needed to cover every sponsor's 1-2-1 meeting package. Sponsors are the ones on the Sponsors page; delegates are live from HubSpot${d.liveError ? ` <span class="bad-t">(${esc(d.liveError)})</span>` : ''}.</div>
    <div class="kpis" style="margin-bottom:14px">
      <div class="card kpi"><div class="l">Minimum delegates</div><div class="n">${minTxt}</div></div>
      <div class="card kpi"><div class="l">Delegates available</div><div class="n">${r.have ?? '—'}</div><div class="s mut">${s.delegate_override != null ? 'override in use' : r.live != null ? 'live from HubSpot' : ''}</div></div>
      <div class="card kpi"><div class="l">Total meetings</div><div class="n">${r.demand}</div></div></div>
    <div class="banner ${verdict[0]}" style="font-weight:600">${verdict[1]}</div>${warns.map(w => `<p class="small bad-t" style="margin:4px 0">${w}</p>`).join('')}
    <div class="row2" style="margin-top:14px">
      <div style="flex:1 1 440px;min-width:0">
        <section class="card" style="margin-bottom:14px"><h2>Agenda</h2><p class="small mut" style="margin:4px 0 10px">Meeting slots are the 1-2-1 rounds in the agenda (each sponsor runs one meeting per slot). Max meetings per delegate caps how many one delegate is asked to do; the lower of the two is each delegate's capacity.</p>
          <div class="form"><div class="field"><label for="slots">Meeting slots</label><input class="input" type="number" min="0" id="slots" value="${s.slots ?? ''}"></div>
            <div class="field"><label for="mpd">Max meetings / delegate</label><input class="input" type="number" min="0" id="mpd" value="${s.max_per_delegate ?? ''}" placeholder="= slots"></div>
            <div class="field"><label for="ovr">Delegates available (override)</label><input class="input" type="number" min="0" id="ovr" value="${s.delegate_override ?? ''}" placeholder="${r.live != null ? r.live + ' live' : 'live from HubSpot'}"></div></div></section>
        <section class="card" style="margin-bottom:14px"><h2>Sponsorship packages</h2><p class="small mut" style="margin:4px 0 10px">Meetings each package promises at this event. Names match sponsor tiers, so sponsors pick up their package automatically.</p>
          <table class="t"><thead><tr><th>Package</th><th class="r" style="width:110px">Meetings</th><th style="width:44px"></th></tr></thead><tbody>
          ${d.packages.map(p => `<tr><td><input class="input" data-pk="${esc(p.id)}" data-k="name" value="${esc(p.name)}" aria-label="Package name"></td><td><input class="input r" type="number" min="0" data-pk="${esc(p.id)}" data-k="meetings" value="${p.meetings}" aria-label="Meetings for ${esc(p.name)}"></td>
            <td><button class="btn sm ghost" data-pkrm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button></td></tr>`).join('') || '<tr><td colspan="3" class="mut">No packages yet.</td></tr>'}</tbody></table>
          <form id="np" style="display:flex;gap:6px;margin-top:8px"><label class="sr" for="npn">Package name</label><input class="input" id="npn" placeholder="Package name" required><label class="sr" for="npm">Meetings</label><input class="input" type="number" min="0" id="npm" value="10" style="width:90px"><button class="btn sm">Add package</button></form></section>
        <section class="card"><h2>Sponsors <span class="chip">${d.sponsors.length}</span></h2><p class="small mut" style="margin:4px 0 10px">Choosing a package also sets a manual sponsor's tier. Add or remove sponsors on the Sponsors page.</p>
          <table class="t"><thead><tr><th>Sponsor</th><th style="width:190px">Package</th><th class="r" style="width:60px">Mtgs</th></tr></thead><tbody>
          ${d.sponsors.map(sp => `<tr><td>${esc(sp.company)}${sp.tier && !d.packages.some(p => p.id === sp.package_id && p.name.toLowerCase() === String(sp.tier).toLowerCase()) ? ` <span class="chip">${esc(sp.tier)}</span>` : ''}</td>
            <td><label class="sr" for="as-${sp.id}">Package for ${esc(sp.company)}</label><select class="input" id="as-${sp.id}" data-as="${sp.id}"><option value="">— none —</option>${d.packages.map(p => `<option value="${esc(p.id)}" ${p.id === sp.package_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
            <td class="r num">${sp.meetings}</td></tr>`).join('') || '<tr><td colspan="3" class="mut">No sponsors for this event yet.</td></tr>'}</tbody></table></section></div>
      <div style="flex:1 1 360px;min-width:0">
        <section class="card" style="margin-bottom:14px"><h2>How it's worked out</h2><p class="small mut" style="margin:4px 0 10px">The larger of (a) the biggest single package and (b) total meetings ÷ the meetings each delegate can do.</p>
          <table class="t"><tbody>${[['Total meetings promised', r.demand], ['Biggest single package', r.maxSingle], ['Agenda meeting slots', r.slots || '—'], ['Max meetings per delegate', r.maxPd > 0 ? r.maxPd : '= slots'],
            ['Meetings each delegate can do', capLbl], ['Meetings ÷ capacity (rounded up)', r.cap > 0 ? Math.ceil(r.demand / r.cap) : '—'], ['<b>Minimum delegates</b>', `<b>${minTxt}</b>`]].map(([a, b]) => `<tr><td>${a}</td><td class="r num">${b}</td></tr>`).join('')}</tbody></table>
          <h3 style="margin:14px 0 6px">By package</h3><table class="t"><thead><tr><th>Package</th><th class="r">Sponsors</th><th class="r">Each</th><th class="r">Total</th></tr></thead><tbody>
          ${groups.map(g => `<tr><td>${esc(g.p.name)}</td><td class="r num">${g.n}</td><td class="r num">${g.p.meetings}</td><td class="r num">${g.n * g.p.meetings}</td></tr>`).join('')}${un ? `<tr><td class="mut">No package</td><td class="r num">${un}</td><td class="r">0</td><td class="r">0</td></tr>` : ''}${!groups.length && !un ? '<tr><td colspan="4" class="mut">No sponsors yet.</td></tr>' : ''}</tbody></table></section>
        <section class="card"><h2>Meetings delivered</h2><p class="small mut" style="margin:4px 0 10px">Once the event has run, log how many meetings each sponsor actually got.</p>
          <p style="margin:0 0 8px">${logged.length ? `<b>${dv}</b> of <b>${prom}</b> promised meetings delivered (${pct(dv, prom)})${dv < prom ? ` · <span class="bad-t">${prom - dv} short</span>` : ''}` : '<span class="mut">Nothing logged yet.</span>'}</p>
          <table class="t"><thead><tr><th>Sponsor</th><th class="r">Promised</th><th class="r" style="width:100px">Delivered</th><th class="r">%</th></tr></thead><tbody>
          ${d.sponsors.map(sp => `<tr><td>${esc(sp.company)}</td><td class="r num">${sp.meetings}</td><td><input class="input r" type="number" min="0" data-dv="${sp.id}" value="${sp.meetings_delivered ?? ''}" placeholder="–" aria-label="Delivered for ${esc(sp.company)}"></td>
            <td class="r ${sp.meetings_delivered == null ? '' : sp.meetings_delivered >= sp.meetings ? 'good-t' : 'bad-t'}">${sp.meetings_delivered == null ? '—' : pct(sp.meetings_delivered, sp.meetings)}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">No sponsors yet.</td></tr>'}</tbody></table>
          <div class="actions"><button class="btn sm" id="dvx">Export CSV</button></div></section></div></div></div>`;
  const redraw = (nd) => { const y = window.scrollY; const a = document.activeElement?.id; render(el, ctx, nd); window.scrollTo(0, y); if (a && document.getElementById(a)) document.getElementById(a).focus(); };
  const T = {};
  const later = (k, fn) => { clearTimeout(T[k]); T[k] = setTimeout(async () => { try { const nd = await fn(); if (nd) redraw(nd); } catch (e) { toast(e.message, true); } }, 700); };
  [['slots', 'slots'], ['mpd', 'max_per_delegate'], ['ovr', 'delegate_override']].forEach(([id, k]) => { $('#' + id, el).oninput = (e) => later(k, () => ctx.api(`/api/events/${E}/community`, { method: 'PUT', body: { [k]: e.target.value } })); });
  $$('[data-pk]', el).forEach(i => i.onchange = () => later('pk' + i.dataset.pk, () => ctx.api(`/api/community/packages/${encodeURIComponent(i.dataset.pk)}`, { method: 'PATCH', body: { [i.dataset.k]: i.value } })));
  $$('[data-pkrm]', el).forEach(b => b.onclick = async () => { try { redraw(await ctx.api(`/api/community/packages/${encodeURIComponent(b.dataset.pkrm)}`, { method: 'DELETE' })); } catch (e) { toast(e.message, true); } });
  $('#np', el).onsubmit = async (e) => { e.preventDefault(); try { redraw(await ctx.api(`/api/events/${E}/community/packages`, { method: 'POST', body: { name: $('#npn', el).value, meetings: $('#npm', el).value } })); } catch (err) { toast(err.message, true); } };
  $$('[data-as]', el).forEach(sel => sel.onchange = async () => { try { redraw(await ctx.api(`/api/events/${E}/community/assign/${sel.dataset.as}`, { method: 'PUT', body: { package_id: sel.value } })); } catch (e) { toast(e.message, true); } });
  $$('[data-dv]', el).forEach(i => i.oninput = () => later('dv' + i.dataset.dv, async () => { await ctx.api(`/api/sponsors/${i.dataset.dv}/delivered`, { method: 'PUT', body: { delivered: i.value } }); return ctx.api(`/api/events/${E}/community`); }));
  $('#dvx', el).onclick = () => exportCSV(`${slug(ev)}-sponsor-meetings.csv`, d.sponsors, [{ label: 'Sponsor', key: 'company' }, { label: 'Package', get: sp => (d.packages.find(p => p.id === sp.package_id) || {}).name || '' },
    { label: 'Meetings promised', key: 'meetings' }, { label: 'Meetings delivered', get: sp => sp.meetings_delivered ?? '' }, { label: '% delivered', get: sp => sp.meetings_delivered == null ? '' : pct(sp.meetings_delivered, sp.meetings) },
    { label: 'Shortfall', get: sp => sp.meetings_delivered == null ? '' : Math.max(0, sp.meetings - sp.meetings_delivered) }]);
}
