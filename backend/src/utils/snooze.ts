import { combineDateAndTime } from './date';

export type SnoozeOption = '1h' | '1d' | 'monday';

// Returns the next Monday after `from` (never `from` itself if it is already Monday)
// Uses the target timezone to determine the local calendar date and day of week.
function nextMonday(from: Date, timezone: string): Date {
  const dateStr = from.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);
  // Noon UTC on the local date — safe reference point (noon can't cross a day boundary for ±14h timezones)
  const localNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = localNoon.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat (noon UTC = noon local for date purposes)
  const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
  const mondayNoon = new Date(Date.UTC(year, month - 1, day + daysUntilMonday, 12, 0, 0));
  return combineDateAndTime(mondayNoon, '09:00', timezone);
}

export function getSnoozeDate(option: SnoozeOption, defaultTime = '09:00', timezone = 'America/Santiago'): Date {
  const now = new Date();

  if (option === '1h') {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  // Get today's calendar date in the user's timezone to avoid day-boundary issues
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);

  if (option === '1d') {
    const noon = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
    return combineDateAndTime(noon, defaultTime, timezone);
  }

  // monday
  return nextMonday(now, timezone);
}
