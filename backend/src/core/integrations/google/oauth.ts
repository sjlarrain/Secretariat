import { google } from 'googleapis';
import { env } from '../../../shared/env';

/**
 * `redirectUri` overrides `GOOGLE_REDIRECT_URI` for flows that finish somewhere
 * else. There are two callbacks — `/auth/google/callback` (ops) and
 * `/auth/user/google/callback` (the per-user panel) — and a single env var can
 * only name one, so without this the per-user flow sent users to the ops
 * callback, which demands an admin session. Both URIs must be registered on the
 * OAuth client in the Google console.
 *
 * Google requires the `redirect_uri` at token exchange to match the one used to
 * obtain the code, so whatever is passed to `getAuthUrl()` must also be passed
 * to `exchangeCode()`. Refreshing a token does not use it, so
 * `getAuthenticatedClient()` needs no override.
 */
export function getOAuthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri ?? env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state: string, redirectUri?: string): string {
  const client = getOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/tasks',
    ],
    state,
  });
}

export async function exchangeCode(code: string, redirectUri?: string): Promise<{
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}> {
  // Must be the same value `getAuthUrl()` was given, or Google rejects the
  // exchange with redirect_uri_mismatch.
  const client = getOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Missing tokens from Google OAuth response');
  }
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
  };
}

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export class CalendarDisconnectedError extends Error {
  constructor(public alias: string) {
    super(`DISCONNECTED:${alias}`);
    this.name = 'CalendarDisconnectedError';
  }
}

export async function getAuthenticatedClient(tokens: GoogleTokens, alias?: string) {
  const client = getOAuthClient();
  client.setCredentials(tokens);

  // Auto-refresh if expired
  if (Date.now() >= tokens.expiry_date - 60_000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      return { client, refreshedTokens: credentials };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/invalid_grant|token has been expired|token has been revoked/i.test(msg)) {
        throw new CalendarDisconnectedError(alias ?? 'unknown');
      }
      throw err;
    }
  }

  return { client, refreshedTokens: null };
}
