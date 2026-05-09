import { Router, Request, Response } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import { getAuthUrl, exchangeCode } from '../integrations/google/oauth';
import { saveAccount, encryptTokens, getAllAccounts } from '../integrations/token-store';

const router = Router();

// Pending OAuth states: stateId → { alias, type }
const pendingStates = new Map<string, { alias: string; type: 'calendar' | 'tasks' }>();

router.get('/google/start', (req: Request, res: Response) => {
  const alias = (req.query['alias'] as string) || 'default';
  const type = ((req.query['type'] as string) || 'calendar') as 'calendar' | 'tasks';

  const state = uuidv4();
  pendingStates.set(state, { alias, type });

  // Clean up stale states after 10 minutes
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

  res.redirect(getAuthUrl(state));
});

router.get('/google/callback', async (req: Request, res: Response) => {
  const code = req.query['code'] as string | undefined;
  const state = req.query['state'] as string | undefined;
  const error = req.query['error'] as string | undefined;

  if (error) {
    res.status(400).send(`<h2>OAuth Error: ${error}</h2><a href="/">Back to admin</a>`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('<h2>Missing code or state.</h2><a href="/">Back to admin</a>');
    return;
  }

  const pending = pendingStates.get(state);
  if (!pending) {
    res.status(400).send('<h2>Unknown or expired OAuth state.</h2><a href="/">Back to admin</a>');
    return;
  }

  pendingStates.delete(state);

  try {
    const tokens = await exchangeCode(code);
    const existingAccounts = await getAllAccounts();
    const existing = existingAccounts.find((a) => a.alias === pending.alias && a.type === pending.type);
    const isFirstOfType = !existingAccounts.some((a) => a.type === pending.type);

    await saveAccount({
      id: existing?.id ?? uuidv4(),
      alias: pending.alias,
      provider: 'google',
      type: pending.type,
      isDefault: existing?.isDefault ?? isFirstOfType,
      encryptedTokens: encryptTokens(tokens),
      enabledCalendarIds: existing?.enabledCalendarIds,
      calendarNames: existing?.calendarNames,
      isDisconnected: false,
    });

    res.send(`
      <h2>✅ Connected!</h2>
      <p>Google ${pending.type} account "<strong>${pending.alias}</strong>" connected successfully.</p>
      <a href="/">Back to admin panel</a>
    `);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`<h2>❌ Error: ${msg}</h2><a href="/">Back to admin</a>`);
  }
});

export default router;
