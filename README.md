# Secretariat

A personal WhatsApp command bot that lets you manage your calendar, tasks, reminders, ideas, links, and weekend work list — all from a WhatsApp chat. Backed by a web admin panel to configure integrations, digest schedules, meeting plan types, and more.

**Owner:** Single user (Santiago). Whitelisted numbers get full command access. Third-party contacts (e.g. family) can send `/set` to create events that Santiago reviews and confirms.

---

## What it does

Send a command from WhatsApp and Secretariat handles the rest:

| Command | What it does |
|---------|-------------|
| `/schedule` | Creates an event on Google Calendar; `-v` adds a Google Meet link |
| `/myschedule` | Shows calendar events for a day or week, or free slots for a plan type |
| `/task` | Personal task manager (add, list by project, mark done), two-way synced to Google Tasks |
| `/reminder` | Sets a WhatsApp reminder (fires at the scheduled time) |
| `/ideas` | Saves ideas, lists them, filters by project |
| `/links` | Saves a link for later, lists unread links, or archives one |
| `/mba` | Adds items to an MBA to-do list; due dates auto-remind 24h before; Monday digest |
| `/status` | Shows connections, Kapso health, and monthly message usage |
| `/zone` | Shows or sets the platform timezone; reschedules all digests |
| `/menu` | Shows all commands and syntax |
| `/start` | Wakes up the bot (useful after Render cold start) |

You can also send a bare `https://...` URL without any command — it will be auto-saved as a link.

Third-party contacts (registered in the admin panel) have access to a limited command set:

| Command | What it does |
|---------|-------------|
| `/set <title> -f <date> -a <time>` | Proposes an event to Santiago — auto-saved as reminder, reclassifiable via buttons |
| `/menu` | Shows available flags and usage examples |

---

## Requirements

### External services

| Service | Purpose | Free tier |
|---------|---------|-----------|
| [Kapso](https://kapso.io) | WhatsApp Cloud API — receives and sends messages | Yes |
| [Upstash QStash](https://upstash.com/qstash) | Schedules reminders and digest crons | Free tier: 1,000 msg/day, 10 active schedules, 7-day max delay |
| [Upstash Redis](https://upstash.com/redis) | Persists ideas, plans, links, and pending reminders | Free |
| [Google Cloud Console](https://console.cloud.google.com) | OAuth app for Calendar + Tasks | Free |
| [Render](https://render.com) | Hosting | Free tier (cold starts ~50s) |

> **QStash schedule budget.** Secretariat registers up to **six** recurring schedules: morning digest, weekly summary, MBA Monday reminder, reminder promoter, Google Tasks sync (every 15 min), and the nightly health check. The free tier allows **10 active schedules**, so all six fit with room to spare. Each is individually toggleable in admin panel → Settings → Cron Manager.
>
> Message volume also fits: the 15-minute sync is the heaviest job at ~96 messages/day against a 1,000/day free-tier limit.
>
> If a schedule ever fails to be created, the error is logged and the toggle stays on with no schedule ID — the job then silently never fires. The nightly health check reports exactly this case ("enabled but has no QStash schedule").

> **The 7-day delay limit is the free tier's real constraint**, not the schedule count. QStash will not accept a one-off message delayed more than 7 days, which is why `/reminder` defers anything further out and why the **reminder promoter** exists. The promoter is always on and has no toggle — deferred reminders depend entirely on it. See [`/reminder`](#reminder--set-a-whatsapp-reminder).

### Environment variables

Set in `.env` (local) and in the Render dashboard (production). The app crashes on startup if any are missing.

```env
# Admin panel
ADMIN_USERNAME=admin
ADMIN_PASSWORD=                        # your chosen password

# Kapso (WhatsApp)
KAPSO_API_KEY=                         # from Kapso dashboard
KAPSO_PHONE_NUMBER_ID=                 # from Kapso dashboard
WHITELISTED_NUMBERS=+15550000000       # comma-separated E.164 numbers

# Upstash QStash
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
QSTASH_URL=                            # regional endpoint, e.g. https://qstash-us-east-1.upstash.io

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-app.onrender.com/auth/google/callback

# Security
TOKEN_ENCRYPTION_KEY=                  # exactly 32 characters (AES-256 key)

# App
BASE_URL=https://your-app.onrender.com
PORT=3000
NODE_ENV=production
```

---

## Project structure

```
/
├── backend/                        # Node.js + TypeScript + Express API
│   └── src/
│       ├── index.ts                # Express app entry — mounts all routers, serves admin panel
│       ├── env.ts                  # Zod env validation — imported first; crashes if vars are missing
│       │
│       ├── registries/             # Single source of truth for commands and flags
│       │   ├── commands.registry.ts   # Defines every command: name, accepted flags, required flags
│       │   └── flags.registry.ts      # Defines every flag: --title, --for, --at, --plan, --tags, --read, etc.
│       │
│       ├── parser/
│       │   └── command.parser.ts   # Turns raw WhatsApp text into a structured ParsedCommand object
│       │
│       ├── middleware/
│       │   ├── whitelist.ts        # Rejects messages from non-whitelisted numbers
│       │   └── qstash-verify.ts    # Verifies QStash webhook signatures on internal routes
│       │
│       ├── handlers/               # One file per command — receives ParsedCommand, sends WhatsApp reply
│       │   ├── start.handler.ts
│       │   ├── menu.handler.ts
│       │   ├── schedule.handler.ts
│       │   ├── task.handler.ts        # /task — local task manager, two-way synced to Google Tasks
│       │   ├── mba.handler.ts         # /mba — MBA to-do list with due dates (was ucla.handler.ts)
│       │   ├── zone.handler.ts        # /zone — show/set timezone, regenerates all schedules
│       │   ├── status.handler.ts      # /status — connections, Kapso health, usage
│       │   ├── reminder.handler.ts    # Saves pending reminder to Redis; fires via QStash
│       │   ├── mytask.handler.ts
│       │   ├── myschedule.handler.ts  # Regular/week mode + --plan availability mode
│       │   ├── ideas.handler.ts
│       │   ├── links.handler.ts       # Save, list, and archive links; auto-triggered by bare URLs
│       │   ├── third-party.handler.ts # /set and /menu for third-party contacts
│       │   └── button-reply.handler.ts # Interactive button taps (snooze, done, tp_ reclassify)
│       │
│       ├── routes/
│       │   ├── webhook.ts          # POST /webhook/whatsapp — entry point; auto-detects bare URLs
│       │   ├── internal.ts         # POST /internal/* — called by QStash for reminders and digests
│       │   └── auth.ts             # GET /auth/google/* — handles Google OAuth callback flow
│       │
│       ├── integrations/
│       │   ├── registry.ts         # Named account store: resolves alias or default account
│       │   ├── token-store.ts      # File-based encrypted token persistence (data/accounts.json)
│       │   ├── google/
│       │   │   ├── oauth.ts        # Google OAuth2 flow
│       │   │   ├── calendar.ts     # Google Calendar API: createEvent, getEventsForDate, etc.
│       │   │   └── tasks.ts        # Google Tasks API: createTask, getPendingTasks
│       │   └── local/
│       │       ├── ideas.ts        # Ideas + projects store (Upstash Redis)
│       │       ├── plans.ts        # Plan types store (Upstash Redis) — Lunch, Coffee, etc.
│       │       ├── reminders.ts    # Pending reminders store (Upstash Redis) — cleared on fire
│       │       ├── links.ts        # Links store (Upstash Redis) — unread/read archive
│       │       ├── tasks.ts        # Local tasks store (Upstash Redis) — secretariat:tasks
│       │       ├── work.ts         # Work list store (Upstash Redis)
│       │       └── third-party.ts  # Third-party contacts + pending events (Upstash Redis)
│       │
│       ├── cron/
│       │   ├── morning-digest.ts   # Fetches today's events → sends WhatsApp morning summary
│       │   └── weekly-summary.ts   # Fetches next 7 days events + tasks → sends weekly digest
│       │
│       ├── kapso/
│       │   └── client.ts           # Thin wrapper around Kapso API: sendMessage()
│       │
│       ├── qstash/
│       │   └── client.ts           # QStash wrapper: scheduleOnce(), scheduleCron(), deleteSchedule(), cancelMessage()
│       │
│       ├── admin/
│       │   └── api.ts              # REST API for the admin panel (/api/admin/*)
│       │
│       └── utils/
│           ├── date.ts             # parseDate, combineDateAndTime (tz-aware), formatDate, getMondayOfWeek, getWeekDates
│           └── encrypt.ts          # AES-256-GCM encrypt/decrypt for stored OAuth tokens
│
├── admin/                          # React + Vite admin panel (served as static files from backend)
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                 # Router + sidebar nav
│       ├── api/
│       │   └── client.ts           # Fetch wrapper for all /api/admin/* calls + shared interfaces
│       └── pages/
│           ├── Login.tsx
│           ├── Dashboard.tsx       # Overview: upcoming events, tasks, recent ideas
│           ├── Accounts.tsx        # Connect/disconnect Google OAuth accounts + sub-calendar selection
│           ├── Whitelist.tsx       # View whitelisted WhatsApp numbers
│           ├── CronManager.tsx     # Morning digest + weekly summary config; pending reminders list
│           ├── Plans.tsx           # CRUD for meeting plan types (Lunch, Coffee, etc.)
│           ├── Tasks.tsx           # Local task manager: list, filter by project, mark done
│           ├── Ideas.tsx           # Folder-style ideas view with trash and inline editing
│           ├── Links.tsx           # Link manager: tag folders, unread list, read archive
│           ├── Commands.tsx        # Reference for all available commands and flags
│           └── Settings.tsx        # Timezone selector + live server clock
│
├── data/                           # Runtime data (gitignored)
│   └── accounts.json               # Encrypted OAuth tokens — ephemeral on Render free tier
│
├── BACKLOG.md                      # Ordered feature queue
├── CLAUDE.md                       # Rules for Claude Code (commit conventions, project context)
├── context.md                      # Full architecture spec and implementation decisions
└── README.md                       # This file
```

---

## Command reference

All commands support short flags: `-t` (`--title`), `-f` (`--for`), `-a` (`--at`), `-i` (`--invite`), `-u` (`--using`), `-n` (`--notes`), `-p` (`--project` for `/ideas`, `--plan` for `/myschedule`), `-t` (`--tags` for `/links`), `-r` (`--read` for `/links`). The title can also be written directly after the command without a flag.

All commands must be sent from a whitelisted WhatsApp number.

### `/schedule` — Create a calendar event

```
/schedule <title> --for <date> --at <HH:MM> [--invite <emails>] [--notes <text>] [--using <alias>] [--video]
/schedule --title <name> -f <date> -a <HH:MM>
```

```
/schedule Breakfast with Hernan -f tomorrow -a 09:00
/schedule Board review -f 22-05-2026 @18:00 -i ana@company.com,luis@company.com
/schedule Standup -f monday @09:00 -v
```

- `--for` accepts `DD-MM-YYYY`, `tomorrow`, `next monday`, `next week`, etc.
- `@HH:MM` is a shorthand for `--at HH:MM`
- `--using` selects a named account alias; omit to use the default calendar
- `--video` (`-v`) attaches a Google Meet link and returns the join URL in the reply. It takes no value — just add the flag. Only `/schedule` supports it; events created by third-party contacts via `/set` do not.

### `/myschedule` — Calendar events or free slots

```
/myschedule                              → today's events
/myschedule week                         → full 7-day week view
/myschedule -f tomorrow                  → tomorrow's events
/myschedule -f next monday               → specific day
/myschedule --plan                       → list all configured plan types
/myschedule -p Lunch                     → free Lunch slots this week
/myschedule -p Lunch -f next monday      → free Lunch slots the week of next Monday
/myschedule -p Lunch -f 15-05-2026       → yes/no availability for that specific day
```

In regular mode, lists all calendar events for the given day sorted by start time. Events are deduplicated across calendars and "Canceled:" events are automatically filtered out.

`/myschedule week` shows all 7 days of the current week, day by day, with their events.

In `--plan` / `-p` mode:
- Without `--for`: shows the full week day by day with free slots
- With `--for`: returns a single yes/no answer for that specific date

Each plan defines its own **buffer** (minutes kept free before and after the slot as travel time). Plan types are managed in the admin panel → Plans.

### `/task` — Personal task manager

```
/task <title>                               → save a task
/task <title> -p <project>                  → save with project tag
/task <title> #<project>                    → # shorthand for project
/task <title> --for <date>                  → save with due date (reminder at default time)
/task <title> --for <date> --at <HH:MM>     → save with due date and specific reminder time
/task <title> -f <date> @<HH:MM>            → same with short flags
/task                                        → list all open tasks grouped by project
/task -p <project>                           → list tasks in that project
/task -p                                     → list all project names
/task done <id>                              → mark task #id as done (cancels reminder)
```

```
/task Buy milk
/task Submit Q1 report -p work --for next friday
/task Buy milk #groceries --for friday @10:00
/task done 3
```

Tasks are stored in Secretariat's Redis. When a due date is set, a WhatsApp reminder fires at the due time (defaults to the "Default task reminder time" in admin Settings → Time Configuration). Marking a task done cancels any pending reminder.

> **Retired in v1.14:** `/gtask` no longer exists. `/task` is the single entry point for tasks — it keeps a local list and two-way syncs it to Google Tasks, and now accepts `--notes` (`-n`), which was `/gtask`'s only unique capability. Turn syncing off in admin panel → Settings → Cron Manager → Google Tasks Sync; with it off, `/task` stays fully local and never pushes to Google.

### `/reminder` — Set a WhatsApp reminder

```
/reminder <text> --for <date> --at <HH:MM>
/reminder <text> -f <date> -a <HH:MM>
```

```
/reminder Call the doctor -f tomorrow -a 09:00
/reminder Submit invoice -f next monday @17:00
```

The reminder fires as a WhatsApp message at the scheduled time, delivered by QStash. Times are interpreted in the configured timezone. Pending reminders are visible (and cancellable) in the admin panel → **Reminders**.

**Reminders more than 7 days out are deferred.** QStash will not accept a message delayed beyond 7 days (free tier), so a reminder further out is stored as *deferred* with no queued message — the reply says "Reminder set (deferred)". The **reminder promoter** cron converts it into a real queued reminder once it comes within the 7-day window. Reminders inside 7 days are queued immediately.

> The promoter is **always on and cannot be disabled** — deferred reminders have no queued message and depend entirely on it, so turning it off would silently strand them. It has no on/off toggle in the admin panel; only its run time (default Sunday 08:00) is configurable. The invariant is enforced in `token-store.ts` (on read and write) and in `reconcileSchedules()`, and the `enabled` field is typed as the literal `true` so the compiler rejects any code that tries to unset it.

### `/mba` — MBA to-do list

```
/mba <text>                              → add item to MBA list
/mba <text> --due <date>                → add item with a due date
/mba <text> -u <date>                   → same with short flag
/mba <text> --for <date> --at <HH:MM>   → add item with an extra one-shot reminder
/mba <text> -f <date> -a <HH:MM>        → same with short flags
/mba <text> -f <date> @<HH:MM>          → same with @ shorthand
/mba                                     → list pending items (numbered)
/mba —                                   → same (bare dash also lists)
/mba --done <N>                          → mark item #N as done
/mba -d <N>                              → same with short flag
```

```
/mba Finish problem set 3
/mba Submit essay --due friday
/mba Read the Q1 report -f saturday @10:00
/mba --done 2
```

Items stay in the list until explicitly marked done — they are **not** fire-and-forget. A Monday morning digest is sent automatically with all pending items (configurable in admin panel → Settings → Cron Manager).

Two independent reminders are available:

- **`--due <date>`** sets a due date and automatically schedules a reminder for **24 hours before** it. Items due within 48 hours also appear in the morning digest. If the item is already due in under 24h, no automatic reminder is scheduled (it would fire in the past) and the reply says so.
- **`--for` / `--at`** adds an extra one-shot reminder at any time you choose, independent of the due date.

Marking an item done cancels both.

> **Renamed in v1.14:** this was `/work`. Existing items, the Monday reminder, and any in-flight reminders migrate automatically — `/work` itself is no longer a valid command. `-u` (not `-d`) is the short flag for `--due`, because `-d` is already `--done`.

### `/ideas` — Save or list ideas

```
/ideas <text>                  → save idea to default project
/ideas <text> -p <project>     → save to a specific project (auto-created if new)
/ideas                         → list all ideas
/ideas -p                      → list all projects
/ideas -p <project>            → list ideas in that project
```

Ideas are stored in Upstash Redis and persist across restarts. Deleted ideas go to a **trash can** in the admin panel and are permanently removed after 30 days.

### `/links` — Save and manage links

```
/links <url>                        → save a link
/links <url> --tags tag1 tag2       → save with kebab-case tags
/links <url> -t tag1 tag2           → same with short flag
/links                              → list all unread links (numbered)
/links --read <N>                   → mark link #N as read (archive it)
/links -r <N>                       → same with short flag
```

You can also send a bare URL (e.g. `https://example.com`) without any `/command` prefix — it will be auto-saved as a link.

Tags are kebab-case and space-separated (e.g. `-t fintech-elements tech-news`). A link can have multiple tags. Unread links are numbered oldest-first in `/links` output; that same numbering is used for `--read N`.

Read links are archived rather than deleted — accessible in the admin panel → Links.

### `/status` — System status

```
/status
```

Shows connected Google accounts (flagging any that are disconnected), Kapso health, and this month's message usage.

### `/zone` — Show or set the timezone

```
/zone                        → show the current timezone and local time
/zone America/Santiago       → set by IANA city name (tracks DST)
/zone Europe/Madrid
/zone GMT-3                  → set by fixed offset (does NOT track DST)
```

The timezone drives every date/time in WhatsApp replies and every recurring schedule. Changing it **immediately deletes and recreates** the morning digest, weekly summary, MBA reminder, reminder promoter, and health check so they keep firing at the same local wall-clock time. Existing one-off reminders keep their original absolute time.

Two input formats are accepted:

- **A city name** (`America/Santiago`) is stored as-is and follows daylight saving automatically. Prefer this.
- **A fixed offset** (`GMT-3`) is stored as an `Etc/GMT` pseudo-zone and is permanently DST-naive — it will drift by an hour across a DST boundary. The reply warns you when this happens.

> Note the `Etc/GMT` sign convention is inverted: `/zone GMT-3` (UTC−3, Santiago) is stored as `Etc/GMT+3`. This is handled for you — type the offset the normal way.

Schedules are registered with QStash using a `CRON_TZ=<zone>` prefix, so QStash resolves the local time itself rather than Secretariat pre-computing a UTC offset. This is what keeps digests correct across DST.

The same timezone can also be set in admin panel → Settings → Time Configuration, which accepts both formats and shows the resulting offset.

### `/menu` — Show command list

```
/menu
```

### `/start` — Wake up the bot

```
/start
```

Useful after a Render cold start (~50s on free tier).

---

## Admin panel

Accessible at your deployment URL (e.g. `https://secretariat.onrender.com`). Log in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

| Page | What you can do |
|------|----------------|
| **Dashboard** | Upcoming events, pending local tasks, recent ideas at a glance |
| **Tasks** | Local task manager: create, filter by project, mark done, view completed |
| **Accounts** | Connect Google Calendar / Google Tasks via OAuth; set default; select which sub-calendars to include; disconnect |
| **Whitelist** | View owner numbers (edit via `WHITELISTED_NUMBERS` env var); manage third-party contacts with name + number |
| **Reminders** | View, edit, snooze, and cancel pending one-off reminders (split out of Cron Manager in v1.14) |
| **MBA** | Add items with optional due dates, snooze, mark done (was the UCLA page) |
| **Tasks** | Local task manager, two-way synced to Google Tasks |
| **Plans** | Create and manage meeting plan types (name, days, time slots, duration, buffer) for `/myschedule --plan` |
| **Ideas** | Folder-style view by project; create, edit, delete, reassign; trash with 30-day auto-purge |
| **Links** | Tag-folder view; add links, mark as read, delete; read archive sidebar section |
| **Commands** | Reference for all commands and flags |
| **Settings** | Hub for Accounts, Whitelist, Plans, Commands, Time Configuration, and Cron Manager |
| **Settings → Time Configuration** | Timezone (city name or `GMT±N`), live server clock, default task reminder time |
| **Settings → Cron Manager** | Morning digest, weekly summary, MBA Monday reminder, Google Tasks sync, and nightly health check — each individually toggleable. The reminder promoter also appears here but has no toggle: it is always on, and only its run time can be changed |

A **health banner** appears at the top of every page when the nightly health check finds a problem (disconnected Google account, Kapso degraded, a missing QStash schedule, Redis unreachable), with a link to resolve it. This banner is the reliable surface for health alerts — the WhatsApp notification is best-effort and can be dropped outside Meta's 24-hour session window.

---

## Deployment (Render)

1. Push to your Render-connected repo branch.
2. **Build command:**
   ```bash
   cd admin && npm install && npm run build && cd ../backend && npm install && npm run build
   ```
3. **Start command:**
   ```bash
   node backend/dist/index.js
   ```
4. Add all env vars in Render → Environment tab (including `QSTASH_URL` for regional routing).
5. After first deploy, run the post-deploy checklist:
   - Google Cloud Console → add `https://your-app.onrender.com/auth/google/callback` as an authorized redirect URI
   - Kapso dashboard → set webhook URL to `https://your-app.onrender.com/webhook/whatsapp`
   - Admin panel → Accounts → connect Google Calendar and Google Tasks

> **Note:** Render free tier has ephemeral disk storage. `data/accounts.json` (OAuth tokens) is lost on redeploy. Re-connect Google accounts from the admin panel after each deploy.

---

## Local development

```bash
cp .env.example .env      # fill in your values
cd backend && npm install && npm run dev
```

The backend starts on `http://localhost:3000`. Build the admin panel separately if needed:

```bash
cd admin && npm install && npm run dev   # Vite dev server on :5173
```

---

## Claude Code — MCP recommendation

If you develop this project with [Claude Code](https://claude.ai/code), it is recommended to add the Kapso MCP server scoped to this project for API documentation lookups:

```bash
claude mcp add kapso https://docs.kapso.ai/mcp --transport http --scope project
```

**Important:** Use this MCP for documentation reference only — do not use it to send messages or interact with the live Kapso API. The `.claude/` directory is already gitignored so the config will not be committed.

---

## Roadmap

See [BACKLOG.md](./BACKLOG.md) for the full ordered queue.

| Version | Name | Focus |
|---------|------|-------|
| v1.2 | Flags Manager | ✅ Done — calendar, plans, schedule improvements |
| v1.3 | Links Manager | ✅ Done — save & tag URLs from WhatsApp |
| v1.4 | Fixes & /work | ✅ Done — bug fixes, /work list, Ideas done, disconnection detection |
| v1.7 | Local Task Manager | ✅ Done — /task command, project tags, reminder scheduling, admin Tasks page |
| v1.8 | Snooze | ✅ Done — snooze/remind for reminders, tasks, work; WhatsApp interactive buttons; admin modal |
| v1.9 | Multi-User (precursors) | ✅ Done (partial) — third-party contacts: /set, /menu, reclassify buttons, done notification |
| v1.13 | Google Tasks Sync | ✅ Done — two-way `/task` ↔ Google Tasks sync, 15-min poll, admin toggle |
| v1.14 | Review & Feature Request | ✅ Done — `/zone` + `CRON_TZ` digest-time fix, `/gtask` retired into `/task`, `/work` → `/ucla` with due dates, Kapso retry, nightly health check, `/schedule -v` Meet links, `/mantis` CRM inbox capture, admin nav split |
| v1.15 | Webhook Hardening | Re-enable webhook HMAC signature verification once Kapso supports it |
| v2.0 | Multi-User Platform | Full multi-user support — shared state, per-user permissions, multiple owners |
| v2.1 | Secretariat for Groups | 🔒 Blocked — WhatsApp group chat support |
| v2.2 | Admin Secrets Manager | Configure Kapso/QStash/Google/Upstash secrets from the admin panel |
| v2.3 | Slack Integration | Proactive Slack notification when an important message is awaiting a reply/action |
| v2.4 | Microsoft / Outlook | Azure OAuth2, calendar + tasks |
| v2.5 | NLP | Natural language messages via Claude API |
| v2.6 | Reliability & Delivery | Meta-approved message template for proactive digests + alerts |
