import { sendMessage } from '../kapso/client';
import { getAllAccounts, getSettings } from '../integrations/token-store';
import { kapsoFetch, fetchPhoneHealth, HealthResponse, MessagesResponse } from '../kapso/platform';
import type { ParsedCommand } from '../parser/command.parser';

export function formatStatusMessage(params: {
  accounts: { alias: string; type: string; isDefault: boolean; isDisconnected: boolean }[];
  kapsoStatus: string;
  messagingHealth: string | null;
  sentThisMonth: number | null;
  receivedThisMonth: number | null;
  monthLabel: string;
}): string {
  const { accounts, kapsoStatus, messagingHealth, sentThisMonth, receivedThisMonth, monthLabel } = params;

  const lines: string[] = ['📊 *Secretariat Status*\n'];

  lines.push('*Calendars:*');
  if (accounts.length === 0) {
    lines.push('  No accounts connected.');
  } else {
    for (const a of accounts) {
      const icon = a.isDisconnected ? '❌' : '✅';
      const dflt = a.isDefault ? ' _(default)_' : '';
      const disc = a.isDisconnected ? ' — disconnected' : '';
      lines.push(`${icon} ${a.alias} [${a.type}]${dflt}${disc}`);
    }
  }

  lines.push('\n*Kapso:*');
  const statusIcon = kapsoStatus === 'healthy' ? '✅' : kapsoStatus === 'degraded' ? '⚠️' : '❌';
  lines.push(`${statusIcon} ${kapsoStatus.charAt(0).toUpperCase() + kapsoStatus.slice(1)}`);
  if (messagingHealth) {
    lines.push(`  Messaging: ${messagingHealth}`);
  }

  lines.push('\n*Usage (this month — ' + monthLabel + '):*');
  if (sentThisMonth !== null) lines.push(`  📤 Sent: ${sentThisMonth.toLocaleString()} messages`);
  if (receivedThisMonth !== null) lines.push(`  📥 Received: ${receivedThisMonth.toLocaleString()} messages`);
  if (sentThisMonth === null && receivedThisMonth === null) lines.push('  Could not fetch usage data.');

  return lines.join('\n');
}

export async function statusHandler(_parsed: ParsedCommand, from: string): Promise<void> {
  const settings = await getSettings();
  const timezone = settings.timezone ?? 'America/Santiago';
  const accounts = await getAllAccounts();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: timezone });

  let kapsoStatus = 'unknown';
  let messagingHealth: string | null = null;
  let sentThisMonth: number | null = null;
  let receivedThisMonth: number | null = null;

  const [healthResult, sentResult, receivedResult] = await Promise.allSettled([
    fetchPhoneHealth(),
    kapsoFetch<MessagesResponse>(`/messages?direction=outbound&per_page=1&created_after=${monthStart}`),
    kapsoFetch<MessagesResponse>(`/messages?direction=inbound&per_page=1&created_after=${monthStart}`),
  ]);

  if (healthResult.status === 'fulfilled') {
    kapsoStatus = healthResult.value.status;
    const mh = healthResult.value.checks?.['messaging_health'];
    if (mh) messagingHealth = mh.passed ? 'Available' : (mh.error ?? 'Limited');
  } else {
    kapsoStatus = 'error';
  }

  if (sentResult.status === 'fulfilled') {
    sentThisMonth = sentResult.value.meta?.total_count ?? sentResult.value.data.length;
  }
  if (receivedResult.status === 'fulfilled') {
    receivedThisMonth = receivedResult.value.meta?.total_count ?? receivedResult.value.data.length;
  }

  const message = formatStatusMessage({
    accounts: accounts.map((a) => ({
      alias: a.alias,
      type: a.type,
      isDefault: a.isDefault,
      isDisconnected: a.isDisconnected ?? false,
    })),
    kapsoStatus,
    messagingHealth,
    sentThisMonth,
    receivedThisMonth,
    monthLabel,
  });

  await sendMessage(from, message);
}
