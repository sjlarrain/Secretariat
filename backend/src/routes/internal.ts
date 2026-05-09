import { Router, Request, Response } from 'express';
import { qstashVerify } from '../middleware/qstash-verify';
import { sendMessage } from '../kapso/client';
import { fireMorningDigest } from '../cron/morning-digest';
import { fireWeeklySummary } from '../cron/weekly-summary';
import { removeReminder } from '../integrations/local/reminders';
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
    await sendMessage(phoneNumber, `⏰ *Reminder:* ${title}`);
    if (reminderId) await removeReminder(reminderId).catch(() => {});
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
  const { text, phoneNumber } = req.body as { workItemId?: number; text?: string; phoneNumber?: string };
  if (!text || !phoneNumber) {
    res.status(400).json({ error: 'Missing text or phoneNumber' });
    return;
  }
  try {
    await sendMessage(phoneNumber, `📋 *Work reminder:* ${text}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Work reminder fire error:', err);
    res.status(500).json({ error: 'Failed to send work reminder' });
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
