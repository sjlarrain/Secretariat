import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const V1_URL = 'https://secretariat-r2on.onrender.com/webhook/whatsapp';
const SANTIAGO = '+56911111111';
const OTHER_USER = '+56922222222';

// Literals are inlined rather than referencing the consts above: vi.mock
// factories are hoisted above them.
vi.mock('../shared/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
    V1_WEBHOOK_URL: 'https://secretariat-r2on.onrender.com/webhook/whatsapp',
  },
  whitelistedNumbers: ['+56911111111'],
  v1ProxyNumbers: ['+56911111111'],
}));

vi.mock('@upstash/redis', async () => {
  const { FakeRedis } = await import('./helpers/fake-redis');
  return { Redis: FakeRedis };
});

import { resetFakeRedis } from './helpers/fake-redis';
import { v1ProxyMiddleware, isProxiedToV1 } from '../platform/v1-proxy';
import { pointKey } from '../shared/redis/keys';

// A Meta-native webhook envelope, the shape Kapso forwards and v1 parses.
function metaPayload(from: string, messageId: string, body = '/menu') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'PNID' },
              messages: [
                { id: messageId, from: from.replace('+', ''), type: 'text', text: { body } },
              ],
            },
          },
        ],
      },
    ],
  };
}

function mockReq(from: string, messageId: string | null, body: unknown) {
  return { body, senderPhone: from, messageId } as never;
}

function mockRes() {
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(p: unknown) {
      res.payload = p;
      return res;
    },
  };
  return res;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFakeRedis();
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('v1 proxy shim', () => {
  it('recognizes which senders belong to v1', () => {
    expect(isProxiedToV1(SANTIAGO)).toBe(true);
    expect(isProxiedToV1(OTHER_USER)).toBe(false);
    expect(isProxiedToV1('')).toBe(false);
  });

  it('forwards a v1 sender and does not pass the message to v2', async () => {
    const payload = metaPayload(SANTIAGO, 'wamid.1');
    const res = mockRes();
    const next = vi.fn();

    await v1ProxyMiddleware(mockReq(SANTIAGO, 'wamid.1', payload), res as never, next);

    // v2's handlers must never see it — next() is what would hand it onward.
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(V1_URL);
    expect(init.method).toBe('POST');
    // Byte-identical body: v1 re-parses this envelope and dedups on its id.
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('never forwards another user to v1', async () => {
    const res = mockRes();
    const next = vi.fn();

    await v1ProxyMiddleware(
      mockReq(OTHER_USER, 'wamid.2', metaPayload(OTHER_USER, 'wamid.2')),
      res as never,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('forwards a repeated message id only once', async () => {
    const payload = metaPayload(SANTIAGO, 'wamid.dup');
    const next = vi.fn();

    const first = mockRes();
    await v1ProxyMiddleware(mockReq(SANTIAGO, 'wamid.dup', payload), first as never, next);
    const second = mockRes();
    await v1ProxyMiddleware(mockReq(SANTIAGO, 'wamid.dup', payload), second as never, next);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.payload).toEqual({ ok: true, reason: 'proxied-v1' });
    expect(second.payload).toEqual({ ok: true, reason: 'proxied-v1-duplicate' });
    expect(next).not.toHaveBeenCalled();
  });

  it('retries once, then succeeds, without forwarding twice on success', async () => {
    fetchMock
      .mockImplementationOnce(async () => {
        throw new Error('ECONNRESET');
      })
      .mockImplementationOnce(async () => new Response('{}', { status: 200 }));

    const res = mockRes();
    await v1ProxyMiddleware(
      mockReq(SANTIAGO, 'wamid.retry', metaPayload(SANTIAGO, 'wamid.retry')),
      res as never,
      vi.fn()
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
  });

  it('releases the dedup claim and asks Kapso to retry when v1 is unreachable', async () => {
    fetchMock.mockImplementation(async () => new Response('boom', { status: 503 }));

    const res = mockRes();
    await v1ProxyMiddleware(
      mockReq(SANTIAGO, 'wamid.down', metaPayload(SANTIAGO, 'wamid.down')),
      res as never,
      vi.fn()
    );

    expect(res.statusCode).toBe(502);
    // Claim released, so Kapso's retry is not swallowed as a duplicate.
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url: 'x', token: 'y' });
    expect(await redis.get(pointKey('dedup', 'wamid.down'))).toBeNull();
  });

  it('still forwards when the message carries no id', async () => {
    const res = mockRes();
    await v1ProxyMiddleware(mockReq(SANTIAGO, null, metaPayload(SANTIAGO, '')), res as never, vi.fn());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});

describe('v1 proxy shim, disabled (post-cutover)', () => {
  it('is inert with no V1_WEBHOOK_URL, so v2 handles every sender', async () => {
    vi.resetModules();
    vi.doMock('../shared/env', () => ({
      env: {
        UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'fake-token',
      },
      whitelistedNumbers: ['+56911111111'],
      v1ProxyNumbers: ['+56911111111'],
    }));
    const mod = await import('../platform/v1-proxy');
    expect(mod.isProxiedToV1(SANTIAGO)).toBe(false);

    const res = mockRes();
    const next = vi.fn();
    await mod.v1ProxyMiddleware(
      mockReq(SANTIAGO, 'wamid.off', metaPayload(SANTIAGO, 'wamid.off')),
      res as never,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.doUnmock('../shared/env');
  });
});
