import { ParsedCommand } from '../parser/command.parser';
import { resolveAccount } from '../integrations/registry';
import { createTask } from '../integrations/google/tasks';
import { getSettings } from '../integrations/token-store';
import { parseDate, formatDate } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function gtaskHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;
  const settings = await getSettings();

  const title = flags['title'] || extraArgs.join(' ').trim();
  if (!title) {
    await sendMessage(from, '❌ Missing title. Use --title or write it right after /gtask.');
    return;
  }

  const account = await resolveAccount('tasks');
  if (!account) {
    await sendMessage(from, '❌ No Google Tasks account connected. Visit the admin panel.');
    return;
  }

  let dueDate: Date | undefined;
  if (flags['for']) {
    const parsed = parseDate(flags['for'], settings.timezone);
    if (!parsed) {
      await sendMessage(from, `❌ Could not parse date: "${flags['for']}".`);
      return;
    }
    dueDate = parsed;
  }

  try {
    await createTask(account, {
      title,
      dueDate,
      notes: flags['notes'],
    });

    const dueLine = dueDate ? `\n📅 Due ${formatDate(dueDate)}` : '';
    await sendMessage(from, `✅ *Google Task created*\n📌 ${title}${dueLine}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not create task: ${msg}`);
  }
}
