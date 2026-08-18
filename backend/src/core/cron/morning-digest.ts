import { getAllAccounts, getSettings } from '../integrations/token-store';
import { getTodayEvents } from '../integrations/google/calendar';
import { getUpcomingMbaItems } from '../integrations/local/mba';
import { formatDate, formatTime } from '../../shared/utils/date';
import { sendMessage } from '../../shared/kapso/client';

const MBA_LOOKAHEAD_HOURS = 48;

export async function fireMorningDigest(userId: string): Promise<void> {
  const settings = await getSettings(userId);
  if (!settings.morningDigest.enabled) return;

  const calAccounts = (await getAllAccounts(userId)).filter((a) => a.type === 'calendar');
  const allEvents = (
    await Promise.all(calAccounts.map((acc) => getTodayEvents(userId, acc, settings.timezone)))
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

  const { upcoming, overdue } = await getUpcomingMbaItems(userId, MBA_LOOKAHEAD_HOURS, today);

  if (overdue.length > 0) {
    lines.push('\n🎓 *MBA — overdue:*');
    for (const item of overdue) {
      const due = new Date(item.dueDate!);
      lines.push(`• ${item.text} _(was due ${formatDate(due, true, tz)} at ${formatTime(due, tz)})_`);
    }
  }

  if (upcoming.length > 0) {
    lines.push(`\n🎓 *MBA — due in the next ${MBA_LOOKAHEAD_HOURS}h:*`);
    for (const item of upcoming) {
      const due = new Date(item.dueDate!);
      lines.push(`• ${item.text} _(${formatDate(due, true, tz)} at ${formatTime(due, tz)})_`);
    }
  }

  await sendMessage(userId, lines.join('\n'));
}
