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
  googleTaskId?: string;    // links to a Google Task; absent = local-only / not yet pushed
  updatedAt: string;        // ISO; bumped on create, markTaskDone, and sync-driven updates
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

export async function getAllTasks(): Promise<LocalTask[]> {
  return getAllTasksRaw();
}

export async function addTask(
  data: Pick<LocalTask, 'title' | 'project' | 'dueDate' | 'dueTime' | 'thirdPartyPhone'> &
    Partial<Pick<LocalTask, 'googleTaskId'>> & { status?: LocalTask['status'] }
): Promise<LocalTask> {
  const all = await getAllTasksRaw();
  const id = all.length ? Math.max(...all.map((t) => t.id)) + 1 : 1;
  const now = new Date().toISOString();
  const status = data.status ?? 'open';
  const task: LocalTask = {
    id,
    title: data.title.trim(),
    project: data.project?.trim(),
    dueDate: data.dueDate,
    dueTime: data.dueTime,
    status,
    createdAt: now,
    updatedAt: now,
    ...(status === 'done' ? { doneAt: now } : {}),
    ...(data.thirdPartyPhone ? { thirdPartyPhone: data.thirdPartyPhone } : {}),
    ...(data.googleTaskId ? { googleTaskId: data.googleTaskId } : {}),
  };
  await redis.set(TASKS_KEY, [...all, task]);
  return task;
}

export async function markTaskDone(id: number): Promise<LocalTask | null> {
  const all = await getAllTasksRaw();
  const idx = all.findIndex((t) => t.id === id && t.status === 'open');
  if (idx === -1) return null;
  const now = new Date().toISOString();
  all[idx].status = 'done';
  all[idx].doneAt = now;
  all[idx].updatedAt = now;
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

export async function setTaskGoogleId(id: number, googleTaskId: string): Promise<void> {
  const all = await getAllTasksRaw();
  const idx = all.findIndex((t) => t.id === id);
  if (idx !== -1) {
    all[idx].googleTaskId = googleTaskId;
    await redis.set(TASKS_KEY, all);
  }
}

export async function applyGoogleUpdate(
  id: number,
  fields: { status?: LocalTask['status']; title?: string; dueDate?: string }
): Promise<void> {
  const all = await getAllTasksRaw();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const now = new Date().toISOString();
  if (fields.title !== undefined) all[idx].title = fields.title;
  if (fields.dueDate !== undefined) all[idx].dueDate = fields.dueDate;
  if (fields.status !== undefined && fields.status !== all[idx].status) {
    all[idx].status = fields.status;
    if (fields.status === 'done') all[idx].doneAt = now;
  }
  all[idx].updatedAt = now;
  await redis.set(TASKS_KEY, all);
}

export async function deleteTask(id: number): Promise<boolean> {
  const all = await getAllTasksRaw();
  const filtered = all.filter((t) => t.id !== id);
  if (filtered.length === all.length) return false;
  await redis.set(TASKS_KEY, filtered);
  return true;
}
