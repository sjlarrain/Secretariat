import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../../shared/kapso/client';
import { Ctx } from '../../shared/ctx';
import { COMMANDS } from '../registries/commands.registry';
import { EXAMPLES } from '../registries/examples.registry';

/** One command's examples in full — `/example schedule`. */
function renderTopic(key: string): string {
  const rows = EXAMPLES[key]!;
  const def = COMMANDS[key];
  const lines = [`💡 *Examples — ${def?.name ?? `/${key}`}*\n`];
  for (const [what, how] of rows) {
    lines.push(`_${what}_`);
    lines.push(`\`\`\`${how}\`\`\``);
    lines.push('');
  }
  lines.push('_Send /menu for every flag, or /example for the short tour._');
  return lines.join('\n');
}

/** The short tour — `/example` with no argument. */
function renderAll(): string {
  const lines = [
    '💡 *Secretariat by example*',
    '',
    'Every message starts with a `/` command. Here are the ones people use most.',
    'Send `/example <command>` — e.g. `/example schedule` — for more of any one.',
    '',
  ];

  // Two per command in the overview: enough to show the shape, short enough
  // that the whole thing stays inside one WhatsApp message.
  for (const [key, rows] of Object.entries(EXAMPLES)) {
    const def = COMMANDS[key];
    lines.push(`*${def?.name ?? `/${key}`}*`);
    for (const [what, how] of rows.slice(0, 2)) {
      lines.push(how);
      lines.push(`  _${what}_`);
    }
    lines.push('');
  }

  lines.push('_Dates take "today", "tomorrow", "next friday", or 25-12-2026._');
  lines.push('_Times take `-a 09:00` or `@09:00`. Full reference: /menu_');
  return lines.join('\n');
}

export async function exampleHandler(parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const from = ctx.userId;
  // Tolerate a leading slash so `/example /task` works as readily as
  // `/example task` — both are natural things to type.
  const topic = (parsed.extraArgs[0] ?? '').trim().toLowerCase().replace(/^\//, '');

  if (!topic) {
    await sendMessage(from, renderAll());
    return;
  }

  if (!EXAMPLES[topic]) {
    const known = Object.keys(EXAMPLES).join(', ');
    await sendMessage(
      from,
      `❌ No examples for "${topic}". Try one of: ${known}.\n\nOr send \`/example\` for the short tour.`
    );
    return;
  }

  await sendMessage(from, renderTopic(topic));
}
