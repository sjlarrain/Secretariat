import { Router, Request, Response } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import { Redis } from '@upstash/redis';
import { getAuthUrl, exchangeCode } from '../../core/integrations/google/oauth';
import { saveAccount, encryptTokens, getAllAccounts } from '../../core/integrations/token-store';
import { env } from '../../shared/env';
import { pointKey } from '../../shared/redis/keys';
import { requireUserSession, UserSessionRequest } from '../../auth/middleware/user-session';
import { escapeHtml, callbackPage } from '../../shared/oauth-callback-page';

// The per-user counterpart to ops/routes/google-oauth.ts's admin-gated OAuth flow
// (docs/v2-plan.md: "Per-user OAuth belongs in the user panel, not ops").
// Additive, not a replacement — the admin flow stays exactly as it is for
// Santiago's own admin-panel connections; this is what a real registered
// user goes through to link their own calendar from the per-user panel.

const router = Router();

const ALLOWED_TYPES = ['calendar', 'tasks'] as const;
const ALIAS_MAX_LEN = 50;
const STATE_TTL_SECONDS = 600;

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

/**
 * Where Google sends the user back for *this* flow. The ops flow keeps
 * `GOOGLE_REDIRECT_URI`; this one finishes at its own callback, so it must say
 * so on both the auth request and the token exchange (see getOAuthClient).
 * Register this exact URI on the OAuth client in the Google console.
 */
function userRedirectUri(): string {
  return `${env.BASE_URL.replace(/\/$/, '')}/auth/user/google/callback`;
}

function stateKey(id: string) {
  return pointKey('oauth-state', id);
}

router.get('/google/start', requireUserSession, async (req: Request, res: Response) => {
  const rawAlias = (req.query['alias'] as string) || 'default';
  const rawType = (req.query['type'] as string) || 'calendar';

  const alias = rawAlias.slice(0, ALIAS_MAX_LEN).trim();
  const type = ALLOWED_TYPES.includes(rawType as typeof ALLOWED_TYPES[number])
    ? (rawType as typeof ALLOWED_TYPES[number])
    : 'calendar';

  const userId = (req as UserSessionRequest).userCtx.userId;
  const state = uuidv4();
  await getRedis().set(stateKey(state), { alias, type, userId }, { ex: STATE_TTL_SECONDS });

  res.redirect(getAuthUrl(state, userRedirectUri()));
});

router.get('/google/callback', requireUserSession, async (req: Request, res: Response) => {
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
    res.status(400).send(callbackPage('error', 'Session Expired', 'This OAuth link has expired or already been used. Please start the connection flow again from your panel.'));
    return;
  }

  await getRedis().del(stateKey(state));

  // The flow was started by whoever is completing it — belt-and-suspenders
  // against a leaked/replayed state landing in a different session than the
  // one that requested it, on top of the state id itself being unguessable.
  const sessionUserId = (req as UserSessionRequest).userCtx.userId;
  if (pending.userId !== sessionUserId) {
    res.status(403).send(callbackPage('error', 'Session Mismatch', 'This connection link was requested from a different session. Please start again from your panel.'));
    return;
  }

  try {
    const tokens = await exchangeCode(code, userRedirectUri());
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
    console.error('Google OAuth callback error (user flow):', err);
    res.status(500).send(callbackPage('error', 'Connection Failed', 'Something went wrong on the server. Check the server logs for details.'));
  }
});

export default router;
