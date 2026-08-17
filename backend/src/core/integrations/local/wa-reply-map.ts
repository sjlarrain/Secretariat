import { Redis } from '@upstash/redis';
import { env } from '../../../shared/env';
import { pointKey } from '../../../shared/redis/keys';

export interface WaReplyTarget {
  /** 'work' is the pre-v1.14 name for 'ucla'; still read for targets stored
   *  before the rename (48h TTL means they age out on their own). */
  type: 'rem' | 'task' | 'ucla' | 'work' | 'link';
  id: string; // UUID for rem, stringified number for task/ucla/link
  title: string;
  phoneNumber: string;
  /**
   * Owning user id for the reminder/task/ucla item/link this reply targets.
   * Usually equal to `phoneNumber`, but not always — a third-party pending
   * event's cached target belongs to the owner who receives it, not to the
   * third party's own number. Callers must use this for data lookups, not
   * `phoneNumber` (which is only a send target).
   */
  userId: string;
}

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

const TTL = 172800; // 48 hours

export async function storeReplyTarget(waMessageId: string, target: WaReplyTarget): Promise<void> {
  await getRedis().set(pointKey('wa-reply', waMessageId), target, { ex: TTL });
}

export async function getReplyTarget(waMessageId: string): Promise<WaReplyTarget | null> {
  return getRedis().get<WaReplyTarget>(pointKey('wa-reply', waMessageId));
}
