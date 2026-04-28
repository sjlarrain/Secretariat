import { getAllAccounts, getSettings } from '../integrations/token-store';
import { getWeekEvents, CalendarEvent } from '../integrations/google/calendar';
import { getPendingTasks } from '../integrations/google/tasks';
import { formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';
import { whitelistedNumbers } from '../env';

export async function fireWeeklySummary(): Promise<void> {
  const settings = await getSettings();
  if (!settings.weeklySummary.enabled) return;

  const allAccounts = await getAllAccounts();
  const calAccounts = allAccounts.filter((a) => a.type === 'calendar');
  const taskAccounts = allAccounts.filter((a) => a.type === 'tasks');

  const allEvents = (
    await Promise.all(calAccounts.map((acc) => getWeekEvents(acc, settings.timezone)))
  ).flat();
  allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

  const allTasks = taskAccounts.length > 0 ? await getPendingTasks(taskAccounts[0]) : [];

  const lines = ['📋 *Your week ahead:*\n'];

  // Group events by day
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of allEvents) {
    const key = formatDate(event.start, true);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(event);
  }

  if (byDay.size === 0) {
    lines.push('No events this week.\n');
  } else {
    for (const [day, events] of byDay) {
      lines.push(`*${day}*`);
      for (const event of events) {
        lines.push(`  ${formatTime(event.start)} — ${event.title}`);
      }
      lines.push('');
    }
  }

  if (allTasks.length > 0) {
    lines.push('📌 *Pending tasks:*');
    for (const task of allTasks) {
      const due = task.dueDate ? ` — due ${formatDate(task.dueDate)}` : '';
      lines.push(`• ${task.title}${due}`);
    }
  }

  const owner = whitelistedNumbers[0];
  if (owner) {
    await sendMessage(owner, lines.join('\n'));
  }
}
