import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../shared/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
    TOKEN_ENCRYPTION_KEY: 'x'.repeat(32),
  },
  whitelistedNumbers: ['+56911111111'],
}));

vi.mock('@upstash/redis', async () => {
  const { FakeRedis } = await import('./helpers/fake-redis');
  return { Redis: FakeRedis };
});

import { resetFakeRedis } from './helpers/fake-redis';
import { createPanelLoginToken, consumePanelLoginToken } from '../auth/panel-sessions';

const ALICE = '+56922222222';
const BOB = '+56933333333';

beforeEach(resetFakeRedis);

describe('minting', () => {
  it('mints unguessable, unique tokens', async () => {
    const tokens = await Promise.all(Array.from({ length: 50 }, () => createPanelLoginToken(ALICE)));
    expect(new Set(tokens).size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });
});

describe('consuming', () => {
  it('resolves to the userId it was minted for', async () => {
    const token = await createPanelLoginToken(ALICE);
    expect(await consumePanelLoginToken(token)).toBe(ALICE);
  });

  it('is single-use — a second consumption fails', async () => {
    const token = await createPanelLoginToken(ALICE);
    await consumePanelLoginToken(token);
    expect(await consumePanelLoginToken(token)).toBeNull();
  });

  it('refuses an unknown token', async () => {
    expect(await consumePanelLoginToken('not-a-real-token')).toBeNull();
    expect(await consumePanelLoginToken('')).toBeNull();
  });

  it('admits exactly one of two simultaneous consumptions', async () => {
    // Same reasoning as invite redemption: the claim key is a SET NX, settled
    // before either caller reads the token's owner, so a retried request
    // can't establish two sessions off one link.
    const token = await createPanelLoginToken(ALICE);
    const results = await Promise.all([consumePanelLoginToken(token), consumePanelLoginToken(token)]);
    expect(results.filter((r) => r === ALICE)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  it('keeps tokens for different users independent', async () => {
    const aliceToken = await createPanelLoginToken(ALICE);
    const bobToken = await createPanelLoginToken(BOB);

    expect(await consumePanelLoginToken(aliceToken)).toBe(ALICE);
    expect(await consumePanelLoginToken(bobToken)).toBe(BOB);
  });
});
