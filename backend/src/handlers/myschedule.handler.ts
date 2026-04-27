import { ParsedCommand } from '../parser/command.parser';
import { getAllAccounts } from '../integrations/registry';
import { getTodayEvents } from '../integrations/google/calendar';
import { getSettings } from '../integrations/token-store';
import { formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function myscheduleHandler(_parsed: ParsedCommand, from: string): Promise<void> {
  const settings = getSettings();
  const calendarAccounts = getAllAccounts().filter((a) => a.type === 'calendar');

  if (calendarAccounts.length === 0) {
    await sendMessage(from, '❌ No calendar account connected. Visit the admin panel.');
    return;
  }

  try {
    const allEvents = (
      await Promise.all(calendarAccounts.map((acc) => getTodayEvents(acc, settings.timezone)))
    ).flat();

    allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

    if (allEvents.length === 0) {
      await sendMessage(from, '📅 No events scheduled for today.');
      return;
    }

    const today = new Date();
    const lines = [`📅 *Today — ${formatDate(today, true)}:*\n`];
    for (const event of allEvents) {
      const alias = calendarAccounts.length > 1 ? ` _(${event.calendarAlias})_` : '';
      lines.push(`${formatTime(event.start)} — ${event.title}${alias}`);
    }

    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not fetch schedule: ${msg}`);
  }
}
