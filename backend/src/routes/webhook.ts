import { Router, Request, Response } from 'express';
import { parseCommand } from '../parser/command.parser';
import { extractWebhookData, whitelistMiddleware, WebhookRequest } from '../middleware/whitelist';
import { sendMessage } from '../kapso/client';
import { startHandler } from '../handlers/start.handler';
import { scheduleHandler } from '../handlers/schedule.handler';
import { gtaskHandler } from '../handlers/gtask.handler';
import { taskHandler } from '../handlers/task.handler';
import { reminderHandler } from '../handlers/reminder.handler';
import { myscheduleHandler } from '../handlers/myschedule.handler';
import { ideasHandler } from '../handlers/ideas.handler';
import { linksHandler } from '../handlers/links.handler';
import { menuHandler } from '../handlers/menu.handler';
import { workHandler } from '../handlers/work.handler';
import { statusHandler } from '../handlers/status.handler';
import { buttonReplyHandler } from '../handlers/button-reply.handler';
import type { ParsedCommand } from '../parser/command.parser';

const router = Router();

// Dedup: track recently processed message IDs for 5 minutes
// Prevents duplicate processing when Kapso retries while the server is waking up
const seenMessageIds = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;

function isDuplicate(messageId: string | null): boolean {
  if (!messageId) return false;
  const now = Date.now();
  // Clean up expired entries
  for (const [id, ts] of seenMessageIds) {
    if (now - ts > DEDUP_TTL_MS) seenMessageIds.delete(id);
  }
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.set(messageId, now);
  return false;
}

router.post('/', extractWebhookData, whitelistMiddleware, async (req: Request, res: Response) => {
  // Always return 200 — Kapso retries on non-200
  res.status(200).json({ ok: true });

  const from = (req as WebhookRequest).senderPhone;
  const text = (req as WebhookRequest).webhookText;
  const messageId = (req as WebhookRequest).messageId;
  const buttonReplyId = (req as WebhookRequest).buttonReplyId;

  if (isDuplicate(messageId)) return;

  if (buttonReplyId) {
    try {
      await buttonReplyHandler(buttonReplyId, from);
    } catch (err) {
      console.error('Button reply unhandled error:', err);
    }
    return;
  }

  if (!text?.trim()) return;

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
      case 'gtask':
        await gtaskHandler(data, from);
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
      case 'work':
        await workHandler(data, from);
        break;
      case 'status':
        await statusHandler(data, from);
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
