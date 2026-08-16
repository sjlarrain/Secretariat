import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import { env } from '../../env';
import { systemKey, pointKey } from '../../redis/keys';
import { HashCollection } from '../../redis/hash-collection';

// Single-use invite tokens. Registration is not open — a token, shared
// out-of-band by the operator, is the only way in (docs/v2-plan.md §B.2).
//
// One hash keyed by token, so the ops console can list outstanding and redeemed
// invites without scanning.

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export type InviteStatus = 'pending' | 'redeemed' | 'revoked';

export interface Invite {
  /** The token itself — unguessable, and the id of this record. */
  id: string;
  /** Operator's own label, so a list of tokens is readable ("for Carla"). */
  note?: string;
  status: InviteStatus;
  createdAt: string;
  redeemedAt?: string;
  /** Phone number that redeemed it. */
  redeemedBy?: string;
}

// Tokens are supplied by `crypto`, not minted from a counter, so no `:seq`.
const invites = new HashCollection<Invite>(redis, systemKey('invites'));

/**
 * 24 random bytes, base64url-encoded — 32 URL-safe characters, ~192 bits.
 * `randomBytes` rather than `Math.random` or a UUID: this token is the only
 * thing standing between a stranger and a registration.
 */
function generateToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function listInvites(): Promise<Invite[]> {
  return invites.getAll((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getInvite(token: string): Promise<Invite | null> {
  if (!token) return null;
  return invites.get(token);
}

export async function createInvite(note?: string): Promise<Invite> {
  const invite: Invite = {
    id: generateToken(),
    ...(note?.trim() ? { note: note.trim() } : {}),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await invites.set(invite);
  return invite;
}

/** Revokes an unused token. A token already redeemed cannot be revoked. */
export async function revokeInvite(token: string): Promise<{ ok: boolean; error?: string }> {
  const invite = await invites.get(token);
  if (!invite) return { ok: false, error: 'Invite not found' };
  if (invite.status === 'redeemed') return { ok: false, error: 'Invite has already been redeemed' };
  if (invite.status === 'revoked') return { ok: true };
  await invites.set({ ...invite, status: 'revoked' });
  return { ok: true };
}

export type RedeemResult =
  | { ok: true; invite: Invite }
  | { ok: false; error: string };

/**
 * Consumes a token on behalf of `phone`.
 *
 * The claim is settled with SET NX on a separate key before the record is
 * updated. Reading the invite and then writing it back would let two
 * simultaneous redemptions both observe `pending` and both succeed — the token
 * would admit two users. NX makes exactly one caller win, whatever the timing.
 */
export async function redeemInvite(token: string, phone: string): Promise<RedeemResult> {
  const invite = await invites.get(token);
  if (!invite) return { ok: false, error: 'This invite link is not valid.' };
  if (invite.status === 'revoked') return { ok: false, error: 'This invite has been revoked.' };
  if (invite.status === 'redeemed') return { ok: false, error: 'This invite has already been used.' };

  const claimed = await redis.set(pointKey('invite-claim', token), phone, { nx: true });
  if (claimed === null) return { ok: false, error: 'This invite has already been used.' };

  const redeemed: Invite = {
    ...invite,
    status: 'redeemed',
    redeemedAt: new Date().toISOString(),
    redeemedBy: phone,
  };
  await invites.set(redeemed);
  return { ok: true, invite: redeemed };
}
