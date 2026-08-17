import { Request, Response, NextFunction } from 'express';
import { Receiver } from '@upstash/qstash';
import { env } from '../../shared/env';

let _receiver: Receiver | null = null;

function getReceiver(): Receiver {
  if (!_receiver) {
    _receiver = new Receiver({
      currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
    });
  }
  return _receiver;
}

export async function qstashVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  const signature = req.headers['upstash-signature'] as string | undefined;

  if (!signature) {
    res.status(401).json({ error: 'Missing QStash signature' });
    return;
  }

  try {
    const body = JSON.stringify(req.body);
    const isValid = await getReceiver().verify({ signature, body });
    if (!isValid) throw new Error('Invalid signature');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid QStash signature' });
  }
}
