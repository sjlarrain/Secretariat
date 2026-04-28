import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';

export async function startHandler(_parsed: ParsedCommand, from: string): Promise<void> {
  await sendMessage(from, '👋 *Secretariat is awake!*\nSend /menu to see all available commands.');
}
