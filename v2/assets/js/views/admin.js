import { esc, $, $$, fmtDate, fmtDateTime, toast } from '../util.js';
import { loadEvents } from '../app.js';

let showAll = false, q = '';
export async function render(el, ctx) {
  const d = await ctx.api('/api/events?all=1');
  const today = new Date().toISOString().slice(0, 10);
  const list = d.events.filter(e => (showAll || e.ops_enabled || (e.ends_on || e.starts_on) >= today) && (!q || (e.name + ' ' + e.id).toLowerCase().includes(q)));
  const s = d.calendarSync;
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">Settings</div><h1>Admin</h1></div><button class="btn pri" id="sync">Sync from the calendar now</button></header>
    <div class="banner ${s && s.ok === false ? 'bad' : ''}">${s ? (s.ok ? `Events last synced from the calendar ${fmtDateTime(s.finished_at)}. It also runs every 30 minutes.` : `The last calendar sync failed: ${esc(s.error || '')}`) : 'The calendar has not been synced yet — press "Sync from the calendar now".'}</div>
    <section class="card"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px"><h2 class="grow">Events</h2>
      <label class="sr" for="aq">Search</label><input class="input" id="aq" placeholder="Search" value="${esc(q)}" style="max-width:240px">
      <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="all" ${showAll ? 'checked' : ''}> Show past events</label></div>
      <p class="small mut" style="margin:0 0 10px">Names, dates and venues come from the calendar. Switch an event on to show it in Ops, and set its type — shows get the rota and check-in; summits, awards and lunches get the table planner.</p>
      <div class="scroll-x"><table class="t"><thead><tr><th>In Ops</th><th>Event</th><th>Date</th><th>Type</th><th>Joining Instructions value</th><th>Reg code</th><th></th></tr></thead><tbody>
      ${list.map(e => `<tr data-id="${esc(e.id)}"><td><input type="checkbox" data-k="ops_enabled" ${e.ops_enabled ? 'checked' : ''} aria-label="Show ${esc(e.short_name || e.name)} in Ops"></td>
        <td><b>${esc(e.short_name || e.name)}</b>${e.cancelled ? ' <span class="chip bad">cancelled</span>' : ''}<div class="small mut">${esc(e.name)} · ${esc(e.id)}</div></td><td class="small">${fmtDate(e.starts_on)}</td>
        <td><select class="input" data-k="kind" style="min-width:110px" aria-label="Type">${['show', 'summit', 'awards', 'lunch', 'other'].map(k => `<option${k === e.kind ? ' selected' : ''}>${k}</option>`).join('')}</select></td>
        <td><input class="input" data-k="ops_ji" value="${esc(e.ops_ji || '')}" placeholder="summits only" aria-label="Joining Instructions"></td>
        <td><select class="input" data-k="ops_reg_code" aria-label="Registration code" style="min-width:80px">${['', 'CFX', 'EPS', 'PAS'].map(c => `<option value="${c}" ${(e.ops_reg_code || '') === c ? 'selected' : ''}>${c || '—'}</option>`).join('')}</select></td><td><button class="btn sm" data-save>Save</button></td></tr>`).join('')}</tbody></table></div></section></div>`;
  $('#sync').onclick = async () => { $('#sync').disabled = true; try { const r = await ctx.api('/api/sync/calendar', { method: 'POST' }); toast(`${r.events} events synced`); render(el, ctx); } catch (e) { toast(e.message, true); $('#sync').disabled = false; } };
  $('#all').onchange = (e) => { showAll = e.target.checked; render(el, ctx); };
  $('#aq').oninput = (e) => { q = e.target.value.toLowerCase(); $$('tr[data-id]', el).forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  $$('[data-save]', el).forEach(b => b.onclick = async () => {
    const r = b.closest('tr'), v = (k) => r.querySelector(`[data-k="${k}"]`);
    try { await ctx.api(`/api/events/${encodeURIComponent(r.dataset.id)}`, { method: 'POST', body: { ops_enabled: v('ops_enabled').checked, kind: v('kind').value, ops_ji: v('ops_ji').value, ops_reg_code: v('ops_reg_code').value } }); await loadEvents(); toast('Saved'); ctx.refresh(); } catch (e) { toast(e.message, true); }
  });
}
