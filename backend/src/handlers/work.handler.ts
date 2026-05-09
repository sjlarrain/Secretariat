import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';
import { getWorkItems, addWorkItem, markWorkItemDone, updateWorkItemReminderId } from '../integrations/local/work';
import { getSettings } from '../integrations/token-store';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { scheduleOnce, cancelMessage } from '../qstash/client';

export async function workHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const text = parsed.extraArgs.join(' ').trim();
  const doneFlag = parsed.flags['done'];
  const forFlag = parsed.flags['for'];
  const atFlag = parsed.flags['at'];

  try {
    const settings = await getSettings();
    const tz = settings.timezone;

    // /work --done N  →  mark item as done
    if (doneFlag !== undefined) {
      const n = parseInt(doneFlag, 10);
      if (isNaN(n)) {
        await sendMessage(from, '❌ Use `/work --done N` where N is the item number from `/work`.');
        return;
      }
      const items = await getWorkItems();
      const item = items[n - 1];
      if (!item) {
        await sendMessage(from, `❌ No item #${n}. Send \`/work\` to see your list.`);
        return;
      }
      const done = await markWorkItemDone(item.id);
      if (done?.qstashMessageId) {
        await cancelMessage(done.qstashMessageId).catch(() => null);
      }
      await sendMessage(from, `✅ Done! _"${item.text}"_ marked as completed.`);
      return;
    }

    // /work <text> [--for date --at time]  →  add item
    if (text) {
      let reminderPayload: { reminderFor: string; qstashMessageId: string } | undefined;

      if (forFlag && atFlag) {
        const date = parseDate(forFlag, tz);
        if (!date) {
          await sendMessage(from, `❌ Could not parse date: "${forFlag}". Try "tomorrow", "next friday", or DD-MM-YYYY.`);
          return;
        }
        const fireAt = combineDateAndTime(date, atFlag, tz);
        if (fireAt.getTime() <= Date.now()) {
          await sendMessage(from, '❌ Reminder time is in the past.');
          return;
        }

        const newItem = await addWorkItem(text, { reminderFor: fireAt.toISOString(), qstashMessageId: '' });
        const messageId = await scheduleOnce(
          `/internal/work/reminder/fire`,
          Math.floor((fireAt.getTime() - Date.now()) / 1000),
          { workItemId: newItem.id, text, phoneNumber: from }
        );
        await updateWorkItemReminderId(newItem.id, messageId);

        const dateLabel = `${formatDate(fireAt, true, tz)} at ${formatTime(fireAt, tz)}`;
        await sendMessage(from, `✅ Added to work list! (#${newItem.id})\n⏰ Reminder set for ${dateLabel}`);
        return;
      }

      if (forFlag && !atFlag) {
        await sendMessage(from, '❌ Please add a time with --at (e.g. --at 09:00 or @09:00).');
        return;
      }

      const item = await addWorkItem(text);
      await sendMessage(from, `✅ Added to work list! (#${item.id})`);
      return;
    }

    // /work  →  list pending items
    const items = await getWorkItems();
    if (items.length === 0) {
      await sendMessage(from, '✅ Work list is clear!');
      return;
    }
    const lines = ['📋 *Work list:*\n'];
    items.forEach((item, i) => {
      const reminderLabel = item.reminderFor
        ? ` _(⏰ ${formatDate(new Date(item.reminderFor), true, tz)} ${formatTime(new Date(item.reminderFor), tz)})_`
        : '';
      lines.push(`${i + 1}. ${item.text}${reminderLabel}`);
    });
    lines.push('\n_Use `/work --done N` to mark an item done._');
    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
