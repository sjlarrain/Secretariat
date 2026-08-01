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
    description: 'Create a calendar event on Google Calendar. Add -v for a Google Meet link, @day for an all-day event, -d for duration.',
    acceptedFlags: ['title', 'for', 'at', 'invite', 'using', 'notes', 'video', 'duration'],
    requiredFlags: ['for', 'at'],
  },
  task: {
    name: '/task',
    description: 'Save a personal task. `/task <title>` to add, `/task` to list, `/task done <id>` to mark done. Use -p or # for project, --for for due date, -n for notes.',
    acceptedFlags: ['project', 'for', 'at', 'notes'],
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
    description: 'Save a link, list, archive, tag, or name. `/links <url>` to save, `/links` to list, `/links -r N` to archive, `/links #N -t tag` to add tags, `/links #N --name text` to name it, `/links #N` to get its URL.',
    acceptedFlags: ['tags', 'read', 'name'],
    requiredFlags: [],
  },
  ucla: {
    name: '/ucla',
    description: 'UCLA to-do list. `/ucla <text>` to add, `/ucla` to list, `/ucla --done N` to mark done. Use --due for a due date (auto-reminds 24h before); --for and --at add an extra one-shot reminder.',
    acceptedFlags: ['done', 'due', 'for', 'at'],
    requiredFlags: [],
  },
  status: {
    name: '/status',
    description: 'Show system status: Google calendar connections, Kapso health, and monthly message usage.',
    acceptedFlags: [],
    requiredFlags: [],
  },
  zone: {
    name: '/zone',
    description: 'Show or set the platform timezone. `/zone` to show, `/zone America/Santiago` or `/zone GMT-3` to set. Reschedules all digests.',
    acceptedFlags: [],
    requiredFlags: [],
  },
  mantis: {
    name: '/mantis',
    description: 'Quick-capture a networking note to the Mantis inbox for later classification.',
    acceptedFlags: [],
    requiredFlags: [],
  },
};
