import type { Settings } from '../integrations/token-store';
import { scheduleCron, deleteSchedule } from './client';
import { buildCron } from '../utils/timezone';

// Deletes and recreates a QStash schedule when its own config changes, or when
// the platform timezone changes. The timezone check matters: `timezone` lives
// outside each schedule's config object, so a zone change would otherwise leave
// every existing schedule running at its old wall-clock time indefinitely.
async function reconcileCron<T extends { enabled: boolean; scheduleId?: string }>(
  prev: T,
  next: T,
  opts: { path: string; label: string; zoneChanged: boolean; buildExpr: () => string; body: object }
): Promise<void> {
  const changed = opts.zoneChanged || JSON.stringify(prev) !== JSON.stringify(next);

  if (prev.scheduleId && (!next.enabled || changed)) {
    try { await deleteSchedule(prev.scheduleId); } catch { /* ignore */ }
    next.scheduleId = undefined;
  }

  if (next.enabled && !next.scheduleId) {
    try {
      next.scheduleId = await scheduleCron(opts.path, opts.buildExpr(), opts.body);
    } catch (err) {
      console.error(`Failed to create ${opts.label} schedule:`, err);
    }
  }
}

/**
 * Brings every QStash schedule for `userId` in line with `next`, mutating and
 * returning it with up-to-date schedule IDs. Callers must persist the result.
 *
 * Shared by the admin panel's PUT /settings and the /zone command so a timezone
 * change regenerates all schedules regardless of which entry point made it.
 *
 * Each schedule's QStash body carries `{ userId }` so the fire handler in
 * routes/internal.ts knows whose data to act on — until the user registry
 * (v2 Goal 2) and cron collapse (Goal 3) land, every user who enables one of
 * these ends up with their own schedule hitting the same shared endpoint,
 * which is fine at today's scale but is exactly what Goal 3 replaces with a
 * single sweeper (QStash's free tier caps at 3 cron schedules total).
 */
export async function reconcileSchedules(userId: string, current: Settings, next: Settings): Promise<Settings> {
  const zoneChanged = current.timezone !== next.timezone;
  const tz = next.timezone;
  const body = { userId };

  // The reminder promoter can never be disabled: deferred reminders (those
  // beyond QStash's 7-day max delay) have no queued message and depend entirely
  // on this cron to ever fire. Forced here as well as in token-store because
  // callers reconcile *before* saving — without this, a request carrying
  // enabled:false would delete the schedule and only then be normalized on
  // write, leaving enabled:true in Redis with no live schedule.
  next.reminderPromoter = { ...next.reminderPromoter, enabled: true };

  const nextMorning = next.morningDigest;
  await reconcileCron(current.morningDigest, nextMorning, {
    path: '/internal/digest/morning',
    label: 'morning digest',
    zoneChanged,
    buildExpr: () => buildCron(nextMorning.time, tz, nextMorning.days),
    body,
  });

  const nextWeekly = next.weeklySummary;
  await reconcileCron(current.weeklySummary, nextWeekly, {
    path: '/internal/digest/weekly',
    label: 'weekly summary',
    zoneChanged,
    buildExpr: () => buildCron(nextWeekly.time, tz, [nextWeekly.day]),
    body,
  });

  // UCLA reminder — fires every Monday
  const prevUcla = current.uclaReminder ?? { enabled: false, time: '09:00' };
  const nextUcla = next.uclaReminder ?? prevUcla;
  await reconcileCron(prevUcla, nextUcla, {
    path: '/internal/digest/ucla',
    label: 'ucla reminder',
    zoneChanged,
    buildExpr: () => buildCron(nextUcla.time, tz, [1]),
    body,
  });
  next.uclaReminder = nextUcla;

  // Reminder promoter — weekly, Sunday. Always enabled (see above).
  const prevPromoter = current.reminderPromoter ?? { enabled: true as const, time: '08:00' };
  const nextPromoter = next.reminderPromoter ?? prevPromoter;
  await reconcileCron(prevPromoter, nextPromoter, {
    path: '/internal/reminder/promote',
    label: 'reminder promoter',
    zoneChanged,
    buildExpr: () => buildCron(nextPromoter.time, tz, [0]),
    body,
  });
  next.reminderPromoter = nextPromoter;

  // Nightly health check — every day at the configured local time. System-wide
  // (not per-user data), but scheduled off this user's timezone/settings until
  // Goal 2 gives the ops console its own schedule surface.
  const prevHealth = current.healthCheck ?? { enabled: false, time: '23:00' };
  const nextHealth = next.healthCheck ?? prevHealth;
  await reconcileCron(prevHealth, nextHealth, {
    path: '/internal/health-check',
    label: 'health check',
    zoneChanged,
    buildExpr: () => buildCron(nextHealth.time, tz, []),
    body,
  });
  next.healthCheck = nextHealth;

  // Google Tasks sync — fixed 15-minute interval, so it needs no timezone.
  // `lastSyncAt` churns on every run, so it cannot go through reconcileCron's
  // config diff without being recreated constantly; only the toggle matters.
  const prevTasksSync = current.googleTasksSync ?? { enabled: false };
  const nextTasksSync = next.googleTasksSync ?? prevTasksSync;

  if (prevTasksSync.scheduleId && !nextTasksSync.enabled) {
    try { await deleteSchedule(prevTasksSync.scheduleId); } catch { /* ignore */ }
    nextTasksSync.scheduleId = undefined;
  }

  if (nextTasksSync.enabled && !nextTasksSync.scheduleId) {
    try {
      nextTasksSync.scheduleId = await scheduleCron('/internal/tasks/sync', '*/15 * * * *', body);
    } catch (err) {
      console.error('Failed to create Google Tasks sync schedule:', err);
    }
  }
  next.googleTasksSync = nextTasksSync;

  return next;
}
