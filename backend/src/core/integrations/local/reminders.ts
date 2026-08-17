import { Redis } from '@upstash/redis';
import { env } from '../../../shared/env';
import { userKey } from '../../../shared/redis/keys';
import { HashCollection, byDateField } from '../../../shared/redis/hash-collection';

export interface PendingReminder {
  id: string;
  title: string;
  phoneNumber: string;
  fireAt: string; // ISO string
  messageId: string;
  deferred?: boolean; // true when fireAt is beyond QStash free-tier delay limit
}

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

// Reminder ids are caller-supplied UUIDs (see handlers), so no seqKey.
function reminders(userId: string): HashCollection<PendingReminder> {
  return new HashCollection<PendingReminder>(getRedis(), userKey(userId, 'reminders'));
}

export async function getReminders(userId: string): Promise<PendingReminder[]> {
  return reminders(userId).getAll(byDateField('fireAt'));
}

export async function saveReminder(userId: string, r: PendingReminder): Promise<void> {
  await reminders(userId).set(r);
}

export async function removeReminder(userId: string, id: string): Promise<boolean> {
  return reminders(userId).remove(id);
}

export async function updateReminder(
  userId: string,
  id: string,
  updates: Partial<Pick<PendingReminder, 'fireAt' | 'messageId' | 'deferred'>>
): Promise<boolean> {
  const reminder = await reminders(userId).get(id);
  if (!reminder) return false;
  await reminders(userId).set({ ...reminder, ...updates });
  return true;
}
