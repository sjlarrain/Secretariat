import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { env } from '../env';

let _client: WhatsAppClient | null = null;

function getClient(): WhatsAppClient {
  if (!_client) {
    _client = new WhatsAppClient({
      baseUrl: 'https://api.kapso.ai/meta/whatsapp',
      kapsoApiKey: env.KAPSO_API_KEY,
    });
  }
  return _client;
}

export async function sendMessage(to: string, text: string): Promise<void> {
  await getClient().messages.sendText({
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
    to,
    body: text,
  });
}

export interface InteractiveButton {
  id: string;   // max 256 chars — encode action + type + itemId
  title: string; // max 20 chars
}

export async function sendInteractiveButtons(
  to: string,
  bodyText: string,
  buttons: InteractiveButton[],
  footerText?: string,
): Promise<void> {
  await getClient().messages.sendInteractiveButtons({
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
    to,
    bodyText,
    buttons: buttons.map((b) => ({ id: b.id, title: b.title })),
    ...(footerText ? { footerText } : {}),
  });
}
