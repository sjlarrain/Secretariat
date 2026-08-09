import { Redis } from '@upstash/redis';

/**
 * Generic per-user hash-backed collection. HSET/HDEL on a single field are
 * each one atomic Redis op, replacing the v1 pattern (read the whole array,
 * mutate it in memory, write the whole array back) that silently drops
 * concurrent writes when two callers touch the same key close together —
 * see docs/v2-inventory.md §2 for which crons/handlers actually collide.
 *
 * Id assignment is atomic too: `nextId()` mints via INCR on a companion
 * `<key>:seq` key instead of the old `Math.max(...ids) + 1` scan, which was
 * itself a lost-update hazard (two concurrent creates could compute the same
 * "next" id).
 */
export class HashCollection<T extends { id: number | string }> {
  constructor(
    private redis: Redis,
    private key: string,
    private seqKey?: string, // omit for collections whose ids are supplied externally (UUIDs, phone numbers, etc.)
  ) {}

  /**
   * Returns every item in the collection. `compare`, if given, sorts the
   * result (HGETALL order is not guaranteed to be insertion order); omit it
   * for collections where display order doesn't matter.
   */
  async getAll(compare?: (a: T, b: T) => number): Promise<T[]> {
    const raw = await this.redis.hgetall<Record<string, T>>(this.key);
    const items = raw ? Object.values(raw) : [];
    return compare ? items.sort(compare) : items;
  }

  async get(id: T['id']): Promise<T | null> {
    const item = await this.redis.hget<T>(this.key, String(id));
    return item ?? null;
  }

  /** Insert or overwrite a single item — one atomic HSET. */
  async set(item: T): Promise<void> {
    await this.redis.hset(this.key, { [String(item.id)]: item });
  }

  /** Delete a single item — one atomic HDEL. Returns true if it existed. */
  async remove(id: T['id']): Promise<boolean> {
    const removed = await this.redis.hdel(this.key, String(id));
    return removed > 0;
  }

  /** Mints the next numeric id atomically via INCR. Requires a seqKey. */
  async nextId(): Promise<number> {
    if (!this.seqKey) throw new Error(`HashCollection for "${this.key}" has no seqKey configured`);
    return this.redis.incr(this.seqKey);
  }
}

/** Ascending numeric-id comparator for `getAll()`. */
export function byId<T extends { id: number }>(a: T, b: T): number {
  return a.id - b.id;
}

/** Ascending ISO-string date-field comparator for `getAll()`. */
export function byDateField<T>(field: keyof T) {
  return (a: T, b: T): number =>
    new Date(a[field] as unknown as string).getTime() - new Date(b[field] as unknown as string).getTime();
}
