import { Redis } from '@upstash/redis';
import { env } from '../../env';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
const WORK_KEY = 'secretariat:work';

export interface WorkItem {
  id: number;
  text: string;
  createdAt: string;
  doneAt?: string;
  reminderFor?: string;       // ISO datetime when QStash reminder fires
  qstashMessageId?: string;   // for cancellation when marked done early
}

async function getAllWorkRaw(): Promise<WorkItem[]> {
  return (await redis.get<WorkItem[]>(WORK_KEY)) ?? [];
}

export async function getWorkItems(): Promise<WorkItem[]> {
  return (await getAllWorkRaw()).filter((w) => !w.doneAt);
}

export async function getDoneWorkItems(): Promise<WorkItem[]> {
  return (await getAllWorkRaw()).filter((w) => !!w.doneAt);
}

export async function getWorkItem(id: number): Promise<WorkItem | null> {
  const all = await getAllWorkRaw();
  return all.find((w) => w.id === id) ?? null;
}

export async function addWorkItem(
  text: string,
  reminder?: { reminderFor: string; qstashMessageId: string }
): Promise<WorkItem> {
  const all = await getAllWorkRaw();
  const id = all.length ? Math.max(...all.map((w) => w.id)) + 1 : 1;
  const item: WorkItem = {
    id,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    ...reminder,
  };
  await redis.set(WORK_KEY, [...all, item]);
  return item;
}

export async function markWorkItemDone(id: number): Promise<WorkItem | null> {
  const all = await getAllWorkRaw();
  const idx = all.findIndex((w) => w.id === id && !w.doneAt);
  if (idx === -1) return null;
  all[idx].doneAt = new Date().toISOString();
  await redis.set(WORK_KEY, all);
  return all[idx];
}

export async function updateWorkItemReminderId(id: number, qstashMessageId: string): Promise<void> {
  const all = await getAllWorkRaw();
  const idx = all.findIndex((w) => w.id === id);
  if (idx !== -1) {
    all[idx].qstashMessageId = qstashMessageId;
    await redis.set(WORK_KEY, all);
  }
}

export async function deleteWorkItem(id: number): Promise<boolean> {
  const all = await getAllWorkRaw();
  const filtered = all.filter((w) => w.id !== id);
  if (filtered.length === all.length) return false;
  await redis.set(WORK_KEY, filtered);
  return true;
}
