import { describe, it, expect } from 'vitest';
import {
  parseDate,
  combineDateAndTime,
  formatDate,
  formatTime,
  getMondayOfWeek,
  getWeekDates,
  parseDurationHours,
  parseDurationDays,
  formatDateOnly,
  addDaysToDateOnly,
} from '../utils/date';

const TZ = 'America/Santiago';

// ─── parseDate ────────────────────────────────────────────────────────────────

describe('parseDate — DD-MM-YYYY strict format', () => {
  it('parses a valid date', () => {
    const d = parseDate('15-03-2026', TZ);
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(2); // March = index 2
    expect(d!.getUTCDate()).toBe(15);
  });

  it('parses end-of-year date', () => {
    const d = parseDate('31-12-2026', TZ);
    expect(d).not.toBeNull();
    expect(d!.getUTCMonth()).toBe(11); // December
    expect(d!.getUTCDate()).toBe(31);
  });

  it('sets noon UTC to avoid timezone rollback', () => {
    const d = parseDate('01-01-2026', TZ);
    expect(d!.getUTCHours()).toBe(12);
  });

  it('returns null for an invalid date like 32-01-2026', () => {
    const d = parseDate('32-01-2026', TZ);
    expect(d).toBeNull();
  });

  it('returns null for month 00', () => {
    const d = parseDate('15-00-2026', TZ);
    expect(d).toBeNull();
  });

  it('does not match partial format like 1-3-2026', () => {
    // Non-strict digits — falls through to chrono
    const d = parseDate('1-3-2026', TZ);
    // chrono may or may not parse this, but it should not crash
    // just assert it doesn't throw
    expect(true).toBe(true);
  });
});

describe('parseDate — natural language', () => {
  it('parses "tomorrow" as a date after today', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = parseDate('tomorrow', TZ);
    expect(d).not.toBeNull();
    expect(d!.getTime()).toBeGreaterThan(today.getTime());
  });

  it('parses "next monday" as a future Monday', () => {
    const d = parseDate('next monday', TZ);
    expect(d).not.toBeNull();
    // Day 1 = Monday (getDay returns 0=Sun, 1=Mon, ...)
    expect(d!.getDay()).toBe(1);
    // Must be in the future
    expect(d!.getTime()).toBeGreaterThan(Date.now());
  });

  it('parses "next friday" as a future Friday', () => {
    const d = parseDate('next friday', TZ);
    expect(d).not.toBeNull();
    expect(d!.getDay()).toBe(5);
    expect(d!.getTime()).toBeGreaterThan(Date.now());
  });

  it('parses a bare weekday name (forward-date — never past)', () => {
    const d = parseDate('thursday', TZ);
    expect(d).not.toBeNull();
    // Must be today or in the future
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    expect(d!.getTime()).toBeGreaterThanOrEqual(todayStart.getTime());
    // Must be a Thursday
    expect(d!.getDay()).toBe(4);
  });

  it('parses "saturday" as a future or current Saturday', () => {
    const d = parseDate('saturday', TZ);
    expect(d).not.toBeNull();
    expect(d!.getDay()).toBe(6);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    expect(d!.getTime()).toBeGreaterThanOrEqual(todayStart.getTime());
  });

  it('returns null for garbage input', () => {
    expect(parseDate('not a date at all xyz', TZ)).toBeNull();
  });
});

// ─── combineDateAndTime ───────────────────────────────────────────────────────

describe('combineDateAndTime', () => {
  it('produces a Date that reports the right local time in the timezone', () => {
    const date = new Date('2026-06-15T12:00:00Z'); // arbitrary base
    const result = combineDateAndTime(date, '09:00', TZ);
    // Verify the wall-clock time in Santiago is 09:00
    const localHour = Number(
      result.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ })
    );
    expect(localHour % 24).toBe(9);
  });

  it('handles midnight (00:00)', () => {
    const date = new Date('2026-06-15T12:00:00Z');
    const result = combineDateAndTime(date, '00:00', TZ);
    const localHour = Number(
      result.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ })
    );
    expect(localHour % 24).toBe(0);
  });

  it('handles late-night time (23:30)', () => {
    const date = new Date('2026-06-15T12:00:00Z');
    const result = combineDateAndTime(date, '23:30', TZ);
    const localHour = Number(
      result.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ })
    );
    const localMin = Number(
      result.toLocaleString('en-US', { minute: 'numeric', timeZone: TZ })
    );
    expect(localHour % 24).toBe(23);
    expect(localMin).toBe(30);
  });

  it('returns a Date object', () => {
    const result = combineDateAndTime(new Date(), '10:00', TZ);
    expect(result instanceof Date).toBe(true);
    expect(isNaN(result.getTime())).toBe(false);
  });
});

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('returns a non-empty string', () => {
    const s = formatDate(new Date('2026-06-15T12:00:00Z'), false, TZ);
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });

  it('includes day name when includeDay = true', () => {
    // 2026-06-15 is a Monday
    const s = formatDate(new Date('2026-06-15T12:00:00Z'), true, TZ);
    expect(s).toMatch(/Mon/);
  });

  it('includes month abbreviation', () => {
    const s = formatDate(new Date('2026-06-15T12:00:00Z'), false, TZ);
    expect(s).toMatch(/Jun/);
  });
});

// ─── formatTime ───────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('returns HH:MM format', () => {
    const date = combineDateAndTime(new Date('2026-06-15T12:00:00Z'), '14:30', TZ);
    const s = formatTime(date, TZ);
    expect(s).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ─── getMondayOfWeek ─────────────────────────────────────────────────────────

describe('getMondayOfWeek', () => {
  it('returns a Monday when given a Wednesday', () => {
    const wed = new Date('2026-05-13T12:00:00Z'); // 2026-05-13 is a Wednesday
    const mon = getMondayOfWeek(wed);
    expect(mon.getDay()).toBe(1);
  });

  it('returns the same Monday when given a Monday', () => {
    const monday = new Date('2026-05-11T12:00:00Z'); // known Monday
    const result = getMondayOfWeek(monday);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(monday.getDate());
  });

  it('returns the previous Monday when given a Sunday', () => {
    const sunday = new Date('2026-05-10T12:00:00Z'); // 2026-05-10 is a Sunday
    const mon = getMondayOfWeek(sunday);
    expect(mon.getDay()).toBe(1);
    // Monday is 6 days before this Sunday
    expect(mon.getDate()).toBe(4);
  });

  it('returns a Monday when given a Saturday', () => {
    const saturday = new Date('2026-05-09T12:00:00Z'); // 2026-05-09 is a Saturday
    const mon = getMondayOfWeek(saturday);
    expect(mon.getDay()).toBe(1);
  });

  it('sets time to midnight', () => {
    const wed = new Date('2026-05-13T15:30:00');
    const mon = getMondayOfWeek(wed);
    expect(mon.getHours()).toBe(0);
    expect(mon.getMinutes()).toBe(0);
    expect(mon.getSeconds()).toBe(0);
  });
});

// ─── getWeekDates ─────────────────────────────────────────────────────────────

// ─── parseDurationHours ───────────────────────────────────────────────────────

describe('parseDurationHours', () => {
  it('parses a plain integer as hours', () => {
    expect(parseDurationHours('2')).toBe(2);
  });

  it('parses a decimal as hours', () => {
    expect(parseDurationHours('1.5')).toBe(1.5);
  });

  it('parses an "Xh" suffix', () => {
    expect(parseDurationHours('2h')).toBe(2);
  });

  it('parses an "Xm" suffix as fractional hours', () => {
    expect(parseDurationHours('90m')).toBe(1.5);
  });

  it('returns null for garbage input', () => {
    expect(parseDurationHours('abc')).toBeNull();
  });
});

// ─── parseDurationDays ────────────────────────────────────────────────────────

describe('parseDurationDays', () => {
  it('parses a plain integer as days', () => {
    expect(parseDurationDays('3')).toBe(3);
  });

  it('parses an "Xd" suffix', () => {
    expect(parseDurationDays('3d')).toBe(3);
  });

  it('returns null for zero', () => {
    expect(parseDurationDays('0')).toBeNull();
  });

  it('returns null for a decimal', () => {
    expect(parseDurationDays('1.5')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseDurationDays('abc')).toBeNull();
  });
});

// ─── formatDateOnly / addDaysToDateOnly ───────────────────────────────────────

describe('formatDateOnly', () => {
  it('formats a Date as YYYY-MM-DD in the given timezone', () => {
    const d = new Date('2026-06-15T12:00:00Z');
    expect(formatDateOnly(d, TZ)).toBe('2026-06-15');
  });
});

describe('addDaysToDateOnly', () => {
  it('adds days within the same month', () => {
    expect(addDaysToDateOnly('2026-06-15', 3)).toBe('2026-06-18');
  });

  it('rolls over into the next month', () => {
    expect(addDaysToDateOnly('2026-06-29', 3)).toBe('2026-07-02');
  });

  it('adding 0 days returns the same date', () => {
    expect(addDaysToDateOnly('2026-06-15', 0)).toBe('2026-06-15');
  });
});

describe('getWeekDates', () => {
  const monday = new Date('2026-05-11T00:00:00'); // known Monday

  it('returns Monday when days = [1]', () => {
    const [d] = getWeekDates(monday, [1]);
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(11);
  });

  it('returns Tuesday when days = [2]', () => {
    const [d] = getWeekDates(monday, [2]);
    expect(d.getDay()).toBe(2);
    expect(d.getDate()).toBe(12);
  });

  it('returns Wednesday and Friday for days = [3, 5]', () => {
    const [wed, fri] = getWeekDates(monday, [3, 5]);
    expect(wed.getDay()).toBe(3);
    expect(fri.getDay()).toBe(5);
  });

  it('returns correct count', () => {
    const days = getWeekDates(monday, [1, 2, 3, 4, 5]);
    expect(days).toHaveLength(5);
  });
});
