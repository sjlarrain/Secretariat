import { sendMessage } from '../kapso/client';
import { getSettings } from '../integrations/token-store';
import { getReminders, updateReminder, removeReminder } from '../integrations/local/reminders';
import { getTasks, markTaskDone, updateTaskQStashId } from '../integrations/local/tasks';
import { getWorkItem, markWorkItemDone, updateWorkItemReminder } from '../integrations/local/work';
import { scheduleOnce, cancelMessage } from '../qstash/client';
import { getSnoozeDate, SnoozeOption } from '../utils/snooze';

// Button ID format: <action>_<type>_<itemId>
// action: s1d | s3d | smon | done
// type:   rem | task | work
// itemId: string (UUID for reminders, number for tasks/work)
//
// Examples: s1d_rem_abc123, smon_task_5, done_work_3

function parseButtonId(id: string): { action: 'snooze' | 'done'; option: SnoozeOption | null; type: 'rem' | 'task' | 'work'; itemId: string } | null {
  const parts = id.split('_');
  if (parts.length < 3) return null;

  const [rawAction, itemType, ...rest] = parts;
  const itemId = rest.join('_');

  if (!['rem', 'task', 'work'].includes(itemType)) return null;

  const type = itemType as 'rem' | 'task' | 'work';

  if (rawAction === 'done') return { action: 'done', option: null, type, itemId };

  const optionMap: Record<string, SnoozeOption> = { s1d: '1d', s3d: '3d', smon: 'monday' };
  const option = optionMap[rawAction];
  if (!option) return null;

  return { action: 'snooze', option, type, itemId };
}

export async function buttonReplyHandler(buttonId: string, from: string): Promise<void> {
  const parsed = parseButtonId(buttonId);
  if (!parsed) return; // unrecognised button — silently ignore

  const settings = await getSettings();
  const defaultTime = settings.defaultTaskTime ?? '09:00';
  const timezone = settings.timezone ?? 'America/Santiago';

  try {
    if (parsed.type === 'rem') {
      await handleReminderButton(parsed.action, parsed.option, parsed.itemId, from, defaultTime, timezone);
    } else if (parsed.type === 'task') {
      await handleTaskButton(parsed.action, parsed.option, Number(parsed.itemId), from, defaultTime, timezone);
    } else {
      await handleWorkButton(parsed.action, parsed.option, Number(parsed.itemId), from, defaultTime, timezone);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not process button action: ${msg}`);
  }
}

async function handleReminderButton(
  action: 'snooze' | 'done',
  option: SnoozeOption | null,
  reminderId: string,
  from: string,
  defaultTime: string,
  timezone: string,
) {
  const reminders = await getReminders();
  const reminder = reminders.find((r) => r.id === reminderId);
  if (!reminder) {
    await sendMessage(from, '❌ Reminder not found — it may have already been dismissed.');
    return;
  }

  await cancelMessage(reminder.messageId).catch(() => null);

  if (action === 'done') {
    await removeReminder(reminderId);
    await sendMessage(from, `✅ Done: _"${reminder.title}"_`);
    return;
  }

  const fireAt = getSnoozeDate(option!, defaultTime, timezone);
  const newMessageId = await scheduleOnce('/internal/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    reminderId,
    title: reminder.title,
    phoneNumber: from,
  });
  await updateReminder(reminderId, { fireAt: fireAt.toISOString(), messageId: newMessageId });
  await sendMessage(from, `⏰ Snoozed: _"${reminder.title}"_\nNew time: ${fireAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })}`);
}

async function handleTaskButton(
  action: 'snooze' | 'done',
  option: SnoozeOption | null,
  taskId: number,
  from: string,
  defaultTime: string,
  timezone: string,
) {
  const tasks = await getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    await sendMessage(from, '❌ Task not found.');
    return;
  }

  if (task.qstashMessageId) {
    await cancelMessage(task.qstashMessageId).catch(() => null);
  }

  if (action === 'done') {
    await markTaskDone(taskId);
    await sendMessage(from, `✅ *Task done!* _"${task.title}"_`);
    return;
  }

  const fireAt = getSnoozeDate(option!, defaultTime, timezone);
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    taskId,
    title: task.title,
    phoneNumber: from,
  });
  await updateTaskQStashId(taskId, newMessageId);
  await sendMessage(from, `⏰ Task snoozed: _"${task.title}"_\nNew time: ${fireAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })}`);
}

async function handleWorkButton(
  action: 'snooze' | 'done',
  option: SnoozeOption | null,
  workId: number,
  from: string,
  defaultTime: string,
  timezone: string,
) {
  const item = await getWorkItem(workId);
  if (!item) {
    await sendMessage(from, '❌ Work item not found.');
    return;
  }

  if (item.qstashMessageId) {
    await cancelMessage(item.qstashMessageId).catch(() => null);
  }

  if (action === 'done') {
    await markWorkItemDone(workId);
    await sendMessage(from, `✅ Done! _"${item.text}"_ marked as completed.`);
    return;
  }

  const fireAt = getSnoozeDate(option!, defaultTime, timezone);
  const newMessageId = await scheduleOnce('/internal/work/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    workItemId: workId,
    text: item.text,
    phoneNumber: from,
  });
  await updateWorkItemReminder(workId, fireAt.toISOString(), newMessageId);
  await sendMessage(from, `⏰ Work item snoozed: _"${item.text}"_\nNew time: ${fireAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })}`);
}
