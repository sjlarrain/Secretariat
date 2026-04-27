import { google } from 'googleapis';
import { env } from '../../env';

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

export async function getAuthenticatedClient(tokens: GoogleTokens) {
  const client = getOAuthClient();
  client.setCredentials(tokens);

  // Auto-refresh if expired
  if (Date.now() >= tokens.expiry_date - 60_000) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    return { client, refreshedTokens: credentials };
  }

  return { client, refreshedTokens: null };
}
