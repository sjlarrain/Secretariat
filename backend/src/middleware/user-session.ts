import { Request, Response, NextFunction } from 'express';
import { getRegisteredUser } from '../integrations/local/users';
import { getSettings } from '../integrations/token-store';
import { Ctx } from '../ctx';

export type UserSessionRequest = Request & { userCtx: Ctx };

/**
 * Gates the per-user panel API. `req.session.userId` is set only by
 * `POST /panel/login/:token` consuming a one-time WhatsApp link — there is
 * no password, so this is the entire authentication boundary
 * (docs/v2-plan.md §C.6).
 *
 * Every panel route must resolve data through `req.userCtx.userId`, never
 * from a URL or body parameter — otherwise a session could reach another
 * user's namespace just by editing the request.
 */
export async function requireUserSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req.session as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }

  const user = await getRegisteredUser(userId);
  if (!user || user.status !== 'active') {
    req.session.destroy(() => undefined);
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }

  const settings = await getSettings(userId);
  (req as UserSessionRequest).userCtx = { userId, timezone: settings.timezone };
  next();
}
