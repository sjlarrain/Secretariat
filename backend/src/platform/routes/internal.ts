import { Router, Request, Response } from 'express';
import { qstashVerify } from '../middleware/qstash-verify';
import { sendMessage, sendInteractiveButtons } from '../../shared/kapso/client';
import { getSettings } from '../../core/integrations/token-store';
import { storeReplyTarget } from '../../core/integrations/local/wa-reply-map';
import { removeReminder } from '../../core/integrations/local/reminders';
import { formatDate, formatTime } from '../../shared/utils/date';
import { runSweep } from '../sweeper';

const router = Router();

router.post('/reminder/fire', qstashVerify, async (req: Request, res: Response) => {
  const { reminderId, title, phoneNumber, userId } = req.body as {
    reminderId?: string; title?: string; phoneNumber?: string; userId?: string;
  };

  if (!title || !phoneNumber) {
    res.status(400).json({ error: 'Missing title or phoneNumber' });
    return;
  }
  // Reminders scheduled before userId was added to the QStash body (pre-migration,
  // still in flight) fall back to phoneNumber — which is the same value for
  // every reminder created before multi-user namespacing existed.
  const owner = userId ?? phoneNumber;

  try {
    if (reminderId) {
      const waMessageId = await sendInteractiveButtons(
        phoneNumber,
        `⏰ *Reminder:* ${title}`,
        [
          { id: `s1h_rem_${reminderId}`, title: 'Snooze 1 hour' },
          { id: `s1d_rem_${reminderId}`, title: 'Snooze 1 day' },
          { id: `smon_rem_${reminderId}`, title: 'Next Monday' },
        ],
      );
      await storeReplyTarget(waMessageId, { type: 'rem', id: reminderId, title, phoneNumber, userId: owner }).catch(() => null);
      await removeReminder(owner, reminderId).catch(() => null);
    } else {
      await sendMessage(phoneNumber, `⏰ *Reminder:* ${title}`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reminder fire error:', err);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

async function fireUclaReminder(req: Request, res: Response): Promise<void> {
  // `workItemId` is the pre-v1.14 field name; one-shot reminders scheduled
  // before the rename are still in flight with the old payload shape.
  const body = req.body as { uclaItemId?: number; workItemId?: number; text?: string; phoneNumber?: string; userId?: string };
  const itemId = body.uclaItemId ?? body.workItemId;
  const { text, phoneNumber } = body;
  const owner = body.userId ?? phoneNumber;

  if (!text || !phoneNumber || !owner) {
    res.status(400).json({ error: 'Missing text or phoneNumber' });
    return;
  }
  try {
    if (itemId != null) {
      const waMessageId = await sendInteractiveButtons(
        phoneNumber,
        `🎓 *UCLA reminder:* ${text}`,
        [
          { id: `done_ucla_${itemId}`, title: 'Done' },
          { id: `s1d_ucla_${itemId}`, title: 'Snooze 1 day' },
          { id: `smon_ucla_${itemId}`, title: 'Next Monday' },
        ],
      );
      await storeReplyTarget(waMessageId, { type: 'ucla', id: String(itemId), title: text, phoneNumber, userId: owner }).catch(() => null);
    } else {
      await sendMessage(phoneNumber, `🎓 *UCLA reminder:* ${text}`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('UCLA reminder fire error:', err);
    res.status(500).json({ error: 'Failed to send UCLA reminder' });
  }
}

router.post('/ucla/reminder/fire', qstashVerify, fireUclaReminder);
// Legacy alias (pre-v1.14 /work): reminders scheduled before the rename are
// already queued in QStash against this path and would 404 if it were removed.
router.post('/work/reminder/fire', qstashVerify, fireUclaReminder);

// Automatic "due in 24h" reminder for UCLA items.
router.post('/ucla/due/fire', qstashVerify, async (req: Request, res: Response) => {
  const { uclaItemId, text, dueAt, phoneNumber, userId } = req.body as {
    uclaItemId?: number; text?: string; dueAt?: string; phoneNumber?: string; userId?: string;
  };
  const owner = userId ?? phoneNumber;
  if (!text || !phoneNumber || !owner) {
    res.status(400).json({ error: 'Missing text or phoneNumber' });
    return;
  }
  try {
    const settings = await getSettings(owner);
    const dueLabel = dueAt
      ? ` (due ${formatDate(new Date(dueAt), true, settings.timezone)} at ${formatTime(new Date(dueAt), settings.timezone)})`
      : '';
    const body = `🎓 *Due in 24 hours:* ${text}${dueLabel}`;

    if (uclaItemId != null) {
      const waMessageId = await sendInteractiveButtons(
        phoneNumber,
        body,
        [
          { id: `done_ucla_${uclaItemId}`, title: 'Done' },
          { id: `s1d_ucla_${uclaItemId}`, title: 'Snooze 1 day' },
        ],
      );
      await storeReplyTarget(waMessageId, { type: 'ucla', id: String(uclaItemId), title: text, phoneNumber, userId: owner }).catch(() => null);
    } else {
      await sendMessage(phoneNumber, body);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('UCLA due reminder fire error:', err);
    res.status(500).json({ error: 'Failed to send UCLA due reminder' });
  }
});

router.post('/task/reminder/fire', qstashVerify, async (req: Request, res: Response) => {
  const { taskId, title, phoneNumber, userId } = req.body as {
    taskId?: number; title?: string; phoneNumber?: string; userId?: string;
  };
  const owner = userId ?? phoneNumber;
  if (!title || !phoneNumber || !owner) {
    res.status(400).json({ error: 'Missing title or phoneNumber' });
    return;
  }
  try {
    if (taskId != null) {
      const waMessageId = await sendInteractiveButtons(
        phoneNumber,
        `📌 *Task reminder:* ${title}`,
        [
          { id: `done_task_${taskId}`, title: 'Done' },
          { id: `s1d_task_${taskId}`, title: 'Snooze 1 day' },
          { id: `smon_task_${taskId}`, title: 'Next Monday' },
        ],
      );
      await storeReplyTarget(waMessageId, { type: 'task', id: String(taskId), title, phoneNumber, userId: owner }).catch(() => null);
    } else {
      await sendMessage(phoneNumber, `📌 *Task reminder:* ${title}`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Task reminder fire error:', err);
    res.status(500).json({ error: 'Failed to send task reminder' });
  }
});

// The hourly sweeper (docs/v2-plan.md §C.5) — replaces the per-user QStash
// cron schedules that used to hit /digest/morning, /digest/weekly,
// /digest/ucla, /reminder/promote, /tasks/sync, and /health-check. Those
// routes are gone: the sweeper calls the same job functions in-process,
// across every registered user, instead of QStash calling one route per
// user per job. The one QStash schedule that remains is this one, created
// once at boot — see platform/ensureSweeperSchedule.ts.
router.post('/tick', qstashVerify, async (_req: Request, res: Response) => {
  try {
    const result = await runSweep();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Sweeper tick error:', err);
    res.status(500).json({ error: 'Sweep failed' });
  }
});

export default router;
