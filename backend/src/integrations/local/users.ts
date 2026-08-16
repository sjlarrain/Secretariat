import { Redis } from '@upstash/redis';
import { env, whitelistedNumbers } from '../../env';
import { systemKey } from '../../redis/keys';
import { HashCollection } from '../../redis/hash-collection';

// The user registry — what replaces the WHITELISTED_NUMBERS env var. A sender's
// phone number is their identity: it is the field in this hash and the
// `<userId>` in every `u:<userId>:*` key they own.
//
// Stored as one hash rather than a key per user because the hourly sweeper
// (v2 Goal 3) enumerates every user on every tick; one HGETALL beats a SCAN
// over `users:*`. Writes are still per-field, so a registration and a sweeper
// pass cannot clobber each other.

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export type UserStatus = 'active' | 'disabled';

export interface RegisteredUser {
  /** E.164 phone number. Also the `userId` in every per-user Redis key. */
  id: string;
  name: string;
  /**
   * Captured at registration. NOT the runtime source of truth — `/zone` and the
   * admin panel write `settings.timezone`, and handlers read `ctx.timezone`
   * from there. Kept here so a user's original choice survives even if their
   * settings row is later reset, and so the ops console can show it without a
   * second read.
   */
  timezone: string;
  /** Only set if the user asked for calendar linking during onboarding. */
  email?: string;
  status: UserStatus;
  createdAt: string;
}

export interface UnrecognizedSender {
  /** E.164 phone number of whoever messaged without being registered. */
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  messageCount: number;
}

// Both collections are keyed by phone number, which is supplied rather than
// minted, so neither needs a `:seq` counter.
const users = new HashCollection<RegisteredUser>(redis, systemKey('users'));
const unrecognized = new HashCollection<UnrecognizedSender>(redis, systemKey('unrecognized'));

// ── Registry ──────────────────────────────────────────────────────────────────

export async function getRegisteredUsers(): Promise<RegisteredUser[]> {
  return users.getAll((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getRegisteredUser(phone: string): Promise<RegisteredUser | null> {
  return users.get(phone);
}

export async function registerUser(input: {
  phone: string;
  name: string;
  timezone: string;
  email?: string;
}): Promise<RegisteredUser> {
  const user: RegisteredUser = {
    id: input.phone,
    name: input.name.trim(),
    timezone: input.timezone,
    ...(input.email ? { email: input.email.trim() } : {}),
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  await users.set(user);
  // They are a user now; drop any record of them having been turned away.
  await unrecognized.remove(input.phone).catch(() => false);
  return user;
}

/**
 * Disable (or re-enable) a user. v2.0 is disable-only — offboarding stops
 * message processing and leaves the data in place; deletion is backlog.
 */
export async function setUserStatus(phone: string, status: UserStatus): Promise<boolean> {
  const user = await users.get(phone);
  if (!user) return false;
  await users.set({ ...user, status });
  return true;
}

// ── Unrecognized senders ──────────────────────────────────────────────────────

export async function getUnrecognizedSenders(): Promise<UnrecognizedSender[]> {
  return unrecognized.getAll((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Records that an unregistered number messaged. Never replies to them. */
export async function recordUnrecognizedSender(phone: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await unrecognized.get(phone);
  await unrecognized.set({
    id: phone,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    messageCount: (existing?.messageCount ?? 0) + 1,
  });
}

// ── Resolution ────────────────────────────────────────────────────────────────

export type ResolvedSender =
  /** A registered, active user. */
  | { kind: 'user'; user: RegisteredUser }
  /** Registered but disabled — processing stops, silently. */
  | { kind: 'disabled'; user: RegisteredUser }
  /** Not in the registry. No reply is sent; the number is logged for ops. */
  | { kind: 'unknown' };

/**
 * Synthesised entry for a number still listed in WHITELISTED_NUMBERS but not
 * yet in the registry. It is never written to Redis.
 *
 * Without this, deploying the registry against a fresh v2 database would lock
 * everyone out — including Santiago — because the registry starts empty and
 * registration (Goal 2c) does not exist yet. Delete this along with the env var
 * once every real user has a registry entry.
 */
function legacyOwner(phone: string): RegisteredUser {
  return {
    id: phone,
    name: 'Owner (legacy)',
    // Placeholder only. Runtime timezone comes from settings, as it does for
    // every user — see the note on RegisteredUser.timezone.
    timezone: 'UTC',
    status: 'active',
    createdAt: new Date(0).toISOString(),
  };
}

/**
 * Maps an inbound phone number to who, if anyone, it belongs to. The registry
 * wins; the env-var whitelist is consulted only for numbers the registry has
 * never heard of, and only until cutover.
 */
export async function resolveSender(phone: string): Promise<ResolvedSender> {
  if (!phone) return { kind: 'unknown' };

  const registered = await users.get(phone);
  if (registered) {
    return registered.status === 'active'
      ? { kind: 'user', user: registered }
      : { kind: 'disabled', user: registered };
  }

  if (whitelistedNumbers.includes(phone)) {
    return { kind: 'user', user: legacyOwner(phone) };
  }

  return { kind: 'unknown' };
}
