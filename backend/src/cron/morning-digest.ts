import { getAllAccounts, getSettings } from '../integrations/token-store';
import { getTodayEvents } from '../integrations/google/calendar';
import { formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';
import { whitelistedNumbers } from '../env';

export async function fireMorningDigest(): Promise<void> {
  const settings = getSettings();
  if (!settings.morningDigest.enabled) return;

  const calAccounts = getAllAccounts().filter((a) => a.type === 'calendar');
  const allEvents = (
    await Promise.all(calAccounts.map((acc) => getTodayEvents(acc, settings.timezone)))
  ).flat();

  allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

  const today = new Date();
  const lines = [
    `Good morning ☀️ Here's your schedule for today:\n`,
    `📅 *${formatDate(today, true)}*\n`,
  ];

  if (allEvents.length === 0) {
    lines.push('No events scheduled today.');
  } else {
    for (const event of allEvents) {
      const alias = calAccounts.length > 1 ? ` _(${event.calendarAlias})_` : '';
      lines.push(`${formatTime(event.start)} — ${event.title}${alias}`);
    }
  }

  const owner = whitelistedNumbers[0];
  if (owner) {
    await sendMessage(owner, lines.join('\n'));
  }
}
