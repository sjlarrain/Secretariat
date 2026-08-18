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

### Choosing an environment

`env.ts` loads a single dotenv file, by default the one a level above the repo root. `ENV_FILE` selects a different one — use it to run against the v2 Upstash DB without touching the file that holds live v1 credentials:

```bash
ENV_FILE=../.env.v2 npm run dev    # relative paths resolve from the working directory
```

The selected file **replaces** the default; it is not layered on top. Every variable must be present in it, so a missing one exits at startup rather than silently falling back to the other environment's value — which is what would otherwise point a v2 run at v1's production Redis. Inline vars (`FOO=bar npm run dev`) still override whichever file is loaded.

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
| `secretariat:ucla` | `UclaItem[]` — UCLA to-do list with due dates (v1 name; v2 renamed this to `mba`/`MbaItem`, see below) |
| `secretariat:health-alerts` | `HealthAlert[]` — issues found by the nightly health check |

> **v2 change.** Every key above becomes namespaced per user (`u:<userId>:ideas`, etc.) where `userId` is the phone number. Go through the key-builder — never write a raw `secretariat:` string.
>
> Also: the legacy access pattern is read-whole-array → mutate → write-whole-array, which loses updates when the sweeper cron and an inbound message hit the same key. New code uses hashes or sorted sets so writes are atomic.
>
> **v2.0 renames and removals.** `/ucla` became `/mba` — command, handler, `u:<userId>:mba` collection, `MbaItem`, `settings.mbaReminder`, the `/internal/mba/*` QStash routes, and the `done_mba_<id>` button ids. It was a clean rename with no compatibility shims: the pre-v1.14 `/work` reads (`legacyWorkKey()`, the `secretariat:work` migration, the `workItemId` payload field, the `/internal/work/reminder/fire` alias, and the `'work'` reply-target type) were all dropped with it, and `/ucla` is now asserted retired alongside `/work` in `registry.test.ts`. `/mantis` and its `MANTIS_API_*` env vars were removed outright — do not reintroduce either name.

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
- **Cron scheduling (v2): one hourly sweeper, not per-user QStash schedules.** `platform/sweeper.ts`'s `runSweep()` is the only recurring job — QStash calls `POST /internal/tick` once an hour (UTC, no `CRON_TZ`), created once at boot by `platform/ensureSweeperSchedule.ts`. Every tick, the sweeper enumerates every active registered user and, via `getZonedParts()` in `shared/utils/date.ts` (never hand-rolled offset math), computes each user's local date/hour/weekday to decide what's due — morning digest, weekly summary, MBA reminder, reminder promotion, health check, Google Tasks sync. This replaced the v1/early-v2 model where each user who enabled a job got their own QStash cron schedule (`reconcileSchedules()` in a now-deleted `qstash/schedules.ts`, built with a since-deleted `buildCron()` `CRON_TZ=<zone> m h * * d` helper) — QStash's free tier caps at 3 cron schedules total, so N users × 6 jobs each with its own schedule was never going to scale. One consequence: precision is capped at the hour — a digest configured for 08:30 fires on the 08:00–08:59 tick, not at :30. Idempotency is a `SET NX` claim on `pointKey('fired', '<userId>:<job>:<bucket>')` (48h TTL) so a doubled tick fires each job at most once.
- **Changing the timezone takes effect on the next tick — nothing to regenerate.** Since the sweeper reads `settings.timezone` fresh every hour rather than baking it into a schedule, there is no separate "recreate the schedule" step. `PUT /settings` and the `/zone` handler both just call `normalizeSettings()` (token-store) before `saveSettings()`.
- **The reminder promoter is always on and must never become disableable.** QStash rejects one-off messages delayed beyond 7 days, so `/reminder` stores anything further out as `deferred` with no queued message; the weekly (Sunday) promoter job — now one of the sweeper's per-user checks — is the only thing that ever queues it. Disabling it silently strands every deferred reminder — the user already got a "Reminder set" confirmation. `Settings['reminderPromoter']['enabled']` is typed as the literal `true`, forced in `normalizeSettings()` (token-store, on read and write). Do not add an on/off toggle; only the run time is configurable.
- **Zone input**: `parseZoneInput()` accepts an IANA name or `GMT±N` and returns a canonical zone. `GMT±N` maps to an `Etc/GMT∓N` pseudo-zone — the sign is **inverted** (`GMT-3` → `Etc/GMT+3`) and these zones are DST-naive. Both `/zone` and `PUT /settings` normalize through it, so the stored value is always canonical.
- **Dedup**: `getEventsForDate()` deduplicates events by `title|start` key across multiple sub-calendars and filters events whose title matches `/^canceled[:\s]/i`.
- **Webhook dedup**: in-memory dedup does not survive Render cold starts (~50s), and Kapso retries at 10s/40s/90s arrive before the process is warm. Dedup must be Redis-backed with a TTL. Extract `messageId` from the normalized webhook object, not from raw `entry[0].changes[0].value.messages[0]`.
- **WhatsApp always gets 200**: Webhook route must always return HTTP 200 to Kapso, even on errors, to prevent retries. Errors are sent as WhatsApp replies. *(One deliberate exception, v2 only: when `platform/v1-proxy.ts` cannot reach v1 after its own retries it answers **502**. That rule exists so Kapso doesn't re-run handlers after an **application** error, where the user is told over WhatsApp instead. A failed forward is a **transport** failure — nothing was processed, there is nobody to tell, and Kapso's retry schedule is the only thing that saves the message across v1's ~50s Render cold start. The dedup claim is released before answering so the retry isn't swallowed as a duplicate.)*
- **WhatsApp 24-hour window**: any proactive outbound message (digests, notifications) to someone who hasn't messaged in 24h requires an approved Meta message template or it fails silently. This becomes mandatory in v2 — v1 got away with it because Santiago messages daily.
- **Numeric ids come from `:seq`, and migrations must seed it.** `HashCollection.nextId()` mints via `INCR` on `u:<userId>:<name>:seq` (built with `userSeqKey()` — never by hand). The counter starts at 0 in a fresh namespace, so any script that bulk-writes existing items must `SET` that collection's `:seq` to the highest id it wrote. Otherwise the next create mints an id that's already taken and the `HSET` silently overwrites a real item. Applies to `projects`, `ideas`, `links`, `plans`, `tasks`, `mba`. See `docs/v2-plan.md` — "Migration requirement".
- **AES-256-GCM encryption**: OAuth tokens are encrypted before storage using `TOKEN_ENCRYPTION_KEY` (32-char env var). Use `encryptTokens()` / `decryptTokens()` from `token-store.ts`. *(v2: extend to sensitive per-user content. Encrypt values only, never keys — namespacing requires scanning `u:*:...`. Never encrypt a field used for filtering or sorting.)*
- **Inbound routing (v2): v2 owns the single Kapso webhook and forwards Santiago's number to v1.** Kapso allows one raw-webhook subscription per phone number, so one service is the front door for the shared number, and it is v2 — v1's code is then untouched. `v1ProxyMiddleware` (`platform/v1-proxy.ts`) is mounted **before** `resolveSenderMiddleware`, because once Santiago's number is also registered in v2 for testing, `resolveSender()` returns `kind: 'user'` and a check placed after it would never fire. It forwards the raw `req.body` — never reconstructed fields — so v1's own `normalizeWebhook()` and message-id dedup keep working. Enabled by `V1_WEBHOOK_URL`; unsetting it is the cutover. Do not add a second Kapso subscription for v2 — a fan-out would need v1's `whitelistMiddleware` edited to stop replying to v2's users. See `docs/v2-plan.md` §C.8.
- **QStash signature verification**: All `/internal/*` routes are protected by `qstash-verify.ts` middleware — do not skip this.
- **`extraArgs`**: The parser puts positional tokens before the first flag into `extraArgs[]`. Used by `/myschedule week` (extraArgs[0]) and `/links <url>` (extraArgs[0]).

---

## Project Context

See `BACKLOG.md` for the ordered feature queue and current version.
See `docs/v2-plan.md` for the multi-user architecture being built on this branch.
See `context.md` for the original design spec (note: some sections are outdated — Redis replaced file storage, Microsoft not yet implemented, command set has grown).
