import { Redis } from '@upstash/redis';
import { env } from '../../env';

export interface PendingReminder {
  id: string;
  title: string;
  phoneNumber: string;
  fireAt: string; // ISO string
  messageId: string;
  deferred?: boolean; // true when fireAt is beyond QStash free-tier delay limit
}

const KEY = 'secretariat:reminders';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

export async function getReminders(): Promise<PendingReminder[]> {
  const data = await getRedis().get<PendingReminder[]>(KEY);
  return data ?? [];
}

export async function saveReminder(r: PendingReminder): Promise<void> {
  const list = await getReminders();
  await getRedis().set(KEY, [...list, r]);
}

export async function removeReminder(id: string): Promise<boolean> {
  const list = await getReminders();
  const filtered = list.filter((r) => r.id !== id);
  if (filtered.length === list.length) return false;
  await getRedis().set(KEY, filtered);
  return true;
}

export async function updateReminder(id: string, updates: Partial<Pick<PendingReminder, 'fireAt' | 'messageId' | 'deferred'>>): Promise<boolean> {
  const list = await getReminders();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...updates };
  await getRedis().set(KEY, list);
  return true;
}
