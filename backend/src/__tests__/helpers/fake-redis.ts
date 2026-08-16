// In-memory stand-in for the Upstash Redis client, covering the subset of the
// API this codebase actually calls. Exists because the storage layer (key
// namespacing, HashCollection, per-user isolation) had no test coverage at all:
// every other test file avoids Redis by copying pure functions out of the
// modules under test, which cannot catch a namespacing or atomicity regression.
//
// Fidelity notes — these matter for the tests to mean anything:
//   * Values round-trip through JSON, exactly as the real client serializes
//     them. A Date written in comes back out as a string, same as production.
//   * `hgetall` returns null for a missing key, not `{}`.
//   * Every operation resolves on a later microtask, so `Promise.all` genuinely
//     interleaves. A read-modify-write over a whole collection will lose an
//     update here, just as it does against real Redis.
//   * All instances share one store, mirroring many clients over one database —
//     the integration modules each construct their own `new Redis(...)` at
//     module load, and the tests need to see a single consistent view.

interface Entry {
  value: string;
  expiresAt?: number;
}

const store = new Map<string, Entry>();
const hashes = new Map<string, Map<string, string>>();

/** Clears all state. Call in `beforeEach`. */
export function resetFakeRedis(): void {
  store.clear();
  hashes.clear();
}

/** Raw key names currently set — for asserting on namespacing. */
export function fakeRedisKeys(): string[] {
  return [...new Set([...store.keys(), ...hashes.keys()])].sort();
}

/** Yields to the microtask queue so concurrent operations actually interleave. */
function tick(): Promise<void> {
  return Promise.resolve();
}

function isExpired(entry: Entry): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
}

// The real client returns already-parsed values; anything non-JSON comes back
// as the raw string (that's how Upstash treats plain string values).
function decode<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

export class FakeRedis {
  // Accepts and ignores the `{ url, token }` config the real constructor takes.
  constructor(_config?: unknown) {}

  async get<T>(key: string): Promise<T | null> {
    await tick();
    const entry = store.get(key);
    if (!entry) return null;
    if (isExpired(entry)) {
      store.delete(key);
      return null;
    }
    return decode<T>(entry.value);
  }

  // `nx` returns null instead of 'OK' when the key already exists, which is how
  // a single-use claim (an invite token) is settled atomically rather than by a
  // read-then-write that two simultaneous redemptions could both pass.
  async set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
    await tick();
    if (opts?.nx) {
      const existing = store.get(key);
      if (existing && !isExpired(existing)) return null;
    }
    store.set(key, {
      value: JSON.stringify(value),
      expiresAt: opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : undefined,
    });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    await tick();
    let removed = 0;
    for (const key of keys) {
      if (store.delete(key)) removed++;
      if (hashes.delete(key)) removed++;
    }
    return removed;
  }

  async incr(key: string): Promise<number> {
    await tick();
    const current = store.get(key);
    const next = (current && !isExpired(current) ? Number(decode<number>(current.value)) : 0) + 1;
    store.set(key, { value: JSON.stringify(next) });
    return next;
  }

  async hset(key: string, fields: Record<string, unknown>): Promise<number> {
    await tick();
    let hash = hashes.get(key);
    if (!hash) {
      hash = new Map<string, string>();
      hashes.set(key, hash);
    }
    let added = 0;
    for (const [field, value] of Object.entries(fields)) {
      if (!hash.has(field)) added++;
      hash.set(field, JSON.stringify(value));
    }
    return added;
  }

  async hget<T>(key: string, field: string): Promise<T | null> {
    await tick();
    const raw = hashes.get(key)?.get(field);
    return raw === undefined ? null : decode<T>(raw);
  }

  async hgetall<T>(key: string): Promise<Record<string, T> | null> {
    await tick();
    const hash = hashes.get(key);
    if (!hash || hash.size === 0) return null;
    const out: Record<string, T> = {};
    for (const [field, raw] of hash) out[field] = decode<T>(raw);
    return out;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    await tick();
    const hash = hashes.get(key);
    if (!hash) return 0;
    let removed = 0;
    for (const field of fields) {
      if (hash.delete(field)) removed++;
    }
    if (hash.size === 0) hashes.delete(key);
    return removed;
  }

  async keys(pattern: string): Promise<string[]> {
    await tick();
    const rx = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return fakeRedisKeys().filter((k) => rx.test(k));
  }
}
