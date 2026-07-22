import { google } from 'googleapis';
import { ConnectedAccount, saveAccount, encryptTokens, decryptTokens } from '../token-store';
import { GoogleTokens, getAuthenticatedClient, CalendarDisconnectedError } from './oauth';

export interface Task {
  id: string;
  title: string;
  dueDate?: Date;
  notes?: string;
  status: 'needsAction' | 'completed';
  updated: string;
}

async function getTasksClient(account: ConnectedAccount) {
  let tokens: GoogleTokens;
  try {
    tokens = decryptTokens<GoogleTokens>(account.encryptedTokens, account.id);
  } catch {
    await saveAccount({ ...account, isDisconnected: true });
    throw new CalendarDisconnectedError(account.alias);
  }

  try {
    const { client, refreshedTokens } = await getAuthenticatedClient(tokens, account.alias);

    if (refreshedTokens?.access_token) {
      account.encryptedTokens = encryptTokens({
        access_token: refreshedTokens.access_token,
        refresh_token: refreshedTokens.refresh_token ?? tokens.refresh_token,
        expiry_date: refreshedTokens.expiry_date ?? tokens.expiry_date,
      }, account.id);
      await saveAccount(account);
    }

    return google.tasks({ version: 'v1', auth: client });
  } catch (err) {
    if (err instanceof CalendarDisconnectedError) {
      await saveAccount({ ...account, isDisconnected: true });
    }
    throw err;
  }
}

export async function createTask(
  account: ConnectedAccount,
  params: { title: string; dueDate?: Date; notes?: string }
): Promise<{ taskId: string }> {
  const tasks = await getTasksClient(account);

  const task = await tasks.tasks.insert({
    tasklist: '@default',
    requestBody: {
      title: params.title,
      notes: params.notes,
      due: params.dueDate ? params.dueDate.toISOString() : undefined,
    },
  });

  return { taskId: task.data.id ?? '' };
}

export async function getPendingTasks(account: ConnectedAccount): Promise<Task[]> {
  const tasks = await getTasksClient(account);

  const res = await tasks.tasks.list({
    tasklist: '@default',
    showCompleted: false,
    showHidden: false,
  });

  return (res.data.items ?? [])
    .filter((t) => t.status !== 'completed')
    .map(mapGoogleTask)
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    });
}

function mapGoogleTask(t: {
  id?: string | null;
  title?: string | null;
  due?: string | null;
  notes?: string | null;
  status?: string | null;
  updated?: string | null;
}): Task {
  return {
    id: t.id ?? '',
    title: t.title ?? '(no title)',
    dueDate: t.due ? new Date(t.due) : undefined,
    notes: t.notes ?? undefined,
    status: t.status === 'completed' ? 'completed' : 'needsAction',
    updated: t.updated ?? new Date().toISOString(),
  };
}

export async function completeTask(account: ConnectedAccount, taskId: string): Promise<void> {
  const tasks = await getTasksClient(account);
  await tasks.tasks.patch({
    tasklist: '@default',
    task: taskId,
    requestBody: { status: 'completed' },
  });
}

export async function getTasksUpdatedSince(
  account: ConnectedAccount,
  updatedMinISO: string
): Promise<Task[]> {
  const tasks = await getTasksClient(account);

  const res = await tasks.tasks.list({
    tasklist: '@default',
    showCompleted: true,
    showHidden: true,
    updatedMin: updatedMinISO,
  });

  return (res.data.items ?? []).map(mapGoogleTask);
}
