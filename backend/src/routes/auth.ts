import { Router, Request, Response } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import { getAuthUrl, exchangeCode } from '../integrations/google/oauth';
import { saveAccount, encryptTokens, getAllAccounts } from '../integrations/token-store';
import { Redis } from '@upstash/redis';
import { env } from '../env';

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

function stateKey(id: string) { return `secretariat:oauth:state:${id}`; }

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  const state = uuidv4();
  await getRedis().set(stateKey(state), JSON.stringify({ alias, type }), { ex: STATE_TTL_SECONDS });

  res.redirect(getAuthUrl(state));
});

router.get('/google/callback', requireAuth, async (req: Request, res: Response) => {
  const code = req.query['code'] as string | undefined;
  const state = req.query['state'] as string | undefined;
  const error = req.query['error'] as string | undefined;

  if (error) {
    res.status(400).send(`<h2>OAuth Error: ${escapeHtml(String(error))}</h2><a href="/">Back to admin</a>`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('<h2>Missing code or state.</h2><a href="/">Back to admin</a>');
    return;
  }

  const raw = await getRedis().get<string>(stateKey(state));
  if (!raw) {
    res.status(400).send('<h2>Unknown or expired OAuth state.</h2><a href="/">Back to admin</a>');
    return;
  }

  await getRedis().del(stateKey(state));
  const pending = JSON.parse(raw) as { alias: string; type: typeof ALLOWED_TYPES[number] };

  try {
    const tokens = await exchangeCode(code);
    const existingAccounts = await getAllAccounts();
    const existing = existingAccounts.find((a) => a.alias === pending.alias && a.type === pending.type);
    const isFirstOfType = !existingAccounts.some((a) => a.type === pending.type);
    const accountId = existing?.id ?? uuidv4();

    await saveAccount({
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

    res.send(`
      <h2>✅ Connected!</h2>
      <p>Google ${escapeHtml(pending.type)} account "<strong>${escapeHtml(pending.alias)}</strong>" connected successfully.</p>
      <a href="/">Back to admin panel</a>
    `);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.status(500).send('<h2>❌ Connection failed. Check server logs for details.</h2><a href="/">Back to admin</a>');
  }
});

export default router;
