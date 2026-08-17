import { describe, it, expect, beforeEach } from 'vitest';
import type { Redis } from '@upstash/redis';
import { HashCollection, byId, byDateField } from '../shared/redis/hash-collection';
import { FakeRedis, resetFakeRedis } from './helpers/fake-redis';

interface Item {
  id: number;
  name: string;
  createdAt: string;
}

const KEY = 'u:56911111111:items';
const SEQ = 'u:56911111111:items:seq';

function collection(): HashCollection<Item> {
  return new HashCollection<Item>(new FakeRedis() as unknown as Redis, KEY, SEQ);
}

function item(id: number, name = `item-${id}`, createdAt = '2026-01-01T00:00:00.000Z'): Item {
  return { id, name, createdAt };
}

beforeEach(resetFakeRedis);

describe('basic operations', () => {
  it('round-trips an item', async () => {
    const c = collection();
    await c.set(item(1, 'first'));
    expect(await c.get(1)).toEqual(item(1, 'first'));
  });

  it('returns null for a missing item', async () => {
    expect(await collection().get(99)).toBeNull();
  });

  it('returns an empty array for an empty collection', async () => {
    // Upstash HGETALL yields null, not {}, for a key that does not exist.
    expect(await collection().getAll()).toEqual([]);
  });

  it('overwrites in place on repeat set', async () => {
    const c = collection();
    await c.set(item(1, 'before'));
    await c.set(item(1, 'after'));
    expect(await c.getAll()).toHaveLength(1);
    expect((await c.get(1))?.name).toBe('after');
  });

  it('reports whether a remove actually deleted something', async () => {
    const c = collection();
    await c.set(item(1));
    expect(await c.remove(1)).toBe(true);
    expect(await c.remove(1)).toBe(false);
    expect(await c.get(1)).toBeNull();
  });
});

describe('ordering', () => {
  it('sorts by numeric id when asked', async () => {
    const c = collection();
    await Promise.all([c.set(item(3)), c.set(item(1)), c.set(item(2))]);
    expect((await c.getAll(byId)).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('sorts by a date field when asked', async () => {
    const c = collection();
    await c.set(item(1, 'late', '2026-03-01T00:00:00.000Z'));
    await c.set(item(2, 'early', '2026-01-01T00:00:00.000Z'));
    expect((await c.getAll(byDateField<Item>('createdAt'))).map((i) => i.name)).toEqual(['early', 'late']);
  });
});

describe('id minting', () => {
  it('increments from 1', async () => {
    const c = collection();
    expect(await c.nextId()).toBe(1);
    expect(await c.nextId()).toBe(2);
  });

  it('throws when the collection has no seq key', async () => {
    const noSeq = new HashCollection<Item>(new FakeRedis() as unknown as Redis, KEY);
    await expect(noSeq.nextId()).rejects.toThrow(/no seqKey/);
  });

  it('continues from a pre-seeded counter', async () => {
    // This is the state a data migration must leave behind: the counter set to
    // the highest id already written. Without it the next mint returns 1 and
    // overwrites a live item.
    const redis = new FakeRedis();
    await redis.set(SEQ, 40);
    const c = new HashCollection<Item>(redis as unknown as Redis, KEY, SEQ);
    expect(await c.nextId()).toBe(41);
  });
});

describe('concurrency', () => {
  // The v1 storage pattern was read-whole-array -> mutate -> write-whole-array.
  // Under interleaved execution the second writer's read predates the first
  // writer's write, so one update is lost with no error. These tests pin the
  // per-field behaviour that replaced it.

  it('keeps every item when writes interleave', async () => {
    const c = collection();
    await Promise.all(Array.from({ length: 25 }, (_, i) => c.set(item(i + 1))));
    expect(await c.getAll()).toHaveLength(25);
  });

  it('does not lose a concurrent write to a different item', async () => {
    const c = collection();
    await Promise.all([c.set(item(1, 'from-cron')), c.set(item(2, 'from-webhook'))]);
    expect((await c.get(1))?.name).toBe('from-cron');
    expect((await c.get(2))?.name).toBe('from-webhook');
  });

  it('does not lose a concurrent write while another item is removed', async () => {
    const c = collection();
    await c.set(item(1));
    await Promise.all([c.remove(1), c.set(item(2, 'survivor'))]);
    expect(await c.get(1)).toBeNull();
    expect((await c.get(2))?.name).toBe('survivor');
  });

  it('mints unique ids under concurrent creates', async () => {
    // The predecessor computed `Math.max(...ids) + 1`, which hands the same id
    // to two simultaneous creates — the second HSET then overwrites the first.
    const c = collection();
    const ids = await Promise.all(Array.from({ length: 25 }, () => c.nextId()));
    expect(new Set(ids).size).toBe(25);
  });
});

describe('serialization', () => {
  it('round-trips values through JSON as the real client does', async () => {
    const c = collection();
    await c.set({ ...item(1), createdAt: new Date('2026-05-05T10:00:00.000Z').toISOString() });
    const stored = await c.get(1);
    expect(typeof stored?.createdAt).toBe('string');
  });

  it('does not share references between writes and reads', async () => {
    const c = collection();
    const original = item(1, 'original');
    await c.set(original);
    original.name = 'mutated-after-write';
    expect((await c.get(1))?.name).toBe('original');
  });
});
