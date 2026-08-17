import { Request, Response, NextFunction } from 'express';
import { whitelistedNumbers } from '../env';
import { findThirdPartyContact } from '../integrations/local/third-party';
import {
  resolveSender,
  recordUnrecognizedSender,
  type RegisteredUser,
} from '../integrations/local/users';
import { isBlocked } from '../integrations/local/blocklist';

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
  /** The resolved registry entry. Set for every request that reaches a handler. */
  user: RegisteredUser | null;
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
  (req as WebhookRequest).user = null;
  next();
}

/**
 * Resolves the sender against the user registry and attaches the result.
 *
 * Three deliberate behaviours, all from docs/v2-plan.md §B.5:
 *   * An unregistered number gets **no reply**. v1 answered "Unauthorized
 *     number", which on a shared number tells any wrong-number sender that
 *     something is listening. The number is recorded for the ops console
 *     instead.
 *   * A disabled user is treated the same way — silence, no explanation.
 *   * Third-party contacts still pass through, since they are a known
 *     relationship rather than an unknown sender.
 */
export async function resolveSenderMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const phone = (req as WebhookRequest).senderPhone;
  if (!phone) {
    res.status(200).json({ ok: false, reason: 'no-sender' });
    return;
  }

  const resolved = await resolveSender(phone);

  if (resolved.kind === 'user') {
    (req as WebhookRequest).user = resolved.user;
    next();
    return;
  }

  if (resolved.kind === 'disabled') {
    res.status(200).json({ ok: false, reason: 'disabled' });
    return;
  }

  // Blocked takes priority over the third-party check below — a blocked
  // number shouldn't get a foothold just by matching someone's contact list.
  if (await isBlocked(phone).catch(() => false)) {
    res.status(200).json({ ok: false, reason: 'blocked' });
    return;
  }

  // Unknown sender. They may still be a third party proposing an event to a
  // user who registered them.
  //
  // Which user, though, is not yet answerable: third-party contacts are stored
  // per owner, and scanning every registered user on each unknown message is
  // work this does not need to do until the feature's multi-user semantics are
  // specified. Until then it keeps the v1 behaviour of consulting the single
  // legacy owner. Tracked as part of Goal 2b.
  const legacyOwner = whitelistedNumbers[0];
  const contact = legacyOwner
    ? await findThirdPartyContact(legacyOwner, phone).catch(() => null)
    : null;
  if (contact) {
    (req as WebhookRequest).isThirdParty = true;
    (req as WebhookRequest).thirdPartyAlias = contact.alias;
    next();
    return;
  }

  await recordUnrecognizedSender(phone).catch(() => undefined);
  res.status(200).json({ ok: false, reason: 'unrecognized' });
}
