/**
 * One-off migration: copies a single v1 (single-user) Secretariat dataset into
 * one v2 per-user namespace, and re-points every QStash message already queued
 * against v1 so it fires from v2 instead.
 *
 *   npx tsx src/scripts/migrate-v1-user.ts \
 *     --user +56991296313 --from ../Secretariat.env --to ../v2.env
 *
 * Prints a plan and writes nothing. Add `--apply` to perform the migration.
 *
 * Why this does not import `shared/env`: that module loads exactly one dotenv
 * file and `process.exit(1)`s on a missing variable. A migration needs *two*
 * environments live at once (v1's Redis + QStash to read and cancel from, v2's
 * to write and re-queue into), so both files are parsed explicitly in `main()`
 * and no value is ever written to `process.env` or logged. Only the pure
 * helpers — `keys.ts` (no imports) and `encrypt.ts` (only `crypto`) — are
 * shared with the app, so the key layout and the cipher cannot drift from what
 * the app actually reads.
 *
 * Safe to re-run. Item writes are keyed HSETs (same id → same field), `:seq` is
 * SET rather than INCR, and a QStash message that a previous run already
 * migrated is detected because the v1 copy no longer exists — see
 * `resolveQueued()`.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Redis } from '@upstash/redis';
import { Client as QStash } from '@upstash/qstash';
import { userKey, userSeqKey, type UserCollection } from '../shared/redis/keys';
import { encryptWithKey, decryptWithKey, deriveAccountKey } from '../shared/utils/encrypt';

// ── Injected client shapes ────────────────────────────────────────────────────
// Narrow structural interfaces rather than the concrete SDK types, so the tests
// can drive the real migration against the existing FakeRedis helper instead of
// re-implementing its logic.

export interface RedisLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
  hgetall<T>(key: string): Promise<Record<string, T> | null>;
  hset(key: string, fields: Record<string, unknown>): Promise<number>;
}

export interface QueuedMessage {
  url: string;
  body?: string;
  /** Unix ms after which the message may be delivered. */
  notBefore?: number;
}

export interface QueueLike {
  publish(request: {
    url: string;
    body: string;
    headers: Record<string, string>;
    delay: number;
  }): Promise<{ messageId: string }>;
  get(messageId: string): Promise<QueuedMessage | null>;
  cancel(messageId: string): Promise<unknown>;
}

// ── Collection map ────────────────────────────────────────────────────────────

/**
 * Collections whose ids are minted by `HashCollection.nextId()` (INCR on a
 * `:seq` counter that starts at 0 in a fresh namespace). Every one of these
 * MUST have its counter seeded to the highest id written, or the next create
 * mints an id that is already taken and the HSET silently overwrites a real
 * item. See docs/v2-plan.md — "Migration requirement".
 */
const NUMERIC_COLLECTIONS: { v1Key: string; name: UserCollection }[] = [
  { v1Key: 'secretariat:projects', name: 'projects' },
  { v1Key: 'secretariat:ideas', name: 'ideas' },
  { v1Key: 'secretariat:links', name: 'links' },
  { v1Key: 'secretariat:plans', name: 'plans' },
  { v1Key: 'secretariat:tasks', name: 'tasks' },
  // v2.0 renamed /ucla to /mba, collection included. Clean break, no shim.
  { v1Key: 'secretariat:ucla', name: 'mba' },
];

const V1_ACCOUNTS_KEY = 'secretariat:accounts';
const V1_SETTINGS_KEY = 'secretariat:settings';
const V1_REMINDERS_KEY = 'secretariat:reminders';
const V1_TP_CONTACTS_KEY = 'secretariat:third-party-contacts';
const V1_TP_PENDING_KEY = 'secretariat:third-party-pending';

/** Fields on a migrated item that hold a QStash message id needing replay. */
const QUEUED_ID_FIELDS: Partial<Record<UserCollection, string[]>> = {
  mba: ['dueReminderId', 'qstashMessageId'],
  tasks: ['qstashMessageId'],
};

const REQUIRED_V1 = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'TOKEN_ENCRYPTION_KEY', 'QSTASH_TOKEN'];
const REQUIRED_V2 = [...REQUIRED_V1, 'BASE_URL'];

// ── Minimal shapes ────────────────────────────────────────────────────────────
// Declared locally rather than imported from token-store / the integrations,
// which all pull in `shared/env`. Only the fields this script touches.

interface Identified {
  id: number | string;
  [k: string]: unknown;
}

interface V1Account extends Identified {
  id: string;
  encryptedTokens: string;
}

interface V1Reminder extends Identified {
  id: string;
  title: string;
  messageId: string;
  deferred?: boolean;
}

interface V1ThirdPartyContact {
  number: string;
  [k: string]: unknown;
}

// ── Pure transforms ───────────────────────────────────────────────────────────

/**
 * v1 `Settings` → v2 `Settings`. Three changes:
 *  - `uclaReminder` → `mbaReminder` (the v2.0 rename)
 *  - every `scheduleId` is dropped — they identify cron schedules inside *v1's*
 *    QStash project, and v2 has no per-job schedules at all (one hourly sweeper,
 *    platform/sweeper.ts). Carrying them over would store dead ids.
 *  - `reminderPromoter.enabled` forced true, matching token-store's
 *    `normalizeSettings()`, which is not imported here because token-store pulls
 *    in `shared/env`.
 */
export function migrateSettings(v1: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!v1) return null;

  const { uclaReminder, ...rest } = v1 as Record<string, unknown> & { uclaReminder?: Record<string, unknown> };
  const out: Record<string, unknown> = { ...rest };

  if (uclaReminder && !out.mbaReminder) {
    out.mbaReminder = { enabled: uclaReminder.enabled === true, time: uclaReminder.time ?? '09:00' };
  }

  for (const job of ['morningDigest', 'weeklySummary', 'mbaReminder', 'reminderPromoter', 'googleTasksSync', 'healthCheck']) {
    const value = out[job];
    if (value && typeof value === 'object') {
      const { scheduleId: _dropped, ...clean } = value as Record<string, unknown>;
      out[job] = clean;
    }
  }

  const promoter = (out.reminderPromoter as Record<string, unknown> | undefined) ?? { time: '08:00' };
  out.reminderPromoter = { ...promoter, enabled: true };

  return out;
}

/**
 * Re-encrypts an account's tokens under v2's master key. Each account's key is
 * HKDF-derived from the master key *and* the account id, so a differing master
 * key makes every stored token undecryptable on the other side. When the two
 * master keys match this is a no-op and the ciphertext is copied verbatim.
 */
export function migrateAccount(account: V1Account, v1MasterKey: string, v2MasterKey: string): V1Account {
  if (v1MasterKey === v2MasterKey) return account;
  const plaintext = decryptWithKey(account.encryptedTokens, deriveAccountKey(v1MasterKey, account.id));
  return { ...account, encryptedTokens: encryptWithKey(plaintext, deriveAccountKey(v2MasterKey, account.id)) };
}

/** `/internal/ucla/*` → `/internal/mba/*`, and v1's origin → v2's. */
export function rewriteQueuedUrl(originalUrl: string, v2BaseUrl: string): string {
  const pathname = new URL(originalUrl).pathname.replace('/internal/ucla/', '/internal/mba/');
  return `${v2BaseUrl.replace(/\/$/, '')}${pathname}`;
}

/** Adds the owning userId and applies the ucla→mba payload rename. */
export function rewriteQueuedBody(raw: string | undefined, userId: string): Record<string, unknown> {
  let body: Record<string, unknown> = {};
  if (raw) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  // v1's fire routes identified the item as uclaItemId (and workItemId before
  // v1.14); v2's /internal/mba/* routes read mbaItemId.
  const legacyItemId = body.uclaItemId ?? body.workItemId;
  if (legacyItemId !== undefined && body.mbaItemId === undefined) body.mbaItemId = legacyItemId;
  delete body.uclaItemId;
  delete body.workItemId;

  // v2's fire routes fall back to phoneNumber when userId is absent, but that
  // fallback only holds while one number owns everything. Set it explicitly.
  body.userId = userId;
  return body;
}

/** Highest numeric id in a collection — the value its `:seq` must be SET to. */
export function highestNumericId(items: Identified[]): number {
  const ids = items.map((i) => Number(i.id)).filter((n) => Number.isFinite(n) && n > 0);
  return ids.length ? Math.max(...ids) : 0;
}

// ── Queued-message resolution ─────────────────────────────────────────────────

interface PendingReplay {
  label: string;
  oldMessageId: string;
  newUrl: string;
  body: Record<string, unknown>;
  fireAt: number; // ms epoch
}

type QueuedOutcome =
  | { kind: 'replay'; replay: PendingReplay }
  /** v1 no longer has the message: already delivered, or a previous run migrated it. */
  | { kind: 'gone'; preserved: string | undefined }
  /** Fire time has passed — QStash is about to deliver it (to v1) or already has. */
  | { kind: 'past' };

async function resolveQueued(
  queue: QueueLike,
  opts: {
    label: string;
    field: string;
    oldMessageId: string;
    existingV2: Record<string, unknown> | undefined;
    userId: string;
    v2BaseUrl: string;
    now: number;
  }
): Promise<QueuedOutcome> {
  const message = await queue.get(opts.oldMessageId).catch(() => null);

  if (!message) {
    // Preserve whatever a previous run already re-queued, rather than reverting
    // the record to a dead v1 message id. This is what makes re-running safe.
    const existing = opts.existingV2?.[opts.field];
    const preserved = typeof existing === 'string' && existing !== opts.oldMessageId ? existing : undefined;
    return { kind: 'gone', preserved };
  }

  const fireAt = message.notBefore ?? 0;
  if (fireAt <= opts.now) return { kind: 'past' };

  return {
    kind: 'replay',
    replay: {
      label: opts.label,
      oldMessageId: opts.oldMessageId,
      newUrl: rewriteQueuedUrl(message.url, opts.v2BaseUrl),
      body: rewriteQueuedBody(message.body, opts.userId),
      fireAt,
    },
  };
}

// ── Migration ─────────────────────────────────────────────────────────────────

export interface MigrationDeps {
  v1Redis: RedisLike;
  v2Redis: RedisLike;
  v1Queue: QueueLike;
  v2Queue: QueueLike;
  userId: string;
  v1MasterKey: string;
  v2MasterKey: string;
  v2BaseUrl: string;
  /** false = plan only, nothing is written and nothing is cancelled. */
  apply: boolean;
  /** Leave every stored QStash id pointing at v1 instead of replaying. */
  skipQstash?: boolean;
  now?: number;
  log?: (line: string) => void;
}

export interface CollectionReport {
  name: string;
  items: number;
  seq?: number;
  replayed: number;
  deferred?: number;
}

export interface MigrationResult {
  collections: CollectionReport[];
  settings: 'migrated' | 'none';
  accounts: { count: number; reEncrypted: boolean };
  /** Non-empty means nothing was written — resolve these first. */
  blockers: string[];
  applied: boolean;
}

export async function runMigration(deps: MigrationDeps): Promise<MigrationResult> {
  const { v1Redis, v2Redis, v1Queue, v2Queue, userId, v2BaseUrl, apply } = deps;
  const now = deps.now ?? Date.now();
  const log = deps.log ?? (() => {});
  const skipQstash = deps.skipQstash === true;

  const collections: CollectionReport[] = [];
  const blockers: string[] = [];
  const writes: (() => Promise<void>)[] = [];

  /**
   * Publishes on v2 first, then cancels on v1. A failed cancel duplicates a
   * reminder; a failed publish loses it — and a duplicate is the recoverable
   * one of the two.
   */
  async function replay(pending: PendingReplay): Promise<string> {
    const delaySeconds = Math.max(0, Math.floor((pending.fireAt - now) / 1000));
    const published = await v2Queue.publish({
      url: pending.newUrl,
      body: JSON.stringify(pending.body),
      headers: { 'Content-Type': 'application/json' },
      delay: delaySeconds,
    });

    try {
      await v1Queue.cancel(pending.oldMessageId);
    } catch (err) {
      log(
        `  ! could not cancel v1 message ${pending.oldMessageId} ("${pending.label}") — it may also fire from v1: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    log(`  ↻ "${pending.label}" → v2 in ${delaySeconds}s`);
    return published.messageId;
  }

  // ── Numeric collections (+ the :seq counters that make them safe) ──────────
  for (const { v1Key, name } of NUMERIC_COLLECTIONS) {
    const items = (await v1Redis.get<Identified[]>(v1Key)) ?? [];
    if (items.length === 0) {
      collections.push({ name, items: 0, replayed: 0 });
      continue;
    }

    const existingV2 = (await v2Redis.hgetall<Record<string, unknown>>(userKey(userId, name))) ?? {};
    const queuedFields = QUEUED_ID_FIELDS[name] ?? [];
    const mapping: Record<string, Record<string, unknown>> = {};
    const deferredReplays: { itemId: string; field: string; pending: PendingReplay }[] = [];

    for (const item of items) {
      const migrated: Record<string, unknown> = { ...item };

      for (const field of queuedFields) {
        const oldMessageId = item[field];
        if (skipQstash || typeof oldMessageId !== 'string' || !oldMessageId) continue;

        const outcome = await resolveQueued(v1Queue, {
          label: String(item.text ?? item.title ?? item.id),
          field,
          oldMessageId,
          existingV2: existingV2[String(item.id)],
          userId,
          v2BaseUrl,
          now,
        });

        if (outcome.kind === 'replay') {
          deferredReplays.push({ itemId: String(item.id), field, pending: outcome.replay });
        } else if (outcome.kind === 'gone' && outcome.preserved) {
          migrated[field] = outcome.preserved;
        } else {
          delete migrated[field];
        }
      }

      mapping[String(item.id)] = migrated;
    }

    const seq = highestNumericId(items);
    if (seq <= 0) {
      blockers.push(`${name}: ${items.length} item(s) but no usable numeric id — cannot seed :seq safely`);
      continue;
    }

    collections.push({ name, items: items.length, seq, replayed: deferredReplays.length });

    writes.push(async () => {
      // Replays run before the HSET so the new message ids land in the same
      // write — no read-modify-write over a collection just written.
      for (const { itemId, field, pending } of deferredReplays) {
        mapping[itemId][field] = await replay(pending);
      }
      await v2Redis.hset(userKey(userId, name), mapping);
      // SET, not INCR — re-running must land on the same value.
      await v2Redis.set(userSeqKey(userId, name), seq);
    });
  }

  // ── Reminders (caller-supplied string ids, so no :seq) ─────────────────────
  {
    const reminders = (await v1Redis.get<V1Reminder[]>(V1_REMINDERS_KEY)) ?? [];
    const existingV2 = (await v2Redis.hgetall<Record<string, unknown>>(userKey(userId, 'reminders'))) ?? {};
    const mapping: Record<string, Record<string, unknown>> = {};
    const deferredReplays: { itemId: string; pending: PendingReplay }[] = [];
    let deferred = 0;

    for (const reminder of reminders) {
      const migrated: Record<string, unknown> = { ...reminder };

      if (reminder.deferred) {
        // No QStash message exists for these — they are beyond the 7-day max
        // delay, and only the Sunday promoter (now a sweeper branch) ever
        // queues them. Copying them across is the whole reason they survive.
        deferred++;
      } else if (reminder.messageId && !skipQstash) {
        const outcome = await resolveQueued(v1Queue, {
          label: reminder.title,
          field: 'messageId',
          oldMessageId: reminder.messageId,
          existingV2: existingV2[reminder.id],
          userId,
          v2BaseUrl,
          now,
        });

        if (outcome.kind === 'replay') deferredReplays.push({ itemId: reminder.id, pending: outcome.replay });
        else if (outcome.kind === 'gone') migrated.messageId = outcome.preserved ?? '';
        else migrated.messageId = '';
      }

      mapping[reminder.id] = migrated;
    }

    collections.push({ name: 'reminders', items: reminders.length, replayed: deferredReplays.length, deferred });

    if (reminders.length) {
      writes.push(async () => {
        for (const { itemId, pending } of deferredReplays) {
          mapping[itemId].messageId = await replay(pending);
        }
        await v2Redis.hset(userKey(userId, 'reminders'), mapping);
      });
    }
  }

  // ── Third-party contacts (keyed by number) and pending events (by id) ─────
  {
    const contacts = (await v1Redis.get<V1ThirdPartyContact[]>(V1_TP_CONTACTS_KEY)) ?? [];
    collections.push({ name: 'third-party-contacts', items: contacts.length, replayed: 0 });
    if (contacts.length) {
      const mapping = Object.fromEntries(contacts.map((c) => [c.number, c]));
      writes.push(async () => {
        await v2Redis.hset(userKey(userId, 'third-party-contacts'), mapping);
      });
    }

    const pending = (await v1Redis.get<Identified[]>(V1_TP_PENDING_KEY)) ?? [];
    collections.push({ name: 'third-party-pending', items: pending.length, replayed: 0 });
    if (pending.length) {
      const mapping = Object.fromEntries(pending.map((p) => [String(p.id), p]));
      writes.push(async () => {
        await v2Redis.hset(userKey(userId, 'third-party-pending'), mapping);
      });
    }
  }

  // ── Accounts (re-encrypted when the master keys differ) ───────────────────
  const reEncrypted = deps.v1MasterKey !== deps.v2MasterKey;
  let accountCount = 0;
  {
    const accounts = (await v1Redis.get<V1Account[]>(V1_ACCOUNTS_KEY)) ?? [];
    accountCount = accounts.length;
    try {
      const migrated = accounts.map((a) => migrateAccount(a, deps.v1MasterKey, deps.v2MasterKey));
      if (migrated.length) {
        const mapping = Object.fromEntries(migrated.map((a) => [a.id, a]));
        writes.push(async () => {
          await v2Redis.hset(userKey(userId, 'accounts'), mapping);
        });
      }
    } catch (err) {
      blockers.push(
        `accounts: could not decrypt with v1's TOKEN_ENCRYPTION_KEY — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Settings (a plain value, not a collection) ────────────────────────────
  const v1Settings = await v1Redis.get<Record<string, unknown>>(V1_SETTINGS_KEY);
  const migratedSettings = migrateSettings(v1Settings);
  if (migratedSettings) {
    writes.push(async () => {
      await v2Redis.set(userKey(userId, 'settings'), migratedSettings);
    });
  }

  if (blockers.length > 0 || !apply) {
    return {
      collections,
      settings: migratedSettings ? 'migrated' : 'none',
      accounts: { count: accountCount, reEncrypted },
      blockers,
      applied: false,
    };
  }

  for (const write of writes) await write();

  return {
    collections,
    settings: migratedSettings ? 'migrated' : 'none',
    accounts: { count: accountCount, reEncrypted },
    blockers,
    applied: true,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

interface Args {
  user: string;
  from: string;
  to: string;
  apply: boolean;
  skipQstash: boolean;
}

export function parseArgs(argv: string[]): Args {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--skip-qstash') out.skipQstash = true;
    else if (arg.startsWith('--')) out[arg.slice(2)] = argv[++i] ?? '';
  }

  const user = String(out.user ?? '');
  const from = String(out.from ?? '');
  const to = String(out.to ?? '');

  if (!user || !from || !to) {
    throw new Error('Usage: migrate-v1-user.ts --user <+E164> --from <v1.env> --to <v2.env> [--apply] [--skip-qstash]');
  }
  // Every runtime path normalizes an inbound number to a leading '+' before it
  // becomes a userId (auth/middleware/resolve-sender.ts, platform/routes/register.ts).
  // Writing keys without it would put the data where nothing ever reads.
  if (!/^\+[1-9]\d{7,14}$/.test(user)) {
    throw new Error(`--user must be E.164 with a leading '+' (e.g. +56991296313); got "${user}"`);
  }

  return { user, from, to, apply: out.apply === true, skipQstash: out.skipQstash === true };
}

/** Parses a dotenv file without touching `process.env`. Values are never logged. */
function loadEnvFile(file: string, label: string, required: string[]): Record<string, string> {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`${label} env file not found: ${abs}`);
  const parsed = dotenv.parse(fs.readFileSync(abs));
  const missing = required.filter((k) => !parsed[k]);
  if (missing.length) throw new Error(`${label} env file (${abs}) is missing: ${missing.join(', ')}`);
  return parsed;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}

function wrapQueue(client: QStash): QueueLike {
  return {
    publish: (request) => client.publish(request).then((res) => ({ messageId: res.messageId })),
    get: (messageId) => client.messages.get(messageId),
    cancel: (messageId) => client.messages.cancel(messageId),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const v1Env = loadEnvFile(args.from, 'v1 (--from)', REQUIRED_V1);
  const v2Env = loadEnvFile(args.to, 'v2 (--to)', REQUIRED_V2);

  if (v1Env.UPSTASH_REDIS_REST_URL === v2Env.UPSTASH_REDIS_REST_URL) {
    throw new Error('v1 and v2 point at the same Redis — this would write v2 keys into the live v1 database.');
  }

  console.log('');
  console.log(`  user      ${args.user}`);
  console.log(`  v1 redis  ${hostOf(v1Env.UPSTASH_REDIS_REST_URL)}   (read-only)`);
  console.log(`  v2 redis  ${hostOf(v2Env.UPSTASH_REDIS_REST_URL)}`);
  console.log(`  v2 base   ${v2Env.BASE_URL}`);
  console.log(`  mode      ${args.apply ? 'APPLY — writes to v2, cancels v1 QStash messages' : 'dry run — nothing is written'}`);
  console.log('');

  if (v1Env.QSTASH_TOKEN === v2Env.QSTASH_TOKEN && !args.skipQstash) {
    console.log('  ! v1 and v2 share one QStash project. Replay still works, but the 3-cron');
    console.log('    free-tier cap is shared — verify the sweeper schedule exists afterwards.');
    console.log('');
  }

  const result = await runMigration({
    v1Redis: new Redis({ url: v1Env.UPSTASH_REDIS_REST_URL, token: v1Env.UPSTASH_REDIS_REST_TOKEN }),
    v2Redis: new Redis({ url: v2Env.UPSTASH_REDIS_REST_URL, token: v2Env.UPSTASH_REDIS_REST_TOKEN }),
    v1Queue: wrapQueue(new QStash({ token: v1Env.QSTASH_TOKEN, ...(v1Env.QSTASH_URL ? { baseUrl: v1Env.QSTASH_URL } : {}) })),
    v2Queue: wrapQueue(new QStash({ token: v2Env.QSTASH_TOKEN, ...(v2Env.QSTASH_URL ? { baseUrl: v2Env.QSTASH_URL } : {}) })),
    userId: args.user,
    v1MasterKey: v1Env.TOKEN_ENCRYPTION_KEY,
    v2MasterKey: v2Env.TOKEN_ENCRYPTION_KEY,
    v2BaseUrl: v2Env.BASE_URL,
    apply: args.apply,
    skipQstash: args.skipQstash,
    log: (line) => console.log(line),
  });

  for (const c of result.collections) {
    const seq = c.seq !== undefined ? `   :seq → ${c.seq}` : '';
    const replayed = c.replayed ? `   ${c.replayed} queued message(s)` : '';
    const deferred = c.deferred ? `   ${c.deferred} deferred` : '';
    console.log(`  ${c.name.padEnd(22)} ${String(c.items).padStart(4)} items${seq}${deferred}${replayed}`);
  }
  console.log(
    `  ${'accounts'.padEnd(22)} ${String(result.accounts.count).padStart(4)} items   ${
      result.accounts.reEncrypted ? 're-encrypted for v2' : 'same encryption key'
    }`
  );
  console.log(
    `  ${'settings'.padEnd(22)}        ${
      result.settings === 'migrated' ? 'migrated, schedule ids stripped' : 'none in v1 — v2 defaults apply (UTC)'
    }`
  );
  console.log('');

  if (result.blockers.length) {
    for (const blocker of result.blockers) console.error(`  ✗ ${blocker}`);
    console.error('\n  Nothing was written.\n');
    process.exit(1);
  }

  if (!result.applied) {
    console.log('  Dry run. Re-run with --apply to write.');
    console.log("  Check every :seq above equals that list's highest id before applying.");
    console.log('');
    return;
  }

  console.log('  ✓ Migration applied. v1 was not modified.');
  console.log('');
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
