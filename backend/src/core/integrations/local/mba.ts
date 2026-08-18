import { Redis } from '@upstash/redis';
import { env } from '../../../shared/env';
import { userKey, userSeqKey } from '../../../shared/redis/keys';
import { HashCollection, byId } from '../../../shared/redis/hash-collection';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

export interface MbaItem {
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

function mba(userId: string): HashCollection<MbaItem> {
  return new HashCollection<MbaItem>(redis, userKey(userId, 'mba'), userSeqKey(userId, 'mba'));
}

async function getAllMbaRaw(userId: string): Promise<MbaItem[]> {
  return mba(userId).getAll(byId);
}

export async function getMbaItems(userId: string): Promise<MbaItem[]> {
  return (await getAllMbaRaw(userId)).filter((w) => !w.doneAt);
}

export async function getDoneMbaItems(userId: string): Promise<MbaItem[]> {
  return (await getAllMbaRaw(userId)).filter((w) => !!w.doneAt);
}

export async function getMbaItem(userId: string, id: number): Promise<MbaItem | null> {
  return mba(userId).get(id);
}

/**
 * Items due within the next `hours`, soonest first, split from those already
 * overdue. The digest labels them differently — an item due three weeks ago
 * should not be announced as "due in the next 48h".
 */
export async function getUpcomingMbaItems(
  userId: string,
  hours: number,
  now: Date = new Date()
): Promise<{ upcoming: MbaItem[]; overdue: MbaItem[] }> {
  const nowMs = now.getTime();
  const cutoff = nowMs + hours * 60 * 60 * 1000;

  const dated = (await getMbaItems(userId))
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

export async function addMbaItem(
  userId: string,
  text: string,
  fields?: Partial<Pick<MbaItem, 'dueDate' | 'dueReminderId' | 'reminderFor' | 'qstashMessageId'>>
): Promise<MbaItem> {
  const id = await mba(userId).nextId();
  const item: MbaItem = {
    id,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    ...fields,
  };
  await mba(userId).set(item);
  return item;
}

export async function markMbaItemDone(userId: string, id: number): Promise<MbaItem | null> {
  const item = await mba(userId).get(id);
  if (!item || item.doneAt) return null;
  item.doneAt = new Date().toISOString();
  await mba(userId).set(item);
  return item;
}

export async function updateMbaItem(userId: string, id: number, fields: Partial<MbaItem>): Promise<MbaItem | null> {
  const item = await mba(userId).get(id);
  if (!item) return null;
  const updated = { ...item, ...fields };
  await mba(userId).set(updated);
  return updated;
}

export async function updateMbaItemReminder(
  userId: string,
  id: number,
  reminderFor: string,
  qstashMessageId: string
): Promise<void> {
  await updateMbaItem(userId, id, {
    reminderFor: reminderFor || undefined,
    qstashMessageId: qstashMessageId || undefined,
  });
}

export async function deleteMbaItem(userId: string, id: number): Promise<boolean> {
  return mba(userId).remove(id);
}
