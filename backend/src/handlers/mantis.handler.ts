import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';
import { Ctx } from '../ctx';
import { captureNote, MantisUnavailableError } from '../integrations/mantis';

export async function mantisHandler(parsed: ParsedCommand, ctx: Ctx, messageId: string | null): Promise<void> {
  const from = ctx.userId;
  const text = parsed.extraArgs.join(' ').trim();

  if (!text) {
    await sendMessage(from, '❌ Usage: `/mantis <text>` — e.g. `/mantis met Karla from Ring, follow up in 2 weeks`.');
    return;
  }

  // Falls back to a synthetic ref when Kapso didn't deliver a message id, so the
  // note still saves — it just loses the idempotency guarantee on webhook replay.
  const sourceRef = messageId ?? `no-id:${Date.now()}`;

  try {
    const { id, deduped } = await captureNote(ctx.userId, { text, sourceRef });
    const shortId = id.slice(0, 8);
    await sendMessage(
      from,
      deduped
        ? `📝 Already saved to Mantis inbox (#${shortId}).`
        : `📝 Saved to Mantis inbox (#${shortId}). Classify later in the app.`
    );
  } catch (err) {
    if (err instanceof MantisUnavailableError) {
      await sendMessage(
        from,
        "⚠️ Mantis is unreachable right now — your note was saved locally and won't be lost. It'll need `/mantis` again once Mantis is back to reach the inbox."
      );
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
