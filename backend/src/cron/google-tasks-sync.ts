import { resolveAccount } from '../integrations/registry';
import { getSettings, saveSettings } from '../integrations/token-store';
import { getAllTasks, addTask, applyGoogleUpdate, LocalTask } from '../integrations/local/tasks';
import { completeTask, getTasksUpdatedSince } from '../integrations/google/tasks';

export async function syncGoogleTasks(): Promise<{ pulled: number; pushed: number; skipped: boolean }> {
  const account = await resolveAccount('tasks');
  if (!account || account.isDisconnected) {
    return { pulled: 0, pushed: 0, skipped: true };
  }

  const settings = await getSettings();
  const lastSyncAt = settings.googleTasksSync.lastSyncAt ?? new Date(0).toISOString();

  const remoteTasks = await getTasksUpdatedSince(account, lastSyncAt);
  const localTasks = await getAllTasks();
  const localByGoogleId = new Map<string, LocalTask>(
    localTasks.filter((t) => t.googleTaskId).map((t) => [t.googleTaskId as string, t])
  );

  let pulled = 0;
  let pushed = 0;
  let maxUpdated = lastSyncAt;

  for (const gtask of remoteTasks) {
    if (gtask.updated > maxUpdated) maxUpdated = gtask.updated;

    const local = localByGoogleId.get(gtask.id);

    if (!local) {
      // Created directly in Google — mirror into local store.
      await addTask({
        title: gtask.title,
        project: undefined,
        dueDate: gtask.dueDate?.toISOString(),
        dueTime: undefined,
        thirdPartyPhone: undefined,
        googleTaskId: gtask.id,
        status: gtask.status === 'completed' ? 'done' : 'open',
      });
      pulled++;
      continue;
    }

    const localChangedSinceSync = local.updatedAt > lastSyncAt;

    if (localChangedSinceSync) {
      // Local wins: re-push local state to Google if it diverges.
      if (local.status === 'done' && gtask.status !== 'completed') {
        await pushGoogleComplete(account, local);
        pushed++;
      }
      continue;
    }

    // Local untouched since last sync — accept Google's state.
    const localStatus: LocalTask['status'] = gtask.status === 'completed' ? 'done' : 'open';
    if (localStatus !== local.status || gtask.title !== local.title) {
      await applyGoogleUpdate(local.id, { status: localStatus, title: gtask.title });
      pulled++;
    }
  }

  settings.googleTasksSync.lastSyncAt = maxUpdated > lastSyncAt ? maxUpdated : new Date().toISOString();
  await saveSettings(settings);

  return { pulled, pushed, skipped: false };
}

async function pushGoogleComplete(account: NonNullable<Awaited<ReturnType<typeof resolveAccount>>>, task: LocalTask): Promise<void> {
  try {
    if (task.googleTaskId) {
      await completeTask(account, task.googleTaskId);
    }
  } catch (err) {
    console.error('Google Tasks sync: failed to push local completion:', err);
  }
}
