// Tick people in. Works with patchy wifi: every tick is saved on this device
// first and sent when there's signal; the server ignores repeats.
import { esc, $, $$, fmtTime, fmtDay, toast, todayLondon } from '../util.js';

const QKEY = 'ops-checkin-queue';
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch {} };
let filter = 'todo', search = '', day = null, data = null, timer = null;

async function flush(ctx) {
  const q = readQ(); if (!q.length) return true;
  const byEvent = q.reduce((m, it) => ((m[it.event_id] = m[it.event_id] || []).push(it), m), {});
  try {
    for (const [ev, items] of Object.entries(byEvent)) await ctx.api(`/api/events/${encodeURIComponent(ev)}/checkin`, { method: 'POST', body: { items } });
    writeQ(readQ().filter(it => !q.some(x => x.client_id === it.client_id)));
    return true;
  } catch { return false; }
}

export async function render(el, ctx) {
  const ev = ctx.ev;
  clearInterval(timer);
  await flush(ctx);
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  day = qs.get('day') || day;
  try { data = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/checkin${day ? '?day=' + day : ''}`); day = data.day; }
  catch (e) { if (!data) throw e; }   // offline: keep showing the last list
  paint(el, ctx);
  timer = setInterval(async () => {
    if (!document.body.contains(el) || !location.hash.startsWith('#/checkin')) return clearInterval(timer);
    if (await flush(ctx)) { try { data = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/checkin?day=${day}`); } catch {} }
    if (!el.querySelector('input[type=search]:focus')) paint(el, ctx);
  }, 15000);
}

function paint(el, ctx) {
  const pending = readQ().filter(it => it.event_id === ctx.ev.id && it.day === day);
  const state = new Map(data.people.map(p => [p.id, p.present]));
  for (const it of pending) state.set(it.person_id, it.present);
  const people = data.people.map(p => ({ ...p, present: state.get(p.id), pending: pending.some(x => x.person_id === p.id) }));
  const late = people.filter(p => p.late && !p.present);
  const shown = people.filter(p => (filter === 'all' || (filter === 'todo' ? !p.present : filter === 'late' ? p.late && !p.present : p.present)) && (!search || p.name.toLowerCase().includes(search)));
  const here = people.filter(p => p.present).length;
  const dayBtns = (ctx.ev.starts_on && ctx.ev.ends_on && ctx.ev.ends_on !== ctx.ev.starts_on) ? daysOf(ctx.ev).map(d => `<button class="${d === day ? 'on' : ''}" data-day="${d}">${fmtDay(d)}</button>`).join('') : '';
  el.innerHTML = `<div class="ci">
    <div class="card" style="background:#574596;color:#fff;border:0;display:flex;justify-content:space-between;align-items:center">
      <div><div class="small" style="opacity:.85;font-weight:600">${esc(ctx.ev.short_name || ctx.ev.name)} · ${fmtDay(day)}</div><h1 style="font-size:22px;color:#fff">Crew check-in</h1></div>
      <div style="text-align:right"><div class="num" style="font-size:28px;font-weight:800">${here}<span style="font-size:15px;opacity:.8"> / ${people.length}</span></div><div class="small" style="opacity:.85">here</div></div></div>
    ${!navigator.onLine || pending.length ? `<div class="banner warn" role="status" style="margin-top:10px">${navigator.onLine ? 'Sending' : 'No signal —'} ${pending.length} tick${pending.length === 1 ? '' : 's'} saved on this device${navigator.onLine ? '…' : ', will send when back online'}</div>` : ''}
    ${dayBtns ? `<div class="seg" style="margin-top:10px">${dayBtns}</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px;margin:12px 0">
      <label class="sr" for="q">Search crew</label><input class="input" id="q" type="search" placeholder="Search name" value="${esc(search)}">
      <div class="seg" role="group" aria-label="Show"><button data-f="todo" class="${filter === 'todo' ? 'on' : ''}">Not here (${people.length - here})</button><button data-f="late" class="${filter === 'late' ? 'on' : ''}">Late (${late.length})</button><button data-f="here" class="${filter === 'here' ? 'on' : ''}">Here (${here})</button><button data-f="all" class="${filter === 'all' ? 'on' : ''}">All</button></div></div>
    <div class="card" style="padding:0;overflow:hidden">${shown.map(p => `<div class="person">
        <input type="checkbox" id="c-${p.id}" data-p="${p.id}" ${p.present ? 'checked' : ''}>
        <label for="c-${p.id}"><span style="font-weight:700;font-size:15px">${esc(p.name)}</span>
          <span class="small ${p.present ? 'good-t' : p.late ? 'bad-t' : 'mut'}">${p.present ? (p.pending ? 'Here · waiting to send' : `Here${p.checked_at ? ' ' + fmtTime(p.checked_at) : ''}`) : p.first_start ? `${p.late ? 'Late · ' : ''}Due ${fmtTime(p.first_start)}` : 'No shift today'}${p.roles ? ' · ' + esc(p.roles) : ''}${p.theatres ? ' · ' + esc(p.theatres) : ''}</span>
          ${p.kit.length ? `<span class="small mut">Has ${esc(p.kit.join(', '))}</span>` : ''}</label>
        <a class="btn sm" href="#/kit?person=${p.id}" aria-label="Kit for ${esc(p.name)}">Kit</a></div>`).join('') || `<div class="empty"><b>${filter === 'todo' ? 'Everyone is here' : 'Nobody here'}</b></div>`}</div></div>`;
  $('#q', el).oninput = (e) => { search = e.target.value.toLowerCase(); paint(el, ctx); $('#q', el).focus(); $('#q', el).setSelectionRange(99, 99); };
  $$('[data-f]', el).forEach(b => b.onclick = () => { filter = b.dataset.f; paint(el, ctx); });
  $$('[data-day]', el).forEach(b => b.onclick = () => { day = b.dataset.day; render(el, ctx); });
  $$('[data-p]', el).forEach(c => c.onchange = async () => {
    const q = readQ(); q.push({ client_id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)), event_id: ctx.ev.id, person_id: c.dataset.p, day, present: c.checked, at: new Date().toISOString() }); writeQ(q);
    paint(el, ctx);
    if (await flush(ctx)) { try { data = await ctx.api(`/api/events/${encodeURIComponent(ctx.ev.id)}/checkin?day=${day}`); } catch {} paint(el, ctx); }
  });
}
function daysOf(ev) { const o = []; for (let d = new Date(ev.starts_on + 'T12:00:00Z'); d <= new Date(ev.ends_on + 'T12:00:00Z') && o.length < 14; d = new Date(+d + 86400000)) o.push(d.toISOString().slice(0, 10)); return o; }
window.addEventListener('online', () => window.dispatchEvent(new HashChangeEvent('hashchange')));
