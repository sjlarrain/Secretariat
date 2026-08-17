import { Redis } from '@upstash/redis';
import { env } from '../../shared/env';
import { encryptWithKey, decryptWithKey, deriveAccountKey } from '../../shared/utils/encrypt';
import { userKey } from '../../shared/redis/keys';
import { HashCollection } from '../../shared/redis/hash-collection';

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
    time: string;    // HH:MM — the hourly sweeper (platform/sweeper.ts) matches on the hour only
    days: number[];  // 0=Sun, 1=Mon, ... 6=Sat
  };
  weeklySummary: {
    enabled: boolean;
    day: number;
    time: string;
  };
  uclaReminder: {
    enabled: boolean;
    time: string;    // HH:MM — fires every Monday
  };
  defaultTaskTime: string; // HH:MM — default reminder time when --for is set but --at is omitted
  reminderPromoter: {
    /**
     * Always true — the promoter cannot be turned off. Reminders further out
     * than QStash's 7-day max delay are stored as `deferred` with no queued
     * message, and this cron is the only thing that ever converts them into
     * real reminders. Disabling it would silently strand every deferred
     * reminder, so the value is forced on read and on write (normalizeSettings).
     */
    enabled: true;
    time: string;    // HH:MM — weekly run time (Sunday) to promote deferred reminders to QStash
  };
  googleTasksSync: {
    enabled: boolean;      // default false — opt in via admin panel
    lastSyncAt?: string;   // ISO cursor used as updatedMin for the next poll
  };
  healthCheck: {
    enabled: boolean;      // default false — opt in via admin panel
    time: string;          // HH:MM — fires nightly
    lastRunAt?: string;    // ISO timestamp of the last completed run
  };
}

const DEFAULT_SETTINGS: Settings = {
  // UTC, not any real user's zone. A user who hasn't set one yet must not
  // silently inherit someone else's local time — that would land their digests
  // and day boundaries hours off with no visible error. Registration requires a
  // timezone (docs/v2-plan.md §B.2), so this is only ever the pre-registration
  // fallback. `'UTC'` is also what `parseZoneInput()` canonicalizes to, so it
  // matches what `/zone` would store.
  timezone: 'UTC',
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

// Accounts are keyed by their own (UUID) id, not minted here, so the
// collection needs no seqKey.
function accountsCollection(userId: string): HashCollection<ConnectedAccount> {
  return new HashCollection<ConnectedAccount>(getRedis(), userKey(userId, 'accounts'));
}

export async function getAllAccounts(userId: string): Promise<ConnectedAccount[]> {
  const accounts = await accountsCollection(userId).getAll();

  // Self-heal: ensure at most one default per type. Only the offending
  // records are rewritten (one HSET each) — no whole-collection read-then-write.
  const fixes: Promise<void>[] = [];
  for (const type of ['calendar', 'tasks'] as const) {
    const defaults = accounts.filter((a) => a.type === type && a.isDefault);
    for (const a of defaults.slice(1)) {
      a.isDefault = false;
      fixes.push(accountsCollection(userId).set(a));
    }
  }
  if (fixes.length) await Promise.all(fixes);

  return accounts;
}

export async function getAccount(userId: string, id: string): Promise<ConnectedAccount | undefined> {
  return (await accountsCollection(userId).get(id)) ?? undefined;
}

export async function saveAccount(userId: string, account: ConnectedAccount): Promise<void> {
  await accountsCollection(userId).set(account);
}

export async function setDefaultAccount(userId: string, id: string): Promise<void> {
  const accounts = await getAllAccounts(userId);
  const target = accounts.find((a) => a.id === id);
  if (!target) return;
  const collection = accountsCollection(userId);
  await Promise.all(
    accounts
      .filter((a) => a.type === target.type)
      .map((a) => collection.set({ ...a, isDefault: a.id === id }))
  );
}

export async function deleteAccount(userId: string, id: string): Promise<void> {
  await accountsCollection(userId).remove(id);
}

/**
 * Enforces invariants that must hold no matter what is in Redis or what a
 * client sends. Applied on both read and write, so a stored `false` heals
 * itself and a bad write can never persist. Also the one place PUT /settings
 * and the /zone handler call before saving, so the response they return
 * matches what actually lands in Redis.
 */
export function normalizeSettings(settings: Settings): Settings {
  // The reminder promoter is not optional — see the Settings type. Deferred
  // reminders have no queued message and depend entirely on it.
  settings.reminderPromoter = { ...settings.reminderPromoter, enabled: true };
  return settings;
}

export async function getSettings(userId: string): Promise<Settings> {
  const data = await getRedis().get<Settings>(userKey(userId, 'settings'));
  if (!data) return normalizeSettings({ ...DEFAULT_SETTINGS });
  // Merge top-level defaults so fields added in newer versions always have a value
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...data });
}

export async function saveSettings(userId: string, settings: Settings): Promise<void> {
  await getRedis().set(userKey(userId, 'settings'), normalizeSettings(settings));
}

export function encryptTokens(tokens: object, accountId: string): string {
  const key = deriveAccountKey(env.TOKEN_ENCRYPTION_KEY, accountId);
  return encryptWithKey(JSON.stringify(tokens), key);
}

export function decryptTokens<T = object>(encrypted: string, accountId: string): T {
  const key = deriveAccountKey(env.TOKEN_ENCRYPTION_KEY, accountId);
  return JSON.parse(decryptWithKey(encrypted, key)) as T;
}
