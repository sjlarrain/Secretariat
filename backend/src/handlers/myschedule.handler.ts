import { ParsedCommand } from '../parser/command.parser';
import { getAllAccounts } from '../integrations/registry';
import { getEventsForDate } from '../integrations/google/calendar';
import { getSettings } from '../integrations/token-store';
import { parseDate, formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function myscheduleHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;
  const settings = await getSettings();

  const dateInput = flags['for'] || extraArgs.join(' ').trim();
  const targetDate = dateInput ? parseDate(dateInput, settings.timezone) : new Date();

  if (!targetDate) {
    await sendMessage(from, `❌ Could not parse date: "${dateInput}". Try "tomorrow", "next monday", or DD-MM-YYYY.`);
    return;
  }

  const calendarAccounts = (await getAllAccounts()).filter((a) => a.type === 'calendar');

  if (calendarAccounts.length === 0) {
    await sendMessage(from, '❌ No calendar account connected. Visit the admin panel.');
    return;
  }

  try {
    const allEvents = (
      await Promise.all(calendarAccounts.map((acc) => getEventsForDate(acc, targetDate, settings.timezone)))
    ).flat();

    allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

    const isToday = new Date().toDateString() === targetDate.toDateString();
    const label = isToday ? 'Today' : formatDate(targetDate, true);

    if (allEvents.length === 0) {
      await sendMessage(from, `📅 No events scheduled for ${label}.`);
      return;
    }

    const lines = [`📅 *${label} — ${formatDate(targetDate, !isToday)}*\n`];
    for (const event of allEvents) {
      const alias = calendarAccounts.length > 1 ? ` _(${event.calendarAlias})_` : '';
      lines.push(`🕐 ${formatTime(event.start)}  ${event.title}${alias}`);
    }

    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not fetch schedule: ${msg}`);
  }
}
