import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';

// HTTP-level test of the ops console routes added for docs/v2-plan.md §A —
// invites, users, calendar-ready, and the unrecognized/blocked flow. Follows
// the same real-express-session pattern as panel-session-isolation.test.ts:
// ADMIN_USERNAME/ADMIN_PASSWORD are mocked here, not read from a real .env,
// so the admin login flow can be exercised without any live credential.

vi.mock('../env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
    TOKEN_ENCRYPTION_KEY: 'x'.repeat(32),
    BASE_URL: 'https://panel.test',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'test-password',
  },
  whitelistedNumbers: [],
}));

vi.mock('@upstash/redis', async () => {
  const { FakeRedis } = await import('./helpers/fake-redis');
  return { Redis: FakeRedis };
});

vi.mock('../qstash/client', () => ({
  scheduleCron: vi.fn(async (path: string) => `sched_${path}`),
  deleteSchedule: vi.fn(async () => undefined),
  scheduleOnce: vi.fn(async () => 'msg_test'),
  cancelMessage: vi.fn(async () => undefined),
}));

const sendMessageMock = vi.fn(async () => undefined);
vi.mock('../kapso/client', () => ({
  sendMessage: sendMessageMock,
  sendMessageWithId: vi.fn(async () => 'wamid_test'),
}));

import { resetFakeRedis } from './helpers/fake-redis';
import { recordUnrecognizedSender } from '../integrations/local/users';

const CARLA = '+56922222222';

let baseUrl: string;
let server: import('http').Server;

beforeAll(async () => {
  const express = (await import('express')).default;
  const session = (await import('express-session')).default;
  const adminRouter = (await import('../admin/api')).default;
  const registerRouter = (await import('../routes/register')).default;

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
  app.use('/api/admin', adminRouter);
  app.use('/api/register', registerRouter);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetFakeRedis();
  sendMessageMock.mockClear();
});

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error('Response set no cookie');
  return raw.split(';')[0] as string;
}

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }),
  });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

describe('admin login', () => {
  it('rejects the wrong password', async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('refuses ops routes with no session', async () => {
    const res = await fetch(`${baseUrl}/api/admin/invites`);
    expect(res.status).toBe(401);
  });
});

describe('invites', () => {
  it('creates, lists, and lets a real registration redeem one', async () => {
    const cookie = await loginAsAdmin();

    const created = (await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'for Carla' }),
    }).then((r) => r.json())) as { id: string; status: string };
    expect(created.status).toBe('pending');

    const list = (await fetch(`${baseUrl}/api/admin/invites`, { headers: { Cookie: cookie } }).then((r) => r.json())) as Array<{ id: string }>;
    expect(list.map((i) => i.id)).toContain(created.id);

    // The public registration endpoint — no admin session — redeems it.
    const registered = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: created.id, phone: CARLA, name: 'Carla', timezone: 'America/Santiago', consent: true,
      }),
    });
    expect(registered.status).toBe(201);

    const usersAfter = (await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: cookie } }).then((r) => r.json())) as Array<{ id: string; name: string }>;
    expect(usersAfter.some((u) => u.id === CARLA && u.name === 'Carla')).toBe(true);
  });

  it('revokes a pending invite', async () => {
    const cookie = await loginAsAdmin();
    const created = (await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    }).then((r) => r.json())) as { id: string };

    const revoked = await fetch(`${baseUrl}/api/admin/invites/${created.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect(revoked.status).toBe(200);
  });
});

describe('users', () => {
  it('disables and re-enables a user', async () => {
    const cookie = await loginAsAdmin();
    const invite = (await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    }).then((r) => r.json())) as { id: string };
    await fetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invite.id, phone: CARLA, name: 'Carla', timezone: 'UTC', consent: true }),
    });

    const disable = await fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(CARLA)}/status`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'disabled' }),
    });
    expect(disable.status).toBe(200);

    const users = (await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: cookie } }).then((r) => r.json())) as Array<{ id: string; status: string }>;
    expect(users.find((u) => u.id === CARLA)?.status).toBe('disabled');
  });

  it('marks calendar access ready and notifies the user by WhatsApp', async () => {
    const cookie = await loginAsAdmin();
    const invite = (await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    }).then((r) => r.json())) as { id: string };
    await fetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invite.id, phone: CARLA, name: 'Carla', timezone: 'UTC', email: 'carla@example.com', consent: true }),
    });

    const res = await fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(CARLA)}/calendar-ready`, {
      method: 'PATCH', headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { calendarAccess: string } };
    expect(body.user.calendarAccess).toBe('ready');
    expect(sendMessageMock).toHaveBeenCalledWith(CARLA, expect.stringContaining('/panel'));
  });

  it('404s marking calendar ready for a user with no pending request', async () => {
    const cookie = await loginAsAdmin();
    const invite = (await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    }).then((r) => r.json())) as { id: string };
    await fetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invite.id, phone: CARLA, name: 'Carla', timezone: 'UTC', consent: true }), // no email
    });

    const res = await fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(CARLA)}/calendar-ready`, {
      method: 'PATCH', headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe('unrecognized senders and blocking', () => {
  it('blocks an unrecognized sender and moves it off that list', async () => {
    const cookie = await loginAsAdmin();
    await recordUnrecognizedSender('+56988888888');

    const before = (await fetch(`${baseUrl}/api/admin/unrecognized`, { headers: { Cookie: cookie } }).then((r) => r.json())) as Array<{ id: string }>;
    expect(before.map((s) => s.id)).toContain('+56988888888');

    const block = await fetch(`${baseUrl}/api/admin/unrecognized/${encodeURIComponent('+56988888888')}/block`, {
      method: 'POST', headers: { Cookie: cookie },
    });
    expect(block.status).toBe(201);

    const after = (await fetch(`${baseUrl}/api/admin/unrecognized`, { headers: { Cookie: cookie } }).then((r) => r.json())) as Array<{ id: string }>;
    expect(after.map((s) => s.id)).not.toContain('+56988888888');

    const blocked = (await fetch(`${baseUrl}/api/admin/blocked`, { headers: { Cookie: cookie } }).then((r) => r.json())) as Array<{ id: string }>;
    expect(blocked.map((b) => b.id)).toContain('+56988888888');
  });

  it('unblocks a number', async () => {
    const cookie = await loginAsAdmin();
    await fetch(`${baseUrl}/api/admin/unrecognized/${encodeURIComponent('+56988888888')}/block`, { method: 'POST', headers: { Cookie: cookie } });

    const unblock = await fetch(`${baseUrl}/api/admin/blocked/${encodeURIComponent('+56988888888')}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect(unblock.status).toBe(200);

    const blocked = (await fetch(`${baseUrl}/api/admin/blocked`, { headers: { Cookie: cookie } }).then((r) => r.json())) as Array<{ id: string }>;
    expect(blocked.map((b) => b.id)).not.toContain('+56988888888');
  });
});
