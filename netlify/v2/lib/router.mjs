// All /api routes. api.mjs verifies the user first, then calls handle().
import { bad, notFound, json, HttpError } from './http.mjs';
import { requireAdmin } from './auth.mjs';
import * as E from './events.mjs';
import * as R from './rota.mjs';
import * as M from './mail.mjs';
import * as D from './onday.mjs';
import * as T from './tables.mjs';
import * as P from './points.mjs';
import * as S from './sponsors.mjs';
import { eventHome } from './home.mjs';
import * as SC from './scans.mjs';
import * as A from './attendees.mjs';
import * as CM from './community.mjs';
import * as ST from './staff.mjs';
import * as LG from './legacy.mjs';
import * as HS from './hubspot.mjs';

const routes = [];
const on = (method, pattern, fn) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, fn });
};

on('GET', '/api/me', (c) => ({ user: c.user }));
// events
on('GET', '/api/events', (c) => E.listEvents(c.user, c.query.all === '1'));
on('POST', '/api/events/:id', (c) => E.updateEvent(c.user, c.p.id, c.body));
on('POST', '/api/sync/calendar', async (c) => { requireAdmin(c.user); return E.syncCalendar(); });
on('GET', '/api/events/:id/home', (c) => eventHome(c.p.id));
on('GET', '/api/events/:id/history', (c) => E.history(c.p.id));
// rota
on('GET', '/api/events/:id/rota', (c) => R.getRota(c.p.id, c.query.day));
on('POST', '/api/events/:id/theatres', (c) => R.addTheatre(c.user, c.p.id, c.body));
on('PATCH', '/api/theatres/:tid', (c) => R.updateTheatre(c.user, c.p.tid, c.body));
on('DELETE', '/api/theatres/:tid', (c) => R.removeTheatre(c.user, c.p.tid));
on('POST', '/api/events/:id/sessions', (c) => R.addSession(c.user, c.p.id, c.body));
on('POST', '/api/events/:id/sessions/import', (c) => R.importSessions(c.user, c.p.id, c.body.rows));
on('DELETE', '/api/sessions/:sid', (c) => R.removeSession(c.user, c.p.sid));
on('POST', '/api/events/:id/crew', (c) => R.addCrew(c.user, c.p.id, c.body));
on('POST', '/api/events/:id/crew/import', (c) => R.importCrew(c.user, c.p.id, c.body.rows));
on('DELETE', '/api/events/:id/crew/:pid', (c) => R.removeCrew(c.user, c.p.id, c.p.pid));
on('POST', '/api/events/:id/rules', (c) => R.addRule(c.user, c.p.id, c.body));
on('DELETE', '/api/rules/:rid', (c) => R.removeRule(c.user, c.p.rid));
on('PUT', '/api/events/:id/break-rule', (c) => R.putBreakRule(c.user, c.p.id, c.body));
on('POST', '/api/events/:id/assignments', (c) => R.addAssignment(c.user, c.p.id, c.body));
on('DELETE', '/api/assignments/:aid', (c) => R.removeAssignment(c.user, c.p.aid));
on('POST', '/api/events/:id/breaks/propose', (c) => R.proposeBreaks(c.p.id, c.body.day));
on('POST', '/api/events/:id/breaks/accept', (c) => R.acceptBreaks(c.user, c.p.id, c.body.proposals));
// schedules + Grip logins
on('GET', '/api/events/:id/schedules', (c) => R.scheduleStatus(c.p.id));
on('POST', '/api/events/:id/schedules/send', (c) => M.queueSchedules(c.user, c.p.id, c.body.person_ids));
on('GET', '/api/events/:id/schedules/:pid/preview', async (c) => {
  const ev = await E.resolveEvent(c.p.id);
  const person = (await import('./db.mjs')).one;
  const p = await person('select * from person where id=$1', [c.p.pid]); if (!p) throw notFound();
  const s = await R.personSchedule(ev, p.id);
  return { ...M.scheduleEmail(ev, p, s, null), note: 'Preview hides the Grip login; the real email includes it.' };
});
on('PUT', '/api/events/:id/credentials/:pid', (c) => R.putCredential(c.user, c.p.id, c.p.pid, c.body));
on('GET', '/api/events/:id/credentials/:pid', (c) => R.revealCredential(c.user, c.p.id, c.p.pid));
// on the day
on('GET', '/api/events/:id/checkin', (c) => D.checkinList(c.p.id, c.query.day));
on('POST', '/api/events/:id/checkin', (c) => D.recordCheckins(c.user, c.p.id, c.body.items));
on('GET', '/api/kit', (c) => D.kitList(c.query.event));
on('POST', '/api/kit', (c) => D.addKit(c.user, c.body));
on('POST', '/api/kit/:iid/issue', (c) => D.issueKit(c.user, c.p.iid, c.body));
on('POST', '/api/kit/:iid/return', (c) => D.returnKit(c.user, c.p.iid));
// tables
on('GET', '/api/events/:id/tables', (c) => T.getTables(c.p.id));
on('POST', '/api/events/:id/tables', (c) => T.addTables(c.user, c.p.id, c.body));
on('PATCH', '/api/tables/:tid', (c) => T.updateTable(c.user, c.p.tid, c.body));
on('DELETE', '/api/tables/:tid', (c) => T.removeTable(c.user, c.p.tid));
on('POST', '/api/events/:id/guests', (c) => T.addGuests(c.user, c.p.id, c.body.rows || [c.body]));
on('PATCH', '/api/guests/:gid', (c) => T.updateGuest(c.user, c.p.gid, c.body));
on('DELETE', '/api/guests/:gid', (c) => T.removeGuest(c.user, c.p.gid));
on('POST', '/api/events/:id/seating', (c) => T.seat(c.user, c.p.id, c.body));
on('POST', '/api/events/:id/seating/auto', (c) => T.autoSeat(c.user, c.p.id));
// sponsors
on('GET', '/api/events/:id/sponsors', (c) => S.listSponsors(c.p.id));
on('POST', '/api/events/:id/sponsors', (c) => S.addManualSponsor(c.user, c.p.id, c.body));
on('POST', '/api/events/:id/sponsors/sync', (c) => S.syncLedgerSponsors(c.p.id));
on('DELETE', '/api/sponsors/:sid', (c) => S.removeSponsor(c.user, c.p.sid));
// leaderboards
on('GET', '/api/programmes', () => P.programmes());
on('GET', '/api/programmes/:pg/:season', (c) => P.leaderboard(c.p.pg, c.p.season));
on('GET', '/api/programmes/:pg/:season/people/:pid', (c) => P.memberEntries(c.p.pg, c.p.season, c.p.pid));
on('POST', '/api/programmes/:pg/:season/entries', (c) => P.awardPoints(c.user, c.p.pg, c.p.season, c.body));
on('POST', '/api/programmes/:pg/:season/import', (c) => { requireAdmin(c.user); return P.importBalances(c.user, c.p.pg, c.p.season, c.body.rows); });
on('PUT', '/api/programmes/:pg/:season/rules', (c) => { requireAdmin(c.user); return P.putRules(c.user, c.p.pg, c.p.season, c.body.rules); });
on('DELETE', '/api/points/:eid', (c) => P.removeEntry(c.user, c.p.eid));

// scan check
on('GET', '/api/events/:id/scans', (c) => SC.scanCheck(c.p.id));
on('POST', '/api/events/:id/scans/hubspot', (c) => SC.pullHubspot(c.user, c.p.id));
on('POST', '/api/events/:id/scans/upload', (c) => SC.uploadSource(c.user, c.p.id, c.body.source, c.body.rows, c.body.filename, c.body.append || null));
on('GET', '/api/events/:id/scans/badges', (c) => SC.badgeValues(c.p.id));
on('PUT', '/api/events/:id/scans/badges', (c) => SC.putBadgeMap(c.user, c.p.id, c.body.map));
on('PUT', '/api/events/:id/scans/settings', (c) => SC.putSettings(c.user, c.p.id, c.body));
on('POST', '/api/events/:id/scans/ack', (c) => SC.ack(c.user, c.p.id, c.body));
on('GET', '/api/events/:id/scans/fix/:target/:kind', (c) => SC.fixFile(c.p.id, c.p.target, c.p.kind));
on('PUT', '/api/scan-templates/:source', (c) => SC.putTemplate(c.user, c.p.source, c.body));
on('DELETE', '/api/scan-templates/:source', (c) => SC.removeTemplate(c.user, c.p.source, c.query.event));

// attendees (moved over from the current portal)
on('GET', '/api/events/:id/counts', (c) => A.tabCounts(c.p.id));
on('GET', '/api/events/:id/delegates', (c) => A.delegates(c.p.id, { fresh: c.query.fresh === '1' }));
on('GET', '/api/events/:id/people/:kind', (c) => A.listKind(c.p.id, c.p.kind));
on('POST', '/api/events/:id/people/:kind', (c) => A.addPeople(c.user, c.p.id, c.p.kind, c.body.rows || c.body, { sponsorId: c.body.sponsor_id }));
on('PATCH', '/api/people/:pid', (c) => A.updatePerson(c.user, c.p.pid, c.body));
on('DELETE', '/api/people/:pid', (c) => A.removePerson(c.user, c.p.pid));
on('PUT', '/api/events/:id/rooms', (c) => A.setRoom(c.user, c.p.id, c.body.key, !!c.body.on));
on('PUT', '/api/events/:id/delegate-notes/:cid', (c) => A.setDelegateNote(c.user, c.p.id, c.p.cid, c.body.note));
on('GET', '/api/events/:id/everyone', (c) => A.everyone(c.p.id));
on('PATCH', '/api/sponsors/:sid', (c) => S.updateSponsor(c.user, c.p.sid, c.body));
// staff
on('GET', '/api/staff-roster', (c) => ST.roster({ fresh: c.query.fresh === '1' }));
on('PUT', '/api/events/:id/staff/:rid', (c) => ST.setAttending(c.user, c.p.id, c.p.rid, !!c.body.on));
on('GET', '/api/events/:id/onsite', (c) => ST.getOnsite(c.p.id));
on('PUT', '/api/events/:id/onsite', (c) => ST.putOnsite(c.user, c.p.id, c.body));
on('GET', '/api/events/:id/nearest-station', (c) => ST.nearestStation(c.p.id));
on('POST', '/api/events/:id/briefing', (c) => ST.queueBriefing(c.user, c.p.id, c.body.ids));
// community
on('GET', '/api/events/:id/community', (c) => CM.getCommunity(c.p.id));
on('PUT', '/api/events/:id/community', (c) => CM.putSettings(c.user, c.p.id, c.body));
on('POST', '/api/events/:id/community/packages', (c) => CM.addPackage(c.user, c.p.id, c.body));
on('PATCH', '/api/community/packages/:pid', (c) => CM.updatePackage(c.user, c.p.pid, c.body));
on('DELETE', '/api/community/packages/:pid', (c) => CM.removePackage(c.user, c.p.pid));
on('PUT', '/api/events/:id/community/assign/:sid', (c) => CM.assignPackage(c.user, c.p.id, c.p.sid, c.body.package_id || null));
on('PUT', '/api/sponsors/:sid/delivered', (c) => CM.setDelivered(c.user, c.p.sid, c.body.delivered));
on('GET', '/api/community-cover', (c) => CM.cover({ past: c.query.past === '1' }));
// admin
on('GET', '/api/admin/ji-options', async () => { try { return { options: await HS.jiOptions() }; } catch (e) { return { options: null, error: String(e.message || e) }; } });
on('POST', '/api/admin/ji-check', async (c) => ({ total: await HS.countFor(String(c.body.ji || '').trim() || (() => { throw bad('Pick a value first'); })()) }));
on('GET', '/api/admin/import', () => LG.lastImport());
on('POST', '/api/admin/import', (c) => LG.importLegacy(c.user));
on('GET', '/api/admin/roster', (c) => { requireAdmin(c.user); return ST.rosterEmails(); });
on('POST', '/api/admin/roster', (c) => ST.addRosterEmail(c.user, c.body.email));
on('DELETE', '/api/admin/roster/:email', (c) => ST.removeRosterEmail(c.user, c.p.email));

export async function handle(req, user) {
  const url = new URL(req.url);
  // Served at /api/v2/* alongside the current portal's /api/* functions.
  const path = url.pathname.replace(/^\/\.netlify\/functions\/v2-api/, '/api').replace(/^\/api\/v2(?=\/)/, '/api');
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(path); if (!m) continue;
      const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const t = await req.text();
        if (t) { try { body = JSON.parse(t); } catch { throw bad('Invalid JSON'); } }
      }
      return json(await r.fn({ user, p, body, query: Object.fromEntries(url.searchParams) }));
    }
    return json({ error: 'No such endpoint: ' + req.method + ' ' + path }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    const msg = String(e.message || e);
    if (/violates foreign key|invalid input syntax for type uuid/.test(msg)) return json({ error: 'That item no longer exists — refresh and try again.' }, 400);
    console.error(req.method, path, e);
    return json({ error: 'Something went wrong on the server: ' + msg.slice(0, 200) }, 500);
  }
}
