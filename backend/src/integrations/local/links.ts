import { Redis } from '@upstash/redis';
import { env } from '../../env';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const LINKS_KEY = 'secretariat:links';

export interface Link {
  id: number;
  url: string;
  tags: string[];
  createdAt: string;
  readAt?: string;
  name?: string;
}

async function getAllLinksRaw(): Promise<Link[]> {
  return (await redis.get<Link[]>(LINKS_KEY)) ?? [];
}

export async function getLinks(): Promise<Link[]> {
  const all = await getAllLinksRaw();
  return all.filter((l) => !l.readAt);
}

export async function getReadLinks(): Promise<Link[]> {
  const all = await getAllLinksRaw();
  return all.filter((l) => !!l.readAt);
}

export async function addLink(url: string, tags: string[], name?: string): Promise<Link> {
  const all = await getAllLinksRaw();
  const id = all.length ? Math.max(...all.map((l) => l.id)) + 1 : 1;
  const link: Link = { id, url: url.trim(), tags, createdAt: new Date().toISOString() };
  if (name?.trim()) link.name = name.trim();
  await redis.set(LINKS_KEY, [...all, link]);
  return link;
}

export async function markLinkRead(id: number): Promise<boolean> {
  const all = await getAllLinksRaw();
  const idx = all.findIndex((l) => l.id === id && !l.readAt);
  if (idx === -1) return false;
  all[idx].readAt = new Date().toISOString();
  await redis.set(LINKS_KEY, all);
  return true;
}

export async function deleteLink(id: number): Promise<boolean> {
  const all = await getAllLinksRaw();
  const filtered = all.filter((l) => l.id !== id);
  if (filtered.length === all.length) return false;
  await redis.set(LINKS_KEY, filtered);
  return true;
}

export async function updateLink(id: number, data: { url?: string; tags?: string[]; name?: string }): Promise<boolean> {
  const all = await getAllLinksRaw();
  const idx = all.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  if (data.url !== undefined) all[idx].url = data.url.trim();
  if (data.tags !== undefined) all[idx].tags = data.tags;
  if (data.name !== undefined) all[idx].name = data.name.trim() || undefined;
  await redis.set(LINKS_KEY, all);
  return true;
}
