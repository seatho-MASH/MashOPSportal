import { esc, $, $$, fmtDate, fmtDateTime, toast } from '../util.js';
import { loadEvents } from '../app.js';

let showAll = false, q = '';
export async function render(el, ctx) {
  const [d, ji, imp, ros] = await Promise.all([ctx.api('/api/events?all=1'), ctx.api('/api/admin/ji-options').catch(e => ({ options: null, error: e.message })),
    ctx.api('/api/admin/import').catch(() => null), ctx.api('/api/admin/roster').catch(() => ({ emails: [] }))]);
  const today = new Date().toISOString().slice(0, 10);
  const list = d.events.filter(e => (showAll || e.ops_enabled || (e.ends_on || e.starts_on) >= today) && (!q || (e.name + ' ' + e.id).toLowerCase().includes(q)));
  const s = d.calendarSync;
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">Settings</div><h1>Admin</h1></div><button class="btn pri" id="sync">Sync from the calendar now</button></header>
    <div class="banner ${s && s.ok === false ? 'bad' : ''}">${s ? (s.ok ? `Events last synced from the calendar ${fmtDateTime(s.finished_at)}. It also runs every 30 minutes.` : `The last calendar sync failed: ${esc(s.error || '')}`) : 'The calendar has not been synced yet — press "Sync from the calendar now".'}</div>
    <section class="card" style="margin-bottom:14px"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><div class="grow"><h2>Import from the current portal</h2>
      <p class="small mut" style="margin:4px 0 0">Copies sponsors and their attendees, speakers, walk-ins, staff, notes, rooms, on-site details, the Community planner and the history across, and switches on every event that has a Joining Instructions value. Safe to run again: until you switch over, the current portal is the master and each run refreshes v2's copy.</p>
      <p class="small" style="margin:6px 0 0">${imp ? `Last run ${fmtDateTime(imp.at)} by ${esc(imp.by)}: ${imp.report.events} events, ${imp.report.sponsors} sponsors, ${imp.report.reps} sponsor attendees, ${imp.report.speakers} speakers, ${imp.report.walkins} walk-ins, ${imp.report.staff} staff, ${imp.report.history} history entries${imp.report.skipped.length ? `. <span class="warn-t">Not on the calendar, so skipped: ${imp.report.skipped.map(esc).join(', ')}</span>` : ''}.` : '<span class="mut">Not run yet.</span>'}</p></div>
      <button class="btn pri" id="import">Import now</button></div></section>
    <section class="card" style="margin-bottom:14px"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px"><h2 class="grow">Events</h2>
      <label class="sr" for="aq">Search</label><input class="input" id="aq" placeholder="Search" value="${esc(q)}" style="max-width:240px">
      <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="all" ${showAll ? 'checked' : ''}> Show past events</label></div>
      <p class="small mut" style="margin:0 0 10px">Names, dates and venues come from the calendar. Switch an event on to show it in Ops, and set its type — shows get the rota and check-in; summits, awards and lunches get the table planner.</p>
      <div class="scroll-x"><table class="t"><thead><tr><th>In Ops</th><th>Event</th><th>Date</th><th>Type</th><th>Joining Instructions value</th><th>Reg code</th><th></th></tr></thead><tbody>
      ${list.map(e => `<tr data-id="${esc(e.id)}"><td><input type="checkbox" data-k="ops_enabled" ${e.ops_enabled ? 'checked' : ''} aria-label="Show ${esc(e.short_name || e.name)} in Ops"></td>
        <td><b>${esc(e.short_name || e.name)}</b>${e.cancelled ? ' <span class="chip bad">cancelled</span>' : ''}<div class="small mut">${esc(e.name)} · ${esc(e.id)}</div></td><td class="small">${fmtDate(e.starts_on)}</td>
        <td><select class="input" data-k="kind" style="min-width:110px" aria-label="Type">${['show', 'summit', 'awards', 'lunch', 'other'].map(k => `<option${k === e.kind ? ' selected' : ''}>${k}</option>`).join('')}</select></td>
        <td><div style="display:flex;gap:6px;align-items:center"><input class="input" data-k="ops_ji" list="jiopts" value="${esc(e.ops_ji || '')}" placeholder="summits only" aria-label="Joining Instructions" style="min-width:220px"><button class="btn sm" data-check>Check</button></div><div class="small mut" data-cnt></div></td>
        <td><select class="input" data-k="ops_reg_code" aria-label="Registration code" style="min-width:80px">${['', 'CFX', 'EPS', 'PAS'].map(c => `<option value="${c}" ${(e.ops_reg_code || '') === c ? 'selected' : ''}>${c || '—'}</option>`).join('')}</select></td><td><button class="btn sm" data-save>Save</button></td></tr>`).join('')}</tbody></table></div>
      <datalist id="jiopts">${(ji.options || []).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</datalist>
      ${ji.error ? `<p class="small warn-t" style="margin:8px 0 0">Couldn't load the Joining Instructions values from HubSpot, so type them exactly: ${esc(ji.error)}${/403/.test(ji.error) ? ' (the HubSpot token needs the crm.schemas.contacts.read scope)' : ''}</p>` : ''}</section>
    <section class="card"><h2>Staff roster</h2><p class="small mut" style="margin:4px 0 10px">The Mash staff who can be ticked onto an event on the Staff page. Their details come from HubSpot.</p>
      <form id="ra" style="display:flex;gap:6px;margin-bottom:10px"><label class="sr" for="re">Email</label><input class="input" id="re" type="email" placeholder="name@mashmedia.net" required style="max-width:300px"><button class="btn sm pri">Add</button></form>
      <div class="pills">${ros.emails.map(r => `<span class="chip">${esc(r.email)} <button class="btn sm ghost" data-rr="${esc(r.email)}" aria-label="Remove ${esc(r.email)}" style="padding:0 4px;min-height:0">✕</button></span>`).join('')}</div></section></div>`;
  $('#sync').onclick = async () => { $('#sync').disabled = true; try { const r = await ctx.api('/api/sync/calendar', { method: 'POST' }); toast(`${r.events} events synced`); render(el, ctx); } catch (e) { toast(e.message, true); $('#sync').disabled = false; } };
  $('#import').onclick = async () => { const b = $('#import'); b.disabled = true; b.textContent = 'Importing…';
    try { const r = await ctx.api('/api/admin/import', { method: 'POST' }); toast(`Imported ${r.events} events`); await loadEvents(); render(el, ctx); } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Import now'; } };
  $$('[data-check]', el).forEach(b => b.onclick = async () => { const r = b.closest('tr'), v = r.querySelector('[data-k="ops_ji"]').value.trim(), out = r.querySelector('[data-cnt]');
    if (!v) { out.textContent = 'Enter a value first'; return; } out.textContent = 'Checking…';
    try { out.textContent = `${(await ctx.api('/api/admin/ji-check', { method: 'POST', body: { ji: v } })).total} contacts match`; } catch (e) { out.textContent = e.message; } });
  $('#ra').onsubmit = async (e) => { e.preventDefault(); try { await ctx.api('/api/admin/roster', { method: 'POST', body: { email: $('#re').value } }); render(el, ctx); } catch (err) { toast(err.message, true); } };
  $$('[data-rr]', el).forEach(b => b.onclick = async () => { if (!confirm(`Take ${b.dataset.rr} off the staff roster?`)) return; try { await ctx.api('/api/admin/roster/' + encodeURIComponent(b.dataset.rr), { method: 'DELETE' }); render(el, ctx); } catch (e) { toast(e.message, true); } });
  $('#all').onchange = (e) => { showAll = e.target.checked; render(el, ctx); };
  $('#aq').oninput = (e) => { q = e.target.value.toLowerCase(); $$('tr[data-id]', el).forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  $$('[data-save]', el).forEach(b => b.onclick = async () => {
    const r = b.closest('tr'), v = (k) => r.querySelector(`[data-k="${k}"]`);
    try { await ctx.api(`/api/events/${encodeURIComponent(r.dataset.id)}`, { method: 'POST', body: { ops_enabled: v('ops_enabled').checked, kind: v('kind').value, ops_ji: v('ops_ji').value, ops_reg_code: v('ops_reg_code').value } }); await loadEvents(); toast('Saved'); ctx.refresh(); } catch (e) { toast(e.message, true); }
  });
}
