// Community planner: the minimum community delegates needed to cover every
// sponsor's 1-2-1 meeting package. Same maths as the current portal:
//   capacity per delegate = min(max per delegate, meeting slots)   (whichever is set)
//   minimum = max(biggest single package, ceil(total meetings / capacity))
import { q, one, tx } from './db.mjs';
import { bad, str } from './http.mjs';
import { audit } from './audit.mjs';
import { resolveEvent } from './events.mjs';
import { countFor, hubspotConfigured } from './hubspot.mjs';
import { randomUUID } from 'node:crypto';

export function compute(state, sponsors, packages, assign, live) {
  const byId = Object.fromEntries(packages.map(p => [p.id, p]));
  const byName = Object.fromEntries(packages.map(p => [String(p.name || '').toLowerCase().trim(), p]));
  const pkgOf = (sp) => byId[assign[sp.id]] || byName[String(sp.tier || '').toLowerCase().trim()] || null;
  const meetings = sponsors.map(sp => (pkgOf(sp) ? +pkgOf(sp).meetings || 0 : 0));
  const demand = meetings.reduce((a, b) => a + b, 0);
  const maxSingle = meetings.length ? Math.max(...meetings) : 0;
  const slots = +state.slots || 0, maxPd = +state.max_per_delegate || 0;
  const cap = maxPd > 0 ? (slots > 0 ? Math.min(maxPd, slots) : maxPd) : slots;
  const byCap = cap > 0 ? Math.ceil(demand / cap) : (demand > 0 ? null : 0);
  const required = byCap == null ? null : Math.max(maxSingle, byCap);
  const have = state.delegate_override != null ? state.delegate_override : live;
  const logged = sponsors.some(s => s.meetings_delivered != null);
  const delivered = logged ? sponsors.reduce((n, s) => n + (+s.meetings_delivered || 0), 0) : null;
  return { demand, maxSingle, slots, maxPd, cap, required, have, live, sponsors: sponsors.length, delivered, pkgOf };
}

async function ensure(ev) {
  let st = await one('select * from community_event where event_id=$1', [ev.id]);
  if (!st) {
    const def = (await one("select value from setting where key='community_default_packages'"))?.value || [];
    const stmts = [['insert into community_event (event_id) values ($1) on conflict do nothing', [ev.id]]];
    def.forEach((p, i) => stmts.push(['insert into community_package (id, event_id, name, meetings, sort) values ($1,$2,$3,$4,$5)', [`${ev.id}:${randomUUID().slice(0, 8)}`, ev.id, p.name, +p.meetings || 0, i]]));
    await tx(stmts);
    st = await one('select * from community_event where event_id=$1', [ev.id]);
  }
  return st;
}

export async function getCommunity(eventId) {
  const ev = await resolveEvent(eventId);
  const st = await ensure(ev);
  const packages = await q('select id, name, meetings from community_package where event_id=$1 order by sort, name', [ev.id]);
  const sponsors = await q('select id, company, tier, ledger_ref, meetings_delivered from sponsor where event_id=$1 and removed_at is null order by company', [ev.id]);
  const assign = Object.fromEntries((await q('select sponsor_id, package_id from community_assign where event_id=$1', [ev.id])).map(r => [r.sponsor_id, r.package_id]));
  // A sponsor with no package picks one up from its tier name, as before.
  const auto = [];
  for (const sp of sponsors) {
    if (assign[sp.id]) continue;
    const t = String(sp.tier || '').toLowerCase().trim(); if (!t) continue;
    const m = packages.find(p => p.name.toLowerCase().trim() === t) || packages.find(p => p.name && t.includes(p.name.toLowerCase().trim()));
    if (m) { assign[sp.id] = m.id; auto.push(['insert into community_assign (event_id, sponsor_id, package_id) values ($1,$2,$3) on conflict do nothing', [ev.id, sp.id, m.id]]); }
  }
  if (auto.length) await tx(auto);
  let live = null, liveError = null;
  if (ev.ops_ji && hubspotConfigured()) { try { live = await countFor(ev.ops_ji); } catch (e) { liveError = String(e.message || e); } }
  const c = compute(st, sponsors, packages, assign, live);
  const rows = sponsors.map(sp => ({ ...sp, package_id: assign[sp.id] || null, meetings: c.pkgOf(sp) ? +c.pkgOf(sp).meetings || 0 : 0 }));
  delete c.pkgOf;
  return { event: ev, settings: { slots: st.slots, max_per_delegate: st.max_per_delegate, delegate_override: st.delegate_override }, packages, sponsors: rows, result: c, liveError };
}

export async function putSettings(user, eventId, b) {
  const ev = await resolveEvent(eventId); const st = await ensure(ev);
  const num = (v) => (v === '' || v == null ? null : Math.max(0, parseInt(v, 10) || 0));
  const next = { slots: b.slots !== undefined ? (num(b.slots) ?? 0) : st.slots,
    max_per_delegate: b.max_per_delegate !== undefined ? num(b.max_per_delegate) : st.max_per_delegate,
    delegate_override: b.delegate_override !== undefined ? num(b.delegate_override) : st.delegate_override };
  await q('update community_event set slots=$2, max_per_delegate=$3, delegate_override=$4, updated_at=now() where event_id=$1', [ev.id, next.slots, next.max_per_delegate, next.delegate_override]);
  const L = { slots: 'Meeting slots', max_per_delegate: 'Max meetings / delegate', delegate_override: 'Delegates available (override)' };
  for (const k of Object.keys(L)) if (String(st[k] ?? '') !== String(next[k] ?? '')) await audit(user, ev.id, 'Community', 'changed', L[k], { field: k, from: st[k] ?? '', to: next[k] ?? '' });
  return getCommunity(ev.id);
}
export async function addPackage(user, eventId, b) {
  const ev = await resolveEvent(eventId); await ensure(ev);
  const name = str(b.name, 100); if (!name) throw bad('Package name is required');
  const sort = (await one('select coalesce(max(sort), -1) + 1 as n from community_package where event_id=$1', [ev.id])).n;
  await q('insert into community_package (id, event_id, name, meetings, sort) values ($1,$2,$3,$4,$5)', [`${ev.id}:${randomUUID().slice(0, 8)}`, ev.id, name, Math.max(0, parseInt(b.meetings, 10) || 0), sort]);
  await audit(user, ev.id, 'Community', 'added', `Package ${name} (${parseInt(b.meetings, 10) || 0} meetings)`);
  return getCommunity(ev.id);
}
export async function updatePackage(user, pid, b) {
  const p = await one('select * from community_package where id=$1', [pid]); if (!p) throw bad('That package has gone');
  const name = b.name !== undefined ? (str(b.name, 100) || p.name) : p.name;
  const meetings = b.meetings !== undefined ? Math.max(0, parseInt(b.meetings, 10) || 0) : p.meetings;
  await q('update community_package set name=$2, meetings=$3 where id=$1', [pid, name, meetings]);
  // A renamed package renames the tier of manual sponsors on it, so the Sponsors list stays in step.
  if (name !== p.name) await q(`update sponsor set tier=$2 where ledger_ref is null and id in (select sponsor_id from community_assign where package_id=$1)`, [pid, name]);
  if (name !== p.name) await audit(user, p.event_id, 'Community', 'changed', 'Package ' + p.name, { field: 'name', from: p.name, to: name });
  if (meetings !== p.meetings) await audit(user, p.event_id, 'Community', 'changed', 'Package ' + name, { field: 'meetings', from: p.meetings, to: meetings });
  return getCommunity(p.event_id);
}
export async function removePackage(user, pid) {
  const p = await one('delete from community_package where id=$1 returning *', [pid]); if (!p) throw bad('That package has gone');
  await audit(user, p.event_id, 'Community', 'removed', 'Package ' + p.name);
  return getCommunity(p.event_id);
}
export async function assignPackage(user, eventId, sponsorId, packageId) {
  const ev = await resolveEvent(eventId);
  const sp = await one('select * from sponsor where id=$1 and event_id=$2', [sponsorId, ev.id]); if (!sp) throw bad('Unknown sponsor');
  const pk = packageId ? await one('select * from community_package where id=$1 and event_id=$2', [packageId, ev.id]) : null;
  if (packageId && !pk) throw bad('Unknown package');
  if (pk) await q('insert into community_assign (event_id, sponsor_id, package_id) values ($1,$2,$3) on conflict (event_id, sponsor_id) do update set package_id=excluded.package_id', [ev.id, sp.id, pk.id]);
  else await q('delete from community_assign where event_id=$1 and sponsor_id=$2', [ev.id, sp.id]);
  // Choosing a package also sets a manual sponsor's tier (Ledger tiers are the Ledger's).
  if (!sp.ledger_ref) await q('update sponsor set tier=$2 where id=$1', [sp.id, pk ? pk.name : null]);
  await audit(user, ev.id, 'Community', 'changed', sp.company, { field: 'package', to: pk ? pk.name : '' });
  return getCommunity(ev.id);
}
export async function setDelivered(user, sponsorId, n) {
  const sp = await one('select * from sponsor where id=$1', [sponsorId]); if (!sp) throw bad('Unknown sponsor');
  const v = n === '' || n == null ? null : Math.max(0, Math.round(+n || 0));
  await q('update sponsor set meetings_delivered=$2 where id=$1', [sp.id, v]);
  if (String(sp.meetings_delivered ?? '') !== String(v ?? '')) await audit(user, sp.event_id, 'Fulfilment', 'changed', sp.company, { field: 'delivered', from: sp.meetings_delivered ?? '', to: v ?? '' });
  return { ok: true };
}

// Cover across every event that has sponsors or a plan (Overview tab + the calendar).
export async function cover({ past = false } = {}) {
  const evs = await q(`select e.* from event e where e.ops_enabled and not e.cancelled
                         and (exists (select 1 from sponsor s where s.event_id=e.id and s.removed_at is null) or exists (select 1 from community_event c where c.event_id=e.id))
                       order by e.starts_on`);
  const out = [];
  const queue = [...evs];
  async function worker() {
    while (queue.length) {
      const ev = queue.shift();
      const st = (await one('select * from community_event where event_id=$1', [ev.id])) || { slots: 10, max_per_delegate: null, delegate_override: null };
      const packages = await q('select id, name, meetings from community_package where event_id=$1', [ev.id]);
      const sponsors = await q('select id, company, tier, meetings_delivered from sponsor where event_id=$1 and removed_at is null', [ev.id]);
      const assign = Object.fromEntries((await q('select sponsor_id, package_id from community_assign where event_id=$1', [ev.id])).map(r => [r.sponsor_id, r.package_id]));
      let live = null;
      if (st.delegate_override == null && ev.ops_ji && hubspotConfigured()) { try { live = await countFor(ev.ops_ji); } catch { live = null; } }
      const c = compute(st, sponsors, packages, assign, live);
      out.push({ id: ev.id, name: ev.name, short_name: ev.short_name, portfolio: ev.portfolio, starts_on: ev.starts_on,
        sponsors: c.sponsors, demand: c.demand, required: c.required, count: c.have, delivered: c.delivered });
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
  for (const r of out) r.starts_on = iso(r.starts_on);
  return { events: out.filter(r => past || r.starts_on >= todayIso).sort((a, b) => past ? b.starts_on.localeCompare(a.starts_on) : a.starts_on.localeCompare(b.starts_on)) };
}
