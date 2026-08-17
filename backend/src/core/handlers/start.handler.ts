import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../../shared/kapso/client';
import { Ctx } from '../../shared/ctx';

export async function startHandler(_parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  await sendMessage(ctx.userId, '👋 *Secretariat is awake!*\nSend /menu to see all available commands.');
}
