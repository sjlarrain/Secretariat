import { ParsedCommand } from '../parser/command.parser';
import { getAllAccounts } from '../integrations/registry';
import { getEventsForDate, CalendarEvent } from '../integrations/google/calendar';
import { CalendarDisconnectedError } from '../integrations/google/oauth';
import { getSettings } from '../integrations/token-store';
import { getPlans, findPlanByName, PlanType } from '../integrations/local/plans';
import { parseDate, formatDate, formatTime, getMondayOfWeek, getWeekDates, combineDateAndTime } from '../utils/date';
import { sendMessage } from '../kapso/client';

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function myscheduleHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;
  const settings = await getSettings();

  // ── Plan list mode: /myschedule --plan (no value) ─────
  if (flags['plan'] === '') {
    const plans = await getPlans();
    if (plans.length === 0) {
      await sendMessage(from, '❌ No plans configured. Visit the admin panel to create one.');
      return;
    }
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const lines = ['📋 *Available plans:*\n'];
    for (const p of plans) {
      const days = p.days.map((d) => dayNames[d]).join(', ');
      const slots = p.slots.join(' · ');
      const buffer = (p.bufferMinutes ?? 0) > 0 ? ` | ±${p.bufferMinutes}min buffer` : '';
      lines.push(`• *${p.name}* — ${p.durationMinutes}min${buffer} | ${days} | ${slots}`);
    }
    await sendMessage(from, lines.join('\n'));
    return;
  }

  const calendarAccounts = (await getAllAccounts()).filter((a) => a.type === 'calendar');

  if (calendarAccounts.length === 0) {
    await sendMessage(from, '❌ No calendar account connected. Visit the admin panel.');
    return;
  }

  // ── Week view mode: /myschedule week ──────────────
  if (extraArgs[0]?.toLowerCase() === 'week') {
    await showWeekSchedule(from, new Date(), calendarAccounts, settings.timezone);
    return;
  }

  const dateInput = flags['for'] || extraArgs.join(' ').trim();
  const targetDate = dateInput ? parseDate(dateInput, settings.timezone) : new Date();

  if (!targetDate) {
    await sendMessage(from, `❌ Could not parse date: "${dateInput}". Try "tomorrow", "next monday", or DD-MM-YYYY.`);
    return;
  }

  // ── Availability mode ──────────────────────────────
  if (flags['plan'] !== undefined) {
    const plans = await getPlans();
    const plan = findPlanByName(flags['plan'], plans);

    if (!plan) {
      const names = plans.map((p) => p.name).join(', ');
      await sendMessage(from, `❌ Unknown plan "${flags['plan']}". Available: ${names}`);
      return;
    }

    if (flags['for']) {
      await checkDayAvailability(from, plan, targetDate, calendarAccounts, settings.timezone);
    } else {
      await checkWeekAvailability(from, plan, targetDate, calendarAccounts, settings.timezone);
    }
    return;
  }

  // ── Regular mode ───────────────────────────────────
  try {
    const tz = settings.timezone;
    const { events: allEvents, disconnected } = await fetchEventsForDate(calendarAccounts, targetDate, tz);
    if (disconnected.length > 0) {
      await sendMessage(from, disconnected.map((a) => `⚠️ Calendar *${a}* is disconnected. Reconnect via admin panel.`).join('\n'));
    }

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
      const prefix = event.isAllDay ? '📌' : `🕐 ${formatTime(event.start, tz)} `;
      lines.push(`${prefix} ${event.title}${alias}`);
    }

    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not fetch schedule: ${msg}`);
  }
}

async function fetchEventsForDate(
  accounts: Awaited<ReturnType<typeof getAllAccounts>>,
  date: Date,
  tz: string,
): Promise<{ events: CalendarEvent[]; disconnected: string[] }> {
  const disconnected: string[] = [];
  const results = await Promise.all(
    accounts.map(async (acc) => {
      try {
        return await getEventsForDate(acc, date, tz);
      } catch (err) {
        if (err instanceof CalendarDisconnectedError) {
          disconnected.push(acc.alias);
          return [];
        }
        throw err;
      }
    })
  );
  return { events: dedup(results.flat()), disconnected };
}

async function showWeekSchedule(
  from: string,
  referenceDate: Date,
  calendarAccounts: Awaited<ReturnType<typeof getAllAccounts>>,
  tz: string,
): Promise<void> {
  const monday = getMondayOfWeek(referenceDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const eventsByDay = await Promise.all(
    weekDays.map(async (day) => {
      const { events } = await fetchEventsForDate(calendarAccounts, day, tz);
      events.sort((a, b) => a.start.getTime() - b.start.getTime());
      return { day, events };
    })
  );

  const weekLabel = formatDate(monday, true, tz);
  const lines: string[] = [`📅 *Week of ${weekLabel}*\n`];
  const multiAccount = calendarAccounts.length > 1;

  for (const { day, events } of eventsByDay) {
    const dayLabel = formatDate(day, true, tz);
    lines.push(`*${dayLabel}*`);
    if (events.length === 0) {
      lines.push('  No events');
    } else {
      for (const event of events) {
        const alias = multiAccount ? ` _(${event.calendarAlias})_` : '';
        const prefix = event.isAllDay ? '  📌' : `  🕐 ${formatTime(event.start, tz)} `;
        lines.push(`${prefix} ${event.title}${alias}`);
      }
    }
    lines.push('');
  }

  await sendMessage(from, lines.join('\n').trimEnd());
}

async function checkDayAvailability(
  from: string,
  plan: PlanType,
  date: Date,
  calendarAccounts: Awaited<ReturnType<typeof getAllAccounts>>,
  tz: string,
): Promise<void> {
  const { events } = await fetchEventsForDate(calendarAccounts, date, tz);

  const dayLabel = `${DAYS_SHORT[date.getDay()]} ${formatDate(date, false, tz)}`;
  const freeSlots: string[] = [];
  const bufferMs = (plan.bufferMinutes ?? 30) * 60_000;

  for (const slot of plan.slots) {
    const slotStart = combineDateAndTime(date, slot, tz);
    const slotEnd = new Date(slotStart.getTime() + plan.durationMinutes * 60_000);
    if (!events.some((e) => isBlocked(e, slotStart, slotEnd, bufferMs))) freeSlots.push(slot);
  }

  if (freeSlots.length === 0) {
    await sendMessage(from, `❌ *${plan.name} — ${dayLabel}*\n\nNo free slots that day.`);
  } else {
    await sendMessage(from, `✅ *${plan.name} — ${dayLabel}*\n\nFree: ${freeSlots.join(' · ')}`);
  }
}

async function checkWeekAvailability(
  from: string,
  plan: PlanType,
  referenceDate: Date,
  calendarAccounts: Awaited<ReturnType<typeof getAllAccounts>>,
  tz: string,
): Promise<void> {
  const monday = getMondayOfWeek(referenceDate);
  const days = getWeekDates(monday, plan.days);

  const eventsByDay = await Promise.all(
    days.map(async (day) => {
      const { events } = await fetchEventsForDate(calendarAccounts, day, tz);
      return { day, events };
    })
  );

  const weekLabel = formatDate(monday, false, tz);
  const lines: string[] = [`🗓 *${plan.name} — week of ${weekLabel}*\n`];
  const bufferMs = (plan.bufferMinutes ?? 30) * 60_000;

  let totalFreeSlots = 0;
  let daysWithSlots = 0;

  for (const { day, events } of eventsByDay) {
    const dayLabel = `${DAYS_SHORT[day.getDay()]} ${formatDate(day, false, tz)}`;
    const freeSlots: string[] = [];

    for (const slot of plan.slots) {
      const slotStart = combineDateAndTime(day, slot, tz);
      const slotEnd = new Date(slotStart.getTime() + plan.durationMinutes * 60_000);
      if (!events.some((e) => isBlocked(e, slotStart, slotEnd, bufferMs))) freeSlots.push(slot);
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

function dedup(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.title}|${e.start.toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isBlocked(event: CalendarEvent, slotStart: Date, slotEnd: Date, bufferMs: number): boolean {
  const eventStart = event.start.getTime();
  const eventEnd = event.end.getTime();
  if (eventStart === eventEnd) return true; // all-day marker
  return eventStart < slotEnd.getTime() + bufferMs && eventEnd > slotStart.getTime() - bufferMs;
}
