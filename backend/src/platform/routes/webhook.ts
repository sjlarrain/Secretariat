import { Router, Request, Response } from 'express';
import { Redis } from '@upstash/redis';
import { env } from '../../shared/env';
import { parseCommand } from '../../core/parser/command.parser';
import { extractWebhookData, resolveSenderMiddleware, WebhookRequest } from '../../auth/middleware/resolve-sender';
import { sendMessage } from '../../shared/kapso/client';
import { getSettings } from '../../core/integrations/token-store';
import { Ctx } from '../../shared/ctx';
import { pointKey } from '../../shared/redis/keys';
import { startHandler } from '../../core/handlers/start.handler';
import { scheduleHandler } from '../../core/handlers/schedule.handler';
import { taskHandler } from '../../core/handlers/task.handler';
import { reminderHandler } from '../../core/handlers/reminder.handler';
import { myscheduleHandler } from '../../core/handlers/myschedule.handler';
import { ideasHandler } from '../../core/handlers/ideas.handler';
import { linksHandler } from '../../core/handlers/links.handler';
import { menuHandler } from '../../core/handlers/menu.handler';
import { exampleHandler } from '../../core/handlers/example.handler';
import { mbaHandler } from '../../core/handlers/mba.handler';
import { statusHandler } from '../../core/handlers/status.handler';
import { zoneHandler } from '../../core/handlers/zone.handler';
import { panelHandler } from '../../core/handlers/panel.handler';
import { buttonReplyHandler } from '../../core/handlers/button-reply.handler';
import { replyRescheduleHandler } from '../../core/handlers/reply-reschedule.handler';
import { replyLinkNameHandler, pendingLinkNameHandler } from '../../core/handlers/link-name.handler';
import { thirdPartyHandler } from '../../core/handlers/third-party.handler';
import type { ParsedCommand } from '../../core/parser/command.parser';

const router = Router();

// Dedup: track recently processed message IDs for 5 minutes.
// Prevents duplicate processing when Kapso retries while the server is waking up.
// Backed by Redis (not an in-memory Map) because retries land precisely when the
// process has restarted/hibernated — exactly when an in-memory map would be empty.
const DEDUP_TTL_SEC = 5 * 60;

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis)
    _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

// Atomic claim: SET key NX EX returns 'OK' the first time and null if the key
// already exists, so concurrent retries can't both slip through a get-then-set gap.
// Fails open (returns false) if Redis is unreachable — better to risk a rare
// duplicate than to drop the message entirely.
async function isDuplicate(messageId: string | null): Promise<boolean> {
  if (!messageId) return false;
  try {
    const claimed = await getRedis().set(pointKey('dedup', messageId), Date.now(), {
      nx: true,
      ex: DEDUP_TTL_SEC,
    });
    return claimed === null;
  } catch (err) {
    console.error('Dedup check failed, processing anyway:', err);
    return false;
  }
}

router.post('/', extractWebhookData, resolveSenderMiddleware, async (req: Request, res: Response) => {
  // Always return 200 — Kapso retries on non-200
  res.status(200).json({ ok: true });

  const from = (req as WebhookRequest).senderPhone;
  const text = (req as WebhookRequest).webhookText;
  const messageId = (req as WebhookRequest).messageId;
  const buttonReplyId = (req as WebhookRequest).buttonReplyId;
  const contextMessageId = (req as WebhookRequest).contextMessageId;

  if (await isDuplicate(messageId)) return;

  if ((req as WebhookRequest).isThirdParty) {
    try {
      await thirdPartyHandler(text, from, (req as WebhookRequest).thirdPartyAlias);
    } catch (err) {
      console.error('Third-party handler error:', err);
    }
    return;
  }

  // Past the resolution middleware the sender is a known, active user, so their
  // phone number is their userId. Timezone comes from their settings rather
  // than the registry entry — `/zone` and the admin panel write settings, so it
  // is the only value that stays current.
  const user = (req as WebhookRequest).user;
  const userId = user?.id ?? from;
  const settings = await getSettings(userId);
  const ctx: Ctx = { userId, timezone: settings.timezone };

  if (buttonReplyId) {
    try {
      await buttonReplyHandler(buttonReplyId, ctx, contextMessageId);
    } catch (err) {
      console.error('Button reply unhandled error:', err);
    }
    return;
  }

  if (!text?.trim()) return;

  // If this is a reply to a bot reminder/task/mba message, attempt reschedule
  if (contextMessageId) {
    try {
      const handled = await replyRescheduleHandler(contextMessageId, text.trim(), ctx);
      if (handled) return;
    } catch (err) {
      console.error('Reply reschedule error:', err);
    }

    try {
      const handled = await replyLinkNameHandler(contextMessageId, text.trim(), ctx);
      if (handled) return;
    } catch (err) {
      console.error('Reply link name error:', err);
    }
  }

  // Plain "--name <text>" / "-n <text>" right after a link was saved, with no
  // swipe-reply needed — targets whichever link was most recently saved.
  try {
    const handled = await pendingLinkNameHandler(text.trim(), ctx);
    if (handled) return;
  } catch (err) {
    console.error('Pending link name error:', err);
  }

  try {
    // Auto-save bare URLs as links (no /prefix required)
    const trimmed = text.trim();
    if (/^https?:\/\/\S+$/.test(trimmed)) {
      const synthetic: ParsedCommand = { command: 'links', flags: {}, extraArgs: [trimmed], raw: trimmed };
      await linksHandler(synthetic, ctx);
      return;
    }

    const result = parseCommand(text);

    if (!result.success || !result.data) {
      await sendMessage(from, `❌ ${result.error ?? 'Could not parse command.'}`);
      return;
    }

    const { data } = result;

    switch (data.command) {
      case 'start':
        await startHandler(data, ctx);
        break;
      case 'menu':
        await menuHandler(data, ctx);
        break;
      case 'example':
        await exampleHandler(data, ctx);
        break;
      case 'schedule':
        await scheduleHandler(data, ctx);
        break;
      case 'task':
        await taskHandler(data, ctx);
        break;
      case 'reminder':
        await reminderHandler(data, ctx);
        break;
      case 'myschedule':
        await myscheduleHandler(data, ctx);
        break;
      case 'ideas':
        await ideasHandler(data, ctx);
        break;
      case 'links':
        await linksHandler(data, ctx);
        break;
      case 'mba':
        await mbaHandler(data, ctx);
        break;
      case 'status':
        await statusHandler(data, ctx);
        break;
      case 'zone':
        await zoneHandler(data, ctx);
        break;
      case 'panel':
        await panelHandler(data, ctx);
        break;
      default:
        await sendMessage(from, `❌ Unknown command. Send /example for what you can type, or /menu for the full list.`);
    }
  } catch (err) {
    console.error('Webhook unhandled error:', err);
    try {
      await sendMessage(from, '❌ Something went wrong. Try again.');
    } catch {
      // suppress
    }
  }
});

export default router;
