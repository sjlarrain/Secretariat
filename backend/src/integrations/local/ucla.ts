import { Redis } from '@upstash/redis';
import { env, whitelistedNumbers } from '../../env';
import { userKey, userSeqKey, legacyWorkKey } from '../../redis/keys';
import { HashCollection, byId } from '../../redis/hash-collection';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

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

function ucla(userId: string): HashCollection<UclaItem> {
  return new HashCollection<UclaItem>(redis, userKey(userId, 'ucla'), userSeqKey(userId, 'ucla'));
}

async function getAllUclaRaw(userId: string): Promise<UclaItem[]> {
  const items = await ucla(userId).getAll(byId);
  if (items.length > 0) return items;

  // One-time migration: adopt the old /work list if it exists and we have not
  // written a UCLA list yet. The legacy key (see `legacyWorkKey()`) only ever
  // held Santiago's v1 data, so this only ever applies to the one legacy
  // owner — never to any other user, whose empty list should just stay
  // empty. Writing the result into this user's hash makes this a no-op
  // afterwards.
  if (userId !== whitelistedNumbers[0]) return [];

  const legacy = await redis.get<UclaItem[]>(legacyWorkKey());
  if (legacy?.length) {
    await Promise.all(legacy.map((item) => ucla(userId).set(item)));
    return legacy;
  }

  return [];
}

export async function getUclaItems(userId: string): Promise<UclaItem[]> {
  return (await getAllUclaRaw(userId)).filter((w) => !w.doneAt);
}

export async function getDoneUclaItems(userId: string): Promise<UclaItem[]> {
  return (await getAllUclaRaw(userId)).filter((w) => !!w.doneAt);
}

export async function getUclaItem(userId: string, id: number): Promise<UclaItem | null> {
  return ucla(userId).get(id);
}

/**
 * Items due within the next `hours`, soonest first, split from those already
 * overdue. The digest labels them differently — an item due three weeks ago
 * should not be announced as "due in the next 48h".
 */
export async function getUpcomingUclaItems(
  userId: string,
  hours: number,
  now: Date = new Date()
): Promise<{ upcoming: UclaItem[]; overdue: UclaItem[] }> {
  const nowMs = now.getTime();
  const cutoff = nowMs + hours * 60 * 60 * 1000;

  const dated = (await getUclaItems(userId))
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
  userId: string,
  text: string,
  fields?: Partial<Pick<UclaItem, 'dueDate' | 'dueReminderId' | 'reminderFor' | 'qstashMessageId'>>
): Promise<UclaItem> {
  const id = await ucla(userId).nextId();
  const item: UclaItem = {
    id,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    ...fields,
  };
  await ucla(userId).set(item);
  return item;
}

export async function markUclaItemDone(userId: string, id: number): Promise<UclaItem | null> {
  const item = await ucla(userId).get(id);
  if (!item || item.doneAt) return null;
  item.doneAt = new Date().toISOString();
  await ucla(userId).set(item);
  return item;
}

export async function updateUclaItem(userId: string, id: number, fields: Partial<UclaItem>): Promise<UclaItem | null> {
  const item = await ucla(userId).get(id);
  if (!item) return null;
  const updated = { ...item, ...fields };
  await ucla(userId).set(updated);
  return updated;
}

export async function updateUclaItemReminder(
  userId: string,
  id: number,
  reminderFor: string,
  qstashMessageId: string
): Promise<void> {
  await updateUclaItem(userId, id, {
    reminderFor: reminderFor || undefined,
    qstashMessageId: qstashMessageId || undefined,
  });
}

export async function deleteUclaItem(userId: string, id: number): Promise<boolean> {
  return ucla(userId).remove(id);
}
