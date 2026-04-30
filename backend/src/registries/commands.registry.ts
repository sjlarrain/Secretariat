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
  task: {
    name: '/task',
    description: 'Create a task in Google Tasks',
    acceptedFlags: ['title', 'for', 'notes'],
    requiredFlags: [],
  },
  reminder: {
    name: '/reminder',
    description: 'Set a reminder — fires back as a WhatsApp message at the scheduled time',
    acceptedFlags: ['title', 'for', 'at'],
    requiredFlags: ['for', 'at'],
  },
  mytask: {
    name: '/mytask',
    description: 'Retrieve and display your pending tasks',
    acceptedFlags: [],
    requiredFlags: [],
  },
  myschedule: {
    name: '/myschedule',
    description: "Retrieve and display today's calendar events",
    acceptedFlags: [],
    requiredFlags: [],
  },
  ideas: {
    name: '/ideas',
    description: 'Save or list your ideas. `/ideas <text>` to save, `/ideas` to list all, `/ideas --project` to list projects.',
    acceptedFlags: ['project'],
    requiredFlags: [],
  },
};
