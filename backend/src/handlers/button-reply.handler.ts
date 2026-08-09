import { sendMessage } from '../kapso/client';
import { Ctx } from '../ctx';
import { getReminders, updateReminder, removeReminder, saveReminder, PendingReminder } from '../integrations/local/reminders';
import { getReplyTarget } from '../integrations/local/wa-reply-map';
import { getTasks, markTaskDone, updateTaskQStashId, addTask } from '../integrations/local/tasks';
import { getUclaItem, markUclaItemDone, updateUclaItemReminder } from '../integrations/local/ucla';
import { scheduleOnce, cancelMessage } from '../qstash/client';
import { getSnoozeDate, SnoozeOption } from '../utils/snooze';
import { removePendingEvent, canNotifyThirdParty } from '../integrations/local/third-party';
import { resolveAccount } from '../integrations/registry';
import { createEvent } from '../integrations/google/calendar';
import { formatDate, formatTime } from '../utils/date';

// Button ID format: <action>_<type>_<itemId>
// action: s1d | s3d | smon | done
// type:   rem | task | ucla  ('work' still accepted — pre-v1.14 buttons already
//         delivered to the user's phone keep working after the rename)
// itemId: string (UUID for reminders, number for tasks/ucla)
//
// Third-party format: tp_<type>_<pendingId>
// type: rem | task | cal
//
// Examples: s1d_rem_abc123, smon_task_5, done_ucla_3, tp_rem_uuid

function parseButtonId(id: string): { action: 'snooze' | 'done'; option: SnoozeOption | null; type: 'rem' | 'task' | 'ucla'; itemId: string } | null {
  const parts = id.split('_');
  if (parts.length < 3) return null;

  const [rawAction, itemType, ...rest] = parts;
  const itemId = rest.join('_');

  if (!['rem', 'task', 'ucla', 'work'].includes(itemType)) return null;

  const type = (itemType === 'work' ? 'ucla' : itemType) as 'rem' | 'task' | 'ucla';

  if (rawAction === 'done') return { action: 'done', option: null, type, itemId };

  const optionMap: Record<string, SnoozeOption> = { s1h: '1h', s1d: '1d', smon: 'monday' };
  const option = optionMap[rawAction];
  if (!option) return null;

  return { action: 'snooze', option, type, itemId };
}

export async function buttonReplyHandler(buttonId: string, ctx: Ctx, contextMessageId: string | null = null): Promise<void> {
  const from = ctx.userId;

  // Third-party pending event buttons
  if (buttonId.startsWith('tp_')) {
    await handleThirdPartyButton(buttonId, ctx);
    return;
  }

  const parsed = parseButtonId(buttonId);
  if (!parsed) return; // unrecognised button — silently ignore

  try {
    if (parsed.type === 'rem') {
      await handleReminderButton(parsed.action, parsed.option, parsed.itemId, ctx, contextMessageId);
    } else if (parsed.type === 'task') {
      await handleTaskButton(parsed.action, parsed.option, Number(parsed.itemId), ctx);
    } else {
      await handleUclaButton(parsed.action, parsed.option, Number(parsed.itemId), ctx);
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
  ctx: Ctx,
  contextMessageId: string | null,
) {
  const from = ctx.userId;
  const reminders = await getReminders(ctx.userId);
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
    if (reminder) await removeReminder(ctx.userId, reminderId);
    await sendMessage(from, `✅ Done: _"${title}"_`);
    return;
  }

  const fireAt = getSnoozeDate(option!, ctx.timezone);
  const newMessageId = await scheduleOnce('/internal/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    reminderId,
    title,
    phoneNumber,
    userId: ctx.userId,
  });

  if (reminder) {
    await updateReminder(ctx.userId, reminderId, { fireAt: fireAt.toISOString(), messageId: newMessageId });
  } else {
    const fresh: PendingReminder = { id: reminderId, title, phoneNumber, fireAt: fireAt.toISOString(), messageId: newMessageId };
    await saveReminder(ctx.userId, fresh);
  }

  await sendMessage(from, `⏰ Snoozed: _"${title}"_\nNew time: ${fireAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ctx.timezone })}`);
}

async function handleTaskButton(
  action: 'snooze' | 'done',
  option: SnoozeOption | null,
  taskId: number,
  ctx: Ctx,
) {
  const from = ctx.userId;
  const tasks = await getTasks(ctx.userId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    await sendMessage(from, '❌ Task not found.');
    return;
  }

  if (task.qstashMessageId) {
    await cancelMessage(task.qstashMessageId).catch(() => null);
  }

  if (action === 'done') {
    await markTaskDone(ctx.userId, taskId);
    await sendMessage(from, `✅ *Task done!* _"${task.title}"_`);
    if (task.thirdPartyPhone && await canNotifyThirdParty(ctx.userId, task.thirdPartyPhone)) {
      await sendMessage(task.thirdPartyPhone, `✅ _"${task.title}"_ is done!`).catch(() => null);
    }
    return;
  }

  const fireAt = getSnoozeDate(option!, ctx.timezone);
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    taskId,
    title: task.title,
    phoneNumber: from,
    userId: ctx.userId,
  });
  await updateTaskQStashId(ctx.userId, taskId, newMessageId);
  await sendMessage(from, `⏰ Task snoozed: _"${task.title}"_\nNew time: ${fireAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ctx.timezone })}`);
}

async function handleUclaButton(
  action: 'snooze' | 'done',
  option: SnoozeOption | null,
  uclaId: number,
  ctx: Ctx,
) {
  const from = ctx.userId;
  const item = await getUclaItem(ctx.userId, uclaId);
  if (!item) {
    await sendMessage(from, '❌ UCLA item not found.');
    return;
  }

  if (item.qstashMessageId) {
    await cancelMessage(item.qstashMessageId).catch(() => null);
  }

  if (action === 'done') {
    // Also drop the automatic due reminder, or it fires for a completed item.
    if (item.dueReminderId) {
      await cancelMessage(item.dueReminderId).catch(() => null);
    }
    await markUclaItemDone(ctx.userId, uclaId);
    await sendMessage(from, `✅ Done! _"${item.text}"_ marked as completed.`);
    return;
  }

  const fireAt = getSnoozeDate(option!, ctx.timezone);
  const newMessageId = await scheduleOnce('/internal/ucla/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    uclaItemId: uclaId,
    text: item.text,
    phoneNumber: from,
    userId: ctx.userId,
  });
  await updateUclaItemReminder(ctx.userId, uclaId, fireAt.toISOString(), newMessageId);
  await sendMessage(from, `⏰ UCLA item snoozed: _"${item.text}"_\nNew time: ${fireAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ctx.timezone })}`);
}

// tp_rem_<id> | tp_task_<id> | tp_cal_<id>
async function handleThirdPartyButton(buttonId: string, ctx: Ctx): Promise<void> {
  const from = ctx.userId;
  const parts = buttonId.split('_');
  if (parts.length < 3 || parts[0] !== 'tp') return;
  const type = parts[1];
  const pendingId = parts.slice(2).join('_');

  if (!['rem', 'task', 'cal'].includes(type)) {
    await sendMessage(from, '❌ Unrecognized action type.');
    return;
  }

  const pending = await removePendingEvent(ctx.userId, pendingId);
  if (!pending) {
    await sendMessage(from, '❌ This request has already been handled or expired.');
    return;
  }

  const timezone = ctx.timezone;
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
      await removeReminder(ctx.userId, pending.reminderId).catch(() => null);

      const task = await addTask(ctx.userId, { title: pending.title || `From ${pending.senderAlias}`, dueDate: target.toISOString(), dueTime: pending.atValue, thirdPartyPhone: pending.senderPhone });
      const delaySeconds = Math.floor((target.getTime() - Date.now()) / 1000);
      if (delaySeconds > 0) {
        const msgId = await scheduleOnce(
          '/internal/task/reminder/fire',
          delaySeconds,
          { taskId: task.id, title: task.title, phoneNumber: from, userId: ctx.userId }
        );
        await updateTaskQStashId(ctx.userId, task.id, msgId);
      }

      await sendMessage(from, `✅ *Moved to task* (#${task.id})\n📌 ${titleDisplay}\n📅 ${dateLabel}\n_From ${pending.senderAlias}_`);

    } else if (type === 'cal') {
      // Cancel the auto-saved reminder, create calendar event instead
      if (pending.reminderMessageId) {
        await cancelMessage(pending.reminderMessageId).catch(() => null);
      }
      await removeReminder(ctx.userId, pending.reminderId).catch(() => null);

      const account = await resolveAccount(ctx.userId, 'calendar');
      if (!account) {
        await sendMessage(from, '❌ No calendar account connected. Visit the admin panel.');
        return;
      }

      const endDatetime = new Date(target.getTime() + 60 * 60 * 1000);
      await createEvent(ctx.userId, account, {
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
