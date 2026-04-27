import { env } from '../env';

// Sends a WhatsApp text message via Kapso Cloud API
export async function sendMessage(to: string, text: string): Promise<void> {
  const url = `https://api.kapso.io/v1/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.KAPSO_API_KEY}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      phone_number_id: env.KAPSO_PHONE_NUMBER_ID,
      text: { body: text, preview_url: false },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kapso sendMessage failed ${res.status}: ${body}`);
  }
}
