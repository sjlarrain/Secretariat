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

export function parseCommand(raw: string): ParseResult {
  const trimmed = raw.trim();

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
  // Collect positional args before any flag
  while (i < tokens.length && !tokens[i].startsWith('--') && !tokens[i].startsWith('@')) {
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

    if (token.startsWith('--')) {
      const flagName = token.slice(2).toLowerCase();
      const flagKey = findFlagKey(flagName);

      if (!flagKey || !commandDef.acceptedFlags.includes(flagKey)) {
        const accepted = commandDef.acceptedFlags.map((f) => FLAGS[f].name).join(', ');
        return {
          success: false,
          error: `Unknown flag "${token}" for /${commandName}.\nAccepted: ${accepted || 'none'}`,
        };
      }

      i++;
      const valueParts: string[] = [];
      while (i < tokens.length && !tokens[i].startsWith('--') && !tokens[i].startsWith('@')) {
        valueParts.push(tokens[i]);
        i++;
      }

      if (valueParts.length === 0) {
        return { success: false, error: `Flag "${token}" requires a value.` };
      }

      flags[flagKey] = valueParts.join(' ');
      continue;
    }

    // Unknown positional after flags started — skip gracefully
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

function findFlagKey(flagName: string): string | null {
  for (const [key, def] of Object.entries(FLAGS)) {
    if (def.name === `--${flagName}`) return key;
  }
  return null;
}
