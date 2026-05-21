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

// ─── Local task logic ─────────────────────────────────────────────────────────

interface LocalTask {
  id: number;
  title: string;
  project?: string;
  dueDate?: string;
  dueTime?: string;
  status: 'open' | 'done';
  createdAt: string;
  doneAt?: string;
  qstashMessageId?: string;
}

function getOpenTasks(all: LocalTask[]): LocalTask[] {
  return all.filter((t) => t.status === 'open');
}

function getDoneTasks(all: LocalTask[]): LocalTask[] {
  return all.filter((t) => t.status === 'done');
}

function nextTaskId(all: LocalTask[]): number {
  return all.length ? Math.max(...all.map((t) => t.id)) + 1 : 1;
}

function groupByProject(tasks: LocalTask[]): Map<string, LocalTask[]> {
  const map = new Map<string, LocalTask[]>();
  for (const t of tasks) {
    const key = t.project ?? 'General';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return map;
}

describe('local task filtering', () => {
  const now = new Date().toISOString();

  const tasks: LocalTask[] = [
    { id: 1, title: 'Buy milk', status: 'open', createdAt: now },
    { id: 2, title: 'Call dentist', status: 'done', createdAt: now, doneAt: now },
    { id: 3, title: 'Submit report', status: 'open', createdAt: now, project: 'work' },
    { id: 4, title: 'Pay rent', status: 'done', createdAt: now, doneAt: now, project: 'finance' },
  ];

  it('getOpenTasks returns only open tasks', () => {
    const open = getOpenTasks(tasks);
    expect(open).toHaveLength(2);
    expect(open.map((t) => t.id)).toEqual([1, 3]);
  });

  it('getDoneTasks returns only done tasks', () => {
    const done = getDoneTasks(tasks);
    expect(done).toHaveLength(2);
    expect(done.map((t) => t.id)).toEqual([2, 4]);
  });

  it('getOpenTasks returns all when none are done', () => {
    const all: LocalTask[] = [
      { id: 1, title: 'A', status: 'open', createdAt: now },
      { id: 2, title: 'B', status: 'open', createdAt: now },
    ];
    expect(getOpenTasks(all)).toHaveLength(2);
  });

  it('getOpenTasks returns empty when all are done', () => {
    const all: LocalTask[] = [
      { id: 1, title: 'A', status: 'done', createdAt: now, doneAt: now },
    ];
    expect(getOpenTasks(all)).toHaveLength(0);
  });
});

describe('local task ID generation', () => {
  const now = new Date().toISOString();

  it('starts at 1 for an empty list', () => {
    expect(nextTaskId([])).toBe(1);
  });

  it('returns max id + 1', () => {
    const tasks: LocalTask[] = [
      { id: 1, title: 'A', status: 'open', createdAt: now },
      { id: 5, title: 'B', status: 'open', createdAt: now },
      { id: 3, title: 'C', status: 'open', createdAt: now },
    ];
    expect(nextTaskId(tasks)).toBe(6);
  });

  it('handles a single item', () => {
    const tasks: LocalTask[] = [{ id: 7, title: 'X', status: 'open', createdAt: now }];
    expect(nextTaskId(tasks)).toBe(8);
  });
});

describe('local task groupByProject()', () => {
  const now = new Date().toISOString();

  it('groups tasks into correct project buckets', () => {
    const tasks: LocalTask[] = [
      { id: 1, title: 'Buy milk', status: 'open', createdAt: now, project: 'groceries' },
      { id: 2, title: 'Submit report', status: 'open', createdAt: now, project: 'work' },
      { id: 3, title: 'Buy bread', status: 'open', createdAt: now, project: 'groceries' },
    ];
    const grouped = groupByProject(tasks);
    expect(grouped.get('groceries')?.map((t) => t.id)).toEqual([1, 3]);
    expect(grouped.get('work')?.map((t) => t.id)).toEqual([2]);
  });

  it('tasks with no project go to "General"', () => {
    const tasks: LocalTask[] = [
      { id: 1, title: 'No project', status: 'open', createdAt: now },
    ];
    const grouped = groupByProject(tasks);
    expect(grouped.has('General')).toBe(true);
    expect(grouped.get('General')?.length).toBe(1);
  });

  it('returns empty map for empty input', () => {
    expect(groupByProject([])).toHaveLength(0);
  });

  it('preserves insertion order within a project', () => {
    const tasks: LocalTask[] = [
      { id: 10, title: 'First', status: 'open', createdAt: now, project: 'p' },
      { id: 11, title: 'Second', status: 'open', createdAt: now, project: 'p' },
      { id: 12, title: 'Third', status: 'open', createdAt: now, project: 'p' },
    ];
    const grouped = groupByProject(tasks);
    expect(grouped.get('p')?.map((t) => t.id)).toEqual([10, 11, 12]);
  });
});

// ─── Snooze date logic ────────────────────────────────────────────────────────

type SnoozeOption = '1d' | '3d' | 'monday';

function nextMonday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay();
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(9, 0, 0, 0);
  return d;
}

function getSnoozeDate(option: SnoozeOption, defaultTime = '09:00', from = new Date()): Date {
  const [hh, mm] = defaultTime.split(':').map(Number);
  if (option === '1d') {
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    d.setHours(hh, mm, 0, 0);
    return d;
  }
  if (option === '3d') {
    const d = new Date(from);
    d.setDate(d.getDate() + 3);
    d.setHours(hh, mm, 0, 0);
    return d;
  }
  return nextMonday(from);
}

describe('getSnoozeDate', () => {
  const base = new Date('2026-05-20T10:00:00.000Z'); // Wednesday UTC

  it('1d adds exactly one day and sets default time', () => {
    const result = getSnoozeDate('1d', '09:00', base);
    expect(result.getDate()).toBe(base.getDate() + 1);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
  });

  it('3d adds exactly three days and sets default time', () => {
    const result = getSnoozeDate('3d', '08:30', base);
    expect(result.getDate()).toBe(base.getDate() + 3);
    expect(result.getHours()).toBe(8);
    expect(result.getMinutes()).toBe(30);
  });

  it('monday always returns a Monday', () => {
    const result = getSnoozeDate('monday', '09:00', base);
    expect(result.getDay()).toBe(1); // 1 = Monday
  });

  it('monday from Monday advances to next Monday (not same day)', () => {
    const monday = new Date('2026-05-18T10:00:00'); // a Monday
    const result = getSnoozeDate('monday', '09:00', monday);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(25); // 2026-05-25 = next Monday
  });

  it('monday sets time to 09:00', () => {
    const result = getSnoozeDate('monday', '15:00', base); // defaultTime ignored for monday
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
  });
});

// ─── Button ID parsing ────────────────────────────────────────────────────────

function parseButtonId(id: string): { action: 'snooze' | 'dismiss'; option: SnoozeOption | null; type: 'rem' | 'task' | 'work'; itemId: string } | null {
  const parts = id.split('_');
  if (parts.length < 3) return null;
  const [rawAction, itemType, ...rest] = parts;
  const itemId = rest.join('_');
  if (!['rem', 'task', 'work'].includes(itemType)) return null;
  const type = itemType as 'rem' | 'task' | 'work';
  if (rawAction === 'dis') return { action: 'dismiss', option: null, type, itemId };
  const optionMap: Record<string, SnoozeOption> = { s1d: '1d', s3d: '3d', smon: 'monday' };
  const option = optionMap[rawAction];
  if (!option) return null;
  return { action: 'snooze', option, type, itemId };
}

describe('parseButtonId', () => {
  it('parses dismiss for reminder', () => {
    const r = parseButtonId('dis_rem_abc-123');
    expect(r).toEqual({ action: 'dismiss', option: null, type: 'rem', itemId: 'abc-123' });
  });

  it('parses snooze 1d for task', () => {
    const r = parseButtonId('s1d_task_5');
    expect(r).toEqual({ action: 'snooze', option: '1d', type: 'task', itemId: '5' });
  });

  it('parses snooze 3d for work', () => {
    const r = parseButtonId('s3d_work_12');
    expect(r).toEqual({ action: 'snooze', option: '3d', type: 'work', itemId: '12' });
  });

  it('parses next Monday for reminder', () => {
    const r = parseButtonId('smon_rem_uuid-val');
    expect(r).toEqual({ action: 'snooze', option: 'monday', type: 'rem', itemId: 'uuid-val' });
  });

  it('handles item IDs with underscores', () => {
    const r = parseButtonId('dis_task_10_extra');
    expect(r?.itemId).toBe('10_extra');
  });

  it('returns null for unknown action', () => {
    expect(parseButtonId('xxx_task_1')).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(parseButtonId('s1d_foo_1')).toBeNull();
  });

  it('returns null for too few parts', () => {
    expect(parseButtonId('s1d_task')).toBeNull();
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
