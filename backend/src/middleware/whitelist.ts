import { Request, Response, NextFunction } from 'express';
import { whitelistedNumbers } from '../env';
import { sendMessage } from '../kapso/client';

// require() works around the package-exports subpath limitation in CommonJS moduleResolution
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeWebhook } = require('@kapso/whatsapp-cloud-api/dist/server.cjs') as {
  normalizeWebhook: (payload: unknown) => {
    messages: Array<{ from: string; type: string; text?: { body: string } }>;
    statuses: unknown[];
  };
};

export interface WebhookExtras {
  senderPhone: string;
  webhookText: string | null;
}

export type WebhookRequest = Request & WebhookExtras;

// Parses the Kapso webhook payload and attaches sender + message text to the request
export function extractWebhookData(req: Request, _res: Response, next: NextFunction) {
  try {
    const events = normalizeWebhook(req.body);
    const message = events.messages?.[0];
    const raw = message?.from ?? '';
    // Meta sends phone numbers without '+', normalize to E.164
    const phone = raw ? (raw.startsWith('+') ? raw : `+${raw}`) : '';
    (req as WebhookRequest).senderPhone = phone;
    (req as WebhookRequest).webhookText =
      message?.type === 'text' ? (message.text?.body ?? null) : null;
  } catch {
    (req as WebhookRequest).senderPhone = '';
    (req as WebhookRequest).webhookText = null;
  }
  next();
}

export async function whitelistMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const phone = (req as WebhookRequest).senderPhone;

  if (!phone || !whitelistedNumbers.includes(phone)) {
    if (phone) {
      try {
        await sendMessage(phone, '❌ Unauthorized number.');
      } catch {
        // suppress — still return 200
      }
    }
    res.status(200).json({ ok: false, reason: 'unauthorized' });
    return;
  }

  next();
}
