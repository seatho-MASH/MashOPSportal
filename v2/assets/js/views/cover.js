// Community cover across every event with sponsor meetings.
import { esc, $, $$, fmtDate } from '../util.js';
import { loadEvents } from '../app.js';

let past = false;
export async function render(el, ctx) {
  const d = await ctx.api(`/api/community-cover${past ? '?past=1' : ''}`);
  const today = new Date().toISOString().slice(0, 10), days = (x) => Math.round((Date.parse(x + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);
  const up = d.events.filter(e => e.demand && e.starts_on >= today);
  const short = up.filter(e => e.count != null && e.required != null && e.count < e.required);
  const gap = short.reduce((n, e) => n + (e.required - e.count), 0);
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">Programmes</div><h1>Community cover</h1></div></header>
    <div class="kpis" style="margin-bottom:14px">
      <div class="card kpi"><div class="l">Upcoming events with sponsor meetings</div><div class="n">${up.length}</div></div>
      <div class="card kpi"><div class="l">Short of delegates</div><div class="n ${short.length ? 'bad-t' : 'good-t'}">${short.length}</div></div>
      <div class="card kpi"><div class="l">Delegates still needed in total</div><div class="n">${gap}</div></div></div>
    <section class="card"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px"><p class="small mut grow" style="margin:0">Delegates are live from HubSpot, or the override set in the Community planner. Open an event to plan it.</p>
      <label class="small"><input type="checkbox" id="past" ${past ? 'checked' : ''}> Show past events (with meetings delivered)</label></div>
      <div class="scroll-x"><table class="t"><thead><tr><th>Event</th><th>Date</th><th class="r">Days</th><th class="r">Sponsors</th><th class="r">Meetings</th><th class="r">Needed</th><th class="r">Available</th><th>Cover</th><th class="r">Delivered</th></tr></thead><tbody>
      ${d.events.map(e => { const n = days(e.starts_on);
        let cv = '<span class="mut">Not planned</span>';
        if (e.demand) cv = e.required == null ? '<span class="warn-t">Set slots</span>' : e.count == null ? '<span class="mut">No count</span>' : e.count >= e.required ? `<span class="good-t">Covered</span>${e.count > e.required ? ` <span class="mut">+${e.count - e.required}</span>` : ''}` : `<span class="bad-t">Short by ${e.required - e.count}</span>`;
        return `<tr><td><a href="#" data-open="${esc(e.id)}"><b>${esc(e.short_name || e.name)}</b></a> <span class="chip">${esc(e.portfolio || '')}</span></td><td class="small">${fmtDate(e.starts_on)}</td><td class="r num">${n === 0 ? 'today' : n}</td>
          <td class="r num">${e.sponsors}</td><td class="r num">${e.demand}</td><td class="r num">${e.required ?? '—'}</td><td class="r num">${e.count ?? '—'}</td><td>${cv}</td>
          <td class="r num">${e.delivered != null && e.demand ? `${e.delivered} / ${e.demand} <span class="mut">(${Math.round(100 * e.delivered / e.demand)}%)</span>` : '—'}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">No events with sponsors yet.</td></tr>'}</tbody></table></div></section></div>`;
  $('#past', el).onchange = (e) => { past = e.target.checked; render(el, ctx); };
  $$('[data-open]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); ctx.S.eventId = a.dataset.open; try { localStorage.setItem('ops-event', a.dataset.open); } catch {} ctx.go('community'); });
}
