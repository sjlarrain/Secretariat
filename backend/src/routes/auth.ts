import { Router, Request, Response } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import { getAuthUrl, exchangeCode } from '../integrations/google/oauth';
import { saveAccount, encryptTokens, getAllAccounts } from '../integrations/token-store';
import { Redis } from '@upstash/redis';
import { env, whitelistedNumbers } from '../env';
import { pointKey } from '../redis/keys';

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type CallbackPageVariant = 'success' | 'error';

function callbackPage(variant: CallbackPageVariant, title: string, message: string): string {
  const isSuccess = variant === 'success';
  const icon = isSuccess ? '✓' : '✕';
  const iconColor = isSuccess ? '#4ade80' : '#f87171';
  const iconBg = isSuccess ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — Secretariat</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #e2e2e2;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 40px 36px; max-width: 420px; width: 100%; text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .icon {
      width: 56px; height: 56px; border-radius: 50%;
      background: ${iconBg}; color: ${iconColor};
      font-size: 26px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px;
    }
    h1 { font-size: 18px; font-weight: 700; color: #f0f0f0; margin-bottom: 10px; letter-spacing: -0.2px; }
    p { font-size: 14px; color: #8a8a8a; line-height: 1.6; margin-bottom: 28px; }
    strong { color: #d0d0d0; font-weight: 600; }
    a.btn {
      display: inline-block; background: #2a2a2a; color: #e2e2e2;
      border: 1px solid #3a3a3a; border-radius: 8px;
      padding: 9px 22px; font-size: 13px; font-weight: 500;
      text-decoration: none; transition: background 0.15s;
    }
    a.btn:hover { background: #333; }
    .brand { font-size: 11px; color: #444; margin-top: 24px; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    <a class="btn" href="/">Back to admin panel</a>
    <div class="brand">SECRETARIAT</div>
  </div>
</body>
</html>`;
}

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
