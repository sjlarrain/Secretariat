import { env } from '../env';

// The Kapso *platform* API (account/health/usage metadata) is separate from the
// WhatsApp messaging API wrapped by client.ts.
const PLATFORM_BASE = 'https://api.kapso.ai/platform/v1';

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'error';
  error?: string | null;
  checks?: Record<string, { passed: boolean; details?: Record<string, unknown>; error?: string }> | null;
}

export interface MessagesResponse {
  data: unknown[];
  meta?: { total_count?: number };
}

export async function kapsoFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${PLATFORM_BASE}${path}`, {
    headers: { 'X-API-Key': env.KAPSO_API_KEY },
  });
  if (!res.ok) throw new Error(`Kapso API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function fetchPhoneHealth(): Promise<HealthResponse> {
  return kapsoFetch<HealthResponse>(`/phone-numbers/${env.KAPSO_PHONE_NUMBER_ID}/health`);
}
