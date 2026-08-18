// Worked-example registry — the third source of truth alongside
// `commands.registry.ts` (what exists) and `flags.registry.ts` (how it is
// spelled). This one answers "what do I actually type", which is the part new
// users get stuck on, and it is what `/example` renders.
//
// Deliberately free of runtime imports so it stays testable without env — see
// the EXAMPLES invariants in `registry.test.ts`.
//
// Keys must match `COMMANDS` keys. Each entry is a list of
// `[what it does, what you send]` pairs; keep the command lines
// copy-pasteable — no placeholder brackets, real-looking values.
export const EXAMPLES: Record<string, [string, string][]> = {
  schedule: [
    ['Book a meeting tomorrow at 3pm', '/schedule -t Dentist -f tomorrow @15:00'],
    ['Two-hour block next Friday', '/schedule -t Deep work -f next friday -a 09:00 -d 2'],
    ['With a Meet link and guests', '/schedule -t Sync -f monday @10:00 -v -i ana@x.com,jo@x.com'],
    ['All-day event', '/schedule -t Conference -f 12-09-2026 @day'],
  ],
  myschedule: [
    ["Today's events", '/myschedule'],
    ['The whole week', '/myschedule week'],
    ['A specific day', '/myschedule -f thursday'],
    ['Free slots for lunch this week', '/myschedule -p Lunch'],
  ],
  task: [
    ['Add a task', '/task Send the invoice'],
    ['With a project and a due date', '/task Draft deck #work -f friday'],
    ['List open tasks', '/task'],
    ['Mark task #3 done', '/task done 3'],
  ],
  reminder: [
    ['Nudge me later today', '/reminder -t Call the bank -f today @16:30'],
    ['Nudge me next week', '/reminder -t Renew passport -f next tuesday @09:00'],
  ],
  mba: [
    ['Add an item', '/mba Finish problem set 3'],
    ['With a deadline (reminds you 24h before)', '/mba Submit essay --due friday'],
    ['With an extra nudge of your own', '/mba Read chapter 4 -f saturday @10:00'],
    ['Mark item #2 done', '/mba --done 2'],
  ],
  ideas: [
    ['Save an idea', '/ideas App that renames my screenshots'],
    ['File it under a project', '/ideas Weekly review ritual -p Habits'],
    ['List your projects', '/ideas --project'],
  ],
  links: [
    ['Save a link', '/links https://example.com/post'],
    ['Tag link #4', '/links #4 -t reading ai'],
    ['Name link #4', '/links #4 --name Great piece on caching'],
    ['Archive link #4 once read', '/links -r 4'],
  ],
  zone: [
    ['Check your timezone', '/zone'],
    ['Set it by city (tracks DST)', '/zone America/Santiago'],
    ['Set it by fixed offset', '/zone GMT-3'],
  ],
  panel: [
    ['Get a link to your web panel', '/panel'],
  ],
  status: [
    ['Check connections and bot health', '/status'],
  ],
};
