import { Router, Request, Response } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import { getAuthUrl, exchangeCode } from '../../core/integrations/google/oauth';
import { saveAccount, encryptTokens, getAllAccounts } from '../../core/integrations/token-store';
import { Redis } from '@upstash/redis';
import { env, whitelistedNumbers } from '../../shared/env';
import { pointKey } from '../../shared/redis/keys';
import { escapeHtml, callbackPage } from '../../shared/oauth-callback-page';

const router = Router();

const ALLOWED_TYPES = ['calendar', 'tasks'] as const;
const ALIAS_MAX_LEN = 50;
const STATE_TTL_SECONDS = 600;

// OAuth state is stored in Redis instead of in-process memory so it survives
// restarts and works correctly in multi-instance deployments.
let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

function stateKey(id: string) { return pointKey('oauth-state', id); }

function requireAuth(req: Request, res: Response, next: () => void): void {
  if ((req.session as { authenticated?: boolean }).authenticated) {
    next();
  } else {
    res.status(401).send('<h2>Unauthorized. Please log in via the admin panel.</h2>');
  }
}

router.get('/google/start', requireAuth, async (req: Request, res: Response) => {
  const rawAlias = (req.query['alias'] as string) || 'default';
  const rawType = (req.query['type'] as string) || 'calendar';

  const alias = rawAlias.slice(0, ALIAS_MAX_LEN).trim();
  const type = ALLOWED_TYPES.includes(rawType as typeof ALLOWED_TYPES[number])
    ? (rawType as typeof ALLOWED_TYPES[number])
    : 'calendar';

  // The admin session is a single global operator login until the per-user
  // panel (v2 Goal 2) exists — every account connected through it belongs to
  // the one whitelisted owner.
  const userId = whitelistedNumbers[0];
  const state = uuidv4();
  await getRedis().set(stateKey(state), { alias, type, userId }, { ex: STATE_TTL_SECONDS });

  res.redirect(getAuthUrl(state));
});

router.get('/google/callback', requireAuth, async (req: Request, res: Response) => {
  const code = req.query['code'] as string | undefined;
  const state = req.query['state'] as string | undefined;
  const error = req.query['error'] as string | undefined;

  if (error) {
    res.status(400).send(callbackPage('error', 'OAuth Error', `Google returned: <strong>${escapeHtml(String(error))}</strong>`));
    return;
  }

  if (!code || !state) {
    res.status(400).send(callbackPage('error', 'Missing Parameters', 'The OAuth callback is missing a code or state parameter.'));
    return;
  }

  const pending = await getRedis().get<{ alias: string; type: typeof ALLOWED_TYPES[number]; userId: string }>(stateKey(state));
  if (!pending) {
    res.status(400).send(callbackPage('error', 'Session Expired', 'This OAuth link has expired or already been used. Please start the connection flow again from the admin panel.'));
    return;
  }

  await getRedis().del(stateKey(state));

  try {
    const tokens = await exchangeCode(code);
    const existingAccounts = await getAllAccounts(pending.userId);
    const existing = existingAccounts.find((a) => a.alias === pending.alias && a.type === pending.type);
    const isFirstOfType = !existingAccounts.some((a) => a.type === pending.type);
    const accountId = existing?.id ?? uuidv4();

    await saveAccount(pending.userId, {
      id: accountId,
      alias: pending.alias,
      provider: 'google',
      type: pending.type,
      isDefault: existing?.isDefault ?? isFirstOfType,
      encryptedTokens: encryptTokens(tokens, accountId),
      enabledCalendarIds: existing?.enabledCalendarIds,
      calendarNames: existing?.calendarNames,
      isDisconnected: false,
    });

    res.send(callbackPage(
      'success',
      'Connected!',
      `Google <strong>${escapeHtml(pending.type)}</strong> account <strong>"${escapeHtml(pending.alias)}"</strong> was connected successfully.`,
    ));
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.status(500).send(callbackPage('error', 'Connection Failed', 'Something went wrong on the server. Check the server logs for details.'));
  }
});

export default router;
