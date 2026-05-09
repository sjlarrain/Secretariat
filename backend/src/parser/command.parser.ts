import { COMMANDS } from '../registries/commands.registry';
import { FLAGS } from '../registries/flags.registry';

export interface ParsedCommand {
  command: string;
  flags: Record<string, string>;
  extraArgs: string[];
  raw: string;
}

export interface ParseResult {
  success: boolean;
  data?: ParsedCommand;
  error?: string;
}

export function parseCommand(input: string): ParseResult {
  // WhatsApp autocorrects -- to em-dash (—) or en-dash (–); normalize back
  const trimmed = input.replace(/[—–]/g, '--').trim();

  if (!trimmed.startsWith('/')) {
    return { success: false, error: 'Not a command. Start your message with /start to see available commands.' };
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return { success: false, error: 'Empty command.' };
  }

  const commandName = tokens[0].toLowerCase().replace(/^\//, '');
  const commandDef = COMMANDS[commandName];

  if (!commandDef) {
    const available = Object.keys(COMMANDS).map((c) => `/${c}`).join(', ');
    return { success: false, error: `Unknown command "/${commandName}". Available: ${available}` };
  }

  const extraArgs: string[] = [];
  const flags: Record<string, string> = {};

  let i = 1;
  // Collect positional args before any flag (-- or - or @)
  while (i < tokens.length && !tokens[i].startsWith('--') && !tokens[i].startsWith('-') && !tokens[i].startsWith('@')) {
    extraArgs.push(tokens[i]);
    i++;
  }

  // Parse flags
  while (i < tokens.length) {
    const token = tokens[i];

    // @HH:MM alias for --at
    if (token.startsWith('@') && /^@\d{1,2}:\d{2}$/.test(token)) {
      flags['at'] = token.slice(1);
      i++;
      continue;
    }

    // Resolve flag key from --long or -s (short)
    let flagKey: string | null = null;
    if (token.startsWith('--')) {
      flagKey = findFlagKeyByLong(token.slice(2).toLowerCase());
    } else if (/^-[a-z]$/.test(token)) {
      flagKey = findFlagKeyByShort(token.slice(1), commandDef.acceptedFlags);
    }

    if (flagKey !== null) {
      if (!commandDef.acceptedFlags.includes(flagKey)) {
        const accepted = commandDef.acceptedFlags
          .map((f) => `${FLAGS[f].name}${FLAGS[f].shortAlias ? ` (-${FLAGS[f].shortAlias})` : ''}`)
          .join(', ');
        return {
          success: false,
          error: `Unknown flag "${token}" for /${commandName}.\nAccepted: ${accepted || 'none'}`,
        };
      }

      i++;
      const valueParts: string[] = [];
      while (i < tokens.length && !tokens[i].startsWith('--') && !(/^-[a-z]$/.test(tokens[i])) && !tokens[i].startsWith('@')) {
        valueParts.push(tokens[i]);
        i++;
      }

      if (valueParts.length === 0) {
        if (FLAGS[flagKey]?.optional) {
          flags[flagKey] = '';
          continue;
        }
        return { success: false, error: `Flag "${token}" requires a value.` };
      }

      flags[flagKey] = valueParts.join(' ');
      continue;
    }

    // Unknown token after flags started — skip gracefully
    i++;
  }

  // Check required flags
  const missing = commandDef.requiredFlags.filter((f) => !(f in flags));
  if (missing.length > 0) {
    const missingNames = missing.map((f) => FLAGS[f].name).join(', ');
    return {
      success: false,
      error: `Missing required flags for /${commandName}: ${missingNames}`,
    };
  }

  return {
    success: true,
    data: { command: commandName, flags, extraArgs, raw: trimmed },
  };
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      inQuotes = !inQuotes;
    } else if (ch === ' ' && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function findFlagKeyByLong(flagName: string): string | null {
  for (const [key, def] of Object.entries(FLAGS)) {
    if (def.name === `--${flagName}`) return key;
  }
  return null;
}

function findFlagKeyByShort(shortChar: string, allowedKeys: string[]): string | null {
  for (const key of allowedKeys) {
    if (FLAGS[key]?.shortAlias === shortChar) return key;
  }
  return null;
}
