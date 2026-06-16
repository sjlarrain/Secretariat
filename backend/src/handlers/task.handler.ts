import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';
import { getTasks, addTask, markTaskDone, updateTaskQStashId, setTaskGoogleId, LocalTask } from '../integrations/local/tasks';
import { canNotifyThirdParty } from '../integrations/local/third-party';
import { getSettings } from '../integrations/token-store';
import { resolveAccount } from '../integrations/registry';
import { createTask as createGoogleTask, completeTask as completeGoogleTask } from '../integrations/google/tasks';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { scheduleOnce, cancelMessage } from '../qstash/client';

async function pushTaskToGoogle(task: LocalTask): Promise<void> {
  try {
    const account = await resolveAccount('tasks');
    if (!account || account.isDisconnected) return;
    const tz = (await getSettings()).timezone;
    const dueDate = task.dueDate ? combineDateAndTime(new Date(task.dueDate), task.dueTime ?? '00:00', tz) : undefined;
    const { taskId } = await createGoogleTask(account, { title: task.title, dueDate });
    await setTaskGoogleId(task.id, taskId);
  } catch (err) {
    console.error('Best-effort Google Tasks push (create) failed:', err);
  }
}

async function pushTaskDoneToGoogle(task: LocalTask): Promise<void> {
  if (!task.googleTaskId) return;
  try {
    const account = await resolveAccount('tasks');
    if (!account || account.isDisconnected) return;
    await completeGoogleTask(account, task.googleTaskId);
  } catch (err) {
    console.error('Best-effort Google Tasks push (complete) failed:', err);
  }
}

export async function taskHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const { flags, extraArgs } = parsed;

  try {
    const settings = await getSettings();
    const tz = settings.timezone;
    const projectFlag = flags['project'] as string | undefined;
    const forFlag = flags['for'];
    const atFlag = flags['at'];

    // /task done <id>  →  mark task done
    if (extraArgs[0] === 'done') {
      const id = parseInt(extraArgs[1] ?? '', 10);
      if (isNaN(id)) {
        await sendMessage(from, '❌ Use `/task done <id>` — get the ID from `/task`.');
        return;
      }
      const task = await markTaskDone(id);
      if (!task) {
        await sendMessage(from, `❌ Task #${id} not found or already done.`);
        return;
      }
      if (task.qstashMessageId) {
        await cancelMessage(task.qstashMessageId).catch(() => null);
      }
      await pushTaskDoneToGoogle(task);
      await sendMessage(from, `✅ *Task done!* _"${task.title}"_`);
      if (task.thirdPartyPhone && await canNotifyThirdParty(task.thirdPartyPhone)) {
        await sendMessage(task.thirdPartyPhone, `✅ _"${task.title}"_ is done!`).catch(() => null);
      }
      return;
    }

    const title = extraArgs.join(' ').trim();

    // /task or /task -p <project>  →  list tasks
    if (!title) {
      const tasks = await getTasks();

      if (projectFlag !== undefined) {
        const name = projectFlag.trim();
        if (!name) {
          // /task -p  →  list all project names
          const projects = [...new Set(tasks.map((t) => t.project ?? 'General').sort())];
          if (projects.length === 0) {
            await sendMessage(from, '📋 No open tasks yet. Send `/task <title>` to add one.');
            return;
          }
          const lines = projects.map((p) => {
            const count = tasks.filter((t) => (t.project ?? 'General') === p).length;
            return `📁 ${p} — ${count} task${count !== 1 ? 's' : ''}`;
          });
          await sendMessage(from, `📁 *Task projects:*\n\n${lines.join('\n')}`);
          return;
        }
        // /task -p groceries  →  list tasks in that project
        const filtered = tasks.filter((t) => (t.project ?? 'General').toLowerCase() === name.toLowerCase());
        if (filtered.length === 0) {
          await sendMessage(from, `📋 No open tasks in *${name}*.`);
          return;
        }
        const lines = filtered.map((t) => {
          const due = t.dueDate ? ` _(📅 ${formatDate(new Date(t.dueDate), false, tz)} ${t.dueTime ?? ''})_`.trimEnd() : '';
          return `${t.id}. ${t.title}${due}`;
        });
        await sendMessage(from, `📋 *${name}:*\n${lines.join('\n')}`);
        return;
      }

      // /task  →  list all open tasks grouped by project
      if (tasks.length === 0) {
        await sendMessage(from, '📋 No open tasks. Send `/task <title>` to add one.');
        return;
      }
      const grouped = new Map<string, typeof tasks>();
      for (const t of tasks) {
        const key = t.project ?? 'General';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(t);
      }
      const sections: string[] = [];
      for (const [project, items] of grouped) {
        const lines = items.map((t) => {
          const due = t.dueDate ? ` _(📅 ${formatDate(new Date(t.dueDate), false, tz)} ${t.dueTime ?? ''})_`.trimEnd() : '';
          return `  ${t.id}. ${t.title}${due}`;
        });
        sections.push(`*${project}:*\n${lines.join('\n')}`);
      }
      sections.push('_Use `/task done <id>` to mark a task done._');
      await sendMessage(from, `📋 *Tasks:*\n\n${sections.join('\n\n')}`);
      return;
    }

    // /task <title> [flags]  →  create task
    let dueDate: string | undefined;
    let dueTime: string | undefined;
    let qstashMessageId: string | undefined;

    if (forFlag) {
      const parsed = parseDate(forFlag, tz);
      if (!parsed) {
        await sendMessage(from, `❌ Could not parse date: "${forFlag}". Try "tomorrow", "next friday", or DD-MM-YYYY.`);
        return;
      }

      const timeStr = atFlag ?? settings.defaultTaskTime;
      const fireAt = combineDateAndTime(parsed, timeStr, tz);

      if (fireAt.getTime() <= Date.now()) {
        await sendMessage(from, '❌ Due date/time is in the past.');
        return;
      }

      dueDate = parsed.toISOString();
      dueTime = timeStr;

      const task = await addTask({ title, project: projectFlag, dueDate, dueTime });
      const msgId = await scheduleOnce(
        '/internal/task/reminder/fire',
        Math.floor((fireAt.getTime() - Date.now()) / 1000),
        { taskId: task.id, title, phoneNumber: from }
      );
      await updateTaskQStashId(task.id, msgId);
      await pushTaskToGoogle(task);

      const dateLabel = `${formatDate(fireAt, true, tz)} at ${formatTime(fireAt, tz)}`;
      const projectLabel = projectFlag ? ` in *${projectFlag}*` : '';
      await sendMessage(from, `✅ *Task saved!* (#${task.id})${projectLabel}\n📌 ${title}\n⏰ Reminder: ${dateLabel}`);
      return;
    }

    // No date — just save
    const task = await addTask({ title, project: projectFlag, dueDate, dueTime });
    await pushTaskToGoogle(task);
    const projectLabel = projectFlag ? ` in *${projectFlag}*` : '';
    await sendMessage(from, `✅ *Task saved!* (#${task.id})${projectLabel}\n📌 ${title}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
