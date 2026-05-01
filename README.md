# Secretariat

A personal WhatsApp command bot that lets you manage your calendar, tasks, reminders, and ideas — all from a WhatsApp chat. Backed by a web admin panel to configure integrations, digest schedules, and meeting plan types.

**Owner:** Single user (Santiago). Only whitelisted WhatsApp numbers can trigger commands.

---

## What it does

Send a command from WhatsApp and Secretariat handles the rest:

| Command | What it does |
|---------|-------------|
| `/schedule` | Creates an event on Google Calendar |
| `/myschedule` | Shows calendar events for a day, or free slots for a plan type |
| `/task` | Creates a task in Google Tasks |
| `/mytask` | Lists your pending tasks |
| `/reminder` | Sets a WhatsApp reminder (fires at the scheduled time) |
| `/ideas` | Saves ideas, lists them, filters by project |
| `/menu` | Shows all commands and syntax |
| `/start` | Wakes up the bot (useful after Render cold start) |

---

## Requirements

### External services

| Service | Purpose | Free tier |
|---------|---------|-----------|
| [Kapso](https://kapso.io) | WhatsApp Cloud API — receives and sends messages | Yes |
| [Upstash QStash](https://upstash.com/qstash) | Schedules reminders and digest crons | 500 msg/day, 3 crons |
| [Upstash Redis](https://upstash.com/redis) | Persists ideas, plans, and pending reminders | Free |
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
│       │   └── flags.registry.ts      # Defines every flag: --title, --for, --at, --plan, etc.
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
│       │   ├── task.handler.ts
│       │   ├── reminder.handler.ts # Saves pending reminder to Redis; fires via QStash
│       │   ├── mytask.handler.ts
│       │   ├── myschedule.handler.ts  # Regular mode + --plan availability mode
│       │   └── ideas.handler.ts
│       │
│       ├── routes/
│       │   ├── webhook.ts          # POST /webhook/whatsapp — entry point for all WhatsApp messages
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
│       │       ├── ideas.ts        # Ideas store (Upstash Redis)
│       │       ├── plans.ts        # Plan types store (Upstash Redis) — Lunch, Coffee, etc.
│       │       └── reminders.ts    # Pending reminders store (Upstash Redis) — cleared on fire
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
│       │   └── api.ts              # REST API for the admin panel
│       │
│       └── utils/
│           ├── date.ts             # parseDate, combineDateAndTime (tz-aware), formatDate, getMondayOfWeek, etc.
│           └── encrypt.ts          # AES-256-GCM encrypt/decrypt for stored OAuth tokens
│
├── admin/                          # React + Vite admin panel (served as static files from backend)
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                 # Router + sidebar nav
│       ├── api/
│       │   └── client.ts           # Fetch wrapper for all /api/admin/* calls
│       └── pages/
│           ├── Login.tsx
│           ├── Dashboard.tsx       # Overview: upcoming events, tasks, recent ideas
│           ├── Accounts.tsx        # Connect/disconnect Google OAuth accounts
│           ├── Whitelist.tsx       # View whitelisted WhatsApp numbers
│           ├── CronManager.tsx     # Morning digest + weekly summary config; pending reminders list
│           ├── Plans.tsx           # CRUD for meeting plan types (Lunch, Coffee, etc.)
│           ├── Ideas.tsx           # Folder-style ideas view with trash
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

All commands support short flags: `-t` (`--title`), `-f` (`--for`), `-a` (`--at`), `-i` (`--invite`), `-u` (`--using`), `-n` (`--notes`), `-p` (`--project`). The title can also be written directly after the command without a flag.

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
/myschedule                         → today's events
/myschedule -f tomorrow             → tomorrow's events
/myschedule -f next monday          → specific day
/myschedule --plan Lunch            → free Lunch slots this week
/myschedule --plan Coffee -f next week  → free Coffee slots next week
```

In regular mode, lists all calendar events for the given day sorted by start time.

In `--plan` mode, checks the week containing the given date and shows which slots in the plan are free across all connected calendars. Plan types are managed in the admin panel → Plans.

### `/task` — Create a Google Task

```
/task <name> [--for <date>] [--notes <text>]
/task -t <name> -f <date> -n <notes>
```

```
/task Call Isabel
/task Send quarterly report -f next friday -n include Q1 numbers
```

### `/mytask` — List pending tasks

```
/mytask
```

Lists all incomplete tasks sorted by due date.

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

### `/ideas` — Save or list ideas

```
/ideas <text>                  → save idea to default project
/ideas <text> -p <project>     → save to a specific project (auto-created if new)
/ideas                         → list all ideas
/ideas -p                      → list all projects
/ideas -p <project>            → list ideas in that project
```

Ideas are stored in Upstash Redis and persist across restarts. Deleted ideas go to a **trash can** in the admin panel and are permanently removed after 30 days.

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
| **Dashboard** | Upcoming events, pending tasks, recent ideas at a glance |
| **Accounts** | Connect Google Calendar / Google Tasks via OAuth; set default; disconnect |
| **Whitelist** | View allowed WhatsApp numbers (edit via `WHITELISTED_NUMBERS` env var) |
| **Cron Manager** | Configure morning digest and weekly summary; view and cancel pending reminders |
| **Plans** | Create and manage meeting plan types (name, days, time slots, duration) for `/myschedule --plan` |
| **Ideas** | Folder-style view by project; create, edit, delete, reassign; Trash with 30-day auto-purge |
| **Commands** | Reference for all commands and flags |
| **Settings** | Timezone selector with live server clock to verify the setting |

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

## Planned features

See [BACKLOG.md](./BACKLOG.md) for the full ordered queue. Next up:

| Version | Feature |
|---------|---------|
| v1.2 | `/delete --task N` — delete a Google Task by index |
| v1.3 | Activity log in the admin panel |
| v1.4 | Natural language messages via Claude API (no `/` prefix needed) |
| v1.5 | Todoist integration |
| v1.6 | Microsoft Calendar via Azure OAuth2 |
| v1.7 | Multi-user support with persistent database |
