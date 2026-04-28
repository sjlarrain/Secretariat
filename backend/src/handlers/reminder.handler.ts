import { ParsedCommand } from '../parser/command.parser';
import { scheduleOnce } from '../qstash/client';
import { getSettings } from '../integrations/token-store';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function reminderHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags } = parsed;
  const settings = await getSettings();

  const date = parseDate(flags['for'], settings.timezone);
  if (!date) {
    await sendMessage(from, `❌ Could not parse date: "${flags['for']}".`);
    return;
  }

  const target = combineDateAndTime(date, flags['at']);
  const now = Date.now();

  if (target.getTime() <= now) {
    await sendMessage(from, '❌ Reminder time is in the past.');
    return;
  }

  const delaySeconds = Math.floor((target.getTime() - now) / 1000);

  try {
    await scheduleOnce('/internal/reminder/fire', delaySeconds, {
      title: flags['title'],
      phoneNumber: from,
    });

    await sendMessage(
      from,
      `⏰ *Reminder set*\n📌 ${flags['title']}\n📅 ${formatDate(target)} at ${formatTime(target)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not set reminder: ${msg}`);
  }
}
