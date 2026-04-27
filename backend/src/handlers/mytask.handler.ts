import { ParsedCommand } from '../parser/command.parser';
import { resolveAccount } from '../integrations/registry';
import { getPendingTasks } from '../integrations/google/tasks';
import { formatDate } from '../utils/date';
import { sendMessage } from '../kapso/client';

export async function mytaskHandler(_parsed: ParsedCommand, from: string): Promise<void> {
  const account = resolveAccount('tasks');
  if (!account) {
    await sendMessage(from, '❌ No Google Tasks account connected. Visit the admin panel.');
    return;
  }

  try {
    const tasks = await getPendingTasks(account);

    if (tasks.length === 0) {
      await sendMessage(from, '✅ No pending tasks.');
      return;
    }

    const lines = ['📋 *Your pending tasks:*\n'];
    for (const task of tasks) {
      const due = task.dueDate ? ` — due ${formatDate(task.dueDate)}` : ' — no due date';
      lines.push(`• ${task.title}${due}`);
    }

    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Could not fetch tasks: ${msg}`);
  }
}
