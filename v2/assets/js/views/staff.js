// Staff attending: tick Mash staff off the roster, add external crew, on-site
// details, and send the briefing email with a calendar invite.
import { esc, $, $$, toast } from '../util.js';
import { dash, slug, roomBar, roomBox, wireRooms, cell, wireCells, wireRemove, wireSearch, sortRows, exportCSV, idChip, addForm, formData, STD_COLS } from './_people.js';

export async function render(el, ctx) {
  const ev = ctx.ev, E = encodeURIComponent(ev.id);
  const [d, os, ro] = await Promise.all([ctx.api(`/api/events/${E}/people/staff`), ctx.api(`/api/events/${E}/onsite`),
    ctx.api('/api/staff-roster').catch(e => ({ error: e.message, staff: [] }))]);
  const att = sortRows(d.rows, 'name'), on = new Set(att.filter(r => r.rosterId).map(r => r.rosterId));
  const o = os.onsite;
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Staff</h1></div><div class="pills"><span class="chip brand">${att.length} attending</span></div></header>
    <div class="banner">Tick the Mash Media staff working this event. They show on All attendees tagged Staff, with their scan IDs. External crew who aren't in HubSpot can be added below.</div>
    <section class="card" style="margin-bottom:14px"><h2 style="margin-bottom:4px">On-site details</h2>
      <p class="small mut" style="margin:0 0 10px">Emailed to staff with a calendar invite. Venue and build/breakdown days come from the calendar: ${esc(os.venue || 'no venue set')}${os.build_days ? ` · ${os.build_days} build day${os.build_days === 1 ? '' : 's'}` : ''}${os.breakdown_days ? ` · ${os.breakdown_days} breakdown day${os.breakdown_days === 1 ? '' : 's'}` : ''}.</p>
      <form class="form" id="os">
        <div class="field"><label for="os-d">Dress code</label><input class="input" id="os-d" value="${esc(o.dress_code || '')}" placeholder="e.g. Branded polo"></div>
        <div class="field"><label for="os-a">Arrival on site</label><input class="input" id="os-a" value="${esc(o.arrival || '')}" placeholder="e.g. 07:30"></div>
        <div class="field"><label for="os-f">Finish</label><input class="input" id="os-f" value="${esc(o.finish || '')}" placeholder="e.g. 18:00"></div>
        <div class="field"><label for="os-s">Nearest station</label><input class="input" id="os-s" value="${esc(o.station || '')}" placeholder="Find it or type it"></div>
        <div style="grid-column:1/-1" id="stations" class="pills"></div>
        <div class="actions" style="grid-column:1/-1;margin-top:0"><button type="button" class="btn" id="find">Find nearest station</button><button class="btn">Save details</button>
          <button type="button" class="btn pri" id="brief">Send briefing to ${att.filter(r => r.email).length} staff</button></div></form></section>
    ${addForm('ext', 'Add external staff or crew (not in HubSpot)', '', [['name', 'Full name', 'required'], ['jobtitle', 'Role / job title'], ['email', 'Email', 'type="email"'], ['company', 'Company'], ['dietary', 'Dietary requirements'], ['accessibility', 'Accessibility requirements']], 'Add external')}
    ${roomBar(d.rooms)}
    <section class="card" style="margin-bottom:14px"><div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><h2 class="grow">Attending this event</h2><button class="btn sm" id="exp">Export attending</button></div>
      ${att.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Name</th><th>Scan ID</th><th>Job title</th><th>Company</th><th>Email</th><th>Dietary</th><th>Accessibility</th><th>Role</th><th class="c" title="Needed for build days">Build</th><th class="c" title="Needed for breakdown days">Breakdown</th><th class="c">Room</th><th></th></tr></thead><tbody>
      ${att.map(r => `<tr><td><b>${esc(r.name)}</b>${r.external ? ' <span class="chip">external</span>' : ''}</td><td>${idChip(r)}</td><td>${cell(r, 'jobtitle')}</td><td>${cell(r, 'company')}</td>
        <td class="small">${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : dash}</td><td>${cell(r, 'dietary')}</td><td>${cell(r, 'accessibility')}</td><td>${cell(r, 'role', 'e.g. Registration')}</td>
        <td class="c"><input type="checkbox" data-flag="build" data-pid="${r.id}" ${r.build ? 'checked' : ''} aria-label="${esc(r.name)} on build"></td>
        <td class="c"><input type="checkbox" data-flag="breakdown" data-pid="${r.id}" ${r.breakdown ? 'checked' : ''} aria-label="${esc(r.name)} on breakdown"></td>
        <td class="c">${roomBox(r)}</td><td class="r"><button class="btn sm ghost" data-rmp="${r.id}" data-name="${esc(r.name)}" aria-label="Remove ${esc(r.name)}">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nobody ticked yet. Use the list below.</div>'}</section>
    <section class="card"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px"><h2 class="grow">All staff: tick to add</h2>
      <label class="sr" for="q">Search</label><input class="input" id="q" placeholder="Search name, role, email" style="max-width:260px"><span class="small mut" id="cnt"></span><button class="btn sm" id="rel">Reload</button></div>
      ${ro.error ? `<div class="banner bad">Couldn't load the staff roster: ${esc(ro.error)}</div>` : ''}
      ${ro.missing && ro.missing.length ? `<details class="small mut" style="margin-bottom:8px"><summary>${ro.missing.length} roster address${ro.missing.length === 1 ? '' : 'es'} not found in HubSpot</summary><p>${ro.missing.map(esc).join(', ')}</p></details>` : ''}
      <div class="scroll-x"><table class="t"><thead><tr><th style="width:60px">Add</th><th>Name</th><th>Scan ID</th><th>Job title</th><th>Email</th></tr></thead><tbody>
      ${ro.staff.map(p => `<tr data-s="${esc((p.name + ' ' + p.email + ' ' + p.jobtitle).toLowerCase())}"><td><input type="checkbox" data-ros="${esc(p.id)}" ${on.has(p.id) ? 'checked' : ''} aria-label="${esc(p.name)} attending"></td>
        <td><b>${esc(p.name)}</b></td><td class="num small">${esc(p.scanId)}</td><td>${esc(p.jobtitle) || dash}</td><td class="small">${esc(p.email)}</td></tr>`).join('')}</tbody></table></div></section></div>`;
  // on-site
  const fo = $('#os', el);
  const saveOs = () => ctx.api(`/api/events/${E}/onsite`, { method: 'PUT', body: { dress_code: $('#os-d', el).value, arrival: $('#os-a', el).value, finish: $('#os-f', el).value, station: $('#os-s', el).value } });
  fo.onsubmit = async (e) => { e.preventDefault(); try { await saveOs(); toast('Saved'); } catch (err) { toast(err.message, true); } };
  $('#find', el).onclick = async () => {
    const b = $('#find', el); b.disabled = true; b.textContent = 'Finding…';
    try { const r = await ctx.api(`/api/events/${E}/nearest-station`);
      $('#stations', el).innerHTML = r.options.length ? '<span class="small mut">Nearest, tap to use:</span>' + r.options.map((x, i) => `<button type="button" class="btn sm ${i === 0 ? 'pri' : ''}" data-st="${esc(x.name + (x.label ? ' (' + x.label + ')' : ''))}">${esc(x.name)} · ${x.dist} km</button>`).join('') : `<span class="small mut">${esc(r.note || 'No station found, type it in')}</span>`;
      if (r.options[0] && !$('#os-s', el).value) $('#os-s', el).value = r.options[0].name + (r.options[0].label ? ' (' + r.options[0].label + ')' : '');
      $$('[data-st]', el).forEach(c => c.onclick = () => { $('#os-s', el).value = c.dataset.st; $$('[data-st]', el).forEach(x => x.classList.remove('pri')); c.classList.add('pri'); });
    } catch (e) { toast(e.message, true); } finally { b.disabled = false; b.textContent = 'Find nearest station'; }
  };
  $('#brief', el).onclick = async () => {
    const n = att.filter(r => r.email).length; if (!n) return toast('No attending staff with an email address', true);
    if (!confirm(`Send the briefing email and calendar invite to ${n} staff?`)) return;
    try { await saveOs(); const r = await ctx.api(`/api/events/${E}/briefing`, { method: 'POST', body: {} }); toast(`Briefing queued for ${r.queued}. It goes out within a minute.`); } catch (e) { toast(e.message, true); }
  };
  // external
  const fx = $('#ext', el);
  fx.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${E}/people/staff`, { method: 'POST', body: { rows: [{ ...formData(fx), external: true }] } }); toast('Added'); render(el, ctx); } catch (err) { toast(err.message, true); } };
  // roster ticks
  $$('[data-ros]', el).forEach(cb => cb.onchange = async () => {
    try { await ctx.api(`/api/events/${E}/staff/${encodeURIComponent(cb.dataset.ros)}`, { method: 'PUT', body: { on: cb.checked } }); render(el, ctx); } catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
  });
  $('#rel', el).onclick = async () => { await ctx.api('/api/staff-roster?fresh=1'); render(el, ctx); };
  $('#exp', el).onclick = () => exportCSV(`${slug(ev)}-staff.csv`, att, [{ label: 'Type', get: () => 'Staff' }, ...STD_COLS(ev.id).filter(c => c.label !== 'Added' && c.label !== 'Notes'),
    { label: 'Role', key: 'role' }, { label: 'Build', get: r => r.build ? 'Yes' : '' }, { label: 'Breakdown', get: r => r.breakdown ? 'Yes' : '' }]);
  wireSearch(el, $('#q', el), () => $$('tr[data-s]', el), $('#cnt', el), ro.staff.length);
  wireRooms(el, ctx); wireCells(el, ctx); wireRemove(el, ctx, () => render(el, ctx));
}
