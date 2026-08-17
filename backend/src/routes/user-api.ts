import { Router, Request, Response } from 'express';
import { requireUserSession, UserSessionRequest } from '../middleware/user-session';
import { getRegisteredUser } from '../integrations/local/users';
import { getSettings, saveSettings } from '../integrations/token-store';
import { parseZoneInput } from '../utils/timezone';
import { reconcileSchedules } from '../qstash/schedules';

// The per-user panel API (docs/v2-plan.md §A/§C.6). Every route resolves
// data from `req.userCtx.userId`, which `requireUserSession` derives from
// the session cookie — never from a URL or body parameter, so a session
// cannot be pointed at another user's namespace by editing the request.

const router = Router();

router.use(requireUserSession);

router.get('/me', async (req: Request, res: Response) => {
  const { userId } = (req as UserSessionRequest).userCtx;
  const user = await getRegisteredUser(userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    name: user.name,
    timezone: user.timezone,
    email: user.email ?? null,
    calendarAccess: user.calendarAccess ?? null,
  });
});

router.get('/settings', async (req: Request, res: Response) => {
  const { userId } = (req as UserSessionRequest).userCtx;
  res.json(await getSettings(userId));
});

router.put('/settings', async (req: Request, res: Response) => {
  const { userId } = (req as UserSessionRequest).userCtx;
  const body = req.body as Parameters<typeof saveSettings>[1];
  const current = await getSettings(userId);
  const next = { ...current, ...body };

  const zone = parseZoneInput(next.timezone);
  if (!zone) {
    res.status(400).json({ error: `Unknown timezone: "${next.timezone}". Use a city name like America/Santiago, or an offset like GMT-3.` });
    return;
  }
  next.timezone = zone;

  const reconciled = await reconcileSchedules(userId, current, next);
  await saveSettings(userId, reconciled);
  res.json({ ok: true, settings: reconciled });
});

export default router;
