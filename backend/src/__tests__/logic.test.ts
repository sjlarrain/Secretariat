import { describe, it, expect } from 'vitest';

// ─── Pure logic extracted from myschedule.handler.ts ─────────────────────────
// These functions have no external dependencies; copied here so we can test
// them without pulling in env/Redis/Google imports.

interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  calendarAlias: string;
  isAllDay: boolean;
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

// ─── Pure logic extracted from work.ts ───────────────────────────────────────

interface WorkItem {
  id: number;
  text: string;
  createdAt: string;
  doneAt?: string;
  reminderFor?: string;
  qstashMessageId?: string;
}

function getActiveItems(all: WorkItem[]): WorkItem[] {
  return all.filter((w) => !w.doneAt);
}

function getDoneItems(all: WorkItem[]): WorkItem[] {
  return all.filter((w) => !!w.doneAt);
}

function nextId(all: WorkItem[]): number {
  return all.length ? Math.max(...all.map((w) => w.id)) + 1 : 1;
}

// ─── dedup() ─────────────────────────────────────────────────────────────────

function makeEvent(title: string, start: Date, end: Date, alias = 'main', allDay = false): CalendarEvent {
  return { title, start, end, calendarAlias: alias, isAllDay: allDay };
}

describe('dedup()', () => {
  const t = (h: number) => new Date(2026, 4, 15, h, 0, 0);

  it('returns single event unchanged', () => {
    const events = [makeEvent('Lunch', t(12), t(13))];
    expect(dedup(events)).toHaveLength(1);
  });

  it('removes exact duplicate (same title + same start)', () => {
    const events = [
      makeEvent('Lunch', t(12), t(13), 'cal-a'),
      makeEvent('Lunch', t(12), t(13), 'cal-b'), // duplicate from another calendar
    ];
    expect(dedup(events)).toHaveLength(1);
  });

  it('keeps events with same title but different start times', () => {
    const events = [
      makeEvent('Standup', t(9), t(10)),
      makeEvent('Standup', t(14), t(15)), // different start — not a dup
    ];
    expect(dedup(events)).toHaveLength(2);
  });

  it('keeps events with same start but different titles', () => {
    const events = [
      makeEvent('Lunch', t(12), t(13)),
      makeEvent('Meeting', t(12), t(13)),
    ];
    expect(dedup(events)).toHaveLength(2);
  });

  it('removes multiple duplicates, retains originals', () => {
    const events = [
      makeEvent('A', t(9), t(10), 'cal-a'),
      makeEvent('A', t(9), t(10), 'cal-b'),
      makeEvent('A', t(9), t(10), 'cal-c'),
      makeEvent('B', t(11), t(12)),
    ];
    const result = dedup(events);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('A');
    expect(result[1].title).toBe('B');
  });

  it('returns empty array for empty input', () => {
    expect(dedup([])).toHaveLength(0);
  });
});

// ─── isBlocked() ─────────────────────────────────────────────────────────────

describe('isBlocked()', () => {
  const buf = 30 * 60_000; // 30 min buffer

  const t = (h: number, m = 0) => new Date(2026, 4, 15, h, m, 0);

  it('event overlapping the slot is blocked', () => {
    const event = makeEvent('Meeting', t(12), t(13));
    expect(isBlocked(event, t(12), t(13), buf)).toBe(true);
  });

  it('event starting inside the slot is blocked', () => {
    const event = makeEvent('Meeting', t(12, 30), t(13, 30));
    expect(isBlocked(event, t(12), t(13), buf)).toBe(true);
  });

  it('event ending inside the slot is blocked', () => {
    const event = makeEvent('Meeting', t(11), t(12, 30));
    expect(isBlocked(event, t(12), t(13), buf)).toBe(true);
  });

  it('event far before slot (outside buffer) is not blocked', () => {
    const event = makeEvent('Meeting', t(9), t(10));
    // Slot at 13:00–14:00. Buffer is 30 min so we need event to end before 12:30.
    // Event ends at 10:00, well before 12:30 → free
    expect(isBlocked(event, t(13), t(14), buf)).toBe(false);
  });

  it('event within buffer window before slot IS blocked', () => {
    // Slot 13:00–14:00, buffer 30min → anything ending after 12:30 blocks
    const event = makeEvent('Meeting', t(11), t(12, 45)); // ends at 12:45, within buffer
    expect(isBlocked(event, t(13), t(14), buf)).toBe(true);
  });

  it('event within buffer window after slot IS blocked', () => {
    // Slot 12:00–13:00, buffer 30min → anything starting before 13:30 blocks
    const event = makeEvent('Meeting', t(13, 15), t(14, 15)); // starts at 13:15, within buffer
    expect(isBlocked(event, t(12), t(13), buf)).toBe(true);
  });

  it('event immediately after buffer is NOT blocked', () => {
    // Slot 12:00–13:00, buffer 30min → event starting at 13:30 is exactly the boundary
    const event = makeEvent('Meeting', t(13, 31), t(14, 31));
    expect(isBlocked(event, t(12), t(13), buf)).toBe(false);
  });

  it('all-day marker (start === end) always blocks', () => {
    const sameTime = t(0);
    const event = makeEvent('Holiday', sameTime, sameTime, 'main', true);
    expect(isBlocked(event, t(12), t(13), buf)).toBe(true);
  });

  it('zero buffer still blocks overlapping event', () => {
    const event = makeEvent('Meeting', t(12), t(13));
    expect(isBlocked(event, t(12), t(13), 0)).toBe(true);
  });
});

// ─── Work item list logic ─────────────────────────────────────────────────────

describe('work item filtering', () => {
  const now = new Date().toISOString();

  const items: WorkItem[] = [
    { id: 1, text: 'Buy groceries', createdAt: now },
    { id: 2, text: 'Write tests', createdAt: now, doneAt: now },
    { id: 3, text: 'Review PR', createdAt: now },
    { id: 4, text: 'Call dentist', createdAt: now, doneAt: now },
  ];

  it('getActiveItems returns only items without doneAt', () => {
    const active = getActiveItems(items);
    expect(active).toHaveLength(2);
    expect(active.map((i) => i.id)).toEqual([1, 3]);
  });

  it('getDoneItems returns only items with doneAt', () => {
    const done = getDoneItems(items);
    expect(done).toHaveLength(2);
    expect(done.map((i) => i.id)).toEqual([2, 4]);
  });

  it('getActiveItems returns all items when none are done', () => {
    const all = [
      { id: 1, text: 'A', createdAt: now },
      { id: 2, text: 'B', createdAt: now },
    ];
    expect(getActiveItems(all)).toHaveLength(2);
  });

  it('getActiveItems returns empty for all-done list', () => {
    const all = [
      { id: 1, text: 'A', createdAt: now, doneAt: now },
    ];
    expect(getActiveItems(all)).toHaveLength(0);
  });
});

describe('work item ID generation', () => {
  const now = new Date().toISOString();

  it('starts at 1 for empty list', () => {
    expect(nextId([])).toBe(1);
  });

  it('returns max id + 1', () => {
    const items = [
      { id: 1, text: 'A', createdAt: now },
      { id: 5, text: 'B', createdAt: now },
      { id: 3, text: 'C', createdAt: now },
    ];
    expect(nextId(items)).toBe(6);
  });

  it('handles single item', () => {
    expect(nextId([{ id: 7, text: 'X', createdAt: now }])).toBe(8);
  });
});
