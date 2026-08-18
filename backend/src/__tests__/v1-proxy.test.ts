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
import {
  v1ProxyMiddleware,
  isProxiedToV1,
  redriveV1Forwards,
  settleForwards,
} from '../platform/v1-proxy';
import { pointKey, systemKey } from '../shared/redis/keys';

// Kapso's own deadline. Nothing in the proxy may hold the response past this,
// and — the bug this file now guards — nothing may abort the forward at it.
const KAPSO_ACK_DEADLINE_MS = 10_000;

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

/**
 * A fetch that does not answer for `delayMs`, honouring the abort signal —
 * i.e. what Render's router does while it spins a free-tier instance back up:
 * it holds the request open instead of failing it, and only the caller's own
 * timeout decides whether the message survives.
 */
function heldFetch(delayMs: number, status = 200) {
  return (_url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('{}', { status })), delayMs);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      });
    });
}

async function readPending(): Promise<Record<string, { firstSeenAt: number }> | null> {
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: 'x', token: 'y' });
  return redis.hgetall(systemKey('v1-pending'));
}

async function writePending(id: string, body: unknown, firstSeenAt: number): Promise<void> {
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: 'x', token: 'y' });
  await redis.hset(systemKey('v1-pending'), { [id]: { body, firstSeenAt } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFakeRedis();
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
    await settleForwards();

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
    await settleForwards();
    const second = mockRes();
    await v1ProxyMiddleware(mockReq(SANTIAGO, 'wamid.dup', payload), second as never, next);
    await settleForwards();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.payload).toEqual({ ok: true, reason: 'proxied-v1' });
    expect(second.payload).toEqual({ ok: true, reason: 'proxied-v1-duplicate' });
    expect(next).not.toHaveBeenCalled();
  });

  it('retries once, then succeeds, without forwarding twice on success', async () => {
    vi.useFakeTimers();
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
    // Clear the inter-attempt backoff.
    await vi.advanceTimersByTimeAsync(6_000);
    await settleForwards();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
  });

  it('still forwards when the message carries no id', async () => {
    const res = mockRes();
    await v1ProxyMiddleware(mockReq(SANTIAGO, null, metaPayload(SANTIAGO, '')), res as never, vi.fn());
    await settleForwards();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});

// The regression this file exists for. v1 runs on Render's free tier: after 15
// minutes idle it spins down, and the next request is *held* by Render's router
// for 30-60s while the instance boots — never rejected, never retried. The
// proxy used to abort that held request after 10s and answer 502, which meant
// every first message after an idle period woke v1 up and was then discarded,
// with no layer above retrying into it.
describe('v1 proxy shim, cold-start delivery', () => {
  it('acks Kapso before the forward has completed, with the message recorded', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(heldFetch(40_000));

    const res = mockRes();
    await v1ProxyMiddleware(
      mockReq(SANTIAGO, 'wamid.cold', metaPayload(SANTIAGO, 'wamid.cold')),
      res as never,
      vi.fn()
    );

    // Acked while v1 is still booting — Kapso's 10s deadline is met regardless
    // of how long the forward ends up taking.
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, reason: 'proxied-v1' });
    // ...and recorded *before* the ack, since the ack forfeits Kapso's retries.
    expect(await readPending()).toHaveProperty('wamid.cold');

    await vi.advanceTimersByTimeAsync(45_000);
    await settleForwards();
  });

  it('does not abort the held request at Kapso\'s 10s deadline', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(heldFetch(40_000));

    await v1ProxyMiddleware(
      mockReq(SANTIAGO, 'wamid.hold', metaPayload(SANTIAGO, 'wamid.hold')),
      mockRes() as never,
      vi.fn()
    );

    await vi.advanceTimersByTimeAsync(KAPSO_ACK_DEADLINE_MS + 1_000);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The old budget aborted here, dropping the request Render was holding.
    expect(init.signal?.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(45_000);
    await settleForwards();
  });

  it('completes a forward that outlasts a full cold start, and clears it', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(heldFetch(40_000));

    const res = mockRes();
    await v1ProxyMiddleware(
      mockReq(SANTIAGO, 'wamid.slow', metaPayload(SANTIAGO, 'wamid.slow')),
      res as never,
      vi.fn()
    );

    await vi.advanceTimersByTimeAsync(40_000);
    await settleForwards();

    // One attempt, no abort, and v1 got it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    // Delivered, so nothing is owed any more.
    expect(await readPending()).toBeNull();
  });

  it('swallows a second delivery that arrives while the first forward is in flight', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(heldFetch(40_000));
    const payload = metaPayload(SANTIAGO, 'wamid.inflight');

    const first = mockRes();
    await v1ProxyMiddleware(mockReq(SANTIAGO, 'wamid.inflight', payload), first as never, vi.fn());

    // A redelivery landing mid-forward must not start a second one.
    await vi.advanceTimersByTimeAsync(KAPSO_ACK_DEADLINE_MS);
    const second = mockRes();
    await v1ProxyMiddleware(mockReq(SANTIAGO, 'wamid.inflight', payload), second as never, vi.fn());

    expect(second.payload).toEqual({ ok: true, reason: 'proxied-v1-duplicate' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(45_000);
    await settleForwards();
  });

  it('keeps retrying a cold start that answers 502 immediately instead of holding', async () => {
    vi.useFakeTimers();
    // Render's router can reject outright while the instance boots rather than
    // holding the connection. These fail in milliseconds, so the forward budget
    // never comes into play — only trying again later gets the message across.
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls++;
      if (calls <= 3) return new Response('service unavailable', { status: 502 });
      return new Response('{}', { status: 200 });
    });

    const res = mockRes();
    await v1ProxyMiddleware(
      mockReq(SANTIAGO, 'wamid.fast502', metaPayload(SANTIAGO, 'wamid.fast502')),
      res as never,
      vi.fn()
    );

    // Nothing has got through yet, but Kapso was already told 200.
    expect(res.statusCode).toBe(200);

    // Walk the retry ladder past a ~50s spin-up.
    await vi.advanceTimersByTimeAsync(60_000);
    await settleForwards();

    expect(calls).toBe(4);
    // v1 came up and accepted it, so nothing is owed.
    expect(await readPending()).toBeNull();
  });

  it('keeps the message pending when v1 never answers, and still acks 200', async () => {
    vi.useFakeTimers();
    // Held forever: v1 is down, not merely cold.
    fetchMock.mockImplementation(heldFetch(10 * 60_000));

    const res = mockRes();
    await v1ProxyMiddleware(
      mockReq(SANTIAGO, 'wamid.down', metaPayload(SANTIAGO, 'wamid.down')),
      res as never,
      vi.fn()
    );

    // Attempts stack up against the 75s budget until the overall deadline
    // (~238s). Deliberately short of CLAIM_TTL_SEC so the claim assertion below
    // tests the code rather than the clock.
    await vi.advanceTimersByTimeAsync(250_000);
    await settleForwards();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    // Kapso was told 200 up front and will not retry — so the record has to
    // survive for the sweeper.
    expect(res.statusCode).toBe(200);
    expect(await readPending()).toHaveProperty('wamid.down');
    // The dedup claim stays put: a redelivery is a duplicate, not a rescue.
    const { Redis } = await import('@upstash/redis');
    expect(await new Redis({ url: 'x', token: 'y' }).get(pointKey('dedup', 'wamid.down'))).not.toBeNull();
  });
});

describe('v1 forward redrive', () => {
  it('delivers a stranded message and clears its record', async () => {
    const payload = metaPayload(SANTIAGO, 'wamid.stranded');
    await writePending('wamid.stranded', payload, Date.now() - 60_000);

    const result = await redriveV1Forwards();

    expect(result).toEqual({ delivered: 1, stillPending: 0, expired: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual(payload);
    expect(await readPending()).toBeNull();
  });

  it('leaves it pending when v1 is still unreachable', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response('boom', { status: 503 }));
    await writePending('wamid.again', metaPayload(SANTIAGO, 'wamid.again'), Date.now() - 60_000);

    const run = redriveV1Forwards();
    await vi.advanceTimersByTimeAsync(200_000);
    const result = await run;

    expect(result).toEqual({ delivered: 0, stillPending: 1, expired: 0 });
    expect(await readPending()).toHaveProperty('wamid.again');
  });

  it('drops a record older than 24h without forwarding it', async () => {
    await writePending(
      'wamid.ancient',
      metaPayload(SANTIAGO, 'wamid.ancient'),
      Date.now() - 25 * 60 * 60 * 1000
    );

    const result = await redriveV1Forwards();

    expect(result).toEqual({ delivered: 0, stillPending: 0, expired: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readPending()).toBeNull();
  });

  it('is a no-op with nothing pending', async () => {
    expect(await redriveV1Forwards()).toEqual({ delivered: 0, stillPending: 0, expired: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
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

    // The redrive goes quiet too, rather than replaying a backlog into a
    // service that is no longer the destination.
    await writePending('wamid.leftover', metaPayload(SANTIAGO, 'wamid.leftover'), Date.now());
    expect(await mod.redriveV1Forwards()).toEqual({
      delivered: 0,
      stillPending: 0,
      expired: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.doUnmock('../shared/env');
  });
});
