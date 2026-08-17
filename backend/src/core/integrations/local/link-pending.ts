import { Redis } from '@upstash/redis';
import { env } from '../../../shared/env';
import { userKey } from '../../../shared/redis/keys';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

// One pending "awaiting a name" link at a time, per user, is enough. Saving a
// new link overwrites this, so naming always targets that user's most
// recently saved link unless they swipe-reply to an older confirmation.
const TTL_SEC = 600; // 10 minutes

export interface PendingLink {
  linkId: number;
  position: number;
}

export async function setPendingLink(userId: string, linkId: number, position: number): Promise<void> {
  await redis.set(userKey(userId, 'links-pending'), { linkId, position }, { ex: TTL_SEC });
}

export async function getPendingLink(userId: string): Promise<PendingLink | null> {
  return redis.get<PendingLink>(userKey(userId, 'links-pending'));
}

export async function clearPendingLink(userId: string): Promise<void> {
  await redis.del(userKey(userId, 'links-pending'));
}
