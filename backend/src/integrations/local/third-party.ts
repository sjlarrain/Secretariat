import { Redis } from '@upstash/redis';
import { env } from '../../env';
import { userKey } from '../../redis/keys';
import { HashCollection } from '../../redis/hash-collection';

export interface ThirdPartyContact {
  number: string; // E.164
  alias: string;
  lastMessageAt?: string; // ISO — last inbound message; used to check 24h WhatsApp session window
}

export interface ThirdPartyPending {
  id: string;
  title: string;
  forValue: string;
  atValue: string;
  fireAt: string;           // resolved ISO datetime — avoids re-parsing relative dates at tap time
  senderPhone: string;
  senderAlias: string;
  createdAt: string; // ISO
  reminderId: string;       // UUID of the auto-saved reminder
  reminderMessageId: string; // QStash message ID (empty if deferred)
}

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

// Third-party contacts propose events *to* a registered user (e.g. Santiago),
// so they're namespaced under that owning user's id, not under the
// third party's own number — third parties aren't registered users.
function contactsKey(ownerId: string): string {
  return userKey(ownerId, 'third-party-contacts');
}

function pendingEvents(ownerId: string): HashCollection<ThirdPartyPending> {
  return new HashCollection<ThirdPartyPending>(getRedis(), userKey(ownerId, 'third-party-pending'));
}

export async function getThirdPartyContacts(ownerId: string): Promise<ThirdPartyContact[]> {
  const data = await getRedis().hgetall<Record<string, ThirdPartyContact>>(contactsKey(ownerId));
  return data ? Object.values(data) : [];
}

export async function addThirdPartyContact(ownerId: string, contact: ThirdPartyContact): Promise<void> {
  const existing = await findThirdPartyContact(ownerId, contact.number);
  if (existing) return;
  await getRedis().hset(contactsKey(ownerId), { [contact.number]: contact });
}

export async function removeThirdPartyContact(ownerId: string, number: string): Promise<boolean> {
  const removed = await getRedis().hdel(contactsKey(ownerId), number);
  return removed > 0;
}

export async function findThirdPartyContact(ownerId: string, number: string): Promise<ThirdPartyContact | null> {
  const contact = await getRedis().hget<ThirdPartyContact>(contactsKey(ownerId), number);
  return contact ?? null;
}

export async function updateThirdPartyLastMessage(ownerId: string, number: string): Promise<void> {
  const contact = await findThirdPartyContact(ownerId, number);
  if (!contact) return;
  contact.lastMessageAt = new Date().toISOString();
  await getRedis().hset(contactsKey(ownerId), { [number]: contact });
}

export async function canNotifyThirdParty(ownerId: string, number: string): Promise<boolean> {
  const contact = await findThirdPartyContact(ownerId, number);
  if (!contact?.lastMessageAt) return false;
  const elapsed = Date.now() - new Date(contact.lastMessageAt).getTime();
  return elapsed < 24 * 60 * 60 * 1000;
}

export async function getPendingEvents(ownerId: string): Promise<ThirdPartyPending[]> {
  return pendingEvents(ownerId).getAll();
}

export async function savePendingEvent(ownerId: string, p: ThirdPartyPending): Promise<void> {
  await pendingEvents(ownerId).set(p);
}

export async function removePendingEvent(ownerId: string, id: string): Promise<ThirdPartyPending | null> {
  const item = await pendingEvents(ownerId).get(id);
  if (!item) return null;
  await pendingEvents(ownerId).remove(id);
  return item;
}
