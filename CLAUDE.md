# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Current Branch: `multiuser`

This branch converts Secretariat from a single-user bot into a multi-user platform (~5–20 users, friends & family, one shared WhatsApp number).

**Read `docs/v2-plan.md` for the architecture.** Decisions in it are settled — don't relitigate them. Sections below describing single-user behaviour are v1 and are what this branch is changing; inline notes mark where.

### Branch rules

- **Never change branches.** No `git checkout`, `git switch`, `git branch`, or `git worktree`. You stay on `multiuser` for the entire session. If work seems to require a different branch, stop and report.
- **Never merge, rebase, or cherry-pick.** These are Santiago's to run.
- Never commit to or push to `main`. `main` deploys to the live v1 service that is in daily use.
- Push to `origin multiuser` only.

### Hard constraints

- **You cannot install packages.** If you need a dependency that isn't present, stop and report it.
- **Do not read `.env` files.** They hold live Upstash, Kapso, and Google credentials. Assume they're configured correctly.
- **Do not send project data anywhere except GitHub via `git push`.**

### Stopping conditions

Stop and report rather than working around, when you hit:

- A missing credential or unavailable external service. Do not mock or stub it to make a test pass.
- A decision that isn't yours to make.
- A success condition reachable only by weakening a test, deleting a test, or relaxing a type. If that's the only path, the condition is wrong — say so.

### Reporting

On completing a unit of work: what changed by file, the verification command and its output, anything deferred or worked around, and anything noticed that's broken but out of scope.

---

## Commit Convention

Every commit must follow this format:

```
[vMAJOR.MINOR.PATCH] scope: short description
```

**Rules:**
- `MAJOR.MINOR` maps to the feature version currently being worked on. Check `BACKLOG.md` for the current version.
- `PATCH` is a sequential counter — run `git log --oneline -5` before committing to find the last patch number and add 1.
- `scope`: `backend`, `admin`, `ops`, `ideas`, `parser`, `cron`, `docs`, or a handler name.
- Description is lowercase, imperative, 50 chars max.
- Single line — no body, no bullet points, no co-author trailer.

**Examples:**
```
[v1.2.15] backend: fix timezone rollback in date parser
[v1.3.2] admin: add inline tag editor to Links page
[v1.4.1] backend: future-only date resolution for weekday names
```

---

## MCP Servers

| Server | Purpose | Scope |
|--------|---------|-------|
| `kapso` | Kapso WhatsApp API documentation lookups only | Project |

**Important:** The `kapso` MCP is for documentation reference only. Do not use it to send messages, modify webhooks, or interact with the live Kapso API.

---

## Development Commands

```bash
# Backend (from /backend)
npm run dev          # tsx watch — hot reload on file changes
npm run build        # rimraf dist && tsc
npm start            # node dist/index.js (production)

# Admin panel (from /admin)
npm run dev          # Vite dev server (proxies /api to backend)
npm run build        # builds to admin/dist/

# Full production build (run from root)
cd admin && npm install && npm run build && cd ../backend && npm install && npm run build
```

The backend serves the built admin panel as static files from `admin/dist/`. In development, run both `npm run dev` processes simultaneously.

> **Note:** the full-build line above contains `npm install`, which you are not permitted to run. Use `npm run build` in each directory and assume dependencies are present.

---

## Architecture Overview

> **v1 description — being changed on this branch.** Secretariat is becoming multi-user: identity resolves from the sender's phone number, the whitelist becomes a Redis-backed user registry, and every handler takes `ctx: { userId, timezone }`. See `docs/v2-plan.md` §C.

Single-user personal WhatsApp bot (owner: Santiago). All commands are prefixed with `/`. Inbound messages arrive from Kapso → `POST /webhook/whatsapp` → parser → handler → Kapso reply. Non-command messages are rejected.

### Data Layer — Upstash Redis

All persistent state lives in Upstash Redis (not files). Redis keys:

| Key | Content |
|-----|---------|
| `secretariat:accounts` | `ConnectedAccount[]` — OAuth tokens (AES-256 encrypted) + calendar config |
| `secretariat:settings` | `Settings` — timezone, digest schedules, QStash schedule IDs |
| `secretariat:ideas` | `Idea[]` — ideas with soft-delete / trash |
| `secretariat:projects` | `Project[]` — idea buckets |
| `secretariat:links` | `Link[]` — saved URLs with tags, read/unread |
| `secretariat:plans` | `PlanType[]` — meeting plan types (Lunch, Coffee, etc.) |
| `secretariat:reminders` | Managed by QStash; metadata stored here |
| `secretariat:tasks` | `LocalTask[]` — local tasks, two-way synced to Google Tasks |
| `secretariat:ucla` | `UclaItem[]` — UCLA to-do list with due dates (migrated from `secretariat:work` in v1.14) |
| `secretariat:health-alerts` | `HealthAlert[]` — issues found by the nightly health check |

> **v2 change.** Every key above becomes namespaced per user (`u:<userId>:ideas`, etc.) where `userId` is the phone number. Go through the key-builder — never write a raw `secretariat:` string.
>
> Also: the legacy access pattern is read-whole-array → mutate → write-whole-array, which loses updates when the sweeper cron and an inbound message hit the same key. New code uses hashes or sorted sets so writes are atomic.

`token-store.ts` is the canonical place for account + settings CRUD. All other local integrations (`integrations/local/`) each own their own Redis key directly.

### Registry-Driven Design

Two registries are the single source of truth:

- **`registries/flags.registry.ts`** — all flag definitions (`--title`, `--for`, `@`, `--plan`, etc.)
- **`registries/commands.registry.ts`** — all commands with their `acceptedFlags` and `requiredFlags`

The parser reads from these. Adding a new flag or command requires updating the registries, adding the handler, and adding a `case` to the switch in `routes/webhook.ts` — a command in the registry with no `case` parses successfully and then falls through to "unknown command".

Note the `/menu` handler does **not** build from the registries — it is a hand-maintained string in `menu.handler.ts` and must be updated by hand when commands or flags change.

Short aliases are resolved **per-command**, so two flags may share a letter globally as long as no single command accepts both (`--project`/`--plan` both use `-p`; `--using`/`--due` both use `-u`). A test in `registry.test.ts` enforces this.

### Request Flow

```
Kapso webhook → routes/webhook.ts
  → whitelist middleware
  → command.parser.ts   (reads registries)
  → handler/*.handler.ts
    → integrations/google/calendar.ts  (or tasks.ts)
    → integrations/local/*.ts           (ideas, links, plans, reminders)
    → kapso/client.ts                   (sendMessage reply)

QStash cron → routes/internal.ts
  → qstash-verify.ts middleware
  → cron/morning-digest.ts | weekly-summary.ts | reminder-promoter.ts
    | google-tasks-sync.ts | health-check.ts
```

> **v2 change.** The whitelist middleware becomes user resolution against the registry; unrecognized senders get no reply (admin is notified instead), except Santiago's own number which proxies to v1 until cutover. The five crons collapse into one hourly sweeper — QStash free tier caps at 3 crons, so never add a per-user or per-job cron.

`kapso/client.ts` retries sends with backoff and a request timeout, and records
outcomes in `kapsoStats` so `/status` and the health check can tell a recovered
blip from a real outage. `kapso/platform.ts` is the separate Kapso *platform* API
(health, usage), shared by `/status` and `cron/health-check.ts`.

### Google OAuth + Token Refresh

`integrations/google/oauth.ts` handles the full OAuth2 flow. Every Google API call goes through `getAuthenticatedClient()`, which auto-refreshes the access token if expired and persists the new tokens back to Redis via `saveAccount()`. If the refresh token is invalid (e.g. `invalid_grant`), the error propagates up and the handler replies with the error message.

Currently only Google is implemented. Slack (v2.3) and Microsoft (v2.4) are in the backlog.

> **v2 note.** OAuth becomes per-user, with tokens stored under each user's namespace. The app's Google publishing status matters: Testing mode expires refresh tokens after 7 days, which would break every user's calendar weekly. Adding a user's email as a Google test user is a manual Cloud Console step — there is no API for it.

### `/myschedule --plan` Availability Logic

The `--plan` flag triggers availability mode. It fetches calendar events for the relevant day(s), then checks each configured slot in the plan against events with a travel buffer (`bufferMinutes`) applied before and after. The `isBlocked()` function in `myschedule.handler.ts` implements this check. When `--for` is omitted, it checks the whole week filtered to the plan's configured days.

### Admin Panel

React + Vite SPA. All API calls go to `/api/admin/*` (protected by session cookie). Pages:
- **Accounts** — connect/disconnect Google accounts, set default, select sub-calendars
- **Plans** — CRUD for meeting plan types used by `--plan`
- **Ideas** — view/edit/trash ideas and projects
- **Links** — view/archive/tag saved links
- **CronManager** — pending reminders list + cancel, digest schedule controls
- **Settings** — timezone, admin password change, live server clock
- **Commands** / **Whitelist** / **Digests** — as named

> **v2 change.** This panel splits in two: an **ops console** (operator-only — invites, analytics, calendar-email approvals, unrecognized senders, user management) and a **per-user panel** where each user manages their own accounts, plans, and settings. Per-user OAuth belongs in the user panel, not ops. Panel routes resolve data from the session's `userId` only — never from a URL parameter.

---

## Key Implementation Notes

- **Timezone**: All date operations use `settings.timezone` (default `America/Santiago`) stored in Redis. The `utils/date.ts` utilities accept a timezone string — always pass it; never rely on server local time. *(v2: timezone is per-user and arrives via `ctx.timezone`. Registration requires each user to set their own; the fallback for a user who hasn't is `UTC` — never another user's zone, which would silently skew their digests and day boundaries.)*
- **Cron scheduling**: Never compute UTC offsets by hand. Build cron strings with `buildCron()` from `utils/timezone.ts`, which emits QStash's `CRON_TZ=<zone> m h * * d` form so QStash resolves the local time (and DST) itself. Pre-computing an offset was the cause of the v1.14 "digest fires at the wrong time" bug: the offset was frozen at save time and drifted at each DST boundary.
- **Changing the timezone must regenerate every time-based schedule.** `timezone` lives outside each schedule's own config object, so a config diff alone will not notice it. Always go through `reconcileSchedules()` in `qstash/schedules.ts` — it is shared by `PUT /settings` and the `/zone` handler, and is the only place that should create or delete recurring schedules.
- **The reminder promoter is always on and must never become disableable.** QStash rejects one-off messages delayed beyond 7 days, so `/reminder` stores anything further out as `deferred` with no queued message; the weekly promoter cron is the only thing that ever queues it. Disabling it silently strands every deferred reminder — the user already got a "Reminder set" confirmation. `Settings['reminderPromoter']['enabled']` is typed as the literal `true`, and forced in `normalizeSettings()` (token-store, on read and write) and at the top of `reconcileSchedules()` (because callers reconcile *before* saving). Do not add an on/off toggle; only the run time is configurable. *(v2: this constraint survives the cron collapse — the promoter becomes a job inside the hourly sweeper, still unconditional.)*
- **Zone input**: `parseZoneInput()` accepts an IANA name or `GMT±N` and returns a canonical zone. `GMT±N` maps to an `Etc/GMT∓N` pseudo-zone — the sign is **inverted** (`GMT-3` → `Etc/GMT+3`) and these zones are DST-naive. Both `/zone` and `PUT /settings` normalize through it, so the stored value is always canonical.
- **Dedup**: `getEventsForDate()` deduplicates events by `title|start` key across multiple sub-calendars and filters events whose title matches `/^canceled[:\s]/i`.
- **Webhook dedup**: in-memory dedup does not survive Render cold starts (~50s), and Kapso retries at 10s/40s/90s arrive before the process is warm. Dedup must be Redis-backed with a TTL. Extract `messageId` from the normalized webhook object, not from raw `entry[0].changes[0].value.messages[0]`.
- **WhatsApp always gets 200**: Webhook route must always return HTTP 200 to Kapso, even on errors, to prevent retries. Errors are sent as WhatsApp replies.
- **WhatsApp 24-hour window**: any proactive outbound message (digests, notifications) to someone who hasn't messaged in 24h requires an approved Meta message template or it fails silently. This becomes mandatory in v2 — v1 got away with it because Santiago messages daily.
- **AES-256-GCM encryption**: OAuth tokens are encrypted before storage using `TOKEN_ENCRYPTION_KEY` (32-char env var). Use `encryptTokens()` / `decryptTokens()` from `token-store.ts`. *(v2: extend to sensitive per-user content. Encrypt values only, never keys — namespacing requires scanning `u:*:...`. Never encrypt a field used for filtering or sorting.)*
- **QStash signature verification**: All `/internal/*` routes are protected by `qstash-verify.ts` middleware — do not skip this.
- **`extraArgs`**: The parser puts positional tokens before the first flag into `extraArgs[]`. Used by `/myschedule week` (extraArgs[0]) and `/links <url>` (extraArgs[0]).

---

## Project Context

See `BACKLOG.md` for the ordered feature queue and current version.
See `docs/v2-plan.md` for the multi-user architecture being built on this branch.
See `context.md` for the original design spec (note: some sections are outdated — Redis replaced file storage, Microsoft not yet implemented, command set has grown).
