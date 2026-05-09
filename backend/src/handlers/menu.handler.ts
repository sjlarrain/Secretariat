import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';

const MENU = `🤖 *Secretariat — Commands*

📅 *Calendar*
*/schedule* — Create a calendar event
  --title (-t)   name *(required)*
  --for (-f)     date *(required)* — DD-MM-YYYY or "next friday"
  --at (-a) / @  HH:MM *(required)*
  --invite (-i)  email1,email2
  --notes (-n)   description
  --using (-u)   calendar alias (e.g. GG)

*/myschedule* — Show calendar events
  _(no flags)_   today's schedule
  week            full week view
  --for (-f)      specific day
  --plan (-p)     free slots for a plan type (e.g. Lunch)
                  omit value to list all plans
                  add --for to check a specific day

✅ *Tasks*
*/task* — Create a Google Task
  --title (-t)   name
  --for (-f)     due date
  --notes (-n)   description

*/mytask* — Show pending tasks

⏰ *Reminders*
*/reminder* — One-shot WhatsApp reminder (no tracking)
  --title (-t)   text *(required)*
  --for (-f)     date *(required)*
  --at (-a) / @  HH:MM *(required)*

🗂 *Work List*
*/work* text               — Add item to work list
*/work* text --for (-f) date --at (-a) time — Add with reminder
*/work* —                  List pending items
*/work* --done (-d) N      — Mark item #N as done

💡 *Ideas*
*/ideas* text                  — Save idea (default project)
*/ideas* text --project (-p) Name — Save to specific project
*/ideas*                       — List all ideas
*/ideas* --project             — List projects
*/ideas* --project (-p) Name   — Ideas in that project

🔗 *Links*
*/links* url              — Save a link
*/links*                  — List active links
*/links* --read (-r) N    — Archive link #N
*/links* #N --tags (-t) tag1 tag2 — Add tags to link #N

_Send /start to wake up the bot._`;

export async function menuHandler(_parsed: ParsedCommand, from: string): Promise<void> {
  await sendMessage(from, MENU);
}
