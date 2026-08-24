import { describe, it, expect } from 'vitest';
import { callbackPage, OPS_RETURN, USER_RETURN } from '../shared/oauth-callback-page';

// This page is the last thing anyone sees after connecting a Google account,
// and its button used to be a hard-coded `href="/"`. That was right in v1,
// where `/` was the dashboard. v2.0 moved the console to /dashboard and made
// `/` the public Welcome page, so a successful connect quietly ended on the
// landing page — and for a real user, on a page offering to sign them up.

describe('callbackPage', () => {
  it('never sends anyone to the public landing page', () => {
    // The original bug, in one assertion.
    for (const back of [OPS_RETURN, USER_RETURN]) {
      expect(callbackPage('success', 'Connected', 'ok', back)).not.toContain('href="/"');
    }
  });

  it('returns the operator to the console', () => {
    const html = callbackPage('success', 'Connected', 'ok', OPS_RETURN);
    expect(html).toContain('href="/settings/accounts"');
    expect(html).toContain('Back to the console');
  });

  it('returns a user to their own panel, not the ops console', () => {
    const html = callbackPage('success', 'Connected', 'ok', USER_RETURN);
    expect(html).toContain('href="/app/settings/accounts"');
    expect(html).not.toContain('href="/settings/accounts"');
  });

  it('defaults to the ops destination when none is given', () => {
    expect(callbackPage('error', 'Failed', 'bad')).toContain(`href="${OPS_RETURN.href}"`);
  });

  it('renders both variants with their own icon', () => {
    expect(callbackPage('success', 'Connected', 'ok')).toContain('✓');
    expect(callbackPage('error', 'Failed', 'bad')).toContain('✕');
  });

  it('escapes the title so a Google-supplied error cannot inject markup', () => {
    const html = callbackPage('error', '<img src=x onerror=alert(1)>', 'bad');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
