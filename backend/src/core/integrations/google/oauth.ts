import { google } from 'googleapis';
import { env } from '../../../shared/env';

export function getOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state: string): string {
  const client = getOAuthClient();
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

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}> {
  const client = getOAuthClient();
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
