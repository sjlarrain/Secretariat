import { Request, Response, NextFunction } from 'express';
import { whitelistedNumbers } from '../env';
import { sendMessage } from '../kapso/client';
import { findThirdPartyContact } from '../integrations/local/third-party';

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
  contextMessageId: string | null; // set when the user replies to a specific message
  isThirdParty: boolean;
  thirdPartyAlias: string;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawEntry = (req.body as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    (req as WebhookRequest).messageId = rawEntry?.id ?? null;
    (req as WebhookRequest).contextMessageId = rawEntry?.context?.id ?? null;
  } catch {
    (req as WebhookRequest).senderPhone = '';
    (req as WebhookRequest).webhookText = null;
    (req as WebhookRequest).messageId = null;
    (req as WebhookRequest).buttonReplyId = null;
    (req as WebhookRequest).contextMessageId = null;
  }
  (req as WebhookRequest).isThirdParty = false;
  (req as WebhookRequest).thirdPartyAlias = '';
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
      const contact = await findThirdPartyContact(phone).catch(() => null);
      if (contact) {
        (req as WebhookRequest).isThirdParty = true;
        (req as WebhookRequest).thirdPartyAlias = contact.alias;
        next();
        return;
      }
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
