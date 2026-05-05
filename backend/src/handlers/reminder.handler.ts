import { ParsedCommand } from '../parser/command.parser';
import { scheduleOnce, cancelMessage } from '../qstash/client';
import { getSettings } from '../integrations/token-store';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { saveReminder, getReminders, updateReminder } from '../integrations/local/reminders';
import { sendMessage } from '../kapso/client';
import { randomUUID } from 'crypto';

export async function reminderHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;
  const settings = await getSettings();
  const tz = settings.timezone;

  // ── List mode: /reminder list ──────────────────────
  if (extraArgs[0] === 'list') {
    const all = await getReminders();
    const mine = all.filter((r) => r.phoneNumber === from);
    if (mine.length === 0) {
      await sendMessage(from, '⏰ No pending reminders.');
      return;
    }
    const lines = ['⏰ *Pending reminders:*\n'];
    mine.forEach((r, i) => {
      const d = new Date(r.fireAt);
      lines.push(`${i + 1}. ${r.title} — ${formatDate(d, false, tz)} at ${formatTime(d, tz)}`);
    });
    await sendMessage(from, lines.join('\n'));
    return;
  }

  // ── Edit mode: /reminder edit <n> --at HH:MM [--for date] ──
  if (extraArgs[0] === 'edit') {
    const n = parseInt(extraArgs[1], 10);
    const all = await getReminders();
    const mine = all.filter((r) => r.phoneNumber === from);

    if (isNaN(n) || n < 1 || n > mine.length) {
      await sendMessage(from, `❌ Invalid reminder number. Use /reminder list to see your reminders.`);
      return;
    }

    const reminder = mine[n - 1];
    const existingDate = new Date(reminder.fireAt);

    let newDate: Date;
    if (flags['for']) {
      const parsed = parseDate(flags['for'], tz);
      if (!parsed) {
        await sendMessage(from, `❌ Could not parse date: "${flags['for']}".`);
        return;
      }
      newDate = parsed;
    } else {
      newDate = existingDate;
    }

    const timeStr = flags['at'] || formatTime(existingDate, tz);
    const target = combineDateAndTime(newDate, timeStr, tz);
    const now = Date.now();

    if (target.getTime() <= now) {
      await sendMessage(from, '❌ New reminder time is in the past.');
      return;
    }

    try {
      await cancelMessage(reminder.messageId);
    } catch {
      // message may have already fired; proceed
    }

    const delaySeconds = Math.floor((target.getTime() - now) / 1000);

    try {
      const newMessageId = await scheduleOnce('/internal/reminder/fire', delaySeconds, {
        reminderId: reminder.id,
        title: reminder.title,
        phoneNumber: from,
      });

      await updateReminder(reminder.id, { fireAt: target.toISOString(), messageId: newMessageId });

      await sendMessage(
        from,
        `✅ *Reminder updated*\n📌 ${reminder.title}\n📅 ${formatDate(target, false, tz)} at ${formatTime(target, tz)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sendMessage(from, `❌ Could not update reminder: ${msg}`);
    }
    return;
  }

  // ── Create mode ────────────────────────────────────
  const title = flags['title'] || extraArgs.join(' ').trim();
  if (!title) {
    await sendMessage(from, '❌ Missing title. Use --title or write it right after /reminder.');
    return;
  }

  const date = parseDate(flags['for'], tz);
  if (!date) {
    await sendMessage(from, `❌ Could not parse date: "${flags['for']}".`);
    return;
  }

  const target = combineDateAndTime(date, flags['at'], tz);
  const now = Date.now();

  if (target.getTime() <= now) {
    await sendMessage(from, '❌ Reminder time is in the past.');
    return;
  }

  const delaySeconds = Math.floor((target.getTime() - now) / 1000);
  const id = randomUUID();

  try {
    const messageId = await scheduleOnce('/internal/reminder/fire', delaySeconds, {
      reminderId: id,
      title,
      phoneNumber: from,
    });

    await saveReminder({ id, title, phoneNumber: from, fireAt: target.toISOString(), messageId });

    await sendMessage(
      from,
      `⏰ *Reminder set*\n📌 ${title}\n📅 ${formatDate(target, false, tz)} at ${formatTime(target, tz)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not set reminder: ${msg}`);
  }
}
