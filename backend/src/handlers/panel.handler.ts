import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';
import { Ctx } from '../ctx';
import { env } from '../env';
import { createPanelLoginToken } from '../integrations/local/panel-sessions';

export async function panelHandler(_parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const token = await createPanelLoginToken(ctx.userId);
  const link = `${env.BASE_URL}/panel/login/${token}`;
  await sendMessage(
    ctx.userId,
    `🔑 Your panel link (one-time use, valid 10 minutes):\n${link}`
  );
}
