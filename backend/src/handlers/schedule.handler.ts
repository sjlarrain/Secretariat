import { ParsedCommand } from '../parser/command.parser';
import { resolveAccount } from '../integrations/registry';
import { createEvent } from '../integrations/google/calendar';
import { getSettings } from '../integrations/token-store';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function scheduleHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;
  const settings = await getSettings();
  const timezone = settings.timezone;

  const title = flags['title'] || extraArgs.join(' ').trim();
  if (!title) {
    await sendMessage(from, '❌ Missing title. Use --title or write it right after /schedule.');
    return;
  }

  const alias = flags['using'];
  const account = await resolveAccount('calendar', alias);

  if (!account) {
    await sendMessage(from, '❌ No calendar account connected. Visit the admin panel.');
    return;
  }

  const date = parseDate(flags['for'], timezone);
  if (!date) {
    await sendMessage(from, `❌ Could not parse date: "${flags['for']}". Use DD-MM-YYYY or "tomorrow".`);
    return;
  }

  const startDatetime = combineDateAndTime(date, flags['at'], timezone);
  const endDatetime = new Date(startDatetime.getTime() + 60 * 60 * 1000);

  const attendees: string[] = [];
  if (flags['invite']) attendees.push(...flags['invite'].split(',').map((e) => e.trim()));

  // --video/-v is value-less: the parser sets it to '' when present, so only an
  // undefined value means the flag was omitted.
  const withMeetLink = flags['video'] !== undefined;

  try {
    const { meetLink } = await createEvent(account, {
      title,
      startDatetime,
      endDatetime,
      attendees,
      notes: flags['notes'],
      timezone,
      withMeetLink,
    });

    const lines = [
      '✅ *Event scheduled*',
      `📌 ${title}`,
      `📅 ${formatDate(startDatetime, false, timezone)} at ${formatTime(startDatetime, timezone)}`,
    ];
    if (withMeetLink) {
      lines.push(meetLink ? `🎥 ${meetLink}` : '⚠️ Google did not return a Meet link for this event.');
    }
    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not create event: ${msg}`);
  }
}
