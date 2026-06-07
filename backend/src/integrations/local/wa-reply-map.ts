import { Redis } from '@upstash/redis';
import { env } from '../../env';

export interface WaReplyTarget {
  type: 'rem' | 'task' | 'work';
  id: string; // UUID for rem, stringified number for task/work
  title: string;
  phoneNumber: string;
}

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

const TTL = 172800; // 48 hours

export async function storeReplyTarget(waMessageId: string, target: WaReplyTarget): Promise<void> {
  await getRedis().set(`secretariat:wa-reply:${waMessageId}`, target, { ex: TTL });
}

export async function getReplyTarget(waMessageId: string): Promise<WaReplyTarget | null> {
  return getRedis().get<WaReplyTarget>(`secretariat:wa-reply:${waMessageId}`);
}
