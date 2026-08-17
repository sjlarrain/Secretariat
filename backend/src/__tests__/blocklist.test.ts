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
import { blockSender, unblockSender, isBlocked, getBlockedSenders } from '../auth/blocklist';

const NUISANCE = '+56900000000';

beforeEach(resetFakeRedis);

describe('blocklist', () => {
  it('is not blocked by default', async () => {
    expect(await isBlocked(NUISANCE)).toBe(false);
    expect(await isBlocked('')).toBe(false);
  });

  it('blocks a number', async () => {
    await blockSender(NUISANCE);
    expect(await isBlocked(NUISANCE)).toBe(true);
  });

  it('lists blocked numbers newest first', async () => {
    await blockSender('+56911111112');
    await new Promise((r) => setTimeout(r, 2));
    await blockSender('+56911111113');
    const list = await getBlockedSenders();
    expect(list.map((b) => b.id)).toEqual(['+56911111113', '+56911111112']);
  });

  it('unblocks a number', async () => {
    await blockSender(NUISANCE);
    expect(await unblockSender(NUISANCE)).toBe(true);
    expect(await isBlocked(NUISANCE)).toBe(false);
  });

  it('reports false unblocking a number that was never blocked', async () => {
    expect(await unblockSender(NUISANCE)).toBe(false);
  });
});
