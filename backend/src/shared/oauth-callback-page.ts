// Shared HTML rendering for the Google OAuth callback page, used by both the
// admin-gated flow (ops/routes/google-oauth.ts) and the per-user flow
// (platform/routes/user-google-oauth.ts). Lives in shared/ rather than either
// bucket so neither has to import from the other for it.

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type CallbackPageVariant = 'success' | 'error';

/** Where the page's button sends the visitor once they're done reading it. */
export interface CallbackReturn {
  href: string;
  label: string;
}

/**
 * The two flows finish in different places, and neither is `/`. That was the v1
 * destination, when `/` *was* the dashboard; v2.0 moved the console to
 * /dashboard and made `/` the public Welcome page, which left this button
 * dropping people on the landing page after a successful connect.
 */
export const OPS_RETURN: CallbackReturn = { href: '/settings/accounts', label: 'Back to the console' };
export const USER_RETURN: CallbackReturn = { href: '/app/settings/accounts', label: 'Back to your panel' };

export function callbackPage(
  variant: CallbackPageVariant,
  title: string,
  message: string,
  back: CallbackReturn = OPS_RETURN
): string {
  const isSuccess = variant === 'success';
  const icon = isSuccess ? '✓' : '✕';
  const iconColor = isSuccess ? '#4ade80' : '#f87171';
  const iconBg = isSuccess ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — Secretariat</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #e2e2e2;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 40px 36px; max-width: 420px; width: 100%; text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .icon {
      width: 56px; height: 56px; border-radius: 50%;
      background: ${iconBg}; color: ${iconColor};
      font-size: 26px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px;
    }
    h1 { font-size: 18px; font-weight: 700; color: #f0f0f0; margin-bottom: 10px; letter-spacing: -0.2px; }
    p { font-size: 14px; color: #8a8a8a; line-height: 1.6; margin-bottom: 28px; }
    strong { color: #d0d0d0; font-weight: 600; }
    a.btn {
      display: inline-block; background: #2a2a2a; color: #e2e2e2;
      border: 1px solid #3a3a3a; border-radius: 8px;
      padding: 9px 22px; font-size: 13px; font-weight: 500;
      text-decoration: none; transition: background 0.15s;
    }
    a.btn:hover { background: #333; }
    .brand { font-size: 11px; color: #444; margin-top: 24px; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    <a class="btn" href="${escapeHtml(back.href)}">${escapeHtml(back.label)}</a>
    <div class="brand">SECRETARIAT</div>
  </div>
</body>
</html>`;
}
