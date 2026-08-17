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

// Kapso's own 404/5xx pages are full HTML documents (title/h1/p + inline CSS),
// not JSON — dumping them raw makes health alerts and /status unreadable.
function summarizeErrorBody(text: string, contentType: string | null): string {
  if (contentType?.includes('text/html')) {
    const h1 = text.match(/<h1[^>]*>([^<]*)<\/h1>/i)?.[1];
    const title = text.match(/<title>([^<]*)<\/title>/i)?.[1];
    const p = text.match(/<p[^>]*>([^<]*)<\/p>/i)?.[1];
    const summary = [h1 ?? title, p].filter(Boolean).join(' — ');
    if (summary) return summary;
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export async function kapsoFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${PLATFORM_BASE}${path}`, {
    headers: { 'X-API-Key': env.KAPSO_API_KEY },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kapso API ${res.status}: ${summarizeErrorBody(text, res.headers.get('content-type'))}`);
  }
  return res.json() as Promise<T>;
}

export function fetchPhoneHealth(): Promise<HealthResponse> {
  return kapsoFetch<HealthResponse>(`/whatsapp/phone_numbers/${env.KAPSO_PHONE_NUMBER_ID}/health`);
}
