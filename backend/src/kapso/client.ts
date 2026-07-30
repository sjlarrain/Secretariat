import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { env } from '../env';

let _client: WhatsAppClient | null = null;

function getClient(): WhatsAppClient {
  if (!_client) {
    _client = new WhatsAppClient({
      baseUrl: 'https://api.kapso.ai/meta/whatsapp',
      kapsoApiKey: env.KAPSO_API_KEY,
    });
  }
  return _client;
}

// WhatsApp is the only notification channel — there is no fallback if a send
// fails, so transient blips (Render cold starts, network flaps, Kapso rate
// limiting) are retried rather than surfaced as a hard failure.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1500]; // applied before attempts 2 and 3
const REQUEST_TIMEOUT_MS = 15000;    // a hung call must not block the caller forever

/** Marks a timeout so it can be distinguished from a genuine transport error. */
class SendTimeoutError extends Error {}

/** Send outcomes since boot. Read by /status and the nightly health check to
 *  tell "flaky but recovered" apart from "actually down". Resets on restart. */
export const kapsoStats = {
  sent: 0,
  retried: 0,
  failed: 0,
  lastErrorAt: null as string | null,
  lastError: null as string | null,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client errors (bad number, malformed payload) will fail identically on every
 * attempt, so retrying only delays the inevitable. 408 and 429 are the
 * exceptions — those are explicitly "try again".
 *
 * Timeouts are deliberately NOT retried. The timeout does not abort the request
 * in flight, so a slow-but-successful send would be delivered again on retry —
 * and the Kapso SDK exposes no idempotency key to deduplicate it. Sending the
 * same reminder twice is worse than surfacing one failure, so we give up and
 * log instead.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof SendTimeoutError) return false;

  const status =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    (err as { response?: { status?: number } })?.response?.status;

  if (typeof status !== 'number') return true; // network/unknown — worth a retry
  if (status === 408 || status === 429) return true;
  return status < 400 || status >= 500;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SendTimeoutError(
        `${label} timed out after ${REQUEST_TIMEOUT_MS}ms — it may or may not have been delivered`
      )),
      REQUEST_TIMEOUT_MS
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await withTimeout(fn(), label);
      if (attempt > 1) {
        kapsoStats.retried++;
        console.warn(`Kapso ${label} succeeded on attempt ${attempt}/${MAX_ATTEMPTS} (recovered)`);
      }
      kapsoStats.sent++;
      return result;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);

      if (!isRetryable(err)) {
        const why = err instanceof SendTimeoutError
          ? 'not retrying — a retry could deliver the message twice'
          : 'not retryable';
        console.error(`Kapso ${label} failed permanently (${why}): ${msg}`);
        break;
      }
      if (attempt === MAX_ATTEMPTS) {
        console.error(`Kapso ${label} failed after ${MAX_ATTEMPTS} attempts: ${msg}`);
        break;
      }

      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.warn(`Kapso ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed (${msg}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  kapsoStats.failed++;
  kapsoStats.lastErrorAt = new Date().toISOString();
  kapsoStats.lastError = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw lastErr;
}

export async function sendMessage(to: string, text: string): Promise<void> {
  await sendMessageWithId(to, text);
}

/** Same as sendMessage, but returns the WhatsApp message id so a reply to it
 *  can later be matched back to what triggered it (see wa-reply-map.ts). */
export async function sendMessageWithId(to: string, text: string): Promise<string> {
  const res = await withRetry('sendText', () =>
    getClient().messages.sendText({
      phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
      to,
      body: text,
    })
  );
  return res.messages[0]?.id ?? '';
}

export interface InteractiveButton {
  id: string;   // max 256 chars — encode action + type + itemId
  title: string; // max 20 chars
}

export async function sendInteractiveButtons(
  to: string,
  bodyText: string,
  buttons: InteractiveButton[],
  footerText?: string,
): Promise<string> {
  const res = await withRetry('sendInteractiveButtons', () =>
    getClient().messages.sendInteractiveButtons({
      phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
      to,
      bodyText,
      buttons: buttons.map((b) => ({ id: b.id, title: b.title })),
      ...(footerText ? { footerText } : {}),
    })
  );
  return res.messages[0]?.id ?? '';
}
