import { describe, it, expect, vi } from 'vitest';

// `operator.ts` reads `whitelistedNumbers`, which `shared/env` derives from a
// required env var and `process.exit(1)`s without. Stubbed the same way
// isolation.test.ts does.
vi.mock('../shared/env', () => ({
  env: {},
  whitelistedNumbers: ['+56991296313'],
}));

import { operatorId, isOperator, grantFor } from '../auth/operator';

const OPERATOR = '+56991296313';
const FRIEND = '+56911111111';

describe('operatorId', () => {
  it('is the first whitelisted number', () => {
    expect(operatorId()).toBe(OPERATOR);
  });
});

describe('isOperator', () => {
  it('recognises the operator', () => {
    expect(isOperator(OPERATOR)).toBe(true);
  });

  it('rejects any other registered user', () => {
    expect(isOperator(FRIEND)).toBe(false);
  });

  it('rejects an empty id rather than matching a blank env entry', () => {
    expect(isOperator('')).toBe(false);
  });

  it('does not match the same number without the leading +', () => {
    // The drift hazard this whole module documents: WHITELISTED_NUMBERS is
    // never normalized, but every userId is. If the env var loses its '+',
    // ops and the panel silently address two different namespaces — so the
    // mismatch must fail loudly here rather than be papered over.
    expect(isOperator('56991296313')).toBe(false);
  });
});

describe('grantFor', () => {
  it('gives the operator both an ops session and a user session', () => {
    // One profile, three doors: this is what makes the ops console and /app
    // show the same data for the operator.
    expect(grantFor(OPERATOR)).toEqual({ userId: OPERATOR, authenticated: true });
  });

  it('gives an ordinary user a user session only', () => {
    // The failure this prevents: the first friend who sends /panel becoming an
    // admin because the grant was gated on "is registered" rather than "is the
    // operator".
    expect(grantFor(FRIEND)).toEqual({ userId: FRIEND, authenticated: false });
  });

  it('always scopes to the id it was given, never to the operator', () => {
    expect(grantFor(FRIEND).userId).toBe(FRIEND);
  });
});
