// Sponsors (from the Ledger, plus manual) and the people each one is sending.
import { esc, $, $$, fmtDateTime, toast } from '../util.js';
import { dash, slug, roomBar, roomBox, wireRooms, cell, wireCells, wireRemove, exportCSV, idChip, STD_COLS } from './_people.js';

export async function render(el, ctx) {
  const ev = ctx.ev, E = encodeURIComponent(ev.id);
  const d = await ctx.api(`/api/events/${E}/sponsors`);
  const L = d.ledger, last = L.lastSync;
  const reps = d.sponsors.reduce((n, s) => n + s.reps.length, 0);
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Sponsors</h1></div>
      <div class="pills" style="gap:8px"><span class="chip brand">${d.sponsors.length} sponsor${d.sponsors.length === 1 ? '' : 's'} · ${reps} attending</span>
        <a class="btn" href="#/community">Community planner</a>${L.configured ? `<button class="btn pri" id="sync">Sync from the Ledger</button>` : ''}</div></header>
    <div class="banner ${L.configured ? (last && last.ok === false ? 'bad' : '') : 'warn'}">${!L.configured ? 'The Ledger isn\'t connected yet, so only sponsors added here show. Once it is, sponsors sold on this event appear automatically.'
      : last ? (last.ok ? `Last synced from the Ledger ${fmtDateTime(last.finished_at)} · ${last.counts.sponsors ?? 0} sponsors` : `Last Ledger sync failed: ${esc(last.error || '')}`) : 'Not synced from the Ledger yet.'}</div>
    <details class="card" style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:700">Add a sponsor</summary>
      <form id="f" class="form" style="margin-top:10px"><div class="field"><label for="c">Company</label><input class="input" id="c" required></div>
        <div class="field"><label for="t">Tier / package</label><input class="input" id="t" list="tiers"><datalist id="tiers"><option>Headline</option><option>Engagement</option><option>Content</option></datalist></div>
        <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">Add sponsor</button></div></form></details>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><div class="grow"></div><button class="btn sm" id="exp">Export sponsor attendees</button></div>
    ${roomBar(d.rooms)}
    ${d.sponsors.length ? d.sponsors.map(s => `<section class="card" style="margin-bottom:12px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:8px">
        <h2 style="margin:0;flex:1 1 180px;min-width:0">${esc(s.company)} ${s.ledger_ref ? '<span class="chip good">Ledger</span>' : ''}</h2>
        ${s.ledger_ref ? (s.tier ? `<span class="chip brand">${esc(s.tier)}</span>` : '') : `<label class="sr" for="tier-${s.id}">Tier</label><input class="input" id="tier-${s.id}" data-tier="${s.id}" value="${esc(s.tier || '')}" list="tiers" placeholder="Tier" style="max-width:160px">`}
        ${s.ledger_ref ? '' : `<button class="btn sm danger" data-rm="${s.id}" data-name="${esc(s.company)}">Remove</button>`}</div>
      ${s.contact_email ? `<p class="small mut" style="margin:0 0 8px">Contact: ${esc(s.contact_name || '')} <a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a></p>` : ''}
      ${s.reps.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Name</th><th>Scan ID</th><th>Job title</th><th>Email</th><th>Dietary</th><th>Accessibility</th><th>Notes</th><th class="c">Room</th><th></th></tr></thead><tbody>
        ${s.reps.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${idChip(r)}</td><td>${cell(r, 'jobtitle')}</td><td>${cell(r, 'email')}</td><td>${cell(r, 'dietary')}</td><td>${cell(r, 'accessibility')}</td><td>${cell(r, 'note', 'Add note…')}</td>
          <td class="c">${roomBox(r)}</td><td class="r"><button class="btn sm ghost" data-rmp="${r.id}" data-name="${esc(r.name)}" aria-label="Remove ${esc(r.name)}">✕</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="small mut" style="margin:0 0 6px">No attendees logged yet.</p>`}
      <form class="addrep" data-sp="${s.id}" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
        ${[['name', 'Name', 'required'], ['jobtitle', 'Job title'], ['email', 'Email', 'type="email"'], ['dietary', 'Dietary'], ['accessibility', 'Accessibility']].map(([k, l, a = '']) => `<label class="sr" for="${s.id}-${k}">${l}</label><input class="input" id="${s.id}-${k}" name="${k}" placeholder="${l}" ${a} style="flex:1 1 130px;width:auto">`).join('')}
        <button class="btn sm">Add attendee</button></form></section>`).join('')
      : '<div class="card empty"><b>No sponsors yet</b>Add your event sponsors above, then log the people each is sending.</div>'}</div>`;
  const sy = $('#sync', el); if (sy) sy.onclick = async () => { sy.disabled = true; try { const r = await ctx.api(`/api/events/${E}/sponsors/sync`, { method: 'POST' }); toast(`${r.sponsors} from the Ledger${r.removed ? `, ${r.removed} no longer there` : ''}`); render(el, ctx); } catch (e) { toast(e.message, true); sy.disabled = false; } };
  const f = $('#f', el);
  f.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${E}/sponsors`, { method: 'POST', body: { company: f.c.value, tier: f.t.value } }); render(el, ctx); } catch (err) { toast(err.message, true); } };
  $$('[data-rm]', el).forEach(b => b.onclick = async () => { if (!confirm(`Remove sponsor ${b.dataset.name}?`)) return; try { await ctx.api(`/api/sponsors/${b.dataset.rm}`, { method: 'DELETE' }); render(el, ctx); } catch (e) { toast(e.message, true); } });
  const tt = {}; $$('[data-tier]', el).forEach(i => i.oninput = () => { clearTimeout(tt[i.dataset.tier]); tt[i.dataset.tier] = setTimeout(() => ctx.api(`/api/sponsors/${i.dataset.tier}`, { method: 'PATCH', body: { tier: i.value } }).catch(e => toast(e.message, true)), 600); });
  $$('form.addrep', el).forEach(fr => fr.onsubmit = async (e) => {
    e.preventDefault(); const b = fr.querySelector('button'); b.disabled = true; b.textContent = 'Checking HubSpot…';
    const row = Object.fromEntries([...fr.querySelectorAll('input[name]')].map(i => [i.name, i.value.trim()]));
    try { await ctx.api(`/api/events/${E}/people/sponsor`, { method: 'POST', body: { rows: [row], sponsor_id: fr.dataset.sp } }); render(el, ctx); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Add attendee'; }
  });
  $('#exp', el).onclick = () => exportCSV(`${slug(ev)}-sponsor-attendees.csv`, d.sponsors.flatMap(s => s.reps.map(r => ({ ...r, sponsor: s.company, tier: s.tier || '' }))),
    [{ label: 'Type', get: () => 'Sponsor' }, { label: 'Sponsor', key: 'sponsor' }, { label: 'Tier', key: 'tier' }, ...STD_COLS(ev.id).filter(c => c.label !== 'Company')]);
  wireRooms(el, ctx); wireCells(el, ctx); wireRemove(el, ctx, () => render(el, ctx));
}
