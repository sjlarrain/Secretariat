import { ParsedCommand } from '../parser/command.parser';
import { resolveAccount } from '../integrations/registry';
import { createEvent } from '../integrations/google/calendar';
import { Ctx } from '../ctx';
import {
  parseDate,
  combineDateAndTime,
  formatDate,
  formatTime,
  parseDurationHours,
  parseDurationDays,
  formatDateOnly,
  addDaysToDateOnly,
} from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function scheduleHandler(parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const from = ctx.userId;
  const { flags, extraArgs } = parsed;
  const timezone = ctx.timezone;

  const title = flags['title'] || extraArgs.join(' ').trim();
  if (!title) {
    await sendMessage(from, '❌ Missing title. Use --title or write it right after /schedule.');
    return;
  }

  const alias = flags['using'];
  const account = await resolveAccount(ctx.userId, 'calendar', alias);

  if (!account) {
    await sendMessage(from, '❌ No calendar account connected. Visit the admin panel.');
    return;
  }

  const date = parseDate(flags['for'], timezone);
  if (!date) {
    await sendMessage(from, `❌ Could not parse date: "${flags['for']}". Use DD-MM-YYYY or "tomorrow".`);
    return;
  }

  const attendees: string[] = [];
  if (flags['invite']) attendees.push(...flags['invite'].split(',').map((e) => e.trim()));

  // --video/-v is value-less: the parser sets it to '' when present, so only an
  // undefined value means the flag was omitted.
  const withMeetLink = flags['video'] !== undefined;

  const isAllDay = flags['at'].toLowerCase() === 'day';

  try {
    if (isAllDay) {
      const durationDays = flags['duration'] !== undefined ? parseDurationDays(flags['duration']) : 1;
      if (durationDays === null) {
        await sendMessage(from, `❌ Could not parse duration: "${flags['duration']}". Use a whole number of days (e.g. 3).`);
        return;
      }

      const startDate = formatDateOnly(date, timezone);
      const endDate = addDaysToDateOnly(startDate, durationDays); // Google's end.date is exclusive

      const { meetLink } = await createEvent(ctx.userId, account, {
        title,
        allDay: true,
        startDate,
        endDate,
        attendees,
        notes: flags['notes'],
        timezone,
        withMeetLink,
      });

      const lastDay = new Date(`${addDaysToDateOnly(startDate, durationDays - 1)}T12:00:00Z`);
      const dateLabel =
        durationDays === 1
          ? formatDate(date, false, timezone)
          : `${formatDate(date, false, timezone)} – ${formatDate(lastDay, false, timezone)}`;

      const lines = ['✅ *Event scheduled*', `📌 ${title}`, `📅 ${dateLabel} (all day)`];
      if (withMeetLink) {
        lines.push(meetLink ? `🎥 ${meetLink}` : '⚠️ Google did not return a Meet link for this event.');
      }
      await sendMessage(from, lines.join('\n'));
      return;
    }

    const durationHours = flags['duration'] !== undefined ? parseDurationHours(flags['duration']) : 1;
    if (durationHours === null) {
      await sendMessage(from, `❌ Could not parse duration: "${flags['duration']}". Use hours (e.g. 2 or 1.5).`);
      return;
    }

    const startDatetime = combineDateAndTime(date, flags['at'], timezone);
    const endDatetime = new Date(startDatetime.getTime() + durationHours * 60 * 60 * 1000);

    const { meetLink } = await createEvent(ctx.userId, account, {
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
