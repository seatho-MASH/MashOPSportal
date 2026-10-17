import { esc, $, $$, fmtTime, fmtDay, londonISO, parseCSV, toast, plural, fmtDateTime } from '../util.js';

const SLOT = 30 * 60000;
let state = { tab: 'grid', day: null };

function days(ev) {
  const out = []; if (!ev.starts_on) return out;
  for (let d = new Date(ev.starts_on + 'T12:00:00Z'); d <= new Date((ev.ends_on || ev.starts_on) + 'T12:00:00Z') && out.length < 14; d = new Date(+d + 86400000)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const hhmm = (iso) => fmtTime(iso);
const params = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));

export async function render(el, ctx) {
  const ev = ctx.ev, p = params();
  const dlist = days(ev);
  if (p.tab) state.tab = p.tab;
  if (p.day && dlist.includes(p.day)) state.day = p.day;
  if (!state.day || !dlist.includes(state.day)) state.day = dlist[0];
  const tabs = [['grid', 'Rota'], ['crew', 'Crew'], ['agenda', 'Theatres & agenda'], ['rules', 'Cover & breaks'], ['schedules', 'Schedules']];
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">${esc(ev.short_name || ev.name)}</div><h1>Theatre rota</h1></div>
      <div class="pills" style="gap:8px" id="rota-actions"></div></header>
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center">
      <div class="seg" role="tablist" aria-label="Rota sections">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${state.tab === k}" class="${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      ${dlist.length > 1 && ['grid', 'rules'].includes(state.tab) ? `<div class="seg" aria-label="Day">${dlist.map(d => `<button class="${d === state.day ? 'on' : ''}" data-day="${d}">${fmtDay(d)}</button>`).join('')}</div>` : ''}
    </div>
    <div id="rota-body"><div class="empty"><span class="spin"></span></div></div></div>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; history.replaceState(null, '', '#/rota'); render(el, ctx); });
  el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { state.day = b.dataset.day; render(el, ctx); });
  if (!state.day) { $('#rota-body').innerHTML = '<div class="banner warn">This event has no date on the calendar yet.</div>'; return; }
  const data = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/rota?day=${state.day}`);
  const body = $('#rota-body');
  const again = () => render(el, ctx);
  ({ grid, crew, agenda, rules, schedules })[state.tab](body, data, ctx, again);
}

// ------------------------------------------------------------------ grid
function grid(body, d, ctx, again) {
  const acts = $('#rota-actions');
  acts.innerHTML = `<button class="btn" id="propose">Propose breaks</button><a class="btn pri" href="#/rota?tab=schedules">Send schedules</a>`;
  $('#propose').onclick = () => propose(d, ctx, again);
  if (!d.theatres.length) { body.innerHTML = `<div class="card empty"><b>No theatres yet</b>Add theatres and the agenda under <a href="#/rota?tab=agenda">Theatres &amp; agenda</a>, and crew under <a href="#/rota?tab=crew">Crew</a>.</div>`; return; }
  const times = [...d.sessions.flatMap(s => [s.starts_at, s.ends_at]), ...d.assignments.flatMap(a => [a.starts_at, a.ends_at]), ...d.rules.flatMap(r => [r.from_at, r.to_at])].map(t => +new Date(t));
  let from = +new Date(londonISO(state.day, '08:00')), to = +new Date(londonISO(state.day, '18:00'));
  if (times.length) { from = Math.min(from, Math.floor(Math.min(...times) / 3600000) * 3600000); to = Math.max(to, Math.ceil(Math.max(...times) / 3600000) * 3600000); }
  const workTheatre = (pid, t) => (d.assignments.find(a => a.kind === 'work' && a.person_id === pid && +new Date(a.starts_at) <= t && +new Date(a.ends_at) > t) || {}).theatre_id;
  const name = (a) => [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email;
  const legend = `<div class="pills small" style="gap:14px;font-weight:600;color:#4A4D55;margin-bottom:10px">
    <span><span class="p-on" style="display:inline-block;width:12px;height:12px;padding:0;vertical-align:-1px"></span> On shift</span>
    <span><span class="p-on brk" style="display:inline-block;width:12px;height:12px;padding:0;vertical-align:-1px"></span> Break</span>
    <span><span class="p-gap" style="display:inline-block;width:12px;height:12px;padding:0;vertical-align:-1px"></span> Cover missing</span>
    <span><span class="p-sess" style="display:inline-block;width:12px;height:12px;padding:0;vertical-align:-1px"></span> Session</span>
    <span class="mut" style="font-weight:500">Click an empty part of a cell to add a shift there; click a name to change it.</span></div>`;
  let html = `<div class="rota" style="grid-template-columns:64px repeat(${d.theatres.length}, minmax(190px,1fr))"><div class="hd small mut" style="border-left:0">Time</div>`;
  for (const t of d.theatres) { const g = d.gaps.filter(x => x.theatre_id === t.id).length; html += `<div class="hd"><b>${esc(t.name)}</b><div class="small ${g ? 'bad-t' : 'good-t'}">${g ? plural(g, 'gap') : 'Covered'}</div></div>`; }
  for (let t = from; t < to; t += SLOT) {
    html += `<div class="tm num">${hhmm(new Date(t))}</div>`;
    for (const th of d.theatres) {
      const sess = d.sessions.filter(s => s.theatre_id === th.id && +new Date(s.starts_at) >= t && +new Date(s.starts_at) < t + SLOT);
      const on = d.assignments.filter(a => +new Date(a.starts_at) <= t && +new Date(a.ends_at) > t && (a.kind === 'work' ? a.theatre_id === th.id : workTheatre(a.person_id, t) === th.id));
      const gaps = d.gaps.filter(g => g.theatre_id === th.id && +new Date(g.from) <= t && +new Date(g.to) > t);
      html += `<div class="cell" data-cell data-t="${t}" data-th="${th.id}">
        ${sess.map(s => `<span class="p-sess">${hhmm(s.starts_at)} ${esc(s.title)}</span>`).join('')}
        ${on.map(a => `<button class="p-on${a.kind === 'break' ? ' brk' : ''}" data-a="${a.id}"><span>${esc(name(a))}</span><span class="rl">${a.kind === 'break' ? 'Break' : esc(a.role_name || '')}</span></button>`).join('')}
        ${gaps.map(g => `<div class="p-gap">+ needs ${g.short} ${esc(g.role.toLowerCase())}</div>`).join('')}</div>`;
    }
  }
  html += '</div>';
  const gapCard = d.gaps.length ? `<section class="card" aria-labelledby="gaps"><h2 id="gaps" style="margin-bottom:6px">Gaps in cover</h2><div class="list">${d.gaps.map((g, i) => `
     <div class="item"><span class="chip bad">${esc(g.theatre)}</span><div class="grow"><div style="font-weight:700">Needs ${g.short} ${esc(g.role.toLowerCase())} · ${hhmm(g.from)}–${hhmm(g.to)}</div>
       <div class="small mut">${g.free.length ? 'Free then: ' + g.free.map(f => `<button class="btn sm" style="min-height:30px;margin:3px 4px 0 0" data-fill="${i}" data-pid="${f.id}">${esc(f.name)}${f.role ? ' · ' + esc(f.role) : ''}</button>`).join('') : 'Nobody on the crew list is free then — add crew.'}</div></div></div>`).join('')}</div></section>` : '';
  body.innerHTML = `${legend}<div class="card" style="padding:0"><div class="scroll-x">${html}</div></div><div style="height:18px"></div>${gapCard}`;
  body.querySelectorAll('[data-cell]').forEach(c => c.onclick = (e) => { if (e.target.closest('[data-a]')) return; shiftDialog(d, ctx, again, { theatre_id: c.dataset.th, start: +c.dataset.t }); });
  body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => editShift(d, ctx, again, d.assignments.find(a => a.id === b.dataset.a)));
  body.querySelectorAll('[data-fill]').forEach(b => b.onclick = async () => {
    const g = d.gaps[+b.dataset.fill];
    try { await ctx.api(`/api/events/${encodeURIComponent(ctx.ev.id)}/assignments`, { method: 'POST', body: { person_id: b.dataset.pid, theatre_id: g.theatre_id, role_id: g.role_id, starts_at: g.from, ends_at: g.to } }); toast('Added to the gap'); again(); }
    catch (e) { toast(e.message, true); }
  });
}

function timeOptions(sel) {
  let o = ''; for (let h = 6; h < 24; h++) for (const m of ['00', '15', '30', '45']) { const v = `${String(h).padStart(2, '0')}:${m}`; o += `<option${v === sel ? ' selected' : ''}>${v}</option>`; } return o;
}
function shiftDialog(d, ctx, again, pre) {
  const st = hhmm(new Date(pre.start)), en = hhmm(new Date(pre.start + 2 * 3600000));
  const th = d.theatres.find(t => t.id === pre.theatre_id);
  const crew = d.crew.map(p => `<option value="${p.id}">${esc([p.first_name, p.last_name].filter(Boolean).join(' ') || p.email)}${p.default_role ? ' — ' + esc(p.default_role) : ''}</option>`).join('');
  ctx.dialog(`Add to ${th ? th.name : 'the rota'}`, d.crew.length ? `<form id="f" class="form">
      <div class="field" style="grid-column:1/-1"><label for="p">Person</label><select class="input" id="p" required>${crew}</select></div>
      <div class="field"><label for="k">Type</label><select class="input" id="k"><option value="work">Shift</option><option value="break">Break</option></select></div>
      <div class="field"><label for="r">Role</label><select class="input" id="r">${d.roles.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="s">From</label><select class="input" id="s">${timeOptions(st)}</select></div>
      <div class="field"><label for="e">To</label><select class="input" id="e">${timeOptions(en)}</select></div>
      <div class="actions" style="grid-column:1/-1"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">Add</button></div></form>`
    : `<p>There's nobody on the crew list yet.</p><div class="actions"><a class="btn pri" href="#/rota?tab=crew" data-close>Add crew</a></div>`, (b) => {
    const f = b.querySelector('#f'); if (!f) return;
    const pick = () => { const p = d.crew.find(x => x.id === f.p.value); const r = p && d.roles.find(x => x.name === p.default_role); if (r) f.r.value = r.id; };
    f.p.onchange = pick; pick();
    f.k.onchange = () => { f.r.disabled = f.k.value === 'break'; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await ctx.api(`/api/events/${encodeURIComponent(ctx.ev.id)}/assignments`, { method: 'POST', body: { person_id: f.p.value, theatre_id: f.k.value === 'work' ? pre.theatre_id : null, role_id: f.r.value, kind: f.k.value, starts_at: londonISO(state.day, f.s.value), ends_at: londonISO(state.day, f.e.value) } });
        ctx.closeDialog(); again(); } catch (err) { toast(err.message, true); }
    };
  });
}
function editShift(d, ctx, again, a) {
  const nm = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email;
  ctx.dialog(nm, `<p style="margin-top:0">${a.kind === 'break' ? 'Break' : esc(a.role_name || 'Shift')} · ${hhmm(a.starts_at)}–${hhmm(a.ends_at)}${a.source === 'engine' ? ' · proposed by the break engine' : ''}</p>
    <div class="actions"><button class="btn danger" id="rm">Remove</button><button class="btn" data-close>Close</button></div>`, (b) => {
    b.querySelector('#rm').onclick = async () => { try { await ctx.api(`/api/assignments/${a.id}`, { method: 'DELETE' }); ctx.closeDialog(); again(); } catch (e) { toast(e.message, true); } };
  });
}
async function propose(d, ctx, again) {
  try {
    const r = await ctx.api(`/api/events/${encodeURIComponent(ctx.ev.id)}/breaks/propose`, { method: 'POST', body: { day: state.day } });
    ctx.dialog('Proposed breaks', `<p class="mut" style="margin-top:0">${r.breakMinutes}-minute breaks inside ${r.window}, placed so every cover rule still holds. Change the window under Cover &amp; breaks.</p>
      ${r.proposals.length ? `<div class="list">${r.proposals.map(p => `<div class="item"><span class="chip warn">${hhmm(p.starts_at)}–${hhmm(p.ends_at)}</span><div class="grow"><b>${esc(p.name)}</b> <span class="mut small">${esc(p.theatre)}</span></div></div>`).join('')}</div>` : '<p>Nobody needs a break proposing.</p>'}
      ${r.unplaced.length ? `<div class="banner bad" style="margin-top:12px"><b>Couldn't place ${plural(r.unplaced.length, 'break')}:</b> ${r.unplaced.map(u => esc(u.name)).join(', ')}. No slot keeps their theatre covered — add cover, or place these by hand.</div>` : ''}
      <div class="actions"><button class="btn" data-close>Cancel</button>${r.proposals.length ? '<button class="btn pri" id="acc">Add these breaks</button>' : ''}</div>`, (b) => {
      const acc = b.querySelector('#acc');
      if (acc) acc.onclick = async () => { try { await ctx.api(`/api/events/${encodeURIComponent(ctx.ev.id)}/breaks/accept`, { method: 'POST', body: { proposals: r.proposals } }); ctx.closeDialog(); toast('Breaks added'); again(); } catch (e) { toast(e.message, true); } };
    });
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------------ crew
function crew(body, d, ctx, again) {
  $('#rota-actions').innerHTML = '';
  const ev = ctx.ev;
  body.innerHTML = `<div class="row2">
   <section class="card" style="flex:3 1 560px;min-width:0"><h2 style="margin-bottom:10px">Crew <span class="chip">${d.crew.length}</span></h2>
    ${d.crew.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Usual role</th><th>Grip login</th><th></th></tr></thead><tbody>
    ${d.crew.map(p => `<tr><td><b>${esc([p.first_name, p.last_name].filter(Boolean).join(' '))}</b></td><td class="small">${esc(p.email || '—')}</td><td>${esc(p.kind)}</td><td>${esc(p.default_role || '—')}</td>
       <td><button class="btn sm" data-login="${p.id}">Set / view</button></td><td class="r"><button class="btn sm danger" data-rm="${p.id}" aria-label="Remove ${esc(p.first_name)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>No crew yet</b>Add people one at a time or paste a CSV.</div>'}
   </section>
   <section class="card" style="flex:2 1 320px;min-width:0"><h2 style="margin-bottom:10px">Add crew</h2>
    <form id="add" class="form">
      <div class="field"><label for="fn">First name</label><input class="input" id="fn" required></div>
      <div class="field"><label for="ln">Last name</label><input class="input" id="ln"></div>
      <div class="field" style="grid-column:1/-1"><label for="em">Email</label><input class="input" id="em" type="email"></div>
      <div class="field"><label for="ph">Mobile</label><input class="input" id="ph" type="tel"></div>
      <div class="field"><label for="ki">Type</label><select class="input" id="ki"><option value="volunteer">Volunteer</option><option value="staff">Mash staff</option></select></div>
      <div class="field" style="grid-column:1/-1"><label for="ro">Usual role</label><select class="input" id="ro"><option value="">—</option>${d.roles.map(r => `<option>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">Add</button></div></form>
    <h3 style="margin:18px 0 6px">Or paste a CSV</h3><p class="small mut" style="margin:0 0 6px">Columns: first_name, last_name, email, phone, kind (staff/volunteer), role</p>
    <textarea class="input" id="csv" aria-label="Crew CSV" placeholder="first_name,last_name,email,phone,kind,role"></textarea>
    <div class="actions"><button class="btn" id="imp">Import</button></div></section></div>`;
  const f = $('#add');
  f.onsubmit = async (e) => { e.preventDefault();
    try { await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/crew`, { method: 'POST', body: { first_name: f.fn.value, last_name: f.ln.value, email: f.em.value, phone: f.ph.value, kind: f.ki.value, role: f.ro.value } }); toast('Added'); again(); } catch (err) { toast(err.message, true); } };
  $('#imp').onclick = async () => { const rows = parseCSV($('#csv').value); if (!rows.length) return toast('Paste a CSV with a header row first', true);
    try { const r = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/crew/import`, { method: 'POST', body: { rows } }); toast(`${r.imported} imported${r.errors.length ? `, ${r.errors.length} skipped` : ''}`, !!r.errors.length); again(); } catch (err) { toast(err.message, true); } };
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (!confirm('Remove from this event\'s crew? Their shifts are removed too.')) return;
    try { await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/crew/${b.dataset.rm}`, { method: 'DELETE' }); again(); } catch (e) { toast(e.message, true); } });
  body.querySelectorAll('[data-login]').forEach(b => b.onclick = () => loginDialog(ctx, b.dataset.login, d.crew.find(p => p.id === b.dataset.login)));
}
function loginDialog(ctx, pid, p) {
  ctx.dialog(`Grip login — ${p.first_name || p.email}`, `<p class="small mut" style="margin-top:0">Only Mash staff can see this, every view is logged, and it's only ever emailed to ${esc(p.first_name || 'this person')}.</p>
    <div id="cur" class="banner" style="margin-bottom:12px"><button class="btn sm" id="show">Show current login</button></div>
    <form id="f" class="form"><div class="field"><label for="u">Username</label><input class="input" id="u" required autocomplete="off"></div>
    <div class="field"><label for="pw">Password</label><input class="input" id="pw" autocomplete="new-password" placeholder="leave blank to keep"></div>
    <div class="actions" style="grid-column:1/-1"><button type="button" class="btn" data-close>Close</button><button class="btn pri">Save</button></div></form>`, (b) => {
    b.querySelector('#show').onclick = async () => { try { const r = await ctx.api(`/api/events/${encodeURIComponent(ctx.ev.id)}/credentials/${pid}`);
      b.querySelector('#cur').innerHTML = r.credential ? `Username <b>${esc(r.credential.username)}</b>${r.credential.password ? ` · Password <b>${esc(r.credential.password)}</b>` : ''}` : 'No login saved yet.';
      if (r.credential) b.querySelector('#u').value = r.credential.username; } catch (e) { toast(e.message, true); } };
    const f = b.querySelector('#f');
    f.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${encodeURIComponent(ctx.ev.id)}/credentials/${pid}`, { method: 'PUT', body: { username: f.u.value, password: f.pw.value } }); ctx.closeDialog(); toast('Login saved'); } catch (err) { toast(err.message, true); } };
  });
}

// ------------------------------------------------------------------ theatres & agenda
function agenda(body, d, ctx, again) {
  $('#rota-actions').innerHTML = '';
  const ev = ctx.ev, dl = days(ev);
  body.innerHTML = `<div class="row2">
   <section class="card" style="flex:1 1 320px;min-width:0"><h2 style="margin-bottom:10px">Theatres</h2>
     <div class="list">${d.theatres.map(t => `<div class="item"><div class="grow"><b>${esc(t.name)}</b><div class="small mut">${t.ninja_location ? 'Lineup Ninja location: ' + esc(t.ninja_location) : 'No Lineup Ninja location mapped'}</div></div>
       <button class="btn sm" data-ren="${t.id}">Edit</button><button class="btn sm danger" data-del="${t.id}">Delete</button></div>`).join('') || '<p class="mut">None yet.</p>'}</div>
     <form id="addt" class="form" style="margin-top:12px"><div class="field"><label for="tn">Theatre name</label><input class="input" id="tn" required></div>
       <div class="field"><label for="tl">Lineup Ninja location (optional)</label><input class="input" id="tl"></div>
       <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">Add theatre</button></div></form></section>
   <section class="card" style="flex:2 1 480px;min-width:0"><h2 style="margin-bottom:4px">Agenda · ${fmtDay(state.day)}</h2>
     <p class="small mut" style="margin:0 0 10px">Lineup Ninja isn't connected yet, so sessions come from here or a CSV. When the API arrives the same rows update by session id.</p>
     ${d.sessions.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Time</th><th>Session</th><th>Theatre</th><th></th></tr></thead><tbody>${d.sessions.map(s => `<tr><td class="num">${hhmm(s.starts_at)}–${hhmm(s.ends_at)}</td><td>${esc(s.title)}${s.ninja_id ? ` <span class="chip small">${esc(s.ninja_id)}</span>` : ''}</td><td>${esc((d.theatres.find(t => t.id === s.theatre_id) || {}).name || '—')}</td><td class="r"><button class="btn sm danger" data-sdel="${s.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">No sessions on this day.</p>'}
     <form id="adds" class="form" style="margin-top:12px"><div class="field" style="grid-column:1/-1"><label for="st">Title</label><input class="input" id="st" required></div>
       <div class="field"><label for="sth">Theatre</label><select class="input" id="sth">${d.theatres.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
       <div class="field"><label for="sd">Day</label><select class="input" id="sd">${dl.map(x => `<option value="${x}"${x === state.day ? ' selected' : ''}>${fmtDay(x)}</option>`).join('')}</select></div>
       <div class="field"><label for="ss">Start</label><select class="input" id="ss">${timeOptions('10:00')}</select></div>
       <div class="field"><label for="se">End</label><select class="input" id="se">${timeOptions('11:00')}</select></div>
       <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri" ${d.theatres.length ? '' : 'disabled'}>Add session</button></div></form>
     <h3 style="margin:16px 0 6px">Import a CSV</h3><p class="small mut" style="margin:0 0 6px">Columns: title, theatre (or location), day (YYYY-MM-DD), start, end (HH:MM London), ninja_id (optional). Unknown theatres are created.</p>
     <textarea class="input" id="scsv" aria-label="Agenda CSV" placeholder="title,theatre,day,start,end,ninja_id"></textarea><div class="actions"><button class="btn" id="simp">Import</button></div></section></div>`;
  const ft = $('#addt');
  ft.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/theatres`, { method: 'POST', body: { name: ft.tn.value, ninja_location: ft.tl.value } }); again(); } catch (err) { toast(err.message, true); } };
  const fs = $('#adds');
  fs.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/sessions`, { method: 'POST', body: { title: fs.st.value, theatre_id: fs.sth.value, starts_at: londonISO(fs.sd.value, fs.ss.value), ends_at: londonISO(fs.sd.value, fs.se.value) } }); again(); } catch (err) { toast(err.message, true); } };
  $('#simp').onclick = async () => { const rows = parseCSV($('#scsv').value); if (!rows.length) return toast('Paste a CSV with a header row first', true);
    try { const r = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/sessions/import`, { method: 'POST', body: { rows } }); toast(`${r.imported} imported${r.errors.length ? ' — ' + r.errors[0] : ''}`, !!r.errors.length); again(); } catch (err) { toast(err.message, true); } };
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Delete this theatre? Its sessions keep their times but lose the theatre; shifts in it are removed.')) return; try { await ctx.api(`/api/theatres/${b.dataset.del}`, { method: 'DELETE' }); again(); } catch (e) { toast(e.message, true); } });
  body.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => { const t = d.theatres.find(x => x.id === b.dataset.ren);
    ctx.dialog('Edit theatre', `<form id="f" class="form"><div class="field"><label for="n">Name</label><input class="input" id="n" value="${esc(t.name)}" required></div><div class="field"><label for="l">Lineup Ninja location</label><input class="input" id="l" value="${esc(t.ninja_location || '')}"></div><div class="actions" style="grid-column:1/-1"><button class="btn pri">Save</button></div></form>`, (bb) => {
      const f = bb.querySelector('#f'); f.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/theatres/${t.id}`, { method: 'PATCH', body: { name: f.n.value, ninja_location: f.l.value } }); ctx.closeDialog(); again(); } catch (err) { toast(err.message, true); } }; }); });
  body.querySelectorAll('[data-sdel]').forEach(b => b.onclick = async () => { try { await ctx.api(`/api/sessions/${b.dataset.sdel}`, { method: 'DELETE' }); again(); } catch (e) { toast(e.message, true); } });
}

// ------------------------------------------------------------------ cover & breaks
function rules(body, d, ctx, again) {
  $('#rota-actions').innerHTML = '';
  const ev = ctx.ev, br = d.breakRule;
  body.innerHTML = `<div class="row2">
   <section class="card" style="flex:3 1 520px;min-width:0"><h2 style="margin-bottom:4px">Cover rules · ${fmtDay(state.day)}</h2><p class="small mut" style="margin:0 0 10px">"Theatre X needs N of this role between these times." Gaps on the rota come from these.</p>
    ${d.rules.length ? `<div class="list">${d.rules.map(r => `<div class="item"><span class="chip brand">${r.min_count} × ${esc(r.role_name)}</span><div class="grow">${esc(r.theatre_id ? (d.theatres.find(t => t.id === r.theatre_id) || {}).name || '?' : 'Every theatre')} · ${hhmm(r.from_at)}–${hhmm(r.to_at)}</div><button class="btn sm danger" data-rdel="${r.id}">Remove</button></div>`).join('')}</div>` : '<p class="mut">No rules yet — nothing will show as a gap until you add some.</p>'}
    <form id="addr" class="form" style="margin-top:12px">
      <div class="field"><label for="rt">Theatre</label><select class="input" id="rt"><option value="">Every theatre</option>${d.theatres.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="rr">Role</label><select class="input" id="rr">${d.roles.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="rn">How many</label><input class="input" id="rn" type="number" min="1" value="1"></div>
      <div class="field"><label for="rf">From</label><select class="input" id="rf">${timeOptions('09:00')}</select></div>
      <div class="field"><label for="rto">To</label><select class="input" id="rto">${timeOptions('17:00')}</select></div>
      <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">Add rule</button></div></form></section>
   <section class="card" style="flex:2 1 300px;min-width:0"><h2 style="margin-bottom:4px">Breaks</h2><p class="small mut" style="margin:0 0 10px">The break engine places one break per person inside this window, only where cover still holds.</p>
    <form id="brk" class="form"><div class="field"><label for="wf">Window from</label><select class="input" id="wf">${timeOptions(String(br.window_from).slice(0, 5))}</select></div>
      <div class="field"><label for="wt">Window to</label><select class="input" id="wt">${timeOptions(String(br.window_to).slice(0, 5))}</select></div>
      <div class="field"><label for="bm">Break length (minutes)</label><input class="input" id="bm" type="number" min="5" max="240" value="${br.break_minutes}"></div>
      <div class="actions" style="grid-column:1/-1;margin-top:0"><button class="btn pri">Save</button></div></form></section></div>`;
  const f = $('#addr');
  f.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/rules`, { method: 'POST', body: { theatre_id: f.rt.value || null, role_id: f.rr.value, min_count: f.rn.value, from_at: londonISO(state.day, f.rf.value), to_at: londonISO(state.day, f.rto.value) } }); again(); } catch (err) { toast(err.message, true); } };
  body.querySelectorAll('[data-rdel]').forEach(b => b.onclick = async () => { try { await ctx.api(`/api/rules/${b.dataset.rdel}`, { method: 'DELETE' }); again(); } catch (e) { toast(e.message, true); } });
  const g = $('#brk');
  g.onsubmit = async (e) => { e.preventDefault(); try { await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/break-rule`, { method: 'PUT', body: { window_from: g.wf.value, window_to: g.wt.value, break_minutes: g.bm.value } }); toast('Saved'); } catch (err) { toast(err.message, true); } };
}

// ------------------------------------------------------------------ schedules
async function schedules(body, d, ctx, again) {
  $('#rota-actions').innerHTML = '';
  const ev = ctx.ev;
  const r = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/schedules`);
  const label = { 'never-sent': ['brand', 'Not sent'], changed: ['warn', 'Changed since sent'], 'up-to-date': ['good', 'Up to date'], queued: ['info', 'Sending…'], 'no-shifts': ['', 'No shifts'] };
  const sendable = r.people.filter(p => ['never-sent', 'changed'].includes(p.status) && p.email);
  body.innerHTML = `<section class="card"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
      <div><h2>Schedules</h2><p class="small mut" style="margin:4px 0 0">Each person gets their own email: shifts, breaks, the sessions in their theatre, and their own Grip login. Nobody is sent anyone else's.</p></div>
      <div class="pills"><button class="btn" id="selc">Select changed + not sent (${sendable.length})</button><button class="btn pri" id="send" disabled>Send to 0</button></div></div>
    <div class="scroll-x"><table class="t"><thead><tr><th style="width:36px"><span class="sr">Select</span></th><th>Name</th><th>Email</th><th class="r">Shifts</th><th>Status</th><th>Last sent</th><th></th></tr></thead><tbody>
    ${r.people.map(p => `<tr><td><input type="checkbox" data-pid="${p.person_id}" aria-label="Select ${esc(p.name)}" ${p.email && p.shifts ? '' : 'disabled'}></td><td><b>${esc(p.name)}</b> <span class="small mut">${esc(p.kind)}</span></td><td class="small">${esc(p.email || 'no email')}</td><td class="r num">${p.shifts}</td>
      <td><span class="chip ${label[p.status][0]}">${label[p.status][1]}</span></td><td class="small mut">${p.sent_at ? fmtDateTime(p.sent_at) : '—'}</td><td class="r">${p.shifts ? `<button class="btn sm" data-prev="${p.person_id}">Preview</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No crew yet.</td></tr>'}</tbody></table></div></section>`;
  const boxes = () => $$('[data-pid]', body).filter(c => c.checked).map(c => c.dataset.pid);
  const upd = () => { const n = boxes().length; $('#send').disabled = !n; $('#send').textContent = `Send to ${n}`; };
  $$('[data-pid]', body).forEach(c => c.onchange = upd);
  $('#selc').onclick = () => { const ids = new Set(sendable.map(p => p.person_id)); $$('[data-pid]', body).forEach(c => { c.checked = ids.has(c.dataset.pid); }); upd(); };
  $('#send').onclick = async () => { const ids = boxes(); if (!confirm(`Email ${plural(ids.length, 'schedule')} now?`)) return;
    try { const res = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/schedules/send`, { method: 'POST', body: { person_ids: ids } }); toast(`${res.queued} queued — they go out over the next few minutes${res.skipped.length ? ` (${res.skipped.length} skipped)` : ''}`); again(); } catch (e) { toast(e.message, true); } };
  body.querySelectorAll('[data-prev]').forEach(b => b.onclick = async () => {
    try { const m = await ctx.api(`/api/events/${encodeURIComponent(ev.id)}/schedules/${b.dataset.prev}/preview`);
      ctx.dialog(m.subject, `<p class="small mut" style="margin-top:0">${esc(m.note)}</p><iframe title="Email preview" sandbox="" style="width:100%;height:60vh;border:1px solid #E4E1DA;border-radius:10px" srcdoc="${esc(m.html)}"></iframe>`); } catch (e) { toast(e.message, true); } });
}
