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
import {
  createInvite,
  getInvite,
  listInvites,
  revokeInvite,
  redeemInvite,
} from '../auth/invites';

const CARLA = '+56922222222';
const DIEGO = '+56933333333';

beforeEach(resetFakeRedis);

describe('creating invites', () => {
  it('creates a pending invite', async () => {
    const invite = await createInvite('for Carla');
    expect(invite.status).toBe('pending');
    expect(invite.note).toBe('for Carla');
    expect(await getInvite(invite.id)).toEqual(invite);
  });

  it('omits the note when none is given', async () => {
    expect((await createInvite()).note).toBeUndefined();
  });

  it('mints unguessable, unique tokens', async () => {
    const tokens = await Promise.all(Array.from({ length: 50 }, () => createInvite()));
    const ids = tokens.map((t) => t.id);
    expect(new Set(ids).size).toBe(50);
    // base64url of 24 bytes — long enough that guessing is not a threat, and
    // free of characters that would need escaping in a link.
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });

  it('returns null for a token that does not exist', async () => {
    expect(await getInvite('nope')).toBeNull();
    expect(await getInvite('')).toBeNull();
  });

  it('lists invites newest first', async () => {
    const first = await createInvite('first');
    await new Promise((r) => setTimeout(r, 2));
    const second = await createInvite('second');
    expect((await listInvites()).map((i) => i.id)).toEqual([second.id, first.id]);
  });
});

describe('redeeming', () => {
  it('redeems a pending invite and records who used it', async () => {
    const invite = await createInvite();
    const result = await redeemInvite(invite.id, CARLA);

    expect(result.ok).toBe(true);
    const stored = await getInvite(invite.id);
    expect(stored?.status).toBe('redeemed');
    expect(stored?.redeemedBy).toBe(CARLA);
  });

  it('refuses a second use', async () => {
    const invite = await createInvite();
    await redeemInvite(invite.id, CARLA);

    const second = await redeemInvite(invite.id, DIEGO);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toMatch(/already been used/i);
    // The first redeemer keeps it.
    expect((await getInvite(invite.id))?.redeemedBy).toBe(CARLA);
  });

  it('admits exactly one of two simultaneous redemptions', async () => {
    // The reason redemption claims the token with SET NX rather than reading
    // the record and writing it back: both callers would otherwise observe
    // `pending` and both would be admitted on one invite.
    const invite = await createInvite();
    const results = await Promise.all([
      redeemInvite(invite.id, CARLA),
      redeemInvite(invite.id, DIEGO),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it('refuses an unknown token', async () => {
    const result = await redeemInvite('not-a-real-token', CARLA);
    expect(result.ok).toBe(false);
  });

  it('refuses a revoked token', async () => {
    const invite = await createInvite();
    await revokeInvite(invite.id);

    const result = await redeemInvite(invite.id, CARLA);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/revoked/i);
  });
});

describe('revoking', () => {
  it('revokes an unused invite', async () => {
    const invite = await createInvite();
    expect((await revokeInvite(invite.id)).ok).toBe(true);
    expect((await getInvite(invite.id))?.status).toBe('revoked');
  });

  it('is idempotent', async () => {
    const invite = await createInvite();
    await revokeInvite(invite.id);
    expect((await revokeInvite(invite.id)).ok).toBe(true);
  });

  it('will not revoke an invite that was already redeemed', async () => {
    // Revoking after the fact would imply the resulting user is somehow
    // un-admitted, which is not what revocation means — disable the user.
    const invite = await createInvite();
    await redeemInvite(invite.id, CARLA);

    const result = await revokeInvite(invite.id);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already been redeemed/i);
  });

  it('reports an unknown token', async () => {
    expect((await revokeInvite('nope')).ok).toBe(false);
  });
});
