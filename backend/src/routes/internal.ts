import { Router, Request, Response } from 'express';
import { qstashVerify } from '../middleware/qstash-verify';
import { sendMessage, sendInteractiveButtons } from '../kapso/client';
import { fireMorningDigest } from '../cron/morning-digest';
import { fireWeeklySummary } from '../cron/weekly-summary';
import { promoteDeferred } from '../cron/reminder-promoter';
import { syncGoogleTasks } from '../cron/google-tasks-sync';
import { getUclaItems } from '../integrations/local/ucla';
import { getSettings } from '../integrations/token-store';
import { storeReplyTarget } from '../integrations/local/wa-reply-map';
import { removeReminder } from '../integrations/local/reminders';
import { runHealthCheck } from '../cron/health-check';
import { formatDate, formatTime } from '../utils/date';
import { whitelistedNumbers } from '../env';

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

router.post('/digest/morning', qstashVerify, async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  try {
    await fireMorningDigest(userId ?? whitelistedNumbers[0]);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Morning digest error:', err);
    res.status(500).json({ error: 'Digest failed' });
  }
});

router.post('/digest/weekly', qstashVerify, async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  try {
    await fireWeeklySummary(userId ?? whitelistedNumbers[0]);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Weekly summary error:', err);
    res.status(500).json({ error: 'Summary failed' });
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

async function fireUclaDigest(req: Request, res: Response): Promise<void> {
  const { userId } = req.body as { userId?: string };
  const owner = userId ?? whitelistedNumbers[0];
  try {
    const items = await getUclaItems(owner);
    const settings = await getSettings(owner);
    if (items.length === 0) {
      await sendMessage(owner, '✅ UCLA list is clear. Enjoy the week!');
    } else {
      const lines = ['🎓 *UCLA list — Monday reminder:*\n'];
      items.forEach((item, i) => {
        const due = item.dueDate ? ` _(📅 due ${formatDate(new Date(item.dueDate), true, settings.timezone)})_` : '';
        lines.push(`${i + 1}. ${item.text}${due}`);
      });
      await sendMessage(owner, lines.join('\n'));
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('UCLA digest error:', err);
    res.status(500).json({ error: 'UCLA digest failed' });
  }
}

router.post('/digest/ucla', qstashVerify, fireUclaDigest);

router.post('/reminder/promote', qstashVerify, async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  try {
    const result = await promoteDeferred(userId ?? whitelistedNumbers[0]);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Reminder promote error:', err);
    res.status(500).json({ error: 'Promotion failed' });
  }
});

router.post('/tasks/sync', qstashVerify, async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  try {
    const result = await syncGoogleTasks(userId ?? whitelistedNumbers[0]);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Google Tasks sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

router.post('/health-check', qstashVerify, async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  try {
    const result = await runHealthCheck(userId ?? whitelistedNumbers[0]);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Health check error:', err);
    res.status(500).json({ error: 'Health check failed' });
  }
});

export default router;
