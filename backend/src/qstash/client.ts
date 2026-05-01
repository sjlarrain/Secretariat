import { Client } from '@upstash/qstash';
import { env } from '../env';

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) _client = new Client({ token: env.QSTASH_TOKEN, ...(env.QSTASH_URL ? { baseUrl: env.QSTASH_URL } : {}) });
  return _client;
}

// Schedules a one-off delayed HTTP POST, returns QStash message ID
export async function scheduleOnce(path: string, delaySeconds: number, body: object): Promise<string> {
  const client = getClient();
  const url = `${env.BASE_URL}${path}`;

  const res = await client.publish({
    url,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    delay: delaySeconds,
  });

  return res.messageId;
}

// Creates a recurring cron schedule, returns schedule ID
export async function scheduleCron(path: string, cron: string, body: object): Promise<string> {
  const client = getClient();
  const url = `${env.BASE_URL}${path}`;

  const res = await client.schedules.create({
    destination: url,
    cron,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

  return res.scheduleId;
}

// Deletes a cron schedule by ID
export async function deleteSchedule(scheduleId: string): Promise<void> {
  const client = getClient();
  await client.schedules.delete(scheduleId);
}

// Cancels a pending one-time message (best-effort)
export async function cancelMessage(messageId: string): Promise<void> {
  const client = getClient();
  await client.messages.cancel(messageId);
}
