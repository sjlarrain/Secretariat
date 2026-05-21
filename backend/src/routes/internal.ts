import { Router, Request, Response } from 'express';
import { qstashVerify } from '../middleware/qstash-verify';
import { sendMessage, sendInteractiveButtons } from '../kapso/client';
import { fireMorningDigest } from '../cron/morning-digest';
import { fireWeeklySummary } from '../cron/weekly-summary';
import { getWorkItems } from '../integrations/local/work';
import { getSettings } from '../integrations/token-store';
import { env } from '../env';

const router = Router();

router.post('/reminder/fire', qstashVerify, async (req: Request, res: Response) => {
  const { reminderId, title, phoneNumber } = req.body as { reminderId?: string; title?: string; phoneNumber?: string };

  if (!title || !phoneNumber) {
    res.status(400).json({ error: 'Missing title or phoneNumber' });
    return;
  }

  try {
    if (reminderId) {
      await sendInteractiveButtons(
        phoneNumber,
        `⏰ *Reminder:* ${title}`,
        [
          { id: `s1d_rem_${reminderId}`, title: 'Snooze 1 day' },
          { id: `smon_rem_${reminderId}`, title: 'Next Monday' },
          { id: `dis_rem_${reminderId}`, title: 'Dismiss' },
        ],
      );
    } else {
      await sendMessage(phoneNumber, `⏰ *Reminder:* ${title}`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reminder fire error:', err);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});

router.post('/digest/morning', qstashVerify, async (_req: Request, res: Response) => {
  try {
    await fireMorningDigest();
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Morning digest error:', err);
    res.status(500).json({ error: 'Digest failed' });
  }
});

router.post('/digest/weekly', qstashVerify, async (_req: Request, res: Response) => {
  try {
    await fireWeeklySummary();
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Weekly summary error:', err);
    res.status(500).json({ error: 'Summary failed' });
  }
});

router.post('/work/reminder/fire', qstashVerify, async (req: Request, res: Response) => {
  const { workItemId, text, phoneNumber } = req.body as { workItemId?: number; text?: string; phoneNumber?: string };
  if (!text || !phoneNumber) {
    res.status(400).json({ error: 'Missing text or phoneNumber' });
    return;
  }
  try {
    if (workItemId != null) {
      await sendInteractiveButtons(
        phoneNumber,
        `📋 *Work reminder:* ${text}`,
        [
          { id: `s1d_work_${workItemId}`, title: 'Snooze 1 day' },
          { id: `smon_work_${workItemId}`, title: 'Next Monday' },
          { id: `dis_work_${workItemId}`, title: 'Dismiss' },
        ],
      );
    } else {
      await sendMessage(phoneNumber, `📋 *Work reminder:* ${text}`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Work reminder fire error:', err);
    res.status(500).json({ error: 'Failed to send work reminder' });
  }
});

router.post('/task/reminder/fire', qstashVerify, async (req: Request, res: Response) => {
  const { taskId, title, phoneNumber } = req.body as { taskId?: number; title?: string; phoneNumber?: string };
  if (!title || !phoneNumber) {
    res.status(400).json({ error: 'Missing title or phoneNumber' });
    return;
  }
  try {
    if (taskId != null) {
      await sendInteractiveButtons(
        phoneNumber,
        `📌 *Task reminder:* ${title}`,
        [
          { id: `s1d_task_${taskId}`, title: 'Snooze 1 day' },
          { id: `smon_task_${taskId}`, title: 'Next Monday' },
          { id: `dis_task_${taskId}`, title: 'Dismiss' },
        ],
      );
    } else {
      await sendMessage(phoneNumber, `📌 *Task reminder:* ${title}`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Task reminder fire error:', err);
    res.status(500).json({ error: 'Failed to send task reminder' });
  }
});

router.post('/digest/work', qstashVerify, async (_req: Request, res: Response) => {
  try {
    const items = await getWorkItems();
    const phoneNumber = env.WHITELISTED_NUMBERS.split(',')[0].trim();
    if (items.length === 0) {
      await sendMessage(phoneNumber, '✅ Work list is clear. Enjoy the week!');
    } else {
      const lines = ['📋 *Work list — Monday reminder:*\n'];
      items.forEach((item, i) => lines.push(`${i + 1}. ${item.text}`));
      await sendMessage(phoneNumber, lines.join('\n'));
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Work digest error:', err);
    res.status(500).json({ error: 'Work digest failed' });
  }
});

export default router;
