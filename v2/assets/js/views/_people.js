// Shared bits for the people tabs (Delegates, Speakers, Staff, Sponsors, All attendees).
import { esc, $$, toast, toCSV, download, fmtDate } from '../util.js';

export const dash = '<span class="mut">—</span>';
export const fmtAdded = (d) => (d ? fmtDate(d, { year: '2-digit', month: 'short', day: '2-digit' }) : '');
export const slug = (ev) => String(ev.short_name || ev.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase();

export function roomBar(rooms) {
  const a = rooms.allocated, t = rooms.total;
  let s = `<b>${a}</b> room${a === 1 ? '' : 's'} allocated`;
  if (t != null) s += ` of <b>${t}</b>${a > t ? ` <span class="bad-t">· over by ${a - t}</span>` : a < t ? ` <span class="mut">· ${t - a} free</span>` : ''}`;
  else s += ' <span class="mut">· set the total on the calendar event</span>';
  return `<div class="banner roombar" style="background:var(--surface);border:1px solid var(--line)">${s}</div>`;
}
// Room tick for a person (keyed by email / scan ID / record).
export function wireRooms(el, ctx, onChange) {
  $$('input[data-room]', el).forEach(cb => cb.onchange = async () => {
    try { const r = await ctx.api(`/api/events/${encodeURIComponent(ctx.ev.id)}/rooms`, { method: 'PUT', body: { key: cb.dataset.room, on: cb.checked } });
      $$('.roombar', el).forEach(b => { b.outerHTML = roomBar(r.rooms); }); if (onChange) onChange(cb.dataset.room, cb.checked); }
    catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
  });
}
export const roomBox = (r) => `<input type="checkbox" data-room="${esc(r.key)}" ${r.room ? 'checked' : ''} aria-label="Room for ${esc(r.name)}">`;

// Edit-in-place cells: saved a moment after typing stops.
export const cell = (r, k, ph = '') => `<input class="input cellin" data-pid="${r.id}" data-k="${k}" value="${esc(r[k] || '')}" placeholder="${esc(ph)}" aria-label="${esc(k)} for ${esc(r.name)}">`;
export function wireCells(el, ctx, path = (pid) => `/api/people/${pid}`) {
  const timers = {};
  $$('input.cellin', el).forEach(i => i.oninput = () => {
    const key = i.dataset.pid + i.dataset.k; clearTimeout(timers[key]);
    i.classList.remove('saved');
    timers[key] = setTimeout(async () => {
      try { await ctx.api(path(i.dataset.pid, i.dataset.k), { method: i.dataset.method || 'PATCH', body: i.dataset.k === 'note' && i.dataset.method ? { note: i.value } : { [i.dataset.k]: i.value } }); i.classList.add('saved'); }
      catch (e) { toast(e.message, true); }
    }, 600);
  });
  $$('input[data-flag]', el).forEach(cb => cb.onchange = async () => {
    try { await ctx.api(`/api/people/${cb.dataset.pid}`, { method: 'PATCH', body: { [cb.dataset.flag]: cb.checked } }); } catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
  });
}
export function wireRemove(el, ctx, after) {
  $$('[data-rmp]', el).forEach(b => b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.name || 'this person'}?`)) return;
    try { await ctx.api(`/api/people/${b.dataset.rmp}`, { method: 'DELETE' }); toast('Removed'); after(); } catch (e) { toast(e.message, true); }
  });
}
export function wireSearch(el, input, rows, countEl, total) {
  const f = () => { const v = input.value.toLowerCase(); let n = 0;
    rows().forEach(tr => { const show = !v || tr.dataset.s.includes(v); tr.style.display = show ? '' : 'none'; if (show) n++; });
    if (countEl) countEl.textContent = `${n} of ${total}`; };
  input.oninput = f; f();
}
export function sortRows(rows, mode) {
  const r = [...rows];
  if (mode === 'added-new') r.sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
  else if (mode === 'added-old') r.sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || '')));
  else r.sort((a, b) => (a.lastname || a.name || '').localeCompare(b.lastname || b.name || ''));
  return r;
}
export const sortSelect = (cur) => `<label class="sr" for="sort">Sort</label><select class="input" id="sort" style="width:auto">
  <option value="name" ${cur === 'name' ? 'selected' : ''}>Name A–Z</option><option value="added-new" ${cur === 'added-new' ? 'selected' : ''}>Added (newest)</option><option value="added-old" ${cur === 'added-old' ? 'selected' : ''}>Added (oldest)</option></select>`;
export function exportCSV(name, rows, cols) { download(name, '﻿' + toCSV(rows, cols)); }
export const idChip = (r) => r.scanId ? `<span class="num small ${r.idSource === 'generated' ? 'warn-t' : ''}" title="${r.idSource === 'generated' ? 'Generated badge ID: not in HubSpot' : 'HubSpot Scan ID'}">${esc(r.scanId)}</span>` : dash;

// "Add a person" form. Fields: [key, label, attrs]
export function addForm(id, title, hint, fields, button) {
  return `<details class="card" id="${id}-wrap" style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:700">${esc(title)}</summary>
    ${hint ? `<p class="small mut" style="margin:6px 0 10px">${hint}</p>` : ''}
    <form class="form" id="${id}">${fields.map(([k, l, a = '']) => `<div class="field"><label for="${id}-${k}">${esc(l)}</label><input class="input" id="${id}-${k}" name="${k}" ${a}></div>`).join('')}
    <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">${esc(button)}</button></div></form></details>`;
}
export const formData = (f) => Object.fromEntries([...f.querySelectorAll('input[name]')].map(i => [i.name, i.value.trim()]));
export const STD_COLS = (id) => [
  { label: 'Scan ID', key: 'scanId' }, { label: 'Added', get: r => fmtAdded(r.addedAt) }, { label: 'Name', key: 'name' }, { label: 'Job title', key: 'jobtitle' },
  { label: 'Company', key: 'company' }, { label: 'Email', key: 'email' }, { label: 'Dietary requirements', key: 'dietary' },
  { label: 'Accessibility requirements', key: 'accessibility' }, { label: 'Room required', get: r => r.room ? 'Yes' : '' }, { label: 'Notes', key: 'note' }];
