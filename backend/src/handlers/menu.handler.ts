import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';

const MENU = `🤖 *Secretariat — Commands*

📅 *Calendar*
*/schedule* — Create a calendar event
  --title   name _(required)_
  --for     date _(required)_
  --at      HH:MM _(required)_
  --invite  email1,email2
  --notes   description

*/myschedule* — Show today's events

✅ *Tasks*
*/task* — Create a Google Task
  --title   name _(required)_
  --for     due date
  --notes   description

*/mytask* — Show pending tasks

⏰ *Reminders*
*/reminder* — Set a WhatsApp reminder
  --title   text _(required)_
  --for     date _(required)_
  --at      HH:MM _(required)_

💡 *Ideas*
*/ideas* text — Save an idea
*/ideas* — List all ideas`;

export async function menuHandler(_parsed: ParsedCommand, from: string): Promise<void> {
  await sendMessage(from, MENU);
}
