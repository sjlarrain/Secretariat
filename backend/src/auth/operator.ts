import { whitelistedNumbers } from '../shared/env';

// The deployment has exactly one operator, and their number is also an ordinary
// user id. That is the whole point: the operator's `u:<number>:*` namespace is
// the same one the ops console reads through `ownerId()` and the same one their
// panel session resolves, so ops, the panel, and WhatsApp are three doors onto
// one profile rather than three profiles.
//
// Matching is exact — `whitelistedNumbers` is split and trimmed but never
// normalized (shared/env.ts), while every inbound number is normalized to a
// leading '+' before it becomes a userId (auth/middleware/resolve-sender.ts,
// platform/routes/register.ts). So WHITELISTED_NUMBERS must carry the '+'. If
// it does not, ops writes `u:56…:*` while WhatsApp writes `u:+56…:*` and the
// one profile silently becomes two.

/** The operator's userId — first entry of WHITELISTED_NUMBERS. */
export function operatorId(): string {
  return whitelistedNumbers[0];
}

export function isOperator(userId: string): boolean {
  return !!userId && userId === operatorId();
}

/**
 * What a session gets on sign-in, whichever door was used.
 *
 * Both the ops password login and the one-time panel link funnel through this
 * so the two can never drift apart — the operator ends up with an
 * admin-privileged session that is *also* a normal user session for their own
 * namespace, and everyone else gets a user session only.
 */
export interface SessionGrant {
  /** Scopes every per-user read and write. Always set. */
  userId: string;
  /** Unlocks the ops console. Only ever true for the operator. */
  authenticated: boolean;
}

export function grantFor(userId: string): SessionGrant {
  return { userId, authenticated: isOperator(userId) };
}
