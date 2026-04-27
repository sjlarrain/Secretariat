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
export function formatDate(date: Date, includeDay = false): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (includeDay) opts.weekday = 'short';
  return date.toLocaleDateString('en-GB', opts);
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}
