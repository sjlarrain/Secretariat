const BASE = '/api/admin';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  logout: () => request('/logout', { method: 'POST' }),

  getAccounts: () => request<{ accounts: Account[] }>('/accounts'),
  deleteAccount: (id: string) => request(`/accounts/${id}`, { method: 'DELETE' }),
  patchAccount: (id: string, data: Partial<Account>) =>
    request(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getWhitelist: () => request<{ numbers: string[] }>('/whitelist'),

  getSettings: () => request<Settings>('/settings'),
  saveSettings: (settings: Settings) =>
    request('/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  getProjects: () => request<{ projects: Project[] }>('/projects'),
  createProject: (name: string) =>
    request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  renameProject: (id: number, name: string) =>
    request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteProject: (id: number) => request(`/projects/${id}`, { method: 'DELETE' }),

  getIdeas: () => request<{ ideas: Idea[] }>('/ideas'),
  createIdea: (text: string, projectId: number) =>
    request<{ idea: Idea }>('/ideas', { method: 'POST', body: JSON.stringify({ text, projectId }) }),
  updateIdea: (id: number, data: { text?: string; projectId?: number }) =>
    request(`/ideas/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteIdea: (id: number) => request(`/ideas/${id}`, { method: 'DELETE' }),

  getDashboard: () => request<DashboardData>('/dashboard'),
  getCommands: () => request<{ commands: CommandInfo[] }>('/commands'),

  getPlans: () => request<{ plans: PlanType[] }>('/plans'),
  createPlan: (data: Omit<PlanType, 'id'>) =>
    request<{ plan: PlanType }>('/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePlan: (id: number, data: Partial<Omit<PlanType, 'id'>>) =>
    request(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePlan: (id: number) => request(`/plans/${id}`, { method: 'DELETE' }),

  getReminders: () => request<{ reminders: Reminder[] }>('/reminders'),
  updateReminder: (id: string, fireAt: string) =>
    request(`/reminders/${id}`, { method: 'PUT', body: JSON.stringify({ fireAt }) }),
  deleteReminder: (id: string) => request(`/reminders/${id}`, { method: 'DELETE' }),

  getAccountCalendars: (id: string) =>
    request<{ calendars: GoogleCalendar[]; enabledCalendarIds: string[] }>(`/accounts/${id}/calendars`),
  saveAccountCalendars: (id: string, calendarIds: string[], calendarNames: Record<string, string>) =>
    request(`/accounts/${id}/calendars`, { method: 'PATCH', body: JSON.stringify({ calendarIds, calendarNames }) }),

  getTrashedIdeas: () => request<{ ideas: Idea[] }>('/ideas/trash'),
  emptyTrash: () => request('/ideas/trash', { method: 'DELETE' }),
  restoreIdea: (id: number) => request(`/ideas/${id}/restore`, { method: 'POST' }),
  permanentlyDeleteIdea: (id: number) => request(`/ideas/${id}/permanent`, { method: 'DELETE' }),

  getLinks: (filter?: 'read') =>
    request<{ links: Link[] }>(`/links${filter === 'read' ? '?filter=read' : ''}`),
  createLink: (url: string, tags: string[]) =>
    request<{ link: Link }>('/links', { method: 'POST', body: JSON.stringify({ url, tags }) }),
  updateLink: (id: number, data: { url?: string; tags?: string[] }) =>
    request(`/links/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  markLinkRead: (id: number) => request(`/links/${id}/read`, { method: 'POST' }),
  deleteLink: (id: number) => request(`/links/${id}`, { method: 'DELETE' }),
};

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor?: string;
}

export interface Account {
  id: string;
  alias: string;
  provider: 'google';
  type: 'calendar' | 'tasks';
  isDefault: boolean;
}

export interface Project {
  id: number;
  name: string;
  createdAt: string;
  isDefault: boolean;
  ideaCount: number;
}

export interface Idea {
  id: number;
  text: string;
  createdAt: string;
  projectId: number;
  updatedAt?: string;
  deletedAt?: string;
}

export interface PlanType {
  id: number;
  name: string;
  days: number[];
  slots: string[];
  durationMinutes: number;
  bufferMinutes: number;
}

export interface DashboardData {
  events: { title: string; start: string; end: string }[];
  tasks: { title: string; dueDate: string | null }[];
  ideas: Idea[];
}

export interface CommandFlagInfo {
  key: string;
  long: string;
  short: string | null;
  description: string;
  optional: boolean;
}

export interface CommandInfo {
  key: string;
  name: string;
  description: string;
  acceptedFlags: CommandFlagInfo[];
  requiredFlags: string[];
}

export interface Reminder {
  id: string;
  title: string;
  phoneNumber: string;
  fireAt: string;
  messageId: string;
}

export interface Link {
  id: number;
  url: string;
  tags: string[];
  createdAt: string;
  readAt?: string;
}

export interface DigestConfig {
  enabled: boolean;
  time: string;
  days?: number[];
  day?: number;
  scheduleId?: string;
}

export interface Settings {
  timezone: string;
  morningDigest: DigestConfig & { days: number[] };
  weeklySummary: DigestConfig & { day: number };
}
