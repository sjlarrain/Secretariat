# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

---

## Architecture Overview

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

`token-store.ts` is the canonical place for account + settings CRUD. All other local integrations (`integrations/local/`) each own their own Redis key directly.

### Registry-Driven Design

Two registries are the single source of truth:

- **`registries/flags.registry.ts`** — all flag definitions (`--title`, `--for`, `@`, `--plan`, etc.)
- **`registries/commands.registry.ts`** — all commands with their `acceptedFlags` and `requiredFlags`

The parser reads from these. The `/menu` handler builds its output from these. Adding a new flag or command only requires updating the registries — no other file changes needed for basic wiring.

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
  → cron/morning-digest.ts or weekly-summary.ts
```

### Google OAuth + Token Refresh

`integrations/google/oauth.ts` handles the full OAuth2 flow. Every Google API call goes through `getAuthenticatedClient()`, which auto-refreshes the access token if expired and persists the new tokens back to Redis via `saveAccount()`. If the refresh token is invalid (e.g. `invalid_grant`), the error propagates up and the handler replies with the error message.

Currently only Google is implemented. Microsoft (v1.7) and Todoist (v1.6) are in the backlog.

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

---

## Key Implementation Notes

- **Timezone**: All date operations use `settings.timezone` (default `America/Santiago`) stored in Redis. The `utils/date.ts` utilities accept a timezone string — always pass it; never rely on server local time.
- **Dedup**: `getEventsForDate()` deduplicates events by `title|start` key across multiple sub-calendars and filters events whose title matches `/^canceled[:\s]/i`.
- **WhatsApp always gets 200**: Webhook route must always return HTTP 200 to Kapso, even on errors, to prevent retries. Errors are sent as WhatsApp replies.
- **AES-256-GCM encryption**: OAuth tokens are encrypted before storage using `TOKEN_ENCRYPTION_KEY` (32-char env var). Use `encryptTokens()` / `decryptTokens()` from `token-store.ts`.
- **QStash signature verification**: All `/internal/*` routes are protected by `qstash-verify.ts` middleware — do not skip this.
- **`extraArgs`**: The parser puts positional tokens before the first flag into `extraArgs[]`. Used by `/myschedule week` (extraArgs[0]) and `/links <url>` (extraArgs[0]).

---

## Project Context

See `BACKLOG.md` for the ordered feature queue and current version.
See `context.md` for the original design spec (note: some sections are outdated — Redis replaced file storage, Microsoft not yet implemented, command set has grown).
