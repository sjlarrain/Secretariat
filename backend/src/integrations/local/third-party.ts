import { Redis } from '@upstash/redis';
import { env } from '../../env';

export interface ThirdPartyContact {
  number: string; // E.164
  alias: string;
}

export interface ThirdPartyPending {
  id: string;
  title: string;
  forValue: string;
  atValue: string;
  senderPhone: string;
  senderAlias: string;
  createdAt: string; // ISO
  reminderId: string;       // UUID of the auto-saved reminder
  reminderMessageId: string; // QStash message ID (empty if deferred)
}

const CONTACTS_KEY = 'secretariat:third-party-contacts';
const PENDING_KEY = 'secretariat:third-party-pending';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

export async function getThirdPartyContacts(): Promise<ThirdPartyContact[]> {
  const data = await getRedis().get<ThirdPartyContact[]>(CONTACTS_KEY);
  return data ?? [];
}

export async function addThirdPartyContact(contact: ThirdPartyContact): Promise<void> {
  const list = await getThirdPartyContacts();
  if (list.some((c) => c.number === contact.number)) return;
  await getRedis().set(CONTACTS_KEY, [...list, contact]);
}

export async function removeThirdPartyContact(number: string): Promise<boolean> {
  const list = await getThirdPartyContacts();
  const filtered = list.filter((c) => c.number !== number);
  if (filtered.length === list.length) return false;
  await getRedis().set(CONTACTS_KEY, filtered);
  return true;
}

export async function findThirdPartyContact(number: string): Promise<ThirdPartyContact | null> {
  const list = await getThirdPartyContacts();
  return list.find((c) => c.number === number) ?? null;
}

export async function getPendingEvents(): Promise<ThirdPartyPending[]> {
  const data = await getRedis().get<ThirdPartyPending[]>(PENDING_KEY);
  return data ?? [];
}

export async function savePendingEvent(p: ThirdPartyPending): Promise<void> {
  const list = await getPendingEvents();
  await getRedis().set(PENDING_KEY, [...list, p]);
}

export async function removePendingEvent(id: string): Promise<ThirdPartyPending | null> {
  const list = await getPendingEvents();
  const item = list.find((p) => p.id === id);
  if (!item) return null;
  await getRedis().set(PENDING_KEY, list.filter((p) => p.id !== id));
  return item;
}
