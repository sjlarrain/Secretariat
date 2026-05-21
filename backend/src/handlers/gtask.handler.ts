import { ParsedCommand } from '../parser/command.parser';
import { resolveAccount } from '../integrations/registry';
import { createTask, getPendingTasks } from '../integrations/google/tasks';
import { getSettings } from '../integrations/token-store';
import { parseDate, formatDate } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function gtaskHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;

  const account = await resolveAccount('tasks');
  if (!account) {
    await sendMessage(from, '❌ No Google Tasks account connected. Visit the admin panel.');
    return;
  }

  const title = flags['title'] || extraArgs.join(' ').trim();

  // /gtask  →  list pending Google Tasks
  if (!title) {
    try {
      const tasks = await getPendingTasks(account);
      if (tasks.length === 0) {
        await sendMessage(from, '✅ No pending Google Tasks.');
        return;
      }
      const lines = [`📋 *Google Tasks* (${tasks.length})\n`];
      tasks.forEach((task, i) => {
        const due = task.dueDate ? `📅 ${formatDate(task.dueDate)}` : '_no due date_';
        lines.push(`*${i + 1}.* ${task.title}\n    ${due}`);
      });
      await sendMessage(from, lines.join('\n'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sendMessage(from, `❌ Could not fetch tasks: ${msg}`);
    }
    return;
  }

  // /gtask <title> [--for date] [--notes text]  →  create task
  const settings = await getSettings();

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
    await createTask(account, { title, dueDate, notes: flags['notes'] });
    const dueLine = dueDate ? `\n📅 Due ${formatDate(dueDate)}` : '';
    await sendMessage(from, `✅ *Google Task created*\n📌 ${title}${dueLine}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not create task: ${msg}`);
  }
}
