import { Redis } from '@upstash/redis';
import { env } from '../../env';
import { userKey, userSeqKey } from '../../redis/keys';
import { HashCollection, byId } from '../../redis/hash-collection';

export interface PlanType {
  id: number;
  name: string;
  days: number[];          // 0=Sun … 6=Sat
  slots: string[];         // HH:MM 24h strings
  durationMinutes: number;
  bufferMinutes: number;   // travel buffer applied before and after the slot
}

const DEFAULT_PLANS: Omit<PlanType, 'id'>[] = [
  { name: 'Lunch',       days: [1,2,3,4],     slots: ['13:00','13:30','14:00'],          durationMinutes: 60, bufferMinutes: 30 },
  { name: 'Coffee',      days: [1,2,3,4,5],   slots: ['10:00','16:00','17:00'],          durationMinutes: 30, bufferMinutes: 15 },
  { name: 'After-office',days: [1,2,3,4],     slots: ['18:30','19:00','20:00'],          durationMinutes: 90, bufferMinutes: 30 },
  { name: 'Sports',      days: [1,2,3,4,5,6], slots: ['07:00','08:00','19:00','20:00'],  durationMinutes: 60, bufferMinutes: 0  },
];

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

function plans(userId: string): HashCollection<PlanType> {
  return new HashCollection<PlanType>(getRedis(), userKey(userId, 'plans'), userSeqKey(userId, 'plans'));
}

export async function getPlans(userId: string): Promise<PlanType[]> {
  const existing = await plans(userId).getAll(byId);
  if (existing.length > 0) return existing;

  // Seed this user's default plans on first read.
  const seeded: PlanType[] = [];
  for (const p of DEFAULT_PLANS) {
    const id = await plans(userId).nextId();
    const plan: PlanType = { id, ...p };
    seeded.push(plan);
    await plans(userId).set(plan);
  }
  return seeded;
}

export async function getPlan(userId: string, id: number): Promise<PlanType | null> {
  return plans(userId).get(id);
}

export async function createPlan(userId: string, data: Omit<PlanType, 'id'>): Promise<PlanType> {
  const id = await plans(userId).nextId();
  const plan: PlanType = { id, ...data };
  await plans(userId).set(plan);
  return plan;
}

export async function updatePlan(userId: string, id: number, data: Partial<Omit<PlanType, 'id'>>): Promise<boolean> {
  const plan = await plans(userId).get(id);
  if (!plan) return false;
  await plans(userId).set({ ...plan, ...data });
  return true;
}

export async function deletePlan(userId: string, id: number): Promise<boolean> {
  return plans(userId).remove(id);
}

export function findPlanByName(name: string, planList: PlanType[]): PlanType | null {
  const normalized = name.toLowerCase().replace(/[\s-]/g, '');
  return planList.find((p) => p.name.toLowerCase().replace(/[\s-]/g, '') === normalized) ?? null;
}
