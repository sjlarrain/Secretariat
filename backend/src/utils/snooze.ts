import { combineDateAndTime } from './date';

export type SnoozeOption = '1h' | '1d' | 'monday';

// Returns "HH:MM" for `date` in the given timezone — used to preserve the
// reply's time-of-day when snoozing to a different calendar date.
function timeOfDay(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
}

// Returns the next Monday after `from` (never `from` itself if it is already Monday),
// at `timeStr` in the target timezone.
function nextMonday(from: Date, timezone: string, timeStr: string): Date {
  const dateStr = from.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);
  // Noon UTC on the local date — safe reference point (noon can't cross a day boundary for ±14h timezones)
  const localNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = localNoon.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat (noon UTC = noon local for date purposes)
  const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
  const mondayNoon = new Date(Date.UTC(year, month - 1, day + daysUntilMonday, 12, 0, 0));
  return combineDateAndTime(mondayNoon, timeStr, timezone);
}

// Snooze is always relative to the moment of the reply (`now`), preserving its
// time-of-day rather than snapping to a fixed default time.
export function getSnoozeDate(option: SnoozeOption, timezone = 'America/Santiago'): Date {
  const now = new Date();

  if (option === '1h') {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  if (option === '1d') {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }

  // monday
  return nextMonday(now, timezone, timeOfDay(now, timezone));
}
