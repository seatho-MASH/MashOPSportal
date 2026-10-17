// 100 leaderboards: points are entries, so every total can show what it's for.
import { esc, $, $$, fmtDate, parseCSV, toCSV, download, toast } from '../util.js';

let pg = null, season = null, who = null;

export async function render(el, ctx) {
  const meta = await ctx.api('/api/programmes');
  pg = pg || meta.programmes[0].id;
  const seasons = [...new Set([meta.current, ...meta.seasons.filter(s => s.programme_id === pg).map(s => s.season)])].sort().reverse();
  season = season && seasons.includes(season) ? season : meta.current;
  const lb = await ctx.api(`/api/programmes/${pg}/${season}`);
  if (who && !lb.rows.some(r => r.person_id === who)) who = null;
  who = who || (lb.rows[0] && lb.rows[0].person_id);
  const detail = who ? await ctx.api(`/api/programmes/${pg}/${season}/people/${who}`) : null;
  const admin = ctx.S.me.admin;
  const mv = (m) => m > 0 ? `<span class="good-t small">▲${m}</span>` : m < 0 ? `<span class="bad-t small">▼${-m}</span>` : '<span class="mut small">–</span>';
  el.innerHTML = `<div class="wrap">
    <header class="pagehead"><div><div class="sub" style="margin:0">Programmes</div><h1>100 leaderboards</h1></div>
      <div class="pills" style="gap:8px"><label class="sr" for="se">Season</label><select class="input" id="se" style="width:auto">${seasons.map(s => `<option${s === season ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <button class="btn" id="rules">Scoring rules</button><button class="btn" id="exp">Export</button>${admin ? '<button class="btn" id="imp">Import opening balances</button>' : ''}<button class="btn pri" id="award">+ Award points</button></div></header>
    <div class="pills" role="group" aria-label="Programme">${meta.programmes.map(p => `<button class="${p.id === pg ? 'on' : ''}" data-pg="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    <div class="row2">
      <section class="card" style="flex:3 1 540px;min-width:0;padding:0" aria-label="Leaderboard"><div class="scroll-x"><table class="t"><thead><tr><th style="width:80px">Rank</th><th>Member</th><th>Company</th><th class="r">Points</th><th class="r">This month</th><th class="r">Entries</th></tr></thead><tbody>
        ${lb.rows.map(r => `<tr class="click${r.person_id === who ? ' sel' : ''}" data-who="${r.person_id}" tabindex="0"><td class="num"><b>${r.rankLabel}</b> ${mv(r.move)}</td><td><b>${esc(r.name)}</b></td><td class="mut">${esc(r.organisation || '')}</td><td class="r num"><b>${r.points}</b></td><td class="r num good-t">${r.month_points ? '+' + r.month_points : '0'}</td><td class="r num mut">${r.entries}</td></tr>`).join('') || '<tr><td colspan="6" class="empty"><b>No points this season yet</b>Award points, or import the opening balances from the Google Sheet.</td></tr>'}
      </tbody></table></div></section>
      ${detail ? `<aside class="card" style="flex:2 1 340px;min-width:0" aria-labelledby="who">
        <div style="display:flex;justify-content:space-between;gap:12px"><div><h2 id="who" style="font-size:20px">${esc(detail.person.name)}</h2><div class="small mut">${esc([detail.person.job_title, detail.person.organisation].filter(Boolean).join(' · '))}</div></div>
          <div style="text-align:right"><div class="num" style="font-size:30px;font-weight:800;line-height:1">${detail.total}</div><div class="small mut">points</div></div></div>
        <div class="pills" style="margin:14px 0 4px;gap:6px">${Object.entries(detail.byActivity).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<span class="chip brand">${esc(a)} ${n}</span>`).join('')}</div>
        <h3 class="small mut" style="margin:14px 0 4px;letter-spacing:.06em;text-transform:uppercase">What the points are for</h3>
        <div class="list">${detail.entries.map(e => `<div class="item" style="align-items:flex-start"><b class="num good-t" style="min-width:44px">${e.points >= 0 ? '+' : ''}${e.points}</b><div class="grow"><div style="font-weight:700">${esc(e.activity)}${e.event_name ? ' · ' + esc(e.event_name) : ''}</div><div class="small mut">${fmtDate(e.on_date)} · ${e.source === 'import' ? 'imported' : 'awarded by ' + esc(e.awarded_by.split('@')[0])}${e.note ? ' · ' + esc(e.note) : ''}</div></div><button class="btn sm ghost" data-del="${e.id}" aria-label="Remove entry">✕</button></div>`).join('')}</div></aside>` : ''}
    </div></div>`;
  const again = () => render(el, ctx);
  $$('[data-pg]', el).forEach(b => b.onclick = () => { pg = b.dataset.pg; who = null; again(); });
  $('#se', el).onchange = (e) => { season = e.target.value; who = null; again(); };
  $$('[data-who]', el).forEach(r => { r.onclick = () => { who = r.dataset.who; again(); }; r.onkeydown = (e) => { if (e.key === 'Enter') r.click(); }; });
  $$('[data-del]', el).forEach(b => b.onclick = async () => { if (!confirm('Remove this entry? The points come off their total.')) return; try { await ctx.api(`/api/points/${b.dataset.del}`, { method: 'DELETE' }); again(); } catch (e) { toast(e.message, true); } });
  $('#exp', el).onclick = () => download(`${pg}-${season}-leaderboard.csv`, toCSV(lb.rows, [{ label: 'Rank', key: 'rankLabel' }, { label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Company', key: 'organisation' }, { label: 'Points', key: 'points' }, { label: 'Entries', key: 'entries' }]));
  $('#rules', el).onclick = () => ctx.dialog(`Scoring rules · ${season}`, `${lb.rules.length ? lb.rules.map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #EEECE6"><span>${esc(r.activity)}</span><b>${r.points}</b></div>`).join('') : '<p class="mut">No rules set for this season yet.</p>'}
    ${admin ? `<p class="small mut">One rule per line: activity, points</p><textarea class="input" id="rt" aria-label="Rules">${lb.rules.map(r => `${r.activity}, ${r.points}`).join('\n')}</textarea><div class="actions"><button class="btn pri" id="rs">Save rules</button></div>` : ''}`, (d) => {
    const b = d.querySelector('#rs'); if (b) b.onclick = async () => { const rules = d.querySelector('#rt').value.split('\n').map(l => { const i = l.lastIndexOf(','); return { activity: l.slice(0, i).trim(), points: l.slice(i + 1).trim() }; }).filter(r => r.activity);
      try { await ctx.api(`/api/programmes/${pg}/${season}/rules`, { method: 'PUT', body: { rules } }); ctx.closeDialog(); toast('Rules saved'); again(); } catch (e) { toast(e.message, true); } };
  });
  $('#award', el).onclick = () => ctx.dialog('Award points', `<form id="f" class="form">
      <div class="field" style="grid-column:1/-1"><label for="m">Member</label><select class="input" id="m"><option value="">Someone new…</option>${lb.rows.map(r => `<option value="${r.person_id}"${r.person_id === who ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field nw"><label for="em">Email</label><input class="input" id="em" type="email"></div><div class="field nw"><label for="fn">First name</label><input class="input" id="fn"></div>
      <div class="field nw"><label for="ln">Last name</label><input class="input" id="ln"></div><div class="field nw"><label for="co">Company</label><input class="input" id="co"></div>
      <div class="field" style="grid-column:1/-1"><label for="a">For</label><input class="input" id="a" list="acts" required><datalist id="acts">${lb.rules.map(r => `<option value="${esc(r.activity)}">${r.points} pts</option>`).join('')}</datalist></div>
      <div class="field"><label for="p">Points</label><input class="input" id="p" type="number" placeholder="from the rule"></div><div class="field"><label for="dt">Date</label><input class="input" id="dt" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field" style="grid-column:1/-1"><label for="no">Note</label><input class="input" id="no" placeholder="e.g. referred Jo Bloggs"></div>
      <div class="actions" style="grid-column:1/-1"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">Award</button></div></form>`, (d) => {
    const f = d.querySelector('#f');
    const tog = () => d.querySelectorAll('.nw').forEach(x => { x.style.display = f.m.value ? 'none' : ''; }); f.m.onchange = tog; tog();
    f.onsubmit = async (e) => { e.preventDefault();
      const body = { activity: f.a.value, points: f.p.value, on_date: f.dt.value, note: f.no.value, ...(f.m.value ? { person_id: f.m.value } : { email: f.em.value, first_name: f.fn.value, last_name: f.ln.value, organisation: f.co.value }) };
      try { const r = await ctx.api(`/api/programmes/${pg}/${season}/entries`, { method: 'POST', body }); who = r.entry.person_id; ctx.closeDialog(); toast('Points awarded'); again(); } catch (err) { toast(err.message, true); } };
  });
  const imp = $('#imp', el); if (imp) imp.onclick = () => ctx.dialog('Import opening balances', `<p class="small mut" style="margin-top:0">Paste the current Google Sheet (CSV). Each member gets one "opening balance" entry for their total — the sheet has no breakdown. Needs columns: email, points (or a score column), and optionally first_name, last_name, company_name.</p>
    <textarea class="input" id="csv" aria-label="CSV"></textarea><div class="actions"><button class="btn pri" id="go">Import into ${esc(season)}</button></div>`, (d) => {
    d.querySelector('#go').onclick = async () => {
      const rows = parseCSV(d.querySelector('#csv').value).map(r => { const k = Object.keys(r).find(x => /score|points/.test(x)); return { email: r.email, first_name: r.first_name, last_name: r.last_name, organisation: r.company_name || r.company, job_title: r.job_title, points: r.points ?? (k ? r[k] : '') }; });
      if (!rows.length) return toast('Paste a CSV with a header row first', true);
      try { const r = await ctx.api(`/api/programmes/${pg}/${season}/import`, { method: 'POST', body: { rows } }); ctx.closeDialog(); toast(`${r.imported} imported${r.errors.length ? `, ${r.errors.length} skipped (${r.errors[0]})` : ''}`, !!r.errors.length); again(); } catch (e) { toast(e.message, true); } };
  });
}
