# Secretariat

A personal WhatsApp command bot that lets you manage your calendar, tasks, reminders, and ideas — all from a WhatsApp chat. Backed by a web admin panel to configure integrations and digest schedules.

**Owner:** Single user (Santiago). Only whitelisted WhatsApp numbers can trigger commands.

---

## What it does

Send a command from WhatsApp and Secretariat handles the rest:

| Command | What it does |
|---------|-------------|
| `/schedule` | Creates an event on Google Calendar |
| `/myschedule` | Shows today's calendar events |
| `/task` | Creates a task in Google Tasks |
| `/mytask` | Lists your pending tasks |
| `/reminder` | Sets a WhatsApp reminder (fires at the scheduled time) |
| `/ideas` | Saves an idea or lists all saved ideas |
| `/menu` | Shows all commands and syntax |
| `/start` | Wakes up the bot (useful after Render cold start) |

---

## Requirements

### External services

| Service | Purpose | Free tier |
|---------|---------|-----------|
| [Kapso](https://kapso.io) | WhatsApp Cloud API — receives and sends messages | Yes |
| [Upstash QStash](https://upstash.com/qstash) | Schedules reminders and digest crons | 500 msg/day, 3 crons |
| [Upstash Redis](https://upstash.com/redis) | Persists ideas | Free |
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
│       │   └── flags.registry.ts      # Defines every flag: --title, --for, --at, --invite, etc.
│       │
│       ├── parser/
│       │   └── command.parser.ts   # Turns raw WhatsApp text into a structured ParsedCommand object
│       │                           # Reads from registries; validates flags and required fields
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
│       │   ├── reminder.handler.ts
│       │   ├── mytask.handler.ts
│       │   ├── myschedule.handler.ts
│       │   └── ideas.handler.ts
│       │
│       ├── routes/
│       │   ├── webhook.ts          # POST /webhook/whatsapp — entry point for all WhatsApp messages
│       │   │                       # Parses → routes to correct handler → always returns 200
│       │   ├── internal.ts         # POST /internal/* — called by QStash for reminders and digests
│       │   └── auth.ts             # GET /auth/google/* — handles Google OAuth callback flow
│       │
│       ├── integrations/           # External service clients and account management
│       │   ├── registry.ts         # Named account store: resolves alias or default account
│       │   ├── token-store.ts      # File-based encrypted token persistence (data/accounts.json)
│       │   ├── google/
│       │   │   ├── oauth.ts        # Google OAuth2 flow (authorize URL + callback handler)
│       │   │   ├── calendar.ts     # Google Calendar API: createEvent, getTodayEvents, getWeekEvents
│       │   │   └── tasks.ts        # Google Tasks API: createTask, getPendingTasks
│       │   └── local/
│       │       └── ideas.ts        # Ideas store backed by Upstash Redis: getIdeas, addIdea, deleteIdea
│       │
│       ├── cron/                   # Digest logic triggered by QStash cron schedules
│       │   ├── morning-digest.ts   # Fetches today's calendar events → sends WhatsApp morning summary
│       │   └── weekly-summary.ts   # Fetches next 7 days events + tasks → sends weekly WhatsApp digest
│       │
│       ├── kapso/
│       │   └── client.ts           # Thin wrapper around @kapso/whatsapp-cloud-api: sendMessage()
│       │
│       ├── qstash/
│       │   └── client.ts           # QStash wrapper: scheduleOnce(), scheduleCron(), deleteSchedule()
│       │
│       ├── admin/
│       │   └── api.ts              # REST API for the admin panel (accounts, settings, whitelist, auth)
│       │
│       └── utils/
│           ├── date.ts             # Date parsing: DD-MM-YYYY and natural language via chrono-node
│           └── encrypt.ts          # AES-256-GCM encrypt/decrypt for stored OAuth tokens
│
├── admin/                          # React + Vite admin panel (served as static files from backend)
│   └── src/
│       ├── main.tsx                # React entry point
│       ├── App.tsx                 # Router setup
│       ├── api/
│       │   └── client.ts           # Fetch wrapper for all /api/admin/* calls
│       └── pages/
│           ├── Login.tsx           # Username + password login form
│           ├── Dashboard.tsx       # Overview: connected accounts, digest status
│           ├── Accounts.tsx        # Connect/disconnect Google OAuth accounts; set default
│           ├── Whitelist.tsx       # View whitelisted WhatsApp numbers (read-only in v1)
│           └── Digests.tsx         # Configure morning digest and weekly summary (time, days, timezone)
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

All commands must be sent from a whitelisted WhatsApp number.

### `/schedule` — Create a calendar event

```
/schedule --title <name> --for <date> --at <HH:MM> [--invite <emails>] [--notes <text>] [--using <alias>]
```

```
/schedule --title Breakfast with Hernan --for tomorrow --at 09:00
/schedule --title Board review --for 22-05-2026 @18:00 --invite ana@company.com,luis@company.com
```

- `--for` accepts `DD-MM-YYYY`, `tomorrow`, `next monday`, `next week`, etc.
- `@HH:MM` is a shorthand for `--at HH:MM`
- `--using` selects a named account alias; omit to use the default calendar

### `/myschedule` — Today's events

```
/myschedule
```

Lists all calendar events for today, sorted by start time, across all connected accounts.

### `/task` — Create a Google Task

```
/task --title <name> [--for <date>] [--notes <text>]
```

```
/task --title Call Isabel
/task --title Send quarterly report --for next friday --notes include Q1 numbers
```

### `/mytask` — List pending tasks

```
/mytask
```

Lists all incomplete tasks sorted by due date.

### `/reminder` — Set a WhatsApp reminder

```
/reminder --title <text> --for <date> --at <HH:MM>
```

```
/reminder --title Call the doctor --for tomorrow --at 09:00
/reminder --title Submit invoice --for next monday @17:00
```

The reminder fires as a WhatsApp message at the scheduled time, delivered by QStash.

### `/ideas` — Save or list ideas

```
/ideas <text>        # save an idea
/ideas               # list all saved ideas
```

```
/ideas Build a habit tracker
/ideas
```

Ideas are stored in Upstash Redis and persist across restarts.

### `/menu` — Show command list

```
/menu
```

### `/start` — Wake up the bot

```
/start
```

Useful after a Render cold start (~50s on free tier). Sends a confirmation message.

---

## Admin panel

Accessible at your deployment URL (e.g. `https://secretariat.onrender.com`). Log in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

| Page | What you can do |
|------|----------------|
| **Dashboard** | See connected accounts and digest status at a glance |
| **Accounts** | Connect Google Calendar / Google Tasks via OAuth; set which is the default; disconnect accounts |
| **Whitelist** | View allowed WhatsApp numbers (edit via `WHITELISTED_NUMBERS` env var and redeploy) |
| **Digests** | Enable/configure morning digest (time, days of week) and weekly summary (day, time, timezone) |

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
4. Add all env vars in Render → Environment tab.
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

See [BACKLOG.md](./BACKLOG.md) for the full ordered queue. Highlights:

| Version | Feature |
|---------|---------|
| v1.2 | `/delete --task N` — delete a Google Task by index |
| v1.3 | Activity log in the admin panel |
| v1.4 | Natural language messages via Claude API (no `/` prefix needed) |
| v1.5 | Todoist integration |
| v1.6 | Microsoft Calendar via Azure OAuth2 |
| v1.7 | Multi-user support with persistent database |
