import { describe, it, expect, beforeEach, vi } from 'vitest';

// These tests drive the real integration modules — not copies of their logic —
// so they catch a namespacing regression that unit-testing pure helpers cannot.
// Two things have to be stubbed to get there: `env`, which calls
// `process.exit(1)` when credentials are absent, and the Upstash client, which
// each integration constructs at module load.

vi.mock('../env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
    TOKEN_ENCRYPTION_KEY: 'x'.repeat(32),
  },
  whitelistedNumbers: ['56911111111'],
}));

vi.mock('@upstash/redis', async () => {
  const { FakeRedis } = await import('./helpers/fake-redis');
  return { Redis: FakeRedis };
});

import { resetFakeRedis, fakeRedisKeys } from './helpers/fake-redis';
import { addIdea, getIdeas, deleteIdea, getDefaultProject } from '../integrations/local/ideas';
import { getSettings, saveSettings } from '../integrations/token-store';

const ALICE = '56911111111';
const BOB = '56922222222';

beforeEach(resetFakeRedis);

describe('per-user data isolation', () => {
  it('never returns one user\'s ideas to another', async () => {
    const alice = await getDefaultProject(ALICE);
    const bob = await getDefaultProject(BOB);

    await addIdea(ALICE, 'alice private note', alice.id);
    await addIdea(BOB, 'bob private note', bob.id);

    const aliceTexts = (await getIdeas(ALICE)).map((i) => i.text);
    const bobTexts = (await getIdeas(BOB)).map((i) => i.text);

    expect(aliceTexts).toEqual(['alice private note']);
    expect(bobTexts).toEqual(['bob private note']);
    expect(aliceTexts).not.toContain('bob private note');
  });

  it('mints ids independently per user', async () => {
    // Both users' first idea is id 1. That is only safe because the items live
    // under different keys — if the namespacing collapsed, the second write
    // would overwrite the first rather than sitting beside it.
    const alice = await getDefaultProject(ALICE);
    const bob = await getDefaultProject(BOB);

    const aliceIdea = await addIdea(ALICE, 'alice first', alice.id);
    const bobIdea = await addIdea(BOB, 'bob first', bob.id);

    expect(aliceIdea.id).toBe(1);
    expect(bobIdea.id).toBe(1);
    expect(await getIdeas(ALICE)).toHaveLength(1);
    expect(await getIdeas(BOB)).toHaveLength(1);
  });

  it('does not let one user delete another user\'s item', async () => {
    const alice = await getDefaultProject(ALICE);
    await addIdea(ALICE, 'alice keeps this', alice.id);

    // Bob deleting id 1 acts only within his own namespace, where it does not
    // exist. Alice's idea 1 is untouched.
    expect(await deleteIdea(BOB, 1)).toBe(false);
    expect(await getIdeas(ALICE)).toHaveLength(1);
  });

  it('writes every key under the owning user\'s namespace', async () => {
    const alice = await getDefaultProject(ALICE);
    await addIdea(ALICE, 'note', alice.id);

    const keys = fakeRedisKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith(`u:${ALICE}:`)).toBe(true);
    }
    expect(keys.some((k) => k.startsWith(`u:${BOB}:`))).toBe(false);
  });

  it('keeps settings separate per user', async () => {
    const current = await getSettings(ALICE);
    await saveSettings(ALICE, { ...current, timezone: 'America/Santiago' });

    expect((await getSettings(ALICE)).timezone).toBe('America/Santiago');
    expect((await getSettings(BOB)).timezone).toBe('UTC');
  });
});

describe('settings defaults', () => {
  it('defaults an unconfigured user to UTC, not another user\'s zone', async () => {
    // A user who has not set a timezone must not inherit a real person's local
    // time — that would shift their digests and day boundaries with no error.
    expect((await getSettings(BOB)).timezone).toBe('UTC');
  });

  it('forces the reminder promoter on, on read and on write', async () => {
    const current = await getSettings(ALICE);
    // The type forbids `false`, so a hostile/legacy payload has to be cast in.
    await saveSettings(ALICE, {
      ...current,
      reminderPromoter: { ...current.reminderPromoter, enabled: false as unknown as true },
    });
    expect((await getSettings(ALICE)).reminderPromoter.enabled).toBe(true);
  });
});
