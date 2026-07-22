import { getAllAccounts, getSettings, saveSettings, saveAccount, decryptTokens, encryptTokens } from '../integrations/token-store';
import { fetchPhoneHealth } from '../kapso/platform';
import { sendMessage, kapsoStats } from '../kapso/client';
import { listSchedules } from '../qstash/client';
import { reconcileHealthAlerts, pingRedis, HealthAlert } from '../integrations/local/health-alerts';
import { whitelistedNumbers } from '../env';
import { GoogleTokens, getAuthenticatedClient, CalendarDisconnectedError } from '../integrations/google/oauth';

type Found = Omit<HealthAlert, 'firstSeenAt' | 'lastSeenAt'>;

/**
 * Nightly system health check.
 *
 * Findings are always written to Redis for the admin banner — that is the
 * reliable surface. The WhatsApp notification is best-effort on top: outside
 * Meta's 24-hour session window a proactive message can be rejected, so a
 * failure to notify is logged rather than treated as a failed run.
 */
export async function runHealthCheck(): Promise<{ alerts: number; notified: boolean }> {
  const settings = await getSettings();
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
  const accounts = await getAllAccounts();
  for (const account of accounts) {
    try {
      const tokens = decryptTokens<GoogleTokens>(account.encryptedTokens, account.id);
      const { refreshedTokens } = await getAuthenticatedClient(tokens, account.alias);
      if (refreshedTokens?.access_token) {
        await saveAccount({
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
        await saveAccount({ ...account, isDisconnected: true });
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

  // --- QStash schedule sanity: catch schedules deleted or expired out-of-band ---
  const expected: { id: string | undefined; label: string; enabled: boolean }[] = [
    { id: settings.morningDigest.scheduleId, label: 'Morning digest', enabled: settings.morningDigest.enabled },
    { id: settings.weeklySummary.scheduleId, label: 'Weekly summary', enabled: settings.weeklySummary.enabled },
    { id: settings.uclaReminder?.scheduleId, label: 'UCLA reminder', enabled: settings.uclaReminder?.enabled ?? false },
    { id: settings.reminderPromoter?.scheduleId, label: 'Reminder promoter', enabled: settings.reminderPromoter?.enabled ?? false },
    { id: settings.googleTasksSync?.scheduleId, label: 'Google Tasks sync', enabled: settings.googleTasksSync?.enabled ?? false },
    { id: settings.healthCheck?.scheduleId, label: 'Health check', enabled: settings.healthCheck?.enabled ?? false },
  ];

  // An enabled schedule with no ID never got created — typically because
  // scheduleCron threw (QStash cron quota exceeded) and the error was only
  // logged. It is silently dead, so it must be reported even though there is no
  // ID to look up.
  for (const { id, label, enabled } of expected) {
    if (enabled && !id) {
      found.push({
        id: `qstash:uncreated:${label}`,
        kind: 'qstash',
        severity: 'error',
        message: `${label} is enabled but has no QStash schedule — creating it failed, so it will never fire. Check the QStash cron quota, then re-save settings.`,
        resolveLink: '/settings/cron',
      });
    }
  }

  try {
    const live = new Set((await listSchedules()).map((s) => s.scheduleId));
    for (const { id, label, enabled } of expected) {
      if (enabled && id && !live.has(id)) {
        found.push({
          id: `qstash:missing:${label}`,
          kind: 'qstash',
          severity: 'error',
          message: `${label} is enabled but its QStash schedule no longer exists — it will never fire. Re-save settings to recreate it.`,
          resolveLink: '/settings/cron',
        });
      }
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
  const owner = whitelistedNumbers[0];
  if (owner && newAlerts.length > 0) {
    const lines = ['🩺 *Health check — new issues:*\n'];
    for (const alert of newAlerts) {
      lines.push(`${alert.severity === 'error' ? '❌' : '⚠️'} ${alert.message}`);
    }
    lines.push('\n_Open the admin panel for details._');
    try {
      await sendMessage(owner, lines.join('\n'));
      notified = true;
    } catch (err) {
      // Expected outside Meta's 24h session window — the admin banner still shows it.
      console.error('Health check notification could not be delivered:', err);
    }
  }

  settings.healthCheck = { ...settings.healthCheck, lastRunAt: new Date().toISOString() };
  await saveSettings(settings);

  return { alerts: alerts.length, notified };
}
