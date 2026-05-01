import { ParsedCommand } from '../parser/command.parser';
import { getAllAccounts } from '../integrations/registry';
import { getEventsForDate, CalendarEvent } from '../integrations/google/calendar';
import { getSettings } from '../integrations/token-store';
import { getPlans, findPlanByName, PlanType } from '../integrations/local/plans';
import { parseDate, formatDate, formatTime, getMondayOfWeek, getWeekDates, combineDateAndTime } from '../utils/date';
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

  // ── Availability mode ──────────────────────────────
  if (flags['plan'] !== undefined) {
    const plans = await getPlans();
    const plan = findPlanByName(flags['plan'], plans);

    if (!plan) {
      const names = plans.map((p) => p.name).join(', ');
      await sendMessage(from, `❌ Unknown plan type "${flags['plan']}". Available: ${names}`);
      return;
    }

    await checkAvailability(from, plan, targetDate, calendarAccounts, settings.timezone);
    return;
  }

  // ── Regular mode ───────────────────────────────────
  try {
    const tz = settings.timezone;
    const allEvents = (
      await Promise.all(calendarAccounts.map((acc) => getEventsForDate(acc, targetDate, tz)))
    ).flat();

    allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

    const isToday = new Date().toDateString() === targetDate.toDateString();
    const label = isToday ? 'Today' : formatDate(targetDate, true, tz);

    if (allEvents.length === 0) {
      await sendMessage(from, `📅 No events scheduled for ${label}.`);
      return;
    }

    const lines = [`📅 *${label} — ${formatDate(targetDate, !isToday, tz)}*\n`];
    for (const event of allEvents) {
      const alias = calendarAccounts.length > 1 ? ` _(${event.calendarAlias})_` : '';
      lines.push(`🕐 ${formatTime(event.start, tz)}  ${event.title}${alias}`);
    }

    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not fetch schedule: ${msg}`);
  }
}

async function checkAvailability(
  from: string,
  plan: PlanType,
  referenceDate: Date,
  calendarAccounts: Awaited<ReturnType<typeof getAllAccounts>>,
  tz: string,
): Promise<void> {
  const monday = getMondayOfWeek(referenceDate);
  const days = getWeekDates(monday, plan.days);

  // Fetch events for all days in parallel, across all accounts
  const eventsByDay = await Promise.all(
    days.map(async (day) => {
      const events = (
        await Promise.all(calendarAccounts.map((acc) => getEventsForDate(acc, day, tz).catch(() => [])))
      ).flat();
      return { day, events };
    })
  );

  const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekLabel = formatDate(monday, false, tz);
  const lines: string[] = [`🗓 *${plan.name} — week of ${weekLabel}*\n`];

  let totalFreeSlots = 0;
  let daysWithSlots = 0;

  for (const { day, events } of eventsByDay) {
    const dayLabel = `${DAYS_SHORT[day.getDay()]} ${formatDate(day, false, tz)}`;
    const freeSlots: string[] = [];

    for (const slot of plan.slots) {
      const slotStart = combineDateAndTime(day, slot, tz);
      const slotEnd = new Date(slotStart.getTime() + plan.durationMinutes * 60_000);

      const blocked = events.some((e) => isBlocked(e, slotStart, slotEnd));
      if (!blocked) freeSlots.push(slot);
    }

    if (freeSlots.length > 0) {
      lines.push(`✅ ${dayLabel}  ${freeSlots.join(' · ')}`);
      totalFreeSlots += freeSlots.length;
      daysWithSlots++;
    } else {
      lines.push(`❌ ${dayLabel}  fully booked`);
    }
  }

  if (totalFreeSlots === 0) {
    await sendMessage(from, `No free ${plan.name} slots this week.`);
    return;
  }

  lines.push(`\n${daysWithSlots} day${daysWithSlots !== 1 ? 's' : ''} with open slots.`);
  await sendMessage(from, lines.join('\n'));
}

function isBlocked(event: CalendarEvent, slotStart: Date, slotEnd: Date): boolean {
  // All-day event: start/end will be midnight; if start equals end (date-only), block whole day
  const eventStart = event.start.getTime();
  const eventEnd = event.end.getTime();

  if (eventStart === eventEnd) return true; // all-day marker

  return eventStart < slotEnd.getTime() && eventEnd > slotStart.getTime();
}
