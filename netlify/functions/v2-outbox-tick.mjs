// Every minute: send up to 20 queued emails (Exchange allows ~30/min per mailbox).
import { drainOutbox } from '../v2/lib/mail.mjs';
export default async () => {
  try { const r = await drainOutbox(20); if (r.tried) console.log('outbox', r); } catch (e) { console.error('outbox failed', e.message); }
};
export const config = { schedule: '* * * * *' };
