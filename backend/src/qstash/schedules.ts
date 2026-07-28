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
  opts: { path: string; label: string; zoneChanged: boolean; buildExpr: () => string }
): Promise<void> {
  const changed = opts.zoneChanged || JSON.stringify(prev) !== JSON.stringify(next);

  if (prev.scheduleId && (!next.enabled || changed)) {
    try { await deleteSchedule(prev.scheduleId); } catch { /* ignore */ }
    next.scheduleId = undefined;
  }

  if (next.enabled && !next.scheduleId) {
    try {
      next.scheduleId = await scheduleCron(opts.path, opts.buildExpr(), {});
    } catch (err) {
      console.error(`Failed to create ${opts.label} schedule:`, err);
    }
  }
}

/**
 * Brings every QStash schedule in line with `next`, mutating and returning it
 * with up-to-date schedule IDs. Callers must persist the result.
 *
 * Shared by the admin panel's PUT /settings and the /zone command so a timezone
 * change regenerates all schedules regardless of which entry point made it.
 */
export async function reconcileSchedules(current: Settings, next: Settings): Promise<Settings> {
  const zoneChanged = current.timezone !== next.timezone;
  const tz = next.timezone;

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
  });

  const nextWeekly = next.weeklySummary;
  await reconcileCron(current.weeklySummary, nextWeekly, {
    path: '/internal/digest/weekly',
    label: 'weekly summary',
    zoneChanged,
    buildExpr: () => buildCron(nextWeekly.time, tz, [nextWeekly.day]),
  });

  // UCLA reminder — fires every Monday
  const prevUcla = current.uclaReminder ?? { enabled: false, time: '09:00' };
  const nextUcla = next.uclaReminder ?? prevUcla;
  await reconcileCron(prevUcla, nextUcla, {
    path: '/internal/digest/ucla',
    label: 'ucla reminder',
    zoneChanged,
    buildExpr: () => buildCron(nextUcla.time, tz, [1]),
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
  });
  next.reminderPromoter = nextPromoter;

  // Nightly health check — every day at the configured local time
  const prevHealth = current.healthCheck ?? { enabled: false, time: '23:00' };
  const nextHealth = next.healthCheck ?? prevHealth;
  await reconcileCron(prevHealth, nextHealth, {
    path: '/internal/health-check',
    label: 'health check',
    zoneChanged,
    buildExpr: () => buildCron(nextHealth.time, tz, []),
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
      nextTasksSync.scheduleId = await scheduleCron('/internal/tasks/sync', '*/15 * * * *', {});
    } catch (err) {
      console.error('Failed to create Google Tasks sync schedule:', err);
    }
  }
  next.googleTasksSync = nextTasksSync;

  return next;
}
