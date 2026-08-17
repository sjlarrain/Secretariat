import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { consumePanelLoginToken } from '../../auth/panel-sessions';
import { getRegisteredUser } from '../../auth/users';

// Public, unauthenticated — the entry point for the per-user panel
// (docs/v2-plan.md §B.4). There is no password: the one-time link a `/panel`
// WhatsApp message sends back is the credential.

const router = Router();

const panelRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The page a tapped WhatsApp link opens. Deliberately does not consume the
 * token on this GET — WhatsApp (and some other messaging clients) fetch a
 * shared link server-side to build the chat preview, which would burn a
 * single-use token before the recipient ever taps it. Consumption happens
 * only on the POST the button below fires.
 */
function loginPage(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign in — Secretariat</title>
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
    h1 { font-size: 18px; font-weight: 700; color: #f0f0f0; margin-bottom: 10px; letter-spacing: -0.2px; }
    p { font-size: 14px; color: #8a8a8a; line-height: 1.6; margin-bottom: 24px; }
    button {
      background: #2a2a2a; color: #e2e2e2; cursor: pointer;
      border: 1px solid #3a3a3a; border-radius: 8px;
      padding: 10px 26px; font-size: 14px; font-weight: 600;
      transition: background 0.15s;
    }
    button:hover { background: #333; }
    button:disabled { opacity: 0.5; cursor: default; }
    .brand { font-size: 11px; color: #444; margin-top: 24px; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <div class="card">
    <h1 id="title">Sign in to Secretariat</h1>
    <p id="message">This link is single-use — continuing will sign you in and expire it.</p>
    <button id="continue-btn" type="button">Continue</button>
    <div class="brand">SECRETARIAT</div>
  </div>
  <script>
    document.getElementById('continue-btn').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        var res = await fetch(window.location.pathname, { method: 'POST' });
        var body = await res.json();
        if (!res.ok || !body.ok) {
          document.getElementById('title').textContent = 'Could not sign in';
          document.getElementById('message').textContent = body.error || 'This link is invalid or has expired.';
          btn.remove();
          return;
        }
        document.getElementById('title').textContent = 'Signed in';
        document.getElementById('message').textContent = "You're signed in as " + body.name + ". Taking you to your panel…";
        btn.remove();
        setTimeout(function () { window.location.href = '/app'; }, 800);
      } catch (err) {
        document.getElementById('title').textContent = 'Something went wrong';
        document.getElementById('message').textContent = 'Check your connection and try again.';
        btn.disabled = false;
        btn.textContent = 'Continue';
      }
    });
  </script>
</body>
</html>`;
}

router.get('/login/:token', panelRateLimit, (req: Request, res: Response) => {
  res.send(loginPage(String(req.params['token'] ?? '')));
});

router.post('/login/:token', panelRateLimit, async (req: Request, res: Response) => {
  const userId = await consumePanelLoginToken(String(req.params['token'] ?? ''));
  if (!userId) {
    res.status(400).json({ ok: false, error: 'This link is invalid or has expired. Send /panel again to get a new one.' });
    return;
  }

  const user = await getRegisteredUser(userId);
  if (!user || user.status !== 'active') {
    res.status(400).json({ ok: false, error: 'This account is no longer active.' });
    return;
  }

  // Regenerate the session id on sign-in so a session id issued before
  // authentication can't be fixed by an attacker and ride along afterward.
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).json({ ok: false, error: 'Could not start a session.' });
      return;
    }
    (req.session as { userId?: string }).userId = userId;
    res.json({ ok: true, name: escapeHtml(user.name) });
  });
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => res.json({ ok: true }));
});

export default router;
