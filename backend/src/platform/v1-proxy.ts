import { Request, Response, NextFunction } from 'express';
import { Redis } from '@upstash/redis';
import { env, v1ProxyNumbers } from '../shared/env';
import { pointKey } from '../shared/redis/keys';
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

const ATTEMPTS = 2;
const ATTEMPT_TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 2_000;
// Matches the webhook's own dedup window: both guard the same Kapso retry
// schedule (10s/40s/90s), so a shorter TTL here would let a late retry through.
const CLAIM_TTL_SEC = 5 * 60;

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
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
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
 * Resolves true if v1 accepted it.
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

  // Claim before forwarding so two concurrent deliveries of the same message
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

  const delivered = await forwardToV1(req.body);
  if (delivered) {
    res.status(200).json({ ok: true, reason: 'proxied-v1' });
    return;
  }

  // Every attempt failed — most likely v1 cold-starting (~50s on Render free
  // tier). Release the claim and answer non-200 so Kapso's own retry schedule
  // (10s/40s/90s) gets another go at a by-then-warm v1; without the release the
  // retry would be swallowed here as a duplicate.
  //
  // This is the one deliberate exception to "the webhook always returns 200"
  // (CLAUDE.md). That rule protects against Kapso re-running handlers after an
  // application error, where the user is told over WhatsApp instead. A failure
  // here is transport, not application: nothing has been processed, there is
  // nobody to tell, and a retry is the only thing that saves the message. If
  // the forward did land and only the response was lost, v1's own message-id
  // dedup absorbs the retry — so this cannot double-reply.
  if (claimKey) await getRedis().del(claimKey).catch(() => undefined);
  console.error('[v1-proxy] all forward attempts failed; asking Kapso to retry');
  res.status(502).json({ ok: false, reason: 'v1-unreachable' });
}
