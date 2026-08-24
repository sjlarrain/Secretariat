import { describe, it, expect, vi } from 'vitest';

// panel.ts reaches `shared/env` through panel-sessions/users/operator, and that
// module `process.exit(1)`s without live credentials. Stubbed as elsewhere; the
// page itself is a pure template and touches none of it.
vi.mock('../shared/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
  },
  whitelistedNumbers: ['+56991296313'],
}));

vi.mock('@upstash/redis', async () => {
  const { FakeRedis } = await import('./helpers/fake-redis');
  return { Redis: FakeRedis };
});

import { loginPage } from '../platform/routes/panel';

// The SPA chooses which panel to render from the URL alone — App.tsx does
// `location.pathname.startsWith('/app')` and never looks at the session. So an
// operator whose session *does* carry admin still lands in the user tree if the
// login page sends them to /app, with no link across to the ops console. That
// looked exactly like "the panel link doesn't give me admin" when the backend
// grant was working perfectly.

describe('panel login page', () => {
  const html = loginPage('tok-123');

  it('sends the operator to the ops console', () => {
    expect(html).toContain("body.operator ? '/dashboard' : '/app'");
  });

  it('does not hard-code /app as the only destination', () => {
    // The original bug, in one line: `window.location.href = '/app';`
    expect(html).not.toMatch(/window\.location\.href\s*=\s*'\/app'/);
  });

  it('posts to consume the token rather than consuming it on GET', () => {
    // WhatsApp fetches shared links server-side to build a preview, which would
    // burn a single-use token before the recipient ever taps it.
    expect(html).toContain("{ method: 'POST' }");
  });

  it('renders a sign-in affordance', () => {
    expect(html).toContain('continue-btn');
  });
});
