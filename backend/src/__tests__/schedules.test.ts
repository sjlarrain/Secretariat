import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Settings } from '../core/integrations/token-store';
import { reconcileSchedules } from '../core/qstash/schedules';

// Stub QStash so reconcileSchedules can be driven without network access.
// vi.mock is hoisted above the import above, so the real client (and its env
// validation) never loads.
const scheduleCron = vi.fn(async (path: string, _cron: string, _body: object) => `sched_${path}`);
const deleteSchedule = vi.fn(async (_id: string) => {});

vi.mock('../shared/qstash/client', () => ({
  scheduleCron: (p: string, c: string, b: object) => scheduleCron(p, c, b),
  deleteSchedule: (id: string) => deleteSchedule(id),
}));

const TEST_USER = 'test-user';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    timezone: 'America/Santiago',
    morningDigest: { enabled: true, time: '08:00', days: [1, 2, 3, 4, 5], scheduleId: 'sched_morning' },
    weeklySummary: { enabled: true, day: 0, time: '09:00', scheduleId: 'sched_weekly' },
    uclaReminder: { enabled: true, time: '09:00', scheduleId: 'sched_ucla' },
    defaultTaskTime: '09:00',
    reminderPromoter: { enabled: true, time: '08:00', scheduleId: 'sched_promoter' },
    googleTasksSync: { enabled: true, scheduleId: 'sched_sync' },
    healthCheck: { enabled: true, time: '23:00', scheduleId: 'sched_health' },
    ...overrides,
  } as Settings;
}

/** The cron string a given path was (re)created with during this run. */
function cronFor(path: string): string | undefined {
  return scheduleCron.mock.calls.find((c) => c[0] === path)?.[1];
}

beforeEach(() => {
  scheduleCron.mockClear();
  deleteSchedule.mockClear();
});

// ─── The v1.1 bug: a timezone change left every schedule at its old UTC time ──

describe('reconcileSchedules — timezone change', () => {
  it('recreates every time-based schedule when only the timezone changed', async () => {
    const current = makeSettings();
    const next = makeSettings({ timezone: 'Europe/Madrid' });

    await reconcileSchedules(TEST_USER, current, next);

    // Each stale schedule deleted...
    for (const id of ['sched_morning', 'sched_weekly', 'sched_ucla', 'sched_promoter', 'sched_health']) {
      expect(deleteSchedule).toHaveBeenCalledWith(id);
    }

    // ...and recreated in the new zone.
    for (const path of [
      '/internal/digest/morning',
      '/internal/digest/weekly',
      '/internal/digest/ucla',
      '/internal/reminder/promote',
      '/internal/health-check',
    ]) {
      expect(cronFor(path), `${path} was not recreated`).toContain('CRON_TZ=Europe/Madrid');
    }
  });

  it('preserves each local wall-clock time across the zone change', async () => {
    const current = makeSettings();
    const next = makeSettings({ timezone: 'Asia/Tokyo' });

    await reconcileSchedules(TEST_USER, current, next);

    // 08:00 stays 08:00 — the old code rewrote this into a UTC hour.
    expect(cronFor('/internal/digest/morning')).toBe('CRON_TZ=Asia/Tokyo 0 8 * * 1,2,3,4,5');
    expect(cronFor('/internal/digest/ucla')).toBe('CRON_TZ=Asia/Tokyo 0 9 * * 1');
    expect(cronFor('/internal/health-check')).toBe('CRON_TZ=Asia/Tokyo 0 23 * * *');
  });

  it('leaves schedules alone when nothing changed', async () => {
    const current = makeSettings();
    const next = makeSettings();

    await reconcileSchedules(TEST_USER, current, next);

    expect(scheduleCron).not.toHaveBeenCalled();
    expect(deleteSchedule).not.toHaveBeenCalled();
  });

  it('does not touch the Google Tasks sync cron on a zone change (fixed interval)', async () => {
    const current = makeSettings();
    const next = makeSettings({ timezone: 'Europe/Madrid' });

    await reconcileSchedules(TEST_USER, current, next);

    expect(deleteSchedule).not.toHaveBeenCalledWith('sched_sync');
    expect(next.googleTasksSync.scheduleId).toBe('sched_sync');
  });

  it('does not recreate the sync cron when only lastSyncAt churns', async () => {
    const current = makeSettings();
    const next = makeSettings({
      googleTasksSync: { enabled: true, scheduleId: 'sched_sync', lastSyncAt: new Date().toISOString() },
    });

    await reconcileSchedules(TEST_USER, current, next);

    expect(deleteSchedule).not.toHaveBeenCalledWith('sched_sync');
  });
});

// ─── Per-schedule config changes still work ──────────────────────────────────

describe('reconcileSchedules — config changes', () => {
  it('recreates only the schedule whose own config changed', async () => {
    const current = makeSettings();
    const next = makeSettings({
      morningDigest: { enabled: true, time: '07:30', days: [1, 2, 3, 4, 5], scheduleId: 'sched_morning' },
    });

    await reconcileSchedules(TEST_USER, current, next);

    expect(deleteSchedule).toHaveBeenCalledWith('sched_morning');
    expect(deleteSchedule).toHaveBeenCalledTimes(1);
    expect(cronFor('/internal/digest/morning')).toBe('CRON_TZ=America/Santiago 30 7 * * 1,2,3,4,5');
  });

  it('deletes without recreating when a schedule is disabled', async () => {
    const current = makeSettings();
    const next = makeSettings({
      healthCheck: { enabled: false, time: '23:00', scheduleId: 'sched_health' },
    });

    await reconcileSchedules(TEST_USER, current, next);

    expect(deleteSchedule).toHaveBeenCalledWith('sched_health');
    expect(cronFor('/internal/health-check')).toBeUndefined();
    expect(next.healthCheck.scheduleId).toBeUndefined();
  });

  it('creates a schedule for a newly enabled item', async () => {
    const current = makeSettings({ healthCheck: { enabled: false, time: '23:00' } });
    const next = makeSettings({ healthCheck: { enabled: true, time: '22:00' } });

    await reconcileSchedules(TEST_USER, current, next);

    expect(cronFor('/internal/health-check')).toBe('CRON_TZ=America/Santiago 0 22 * * *');
    expect(next.healthCheck.scheduleId).toBe('sched_/internal/health-check');
  });

  it('survives a QStash creation failure without throwing', async () => {
    scheduleCron.mockRejectedValueOnce(new Error('QStash down'));
    const current = makeSettings({ healthCheck: { enabled: false, time: '23:00' } });
    const next = makeSettings({ healthCheck: { enabled: true, time: '22:00' } });

    await expect(reconcileSchedules(TEST_USER, current, next)).resolves.toBeDefined();
    expect(next.healthCheck.scheduleId).toBeUndefined();
  });
});

// ─── The reminder promoter can never be disabled ─────────────────────────────

describe('reconcileSchedules — reminder promoter is always on', () => {
  it('recreates the promoter even when a caller passes enabled: false', async () => {
    // PUT /settings builds `next` from the request body and reconciles BEFORE
    // saving, so a body carrying enabled:false must not reach reconcileCron —
    // otherwise the schedule is deleted and only then normalized on write,
    // stranding every deferred reminder with no queued message.
    const current = makeSettings();
    const next = makeSettings({
      reminderPromoter: { enabled: false as unknown as true, time: '08:00', scheduleId: 'sched_promoter' },
    });

    await reconcileSchedules(TEST_USER, current, next);

    expect(next.reminderPromoter.enabled).toBe(true);
    expect(deleteSchedule).not.toHaveBeenCalledWith('sched_promoter');
    expect(next.reminderPromoter.scheduleId).toBe('sched_promoter');
  });

  it('creates the promoter schedule when it is missing entirely', async () => {
    const current = makeSettings({ reminderPromoter: { enabled: true, time: '08:00' } });
    const next = makeSettings({ reminderPromoter: { enabled: true, time: '08:00' } });

    await reconcileSchedules(TEST_USER, current, next);

    expect(cronFor('/internal/reminder/promote')).toBe('CRON_TZ=America/Santiago 0 8 * * 0');
    expect(next.reminderPromoter.scheduleId).toBe('sched_/internal/reminder/promote');
  });

  it('still allows the run time to be changed', async () => {
    const current = makeSettings();
    const next = makeSettings({
      reminderPromoter: { enabled: true, time: '06:30', scheduleId: 'sched_promoter' },
    });

    await reconcileSchedules(TEST_USER, current, next);

    expect(deleteSchedule).toHaveBeenCalledWith('sched_promoter');
    expect(cronFor('/internal/reminder/promote')).toBe('CRON_TZ=America/Santiago 30 6 * * 0');
  });
});
