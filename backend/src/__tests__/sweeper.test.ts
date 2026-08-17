import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sweeper (docs/v2-plan.md §C.5) replaces per-user QStash cron schedules
// with one hourly tick that decides, per user and per job, what's due. These
// tests stub out every job function so they only exercise the sweeper's own
// due-time matching and idempotency — not morning-digest's calendar logic,
// health-check's Google-token probing, etc., which are each other modules'
// concern.

vi.mock('../shared/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
    TOKEN_ENCRYPTION_KEY: 'x'.repeat(32),
    BASE_URL: 'https://sweeper.test',
  },
  whitelistedNumbers: [],
}));

vi.mock('@upstash/redis', async () => {
  const { FakeRedis } = await import('./helpers/fake-redis');
  return { Redis: FakeRedis };
});

const fireMorningDigest = vi.fn(async (_userId: string) => {});
const fireWeeklySummary = vi.fn(async (_userId: string) => {});
const fireUclaReminder = vi.fn(async (_userId: string) => {});
const promoteDeferred = vi.fn(async (_userId: string) => ({ promoted: 0, skipped: 0 }));
const syncGoogleTasks = vi.fn(async (_userId: string) => ({ pulled: 0, pushed: 0, skipped: false }));
const runHealthCheck = vi.fn(async (_userId: string) => ({ alerts: 0, notified: false }));

vi.mock('../core/cron/morning-digest', () => ({ fireMorningDigest: (userId: string) => fireMorningDigest(userId) }));
vi.mock('../core/cron/weekly-summary', () => ({ fireWeeklySummary: (userId: string) => fireWeeklySummary(userId) }));
vi.mock('../core/cron/ucla-reminder', () => ({ fireUclaReminder: (userId: string) => fireUclaReminder(userId) }));
vi.mock('../core/cron/reminder-promoter', () => ({ promoteDeferred: (userId: string) => promoteDeferred(userId) }));
vi.mock('../core/cron/google-tasks-sync', () => ({ syncGoogleTasks: (userId: string) => syncGoogleTasks(userId) }));
vi.mock('../ops/cron/health-check', () => ({ runHealthCheck: (userId: string) => runHealthCheck(userId) }));

import { resetFakeRedis } from './helpers/fake-redis';
import { registerUser } from '../auth/users';
import { getSettings, saveSettings, Settings } from '../core/integrations/token-store';
import { runSweep } from '../platform/sweeper';

const ALICE = '+56911111111';
const BOB = '+56922222222';

beforeEach(() => {
  resetFakeRedis();
  fireMorningDigest.mockClear();
  fireWeeklySummary.mockClear();
  fireUclaReminder.mockClear();
  promoteDeferred.mockClear();
  syncGoogleTasks.mockClear();
  runHealthCheck.mockClear();
});

async function makeUser(phone: string, overrides: (s: Settings) => Settings): Promise<void> {
  await registerUser({ phone, name: phone, timezone: 'UTC' });
  const settings = overrides(await getSettings(phone));
  await saveSettings(phone, settings);
}

// A Wednesday, 08:00 UTC — 2025-01-08 was a Wednesday (weekday 3).
const WED_0800 = new Date('2025-01-08T08:00:00.000Z');
// A Sunday, 08:00 UTC.
const SUN_0800 = new Date('2025-01-05T08:00:00.000Z');
// A Monday, 08:00 UTC.
const MON_0800 = new Date('2025-01-06T08:00:00.000Z');

describe('sweeper — due-time matching', () => {
  it('fires the morning digest when the local hour and weekday match', async () => {
    await makeUser(ALICE, (s) => ({ ...s, morningDigest: { enabled: true, time: '08:00', days: [3] } }));

    await runSweep(WED_0800);

    expect(fireMorningDigest).toHaveBeenCalledExactlyOnceWith(ALICE);
  });

  it('does not fire when the configured weekday does not include today', async () => {
    await makeUser(ALICE, (s) => ({ ...s, morningDigest: { enabled: true, time: '08:00', days: [1, 2, 4, 5] } })); // no Wed

    await runSweep(WED_0800);

    expect(fireMorningDigest).not.toHaveBeenCalled();
  });

  it('does not fire when the configured hour does not match', async () => {
    await makeUser(ALICE, (s) => ({ ...s, morningDigest: { enabled: true, time: '09:00', days: [3] } }));

    await runSweep(WED_0800);

    expect(fireMorningDigest).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', async () => {
    await makeUser(ALICE, (s) => ({ ...s, morningDigest: { enabled: false, time: '08:00', days: [3] } }));

    await runSweep(WED_0800);

    expect(fireMorningDigest).not.toHaveBeenCalled();
  });

  it('fires the weekly summary on its configured day and hour', async () => {
    await makeUser(ALICE, (s) => ({ ...s, weeklySummary: { enabled: true, day: 3, time: '08:00' } }));

    await runSweep(WED_0800);

    expect(fireWeeklySummary).toHaveBeenCalledExactlyOnceWith(ALICE);
  });

  it('fires the UCLA reminder only on Monday', async () => {
    await makeUser(ALICE, (s) => ({ ...s, uclaReminder: { enabled: true, time: '08:00' } }));

    await runSweep(WED_0800);
    expect(fireUclaReminder).not.toHaveBeenCalled();

    await runSweep(MON_0800);
    expect(fireUclaReminder).toHaveBeenCalledExactlyOnceWith(ALICE);
  });

  it('fires the reminder promoter only on Sunday, regardless of the enabled flag (always on)', async () => {
    await makeUser(ALICE, (s) => s);

    await runSweep(WED_0800);
    expect(promoteDeferred).not.toHaveBeenCalled();

    await runSweep(SUN_0800);
    expect(promoteDeferred).toHaveBeenCalledExactlyOnceWith(ALICE);
  });

  it('fires the health check on its configured hour, keyed to whichever user enabled it', async () => {
    await makeUser(ALICE, (s) => ({ ...s, healthCheck: { enabled: true, time: '08:00' } }));

    await runSweep(WED_0800);

    expect(runHealthCheck).toHaveBeenCalledExactlyOnceWith(ALICE);
  });

  it('fires Google Tasks sync every tick it is enabled, with no time-of-day gate', async () => {
    await makeUser(ALICE, (s) => ({ ...s, googleTasksSync: { enabled: true } }));

    await runSweep(WED_0800);
    expect(syncGoogleTasks).toHaveBeenCalledExactlyOnceWith(ALICE);

    // A later tick (different hour) fires it again — this is the one job with no daily gate.
    await runSweep(new Date('2025-01-08T09:00:00.000Z'));
    expect(syncGoogleTasks).toHaveBeenCalledTimes(2);
  });
});

describe('sweeper — idempotency', () => {
  it('fires each due job exactly once even when the sweep runs twice for the same tick', async () => {
    await makeUser(ALICE, (s) => ({
      ...s,
      morningDigest: { enabled: true, time: '08:00', days: [3] },
      weeklySummary: { enabled: true, day: 3, time: '08:00' },
      healthCheck: { enabled: true, time: '08:00' },
      googleTasksSync: { enabled: true },
    }));

    await Promise.all([runSweep(WED_0800), runSweep(WED_0800)]);

    expect(fireMorningDigest).toHaveBeenCalledOnce();
    expect(fireWeeklySummary).toHaveBeenCalledOnce();
    expect(runHealthCheck).toHaveBeenCalledOnce();
    expect(syncGoogleTasks).toHaveBeenCalledOnce();
  });

  it('a second sweep the following hour fires again (idempotency is per-bucket, not permanent)', async () => {
    await makeUser(ALICE, (s) => ({ ...s, morningDigest: { enabled: true, time: '08:00', days: [3] } }));

    await runSweep(WED_0800);
    await runSweep(WED_0800); // same tick, replayed — still once
    expect(fireMorningDigest).toHaveBeenCalledOnce();

    // Next day, same hour+weekday next week would fire again; simplest re-check
    // is a fresh calendar day at the same hour with days including it.
    await runSweep(new Date('2025-01-15T08:00:00.000Z')); // following Wednesday
    expect(fireMorningDigest).toHaveBeenCalledTimes(2);
  });
});

describe('sweeper — user isolation', () => {
  it('only fires the job each user actually has due, independent of other users', async () => {
    await makeUser(ALICE, (s) => ({ ...s, morningDigest: { enabled: true, time: '08:00', days: [3] } }));
    await makeUser(BOB, (s) => ({ ...s, weeklySummary: { enabled: true, day: 3, time: '08:00' } }));

    await runSweep(WED_0800);

    expect(fireMorningDigest).toHaveBeenCalledExactlyOnceWith(ALICE);
    expect(fireWeeklySummary).toHaveBeenCalledExactlyOnceWith(BOB);
  });

  it('skips disabled (offboarded) users entirely', async () => {
    await registerUser({ phone: ALICE, name: 'Alice', timezone: 'UTC' });
    const settings = await getSettings(ALICE);
    await saveSettings(ALICE, { ...settings, morningDigest: { enabled: true, time: '08:00', days: [3] } });

    const { setUserStatus } = await import('../auth/users');
    await setUserStatus(ALICE, 'disabled');

    const result = await runSweep(WED_0800);

    expect(fireMorningDigest).not.toHaveBeenCalled();
    expect(result.usersProcessed).toBe(0);
  });
});
