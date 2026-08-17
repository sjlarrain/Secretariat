import * as chrono from 'chrono-node';

// Parses DD-MM-YYYY or natural language dates into a Date object
export function parseDate(input: string, timezone: string): Date | null {
  const trimmed = input.trim();

  // Strict DD-MM-YYYY
  const strictMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (strictMatch) {
    const [, dd, mm, yyyy] = strictMatch;
    // Use noon UTC so the local date is correct in any timezone (avoids UTC-midnight rollback)
    const d = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
    if (!isNaN(d.getTime())) return d;
    return null;
  }

  // Natural language via chrono-node — forwardDate ensures "thursday" means next/current Thu
  const ref = new Date();
  const parsed = chrono.parseDate(trimmed, { instant: ref, timezone }, { forwardDate: true });
  return parsed ?? null;
}

/**
 * Milliseconds to add to a UTC instant to get the wall-clock time in
 * `timezone` expressed as if it were UTC (i.e. `instant.getTime() + offsetMs`
 * gives a Date whose UTC fields equal that instant's local fields in `timezone`).
 * Negative for zones behind UTC. Shared by every function below that needs to
 * reason about a specific timezone's wall-clock date/time — never approximate
 * this with the server's own local time (`new Date()` + `setHours()`), which
 * is wrong for any user not in the server's timezone.
 */
function zonedOffsetMs(instantUtc: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instantUtc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const tzMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return tzMs - instantUtc.getTime();
}

// Combines a date and HH:MM time string into a Date, interpreting the time in the given timezone
export function combineDateAndTime(date: Date, timeStr: string, timezone: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  // Get the calendar date in the target timezone (YYYY-MM-DD)
  const dateInTz = date.toLocaleDateString('en-CA', { timeZone: timezone });
  // Build a UTC probe as if the desired wall-clock time were UTC
  const probe = new Date(`${dateInTz}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`);
  return new Date(probe.getTime() - zonedOffsetMs(probe, timezone));
}

/** The first instant (00:00:00.000) of `date`'s calendar day in `timezone`. */
export function startOfDayInZone(date: Date, timezone: string): Date {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: timezone });
  const probe = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(probe.getTime() - zonedOffsetMs(probe, timezone));
}

/** The last instant (23:59:59.999) of `date`'s calendar day in `timezone`. */
export function endOfDayInZone(date: Date, timezone: string): Date {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: timezone });
  const probe = new Date(`${dateStr}T23:59:59.999Z`);
  return new Date(probe.getTime() - zonedOffsetMs(probe, timezone));
}

// Formats a Date for WhatsApp display (e.g. "22 Apr" or "Tue 22 Apr")
export function formatDate(date: Date, includeDay = false, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: timezone };
  if (includeDay) opts.weekday = 'short';
  return date.toLocaleDateString('en-GB', opts);
}

export function formatTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
}

// Returns the Monday of the ISO week containing `date`, as the first instant
// of that calendar day *in `timezone`* — not the server's local time.
export function getMondayOfWeek(date: Date, timezone: string): Date {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD in that zone
  const [y, m, d] = dateStr.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon avoids DST-boundary day-shift
  const day = noonUtc.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  const mondayNoon = new Date(Date.UTC(y, m - 1, d + diff, 12, 0, 0));
  return startOfDayInZone(mondayNoon, timezone);
}

// Returns Date objects for the given weekday indices (1=Mon..6=Sat) in the week starting at `monday`
export function getWeekDates(monday: Date, days: number[]): Date[] {
  return days.map((d) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + (d - 1)); // 1=Mon → offset 0, 2=Tue → offset 1, etc.
    return date;
  });
}

// Parses a --duration value for a timed event, in hours. Accepts a plain
// number ("2", "1.5") or an explicit "Xh"/"Xm" suffix ("90m", "2h").
export function parseDurationHours(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const hMatch = trimmed.match(/^(\d+(?:\.\d+)?)h$/);
  if (hMatch) return Number(hMatch[1]);
  const mMatch = trimmed.match(/^(\d+(?:\.\d+)?)m$/);
  if (mMatch) return Number(mMatch[1]) / 60;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return null;
}

// Parses a --duration value for an @day all-day event, in whole days.
// Accepts "3" or "3d". Returns null if unparseable or not a positive integer.
export function parseDurationDays(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/d$/, '');
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n > 0 ? n : null;
}

// Formats a Date as YYYY-MM-DD in the given timezone, for Google Calendar's
// all-day event date fields (which carry no timezone of their own).
export function formatDateOnly(date: Date, timezone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

// Adds N days to a YYYY-MM-DD string via calendar arithmetic (no timezone
// conversion — the string already represents a wall-clock calendar date).
export function addDaysToDateOnly(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * The wall-clock date, hour, and weekday of `instant` in `timezone` — the
 * per-user "what time is it right now" the hourly sweeper (platform/sweeper.ts)
 * needs to decide what's due. `weekday` is 0=Sun..6=Sat, matching the
 * convention `Settings.morningDigest.days` / `.weeklySummary.day` already use.
 * Never approximate this with the server's own local time.
 */
export function getZonedParts(instant: Date, timezone: string): { dateStr: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour') % 24; // hour12:false can render midnight as "24"
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { dateStr, hour, weekday };
}
