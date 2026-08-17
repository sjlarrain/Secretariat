import { sendMessage } from '../../shared/kapso/client';
import { Ctx } from '../../shared/ctx';
import { getReplyTarget } from '../integrations/local/wa-reply-map';
import { updateLink } from '../integrations/local/links';
import { getPendingLink, clearPendingLink } from '../integrations/local/link-pending';

// Matches `--name <text>` / `-n <text>` on a bare message, i.e. not routed
// through the /links command parser (which requires a leading "/").
const NAME_PATTERN = /^(?:--name|-n)\s+(.+)$/i;

function extractName(text: string): string | null {
  const normalized = text.replace(/[—–]/g, '--').trim();
  const match = normalized.match(NAME_PATTERN);
  return match ? match[1].trim() : null;
}

// Handles a WhatsApp swipe-reply to a "Link saved" confirmation.
// Returns true if the reply was handled (matched a saved-link message).
export async function replyLinkNameHandler(contextMessageId: string, text: string, ctx: Ctx): Promise<boolean> {
  const from = ctx.userId;
  const target = await getReplyTarget(contextMessageId);
  if (!target || target.type !== 'link') return false;

  const name = extractName(text);
  if (!name) {
    await sendMessage(from, '❌ Reply with `--name <text>` to name this link.');
    return true;
  }

  const linkId = Number(target.id);
  const ok = await updateLink(target.userId, linkId, { name });
  if (!ok) {
    await sendMessage(from, '❌ That link no longer exists.');
    return true;
  }

  const pending = await getPendingLink(target.userId);
  if (pending?.linkId === linkId) await clearPendingLink(target.userId).catch(() => null);

  await sendMessage(from, `✅ Link named "${name}".`);
  return true;
}

// Handles the plain first response after a link is saved (no swipe-reply
// needed) — targets whichever link was most recently saved.
// Returns true if the message was handled (matched the naming pattern).
export async function pendingLinkNameHandler(text: string, ctx: Ctx): Promise<boolean> {
  const from = ctx.userId;
  const name = extractName(text);
  if (!name) return false;

  const pending = await getPendingLink(ctx.userId);
  if (!pending) {
    await sendMessage(from, '❌ No link waiting for a name. Use `/links #N --name <text>`.');
    return true;
  }

  const ok = await updateLink(ctx.userId, pending.linkId, { name });
  if (!ok) {
    await sendMessage(from, '❌ That link no longer exists.');
    return true;
  }

  await clearPendingLink(ctx.userId).catch(() => null);
  await sendMessage(from, `✅ Link #${pending.position} named "${name}".`);
  return true;
}
