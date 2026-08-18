import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../../shared/kapso/client';
import { Ctx } from '../../shared/ctx';

const MENU = `🤖 *Secretariat — Commands*

📅 *Calendar*
*/schedule* — Create a calendar event
  --title (-t)   name *(required)*
  --for (-f)     date *(required)* — DD-MM-YYYY or "next friday"
  --at (-a) / @  HH:MM *(required)* — or @day for an all-day event
  --duration (-d) hours (e.g. 2, 1.5) — or days with @day (e.g. 3). Default 1
  --invite (-i)  email1,email2
  --notes (-n)   description
  --using (-u)   calendar alias (e.g. GG)
  --video (-v)   add a Google Meet link _(no value)_

*/myschedule* — Show calendar events
  _(no flags)_   today's schedule
  week            full week view
  --for (-f)      specific day
  --plan (-p)     free slots for a plan type (e.g. Lunch)
                  omit value to list all plans
                  add --for to check a specific day

✅ *Tasks*
*/task* text               — Save a task (syncs to Google Tasks)
  --project (-p) / #  project folder
  --for (-f)     due date
  --at (-a) / @  HH:MM
  --notes (-n)   description
*/task*                    — List open tasks
*/task done* N             — Mark task #N as done

⏰ *Reminders*
*/reminder* — One-shot WhatsApp reminder (no tracking)
  --title (-t)   text *(required)*
  --for (-f)     date *(required)*
  --at (-a) / @  HH:MM *(required)*

🎓 *MBA List*
*/mba* text               — Add item to MBA list
*/mba* text --due date    — Add with due date (auto-reminds 24h before)
*/mba* text --for (-f) date --at (-a) time — Add with extra reminder
*/mba* —                  List pending items
*/mba* --done (-d) N      — Mark item #N as done

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
*/links* #N --name (-n) text — Name link #N
*/links* #N               — Get the URL behind link #N
Reply _--name text_ after saving to name it right away

⚙️ *System*
*/status*                 — Connections, Kapso health, usage
*/zone*                   — Show current timezone
*/zone* America/Santiago  — Set timezone (city name tracks DST)
*/zone* GMT-3             — Set timezone by fixed offset
*/panel*                  — Get a one-time link to your panel

_Send /start to wake up the bot._`;

export async function menuHandler(_parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  await sendMessage(ctx.userId, MENU);
}
