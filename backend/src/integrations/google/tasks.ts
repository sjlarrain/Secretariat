import { google } from 'googleapis';
import { ConnectedAccount, saveAccount, encryptTokens, decryptTokens } from '../token-store';
import { GoogleTokens, getAuthenticatedClient } from './oauth';

export interface Task {
  id: string;
  title: string;
  dueDate?: Date;
  notes?: string;
}

async function getTasksClient(account: ConnectedAccount) {
  const tokens = decryptTokens<GoogleTokens>(account.encryptedTokens, account.id);
  const { client, refreshedTokens } = await getAuthenticatedClient(tokens);

  if (refreshedTokens?.access_token) {
    account.encryptedTokens = encryptTokens({
      access_token: refreshedTokens.access_token,
      refresh_token: refreshedTokens.refresh_token ?? tokens.refresh_token,
      expiry_date: refreshedTokens.expiry_date ?? tokens.expiry_date,
    }, account.id);
    await saveAccount(account);
  }

  return google.tasks({ version: 'v1', auth: client });
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
    .map((t) => ({
      id: t.id ?? '',
      title: t.title ?? '(no title)',
      dueDate: t.due ? new Date(t.due) : undefined,
      notes: t.notes ?? undefined,
    }))
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    });
}
