import { ParsedCommand } from '../parser/command.parser';
import { scheduleOnce } from '../qstash/client';
import { getSettings } from '../integrations/token-store';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { saveReminder } from '../integrations/local/reminders';
import { sendMessage } from '../kapso/client';
import { randomUUID } from 'crypto';

export async function reminderHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;
  const settings = await getSettings();

  const title = flags['title'] || extraArgs.join(' ').trim();
  if (!title) {
    await sendMessage(from, '❌ Missing title. Use --title or write it right after /reminder.');
    return;
  }

  const date = parseDate(flags['for'], settings.timezone);
  if (!date) {
    await sendMessage(from, `❌ Could not parse date: "${flags['for']}".`);
    return;
  }

  const target = combineDateAndTime(date, flags['at'], settings.timezone);
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
      await saveReminder({ id, title, phoneNumber: from, fireAt: target.toISOString(), messageId: '', deferred: true });
      await sendMessage(
        from,
        `⏰ *Reminder set (deferred)*\n📌 ${title}\n📅 ${formatDate(target, false, settings.timezone)} at ${formatTime(target, settings.timezone)}\n_Will be promoted to queue within 7 days of fire time._`
      );
    } else {
      const messageId = await scheduleOnce('/internal/reminder/fire', delaySeconds, {
        reminderId: id,
        title,
        phoneNumber: from,
      });
      await saveReminder({ id, title, phoneNumber: from, fireAt: target.toISOString(), messageId });
      await sendMessage(
        from,
        `⏰ *Reminder set*\n📌 ${title}\n📅 ${formatDate(target, false, settings.timezone)} at ${formatTime(target, settings.timezone)}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not set reminder: ${msg}`);
  }
}
