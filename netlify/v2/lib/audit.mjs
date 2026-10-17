import { q } from './db.mjs';
export async function audit(user, eventId, area, action, item, detail = null) {
  try {
    await q('insert into audit_log (actor, event_id, area, action, item, detail) values ($1,$2,$3,$4,$5,$6)',
      [user.email, eventId || null, area, action, String(item).slice(0, 300), detail ? JSON.stringify(detail) : null]);
  } catch (e) { console.error('audit failed', e.message); }   // the log must never break the change
}
