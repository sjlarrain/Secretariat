import { getAllAccounts, getSettings } from '../integrations/token-store';
import { getTodayEvents } from '../integrations/google/calendar';
import { getUpcomingUclaItems } from '../integrations/local/ucla';
import { formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';
import { whitelistedNumbers } from '../env';

const UCLA_LOOKAHEAD_HOURS = 48;

export async function fireMorningDigest(): Promise<void> {
  const settings = await getSettings();
  if (!settings.morningDigest.enabled) return;

  const calAccounts = (await getAllAccounts()).filter((a) => a.type === 'calendar');
  const allEvents = (
    await Promise.all(calAccounts.map((acc) => getTodayEvents(acc, settings.timezone)))
  ).flat();

  allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

  const tz = settings.timezone;
  const today = new Date();
  const lines = [
    `Good morning ☀️ Here's your schedule for today:\n`,
    `📅 *${formatDate(today, true, tz)}*\n`,
  ];

  if (allEvents.length === 0) {
    lines.push('No events scheduled today.');
  } else {
    for (const event of allEvents) {
      const alias = calAccounts.length > 1 ? ` _(${event.calendarAlias})_` : '';
      lines.push(`${formatTime(event.start, tz)} — ${event.title}${alias}`);
    }
  }

  const { upcoming, overdue } = await getUpcomingUclaItems(UCLA_LOOKAHEAD_HOURS, today);

  if (overdue.length > 0) {
    lines.push('\n🎓 *UCLA — overdue:*');
    for (const item of overdue) {
      const due = new Date(item.dueDate!);
      lines.push(`• ${item.text} _(was due ${formatDate(due, true, tz)} at ${formatTime(due, tz)})_`);
    }
  }

  if (upcoming.length > 0) {
    lines.push(`\n🎓 *UCLA — due in the next ${UCLA_LOOKAHEAD_HOURS}h:*`);
    for (const item of upcoming) {
      const due = new Date(item.dueDate!);
      lines.push(`• ${item.text} _(${formatDate(due, true, tz)} at ${formatTime(due, tz)})_`);
    }
  }

  const owner = whitelistedNumbers[0];
  if (owner) {
    await sendMessage(owner, lines.join('\n'));
  }
}
