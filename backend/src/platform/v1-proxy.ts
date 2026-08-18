import { Request, Response, NextFunction } from 'express';
import { Redis } from '@upstash/redis';
import { env, v1ProxyNumbers } from '../shared/env';
import { pointKey, systemKey } from '../shared/redis/keys';
import type { WebhookRequest } from '../auth/middleware/resolve-sender';

// The v1 proxy shim — docs/v2-plan.md §C.8. Deleted at cutover.
//
// Kapso allows one raw-webhook subscription per phone number, so exactly one
// service is the front door for the shared number. That service is v2: it is
// the codebase under development, and making it the door means v1 needs no
// change at all. Messages from a v1-owned sender are forwarded to v1's webhook
// byte-for-byte and v2 stops; everything else v2 handles itself.
//
// Cutover is removing V1_WEBHOOK_URL from the environment: the shim goes inert
// and v2 starts handling those senders too. No deploy, and the same switch
// rolls back.
//
// Delivery model — the part that is easy to get wrong, and was:
//
// Kapso requires a 200 within 10 seconds and retries three times (+10s, +40s,
// +90s) otherwise. Render's free tier spins v1 down after 15 minutes idle and
// takes 30-60s to spin back up, during which Render's router *holds* the
// inbound request rather than rejecting it or retrying it. Nothing in that
// chain retries the v2 -> v1 hop: whether a forward survives a cold start is
// decided entirely by how long this client is willing to wait.
//
// So the forward cannot happen inside Kapso's 10s window, and it must not be
// abandoned early. v2 therefore acks Kapso immediately and owns the delivery
// from there: claim, record, ack, then forward in the background with a budget
// long enough to ride out the spin-up. Because the ack is unconditional, no
// upstream retry exists as a safety net — the pending record below is it.

const ATTEMPTS = 2;
// Long enough to outlast a Render free-tier spin-up (30-60s documented) with
// margin. The previous value was 10s, which aborted the held request before v1
// finished booting: the spin-up was triggered and the payload discarded, so v1
// came up with nothing to process. Node does not cap this — undici's default
// headers timeout is 300s.
const FORWARD_TIMEOUT_MS = 75_000;
const RETRY_BACKOFF_MS = 2_000;
// Duplicate guard on the message id. Held across the background forward: once
// the ack is sent, a second delivery of the same id genuinely is a duplicate.
const CLAIM_TTL_SEC = 5 * 60;

// Messages acked to Kapso but not yet accepted by v1. The only durable record
// that a delivery is still owed, since acking forfeits Kapso's retries.
const PENDING_KEY = systemKey('v1-pending');
// Past this, v1 has been unreachable for a day and the message is stale enough
// that delivering it would confuse more than help. Dropped loudly.
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PendingForward {
  body: unknown;
  firstSeenAt: number;
}

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis)
    _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

/** True when a sender's messages belong to v1 rather than to v2. */
export function isProxiedToV1(phone: string): boolean {
  return Boolean(env.V1_WEBHOOK_URL) && Boolean(phone) && v1ProxyNumbers.includes(phone);
}

async function postOnce(url: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`v1 responded ${resp.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Forwards the untouched webhook payload to v1. Raw body, not reconstructed
 * fields — v1 parses it with its own `normalizeWebhook()` and must see the same
 * envelope Kapso sent, message id included, or its dedup stops working.
 *
 * Resolves true if v1 accepted it. The second attempt is for a genuine
 * transport glitch (a reset connection, a DNS blip); a cold start is covered by
 * the first attempt's timeout, not by retrying.
 */
export async function forwardToV1(body: unknown): Promise<boolean> {
  const url = env.V1_WEBHOOK_URL;
  if (!url) return false;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await postOnce(url, body);
      return true;
    } catch (err) {
      console.error(`[v1-proxy] forward attempt ${attempt}/${ATTEMPTS} failed:`, err);
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }
  return false;
}

async function savePending(id: string, body: unknown): Promise<void> {
  const entry: PendingForward = { body, firstSeenAt: Date.now() };
  await getRedis().hset(PENDING_KEY, { [id]: entry });
}

async function clearPending(id: string): Promise<void> {
  await getRedis().hdel(PENDING_KEY, id);
}

// Background forwards in flight. Tracked only so tests can await them; nothing
// in production reads this.
const inFlight = new Set<Promise<void>>();

function track(work: Promise<void>): void {
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
}

/** Test seam: resolves once every background forward started so far has settled. */
export async function settleForwards(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

/**
 * Delivers one already-acked message, clearing its pending record on success.
 * A failure deliberately leaves the record in place for `redriveV1Forwards()`.
 */
async function deliver(id: string, body: unknown): Promise<void> {
  let ok = false;
  try {
    ok = await forwardToV1(body);
  } catch (err) {
    console.error(`[v1-proxy] forward threw for ${id}:`, err);
  }
  if (ok) {
    await clearPending(id).catch((err) =>
      console.error(`[v1-proxy] could not clear pending ${id}:`, err)
    );
    return;
  }
  console.error(`[v1-proxy] v1 did not accept ${id}; left pending for the sweeper`);
}

/**
 * Re-drives every message v2 acked but never got into v1 — the safety net for
 * the ack-first model, run once per hourly sweep. Sequential on purpose: these
 * only pile up when v1 is down or cold, and firing them in parallel at a
 * spinning-up instance helps nobody.
 */
export async function redriveV1Forwards(): Promise<{
  delivered: number;
  stillPending: number;
  expired: number;
}> {
  const result = { delivered: 0, stillPending: 0, expired: 0 };
  if (!env.V1_WEBHOOK_URL) return result;

  const pending = await getRedis().hgetall<Record<string, PendingForward>>(PENDING_KEY);
  if (!pending) return result;

  for (const [id, entry] of Object.entries(pending)) {
    if (Date.now() - entry.firstSeenAt > PENDING_MAX_AGE_MS) {
      await clearPending(id);
      result.expired++;
      console.error(`[v1-proxy] dropping ${id}: undelivered to v1 for over 24h`);
      continue;
    }
    if (await forwardToV1(entry.body)) {
      await clearPending(id);
      result.delivered++;
    } else {
      result.stillPending++;
    }
  }
  return result;
}

/**
 * Routes v1-owned senders to v1 and stops; everyone else falls through to v2's
 * own resolution. Must be mounted before `resolveSenderMiddleware`, not inside
 * its unrecognized branch as §C.8 words it: once Santiago's number is also
 * registered in v2 for testing, `resolveSender()` returns `kind: 'user'` and a
 * check placed downstream would never run — v2 would answer and v1 would go
 * silent, which is the failure this whole shim exists to prevent.
 *
 * No message is ever handled by both services: a proxied sender returns here
 * without calling next(), so v2's handlers never see it, and a non-proxied
 * sender is never forwarded, so v1 never sees it.
 */
export async function v1ProxyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const phone = (req as WebhookRequest).senderPhone;
  if (!isProxiedToV1(phone)) {
    next();
    return;
  }

  const messageId = (req as WebhookRequest).messageId;
  const claimKey = messageId ? pointKey('dedup', messageId) : null;

  // Claim before anything else so two concurrent deliveries of the same message
  // can't both reach v1. Fails open on a Redis error: v1 dedups the message id
  // in its own database regardless, so a duplicate forward costs a wasted
  // request, while dropping the message costs the message.
  if (claimKey) {
    let alreadyClaimed = false;
    try {
      const claimed = await getRedis().set(claimKey, Date.now(), { nx: true, ex: CLAIM_TTL_SEC });
      alreadyClaimed = claimed === null;
    } catch (err) {
      console.error('[v1-proxy] dedup claim failed, forwarding anyway:', err);
    }
    if (alreadyClaimed) {
      res.status(200).json({ ok: true, reason: 'proxied-v1-duplicate' });
      return;
    }
  }

  // A message with no id can't be deduped or addressed in the pending hash, so
  // synthesize one. Worst case a redrive delivers it twice and v1's own dedup
  // absorbs the second.
  const pendingId = messageId ?? `noid:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Record before acking, never after: the ack forfeits Kapso's retries, so
  // from that instant this entry is the only thing that knows the message is
  // still owed a delivery.
  await savePending(pendingId, req.body).catch((err) =>
    console.error(`[v1-proxy] could not record pending ${pendingId}:`, err)
  );

  // Ack inside Kapso's 10s window, then take as long as the forward needs.
  res.status(200).json({ ok: true, reason: 'proxied-v1' });

  track(deliver(pendingId, req.body));
}
