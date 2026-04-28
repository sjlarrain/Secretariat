import { Redis } from '@upstash/redis';
import { env } from '../../env';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = 'secretariat:ideas';

export interface Idea {
  id: number;
  text: string;
  createdAt: string;
}

export async function getIdeas(): Promise<Idea[]> {
  return (await redis.get<Idea[]>(KEY)) ?? [];
}

export async function addIdea(text: string): Promise<Idea> {
  const ideas = await getIdeas();
  const id = ideas.length ? Math.max(...ideas.map((i) => i.id)) + 1 : 1;
  const idea: Idea = { id, text, createdAt: new Date().toISOString() };
  await redis.set(KEY, [...ideas, idea]);
  return idea;
}

export async function deleteIdea(id: number): Promise<boolean> {
  const ideas = await getIdeas();
  const filtered = ideas.filter((i) => i.id !== id);
  if (filtered.length === ideas.length) return false;
  await redis.set(KEY, filtered);
  return true;
}
