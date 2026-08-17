import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';

// This is the one test file in the suite that goes all the way through real
// HTTP + real express-session cookies rather than calling integration
// functions directly. That's deliberate: docs/v2-plan.md's Goal 2 verify
// condition is specifically that "a session for user A cannot read user B's
// data", which is a claim about the session/cookie layer, not just about
// storage-level namespacing (isolation.test.ts already covers that layer).
// No new dependency is added to get there — express, express-session and
// Node's built-in http/fetch are already in package.json.

vi.mock('../shared/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
    TOKEN_ENCRYPTION_KEY: 'x'.repeat(32),
    BASE_URL: 'https://panel.test',
  },
  whitelistedNumbers: [],
}));

vi.mock('@upstash/redis', async () => {
  const { FakeRedis } = await import('./helpers/fake-redis');
  return { Redis: FakeRedis };
});

// user-api.ts imports scheduleOnce/cancelMessage at module load time, which
// would otherwise construct a real QStash client requiring QSTASH_TOKEN.
// Stubbed so this test never touches the network.
vi.mock('../shared/qstash/client', () => ({
  scheduleOnce: vi.fn(async () => 'msg_test'),
  cancelMessage: vi.fn(async () => undefined),
}));

import { resetFakeRedis } from './helpers/fake-redis';
import { registerUser } from '../auth/users';
import { createPanelLoginToken } from '../auth/panel-sessions';

const ALICE = '+56922222222';
const BOB = '+56933333333';

let baseUrl: string;
let server: import('http').Server;

beforeAll(async () => {
  // Imported after the mocks above are registered, and only once — these
  // modules build their Redis/QStash clients at import time.
  const express = (await import('express')).default;
  const session = (await import('express-session')).default;
  const panelRouter = (await import('../platform/routes/panel')).default;
  const userApiRouter = (await import('../platform/routes/user-api')).default;

  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    })
  );
  app.use('/panel', panelRouter);
  app.use('/api/user', userApiRouter);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(resetFakeRedis);

/** Extracts just the cookie pair (name=value), dropping Path/HttpOnly etc. */
function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error('Response set no cookie');
  return raw.split(';')[0] as string;
}

/** Registers a user and exchanges a fresh one-time token for a session cookie. */
async function signInAs(phone: string, name: string): Promise<string> {
  await registerUser({ phone, name, timezone: 'UTC' });
  const token = await createPanelLoginToken(phone);
  const res = await fetch(`${baseUrl}/panel/login/${token}`, { method: 'POST' });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

describe('panel session isolation', () => {
  it("does not let user A's session read user B's profile", async () => {
    const aliceCookie = await signInAs(ALICE, 'Alice');
    const bobCookie = await signInAs(BOB, 'Bob');

    const aliceMe = (await fetch(`${baseUrl}/api/user/me`, { headers: { Cookie: aliceCookie } }).then((r) => r.json())) as { name: string };
    const bobMe = (await fetch(`${baseUrl}/api/user/me`, { headers: { Cookie: bobCookie } }).then((r) => r.json())) as { name: string };

    expect(aliceMe.name).toBe('Alice');
    expect(bobMe.name).toBe('Bob');
  });

  it("does not let user A's session read or overwrite user B's settings, even if B's id is put in the request body", async () => {
    const aliceCookie = await signInAs(ALICE, 'Alice');
    const bobCookie = await signInAs(BOB, 'Bob');

    // Bob sets his own timezone.
    const bobPut = (await fetch(`${baseUrl}/api/user/settings`, {
      method: 'PUT',
      headers: { Cookie: bobCookie, 'Content-Type': 'application/json' },
      // Smuggling Alice's phone number in the body has no effect: the route
      // never reads a userId from the body, only from req.userCtx (session).
      body: JSON.stringify({ timezone: 'America/Santiago', userId: ALICE }),
    }).then((r) => r.json())) as { ok: boolean; settings: { timezone: string } };
    expect(bobPut.ok).toBe(true);
    expect(bobPut.settings.timezone).toBe('America/Santiago');

    // Alice's own settings, read back on Alice's own session, are untouched.
    const aliceSettings = (await fetch(`${baseUrl}/api/user/settings`, { headers: { Cookie: aliceCookie } }).then((r) => r.json())) as { timezone: string };
    expect(aliceSettings.timezone).toBe('UTC');
  });

  it('refuses a request with no session', async () => {
    const res = await fetch(`${baseUrl}/api/user/me`);
    expect(res.status).toBe(401);
  });

  it('refuses a cookie that never authenticated', async () => {
    const res = await fetch(`${baseUrl}/api/user/me`, {
      headers: { Cookie: 'connect.sid=s%3Aforged.invalidsignature' },
    });
    expect(res.status).toBe(401);
  });
});
