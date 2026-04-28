import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../env';
import {
  getAllAccounts,
  getAccount,
  saveAccount,
  deleteAccount,
  getSettings,
  saveSettings,
} from '../integrations/token-store';
import { setDefault } from '../integrations/registry';
import { scheduleCron, deleteSchedule } from '../qstash/client';
import { whitelistedNumbers } from '../env';

const router = Router();

// --- Session auth middleware ---
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if ((req.session as { authenticated?: boolean }).authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// --- Auth ---
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (username === env.ADMIN_USERNAME && password === env.ADMIN_PASSWORD) {
    (req.session as { authenticated?: boolean }).authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// --- Accounts ---
router.get('/accounts', requireAuth, async (_req, res) => {
  const accounts = (await getAllAccounts()).map((a) => ({
    id: a.id,
    alias: a.alias,
    provider: a.provider,
    type: a.type,
    isDefault: a.isDefault,
  }));
  res.json({ accounts });
});

router.delete('/accounts/:id', requireAuth, async (req, res) => {
  await deleteAccount(String(req.params.id));
  res.json({ ok: true });
});

router.patch('/accounts/:id', requireAuth, async (req, res) => {
  const account = await getAccount(String(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const body = req.body as { alias?: string; isDefault?: boolean };

  if (body.alias) account.alias = body.alias;
  if (body.isDefault === true) {
    await setDefault(account.id);
    res.json({ ok: true });
    return;
  }

  await saveAccount(account);
  res.json({ ok: true });
});

// --- Whitelist (persisted in settings) ---
router.get('/whitelist', requireAuth, (_req, res) => {
  res.json({ numbers: whitelistedNumbers });
});

// Note: In v1 the whitelist is managed via the WHITELISTED_NUMBERS env var and
// cannot be changed at runtime without a redeploy. This endpoint is read-only.
router.post('/whitelist', requireAuth, (_req, res) => {
  res.status(501).json({
    error: 'Runtime whitelist modification not supported in v1. Update WHITELISTED_NUMBERS env var and redeploy.',
  });
});

router.delete('/whitelist/:number', requireAuth, (_req, res) => {
  res.status(501).json({
    error: 'Runtime whitelist modification not supported in v1. Update WHITELISTED_NUMBERS env var and redeploy.',
  });
});

// --- Settings ---
router.get('/settings', requireAuth, async (_req, res) => {
  res.json(await getSettings());
});

router.put('/settings', requireAuth, async (req, res) => {
  const body = req.body as Parameters<typeof saveSettings>[0];
  const current = await getSettings();
  const next = { ...current, ...body };

  // Handle morning digest cron
  const prevMorning = current.morningDigest;
  const nextMorning = next.morningDigest;

  if (prevMorning.scheduleId && (!nextMorning.enabled || JSON.stringify(prevMorning) !== JSON.stringify(nextMorning))) {
    try { await deleteSchedule(prevMorning.scheduleId); } catch { /* ignore */ }
    nextMorning.scheduleId = undefined;
  }

  if (nextMorning.enabled && !nextMorning.scheduleId) {
    const [hh, mm] = nextMorning.time.split(':');
    const dayCron = nextMorning.days.join(',');
    const cron = `${mm} ${hh} * * ${dayCron}`;
    try {
      nextMorning.scheduleId = await scheduleCron('/internal/digest/morning', cron, {});
    } catch (err) {
      console.error('Failed to create morning digest schedule:', err);
    }
  }

  // Handle weekly summary cron
  const prevWeekly = current.weeklySummary;
  const nextWeekly = next.weeklySummary;

  if (prevWeekly.scheduleId && (!nextWeekly.enabled || JSON.stringify(prevWeekly) !== JSON.stringify(nextWeekly))) {
    try { await deleteSchedule(prevWeekly.scheduleId); } catch { /* ignore */ }
    nextWeekly.scheduleId = undefined;
  }

  if (nextWeekly.enabled && !nextWeekly.scheduleId) {
    const [hh, mm] = nextWeekly.time.split(':');
    const cron = `${mm} ${hh} * * ${nextWeekly.day}`;
    try {
      nextWeekly.scheduleId = await scheduleCron('/internal/digest/weekly', cron, {});
    } catch (err) {
      console.error('Failed to create weekly summary schedule:', err);
    }
  }

  await saveSettings(next);
  res.json({ ok: true, settings: next });
});

// --- Google OAuth start (proxy from admin panel) ---
router.get('/auth/google/start', requireAuth, (req, res) => {
  const alias = req.query['alias'] as string || 'default';
  const type = req.query['type'] as string || 'calendar';
  res.redirect(`/auth/google/start?alias=${encodeURIComponent(alias)}&type=${encodeURIComponent(type)}`);
});

export default router;
