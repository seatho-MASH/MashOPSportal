import { esc, fmtDate, fmtTime, fmtDay } from '../util.js';

export async function render(el, ctx) {
  const ev = ctx.ev;
  const d = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/home`);
  const n = d.numbers;
  const kpi = (label, val, sub, cls = 'mut') => `<div class="card kpi"><div class="l">${label}</div><div class="n">${val}</div><div class="s ${cls}">${sub}</div></div>`;
  const att = d.attention.map(a => {
    const tag = { gap: ['bad', 'Gap'], moved: ['warn', 'Changed'], send: ['brand', 'To send'], ledger: ['', 'Sponsors'] }[a.type] || ['', ''];
    const detail = a.type === 'gap' ? `${fmtDay(a.day)} · ${fmtTime(a.from)}–${fmtTime(a.to)} · ${a.free} crew free then` : esc(a.detail || '');
    const btn = a.type === 'gap' ? `<a class="btn sm" href="#/rota?day=${a.day}">Fix in rota</a>` : a.type === 'moved' || a.type === 'send' ? `<a class="btn sm" href="#/rota?tab=schedules">Open schedules</a>` : `<a class="btn sm" href="#/sponsors">Open sponsors</a>`;
    return `<div class="item"><span class="chip ${tag[0]}" style="min-width:72px;justify-content:center">${tag[1]}</span><div class="grow"><div style="font-weight:700">${esc(a.title)}</div><div class="small mut">${detail}</div></div>${btn}</div>`;
  }).join('');
  const isShow = ev.kind === 'show';
  el.innerHTML = `<div class="wrap">
    <header class="pagehead">
      <div><div class="eyebrow">${esc(ev.portfolio || ev.kind)}</div><h1>${esc(ev.short_name || ev.name)}</h1>
        <div class="sub">${esc(ev.name)} · ${fmtDate(ev.starts_on)}${ev.ends_on && ev.ends_on !== ev.starts_on ? ' – ' + fmtDate(ev.ends_on) : ''} · ${esc(ev.venue || 'Venue not set on the calendar')}${d.daysToGo != null && d.daysToGo >= 0 ? ` · ${d.daysToGo} days to go` : ''}</div></div>
      <div class="pills" style="gap:8px">
        <span class="chip ${n.sponsors.ledgerConnected ? 'good' : ''}">${n.sponsors.ledgerConnected ? 'Sponsors from the Ledger' : 'Ledger not connected yet'}</span>
        ${ev.cancelled ? '<span class="chip bad">Cancelled on the calendar</span>' : ''}${d.event.provisional ? '<span class="chip warn">Date provisional</span>' : ''}
      </div>
    </header>
    <section class="grid-kpi" aria-label="Key numbers">
      ${kpi('Sponsors', n.sponsors.total, n.sponsors.manual ? `${n.sponsors.total - n.sponsors.manual} from Ledger · ${n.sponsors.manual} manual` : 'From the Ledger')}
      ${isShow ? kpi('Crew', n.crew.total, `${n.crew.staff} staff · ${n.crew.volunteers} volunteers`) : kpi('Guests', n.guests.total, `${n.guests.seated} seated · ${n.guests.tables} tables`)}
      ${isShow ? kpi('Theatres', n.theatres, n.gaps ? `${n.gaps} gap${n.gaps === 1 ? '' : 's'} in cover` : (n.theatres ? 'Fully covered' : 'None set up yet'), n.gaps ? 'bad-t' : 'good-t') : ''}
      ${kpi('Kit out', n.kitOut, n.kitOut ? 'Not yet returned' : 'Everything is back')}
    </section>
    <div class="row2">
      <section class="card" style="flex:3 1 520px;min-width:0" aria-labelledby="att"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><h2 id="att">Needs attention</h2><span class="small mut">${d.attention.length} item${d.attention.length === 1 ? '' : 's'}</span></div>
        <div class="list">${att || '<div class="empty"><b>Nothing needs you right now</b>Gaps, changed schedules and unsent schedules show up here.</div>'}</div></section>
      ${isShow ? `<section class="card" style="flex:2 1 300px;min-width:0" aria-labelledby="th"><h2 id="th" style="margin-bottom:12px">Theatres</h2>
        ${d.theatreCover.length ? d.theatreCover.map(t => `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-weight:600"><span>${esc(t.name)}</span><span class="${t.gaps ? 'bad-t' : 'good-t'}">${t.gaps ? t.gaps + ' gap' + (t.gaps === 1 ? '' : 's') : 'Covered'}</span></div><div class="bar" style="margin-top:6px"><i style="width:${t.gaps ? Math.max(20, 100 - t.gaps * 12) : 100}%;background:${t.gaps ? '#574596' : '#1F7A4D'}"></i></div></div>`).join('') : '<p class="mut">No theatres yet.</p>'}
        <a class="btn" href="#/rota" style="width:100%;margin-top:6px">Open the rota</a></section>` : ''}
    </div></div>`;
}
