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
// Delivery model — the part that is easy to get wrong, and was, twice:
//
// Kapso requires a 200 within 10 seconds and retries three times (+10s, +40s,
// +90s) otherwise. Render's free tier spins v1 down after 15 minutes idle and
// takes 30-60s to spin back up. Nothing in that chain retries the v2 -> v1 hop,
// so this module is solely responsible for getting the message across.
//
// The forward therefore cannot happen inside Kapso's 10s window. v2 acks Kapso
// immediately and owns delivery from there: claim, record, ack, then forward in
// the background, waiting out the spin-up *and* retrying through it — see the
// two cold-start shapes documented on the constants below. Because the ack is
// unconditional, no upstream retry exists as a safety net; the pending record
// is it.

// A Render free-tier cold start can present in two completely different ways,
// and a forward has to survive both. Fixing only one is why this took two goes:
//
//   * The router HOLDS the request open for the 30-60s spin-up and answers once
//     the instance is live. Nothing fails; the caller just has to wait. Covered
//     by FORWARD_TIMEOUT_MS — the original 10s value aborted the held request,
//     so the spin-up was triggered and the payload thrown away.
//   * The router answers 502/503 IMMEDIATELY while the instance boots. No
//     timeout is involved at all: the call fails in milliseconds and the only
//     thing that helps is trying again later. Covered by RETRY_DELAYS_MS — the
//     original 2-attempt/2s ladder gave up ~2s into a ~50s boot.
//
// Nothing upstream retries the v2 -> v1 hop, so this ladder is the retry.
const FORWARD_TIMEOUT_MS = 75_000;
// Three retries at 10s / 40s / 90s — the same ladder Kapso uses on its own
// webhook deliveries, so the two layers behave alike and there is one schedule
// to reason about. Four attempts spanning 140s, which still clears a 30-60s
// spin-up twice over.
const RETRY_DELAYS_MS = [10_000, 40_000, 90_000];
// Overall ceiling, so a hold-then-timeout v1 can't stack 75s attempts for ten
// minutes. Past this the message stays in sys:v1-pending for the sweeper. Set
// above the 140s the ladder spans, so it only ever truncates the slow-timeout
// case and never cuts the retry schedule short when v1 is failing fast.
const FORWARD_DEADLINE_MS = 180_000;
// Duplicate guard on the message id. Held across the background forward: once
// the ack is sent, a second delivery of the same id genuinely is a duplicate.
const CLAIM_TTL_SEC = 5 * 60;

// Messages acked to Kapso but not yet accepted by v1. The only durable record
// that a delivery is still owed, since acking forfeits Kapso's retries.
const PENDING_KEY = systemKey('v1-pending');
// Past this, v1 has been unreachable for a day and the message is stale enough
// that delivering it would confuse more than help. Dropped loudly.
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Ceiling on how many stranded messages one sweep will replay.
const REDRIVE_MAX_PER_SWEEP = 20;

interface PendingForward {
  body: unknown;
  firstSeenAt: number;
}

/** Result of one forward. `rateLimited` is why the batch should stop, not just this message. */
export interface ForwardOutcome {
  delivered: boolean;
  rateLimited: boolean;
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

/** Carries v1's status code so `isRetryable` can act on it. */
class ForwardError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/**
 * Whether another attempt could plausibly succeed.
 *
 * 429 is the one that matters most here: it means the far side is already
 * refusing volume, so retrying is not just useless but actively harmful — it is
 * what keeps the limit tripped. Same reasoning as `shared/kapso/client.ts`,
 * except there 429 is retryable because Kapso rate-limits per-second bursts;
 * a 429 from v1's edge is a block, not a speed bump.
 *
 * A 404 (wrong V1_WEBHOOK_URL) will never succeed either, and failing fast
 * surfaces the misconfiguration instead of burying it under four identical
 * errors.
 */
function isRetryable(err: unknown): boolean {
  const status = err instanceof ForwardError ? err.status : undefined;
  if (status === undefined) return true; // timeout, abort, DNS, connection reset
  if (status === 408) return true;
  if (status === 429) return false;
  return status >= 500;
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
    if (!resp.ok) throw new ForwardError(`v1 responded ${resp.status}`, resp.status);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Forwards the untouched webhook payload to v1. Raw body, not reconstructed
 * fields — v1 parses it with its own `normalizeWebhook()` and must see the same
 * envelope Kapso sent, message id included, or its dedup stops working.
 *
 * Keeps trying across the whole cold-start window: a fast 502 from Render's
 * router means "still booting", not "no". A 429 means the opposite and stops
 * the ladder dead.
 */
export async function forwardToV1(body: unknown): Promise<ForwardOutcome> {
  const url = env.V1_WEBHOOK_URL;
  if (!url) return { delivered: false, rateLimited: false };

  const startedAt = Date.now();
  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  let rateLimited = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await postOnce(url, body);
      return { delivered: true, rateLimited: false };
    } catch (err) {
      // The status is in the message ("v1 responded 404"), which is how a
      // misconfigured V1_WEBHOOK_URL announces itself rather than looking like
      // a cold start.
      console.error(`[v1-proxy] forward attempt ${attempt}/${maxAttempts} failed:`, err);
      rateLimited = err instanceof ForwardError && err.status === 429;
      if (!isRetryable(err)) {
        console.error('[v1-proxy] not retryable; abandoning this forward');
        break;
      }
    }
    if (attempt === maxAttempts) break;

    const delay = RETRY_DELAYS_MS[attempt - 1];
    if (Date.now() - startedAt + delay > FORWARD_DEADLINE_MS) {
      console.error(`[v1-proxy] forward deadline reached after ${attempt} attempts`);
      break;
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  return { delivered: false, rateLimited };
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
    ok = (await forwardToV1(body)).delivered;
  } catch (err) {
    console.error(`[v1-proxy] forward threw for ${id}:`, err);
  }
  if (ok) {
    console.log(`[v1-proxy] v1 accepted ${id}`);
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
 *
 * Known and accepted: this can deliver a message to v1 twice. v1's dedup
 * (`secretariat:dedup:<id>`) has a 5-minute TTL, and a redrive lands up to an
 * hour later, so it does *not* cover a replay. The case is narrow — a forward
 * only lands here after v1 failed to answer within `FORWARD_TIMEOUT_MS` twice,
 * and a duplicate needs v1 to have actually processed the message and merely
 * been slow to say so — but when it happens the user sees a doubled reply, or a
 * reminder created twice. That is the deliberate trade: this whole module exists
 * because the previous design lost messages silently, and a visible duplicate is
 * the better failure. Do not "fix" it by dropping the redrive.
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

  const entries = Object.entries(pending);
  // A backlog that never drains would otherwise be replayed in full every hour,
  // each entry walking the whole retry ladder — backlog x 4 requests an hour at
  // a service that is already refusing them. That pressure keeps a rate limit
  // tripped and grows the backlog that causes it. Cap the batch; the rest keep
  // their place and go next sweep.
  const batch = entries.slice(0, REDRIVE_MAX_PER_SWEEP);
  result.stillPending = entries.length - batch.length;

  for (let i = 0; i < batch.length; i++) {
    const [id, entry] = batch[i];
    if (Date.now() - entry.firstSeenAt > PENDING_MAX_AGE_MS) {
      await clearPending(id);
      result.expired++;
      console.error(`[v1-proxy] dropping ${id}: undelivered to v1 for over 24h`);
      continue;
    }
    const outcome = await forwardToV1(entry.body);
    if (outcome.delivered) {
      await clearPending(id);
      result.delivered++;
      continue;
    }
    result.stillPending++;
    if (outcome.rateLimited) {
      // v1 is refusing volume. Every remaining entry would get the same answer,
      // and sending them is what sustains the limit. Stop; try next sweep.
      const skipped = batch.length - i - 1;
      result.stillPending += skipped;
      console.error(
        `[v1-proxy] v1 is rate limiting; abandoning ${skipped} more in this redrive`
      );
      break;
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
    // While the shim is live, a v1-owned sender falling through to v2 is the
    // failure this module exists to prevent, and it is otherwise invisible —
    // v2 just silently declines to answer. Print what was compared against what.
    if (env.V1_WEBHOOK_URL && phone) {
      console.log(
        `[v1-proxy] not proxying ${phone}; V1_PROXY_NUMBERS=[${v1ProxyNumbers.join(', ')}]`
      );
    }
    next();
    return;
  }

  console.log(`[v1-proxy] routing ${phone} to ${env.V1_WEBHOOK_URL}`);

  const messageId = (req as WebhookRequest).messageId;
  const claimKey = messageId ? pointKey('dedup', messageId) : null;

  // Claim before anything else so two concurrent deliveries of the same message
  // can't both reach v1. Fails open on a Redis error: concurrent deliveries land
  // seconds apart, comfortably inside v1's own 5-minute dedup window, so a
  // duplicate forward costs a wasted request while dropping the message costs
  // the message. (That window is why this is safe here and not in the redrive.)
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
  // synthesize one. This is only a handle for our own bookkeeping — v1 still
  // dedups on whatever id is inside the payload, so a synthesized key never
  // makes a replay more likely than the redrive already does (see
  // `redriveV1Forwards`).
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
