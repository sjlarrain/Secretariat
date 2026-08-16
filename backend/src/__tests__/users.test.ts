import { describe, it, expect, beforeEach, vi } from 'vitest';

// WHITELISTED_NUMBERS still matters: it is the legacy fallback that keeps the
// bot answering its existing owner while the registry is empty. ALICE below is
// deliberately the whitelisted number so both paths can be exercised.
vi.mock('../env', () => ({
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

import { resetFakeRedis, fakeRedisKeys } from './helpers/fake-redis';
import {
  registerUser,
  getRegisteredUser,
  getRegisteredUsers,
  setUserStatus,
  resolveSender,
  recordUnrecognizedSender,
  getUnrecognizedSenders,
} from '../integrations/local/users';

const OWNER = '+56911111111'; // in WHITELISTED_NUMBERS
const CARLA = '+56922222222';
const STRANGER = '+56999999999';

beforeEach(resetFakeRedis);

describe('registry', () => {
  it('registers a user as active', async () => {
    const user = await registerUser({ name: 'Carla', phone: CARLA, timezone: 'America/Santiago' });
    expect(user.id).toBe(CARLA);
    expect(user.status).toBe('active');
    expect(await getRegisteredUser(CARLA)).toEqual(user);
  });

  it('omits email when none was given', async () => {
    const user = await registerUser({ name: 'Carla', phone: CARLA, timezone: 'UTC' });
    expect(user.email).toBeUndefined();
  });

  it('returns null for a number that was never registered', async () => {
    expect(await getRegisteredUser(STRANGER)).toBeNull();
  });

  it('keeps users separate rather than overwriting', async () => {
    await registerUser({ name: 'Carla', phone: CARLA, timezone: 'UTC' });
    await registerUser({ name: 'Diego', phone: STRANGER, timezone: 'Europe/Madrid' });
    expect(await getRegisteredUsers()).toHaveLength(2);
  });

  it('stores the registry outside any user namespace', async () => {
    await registerUser({ name: 'Carla', phone: CARLA, timezone: 'UTC' });
    expect(fakeRedisKeys()).toContain('sys:users');
    // The registry is platform state; it must not land inside someone's data.
    expect(fakeRedisKeys().some((k) => k.startsWith('u:'))).toBe(false);
  });
});

describe('resolveSender', () => {
  it('resolves a registered active user', async () => {
    await registerUser({ name: 'Carla', phone: CARLA, timezone: 'America/Santiago' });
    const resolved = await resolveSender(CARLA);
    expect(resolved.kind).toBe('user');
    expect(resolved.kind === 'user' && resolved.user.name).toBe('Carla');
  });

  it('reports a disabled user distinctly from an unknown one', async () => {
    await registerUser({ name: 'Carla', phone: CARLA, timezone: 'UTC' });
    expect(await setUserStatus(CARLA, 'disabled')).toBe(true);

    const resolved = await resolveSender(CARLA);
    // The distinction matters: a disabled user is silently ignored, but must
    // not be logged as an unrecognized sender for the operator to chase.
    expect(resolved.kind).toBe('disabled');
  });

  it('re-enables a disabled user', async () => {
    await registerUser({ name: 'Carla', phone: CARLA, timezone: 'UTC' });
    await setUserStatus(CARLA, 'disabled');
    await setUserStatus(CARLA, 'active');
    expect((await resolveSender(CARLA)).kind).toBe('user');
  });

  it('will not set a status on a number that is not registered', async () => {
    expect(await setUserStatus(STRANGER, 'disabled')).toBe(false);
  });

  it('treats an unknown number as unknown', async () => {
    expect((await resolveSender(STRANGER)).kind).toBe('unknown');
  });

  it('treats an empty phone as unknown', async () => {
    expect((await resolveSender('')).kind).toBe('unknown');
  });

  it('falls back to the env whitelist so an empty registry does not lock the owner out', async () => {
    // The registry starts empty on a fresh v2 database and registration does
    // not exist yet. Without this fallback, deploying the registry would leave
    // nobody — including the owner — able to use the bot.
    const resolved = await resolveSender(OWNER);
    expect(resolved.kind).toBe('user');
    expect(resolved.kind === 'user' && resolved.user.id).toBe(OWNER);
  });

  it('does not persist the synthesized legacy owner', async () => {
    await resolveSender(OWNER);
    expect(await getRegisteredUser(OWNER)).toBeNull();
  });

  it('prefers a real registry entry over the whitelist fallback', async () => {
    await registerUser({ name: 'Santiago', phone: OWNER, timezone: 'America/Santiago' });
    const resolved = await resolveSender(OWNER);
    expect(resolved.kind === 'user' && resolved.user.name).toBe('Santiago');
  });

  it('lets a disabled registry entry override the whitelist', async () => {
    // Otherwise disabling the owner would silently do nothing, since the env
    // var would keep letting them through.
    await registerUser({ name: 'Santiago', phone: OWNER, timezone: 'UTC' });
    await setUserStatus(OWNER, 'disabled');
    expect((await resolveSender(OWNER)).kind).toBe('disabled');
  });
});

describe('unrecognized senders', () => {
  it('records a first sighting', async () => {
    await recordUnrecognizedSender(STRANGER);
    const [entry] = await getUnrecognizedSenders();
    expect(entry.id).toBe(STRANGER);
    expect(entry.messageCount).toBe(1);
  });

  it('counts repeat messages without duplicating the entry', async () => {
    await recordUnrecognizedSender(STRANGER);
    await recordUnrecognizedSender(STRANGER);
    await recordUnrecognizedSender(STRANGER);

    const entries = await getUnrecognizedSenders();
    expect(entries).toHaveLength(1);
    expect(entries[0].messageCount).toBe(3);
    expect(entries[0].firstSeenAt <= entries[0].lastSeenAt).toBe(true);
  });

  it('clears the record once the number registers', async () => {
    await recordUnrecognizedSender(CARLA);
    await registerUser({ name: 'Carla', phone: CARLA, timezone: 'UTC' });
    expect(await getUnrecognizedSenders()).toHaveLength(0);
  });
});
