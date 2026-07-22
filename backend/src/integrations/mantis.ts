import { Redis } from '@upstash/redis';
import { env } from '../env';

// Mantis's POST /api/v1/inbox is idempotent on (source, source_ref), so unlike
// kapso/client.ts sends, retrying here can never double-save a note — every
// failure (network error or non-2xx) is safe to retry.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1500];
const REQUEST_TIMEOUT_MS = 10_000;

const PENDING_KEY = 'secretariat:mantis:pending';

export interface PendingMantisNote {
  text: string;
  sourceRef: string;
  savedAt: string; // ISO
}

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return _redis;
}

async function savePendingNote(text: string, sourceRef: string): Promise<void> {
  const list = (await getRedis().get<PendingMantisNote[]>(PENDING_KEY)) ?? [];
  list.push({ text, sourceRef, savedAt: new Date().toISOString() });
  await getRedis().set(PENDING_KEY, list);
}

export class MantisUnavailableError extends Error {}

interface CaptureNoteParams {
  text: string;
  sourceRef: string;
}

interface CaptureNoteResult {
  id: string;
  deduped: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postInbox(params: CaptureNoteParams): Promise<CaptureNoteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.MANTIS_API_URL}/api/v1/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MANTIS_API_KEY}`,
      },
      body: JSON.stringify({ text: params.text, source: 'whatsapp', source_ref: params.sourceRef }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Mantis API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { id: string; deduped?: boolean };
    return { id: data.id, deduped: data.deduped ?? false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a quick-capture note to Mantis's inbox, retrying transient failures.
 * If every attempt fails, the text is parked in Redis under `secretariat:mantis:pending`
 * so it is never lost, and a `MantisUnavailableError` is thrown so the caller can
 * tell the user it was saved locally instead.
 */
export async function captureNote(params: CaptureNoteParams): Promise<CaptureNoteResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await postInbox(params);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }

  await savePendingNote(params.text, params.sourceRef);
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new MantisUnavailableError(`Mantis unreachable after ${MAX_ATTEMPTS} attempts: ${msg}`);
}
