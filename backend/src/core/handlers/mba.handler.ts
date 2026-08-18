import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../../shared/kapso/client';
import { Ctx } from '../../shared/ctx';
import {
  getMbaItems,
  addMbaItem,
  markMbaItemDone,
  updateMbaItem,
} from '../integrations/local/mba';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../../shared/utils/date';
import { scheduleOnce, cancelMessage } from '../../shared/qstash/client';

const DUE_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

// A due date with no time means "by the end of that day". This deliberately
// does NOT use settings.defaultTaskTime, which is the default time for a
// *reminder*, not a deadline. The admin panel applies the same 23:59 default,
// so both entry points agree.
const DUE_DEFAULT_TIME = '23:59';

/**
 * Schedules the automatic "due in 24h" reminder. Returns the QStash id, or
 * undefined when the lead time has already passed (i.e. the item is due within
 * 24 hours, so a 24h-before reminder would fire in the past).
 */
async function scheduleDueReminder(
  ctx: Ctx,
  itemId: number,
  text: string,
  dueAt: Date,
  phoneNumber: string
): Promise<string | undefined> {
  const fireAt = dueAt.getTime() - DUE_REMINDER_LEAD_MS;
  const delaySeconds = Math.floor((fireAt - Date.now()) / 1000);
  if (delaySeconds <= 0) return undefined;

  return scheduleOnce('/internal/mba/due/fire', delaySeconds, {
    mbaItemId: itemId,
    text,
    dueAt: dueAt.toISOString(),
    phoneNumber,
    userId: ctx.userId,
  });
}

export async function mbaHandler(parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const from = ctx.userId;
  const text = parsed.extraArgs.join(' ').trim();
  const doneFlag = parsed.flags['done'];
  const dueFlag = parsed.flags['due'];
  const forFlag = parsed.flags['for'];
  const atFlag = parsed.flags['at'];

  if (atFlag?.toLowerCase() === 'day') {
    await sendMessage(from, '❌ @day is only supported by /schedule.');
    return;
  }

  try {
    const tz = ctx.timezone;

    // /mba --done N  →  mark item as done
    if (doneFlag !== undefined) {
      const n = parseInt(doneFlag, 10);
      if (isNaN(n)) {
        await sendMessage(from, '❌ Use `/mba --done N` where N is the item number from `/mba`.');
        return;
      }
      const items = await getMbaItems(ctx.userId);
      const item = items[n - 1];
      if (!item) {
        await sendMessage(from, `❌ No item #${n}. Send \`/mba\` to see your list.`);
        return;
      }
      const done = await markMbaItemDone(ctx.userId, item.id);
      // Cancel both the user's reminder and the automatic due reminder.
      for (const id of [done?.qstashMessageId, done?.dueReminderId]) {
        if (id) await cancelMessage(id).catch(() => null);
      }
      await sendMessage(from, `✅ Done! _"${item.text}"_ marked as completed.`);
      return;
    }

    // /mba <text> [--due date] [--for date --at time]  →  add item
    if (text) {
      let dueAt: Date | undefined;
      if (dueFlag) {
        const dueDate = parseDate(dueFlag, tz);
        if (!dueDate) {
          await sendMessage(from, `❌ Could not parse due date: "${dueFlag}". Try "tomorrow", "next friday", or DD-MM-YYYY.`);
          return;
        }
        dueAt = combineDateAndTime(dueDate, DUE_DEFAULT_TIME, tz);
      }

      let reminderAt: Date | undefined;
      if (forFlag && atFlag) {
        const date = parseDate(forFlag, tz);
        if (!date) {
          await sendMessage(from, `❌ Could not parse date: "${forFlag}".`);
          return;
        }
        reminderAt = combineDateAndTime(date, atFlag, tz);
        if (reminderAt.getTime() <= Date.now()) {
          await sendMessage(from, '❌ Reminder time is in the past.');
          return;
        }
      } else if (forFlag && !atFlag) {
        await sendMessage(from, '❌ Please add a time with --at (e.g. --at 09:00 or @09:00).');
        return;
      }

      const item = await addMbaItem(ctx.userId, text, { dueDate: dueAt?.toISOString() });

      const lines = [`✅ Added to MBA list! (#${item.id})`];

      if (dueAt) {
        lines.push(`📅 Due ${formatDate(dueAt, true, tz)} at ${formatTime(dueAt, tz)}`);
        const dueReminderId = await scheduleDueReminder(ctx, item.id, text, dueAt, from);
        if (dueReminderId) {
          await updateMbaItem(ctx.userId, item.id, { dueReminderId });
          const remindAt = new Date(dueAt.getTime() - DUE_REMINDER_LEAD_MS);
          lines.push(`🔔 I'll remind you 24h before — ${formatDate(remindAt, true, tz)} at ${formatTime(remindAt, tz)}`);
        } else {
          lines.push('⚠️ Due in under 24h, so no automatic 24h reminder was set.');
        }
      }

      if (reminderAt) {
        const messageId = await scheduleOnce(
          '/internal/mba/reminder/fire',
          Math.floor((reminderAt.getTime() - Date.now()) / 1000),
          { mbaItemId: item.id, text, phoneNumber: from, userId: ctx.userId }
        );
        await updateMbaItem(ctx.userId, item.id, { reminderFor: reminderAt.toISOString(), qstashMessageId: messageId });
        lines.push(`⏰ Reminder set for ${formatDate(reminderAt, true, tz)} at ${formatTime(reminderAt, tz)}`);
      }

      await sendMessage(from, lines.join('\n'));
      return;
    }

    // /mba  →  list pending items
    const items = await getMbaItems(ctx.userId);
    if (items.length === 0) {
      await sendMessage(from, '✅ MBA list is clear!');
      return;
    }
    const lines = ['🎓 *MBA list:*\n'];
    items.forEach((item, i) => {
      const parts: string[] = [];
      if (item.dueDate) {
        const due = new Date(item.dueDate);
        parts.push(`📅 due ${formatDate(due, true, tz)}`);
      }
      if (item.reminderFor) {
        const rem = new Date(item.reminderFor);
        parts.push(`⏰ ${formatDate(rem, true, tz)} ${formatTime(rem, tz)}`);
      }
      const suffix = parts.length ? ` _(${parts.join(' · ')})_` : '';
      lines.push(`${i + 1}. ${item.text}${suffix}`);
    });
    lines.push('\n_Use `/mba --done N` to mark an item done._');
    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
