import { Redis } from '@upstash/redis';
import { env } from '../../env';
import { systemKey } from '../../redis/keys';
import { HashCollection } from '../../redis/hash-collection';

const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

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

// System-wide, not per-user: this tracks the health of the shared Kapso
// number, Google/QStash/Redis connectivity — infrastructure the ops console
// monitors, not any one user's data.
const alerts = new HashCollection<HealthAlert>(redis, systemKey('health-alerts'));

export async function getHealthAlerts(): Promise<HealthAlert[]> {
  return alerts.getAll();
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

  const next: HealthAlert[] = found.map((f) => {
    const existing = previousById.get(f.id);
    return { ...f, firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now };
  });

  const newAlerts = next.filter((a) => !previousById.has(a.id));
  const nextIds = new Set(next.map((a) => a.id));
  const resolved = previous.filter((a) => !nextIds.has(a.id));

  await Promise.all([
    ...next.map((a) => alerts.set(a)),
    ...resolved.map((a) => alerts.remove(a.id)),
  ]);

  return { alerts: next, newAlerts };
}

export async function clearHealthAlerts(): Promise<void> {
  const all = await getHealthAlerts();
  await Promise.all(all.map((a) => alerts.remove(a.id)));
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
