import { Redis } from '@upstash/redis';
import { env } from '../../env';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const PENDING_KEY = 'secretariat:links:pending';

// Single-user bot: one pending "awaiting a name" link at a time is enough.
// Saving a new link overwrites this, so naming always targets the most
// recently saved link unless the user swipe-replies to an older confirmation.
const TTL_SEC = 600; // 10 minutes

export interface PendingLink {
  linkId: number;
  position: number;
}

export async function setPendingLink(linkId: number, position: number): Promise<void> {
  await redis.set(PENDING_KEY, { linkId, position }, { ex: TTL_SEC });
}

export async function getPendingLink(): Promise<PendingLink | null> {
  return redis.get<PendingLink>(PENDING_KEY);
}

export async function clearPendingLink(): Promise<void> {
  await redis.del(PENDING_KEY);
}
