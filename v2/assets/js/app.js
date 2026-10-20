import { signIn, signOut, api } from './auth.js';
import { esc, $, fmtDate, toast } from './util.js';

const VIEWS = {
  home: () => import('./views/home.js'), rota: () => import('./views/rota.js'), checkin: () => import('./views/checkin.js'),
  kit: () => import('./views/kit.js'), tables: () => import('./views/tables.js'), sponsors: () => import('./views/sponsors.js'),
  leaderboards: () => import('./views/leaderboards.js'), admin: () => import('./views/admin.js'), history: () => import('./views/history.js'), scans: () => import('./views/scans.js'),
  delegates: () => import('./views/delegates.js'), speakers: () => import('./views/speakers.js'), staff: () => import('./views/staff.js'),
  community: () => import('./views/community.js'), everyone: () => import('./views/everyone.js'), cover: () => import('./views/cover.js')
};
const S = { user: null, me: null, events: [], eventId: null };
try { S.eventId = localStorage.getItem('ops-event') || null; } catch {}

export const ctx = {
  api, S,
  get ev() { return S.events.find(e => e.id === S.eventId) || null; },
  go: (r) => { location.hash = '#/' + r; },
  refresh: () => route(),
  dialog, closeDialog
};

function nav() {
  const r = (location.hash.replace(/^#\//, '') || 'home').split('?')[0];
  const ev = ctx.ev, kind = ev ? ev.kind : '';
  const link = (id, label, extra = '') => `<a href="#/${id}" class="${r === id ? 'on' : ''}"${r === id ? ' aria-current="page"' : ''}>${label}${extra}</a>`;
  $('#nav').innerHTML = `
    <div class="navhd">Event</div>
    ${link('home', 'Overview')}
    ${kind !== 'show' ? link('delegates', 'Delegates') : ''}${link('sponsors', 'Sponsors')}${link('community', 'Community planner')}${link('speakers', 'Speakers')}${link('staff', 'Staff')}${link('everyone', 'All attendees')}
    ${kind === 'show' || !ev ? `<div class="navhd">Show floor</div>${link('rota', 'Theatre rota')}${link('checkin', 'Check-in')}${link('kit', 'Kit register')}${ev ? link('scans', 'Scan check') : ''}` : `<div class="navhd">On the day</div>${link('kit', 'Kit register')}`}
    ${kind !== 'show' ? `<div class="navhd">Hospitality</div>${link('tables', 'Table planner')}` : ''}
    <div class="navhd">Programmes</div>${link('cover', 'Community cover')}${link('leaderboards', '100 leaderboards')}
    <div class="navhd">Settings</div>${S.me && S.me.admin ? link('admin', 'Admin') : ''}${link('history', 'History')}`;
  $('#ev-name').textContent = ev ? (ev.short_name || ev.name) : 'Choose an event';
  $('#ev-meta').textContent = ev ? `${fmtDate(ev.starts_on)} · ${ev.kind}` : (S.events.length ? 'No event chosen' : 'No events switched on yet');
  $('#who').innerHTML = `${esc(S.user.name)}<br>${S.me && S.me.admin ? 'Admin · ' : ''}<a href="#" id="signout">Sign out</a>`;
  $('#signout').onclick = (e) => { e.preventDefault(); signOut(); };
}

async function route() {
  const key = (location.hash.replace(/^#\//, '') || 'home').split('?')[0];
  const load = VIEWS[key] || VIEWS.home;
  nav();
  const view = $('#view');
  if (!ctx.ev && !['leaderboards', 'admin', 'kit', 'cover'].includes(key)) {
    view.innerHTML = `<div class="wrap"><div class="card empty"><b>${S.events.length ? 'Choose an event' : 'No events are switched on in Ops yet'}</b>
      ${S.events.length ? 'Use the event button at the top left.' : (S.me.admin ? 'Go to <a href="#/admin">Admin</a>, sync the calendar and switch events on.' : 'Ask an Ops admin to switch events on.')}</div></div>`;
    return;
  }
  view.innerHTML = '<div class="wrap"><div class="empty"><span class="spin"></span></div></div>';
  try { const m = await load(); await m.render(view, ctx); }
  catch (e) { view.innerHTML = `<div class="wrap"><div class="banner bad">${esc(e.message)}</div></div>`; }
}

export async function loadEvents() {
  S.events = (await api('/api/events')).events;
  if (S.eventId && !S.events.some(e => e.id === S.eventId)) S.eventId = null;
  if (!S.eventId && S.events.length) {
    const today = new Date().toISOString().slice(0, 10);
    S.eventId = (S.events.find(e => !e.cancelled && e.starts_on >= today) || S.events[0]).id;
  }
}

function pickEvent() {
  const today = new Date().toISOString().slice(0, 10);
  const up = S.events.filter(e => (e.ends_on || e.starts_on) >= today), past = S.events.filter(e => (e.ends_on || e.starts_on) < today).reverse();
  const item = (e) => `<button class="btn" data-ev="${esc(e.id)}" style="justify-content:space-between;width:100%;min-height:48px;margin-bottom:6px${e.id === S.eventId ? ';border-color:#574596' : ''}">
     <span style="text-align:left">${esc(e.short_name || e.name)}${e.cancelled ? ' <span class="chip bad">cancelled</span>' : ''}<br><span class="small mut" style="font-weight:500">${esc(e.name)}</span></span>
     <span class="small mut">${fmtDate(e.starts_on)}</span></button>`;
  dialog('Choose an event', S.events.length ? `<input class="input" id="evq" placeholder="Search events" aria-label="Search events" style="margin-bottom:10px">
    <div id="evlist" style="max-height:60vh;overflow:auto">${up.map(item).join('')}${past.length ? `<div class="navhd" style="margin:12px 0 6px">Past</div>${past.map(item).join('')}` : ''}</div>`
    : `<p class="mut">No events are switched on yet.${S.me.admin ? ' Switch them on in <a href="#/admin">Admin</a>.' : ''}</p>`, (d) => {
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-ev]'); if (!b) return; S.eventId = b.dataset.ev; try { localStorage.setItem('ops-event', S.eventId); } catch {} closeDialog(); route(); });
    const qi = d.querySelector('#evq'); if (qi) qi.oninput = () => d.querySelectorAll('[data-ev]').forEach(b => { b.style.display = b.textContent.toLowerCase().includes(qi.value.toLowerCase()) ? '' : 'none'; });
  });
}

export function dialog(title, html, onMount) {
  const d = $('#dlg'); $('#dlg-t').textContent = title; $('#dlg-b').innerHTML = html;
  if (!d.open) d.showModal();
  if (onMount) onMount($('#dlg-b'));
  return d;
}
export function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }
$('#dlg').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === $('#dlg')) closeDialog(); });

async function start(interactive) {
  $('#gate-msg').textContent = '';
  try {
    S.user = await signIn(interactive);
    if (!S.user) return;
    S.me = (await api('/api/me')).user;
    await loadEvents();
    $('#gate').hidden = true; $('#app').hidden = false;
    $('#evpick').onclick = pickEvent;
    $('#menu').onclick = () => { const o = $('.side').classList.toggle('open'); $('#menu').setAttribute('aria-expanded', o); };
    $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) { $('.side').classList.remove('open'); $('#menu').setAttribute('aria-expanded', 'false'); } });
    window.addEventListener('hashchange', route);
    route();
  } catch (e) { $('#gate-msg').textContent = e.message; }
}
$('#signin').onclick = () => start(true);
start(false);
window.addEventListener('ops-toast', (e) => toast(e.detail.msg, e.detail.bad));
