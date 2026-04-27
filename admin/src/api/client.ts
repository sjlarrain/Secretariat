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
};

export interface Account {
  id: string;
  alias: string;
  provider: 'google';
  type: 'calendar' | 'tasks';
  isDefault: boolean;
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
