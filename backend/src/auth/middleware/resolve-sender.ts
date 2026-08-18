import { Request, Response, NextFunction } from 'express';
import { whitelistedNumbers } from '../../shared/env';
import { findThirdPartyContact } from '../../core/integrations/local/third-party';
import {
  resolveSender,
  recordUnrecognizedSender,
  type RegisteredUser,
} from '../users';
import { isBlocked } from '../blocklist';

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

function normalizePhone(raw: string): string {
  // Meta/Kapso send phone numbers without '+', normalize to E.164
  return raw ? (raw.startsWith('+') ? raw : `+${raw}`) : '';
}

// Parses the Kapso webhook payload and attaches sender + message text + message ID to the request.
//
// Two payload shapes reach here depending on which Kapso webhook subscription
// delivered it: Meta's native envelope (`entry[].changes[].value.messages[]`,
// parsed via the SDK's normalizeWebhook()) or Kapso's own "events" envelope
// (`{ message, conversation, phone_number_id }` at the top level — normalizeWebhook()
// only understands the Meta shape and silently returns messages: [] for this one).
export function extractWebhookData(req: Request, _res: Response, next: NextFunction) {
  // Which envelope branch handled this. Logged below: an inbound message that
  // parses to no sender is dropped further down with no reply, and without this
  // there is nothing anywhere saying what arrived or why it was ignored.
  let shape = 'unknown';
  try {
    const body = req.body as { entry?: unknown; message?: Record<string, unknown> };
    if (Array.isArray(body?.entry)) {
      shape = 'meta';
      const events = normalizeWebhook(req.body);
      const message = events.messages?.[0];
      (req as WebhookRequest).senderPhone = normalizePhone(message?.from ?? '');
      (req as WebhookRequest).webhookText =
        message?.type === 'text' ? (message.text?.body ?? null) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawMsg = message as any;
      (req as WebhookRequest).buttonReplyId =
        rawMsg?.type === 'interactive' && rawMsg?.interactive?.type === 'button_reply'
          ? (rawMsg.interactive.buttonReply?.id ?? null)
          : null;
      (req as WebhookRequest).messageId = message?.id ?? null;
      (req as WebhookRequest).contextMessageId = message?.context?.id ?? null;
    } else if (body?.message && typeof body.message === 'object') {
      shape = 'kapso-events';
      // Reaching here means a `Kapso (events)` subscription delivered this.
      // Per docs/v2-plan.md §C.8 v2 is fed by the single `Meta` subscription
      // and should only ever see the envelope above, so this is worth shouting
      // about: if both subscriptions exist, every message arrives twice, and
      // the two envelopes are only deduped as one if Kapso's `message.id` here
      // is the same wamid Meta sends — which is unconfirmed. Delete the extra
      // subscription rather than relying on that.
      console.warn(
        '[webhook] Kapso-events envelope received — expected Meta. A second webhook subscription is probably still configured.'
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message = body.message as any;
      (req as WebhookRequest).senderPhone = normalizePhone(
        typeof message.from === 'string' ? message.from : ''
      );
      (req as WebhookRequest).webhookText =
        message.type === 'text' ? (message.text?.body ?? null) : null;
      (req as WebhookRequest).messageId = typeof message.id === 'string' ? message.id : null;
      // FIELD NAMES UNCONFIRMED below — Kapso's "events" webhook docs only show
      // a plain text message example, not an interactive/button-reply or a
      // reply-context payload. Logged so the first real test message tells us
      // the actual shape instead of us guessing wrong and silently breaking
      // reminder/task button replies. Remove once confirmed and hardcoded.
      if (message.type !== 'text') {
        console.log('[webhook] non-text Kapso-events message, shape:', JSON.stringify(message));
      }
      (req as WebhookRequest).buttonReplyId =
        message.type === 'interactive' && message.interactive?.type === 'button_reply'
          ? (message.interactive.button_reply?.id ?? message.interactive.buttonReply?.id ?? null)
          : null;
      (req as WebhookRequest).contextMessageId =
        typeof message.context?.id === 'string' ? message.context.id : null;
    } else {
      // Neither envelope matched. The top-level keys are the only clue to what
      // Kapso actually posted, and without them this is an invisible drop.
      console.warn(
        '[inbound] unrecognized envelope; top-level keys:',
        JSON.stringify(Object.keys((req.body as Record<string, unknown>) ?? {}))
      );
      (req as WebhookRequest).senderPhone = '';
      (req as WebhookRequest).webhookText = null;
      (req as WebhookRequest).messageId = null;
      (req as WebhookRequest).buttonReplyId = null;
      (req as WebhookRequest).contextMessageId = null;
    }
  } catch (err) {
    shape = 'parse-error';
    console.error('[inbound] envelope parse threw:', err);
    (req as WebhookRequest).senderPhone = '';
    (req as WebhookRequest).webhookText = null;
    (req as WebhookRequest).messageId = null;
    (req as WebhookRequest).buttonReplyId = null;
    (req as WebhookRequest).contextMessageId = null;
  }
  (req as WebhookRequest).isThirdParty = false;
  (req as WebhookRequest).thirdPartyAlias = '';
  (req as WebhookRequest).user = null;

  const parsed = req as WebhookRequest;
  console.log(
    `[inbound] envelope=${shape} from=${parsed.senderPhone || '(none)'} ` +
      `id=${parsed.messageId ?? '(none)'} ` +
      `kind=${parsed.buttonReplyId ? 'button' : parsed.webhookText !== null ? 'text' : 'other'}`
  );

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
    console.warn('[inbound] dropped: no sender could be extracted from the payload');
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
    console.log(`[inbound] dropped ${phone}: user is disabled`);
    res.status(200).json({ ok: false, reason: 'disabled' });
    return;
  }

  // Blocked takes priority over the third-party check below — a blocked
  // number shouldn't get a foothold just by matching someone's contact list.
  if (await isBlocked(phone).catch(() => false)) {
    console.log(`[inbound] dropped ${phone}: number is blocked`);
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

  // Deliberately silent to the sender, but never silent in the logs: this is
  // where a number that *should* have been proxied to v1, or registered in v2,
  // disappears without a trace.
  console.warn(
    `[inbound] dropped ${phone}: not a registered v2 user, not a third-party contact, ` +
      `and not routed to v1 — check V1_PROXY_NUMBERS / WHITELISTED_NUMBERS`
  );
  await recordUnrecognizedSender(phone).catch(() => undefined);
  res.status(200).json({ ok: false, reason: 'unrecognized' });
}
