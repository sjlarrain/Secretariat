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

  getTrashedIdeas: () => request<{ ideas: Idea[] }>('/ideas/trash'),
  emptyTrash: () => request('/ideas/trash', { method: 'DELETE' }),
  restoreIdea: (id: number) => request(`/ideas/${id}/restore`, { method: 'POST' }),
  permanentlyDeleteIdea: (id: number) => request(`/ideas/${id}/permanent`, { method: 'DELETE' }),
};

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
