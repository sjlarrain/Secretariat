import { scheduleCron, listSchedules } from '../shared/qstash/client';

const SWEEPER_PATH = '/internal/tick';
const SWEEPER_CRON = '0 * * * *'; // every hour, on the hour, UTC — per-user timezone math happens inside the sweeper itself

/**
 * Ensures exactly one QStash schedule hits POST /internal/tick, hourly.
 * Unlike the per-job schedules Goal 3 replaced, this one is not tied to any
 * user or settings change — it just needs to exist once for the whole
 * deployment — so it's created here at boot rather than through the settings
 * save path. Idempotent: safe to call on every restart.
 *
 * Best-effort and non-blocking — if QStash is briefly unreachable at boot,
 * the server still starts. A missing sweeper schedule is caught by the
 * health check's next run (ops/cron/health-check.ts).
 */
export async function ensureSweeperSchedule(): Promise<void> {
  try {
    const existing = await listSchedules();
    if (existing.some((s) => s.destination.endsWith(SWEEPER_PATH))) return;
    await scheduleCron(SWEEPER_PATH, SWEEPER_CRON, {});
    console.log('Sweeper schedule created (POST /internal/tick, hourly).');
  } catch (err) {
    console.error('Could not ensure the sweeper QStash schedule exists:', err);
  }
}
