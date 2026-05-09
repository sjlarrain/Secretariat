export type FlagType = 'string' | 'date' | 'time' | 'email-list' | 'account-alias';

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
    description: 'Time in HH:MM format (24h)',
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
    description: 'Mark work item #N as done (e.g. --done 3 or -d 3)',
  },
};
