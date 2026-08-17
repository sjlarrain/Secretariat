import { Redis } from '@upstash/redis';
import { env } from '../../env';
import { systemKey } from '../../redis/keys';
import { HashCollection } from '../../redis/hash-collection';

// Numbers the operator has explicitly turned away after seeing them in the
// unrecognized-senders list (docs/v2-plan.md §A.4, §C.3: `blocked:<phone>`).
// Checked by resolveSenderMiddleware before an unknown number is logged as
// unrecognized or checked against third-party contacts, so a blocked number
// stops accumulating noise in either list.

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export interface BlockedSender {
  /** E.164 phone number — supplied, not minted, so no `:seq`. */
  id: string;
  blockedAt: string;
}

const blocked = new HashCollection<BlockedSender>(redis, systemKey('blocked'));

export async function getBlockedSenders(): Promise<BlockedSender[]> {
  return blocked.getAll((a, b) => b.blockedAt.localeCompare(a.blockedAt));
}

export async function isBlocked(phone: string): Promise<boolean> {
  if (!phone) return false;
  return (await blocked.get(phone)) !== null;
}

export async function blockSender(phone: string): Promise<BlockedSender> {
  const entry: BlockedSender = { id: phone, blockedAt: new Date().toISOString() };
  await blocked.set(entry);
  return entry;
}

export async function unblockSender(phone: string): Promise<boolean> {
  return blocked.remove(phone);
}
