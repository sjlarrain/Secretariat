// Central Redis key-builder. Every persisted key must be constructed through
// one of the functions below — a raw `secretariat:`-prefixed (or otherwise
// ad-hoc) string literal anywhere else in src/ is a regression back to the v1
// single-user layout. `u:<userId>:<name>` keys are owned by exactly one user
// (userId is the owner's E.164 phone number); `sys:<name>` keys are shared
// platform state that isn't scoped to any single user.

export type UserCollection =
  | 'accounts'
  | 'settings'
  | 'ideas'
  | 'projects'
  | 'links'
  | 'links-pending'
  | 'plans'
  | 'reminders'
  | 'tasks'
  | 'ucla'
  | 'third-party-contacts'
  | 'third-party-pending'
  | 'mantis-pending';

/** Per-user collection key: `u:<userId>:<name>`. */
export function userKey(userId: string, name: UserCollection): string {
  return `u:${userId}:${name}`;
}

/**
 * Atomic id-sequence key for a per-user hash collection (see
 * `redis/hash-collection.ts`). Only used by collections that mint their own
 * numeric ids — collections keyed by an externally-supplied id (UUIDs,
 * phone numbers) don't need one.
 */
export function userSeqKey(userId: string, name: UserCollection): string {
  return `u:${userId}:${name}:seq`;
}

export type SystemCollection =
  | 'health-alerts'
  // The user registry, and the log of numbers that messaged without being in
  // it. Both are single hashes keyed by phone number rather than one Redis key
  // per user: the hourly sweeper (v2 Goal 3) has to enumerate every user on
  // every tick, and one HGETALL is cheaper and more predictable than a SCAN
  // over `users:*`. See docs/v2-plan.md §C.3.
  | 'users'
  | 'unrecognized'
  | 'invites'
  | 'blocked';

/** Shared/system key, not owned by any single user. */
export function systemKey(name: SystemCollection): string {
  return `sys:${name}`;
}

export type PointNamespace =
  | 'dedup'
  | 'oauth-state'
  | 'wa-reply'
  | 'invite-claim'
  | 'panel-login'
  | 'panel-login-claim'
  // Idempotency claim for the hourly sweeper (platform/sweeper.ts): id is
  // `<userId>:<job>:<bucket>`, where bucket is a local date (daily-cadence
  // jobs) or `<date>T<hour>` (google-tasks-sync, which fires every tick it's
  // enabled). A doubled sweep loses the race on the same SET NX and skips.
  | 'fired';

/**
 * Ephemeral, per-flow/per-message point key (single get/set/del, usually
 * TTL-bound) — webhook dedup claims, OAuth state, and the button-reply
 * target cache. These aren't owned by a single user at the key level (the
 * id is a message/flow id, not a userId); callers that need to know the
 * owning user store it in the value instead.
 */
export function pointKey(namespace: PointNamespace, id: string): string {
  return `sys:${namespace}:${id}`;
}

/**
 * One-time migration read for pre-v1.14 UCLA items (`/work` -> `/ucla`
 * rename). This key only ever held Santiago's data from the v1 single-user
 * era — there is no per-user equivalent, so callers must only consult it
 * when resolving the one legacy owner (see `ucla.ts`'s use of
 * `whitelistedNumbers[0]`), never for any other userId. Kept out of
 * `UserCollection` so it's obviously not part of the ongoing per-user schema.
 */
export function legacyWorkKey(): string {
  return 'secretariat:work';
}
