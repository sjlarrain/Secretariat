import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import { env } from '../../env';
import { pointKey } from '../../redis/keys';

// Single-use, short-lived tokens that stand in for a password on the
// per-user panel (docs/v2-plan.md §B.4). A user requests one over WhatsApp
// (`/panel`); tapping the link it comes back with is the entire login.

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

// Long enough to notice and tap a WhatsApp message, short enough that a
// forwarded or leaked link stops being useful quickly.
const LOGIN_TOKEN_TTL_SECONDS = 10 * 60;

function generateToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/** Mints a one-time login link token for `userId`. */
export async function createPanelLoginToken(userId: string): Promise<string> {
  const token = generateToken();
  await redis.set(pointKey('panel-login', token), userId, { ex: LOGIN_TOKEN_TTL_SECONDS });
  return token;
}

/**
 * Consumes a login token, returning the `userId` it was minted for, or
 * `null` if the token is unknown, expired, or already used.
 *
 * Settled the same way an invite is redeemed: a `SET NX` on a separate claim
 * key wins the race before either caller reads the token's owner, so two
 * near-simultaneous uses of one link (e.g. a retried request) can't both
 * establish a session.
 */
export async function consumePanelLoginToken(token: string): Promise<string | null> {
  if (!token) return null;

  const userId = await redis.get<string>(pointKey('panel-login', token));
  if (!userId) return null;

  const claimed = await redis.set(pointKey('panel-login-claim', token), '1', {
    nx: true,
    ex: LOGIN_TOKEN_TTL_SECONDS,
  });
  if (claimed === null) return null;

  await redis.del(pointKey('panel-login', token));
  return userId;
}
