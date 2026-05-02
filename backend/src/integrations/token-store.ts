import { Redis } from '@upstash/redis';
import { env } from '../env';
import { encrypt, decrypt } from '../utils/encrypt';

export interface ConnectedAccount {
  id: string;
  alias: string;
  provider: 'google';
  type: 'calendar' | 'tasks';
  isDefault: boolean;
  encryptedTokens: string; // JSON stringified tokens, AES-256-GCM encrypted
  enabledCalendarIds?: string[];
  calendarNames?: Record<string, string>;
}

export interface Settings {
  timezone: string;
  morningDigest: {
    enabled: boolean;
    time: string;    // HH:MM
    days: number[];  // 0=Sun, 1=Mon, ... 6=Sat
    scheduleId?: string;
  };
  weeklySummary: {
    enabled: boolean;
    day: number;
    time: string;
    scheduleId?: string;
  };
}

const ACCOUNTS_KEY = 'secretariat:accounts';
const SETTINGS_KEY = 'secretariat:settings';

const DEFAULT_SETTINGS: Settings = {
  timezone: 'America/Santiago',
  morningDigest: { enabled: false, time: '08:00', days: [1, 2, 3, 4, 5] },
  weeklySummary: { enabled: false, day: 0, time: '09:00' },
};

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

export async function getAllAccounts(): Promise<ConnectedAccount[]> {
  const data = await getRedis().get<ConnectedAccount[]>(ACCOUNTS_KEY);
  const accounts = data ?? [];

  // Self-heal: ensure at most one default per type
  let dirty = false;
  for (const type of ['calendar', 'tasks'] as const) {
    const defaults = accounts.filter((a) => a.type === type && a.isDefault);
    if (defaults.length > 1) {
      defaults.slice(1).forEach((a) => { a.isDefault = false; dirty = true; });
    }
  }
  if (dirty) await getRedis().set(ACCOUNTS_KEY, accounts);

  return accounts;
}

export async function getAccount(id: string): Promise<ConnectedAccount | undefined> {
  const accounts = await getAllAccounts();
  return accounts.find((a) => a.id === id);
}

export async function saveAccount(account: ConnectedAccount): Promise<void> {
  const accounts = await getAllAccounts();
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  await getRedis().set(ACCOUNTS_KEY, accounts);
}

export async function setDefaultAccount(id: string): Promise<void> {
  const accounts = await getAllAccounts();
  const target = accounts.find((a) => a.id === id);
  if (!target) return;
  const updated = accounts.map((a) =>
    a.type === target.type ? { ...a, isDefault: a.id === id } : a
  );
  await getRedis().set(ACCOUNTS_KEY, updated);
}

export async function deleteAccount(id: string): Promise<void> {
  const accounts = await getAllAccounts();
  await getRedis().set(ACCOUNTS_KEY, accounts.filter((a) => a.id !== id));
}

export async function getSettings(): Promise<Settings> {
  const data = await getRedis().get<Settings>(SETTINGS_KEY);
  return data ?? DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await getRedis().set(SETTINGS_KEY, settings);
}

export function encryptTokens(tokens: object): string {
  return encrypt(JSON.stringify(tokens), env.TOKEN_ENCRYPTION_KEY);
}

export function decryptTokens<T = object>(encrypted: string): T {
  return JSON.parse(decrypt(encrypted, env.TOKEN_ENCRYPTION_KEY)) as T;
}
