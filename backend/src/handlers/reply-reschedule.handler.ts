import { getReplyTarget } from '../integrations/local/wa-reply-map';
import { getSettings } from '../integrations/token-store';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';
import { scheduleOnce, cancelMessage } from '../qstash/client';
import { getReminders, updateReminder, saveReminder } from '../integrations/local/reminders';
import { getTasks, updateTaskQStashId } from '../integrations/local/tasks';
import { getWorkItem, updateWorkItemReminder } from '../integrations/local/work';

// Extracts --for / -f and --at / -a / @HH:MM from a plain text reply.
function extractRescheduleFlags(text: string): { forStr: string | null; atStr: string | null } {
  const normalized = text.replace(/—/g, '--').trim();
  const forMatch = normalized.match(/(?:--for|-f)\s+(.+?)(?=\s+--|@\d{1,2}:\d{2}|$)/i);
  const atMatch = normalized.match(/(?:--at|-a)\s+(\d{1,2}:\d{2})|@(\d{1,2}:\d{2})/i);
  return {
    forStr: forMatch?.[1]?.trim() ?? null,
    atStr: atMatch?.[1] ?? atMatch?.[2] ?? null,
  };
}

// Returns true if the reply was handled (matched a known reminder/task/work message).
export async function replyRescheduleHandler(contextMessageId: string, text: string, from: string): Promise<boolean> {
  const target = await getReplyTarget(contextMessageId);
  if (!target) return false;

  const settings = await getSettings();
  const { timezone, defaultTaskTime } = settings;
  const time = defaultTaskTime ?? '09:00';

  const { forStr, atStr } = extractRescheduleFlags(text);
  if (!forStr) {
    await sendMessage(from, '❌ Reply with `--for <date>` to reschedule.\nExample: `--for tomorrow --at 15:00`');
    return true;
  }

  const date = parseDate(forStr, timezone);
  if (!date) {
    await sendMessage(from, `❌ Could not parse date: "${forStr}"`);
    return true;
  }

  const fireAt = combineDateAndTime(date, atStr ?? time, timezone);
  if (fireAt.getTime() <= Date.now()) {
    await sendMessage(from, '❌ That date is in the past.');
    return true;
  }

  const delaySeconds = Math.floor((fireAt.getTime() - Date.now()) / 1000);
  const label = `${formatDate(fireAt, false, timezone)} at ${formatTime(fireAt, timezone)}`;

  try {
    if (target.type === 'rem') {
      // The reminder is deleted from Redis the moment it fires (routes/internal.ts),
      // so fall back to the title/phone cached in the wa-reply-map (`target`) and
      // re-save the reminder if it's no longer there.
      const reminders = await getReminders();
      const reminder = reminders.find((r) => r.id === target.id);
      if (reminder) {
        await cancelMessage(reminder.messageId).catch(() => null);
      }
      const newMessageId = await scheduleOnce('/internal/reminder/fire', delaySeconds, {
        reminderId: target.id,
        title: target.title,
        phoneNumber: target.phoneNumber,
      });
      if (reminder) {
        await updateReminder(target.id, { fireAt: fireAt.toISOString(), messageId: newMessageId });
      } else {
        await saveReminder({ id: target.id, title: target.title, phoneNumber: target.phoneNumber, fireAt: fireAt.toISOString(), messageId: newMessageId });
      }
      await sendMessage(from, `⏰ Rescheduled: _"${target.title}"_\nNew time: ${label}`);

    } else if (target.type === 'task') {
      const taskId = Number(target.id);
      const tasks = await getTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        await sendMessage(from, '❌ Task not found.');
        return true;
      }
      if (task.qstashMessageId) await cancelMessage(task.qstashMessageId).catch(() => null);
      const newMessageId = await scheduleOnce('/internal/task/reminder/fire', delaySeconds, {
        taskId,
        title: task.title,
        phoneNumber: from,
      });
      await updateTaskQStashId(taskId, newMessageId);
      await sendMessage(from, `📌 Task rescheduled: _"${task.title}"_\nNew time: ${label}`);

    } else {
      const workId = Number(target.id);
      const item = await getWorkItem(workId);
      if (!item) {
        await sendMessage(from, '❌ Work item not found.');
        return true;
      }
      if (item.qstashMessageId) await cancelMessage(item.qstashMessageId).catch(() => null);
      const newMessageId = await scheduleOnce('/internal/work/reminder/fire', delaySeconds, {
        workItemId: workId,
        text: item.text,
        phoneNumber: from,
      });
      await updateWorkItemReminder(workId, fireAt.toISOString(), newMessageId);
      await sendMessage(from, `📋 Work item rescheduled: _"${item.text}"_\nNew time: ${label}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not reschedule: ${msg}`);
  }

  return true;
}
