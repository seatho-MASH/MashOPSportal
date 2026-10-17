// Every 30 minutes: refresh events from the Mash calendar (SharePoint Events).
import { syncCalendar } from '../v2/lib/events.mjs';
export default async () => {
  try { console.log('calendar sync', await syncCalendar()); } catch (e) { console.error('calendar sync failed', e.message); }
};
export const config = { schedule: '*/30 * * * *' };
