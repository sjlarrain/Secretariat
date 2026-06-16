import { sendMessage } from '../kapso/client';
import { getSettings } from '../integrations/token-store';
import { getReminders, updateReminder, removeReminder, saveReminder, PendingReminder } from '../integrations/local/reminders';
import { getReplyTarget } from '../integrations/local/wa-reply-map';
import { getTasks, markTaskDone, updateTaskQStashId, addTask } from '../integrations/local/tasks';
import { getWorkItem, markWorkItemDone, updateWorkItemReminder } from '../integrations/local/work';
import { scheduleOnce, cancelMessage } from '../qstash/client';
import { getSnoozeDate, SnoozeOption } from '../utils/snooze';
import { removePendingEvent, canNotifyThirdParty } from '../integrations/local/third-party';
import { resolveAccount } from '../integrations/registry';
import { createEvent } from '../integrations/google/calendar';
import { formatDate, formatTime } from '../utils/date';

// Button ID format: <action>_<type>_<itemId>
// action: s1d | s3d | smon | done
// type:   rem | task | work
// itemId: string (UUID for reminders, number for tasks/work)
//
// Third-party format: tp_<type>_<pendingId>
// type: rem | task | cal
//
// Examples: s1d_rem_abc123, smon_task_5, done_work_3, tp_rem_uuid

function parseButtonId(id: string): { action: 'snooze' | 'done'; option: SnoozeOption | null; type: 'rem' | 'task' | 'work'; itemId: string } | null {
  const parts = id.split('_');
  if (parts.length < 3) return null;

  const [rawAction, itemType, ...rest] = parts;
  const itemId = rest.join('_');

  if (!['rem', 'task', 'work'].includes(itemType)) return null;

  const type = itemType as 'rem' | 'task' | 'work';

  if (rawAction === 'done') return { action: 'done', option: null, type, itemId };

  const optionMap: Record<string, SnoozeOption> = { s1h: '1h', s1d: '1d', smon: 'monday' };
  const option = optionMap[rawAction];
  if (!option) return null;

  return { action: 'snooze', option, type, itemId };
}

export async function buttonReplyHandler(buttonId: string, from: string, contextMessageId: string | null = null): Promise<void> {
  // Third-party pending event buttons
  if (buttonId.startsWith('tp_')) {
    await handleThirdPartyButton(buttonId, from);
    return;
  }

  const parsed = parseButtonId(buttonId);
  if (!parsed) return; // unrecognised button — silently ignore

  const settings = await getSettings();
  const timezone = settings.timezone ?? 'America/Santiago';

  try {
    if (parsed.type === 'rem') {
      await handleReminderButton(parsed.action, parsed.option, parsed.itemId, from, timezone, contextMessageId);
    } else if (parsed.type === 'task') {
      await handleTaskButton(parsed.action, parsed.option, Number(parsed.itemId), from, timezone);
    } else {
      await handleWorkButton(parsed.action, parsed.option, Number(parsed.itemId), from, timezone);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not process button action: ${msg}`);
  }
}

// Reminders are deleted from Redis the moment they fire (see routes/internal.ts).
// So by the time a snooze/done button is tapped, the record is usually gone —
// fall back to the title/phone cached in the wa-reply-map for the fired message,
// and only re-save the reminder (with a new fire time) if the user snoozes it.
async function handleReminderButton(
  action: 'snooze' | 'done',
  option: SnoozeOption | null,
  reminderId: string,
  from: string,
  timezone: string,
  contextMessageId: string | null,
) {
  const reminders = await getReminders();
  const reminder = reminders.find((r) => r.id === reminderId);

  let title = reminder?.title;
  let phoneNumber = reminder?.phoneNumber;
  if (!title) {
    const target = contextMessageId ? await getReplyTarget(contextMessageId) : null;
    title = target?.title;
    phoneNumber = target?.phoneNumber;
  }

  if (!title) {
    await sendMessage(from, '❌ Reminder not found — it may have already been dismissed.');
    return;
  }
  phoneNumber = phoneNumber ?? from;

  if (reminder) {
    await cancelMessage(reminder.messageId).catch(() => null);
  }

  if (action === 'done') {
    if (reminder) await removeReminder(reminderId);
    await sendMessage(from, `✅ Done: _"${title}"_`);
    return;
  }

  const fireAt = getSnoozeDate(option!, timezone);
  const newMessageId = await scheduleOnce('/internal/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    reminderId,
    title,
    phoneNumber,
  });

  if (reminder) {
    await updateReminder(reminderId, { fireAt: fireAt.toISOString(), messageId: newMessageId });
  } else {
    const fresh: PendingReminder = { id: reminderId, title, phoneNumber, fireAt: fireAt.toISOString(), messageId: newMessageId };
    await saveReminder(fresh);
  }

  await sendMessage(from, `⏰ Snoozed: _"${title}"_\nNew time: ${fireAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })}`);
}

async function handleTaskButton(
  action: 'snooze' | 'done',
  option: SnoozeOption | null,
  taskId: number,
  from: string,
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
    if (task.thirdPartyPhone && await canNotifyThirdParty(task.thirdPartyPhone)) {
      await sendMessage(task.thirdPartyPhone, `✅ _"${task.title}"_ is done!`).catch(() => null);
    }
    return;
  }

  const fireAt = getSnoozeDate(option!, timezone);
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

  const fireAt = getSnoozeDate(option!, timezone);
  const newMessageId = await scheduleOnce('/internal/work/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    workItemId: workId,
    text: item.text,
    phoneNumber: from,
  });
  await updateWorkItemReminder(workId, fireAt.toISOString(), newMessageId);
  await sendMessage(from, `⏰ Work item snoozed: _"${item.text}"_\nNew time: ${fireAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })}`);
}

// tp_rem_<id> | tp_task_<id> | tp_cal_<id>
async function handleThirdPartyButton(buttonId: string, from: string): Promise<void> {
  const parts = buttonId.split('_');
  if (parts.length < 3 || parts[0] !== 'tp') return;
  const type = parts[1];
  const pendingId = parts.slice(2).join('_');

  if (!['rem', 'task', 'cal'].includes(type)) {
    await sendMessage(from, '❌ Unrecognized action type.');
    return;
  }

  const pending = await removePendingEvent(pendingId);
  if (!pending) {
    await sendMessage(from, '❌ This request has already been handled or expired.');
    return;
  }

  const settings = await getSettings();
  const timezone = settings.timezone ?? 'America/Santiago';

  const target = new Date(pending.fireAt);
  const dateLabel = `${formatDate(target, true, timezone)} at ${formatTime(target, timezone)}`;
  const titleDisplay = pending.title || '(no title)';

  try {
    if (type === 'rem') {
      // Reminder was already saved when /set was received — just confirm
      await sendMessage(from, `⏰ *Kept as reminder*\n📌 ${titleDisplay}\n📅 ${dateLabel}\n_From ${pending.senderAlias}_`);

    } else if (type === 'task') {
      // Cancel the auto-saved reminder, create task instead
      if (pending.reminderMessageId) {
        await cancelMessage(pending.reminderMessageId).catch(() => null);
      }
      await removeReminder(pending.reminderId).catch(() => null);

      const task = await addTask({ title: pending.title || `From ${pending.senderAlias}`, dueDate: target.toISOString(), dueTime: pending.atValue, thirdPartyPhone: pending.senderPhone });
      const delaySeconds = Math.floor((target.getTime() - Date.now()) / 1000);
      if (delaySeconds > 0) {
        const msgId = await scheduleOnce(
          '/internal/task/reminder/fire',
          delaySeconds,
          { taskId: task.id, title: task.title, phoneNumber: from }
        );
        await updateTaskQStashId(task.id, msgId);
      }

      await sendMessage(from, `✅ *Moved to task* (#${task.id})\n📌 ${titleDisplay}\n📅 ${dateLabel}\n_From ${pending.senderAlias}_`);

    } else if (type === 'cal') {
      // Cancel the auto-saved reminder, create calendar event instead
      if (pending.reminderMessageId) {
        await cancelMessage(pending.reminderMessageId).catch(() => null);
      }
      await removeReminder(pending.reminderId).catch(() => null);

      const account = await resolveAccount('calendar');
      if (!account) {
        await sendMessage(from, '❌ No calendar account connected. Visit the admin panel.');
        return;
      }

      const endDatetime = new Date(target.getTime() + 60 * 60 * 1000);
      await createEvent(account, {
        title: pending.title || `From ${pending.senderAlias}`,
        startDatetime: target,
        endDatetime,
        attendees: [],
        timezone,
      });

      await sendMessage(from, `📅 *Moved to calendar*\n📌 ${titleDisplay}\n📅 ${dateLabel}\n_From ${pending.senderAlias}_`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not save: ${msg}`);
  }
}
