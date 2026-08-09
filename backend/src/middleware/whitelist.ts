import { Request, Response, NextFunction } from 'express';
import { whitelistedNumbers } from '../env';
import { sendMessage } from '../kapso/client';
import { findThirdPartyContact } from '../integrations/local/third-party';

// require() works around the package-exports subpath limitation in CommonJS moduleResolution
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeWebhook } = require('@kapso/whatsapp-cloud-api/server') as {
  normalizeWebhook: (payload: unknown) => {
    messages: Array<{
      id?: string;
      from: string;
      type: string;
      text?: { body: string };
      context?: { id?: string } | null;
    }>;
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
    // Read id + reply context off the normalized message. The SDK's
    // UnifiedMessage carries both regardless of Kapso's envelope shape; a
    // separate raw `entry[0].changes...` parse breaks whenever the delivered
    // payload isn't Meta-native, silently nulling messageId and disabling dedup.
    (req as WebhookRequest).messageId = message?.id ?? null;
    (req as WebhookRequest).contextMessageId = message?.context?.id ?? null;
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
      // Third parties propose events to the owner they're messaging — until
      // the user registry (v2 Goal 2) exists, that's the single whitelisted
      // owner, same fallback used throughout crons/handlers.
      const owner = whitelistedNumbers[0];
      const contact = owner ? await findThirdPartyContact(owner, phone).catch(() => null) : null;
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
