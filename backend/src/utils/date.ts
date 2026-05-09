import * as chrono from 'chrono-node';

// Parses DD-MM-YYYY or natural language dates into a Date object
export function parseDate(input: string, timezone: string = 'America/Santiago'): Date | null {
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

// Combines a date and HH:MM time string into a Date, interpreting the time in the given timezone
export function combineDateAndTime(date: Date, timeStr: string, timezone = 'America/Santiago'): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  // Get the calendar date in the target timezone (YYYY-MM-DD)
  const dateInTz = date.toLocaleDateString('en-CA', { timeZone: timezone });
  // Build a UTC probe as if the desired wall-clock time were UTC
  const probe = new Date(`${dateInTz}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`);
  // Find how many ms the timezone is offset from UTC at that instant
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(probe);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const tzMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  const offsetMs = tzMs - probe.getTime(); // negative for zones behind UTC
  return new Date(probe.getTime() - offsetMs);
}

// Formats a Date for WhatsApp display (e.g. "22 Apr" or "Tue 22 Apr")
export function formatDate(date: Date, includeDay = false, timezone = 'America/Santiago'): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: timezone };
  if (includeDay) opts.weekday = 'short';
  return date.toLocaleDateString('en-GB', opts);
}

export function formatTime(date: Date, timezone = 'America/Santiago'): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
}

// Returns the Monday of the ISO week containing `date`
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Returns Date objects for the given weekday indices (1=Mon..6=Sat) in the week starting at `monday`
export function getWeekDates(monday: Date, days: number[]): Date[] {
  return days.map((d) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + (d - 1)); // 1=Mon → offset 0, 2=Tue → offset 1, etc.
    return date;
  });
}
