import { Redis } from '@upstash/redis';
import { env } from '../shared/env';
import { pointKey } from '../shared/redis/keys';
import { getZonedParts } from '../shared/utils/date';
import { getRegisteredUsers } from '../auth/users';
import { getSettings } from '../core/integrations/token-store';
import { fireMorningDigest } from '../core/cron/morning-digest';
import { fireWeeklySummary } from '../core/cron/weekly-summary';
import { fireMbaReminder } from '../core/cron/mba-reminder';
import { promoteDeferred } from '../core/cron/reminder-promoter';
import { syncGoogleTasks } from '../core/cron/google-tasks-sync';
import { runHealthCheck } from '../ops/cron/health-check';

// Replaces the five (six, counting the MBA Monday reminder) per-user QStash
// cron schedules v1/early-v2 created via reconcileSchedules — see
// docs/v2-plan.md §C.5. QStash's free tier caps at 3 cron schedules total, so
// N users x 6 jobs each with their own schedule was never going to scale.
// Instead there is exactly one schedule (`/internal/tick`, created once at
// boot — see ensureSweeperSchedule.ts), firing hourly in UTC. Every tick,
// this module enumerates every active user and, in their own timezone,
// decides what's due.
//
// A schedule granularity of "once an hour" means minute-level precision in
// `Settings.*.time` is lost — a digest configured for 08:30 fires at the
// 08:00-08:59 tick, not 08:30 on the dot. That's an accepted tradeoff of the
// collapse, not a bug. Google Tasks sync similarly moves from a fixed 15-minute
// interval to hourly — the only cadence a single hourly tick can offer.

const FIRED_TTL_SECONDS = 48 * 60 * 60; // cleanup only; the atomic SET NX is the actual guard

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

/**
 * Atomically claims the right to run `job` for `userId` at `bucket`. Returns
 * true the first time (this call should run the job), false if some other
 * sweep (a doubled tick, an overlapping run) already claimed it.
 */
async function claim(userId: string, job: string, bucket: string): Promise<boolean> {
  const result = await getRedis().set(pointKey('fired', `${userId}:${job}:${bucket}`), Date.now(), {
    nx: true,
    ex: FIRED_TTL_SECONDS,
  });
  return result === 'OK';
}

function hourOf(time: string): number {
  return Number(time.split(':')[0]);
}

interface SweepCounters {
  fired: Record<string, number>;
  errors: number;
}

/** Runs `job` for `userId` if not already claimed for `bucket`, tracking the outcome. */
async function maybeFire(
  userId: string,
  job: string,
  bucket: string,
  run: () => Promise<void>,
  counters: SweepCounters
): Promise<void> {
  if (!(await claim(userId, job, bucket))) return;
  try {
    await run();
    counters.fired[job] = (counters.fired[job] ?? 0) + 1;
  } catch (err) {
    counters.errors++;
    console.error(`Sweeper: ${job} failed for ${userId}:`, err);
  }
}

async function sweepUser(userId: string, now: Date, counters: SweepCounters): Promise<void> {
  const settings = await getSettings(userId);
  const { dateStr, hour, weekday } = getZonedParts(now, settings.timezone);
  const hourBucket = `${dateStr}T${hour}`;

  const tasks: Promise<void>[] = [];

  if (settings.morningDigest.enabled && settings.morningDigest.days.includes(weekday) && hour === hourOf(settings.morningDigest.time)) {
    tasks.push(maybeFire(userId, 'morning-digest', dateStr, () => fireMorningDigest(userId), counters));
  }

  if (settings.weeklySummary.enabled && weekday === settings.weeklySummary.day && hour === hourOf(settings.weeklySummary.time)) {
    tasks.push(maybeFire(userId, 'weekly-summary', dateStr, () => fireWeeklySummary(userId), counters));
  }

  // MBA Monday reminder — weekday 1 = Monday.
  if (settings.mbaReminder?.enabled && weekday === 1 && hour === hourOf(settings.mbaReminder.time)) {
    tasks.push(maybeFire(userId, 'mba-reminder', dateStr, () => fireMbaReminder(userId), counters));
  }

  // Reminder promoter — weekday 0 = Sunday. Always enabled (Settings.reminderPromoter.enabled is the literal `true`).
  if (weekday === 0 && hour === hourOf(settings.reminderPromoter.time)) {
    tasks.push(maybeFire(userId, 'reminder-promoter', dateStr, async () => { await promoteDeferred(userId); }, counters));
  }

  // System health check — nightly, but keyed off whichever user enabled it in
  // their own settings (pre-existing design debt noted in ops/cron/health-check.ts;
  // not something this sweep collapse changes).
  if (settings.healthCheck?.enabled && hour === hourOf(settings.healthCheck.time)) {
    tasks.push(maybeFire(userId, 'health-check', dateStr, async () => { await runHealthCheck(userId); }, counters));
  }

  // Google Tasks sync — every tick it's enabled (was a fixed 15-min interval;
  // now hourly is the finest grain a single sweeper tick can offer).
  if (settings.googleTasksSync?.enabled) {
    tasks.push(maybeFire(userId, 'google-tasks-sync', hourBucket, async () => { await syncGoogleTasks(userId); }, counters));
  }

  await Promise.all(tasks);
}

export interface SweepResult {
  usersProcessed: number;
  fired: Record<string, number>;
  errors: number;
}

/** Entry point for POST /internal/tick. `now` is injectable for tests. */
export async function runSweep(now: Date = new Date()): Promise<SweepResult> {
  const users = (await getRegisteredUsers()).filter((u) => u.status === 'active');
  const counters: SweepCounters = { fired: {}, errors: 0 };

  await Promise.all(
    users.map((user) =>
      sweepUser(user.id, now, counters).catch((err) => {
        counters.errors++;
        console.error(`Sweeper: user ${user.id} failed:`, err);
      })
    )
  );

  return {
    usersProcessed: users.length,
    fired: counters.fired,
    errors: counters.errors,
  };
}
