import { getReminders, updateReminder } from '../integrations/local/reminders';
import { scheduleOnce } from '../qstash/client';

const PROMOTE_WINDOW = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export async function promoteDeferred(userId: string): Promise<{ promoted: number; skipped: number }> {
  const reminders = await getReminders(userId);
  const deferred = reminders.filter((r) => r.deferred);
  const now = Date.now();

  let promoted = 0;
  let skipped = 0;

  for (const r of deferred) {
    const fireAt = new Date(r.fireAt).getTime();
    if (fireAt <= now) {
      skipped++;
      continue;
    }
    const delay = fireAt - now;
    if (delay > PROMOTE_WINDOW) {
      skipped++;
      continue;
    }
    const delaySeconds = Math.floor(delay / 1000);
    const messageId = await scheduleOnce('/internal/reminder/fire', delaySeconds, {
      reminderId: r.id,
      title: r.title,
      phoneNumber: r.phoneNumber,
      userId,
    });
    await updateReminder(userId, r.id, { messageId, deferred: false });
    promoted++;
  }

  return { promoted, skipped };
}
