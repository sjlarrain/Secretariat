import { Router, Request, Response } from 'express';
import { parseCommand } from '../parser/command.parser';
import { extractSender, whitelistMiddleware } from '../middleware/whitelist';
import { sendMessage } from '../kapso/client';
import { startHandler } from '../handlers/start.handler';
import { scheduleHandler } from '../handlers/schedule.handler';
import { taskHandler } from '../handlers/task.handler';
import { reminderHandler } from '../handlers/reminder.handler';
import { mytaskHandler } from '../handlers/mytask.handler';
import { myscheduleHandler } from '../handlers/myschedule.handler';

const router = Router();

type ExtendedRequest = Request & { senderPhone: string };

router.post('/', extractSender, whitelistMiddleware, async (req: Request, res: Response) => {
  // Always return 200 — Kapso retries on non-200
  res.status(200).json({ ok: true });

  const from = (req as ExtendedRequest).senderPhone;

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== 'text') return;

    const text: string = message.text?.body ?? '';
    if (!text.trim()) return;

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
      case 'schedule':
        await scheduleHandler(data, from);
        break;
      case 'task':
        await taskHandler(data, from);
        break;
      case 'reminder':
        await reminderHandler(data, from);
        break;
      case 'mytask':
        await mytaskHandler(data, from);
        break;
      case 'myschedule':
        await myscheduleHandler(data, from);
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
