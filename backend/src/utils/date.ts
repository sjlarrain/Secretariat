import * as chrono from 'chrono-node';

// Parses DD-MM-YYYY or natural language dates into a Date object
export function parseDate(input: string, timezone: string = 'America/Santiago'): Date | null {
  const trimmed = input.trim();

  // Strict DD-MM-YYYY
  const strictMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (strictMatch) {
    const [, dd, mm, yyyy] = strictMatch;
    const iso = `${yyyy}-${mm}-${dd}`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
    return null;
  }

  // Natural language via chrono-node
  const ref = new Date();
  const parsed = chrono.parseDate(trimmed, { instant: ref, timezone });
  return parsed ?? null;
}

// Combines a date and HH:MM time string into a Date
export function combineDateAndTime(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
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
