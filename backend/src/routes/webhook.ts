import { Router, Request, Response } from 'express';
import { Redis } from '@upstash/redis';
import { env } from '../env';
import { parseCommand } from '../parser/command.parser';
import { extractWebhookData, whitelistMiddleware, WebhookRequest } from '../middleware/whitelist';
import { sendMessage } from '../kapso/client';
import { startHandler } from '../handlers/start.handler';
import { scheduleHandler } from '../handlers/schedule.handler';
import { taskHandler } from '../handlers/task.handler';
import { reminderHandler } from '../handlers/reminder.handler';
import { myscheduleHandler } from '../handlers/myschedule.handler';
import { ideasHandler } from '../handlers/ideas.handler';
import { linksHandler } from '../handlers/links.handler';
import { menuHandler } from '../handlers/menu.handler';
import { uclaHandler } from '../handlers/ucla.handler';
import { statusHandler } from '../handlers/status.handler';
import { zoneHandler } from '../handlers/zone.handler';
import { mantisHandler } from '../handlers/mantis.handler';
import { buttonReplyHandler } from '../handlers/button-reply.handler';
import { replyRescheduleHandler } from '../handlers/reply-reschedule.handler';
import { thirdPartyHandler } from '../handlers/third-party.handler';
import type { ParsedCommand } from '../parser/command.parser';

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
    const claimed = await getRedis().set(`secretariat:dedup:${messageId}`, Date.now(), {
      nx: true,
      ex: DEDUP_TTL_SEC,
    });
    return claimed === null;
  } catch (err) {
    console.error('Dedup check failed, processing anyway:', err);
    return false;
  }
}

router.post('/', extractWebhookData, whitelistMiddleware, async (req: Request, res: Response) => {
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

  if (buttonReplyId) {
    try {
      await buttonReplyHandler(buttonReplyId, from, contextMessageId);
    } catch (err) {
      console.error('Button reply unhandled error:', err);
    }
    return;
  }

  if (!text?.trim()) return;

  // If this is a reply to a bot reminder/task/work message, attempt reschedule
  if (contextMessageId) {
    try {
      const handled = await replyRescheduleHandler(contextMessageId, text.trim(), from);
      if (handled) return;
    } catch (err) {
      console.error('Reply reschedule error:', err);
    }
  }

  try {
    // Auto-save bare URLs as links (no /prefix required)
    const trimmed = text.trim();
    if (/^https?:\/\/\S+$/.test(trimmed)) {
      const synthetic: ParsedCommand = { command: 'links', flags: {}, extraArgs: [trimmed], raw: trimmed };
      await linksHandler(synthetic, from);
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
        await startHandler(data, from);
        break;
      case 'menu':
        await menuHandler(data, from);
        break;
      case 'schedule':
        await scheduleHandler(data, from);
        break;
      case 'task':
        await taskHandler(data, from);
        break;
      case 'reminder':
        await reminderHandler(data, from);
        break;
      case 'myschedule':
        await myscheduleHandler(data, from);
        break;
      case 'ideas':
        await ideasHandler(data, from);
        break;
      case 'links':
        await linksHandler(data, from);
        break;
      case 'ucla':
        await uclaHandler(data, from);
        break;
      case 'status':
        await statusHandler(data, from);
        break;
      case 'zone':
        await zoneHandler(data, from);
        break;
      case 'mantis':
        await mantisHandler(data, from, messageId);
        break;
      default:
        await sendMessage(from, `❌ Unknown command. Send /start to see available commands.`);
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
