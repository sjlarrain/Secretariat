import { Redis } from '@upstash/redis';
import { env } from '../../../shared/env';
import { userKey, userSeqKey } from '../../../shared/redis/keys';
import { HashCollection, byId } from '../../../shared/redis/hash-collection';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export interface Link {
  id: number;
  url: string;
  tags: string[];
  createdAt: string;
  readAt?: string;
  name?: string;
}

function links(userId: string): HashCollection<Link> {
  return new HashCollection<Link>(redis, userKey(userId, 'links'), userSeqKey(userId, 'links'));
}

async function getAllLinksRaw(userId: string): Promise<Link[]> {
  return links(userId).getAll(byId);
}

export async function getLinks(userId: string): Promise<Link[]> {
  const all = await getAllLinksRaw(userId);
  return all.filter((l) => !l.readAt);
}

export async function getReadLinks(userId: string): Promise<Link[]> {
  const all = await getAllLinksRaw(userId);
  return all.filter((l) => !!l.readAt);
}

export async function addLink(userId: string, url: string, tags: string[], name?: string): Promise<Link> {
  const id = await links(userId).nextId();
  const link: Link = { id, url: url.trim(), tags, createdAt: new Date().toISOString() };
  if (name?.trim()) link.name = name.trim();
  await links(userId).set(link);
  return link;
}

export async function markLinkRead(userId: string, id: number): Promise<boolean> {
  const link = await links(userId).get(id);
  if (!link || link.readAt) return false;
  link.readAt = new Date().toISOString();
  await links(userId).set(link);
  return true;
}

export async function deleteLink(userId: string, id: number): Promise<boolean> {
  return links(userId).remove(id);
}

export async function updateLink(
  userId: string,
  id: number,
  data: { url?: string; tags?: string[]; name?: string }
): Promise<boolean> {
  const link = await links(userId).get(id);
  if (!link) return false;
  if (data.url !== undefined) link.url = data.url.trim();
  if (data.tags !== undefined) link.tags = data.tags;
  if (data.name !== undefined) link.name = data.name.trim() || undefined;
  await links(userId).set(link);
  return true;
}
