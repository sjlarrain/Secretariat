import { Redis } from '@upstash/redis';
import { env } from '../../env';
import { userKey, userSeqKey } from '../../redis/keys';
import { HashCollection, byId } from '../../redis/hash-collection';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

export interface LocalTask {
  id: number;
  title: string;
  project?: string;
  notes?: string;    // free-text description, synced to the Google Task's notes
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

function tasks(userId: string): HashCollection<LocalTask> {
  return new HashCollection<LocalTask>(redis, userKey(userId, 'tasks'), userSeqKey(userId, 'tasks'));
}

async function getAllTasksRaw(userId: string): Promise<LocalTask[]> {
  return tasks(userId).getAll(byId);
}

export async function getTasks(userId: string): Promise<LocalTask[]> {
  return (await getAllTasksRaw(userId)).filter((t) => t.status === 'open');
}

export async function getDoneTasks(userId: string): Promise<LocalTask[]> {
  return (await getAllTasksRaw(userId)).filter((t) => t.status === 'done');
}

export async function getAllTasks(userId: string): Promise<LocalTask[]> {
  return getAllTasksRaw(userId);
}

export async function addTask(
  userId: string,
  data: Pick<LocalTask, 'title' | 'project' | 'notes' | 'dueDate' | 'dueTime' | 'thirdPartyPhone'> &
    Partial<Pick<LocalTask, 'googleTaskId'>> & { status?: LocalTask['status'] }
): Promise<LocalTask> {
  const id = await tasks(userId).nextId();
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
  await tasks(userId).set(task);
  return task;
}

export async function markTaskDone(userId: string, id: number): Promise<LocalTask | null> {
  const task = await tasks(userId).get(id);
  if (!task || task.status !== 'open') return null;
  const now = new Date().toISOString();
  task.status = 'done';
  task.doneAt = now;
  task.updatedAt = now;
  await tasks(userId).set(task);
  return task;
}

export async function updateTaskQStashId(userId: string, id: number, qstashMessageId: string): Promise<void> {
  const task = await tasks(userId).get(id);
  if (!task) return;
  task.qstashMessageId = qstashMessageId;
  await tasks(userId).set(task);
}

export async function setTaskGoogleId(userId: string, id: number, googleTaskId: string): Promise<void> {
  const task = await tasks(userId).get(id);
  if (!task) return;
  task.googleTaskId = googleTaskId;
  await tasks(userId).set(task);
}

export async function applyGoogleUpdate(
  userId: string,
  id: number,
  fields: { status?: LocalTask['status']; title?: string; dueDate?: string }
): Promise<void> {
  const task = await tasks(userId).get(id);
  if (!task) return;
  const now = new Date().toISOString();
  if (fields.title !== undefined) task.title = fields.title;
  if (fields.dueDate !== undefined) task.dueDate = fields.dueDate;
  if (fields.status !== undefined && fields.status !== task.status) {
    task.status = fields.status;
    if (fields.status === 'done') task.doneAt = now;
  }
  task.updatedAt = now;
  await tasks(userId).set(task);
}

export async function deleteTask(userId: string, id: number): Promise<boolean> {
  return tasks(userId).remove(id);
}
