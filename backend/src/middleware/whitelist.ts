import { Request, Response, NextFunction } from 'express';
import { whitelistedNumbers } from '../env';
import { sendMessage } from '../kapso/client';

// require() works around the package-exports subpath limitation in CommonJS moduleResolution
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeWebhook } = require('@kapso/whatsapp-cloud-api/server') as {
  normalizeWebhook: (payload: unknown) => {
    messages: Array<{ from: string; type: string; text?: { body: string } }>;
    statuses: unknown[];
  };
};

export interface WebhookExtras {
  senderPhone: string;
  webhookText: string | null;
  messageId: string | null;
  buttonReplyId: string | null; // set when message.type === 'interactive' (button tap)
}

export type WebhookRequest = Request & WebhookExtras;

// Parses the Kapso webhook payload and attaches sender + message text + message ID to the request
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawMsg = message as any;
    (req as WebhookRequest).buttonReplyId =
      rawMsg?.type === 'interactive' && rawMsg?.interactive?.type === 'button_reply'
        ? (rawMsg.interactive.buttonReply?.id ?? null)
        : null;
    // Extract WhatsApp message ID from the raw payload for deduplication
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as WebhookRequest).messageId =
      (req.body as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ?? null;
  } catch {
    (req as WebhookRequest).senderPhone = '';
    (req as WebhookRequest).webhookText = null;
    (req as WebhookRequest).messageId = null;
    (req as WebhookRequest).buttonReplyId = null;
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
