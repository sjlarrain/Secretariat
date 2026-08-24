import { describe, it, expect, vi } from 'vitest';

// There are two OAuth callbacks — /auth/google/callback (ops) and
// /auth/user/google/callback (per-user panel) — but only one
// GOOGLE_REDIRECT_URI. Before the override existed, the per-user flow sent
// users to the ops callback, which demands an admin session, so a registered
// user could never finish linking a calendar. Nothing failed loudly; the
// consent screen worked and the return trip 401'd.

vi.mock('../shared/env', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'https://secretariatx.test/auth/google/callback',
    BASE_URL: 'https://secretariatx.test',
  },
  whitelistedNumbers: ['+56991296313'],
}));

import { getAuthUrl, getOAuthClient } from '../core/integrations/google/oauth';

const USER_CALLBACK = 'https://secretariatx.test/auth/user/google/callback';

function redirectParamOf(authUrl: string): string | null {
  return new URL(authUrl).searchParams.get('redirect_uri');
}

describe('getAuthUrl', () => {
  it('defaults to GOOGLE_REDIRECT_URI so the ops flow is unchanged', () => {
    expect(redirectParamOf(getAuthUrl('state-1'))).toBe('https://secretariatx.test/auth/google/callback');
  });

  it('uses the override so the per-user flow returns to its own callback', () => {
    expect(redirectParamOf(getAuthUrl('state-1', USER_CALLBACK))).toBe(USER_CALLBACK);
  });

  it('still carries the state through', () => {
    expect(new URL(getAuthUrl('state-xyz', USER_CALLBACK)).searchParams.get('state')).toBe('state-xyz');
  });

  it('keeps offline access, so a refresh token is issued', () => {
    // Without this the migrated/linked account cannot refresh and every
    // calendar command breaks an hour later.
    expect(new URL(getAuthUrl('s', USER_CALLBACK)).searchParams.get('access_type')).toBe('offline');
  });
});

describe('getOAuthClient', () => {
  // The token exchange must present the same redirect_uri that obtained the
  // code, or Google answers redirect_uri_mismatch. Asserting the client is
  // built with the override is what ties exchangeCode() to getAuthUrl().
  it('applies the override to the client used for the exchange', () => {
    const client = getOAuthClient(USER_CALLBACK) as unknown as { redirectUri?: string; _redirectUri?: string };
    expect(client.redirectUri ?? client._redirectUri).toBe(USER_CALLBACK);
  });

  it('falls back to the env value with no override', () => {
    const client = getOAuthClient() as unknown as { redirectUri?: string; _redirectUri?: string };
    expect(client.redirectUri ?? client._redirectUri).toBe('https://secretariatx.test/auth/google/callback');
  });
});
