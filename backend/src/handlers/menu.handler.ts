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
  --using   calendar alias

*/myschedule* — Show calendar events for a day
  --for     date _(today by default)_
  --plan    plan type _(e.g. Lunch, Coffee)_

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
*/ideas* text — Save an idea (goes to default project)
*/ideas* text --project Name — Save to a specific project
*/ideas* — List all ideas
*/ideas* --project — List your projects
*/ideas* --project Name — List ideas in that project`;

export async function menuHandler(_parsed: ParsedCommand, from: string): Promise<void> {
  await sendMessage(from, MENU);
}
