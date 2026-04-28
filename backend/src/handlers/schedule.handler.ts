import { ParsedCommand } from '../parser/command.parser';
import { resolveAccount } from '../integrations/registry';
import { createEvent } from '../integrations/google/calendar';
import { getSettings } from '../integrations/token-store';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function scheduleHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;
  const settings = getSettings();
  const timezone = settings.timezone;

  const alias = flags['using'];
  const account = resolveAccount('calendar', alias);

  if (!account) {
    await sendMessage(from, '❌ No calendar account connected. Visit the admin panel.');
    return;
  }

  const date = parseDate(flags['for'], timezone);
  if (!date) {
    await sendMessage(from, `❌ Could not parse date: "${flags['for']}". Use DD-MM-YYYY or "tomorrow".`);
    return;
  }

  const startDatetime = combineDateAndTime(date, flags['at']);
  const endDatetime = new Date(startDatetime.getTime() + 60 * 60 * 1000);

  const attendees: string[] = [];
  if (flags['invite']) attendees.push(...flags['invite'].split(',').map((e) => e.trim()));
  if (extraArgs[0]?.includes('@')) attendees.push(extraArgs[0].trim());

  try {
    await createEvent(account, {
      title: flags['title'],
      startDatetime,
      endDatetime,
      attendees,
      notes: flags['notes'],
      timezone,
    });

    await sendMessage(
      from,
      `✅ *Event scheduled*\n📌 ${flags['title']}\n📅 ${formatDate(startDatetime)} at ${formatTime(startDatetime)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not create event: ${msg}`);
  }
}
