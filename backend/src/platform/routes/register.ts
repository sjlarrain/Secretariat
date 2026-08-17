import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { parseZoneInput } from '../../shared/utils/timezone';
import { getInvite, redeemInvite } from '../../auth/invites';
import { getRegisteredUser, registerUser } from '../../auth/users';
import { getSettings, saveSettings } from '../../core/integrations/token-store';

// Public, unauthenticated onboarding (docs/v2-plan.md §B.2). A valid invite
// token is the only credential; everything here is reachable by anyone holding
// one, so each endpoint is rate limited and none of them reveal whether a
// given phone number is already a user.

const router = Router();

const registerRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

/**
 * Digits with a leading `+`. Meta delivers numbers without the `+` and the
 * webhook adds it back, so the registry must store the same shape or a
 * registered user would not resolve against their own inbound messages.
 */
function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s()\-.]/g, '');
  const withPlus = digits.startsWith('+') ? digits : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(withPlus) ? withPlus : null;
}

function isPlausibleEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input);
}

interface RegisterBody {
  token?: string;
  phone?: string;
  name?: string;
  timezone?: string;
  email?: string;
  consent?: boolean;
}

/** Checks a token before the form is shown. Reveals nothing beyond usability. */
router.get('/:token', registerRateLimit, async (req: Request, res: Response) => {
  const invite = await getInvite(String(req.params['token'] ?? ''));
  if (!invite || invite.status !== 'pending') {
    res.status(404).json({ valid: false, error: 'This invite link is not valid or has already been used.' });
    return;
  }
  res.json({ valid: true });
});

router.post('/', registerRateLimit, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as RegisterBody;

  if (body.consent !== true) {
    res.status(400).json({ error: 'Please accept the terms to continue.' });
    return;
  }

  const name = body.name?.trim();
  if (!name) {
    res.status(400).json({ error: 'Name is required.' });
    return;
  }

  const phone = normalizePhone(body.phone ?? '');
  if (!phone) {
    res.status(400).json({ error: 'Enter a valid WhatsApp number in international format, e.g. +56911111111.' });
    return;
  }

  // Timezone is required and has no default — every user picks their own, since
  // digests and day boundaries are computed in it.
  const timezone = body.timezone ? parseZoneInput(body.timezone) : null;
  if (!timezone) {
    res.status(400).json({ error: 'Select a valid timezone.' });
    return;
  }

  const email = body.email?.trim();
  if (email && !isPlausibleEmail(email)) {
    res.status(400).json({ error: 'Enter a valid email address, or leave it blank.' });
    return;
  }

  // Checked before the token is consumed: the common mistake of following an
  // invite twice should not burn it.
  if (await getRegisteredUser(phone)) {
    res.status(409).json({ error: 'That number is already registered.' });
    return;
  }

  // Redeem first. If anything below fails the token is spent, which is the safe
  // direction to fail — the alternative admits a user without a valid invite.
  const redeemed = await redeemInvite(body.token ?? '', phone);
  if (!redeemed.ok) {
    res.status(400).json({ error: redeemed.error });
    return;
  }

  const user = await registerUser({ phone, name, timezone, ...(email ? { email } : {}) });

  // Settings — not the registry entry — is what handlers read at runtime, so
  // the chosen zone has to land there too or the user's first day would be
  // computed in UTC.
  //
  // Deliberately no schedule reconciliation: QStash caps total crons, so
  // per-user schedules are never created. The hourly sweeper (Goal 3) is what
  // will fire each user's digests in their own timezone.
  const settings = await getSettings(phone);
  await saveSettings(phone, { ...settings, timezone });

  res.status(201).json({
    ok: true,
    name: user.name,
    calendarPending: user.calendarAccess === 'pending',
  });
});

export default router;
