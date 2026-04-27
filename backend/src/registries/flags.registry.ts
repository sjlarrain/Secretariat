export type FlagType = 'string' | 'date' | 'time' | 'email-list' | 'account-alias';

export interface FlagDefinition {
  name: string;
  alias?: string;
  type: FlagType;
  required: boolean;
  description: string;
}

export const FLAGS: Record<string, FlagDefinition> = {
  title: {
    name: '--title',
    type: 'string',
    required: false,
    description: 'Name of the event, task, or reminder',
  },
  for: {
    name: '--for',
    type: 'date',
    required: false,
    description: 'Date — DD-MM-YYYY or natural language (tomorrow, next monday)',
  },
  at: {
    name: '--at',
    alias: '@',
    type: 'time',
    required: false,
    description: 'Time in HH:MM format (24h)',
  },
  invite: {
    name: '--invite',
    type: 'email-list',
    required: false,
    description: 'Comma-separated email addresses to invite',
  },
  using: {
    name: '--using',
    type: 'account-alias',
    required: false,
    description: 'Named account alias (e.g. GG) — uses default if omitted',
  },
  notes: {
    name: '--notes',
    type: 'string',
    required: false,
    description: 'Optional notes or description',
  },
};
