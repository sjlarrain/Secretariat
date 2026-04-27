import { Router, Request, Response } from 'express';
import { qstashVerify } from '../middleware/qstash-verify';
import { sendMessage } from '../kapso/client';
import { fireMorningDigest } from '../cron/morning-digest';
import { fireWeeklySummary } from '../cron/weekly-summary';

const router = Router();

router.post('/reminder/fire', qstashVerify, async (req: Request, res: Response) => {
  const { title, phoneNumber } = req.body as { title?: string; phoneNumber?: string };

  if (!title || !phoneNumber) {
    res.status(400).json({ error: 'Missing title or phoneNumber' });
    return;
  }

  try {
    await sendMessage(phoneNumber, `⏰ *Reminder:* ${title}`);
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

export default router;
