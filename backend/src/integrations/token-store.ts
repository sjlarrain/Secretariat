import { Redis } from '@upstash/redis';
import { env } from '../env';
import { encryptWithKey, decryptWithKey, deriveAccountKey } from '../utils/encrypt';

export interface ConnectedAccount {
  id: string;
  alias: string;
  provider: 'google';
  type: 'calendar' | 'tasks';
  isDefault: boolean;
  encryptedTokens: string; // JSON stringified tokens, AES-256-GCM encrypted
  enabledCalendarIds?: string[];
  calendarNames?: Record<string, string>;
  isDisconnected?: boolean; // set to true when OAuth refresh token is revoked
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
  uclaReminder: {
    enabled: boolean;
    time: string;    // HH:MM — fires every Monday
    scheduleId?: string;
  };
  defaultTaskTime: string; // HH:MM — default reminder time when --for is set but --at is omitted
  reminderPromoter: {
    /**
     * Always true — the promoter cannot be turned off. Reminders further out
     * than QStash's 7-day max delay are stored as `deferred` with no queued
     * message, and this cron is the only thing that ever converts them into
     * real reminders. Disabling it would silently strand every deferred
     * reminder, so the value is forced on read, on write, and in
     * reconcileSchedules. The field is kept only for schedule-config symmetry.
     */
    enabled: true;
    time: string;    // HH:MM — weekly run time to promote deferred reminders to QStash
    scheduleId?: string;
  };
  googleTasksSync: {
    enabled: boolean;      // default false — opt in via admin panel
    scheduleId?: string;
    lastSyncAt?: string;   // ISO cursor used as updatedMin for the next poll
  };
  healthCheck: {
    enabled: boolean;      // default false — opt in via admin panel
    time: string;          // HH:MM — fires nightly
    scheduleId?: string;
    lastRunAt?: string;    // ISO timestamp of the last completed run
  };
}

const ACCOUNTS_KEY = 'secretariat:accounts';
const SETTINGS_KEY = 'secretariat:settings';

const DEFAULT_SETTINGS: Settings = {
  timezone: 'America/Santiago',
  morningDigest: { enabled: false, time: '08:00', days: [1, 2, 3, 4, 5] },
  weeklySummary: { enabled: false, day: 0, time: '09:00' },
  uclaReminder: { enabled: true, time: '09:00' },
  defaultTaskTime: '09:00',
  reminderPromoter: { enabled: true, time: '08:00' },
  googleTasksSync: { enabled: false },
  healthCheck: { enabled: false, time: '23:00' },
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

/**
 * Enforces invariants that must hold no matter what is in Redis or what a
 * client sends. Applied on both read and write, so a stored `false` heals
 * itself and a bad write can never persist.
 */
function normalizeSettings(settings: Settings): Settings {
  // The reminder promoter is not optional — see the Settings type. Deferred
  // reminders have no queued message and depend entirely on it.
  settings.reminderPromoter = { ...settings.reminderPromoter, enabled: true };
  return settings;
}

export async function getSettings(): Promise<Settings> {
  const data = await getRedis().get<Settings>(SETTINGS_KEY);
  if (!data) return normalizeSettings({ ...DEFAULT_SETTINGS });
  // Merge top-level defaults so fields added in newer versions always have a value
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...data });
}

export async function saveSettings(settings: Settings): Promise<void> {
  await getRedis().set(SETTINGS_KEY, normalizeSettings(settings));
}

export function encryptTokens(tokens: object, accountId: string): string {
  const key = deriveAccountKey(env.TOKEN_ENCRYPTION_KEY, accountId);
  return encryptWithKey(JSON.stringify(tokens), key);
}

export function decryptTokens<T = object>(encrypted: string, accountId: string): T {
  const key = deriveAccountKey(env.TOKEN_ENCRYPTION_KEY, accountId);
  return JSON.parse(decryptWithKey(encrypted, key)) as T;
}
