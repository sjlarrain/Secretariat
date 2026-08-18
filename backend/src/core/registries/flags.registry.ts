export type FlagType = 'string' | 'date' | 'time' | 'email-list' | 'account-alias' | 'duration';

export interface FlagDefinition {
  name: string;
  alias?: string;
  /** Single-letter shorthand e.g. 't' makes -t equivalent to --title */
  shortAlias?: string;
  type: FlagType;
  required: boolean;
  /** If true, the flag can be used with no value (parser sets it to empty string '') */
  optional?: boolean;
  description: string;
}

export const FLAGS: Record<string, FlagDefinition> = {
  title: {
    name: '--title',
    shortAlias: 't',
    type: 'string',
    required: false,
    description: 'Name of the event, task, or reminder',
  },
  for: {
    name: '--for',
    shortAlias: 'f',
    type: 'date',
    required: false,
    description: 'Date — DD-MM-YYYY or natural language (tomorrow, next monday)',
  },
  at: {
    name: '--at',
    alias: '@',
    shortAlias: 'a',
    type: 'time',
    required: false,
    description: 'Time in HH:MM format (24h). @day marks an all-day event (/schedule only).',
  },
  duration: {
    name: '--duration',
    shortAlias: 'd',
    type: 'duration',
    required: false,
    description: 'Event length — hours for timed events (e.g. 2 or 1.5), or days for @day events (e.g. 3). Default 1.',
  },
  invite: {
    name: '--invite',
    shortAlias: 'i',
    type: 'email-list',
    required: false,
    description: 'Comma-separated email addresses to invite',
  },
  using: {
    name: '--using',
    shortAlias: 'u',
    type: 'account-alias',
    required: false,
    description: 'Named account alias (e.g. GG) — uses default if omitted',
  },
  notes: {
    name: '--notes',
    shortAlias: 'n',
    type: 'string',
    required: false,
    description: 'Optional notes or description',
  },
  project: {
    name: '--project',
    shortAlias: 'p',
    type: 'string',
    required: false,
    optional: true,
    description: 'Project folder — omit value to list all projects, provide name to filter or assign',
  },
  plan: {
    name: '--plan',
    shortAlias: 'p',
    type: 'string',
    required: false,
    optional: true,
    description: 'Plan type name (e.g. Lunch, Coffee) — shows free slots for that meeting type',
  },
  read: {
    name: '--read',
    shortAlias: 'r',
    type: 'string',
    required: false,
    description: 'Mark link #N as read (archived). Pass the 1-based index from /links.',
  },
  tags: {
    name: '--tags',
    shortAlias: 't',
    type: 'string',
    required: false,
    description: 'Space-separated kebab-case tags (e.g. fintech-elements tech-news)',
  },
  done: {
    name: '--done',
    shortAlias: 'd',
    type: 'string',
    required: false,
    description: 'Mark item #N as done (e.g. --done 3 or -d 3)',
  },
  due: {
    // -u, not -d: /mba accepts --done (-d) too. Short aliases only need to be
    // unique within a command's acceptedFlags, which is why this can reuse the
    // letter --using takes on /schedule.
    name: '--due',
    shortAlias: 'u',
    type: 'date',
    required: false,
    description: 'Due date — auto-reminds 24h before (DD-MM-YYYY or natural language)',
  },
  video: {
    name: '--video',
    shortAlias: 'v',
    type: 'string',
    required: false,
    optional: true,
    description: 'Add a Google Meet link to the event — no value needed',
  },
  name: {
    // -n: /links doesn't accept --notes, so no per-command clash despite
    // sharing the letter globally.
    name: '--name',
    shortAlias: 'n',
    type: 'string',
    required: false,
    description: 'Name for a saved link (shown instead of the raw URL)',
  },
};
