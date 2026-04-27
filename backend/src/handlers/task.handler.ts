import { ParsedCommand } from '../parser/command.parser';
import { resolveAccount } from '../integrations/registry';
import { createTask } from '../integrations/google/tasks';
import { getSettings } from '../integrations/token-store';
import { parseDate, formatDate } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function taskHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags } = parsed;
  const settings = getSettings();

  const account = resolveAccount('tasks');
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
      title: flags['title'],
      dueDate,
      notes: flags['notes'],
    });

    const duePart = dueDate ? ` due ${formatDate(dueDate)}` : '';
    await sendMessage(from, `✅ Task created: *${flags['title']}*${duePart}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not create task: ${msg}`);
  }
}
