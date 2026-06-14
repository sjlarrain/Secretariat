# WhatsApp Command Bot — context.md
> This file is the single source of truth for Claude Code to implement the project.
> Read it fully before writing any code. Every decision is final unless explicitly marked as TBD.

---

## 1. Project Overview

A personal WhatsApp-based command bot that lets the owner send structured commands to schedule calendar events, create tasks, set reminders, and receive daily/weekly digests. All via WhatsApp messages. A web-based admin panel manages integrations, accounts, and digest schedules.

**Owner:** Single user (Santiago). Whitelisted numbers have full command access. Third-party contacts (registered in the admin panel) can send `/set` and `/menu` to propose events that Santiago reviews via interactive buttons.

---

## 2. Repository Structure

```
/
├── backend/                  # Node.js + TypeScript + Express
│   ├── src/
│   │   ├── index.ts                  # Express app entry point
│   │   ├── env.ts                    # Zod env validation — import this first everywhere
│   │   ├── registries/
│   │   │   ├── flags.registry.ts     # Central flag definitions
│   │   │   └── commands.registry.ts  # Central command definitions
│   │   ├── parser/
│   │   │   └── command.parser.ts     # Parses raw WhatsApp text into structured commands
│   │   ├── middleware/
│   │   │   ├── whitelist.ts          # Allows whitelisted + third-party numbers; tags isThirdParty on request
│   │   │   └── qstash-verify.ts      # Verifies QStash webhook signatures
│   │   ├── handlers/
│   │   │   ├── start.handler.ts
│   │   │   ├── schedule.handler.ts
│   │   │   ├── task.handler.ts
│   │   │   ├── reminder.handler.ts
│   │   │   ├── mytask.handler.ts
│   │   │   ├── myschedule.handler.ts
│   │   │   ├── third-party.handler.ts  # /set and /menu for third-party contacts
│   │   │   └── button-reply.handler.ts # Snooze/done buttons + tp_ reclassify buttons
│   │   ├── cron/
│   │   │   ├── morning-digest.ts     # Called by QStash cron
│   │   │   └── weekly-summary.ts     # Called by QStash cron
│   │   ├── integrations/
│   │   │   ├── registry.ts           # Named account store + default resolution
│   │   │   ├── token-store.ts        # Encrypted token persistence (file-based)
│   │   │   ├── google/
│   │   │   │   ├── oauth.ts          # Google OAuth flow
│   │   │   │   ├── calendar.ts       # Google Calendar API calls
│   │   │   │   └── tasks.ts          # Google Tasks API calls
│   │   │   └── local/
│   │   │       ├── reminders.ts      # Pending reminders (secretariat:reminders)
│   │   │       ├── tasks.ts          # Local tasks (secretariat:tasks)
│   │   │       ├── ideas.ts          # Ideas + projects (secretariat:ideas, secretariat:projects)
│   │   │       ├── links.ts          # Saved links (secretariat:links)
│   │   │       ├── plans.ts          # Meeting plan types (secretariat:plans)
│   │   │       ├── work.ts           # Weekend work list (secretariat:work)
│   │   │       └── third-party.ts    # Third-party contacts + pending events (secretariat:third-party-*)
│   │   ├── kapso/
│   │   │   └── client.ts             # Kapso SDK wrapper — send WhatsApp messages
│   │   ├── qstash/
│   │   │   └── client.ts             # QStash API wrapper — schedule jobs
│   │   ├── routes/
│   │   │   ├── webhook.ts            # POST /webhook/whatsapp (Kapso → backend)
│   │   │   ├── internal.ts           # POST /internal/reminder/fire, /internal/digest/*
│   │   │   └── auth.ts               # GET /auth/google/*, /auth/microsoft/*
│   │   ├── admin/
│   │   │   └── api.ts                # Admin panel REST API routes
│   │   └── utils/
│   │       ├── date.ts               # Date parsing (DD-MM-YYYY + natural language)
│   │       └── encrypt.ts            # Token encryption/decryption
│   ├── package.json
│   └── tsconfig.json
│
├── admin/                    # React + Vite frontend
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx         # Overview of connected accounts + digest status
│   │   │   ├── Accounts.tsx          # Connect/disconnect Google + Microsoft
│   │   │   ├── Whitelist.tsx         # Manage allowed WhatsApp numbers
│   │   │   └── Digests.tsx           # Configure morning digest + weekly summary
│   │   └── api/
│   │       └── client.ts             # Fetch wrapper for admin API
│   ├── package.json
│   └── vite.config.ts
│
├── .env.example              # All required env vars with descriptions
└── README.md
```

---

## 3. Environment Variables

Define all in `.env` (local) and in Render dashboard (production).
Validate on startup using Zod in `backend/src/env.ts` — crash if any are missing.

```env
# Admin panel
ADMIN_PASSWORD=                    # Password to log in to admin panel

# Kapso (WhatsApp)
KAPSO_API_KEY=                     # From Kapso dashboard
KAPSO_PHONE_NUMBER_ID=             # From Kapso dashboard
WHITELISTED_NUMBERS=               # Comma-separated E.164 numbers e.g. +15550000000

# Upstash QStash
QSTASH_TOKEN=                      # From Upstash QStash dashboard
QSTASH_CURRENT_SIGNING_KEY=        # From Upstash QStash dashboard
QSTASH_NEXT_SIGNING_KEY=           # From Upstash QStash dashboard

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-app.onrender.com/auth/google/callback

# Microsoft OAuth
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=

# Security
TOKEN_ENCRYPTION_KEY=              # 32-character random string for AES-256 token encryption

# App
BASE_URL=https://your-app.onrender.com
PORT=3000
NODE_ENV=production
```

---

## 4. Flag Registry — `flags.registry.ts`

This is the **single source of truth** for all flags. The parser, validator, and `/start` help menu all read from this file. Adding a new flag = adding one entry here. No other files need changes.

```typescript
export type FlagType = 'string' | 'date' | 'time' | 'email-list' | 'account-alias';

export interface FlagDefinition {
  name: string;           // e.g. '--title'
  alias?: string;         // e.g. '@' for --at
  type: FlagType;
  required: boolean;      // default false — overridden per command in commands.registry
  description: string;    // shown in /start menu
}

export const FLAGS: Record<string, FlagDefinition> = {
  title: {
    name: '--title',
    type: 'string',
    required: false,
    description: 'Name of the event, task, or reminder',
  },
  for: {
    name: '--for',
    type: 'date',
    required: false,
    description: 'Date — DD-MM-YYYY or natural language (tomorrow, next monday)',
  },
  at: {
    name: '--at',
    alias: '@',
    type: 'time',
    required: false,
    description: 'Time in HH:MM format (24h)',
  },
  invite: {
    name: '--invite',
    type: 'email-list',
    required: false,
    description: 'Comma-separated email addresses to invite',
  },
  using: {
    name: '--using',
    type: 'account-alias',
    required: false,
    description: 'Named account alias (e.g. GG) — uses default if omitted',
  },
  notes: {
    name: '--notes',
    type: 'string',
    required: false,
    description: 'Optional notes or description',
  },
};
```

---

## 5. Command Registry — `commands.registry.ts`

Each command declares which flags it accepts, which are required, and its help text.

```typescript
import { FLAGS } from './flags.registry';

export interface CommandDefinition {
  name: string;           // e.g. '/schedule'
  description: string;
  acceptedFlags: string[];  // keys from FLAGS
  requiredFlags: string[];  // subset of acceptedFlags
}

export const COMMANDS: Record<string, CommandDefinition> = {
  start: {
    name: '/start',
    description: 'Show all available commands and their flags',
    acceptedFlags: [],
    requiredFlags: [],
  },
  schedule: {
    name: '/schedule',
    description: 'Create a calendar event on Google Calendar or Outlook',
    acceptedFlags: ['title', 'for', 'at', 'invite', 'using', 'notes'],
    requiredFlags: ['title', 'for', 'at'],
  },
  task: {
    name: '/task',
    description: 'Create a task in Google Tasks',
    acceptedFlags: ['title', 'for', 'notes'],
    requiredFlags: ['title'],
  },
  reminder: {
    name: '/reminder',
    description: 'Set a reminder — fires back as a WhatsApp message at the scheduled time',
    acceptedFlags: ['title', 'for', 'at'],
    requiredFlags: ['title', 'for', 'at'],
  },
  mytask: {
    name: '/mytask',
    description: 'Retrieve and display your pending tasks',
    acceptedFlags: [],
    requiredFlags: [],
  },
  myschedule: {
    name: '/myschedule',
    description: "Retrieve and display today's calendar events",
    acceptedFlags: [],
    requiredFlags: [],
  },
};
```

---

## 6. Command Parser — `parser/command.parser.ts`

Parse raw WhatsApp message text into a structured object. Reads from registries.

**Input examples:**
```
/schedule hernan@ggcapital.com --for 22-04-2026 @18:00 --title Breakfast --using GG
/task --title Call Isabel --for tomorrow
/reminder --title Call doctor --for next monday @09:00
/mytask
/start
```

**Output shape:**
```typescript
interface ParsedCommand {
  command: string;                    // e.g. 'schedule'
  flags: Record<string, string>;      // e.g. { title: 'Breakfast', for: '22-04-2026', at: '18:00' }
  extraArgs: string[];                // positional args before first flag (e.g. email in /schedule)
  raw: string;                        // original message
}

interface ParseResult {
  success: boolean;
  data?: ParsedCommand;
  error?: string;                     // human-readable, sent back via WhatsApp
}
```

**Parser rules:**
- First token after the command name is treated as `extraArgs` until a `--flag` or `@` is encountered
- `@HH:MM` is an alias for `--at HH:MM`
- Unknown flags → return error with full usage hint for that command
- Missing required flags → return error listing which flags are missing
- Date values in `--for` are passed to `utils/date.ts` for normalization

---

## 7. Date Parser — `utils/date.ts`

Accepts both strict and natural language dates. Returns a normalized `Date` object in the user's configured timezone.

**Supported inputs:**
```
22-04-2026          → April 22, 2026
tomorrow            → current date + 1 day
next monday         → next occurrence of Monday
next week           → 7 days from now
today               → current date
```

Use the `chrono-node` npm package for natural language parsing.
Always resolve relative dates against the user's configured timezone (stored in admin settings, read from token-store or a settings file).

---

## 8. Webhook Route — `routes/webhook.ts`

**Endpoint:** `POST /webhook/whatsapp`

Flow:
1. Receive Kapso webhook payload
2. Use `normalizeWebhook()` from `@kapso/whatsapp-cloud-api/server` to parse
3. Extract message text, sender phone, button reply ID, and context message ID
4. Run whitelist middleware:
   - If sender is in `WHITELISTED_NUMBERS` → owner path, full command access
   - If sender is in `secretariat:third-party-contacts` → third-party path, sets `isThirdParty: true`
   - Otherwise → send `"❌ Unauthorized number."` and return 200
5. If `isThirdParty` → route to `thirdPartyHandler` (handles `/set` and `/menu` only), return
6. If `buttonReplyId` → route to `buttonReplyHandler` (snooze/done/tp_ reclassify), return
7. If reply to a bot message → attempt `replyRescheduleHandler`, return if handled
8. Parse message with command parser → route to correct handler
9. Always return HTTP 200 to Kapso (even on errors — prevents retries)

---

## 8a. Third-Party Contacts

Third-party contacts are external numbers (e.g. family members) that can propose events to the owner.

**Redis keys:**
- `secretariat:third-party-contacts` — `ThirdPartyContact[]` (`number`, `alias`)
- `secretariat:third-party-pending` — `ThirdPartyPending[]` — pending proposed events, cleared once the owner taps a button

**Flow:**
1. Third-party sends `/set Doctor -f tomorrow -a 10am`
2. Bot auto-saves as a reminder (fires to owner at the scheduled time — the default)
3. Bot sends owner an interactive message with 3 buttons: **Reminder** · **Task** · **Schedule**
4. Owner taps a button:
   - **Reminder** — reminder already exists, just confirms and deletes pending entry
   - **Task** — cancels the reminder, creates a local task; if the task is later marked done, the sender is notified
   - **Schedule** — cancels the reminder, creates a Google Calendar event
5. If owner never taps → reminder fires normally at the scheduled time
6. Third-party sends `/menu` → receives flag usage and examples

**Button ID format:** `tp_<type>_<pendingId>` where type is `rem`, `task`, or `cal`.

**Admin panel:** Whitelist page → "Third-party contacts" section. Add by alias + E.164 number. Remove any time.

---

## 9. Internal Routes — `routes/internal.ts`

These endpoints are called by QStash. Always verify QStash signature using `qstash-verify.ts` middleware before processing.

```
POST /internal/reminder/fire
  Body: { title: string, phoneNumber: string }
  Action: Send WhatsApp message to phoneNumber with reminder title

POST /internal/digest/morning
  Body: {} (no body needed — config read from settings)
  Action: Fetch today's calendar events → send WhatsApp digest

POST /internal/digest/weekly
  Body: {}
  Action: Fetch next 7 days calendar + tasks → send WhatsApp digest
```

---

## 10. Handlers

### `/start` handler
- Read all entries from `COMMANDS` registry
- For each command, read its `acceptedFlags` and look up descriptions in `FLAGS`
- Build formatted WhatsApp message string
- Send via Kapso client

**Output format:**
```
🤖 *WhatsApp Command Bot*

*/schedule* — Create a calendar event
  --title   Name of the event
  --for     Date (DD-MM-YYYY or 'tomorrow')
  @         Time (HH:MM)
  --invite  Emails to invite (comma-separated)
  --using   Account alias (e.g. GG)
  --notes   Optional notes

*/task* — Create a task
  --title   Task name
  --for     Due date
  --notes   Optional notes

*/reminder* — Set a reminder
  --title   Reminder text
  --for     Date
  @         Time

*/mytask* — Show pending tasks
*/myschedule* — Show today's schedule
*/start* — Show this menu
```

---

### `/schedule` handler
1. Resolve `--using` alias → if omitted, use default calendar account from integration registry
2. If no default set → reply: `"❌ No calendar account connected. Visit the admin panel."`
3. Parse `--for` + `--at` into a datetime using `utils/date.ts`
4. Parse `--invite` as comma-separated email list (may be empty)
5. `extraArgs[0]` treated as an additional invitee email if it looks like an email
6. Call `integrations/google/calendar.ts` or `integrations/microsoft/calendar.ts` based on account type
7. On success → reply: `"✅ Event created: {title} on {date} at {time}"`
8. On error → reply: `"❌ Could not create event: {error message}"`

---

### `/task` handler
1. Use default Google Tasks account (only one tasks integration in v1)
2. If no account connected → reply with admin panel prompt
3. Parse `--for` as due date
4. Call `integrations/google/tasks.ts`
5. On success → reply: `"✅ Task created: {title} due {date}"`
6. On error → reply with error message

---

### `/reminder` handler
1. Parse `--for` + `--at` into target datetime
2. If datetime is in the past → reply: `"❌ Reminder time is in the past."`
3. Call `qstash/client.ts` to schedule a delayed HTTP call to `/internal/reminder/fire`
4. Pass `{ title, phoneNumber: owner's number }` as the QStash message body
5. On success → reply: `"⏰ Reminder set: {title} on {date} at {time}"`

---

### `/mytask` handler
1. Fetch all incomplete tasks from Google Tasks default account
2. Sort by due date ascending
3. Format and send as WhatsApp message:
```
📋 *Your pending tasks:*

• Call Isabel — due 22 Apr
• Send report — due 25 Apr
• Review contract — no due date
```
4. If no tasks → reply: `"✅ No pending tasks."`

---

### `/myschedule` handler
1. Fetch all calendar events for today from all connected calendar accounts
2. Sort by start time
3. Format and send:
```
📅 *Today — Tue 22 Apr:*

09:00 — Call with Hernan
14:00 — Breakfast (GG Calendar)
18:00 — Board review
```
4. If no events → reply: `"📅 No events scheduled for today."`

---

## 11. Cron Digests — `cron/`

Both digests are triggered by QStash recurring cron schedules configured via the admin panel. The admin panel calls the QStash API to create/update/delete these schedules when the user saves settings.

### Morning Digest (`POST /internal/digest/morning`)
1. Read digest config from settings (enabled, time, days, timezone)
2. Fetch today's events from all connected calendar accounts
3. Format message identical to `/myschedule` output but prefixed with:
   `"Good morning ☀️ Here's your schedule for today:"`
4. Send to owner's WhatsApp number

### Weekly Summary (`POST /internal/digest/weekly`)
1. Read digest config from settings (enabled, day, time, timezone)
2. Fetch events for next 7 days from all connected calendars
3. Fetch all incomplete tasks from Google Tasks
4. Group events by day, append tasks section at end
5. Send formatted digest to owner's WhatsApp

---

## 12. Integration Registry — `integrations/registry.ts`

Manages named accounts and default resolution.

```typescript
interface ConnectedAccount {
  id: string;             // uuid
  alias: string;          // e.g. 'GG', 'personal'
  provider: 'google' | 'microsoft';
  type: 'calendar' | 'tasks';
  isDefault: boolean;
  tokens: EncryptedTokens;
}
```

**`resolveAccount(alias?: string, type: 'calendar' | 'tasks')`**
- If alias provided → find account with matching alias and type
- If not → find account where `isDefault === true` and `type` matches
- If none → return null (handler sends admin panel prompt)

Persist accounts as JSON to a local file (`data/accounts.json`) encrypted with `TOKEN_ENCRYPTION_KEY`. On Render, this file persists within the service's disk (Render free tier has ephemeral disk — see note below).

> **Important note for Claude Code:** Render's free tier has ephemeral storage — data written to disk is lost on redeploy or restart. For v1 this is acceptable (user re-connects accounts after redeploy). Add a comment in `token-store.ts` noting this limitation and that a future version should use a persistent store (e.g. Upstash Redis or a database).

---

## 13. Token Encryption — `utils/encrypt.ts`

Use Node.js built-in `crypto` module with AES-256-GCM.

```typescript
// encrypt(plaintext: string, key: string): string  → returns base64 encoded ciphertext
// decrypt(ciphertext: string, key: string): string  → returns plaintext
```

Key comes from `TOKEN_ENCRYPTION_KEY` env var (32-char string).

---

## 14. Google Integration

### OAuth Flow (`integrations/google/oauth.ts`)
- Scopes: `https://www.googleapis.com/auth/calendar`, `https://www.googleapis.com/auth/tasks`
- Redirect URI: `BASE_URL + /auth/google/callback`
- After callback: save tokens to registry with alias provided during connect flow
- Implement token refresh: if access token expired, use refresh token automatically before API call

### Calendar (`integrations/google/calendar.ts`)
Use `googleapis` npm package (`google-auth-library` + `@googleapis/calendar`).

**Functions to implement:**
```typescript
createEvent(account: ConnectedAccount, params: {
  title: string;
  startDatetime: Date;
  endDatetime: Date;       // default: startDatetime + 1 hour
  attendees: string[];
  notes?: string;
  timezone: string;
}): Promise<{ eventId: string; htmlLink: string }>

getTodayEvents(account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]>
getWeekEvents(account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]>
```

### Tasks (`integrations/google/tasks.ts`)
Use `@googleapis/tasks` npm package.

**Functions to implement:**
```typescript
createTask(account: ConnectedAccount, params: {
  title: string;
  dueDate?: Date;
  notes?: string;
}): Promise<{ taskId: string }>

getPendingTasks(account: ConnectedAccount): Promise<Task[]>
```

---

## 15. Microsoft Integration

### OAuth Flow (`integrations/microsoft/oauth.ts`)
Use `@azure/msal-node` npm package.
- Scopes: `Calendars.ReadWrite`, `offline_access`
- Redirect URI: `BASE_URL + /auth/microsoft/callback`

### Calendar (`integrations/microsoft/calendar.ts`)
Use Microsoft Graph API (`@microsoft/microsoft-graph-client`).

**Functions to implement:**
```typescript
createEvent(account: ConnectedAccount, params: { same shape as Google }): Promise<{ eventId: string }>
getTodayEvents(account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]>
getWeekEvents(account: ConnectedAccount, timezone: string): Promise<CalendarEvent[]>
```

---

## 16. Kapso Client — `kapso/client.ts`

Wrapper around `@kapso/whatsapp-cloud-api`.

```typescript
// sendMessage(to: string, text: string): Promise<void>
// Uses KAPSO_API_KEY and KAPSO_PHONE_NUMBER_ID from env
// to is E.164 format e.g. +15550000000
```

WhatsApp formatting supported in message text:
- `*bold*` for headers
- `_italic_` for secondary info
- Newlines with `\n`

---

## 17. QStash Client — `qstash/client.ts`

```typescript
// scheduleOnce(url: string, delaySeconds: number, body: object): Promise<string>
//   → schedules a one-off HTTP POST, returns QStash message ID

// scheduleCron(url: string, cron: string, body: object): Promise<string>
//   → creates a recurring cron schedule, returns schedule ID

// deleteSchedule(scheduleId: string): Promise<void>
//   → deletes a cron schedule (used when user disables digest in admin panel)
```

Use `@upstash/qstash` npm package.
QStash will always POST to `BASE_URL + the given path`.

---

## 18. Admin Panel API — `admin/api.ts`

All routes prefixed with `/api/admin`. Protected by session middleware that checks `ADMIN_PASSWORD`.

```
POST   /api/admin/login                     # { password } → set session cookie
POST   /api/admin/logout
GET    /api/admin/accounts                  # List all connected accounts
DELETE /api/admin/accounts/:id              # Disconnect account
PATCH  /api/admin/accounts/:id              # Update alias or set as default
GET    /api/admin/whitelist                        # List whitelisted numbers (read-only, env var)
GET    /api/admin/third-party-contacts             # List third-party contacts
POST   /api/admin/third-party-contacts             # Add contact { number, alias }
DELETE /api/admin/third-party-contacts/:number     # Remove contact
GET    /api/admin/settings                  # Get timezone + digest config
PUT    /api/admin/settings                  # Update timezone + digest config
                                            # Also calls QStash to create/update/delete cron schedules
GET    /api/admin/auth/google/start?alias=  # Initiate Google OAuth (alias passed as query param)
GET    /api/admin/auth/microsoft/start?alias=
```

Session: use `express-session` with a memory store (acceptable for single-user personal tool).

---

## 19. Admin Panel UI — React + Vite

**Pages:**

**Login** (`/login`)
- Single password field
- Calls `POST /api/admin/login`
- Redirects to Dashboard on success

**Dashboard** (`/`)
- Cards showing: number of connected accounts, digest status (on/off), pending reminders count (not yet implemented in v1 — show "coming soon")
- Quick links to each section

**Accounts** (`/accounts`)
- List of connected accounts with alias, provider badge (Google / Microsoft), type badge (Calendar / Tasks), default badge
- "Connect Google" button → calls `/api/admin/auth/google/start?alias=...` after prompting for alias
- "Connect Microsoft" button → same flow
- Disconnect button per account
- Set as default toggle per account

**Whitelist** (`/whitelist`)
- List of allowed WhatsApp numbers
- Add number input (E.164 format)
- Remove button per number

**Digests** (`/digests`)
- Morning digest: toggle on/off, time picker, day-of-week multi-select
- Weekly summary: toggle on/off, day-of-week single select, time picker
- Timezone selector (IANA timezone list e.g. `America/Santiago`)
- Save button → calls `PUT /api/admin/settings`

---

## 20. Static File Serving

In `backend/src/index.ts`, after all API routes:

```typescript
// Serve admin panel static files
app.use(express.static(path.join(__dirname, '../../admin/dist')));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/webhook') && !req.path.startsWith('/internal') && !req.path.startsWith('/auth')) {
    res.sendFile(path.join(__dirname, '../../admin/dist/index.html'));
  }
});
```

Build admin panel before starting backend: `cd admin && npm run build`.

---

## 21. npm Packages

### Backend
```json
{
  "dependencies": {
    "@kapso/whatsapp-cloud-api": "latest",
    "@upstash/qstash": "latest",
    "@googleapis/calendar": "latest",
    "@googleapis/tasks": "latest",
    "google-auth-library": "latest",
    "@azure/msal-node": "latest",
    "@microsoft/microsoft-graph-client": "latest",
    "express": "^4.18.0",
    "express-session": "^1.17.0",
    "chrono-node": "^2.7.0",
    "zod": "^3.22.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/express": "latest",
    "@types/express-session": "latest",
    "@types/node": "latest",
    "tsx": "latest",
    "rimraf": "latest"
  }
}
```

### Admin
```json
{
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-router-dom": "^6.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "latest",
    "vite": "latest",
    "typescript": "^5.0.0"
  }
}
```

---

## 22. WhatsApp Message Templates

The following templates must be pre-approved by Meta via the Kapso dashboard before reminders and digests work in production. Use free-form text during development (within 24h reply window).

| Template name         | Used for          | Body |
|-----------------------|-------------------|------|
| `reminder_fire`       | /reminder fires   | `⏰ Reminder: {{1}}` |
| `morning_digest`      | Morning digest    | `☀️ Good morning! Your schedule for today:\n{{1}}` |
| `weekly_summary`      | Weekly digest     | `📋 Your week ahead:\n{{1}}` |

Submit templates via Kapso dashboard → Templates → Create. Category: `UTILITY`.

---

## 23. Error Handling Conventions

- All handlers are wrapped in try/catch
- On any unhandled error: send WhatsApp message `"❌ Something went wrong. Try again."` and log the full error to console
- Never let an unhandled error cause the webhook endpoint to return non-200 (Kapso will retry)
- Parser errors are user-friendly and include the correct command syntax

---

## 24. Deployment — Render.com

**Build command:**
```bash
cd admin && npm install && npm run build && cd ../backend && npm install && npm run build
```

**Start command:**
```bash
node backend/dist/index.js
```

**Environment:** Node 20+

All environment variables set via Render dashboard → Environment tab.

---

## 25. Implementation Order for Claude Code

Execute phases strictly in this order. Do not skip ahead.

1. **Scaffold** — monorepo structure, tsconfigs, `.env.example`, Zod env validation, Express app skeleton, health check route `GET /health → 200 OK`
2. **Registries + Parser** — `flags.registry.ts`, `commands.registry.ts`, `command.parser.ts`, `utils/date.ts`
3. **Kapso client + webhook route** — receive messages, whitelist check, route to handler stubs
4. **`/start` handler** — dynamic menu from registries, send via Kapso
5. **Admin panel scaffold** — Vite + React, routing, Login page, password auth, session
6. **Integration registry + token store + encryption** — account CRUD, admin Accounts page
7. **Google OAuth + Calendar + Tasks** — full flow including token refresh
8. **Microsoft OAuth + Calendar** — full flow
9. **`/schedule`, `/task`, `/mytask`, `/myschedule` handlers**
10. **QStash client + `/reminder` handler + `/internal/reminder/fire` route**
11. **Cron digests** — morning + weekly, admin Digests page, QStash schedule management
12. **Static file serving** — build admin, serve from Express
13. **End-to-end test** — use Kapso sandbox, verify all commands, verify digest firing

---

## 26. Known Limitations (v1)

- Token storage is file-based and ephemeral on Render free tier — re-connect accounts after redeploy
- No retry logic for failed Google/Microsoft API calls
- No rate limiting on webhook endpoint
- WhatsApp message templates must be manually submitted and approved before production use of reminders/digests
- QStash free tier: 500 messages/day, 3 active cron schedules
- Render free tier: ~50 seconds cold start on first request after sleep — `/start` command serves as manual wake-up
