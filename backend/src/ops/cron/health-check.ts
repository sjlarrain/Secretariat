import { getAllAccounts, getSettings, saveSettings, saveAccount, decryptTokens, encryptTokens } from '../../core/integrations/token-store';
import { fetchPhoneHealth } from '../../shared/kapso/platform';
import { sendMessage, kapsoStats } from '../../shared/kapso/client';
import { listSchedules } from '../../shared/qstash/client';
import { reconcileHealthAlerts, pingRedis, HealthAlert } from '../health-alerts';
import { GoogleTokens, getAuthenticatedClient, CalendarDisconnectedError } from '../../core/integrations/google/oauth';

type Found = Omit<HealthAlert, 'firstSeenAt' | 'lastSeenAt'>;

/**
 * Nightly system health check.
 *
 * Findings are always written to Redis for the admin banner — that is the
 * reliable surface. The WhatsApp notification is best-effort on top: outside
 * Meta's 24-hour session window a proactive message can be rejected, so a
 * failure to notify is logged rather than treated as a failed run.
 *
 * Alerts themselves (`reconcileHealthAlerts`) are system-wide, not per-user —
 * this checks the shared Kapso number, QStash, and Redis regardless of who
 * `userId` is. Google account verification is per-user because accounts are;
 * `userId` is the single known user until the v2 registry (Goal 2) lets this
 * loop over everyone.
 */
export async function runHealthCheck(userId: string): Promise<{ alerts: number; notified: boolean }> {
  const settings = await getSettings(userId);
  const found: Found[] = [];

  // --- Kapso messaging health (same probe /status uses) ---
  try {
    const health = await fetchPhoneHealth();
    if (health.status !== 'healthy') {
      found.push({
        id: `kapso:${health.status}`,
        kind: 'kapso',
        severity: health.status === 'degraded' ? 'warn' : 'error',
        message: `Kapso reports status "${health.status}"${health.error ? `: ${health.error}` : ''}.`,
      });
    }
    const messaging = health.checks?.['messaging_health'];
    if (messaging && !messaging.passed) {
      found.push({
        id: 'kapso:messaging',
        kind: 'kapso',
        severity: 'error',
        message: `Kapso messaging unavailable${messaging.error ? `: ${messaging.error}` : ''}.`,
      });
    }
  } catch (err) {
    found.push({
      id: 'kapso:unreachable',
      kind: 'kapso',
      severity: 'error',
      message: `Could not reach the Kapso health endpoint: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Sends that exhausted their retries since the last restart: the connection
  // is up but messages are being lost, which the health probe alone won't show.
  if (kapsoStats.failed > 0) {
    found.push({
      id: 'kapso:send-failures',
      kind: 'kapso',
      severity: 'warn',
      message:
        `${kapsoStats.failed} WhatsApp send(s) failed after all retries since the last restart` +
        `${kapsoStats.lastError ? ` — last error: ${kapsoStats.lastError}` : ''}.`,
    });
  }

  // --- Google account token validity ---
  // Actively probes each account rather than trusting the stored `isDisconnected`
  // flag: that flag is only ever set as a side effect of some other command
  // actually calling the Google API, so an account nobody has used since it was
  // revoked would stay marked "connected" forever and this check would miss it.
  const accounts = await getAllAccounts(userId);
  for (const account of accounts) {
    try {
      const tokens = decryptTokens<GoogleTokens>(account.encryptedTokens, account.id);
      const { refreshedTokens } = await getAuthenticatedClient(tokens, account.alias);
      if (refreshedTokens?.access_token) {
        await saveAccount(userId, {
          ...account,
          encryptedTokens: encryptTokens({
            access_token: refreshedTokens.access_token,
            refresh_token: refreshedTokens.refresh_token ?? tokens.refresh_token,
            expiry_date: refreshedTokens.expiry_date ?? tokens.expiry_date,
          }, account.id),
        });
      }
    } catch (err) {
      if (err instanceof CalendarDisconnectedError) {
        await saveAccount(userId, { ...account, isDisconnected: true });
        found.push({
          id: `google:disconnected:${account.id}`,
          kind: 'google',
          severity: 'error',
          message: `${account.alias} (${account.type}) is disconnected — reconnect it to restore access.`,
          resolveLink: '/accounts',
        });
      } else {
        found.push({
          id: `google:unverifiable:${account.id}`,
          kind: 'google',
          severity: 'warn',
          message: `Could not verify ${account.alias} (${account.type}): ${err instanceof Error ? err.message : String(err)}`,
          resolveLink: '/accounts',
        });
      }
    }
  }
  if (accounts.length === 0) {
    found.push({
      id: 'google:none',
      kind: 'google',
      severity: 'warn',
      message: 'No Google accounts are connected.',
      resolveLink: '/accounts',
    });
  }

  // --- QStash sweeper schedule sanity ---
  // Since the cron collapse (docs/v2-plan.md §C.5), digests/reminders/sync
  // aren't individual per-user QStash schedules any more — there is exactly
  // one, hitting /internal/tick hourly (created at boot by
  // platform/ensureSweeperSchedule.ts). If it's missing or duplicated, no
  // user's digests, reminder promotion, or Google Tasks sync will fire.
  try {
    const sweeperSchedules = (await listSchedules()).filter((s) => s.destination.endsWith('/internal/tick'));
    if (sweeperSchedules.length === 0) {
      found.push({
        id: 'qstash:sweeper-missing',
        kind: 'qstash',
        severity: 'error',
        message: 'The hourly sweeper QStash schedule (/internal/tick) is missing — no digests, reminder promotion, or Google Tasks sync will fire for anyone. Restart the server to recreate it, or check the QStash cron quota.',
      });
    } else if (sweeperSchedules.length > 1) {
      found.push({
        id: 'qstash:sweeper-duplicated',
        kind: 'qstash',
        severity: 'warn',
        message: `${sweeperSchedules.length} sweeper schedules exist for /internal/tick — jobs may fire more than once per hour. Delete the extras in the QStash console.`,
      });
    }
  } catch (err) {
    found.push({
      id: 'qstash:unreachable',
      kind: 'qstash',
      severity: 'warn',
      message: `Could not list QStash schedules: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // --- Redis reachability (ephemeral state loss is a known Render failure mode) ---
  if (!(await pingRedis())) {
    found.push({
      id: 'redis:unreachable',
      kind: 'redis',
      severity: 'error',
      message: 'Redis did not respond to a ping — settings, tasks, and reminders may be unavailable.',
    });
  }

  const { alerts, newAlerts } = await reconcileHealthAlerts(found);

  // Notify only about newly-appeared issues, so a long-standing problem does
  // not send the same message every night.
  let notified = false;
  if (newAlerts.length > 0) {
    const lines = ['🩺 *Health check — new issues:*\n'];
    for (const alert of newAlerts) {
      lines.push(`${alert.severity === 'error' ? '❌' : '⚠️'} ${alert.message}`);
    }
    lines.push('\n_Open the admin panel for details._');
    try {
      await sendMessage(userId, lines.join('\n'));
      notified = true;
    } catch (err) {
      // Expected outside Meta's 24h session window — the admin banner still shows it.
      console.error('Health check notification could not be delivered:', err);
    }
  }

  settings.healthCheck = { ...settings.healthCheck, lastRunAt: new Date().toISOString() };
  await saveSettings(userId, settings);

  return { alerts: alerts.length, notified };
}
