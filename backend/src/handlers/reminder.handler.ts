import { ParsedCommand } from '../parser/command.parser';
import { scheduleOnce } from '../qstash/client';
import { Ctx } from '../ctx';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { saveReminder } from '../integrations/local/reminders';
import { sendMessage } from '../kapso/client';
import { randomUUID } from 'crypto';

export async function reminderHandler(parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const from = ctx.userId;
  const { flags, extraArgs } = parsed;

  const title = flags['title'] || extraArgs.join(' ').trim();
  if (!title) {
    await sendMessage(from, '❌ Missing title. Use --title or write it right after /reminder.');
    return;
  }

  if (flags['at']?.toLowerCase() === 'day') {
    await sendMessage(from, '❌ @day is only supported by /schedule.');
    return;
  }

  const date = parseDate(flags['for'], ctx.timezone);
  if (!date) {
    await sendMessage(from, `❌ Could not parse date: "${flags['for']}".`);
    return;
  }

  const target = combineDateAndTime(date, flags['at'], ctx.timezone);
  const now = Date.now();

  if (target.getTime() <= now) {
    await sendMessage(from, '❌ Reminder time is in the past.');
    return;
  }

  const delaySeconds = Math.floor((target.getTime() - now) / 1000);
  const id = randomUUID();
  const MAX_QSTASH_DELAY = 7 * 24 * 60 * 60; // 7 days in seconds

  try {
    if (delaySeconds > MAX_QSTASH_DELAY) {
      await saveReminder(ctx.userId, { id, title, phoneNumber: from, fireAt: target.toISOString(), messageId: '', deferred: true });
      await sendMessage(
        from,
        `⏰ *Reminder set (deferred)*\n📌 ${title}\n📅 ${formatDate(target, false, ctx.timezone)} at ${formatTime(target, ctx.timezone)}\n_Will be promoted to queue within 7 days of fire time._`
      );
    } else {
      const messageId = await scheduleOnce('/internal/reminder/fire', delaySeconds, {
        reminderId: id,
        title,
        phoneNumber: from,
        userId: ctx.userId,
      });
      await saveReminder(ctx.userId, { id, title, phoneNumber: from, fireAt: target.toISOString(), messageId });
      await sendMessage(
        from,
        `⏰ *Reminder set*\n📌 ${title}\n📅 ${formatDate(target, false, ctx.timezone)} at ${formatTime(target, ctx.timezone)}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not set reminder: ${msg}`);
  }
}
