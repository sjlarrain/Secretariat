import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../../shared/kapso/client';
import { getSettings, saveSettings, normalizeSettings } from '../integrations/token-store';
import { parseZoneInput, describeZone } from '../../shared/utils/timezone';
import { formatTime } from '../../shared/utils/date';
import { Ctx } from '../../shared/ctx';

export async function zoneHandler(parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const from = ctx.userId;
  const input = parsed.extraArgs.join(' ').trim();

  try {
    const current = await getSettings(ctx.userId);

    // /zone  →  show the current zone
    if (!input) {
      const now = new Date();
      await sendMessage(
        from,
        `🌍 *Timezone:* ${current.timezone} (${describeZone(current.timezone, now)})\n` +
          `🕐 Local time: ${formatTime(now, current.timezone)}\n\n` +
          '_Change it with `/zone America/Santiago` or `/zone GMT-3`._'
      );
      return;
    }

    const zone = parseZoneInput(input);
    if (!zone) {
      await sendMessage(
        from,
        `❌ Unknown timezone: "${input}".\n\n` +
          'Use a city name like `/zone America/Santiago` or `/zone Europe/Madrid`, ' +
          'or an offset like `/zone GMT-3`.\n\n' +
          '_City names track daylight saving automatically; fixed offsets do not._'
      );
      return;
    }

    if (zone === current.timezone) {
      await sendMessage(from, `🌍 Already set to *${current.timezone}*. Nothing changed.`);
      return;
    }

    const next = normalizeSettings({ ...current, timezone: zone });
    await saveSettings(ctx.userId, next);

    const now = new Date();
    const lines = [
      `🌍 Timezone set to *${zone}* (${describeZone(zone, now)})`,
      `🕐 Local time is now ${formatTime(now, zone)}`,
    ];

    // Fixed offsets are DST-naive by construction; say so rather than let it
    // silently drift an hour at the next boundary.
    if (zone.startsWith('Etc/') || zone === 'UTC') {
      lines.push('', '⚠️ Fixed offset — this will _not_ adjust for daylight saving. Use a city name (e.g. `/zone America/Santiago`) if you want that.');
    }

    const active = [
      next.morningDigest.enabled && 'morning digest',
      next.weeklySummary.enabled && 'weekly summary',
      next.mbaReminder?.enabled && 'MBA reminder',
      next.healthCheck?.enabled && 'health check',
    ].filter(Boolean) as string[];

    // The hourly sweeper (platform/sweeper.ts) reads settings.timezone fresh
    // on every tick, so there is no separate schedule to recreate — the new
    // zone applies starting with the next tick that reaches your local time.
    if (active.length) {
      lines.push('', `🔄 Now using the new zone for: ${active.join(', ')}.`);
    }

    lines.push('', '_Existing one-off reminders keep their original absolute time._');

    await sendMessage(from, lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
