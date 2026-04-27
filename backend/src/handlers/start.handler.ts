import { ParsedCommand } from '../parser/command.parser';
import { COMMANDS } from '../registries/commands.registry';
import { FLAGS } from '../registries/flags.registry';
import { sendMessage } from '../kapso/client';

export async function startHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const lines: string[] = ['🤖 *WhatsApp Command Bot*\n'];

  for (const [, cmd] of Object.entries(COMMANDS)) {
    lines.push(`*${cmd.name}* — ${cmd.description}`);
    for (const flagKey of cmd.acceptedFlags) {
      const flag = FLAGS[flagKey];
      const alias = flag.alias ? ` (or ${flag.alias})` : '';
      const required = cmd.requiredFlags.includes(flagKey) ? ' _(required)_' : '';
      lines.push(`  ${flag.name}${alias}   ${flag.description}${required}`);
    }
    lines.push('');
  }

  await sendMessage(from, lines.join('\n'));
}
