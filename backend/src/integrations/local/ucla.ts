import { Redis } from '@upstash/redis';
import { env } from '../../env';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
const UCLA_KEY = 'secretariat:ucla';
/** v1.14: `/work` became `/ucla`. Read-only — used once to migrate old items. */
const LEGACY_WORK_KEY = 'secretariat:work';

export interface UclaItem {
  id: number;
  text: string;
  createdAt: string;
  doneAt?: string;
  /** ISO datetime the item is due. Drives the automatic 24h-before reminder. */
  dueDate?: string;
  /** QStash id for the automatic 24h-before due reminder — cancel on done/change. */
  dueReminderId?: string;
  /** ISO datetime for a user-requested extra reminder (--for/--at). */
  reminderFor?: string;
  /** QStash id for the user-requested reminder. */
  qstashMessageId?: string;
}

async function getAllUclaRaw(): Promise<UclaItem[]> {
  const items = await redis.get<UclaItem[]>(UCLA_KEY);
  if (items) return items;

  // One-time migration: adopt the old /work list if it exists and we have not
  // written a UCLA list yet. Writing the result makes this a no-op afterwards.
  const legacy = await redis.get<UclaItem[]>(LEGACY_WORK_KEY);
  if (legacy?.length) {
    await redis.set(UCLA_KEY, legacy);
    return legacy;
  }

  return [];
}

export async function getUclaItems(): Promise<UclaItem[]> {
  return (await getAllUclaRaw()).filter((w) => !w.doneAt);
}

export async function getDoneUclaItems(): Promise<UclaItem[]> {
  return (await getAllUclaRaw()).filter((w) => !!w.doneAt);
}

export async function getUclaItem(id: number): Promise<UclaItem | null> {
  const all = await getAllUclaRaw();
  return all.find((w) => w.id === id) ?? null;
}

/**
 * Items due within the next `hours`, soonest first, split from those already
 * overdue. The digest labels them differently — an item due three weeks ago
 * should not be announced as "due in the next 48h".
 */
export async function getUpcomingUclaItems(
  hours: number,
  now: Date = new Date()
): Promise<{ upcoming: UclaItem[]; overdue: UclaItem[] }> {
  const nowMs = now.getTime();
  const cutoff = nowMs + hours * 60 * 60 * 1000;

  const dated = (await getUclaItems())
    .filter((w) => !!w.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

  return {
    overdue: dated.filter((w) => new Date(w.dueDate!).getTime() < nowMs),
    upcoming: dated.filter((w) => {
      const due = new Date(w.dueDate!).getTime();
      return due >= nowMs && due <= cutoff;
    }),
  };
}

export async function addUclaItem(
  text: string,
  fields?: Partial<Pick<UclaItem, 'dueDate' | 'dueReminderId' | 'reminderFor' | 'qstashMessageId'>>
): Promise<UclaItem> {
  const all = await getAllUclaRaw();
  const id = all.length ? Math.max(...all.map((w) => w.id)) + 1 : 1;
  const item: UclaItem = {
    id,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    ...fields,
  };
  await redis.set(UCLA_KEY, [...all, item]);
  return item;
}

export async function markUclaItemDone(id: number): Promise<UclaItem | null> {
  const all = await getAllUclaRaw();
  const idx = all.findIndex((w) => w.id === id && !w.doneAt);
  if (idx === -1) return null;
  all[idx].doneAt = new Date().toISOString();
  await redis.set(UCLA_KEY, all);
  return all[idx];
}

export async function updateUclaItem(id: number, fields: Partial<UclaItem>): Promise<UclaItem | null> {
  const all = await getAllUclaRaw();
  const idx = all.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...fields };
  await redis.set(UCLA_KEY, all);
  return all[idx];
}

export async function updateUclaItemReminder(id: number, reminderFor: string, qstashMessageId: string): Promise<void> {
  await updateUclaItem(id, {
    reminderFor: reminderFor || undefined,
    qstashMessageId: qstashMessageId || undefined,
  });
}

export async function deleteUclaItem(id: number): Promise<boolean> {
  const all = await getAllUclaRaw();
  const filtered = all.filter((w) => w.id !== id);
  if (filtered.length === all.length) return false;
  await redis.set(UCLA_KEY, filtered);
  return true;
}
