import { Redis } from '@upstash/redis';
import { env } from '../../env';

export interface PlanType {
  id: number;
  name: string;
  days: number[];          // 0=Sun … 6=Sat
  slots: string[];         // HH:MM 24h strings
  durationMinutes: number;
  bufferMinutes: number;   // travel buffer applied before and after the slot
}

const PLANS_KEY = 'secretariat:plans';

const DEFAULT_PLANS: PlanType[] = [
  { id: 1, name: 'Lunch',       days: [1,2,3,4],     slots: ['13:00','13:30','14:00'],          durationMinutes: 60, bufferMinutes: 30 },
  { id: 2, name: 'Coffee',      days: [1,2,3,4,5],   slots: ['10:00','16:00','17:00'],          durationMinutes: 30, bufferMinutes: 15 },
  { id: 3, name: 'After-office',days: [1,2,3,4],     slots: ['18:30','19:00','20:00'],          durationMinutes: 90, bufferMinutes: 30 },
  { id: 4, name: 'Sports',      days: [1,2,3,4,5,6], slots: ['07:00','08:00','19:00','20:00'],  durationMinutes: 60, bufferMinutes: 0  },
];

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

export async function getPlans(): Promise<PlanType[]> {
  const data = await getRedis().get<PlanType[]>(PLANS_KEY);
  if (!data) {
    await getRedis().set(PLANS_KEY, DEFAULT_PLANS);
    return DEFAULT_PLANS;
  }
  return data;
}

export async function getPlan(id: number): Promise<PlanType | null> {
  const plans = await getPlans();
  return plans.find((p) => p.id === id) ?? null;
}

export async function createPlan(data: Omit<PlanType, 'id'>): Promise<PlanType> {
  const plans = await getPlans();
  const id = plans.length > 0 ? Math.max(...plans.map((p) => p.id)) + 1 : 1;
  const plan: PlanType = { id, ...data };
  await getRedis().set(PLANS_KEY, [...plans, plan]);
  return plan;
}

export async function updatePlan(id: number, data: Partial<Omit<PlanType, 'id'>>): Promise<boolean> {
  const plans = await getPlans();
  const idx = plans.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  plans[idx] = { ...plans[idx], ...data };
  await getRedis().set(PLANS_KEY, plans);
  return true;
}

export async function deletePlan(id: number): Promise<boolean> {
  const plans = await getPlans();
  const filtered = plans.filter((p) => p.id !== id);
  if (filtered.length === plans.length) return false;
  await getRedis().set(PLANS_KEY, filtered);
  return true;
}

export function findPlanByName(name: string, plans: PlanType[]): PlanType | null {
  const normalized = name.toLowerCase().replace(/[\s-]/g, '');
  return plans.find((p) => p.name.toLowerCase().replace(/[\s-]/g, '') === normalized) ?? null;
}
