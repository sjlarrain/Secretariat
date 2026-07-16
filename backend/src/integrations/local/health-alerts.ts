import { Redis } from '@upstash/redis';
import { env } from '../../env';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
const ALERTS_KEY = 'secretariat:health-alerts';

export type AlertKind = 'kapso' | 'google' | 'qstash' | 'redis';

export interface HealthAlert {
  /** Stable per-issue id so a recurring problem updates rather than piles up. */
  id: string;
  kind: AlertKind;
  severity: 'warn' | 'error';
  message: string;
  /** Admin-panel path that resolves the issue, e.g. '/accounts'. */
  resolveLink?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function getHealthAlerts(): Promise<HealthAlert[]> {
  return (await redis.get<HealthAlert[]>(ALERTS_KEY)) ?? [];
}

/**
 * Replaces the stored alert set with the issues found by the latest run.
 * Alerts that persist keep their original `firstSeenAt`, so the panel can show
 * how long something has been broken; resolved issues simply drop out.
 *
 * Returns the alerts that are new since the previous run — these are the only
 * ones worth notifying about, so a persistent issue does not re-notify nightly.
 */
export async function reconcileHealthAlerts(
  found: Omit<HealthAlert, 'firstSeenAt' | 'lastSeenAt'>[]
): Promise<{ alerts: HealthAlert[]; newAlerts: HealthAlert[] }> {
  const previous = await getHealthAlerts();
  const previousById = new Map(previous.map((a) => [a.id, a]));
  const now = new Date().toISOString();

  const alerts: HealthAlert[] = found.map((f) => {
    const existing = previousById.get(f.id);
    return { ...f, firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now };
  });

  const newAlerts = alerts.filter((a) => !previousById.has(a.id));

  await redis.set(ALERTS_KEY, alerts);
  return { alerts, newAlerts };
}

export async function clearHealthAlerts(): Promise<void> {
  await redis.set(ALERTS_KEY, []);
}

/** Lightweight reachability probe used by the health check itself. */
export async function pingRedis(): Promise<boolean> {
  try {
    const res = await redis.ping();
    return typeof res === 'string' && res.toUpperCase() === 'PONG';
  } catch {
    return false;
  }
}
