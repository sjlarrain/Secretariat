# Secretariat

A personal WhatsApp command bot that lets you manage your calendar, tasks, reminders, ideas, links, and weekend work list — all from a WhatsApp chat. Backed by a web admin panel to configure integrations, digest schedules, meeting plan types, and more.

**Owner:** Single user (Santiago). Only whitelisted WhatsApp numbers can trigger commands.

---

## What it does

Send a command from WhatsApp and Secretariat handles the rest:

| Command | What it does |
|---------|-------------|
| `/schedule` | Creates an event on Google Calendar |
| `/myschedule` | Shows calendar events for a day or week, or free slots for a plan type |
| `/task` | Personal task manager (add, list by project, mark done) — stored in Secretariat |
| `/gtask` | Creates a task in Google Tasks |
| `/mytask` | Lists your Google Tasks pending tasks |
| `/reminder` | Sets a WhatsApp reminder (fires at the scheduled time) |
| `/ideas` | Saves ideas, lists them, filters by project |
| `/links` | Saves a link for later, lists unread links, or archives one |
| `/work` | Adds items to a weekend work list; optional per-item reminder; Monday digest |
| `/menu` | Shows all commands and syntax |
| `/start` | Wakes up the bot (useful after Render cold start) |

You can also send a bare `https://...` URL without any command — it will be auto-saved as a link.

---

## Requirements

### External services

| Service | Purpose | Free tier |
|---------|---------|-----------|
| [Kapso](https://kapso.io) | WhatsApp Cloud API — receives and sends messages | Yes |
| [Upstash QStash](https://upstash.com/qstash) | Schedules reminders and digest crons | 500 msg/day, 3 crons |
| [Upstash Redis](https://upstash.com/redis) | Persists ideas, plans, links, and pending reminders | Free |
| [Google Cloud Console](https://console.cloud.google.com) | OAuth app for Calendar + Tasks | Free |
| [Render](https://render.com) | Hosting | Free tier (cold starts ~50s) |

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
│       │   ├── task.handler.ts     # /task — local task manager (add, list, mark done)
│       │   ├── gtask.handler.ts    # /gtask — creates task in Google Tasks
│       │   ├── reminder.handler.ts # Saves pending reminder to Redis; fires via QStash
│       │   ├── mytask.handler.ts
│       │   ├── myschedule.handler.ts  # Regular/week mode + --plan availability mode
│       │   ├── ideas.handler.ts
│       │   └── links.handler.ts    # Save, list, and archive links; auto-triggered by bare URLs
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
│       │       └── work.ts         # Work list store (Upstash Redis)
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
/schedule <title> --for <date> --at <HH:MM> [--invite <emails>] [--notes <text>] [--using <alias>]
/schedule --title <name> -f <date> -a <HH:MM>
```

```
/schedule Breakfast with Hernan -f tomorrow -a 09:00
/schedule Board review -f 22-05-2026 @18:00 -i ana@company.com,luis@company.com
```

- `--for` accepts `DD-MM-YYYY`, `tomorrow`, `next monday`, `next week`, etc.
- `@HH:MM` is a shorthand for `--at HH:MM`
- `--using` selects a named account alias; omit to use the default calendar

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

### `/gtask` — Create a Google Task

```
/gtask <name> [--for <date>] [--notes <text>]
/gtask -f <date> -n <notes>
```

```
/gtask Call Isabel
/gtask Send quarterly report -f next friday -n include Q1 numbers
```

### `/mytask` — List pending Google Tasks

```
/mytask
```

Lists all incomplete Google Tasks sorted by due date.

### `/reminder` — Set a WhatsApp reminder

```
/reminder <text> --for <date> --at <HH:MM>
/reminder <text> -f <date> -a <HH:MM>
```

```
/reminder Call the doctor -f tomorrow -a 09:00
/reminder Submit invoice -f next monday @17:00
```

The reminder fires as a WhatsApp message at the scheduled time, delivered by QStash. Times are interpreted in the configured timezone. Pending reminders are visible (and cancellable) in the admin panel → Cron Manager.

### `/work` — Weekend work list

```
/work <text>                              → add item to work list
/work <text> --for <date> --at <HH:MM>   → add item with a one-shot reminder
/work <text> -f <date> -a <HH:MM>        → same with short flags
/work <text> -f <date> @<HH:MM>          → same with @ shorthand
/work                                     → list pending items (numbered)
/work —                                   → same (bare dash also lists)
/work --done <N>                          → mark item #N as done
/work -d <N>                              → same with short flag
```

```
/work Buy groceries
/work Read the Q1 report -f saturday @10:00
/work --done 2
```

Items stay in the list until explicitly marked done — they are **not** fire-and-forget. A Monday morning digest is sent automatically with all pending items (configurable in admin panel → Cron Manager). The per-item reminder is optional: if `--for` / `--at` are provided, a one-shot QStash reminder fires at that time; marking the item done before it fires cancels the reminder.

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
| **Whitelist** | View allowed WhatsApp numbers (edit via `WHITELISTED_NUMBERS` env var) |
| **Cron Manager** | Configure morning digest and weekly summary; view and cancel pending reminders |
| **Plans** | Create and manage meeting plan types (name, days, time slots, duration, buffer) for `/myschedule --plan` |
| **Ideas** | Folder-style view by project; create, edit, delete, reassign; trash with 30-day auto-purge |
| **Links** | Tag-folder view; add links, mark as read, delete; read archive sidebar section |
| **Commands** | Reference for all commands and flags |
| **Settings** | Timezone selector, live server clock, and default task reminder time |

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
| v1.6 | Code Review & Hardening | ✅ Done — webhook sig, HKDF tokens, rate limit, XSS fixes |
| v1.7 | Local Task Manager | ✅ Done — /task command, project tags, reminder scheduling, admin Tasks page |
| v1.8 | Multi-User | User accounts, major open operation |
| v1.9 | Todoist | Task integration via Todoist API |
| v1.10 | Microsoft / Outlook | Azure OAuth2, calendar + tasks |
| v1.11 | NLP | Natural language messages via Claude API |
