import { getMbaItems } from '../integrations/local/mba';
import { getSettings } from '../integrations/token-store';
import { formatDate } from '../../shared/utils/date';
import { sendMessage } from '../../shared/kapso/client';

// The Monday "here's your MBA list" reminder — distinct from the automatic
// per-item 24h-before-due reminder (that one is a one-off scheduled from
// mba.handler.ts / platform user-api, not this weekly digest).
export async function fireMbaReminder(userId: string): Promise<void> {
  const settings = await getSettings(userId);
  if (!settings.mbaReminder?.enabled) return;

  const items = await getMbaItems(userId);

  if (items.length === 0) {
    await sendMessage(userId, '✅ MBA list is clear. Enjoy the week!');
    return;
  }

  const lines = ['🎓 *MBA list — Monday reminder:*\n'];
  items.forEach((item, i) => {
    const due = item.dueDate ? ` _(📅 due ${formatDate(new Date(item.dueDate), true, settings.timezone)})_` : '';
    lines.push(`${i + 1}. ${item.text}${due}`);
  });
  await sendMessage(userId, lines.join('\n'));
}
