export interface CommandDefinition {
  name: string;
  description: string;
  acceptedFlags: string[];
  requiredFlags: string[];
}

export const COMMANDS: Record<string, CommandDefinition> = {
  start: {
    name: '/start',
    description: 'Wake up the bot',
    acceptedFlags: [],
    requiredFlags: [],
  },
  menu: {
    name: '/menu',
    description: 'Show all available commands and syntax',
    acceptedFlags: [],
    requiredFlags: [],
  },
  schedule: {
    name: '/schedule',
    description: 'Create a calendar event on Google Calendar',
    acceptedFlags: ['title', 'for', 'at', 'invite', 'using', 'notes'],
    requiredFlags: ['for', 'at'],
  },
  gtask: {
    name: '/gtask',
    description: 'Create a task in Google Tasks',
    acceptedFlags: ['title', 'for', 'notes'],
    requiredFlags: [],
  },
  task: {
    name: '/task',
    description: 'Save a personal task. `/task <title>` to add, `/task` to list, `/task done <id>` to mark done. Use -p or # for project, --for for due date.',
    acceptedFlags: ['project', 'for', 'at'],
    requiredFlags: [],
  },
  reminder: {
    name: '/reminder',
    description: 'Set a reminder — fires back as a WhatsApp message at the scheduled time',
    acceptedFlags: ['title', 'for', 'at'],
    requiredFlags: ['for', 'at'],
  },
  myschedule: {
    name: '/myschedule',
    description: 'Show calendar events for a day/week, or free slots for a plan type (--plan Lunch)',
    acceptedFlags: ['for', 'plan'],
    requiredFlags: [],
  },
  ideas: {
    name: '/ideas',
    description: 'Save or list your ideas. `/ideas <text>` to save, `/ideas` to list all, `/ideas --project` to list projects.',
    acceptedFlags: ['project'],
    requiredFlags: [],
  },
  links: {
    name: '/links',
    description: 'Save a link, list, archive, or tag. `/links <url>` to save, `/links` to list, `/links -r N` to archive, `/links #N -t tag` to add tags.',
    acceptedFlags: ['tags', 'read'],
    requiredFlags: [],
  },
  work: {
    name: '/work',
    description: 'Weekend to-do list. `/work <text>` to add, `/work` to list, `/work --done N` to mark done. Add --for and --at for an optional one-shot reminder.',
    acceptedFlags: ['done', 'for', 'at'],
    requiredFlags: [],
  },
  status: {
    name: '/status',
    description: 'Show system status: Google calendar connections, Kapso health, and monthly message usage.',
    acceptedFlags: [],
    requiredFlags: [],
  },
};
