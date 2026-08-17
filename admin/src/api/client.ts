// Two panels share this file: the ops-only admin panel (username/password,
// data scoped to the one legacy owner — /api/admin) and the per-user panel
// (WhatsApp-link session, data scoped to whoever is signed in — /api/user).
// Both expose the identical set of methods below, just against a different
// base URL and a different "you're not signed in" destination.
//
// Every existing page imports the bare `api` export and calls `api.foo()`
// without knowing which panel it's running in. `setActiveClient` — called
// once per route by the app shell — swaps which backend those calls hit, so
// the same Dashboard/Ideas/Links/… components are reused unchanged by both
// panels instead of forking a second copy of every page.
function buildClient(base: string, onUnauthorized: () => void) {
  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...options,
    });

    if (res.status === 401) {
      onUnauthorized();
      throw new Error('Unauthorized');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Request failed');
    return data as T;
  }

  return {
  login: (username: string, password: string) =>
    request('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  logout: () => request('/logout', { method: 'POST' }),

  getAccounts: () => request<{ accounts: Account[] }>('/accounts'),
  deleteAccount: (id: string) => request(`/accounts/${id}`, { method: 'DELETE' }),
  patchAccount: (id: string, data: Partial<Account>) =>
    request(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getWhitelist: () => request<{ numbers: string[] }>('/whitelist'),

  getThirdPartyContacts: () => request<{ contacts: ThirdPartyContact[] }>('/third-party-contacts'),
  addThirdPartyContact: (number: string, alias: string) =>
    request('/third-party-contacts', { method: 'POST', body: JSON.stringify({ number, alias }) }),
  removeThirdPartyContact: (number: string) =>
    request(`/third-party-contacts/${encodeURIComponent(number)}`, { method: 'DELETE' }),

  getSettings: () => request<Settings>('/settings'),
  // Returns the stored settings, which may differ from what was sent — the
  // server canonicalizes the timezone (e.g. "GMT-3" becomes "Etc/GMT+3").
  saveSettings: (settings: Settings) =>
    request<{ ok: boolean; settings: Settings }>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),

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
  markIdeaDone: (id: number) => request(`/ideas/${id}/done`, { method: 'PATCH' }),
  getDoneIdeas: () => request<{ ideas: Idea[] }>('/ideas/done'),

  getUclaItems: () => request<{ items: UclaItem[] }>('/ucla'),
  getDoneUclaItems: () => request<{ items: UclaItem[] }>('/ucla/done'),
  createUclaItem: (text: string, dueDate?: string) =>
    request<{ item: UclaItem }>('/ucla', { method: 'POST', body: JSON.stringify({ text, dueDate }) }),
  markUclaItemDone: (id: number) => request(`/ucla/${id}/done`, { method: 'PATCH' }),
  deleteUclaItem: (id: number) => request(`/ucla/${id}`, { method: 'DELETE' }),

  getTasks: () => request<{ items: LocalTask[] }>('/tasks'),
  getDoneTasks: () => request<{ items: LocalTask[] }>('/tasks/done'),
  createTask: (title: string, project?: string) =>
    request<{ item: LocalTask }>('/tasks', { method: 'POST', body: JSON.stringify({ title, project }) }),
  markTaskDone: (id: number) => request(`/tasks/${id}/done`, { method: 'PATCH' }),
  deleteTask: (id: number) => request(`/tasks/${id}`, { method: 'DELETE' }),
  snoozeTask: (id: number, option: SnoozeOption) =>
    request(`/tasks/${id}/snooze`, { method: 'POST', body: JSON.stringify({ option }) }),
  remindTask: (id: number, option: SnoozeOption) =>
    request(`/tasks/${id}/remind`, { method: 'POST', body: JSON.stringify({ option }) }),

  snoozeReminder: (id: string, option: SnoozeOption) =>
    request(`/reminders/${id}/snooze`, { method: 'POST', body: JSON.stringify({ option }) }),

  updateTaskReminder: (id: number, fireAt: string) =>
    request(`/tasks/${id}/reminder`, { method: 'PUT', body: JSON.stringify({ fireAt }) }),
  updateUclaReminder: (id: number, fireAt: string) =>
    request(`/ucla/${id}/reminder`, { method: 'PUT', body: JSON.stringify({ fireAt }) }),

  snoozeUcla: (id: number, option: SnoozeOption) =>
    request(`/ucla/${id}/snooze`, { method: 'POST', body: JSON.stringify({ option }) }),
  remindUcla: (id: number, option: SnoozeOption) =>
    request(`/ucla/${id}/remind`, { method: 'POST', body: JSON.stringify({ option }) }),

  getHealthAlerts: () =>
    request<{ alerts: HealthAlert[]; lastRunAt: string | null }>('/health-alerts'),

  getLinks: (filter?: 'read') =>
    request<{ links: Link[] }>(`/links${filter === 'read' ? '?filter=read' : ''}`),
  createLink: (url: string, tags: string[], name?: string) =>
    request<{ link: Link }>('/links', { method: 'POST', body: JSON.stringify({ url, tags, name }) }),
  updateLink: (id: number, data: { url?: string; tags?: string[]; name?: string }) =>
    request(`/links/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  markLinkRead: (id: number) => request(`/links/${id}/read`, { method: 'POST' }),
  deleteLink: (id: number) => request(`/links/${id}`, { method: 'DELETE' }),
  };
}

type ApiClient = ReturnType<typeof buildClient>;

// The admin panel: username/password login, redirects to /login when the
// session lapses.
export const adminClient = buildClient('/api/admin', () => {
  window.location.href = '/login';
});

// The per-user panel: no password, session only exists via a WhatsApp-link
// login, so there's nowhere to redirect back into except the splash page
// telling the visitor how to get a new link.
export const userClient = buildClient('/api/user', () => {
  window.location.href = '/app/signin';
});

type PanelMode = 'admin' | 'user';

let activeMode: PanelMode = 'admin';
let active: ApiClient = adminClient;

/** Selected once per route by the app shell, before any page under it renders. */
export function setActiveClient(mode: PanelMode): void {
  activeMode = mode;
  active = mode === 'admin' ? adminClient : userClient;
}

/**
 * Google's OAuth redirect is a full-page navigation, not a fetch through
 * `request()`, so it can't go through the Proxy below — a page has to build
 * the URL itself. This is the one place that has to happen, since the admin
 * and per-user flows are genuinely different routes on the backend (see
 * routes/auth.ts vs routes/user-auth.ts): getting this wrong would connect a
 * user's Google account to the admin owner's namespace instead of their own.
 */
export function googleAuthStartUrl(alias: string, type: 'calendar' | 'tasks'): string {
  const query = `alias=${encodeURIComponent(alias)}&type=${encodeURIComponent(type)}`;
  return activeMode === 'admin' ? `/auth/google/start?${query}` : `/auth/user/google/start?${query}`;
}

/**
 * A handful of pages call an ops-only endpoint (getWhitelist) that has no
 * per-user equivalent — this lets them skip that call under the user panel
 * instead of the whole page failing when it 404s.
 */
export function isAdminMode(): boolean {
  return activeMode === 'admin';
}

// Every page imports this and calls api.foo() without knowing which panel
// it's running in — the Proxy forwards to whichever client
// `setActiveClient` last selected, so the same page components serve both
// panels instead of a second copy of each existing for the user panel.
export const api: ApiClient = new Proxy({} as ApiClient, {
  get(_target, prop: keyof ApiClient) {
    return active[prop];
  },
});

export interface ThirdPartyContact {
  number: string;
  alias: string;
}

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
  isDisconnected: boolean;
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
  usedAt?: string;
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
  tasks: { title: string; dueDate: string | null; project: string | null }[];
  ideas: Idea[];
}

export interface LocalTask {
  id: number;
  title: string;
  project?: string;
  dueDate?: string;
  dueTime?: string;
  status: 'open' | 'done';
  createdAt: string;
  doneAt?: string;
  qstashMessageId?: string;
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
  deferred?: boolean;
}

export interface Link {
  id: number;
  url: string;
  tags: string[];
  createdAt: string;
  readAt?: string;
  name?: string;
}

export interface UclaItem {
  id: number;
  text: string;
  createdAt: string;
  doneAt?: string;
  dueDate?: string;
  dueReminderId?: string;
  reminderFor?: string;
  qstashMessageId?: string;
}

export interface HealthAlert {
  id: string;
  kind: 'kapso' | 'google' | 'qstash' | 'redis';
  severity: 'warn' | 'error';
  message: string;
  resolveLink?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type SnoozeOption = '1h' | '1d' | 'monday';

export interface DigestConfig {
  enabled: boolean;
  time: string;
  days?: number[];
  day?: number;
  scheduleId?: string;
}

export interface Settings {
  timezone: string;
  uclaReminder: DigestConfig;  // every Monday, enabled by default
  morningDigest: DigestConfig & { days: number[] };
  weeklySummary: DigestConfig & { day: number };
  defaultTaskTime: string; // HH:MM — default reminder time for tasks with --for but no --at
  reminderPromoter: DigestConfig; // weekly cron to promote deferred reminders to QStash
  googleTasksSync: {
    enabled: boolean;
    scheduleId?: string;
    lastSyncAt?: string;
  };
  healthCheck: DigestConfig & { lastRunAt?: string }; // nightly system health check
}
