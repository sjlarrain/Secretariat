import { Request, Response, NextFunction } from 'express';
import { whitelistedNumbers } from '../env';
import { sendMessage } from '../kapso/client';

// Attaches sender phone number extracted from Kapso webhook payload
export function extractSender(req: Request, _res: Response, next: NextFunction) {
  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const from: string = message?.from ?? '';
    (req as Request & { senderPhone: string }).senderPhone = from ? `+${from}` : '';
  } catch {
    (req as Request & { senderPhone: string }).senderPhone = '';
  }
  next();
}

export async function whitelistMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const phone = (req as Request & { senderPhone: string }).senderPhone;

  if (!phone || !whitelistedNumbers.includes(phone)) {
    if (phone) {
      try {
        await sendMessage(phone, '❌ Unauthorized number.');
      } catch {
        // suppress — still return 200
      }
    }
    res.status(200).json({ ok: false, reason: 'unauthorized' });
    return;
  }

  next();
}
