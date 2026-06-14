import { Redis } from '@upstash/redis';
import { env } from '../../env';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
const TASKS_KEY = 'secretariat:tasks';

export interface LocalTask {
  id: number;
  title: string;
  project?: string;
  dueDate?: string;  // ISO date string (date only, no time)
  dueTime?: string;  // HH:MM
  status: 'open' | 'done';
  createdAt: string;
  doneAt?: string;
  qstashMessageId?: string;
  thirdPartyPhone?: string; // set when task was created via third-party /set
}

async function getAllTasksRaw(): Promise<LocalTask[]> {
  return (await redis.get<LocalTask[]>(TASKS_KEY)) ?? [];
}

export async function getTasks(): Promise<LocalTask[]> {
  return (await getAllTasksRaw()).filter((t) => t.status === 'open');
}

export async function getDoneTasks(): Promise<LocalTask[]> {
  return (await getAllTasksRaw()).filter((t) => t.status === 'done');
}

export async function addTask(
  data: Pick<LocalTask, 'title' | 'project' | 'dueDate' | 'dueTime' | 'thirdPartyPhone'>
): Promise<LocalTask> {
  const all = await getAllTasksRaw();
  const id = all.length ? Math.max(...all.map((t) => t.id)) + 1 : 1;
  const task: LocalTask = {
    id,
    title: data.title.trim(),
    project: data.project?.trim(),
    dueDate: data.dueDate,
    dueTime: data.dueTime,
    status: 'open',
    createdAt: new Date().toISOString(),
    ...(data.thirdPartyPhone ? { thirdPartyPhone: data.thirdPartyPhone } : {}),
  };
  await redis.set(TASKS_KEY, [...all, task]);
  return task;
}

export async function markTaskDone(id: number): Promise<LocalTask | null> {
  const all = await getAllTasksRaw();
  const idx = all.findIndex((t) => t.id === id && t.status === 'open');
  if (idx === -1) return null;
  all[idx].status = 'done';
  all[idx].doneAt = new Date().toISOString();
  await redis.set(TASKS_KEY, all);
  return all[idx];
}

export async function updateTaskQStashId(id: number, qstashMessageId: string): Promise<void> {
  const all = await getAllTasksRaw();
  const idx = all.findIndex((t) => t.id === id);
  if (idx !== -1) {
    all[idx].qstashMessageId = qstashMessageId;
    await redis.set(TASKS_KEY, all);
  }
}

export async function deleteTask(id: number): Promise<boolean> {
  const all = await getAllTasksRaw();
  const filtered = all.filter((t) => t.id !== id);
  if (filtered.length === all.length) return false;
  await redis.set(TASKS_KEY, filtered);
  return true;
}
