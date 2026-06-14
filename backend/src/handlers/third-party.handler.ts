import { sendMessage, sendInteractiveButtons } from '../kapso/client';
import { savePendingEvent } from '../integrations/local/third-party';
import { getSettings } from '../integrations/token-store';
import { parseDate, combineDateAndTime, formatDate, formatTime } from '../utils/date';
import { randomUUID } from 'crypto';
import { whitelistedNumbers } from '../env';

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      inQuotes = !inQuotes;
    } else if (ch === ' ' && !inQuotes) {
      if (current.length > 0) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

interface ParsedSet {
  title: string;
  forValue: string | null;
  atValue: string | null;
  error: string | null;
}

function parseSetArgs(tokens: string[]): ParsedSet {
  let forValue: string | null = null;
  let atValue: string | null = null;
  const titleParts: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    // @ alone → next token is time
    if (token === '@') {
      atValue = tokens[i + 1] ?? null;
      i += atValue ? 2 : 1;
      continue;
    }

    // @time (no space)
    if (token.startsWith('@') && token.length > 1) {
      atValue = token.slice(1);
      i++;
      continue;
    }

    // --for or -f
    if (token === '--for' || token === '-f') {
      const parts: string[] = [];
      i++;
      while (i < tokens.length && !isFlag(tokens[i])) { parts.push(tokens[i]); i++; }
      forValue = parts.join(' ') || null;
      continue;
    }

    // --at or -a
    if (token === '--at' || token === '-a') {
      const parts: string[] = [];
      i++;
      while (i < tokens.length && !isFlag(tokens[i])) { parts.push(tokens[i]); i++; }
      atValue = parts.join(' ') || null;
      continue;
    }

    // Ignore unknown flags, collect everything else as title
    if (token.startsWith('-')) { i++; continue; }
    titleParts.push(token);
    i++;
  }

  const missing: string[] = [];
  if (!forValue) missing.push('--for (-f)');
  if (!atValue) missing.push('--at (-a) or @time');
  if (missing.length > 0) {
    return { title: titleParts.join(' '), forValue, atValue, error: `Missing: ${missing.join(', ')}` };
  }

  return { title: titleParts.join(' '), forValue, atValue, error: null };
}

function isFlag(token: string): boolean {
  return token.startsWith('-') || token.startsWith('@');
}

export async function thirdPartyHandler(text: string | null, from: string, alias: string): Promise<void> {
  if (!text?.trim()) return;

  const normalized = text.replace(/[—–]/g, '--').trim();
  const tokens = tokenize(normalized);
  const command = tokens[0]?.toLowerCase().replace(/^\//, '');

  if (command === 'menu') {
    await sendMessage(
      from,
      `👋 Hi ${alias}! Here's what you can send:\n\n` +
      `*/set <title> -f <date> -a <time>*\n` +
      `Sets an event for Santiago to confirm.\n\n` +
      `*Flags:*\n` +
      `  -f / --for → date (e.g. tomorrow, next monday, 15-06-2026)\n` +
      `  -a / --at / @time → time (e.g. 8pm, 10:00, @14:30)\n` +
      `  Title is optional.\n\n` +
      `*Examples:*\n` +
      `  /set Doctor -f tomorrow -a 10am\n` +
      `  /set -f next friday @15:00 Dentist`
    );
    return;
  }

  if (command === 'set') {
    const parsed = parseSetArgs(tokens.slice(1));

    if (parsed.error) {
      await sendMessage(from, `❌ ${parsed.error}\n\nSend */menu* for usage.`);
      return;
    }

    const settings = await getSettings();
    const timezone = settings.timezone;

    const date = parseDate(parsed.forValue!, timezone);
    if (!date) {
      await sendMessage(from, `❌ Could not parse date: "${parsed.forValue}"\n\nTry: tomorrow, next monday, 15-06-2026`);
      return;
    }

    const target = combineDateAndTime(date, parsed.atValue!, timezone);
    if (target.getTime() <= Date.now()) {
      await sendMessage(from, '❌ That date/time is in the past.');
      return;
    }

    const id = randomUUID();
    await savePendingEvent({
      id,
      title: parsed.title,
      forValue: parsed.forValue!,
      atValue: parsed.atValue!,
      senderPhone: from,
      senderAlias: alias,
      createdAt: new Date().toISOString(),
    });

    const dateLabel = `${formatDate(target, true, timezone)} at ${formatTime(target, timezone)}`;
    const titleLine = parsed.title ? `\n📌 *${parsed.title}*` : '';

    const ownerPhone = whitelistedNumbers[0];
    await sendInteractiveButtons(
      ownerPhone,
      `📩 *${alias}* wants to set an event:${titleLine}\n📅 ${dateLabel}\n\nSave as:`,
      [
        { id: `tp_rem_${id}`, title: 'Reminder' },
        { id: `tp_task_${id}`, title: 'Task' },
        { id: `tp_cal_${id}`, title: 'Schedule' },
      ]
    );

    await sendMessage(from, `✅ Sent! Santiago will confirm it.`);
    return;
  }

  await sendMessage(from, `❓ Unknown command. Send */menu* to see what you can do.`);
}
