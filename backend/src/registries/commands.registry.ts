export interface CommandDefinition {
  name: string;
  description: string;
  acceptedFlags: string[];
  requiredFlags: string[];
}

export const COMMANDS: Record<string, CommandDefinition> = {
  start: {
    name: '/start',
    description: 'Show all available commands and their flags',
    acceptedFlags: [],
    requiredFlags: [],
  },
  schedule: {
    name: '/schedule',
    description: 'Create a calendar event on Google Calendar',
    acceptedFlags: ['title', 'for', 'at', 'invite', 'using', 'notes'],
    requiredFlags: ['title', 'for', 'at'],
  },
  task: {
    name: '/task',
    description: 'Create a task in Google Tasks',
    acceptedFlags: ['title', 'for', 'notes'],
    requiredFlags: ['title'],
  },
  reminder: {
    name: '/reminder',
    description: 'Set a reminder — fires back as a WhatsApp message at the scheduled time',
    acceptedFlags: ['title', 'for', 'at'],
    requiredFlags: ['title', 'for', 'at'],
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
};
