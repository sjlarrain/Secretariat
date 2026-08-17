import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../../shared/kapso/client';
import { Ctx } from '../../shared/ctx';
import { env } from '../../shared/env';
import { createPanelLoginToken } from '../../auth/panel-sessions';

export async function panelHandler(_parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const token = await createPanelLoginToken(ctx.userId);
  const link = `${env.BASE_URL}/panel/login/${token}`;
  await sendMessage(
    ctx.userId,
    `🔑 Your panel link (one-time use, valid 10 minutes):\n${link}`
  );
}
