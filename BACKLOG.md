# Secretariat — Feature Backlog

> Add ideas from WhatsApp with `/ideas <text>`, or ask Claude to "add to backlog" in a coding session.

| Version | Feature | Status | Difficulty |
|---------|---------|--------|-----------|
| v1.1 | `/ideas` — save & list ideas via WhatsApp (Upstash Redis) | ✅ Done | Easy |
| **v1.2 — Flags Manager** | | | |
| v1.2 | `/myschedule --plan` — availability check by plan type (Lunch, Coffee, etc.) | ✅ Done | Medium |
| v1.2 | Plans page — CRUD for meeting plan types in admin panel | ✅ Done | Medium |
| v1.2 | Cron Manager — renamed Digests, pending reminder list, cancel support | ✅ Done | Medium |
| v1.2 | Settings — live server clock, timezone fix for reminders | ✅ Done | Easy |
| v1.2 | Google sub-calendar selection — choose which calendars to pull events from | ✅ Done | Medium |
| v1.2 | Event dedup + skip canceled — deduplicate cross-calendar events, filter "Canceled:" | ✅ Done | Easy |
| v1.2 | `/myschedule --plan` — per-plan buffer, specific day mode, `-p` alias, list mode | ✅ Done | Easy |
| v1.2 | Plans `bufferMinutes` — configurable travel buffer per plan type | ✅ Done | Easy |
| v1.2 | `/myschedule week` — full week calendar view | ✅ Done | Easy |
| v1.2 | `/delete --task N` — delete a Google Task by index number | ✅ Done | Easy |
| **v1.3 — Links Manager** | | | |
| v1.3 | Links Manager — save & tag URLs via WhatsApp, read archive, admin panel | ✅ Done | Easy |
| v1.3 | `/links #N -t tag` — add tags to existing link via WhatsApp | ✅ Done | Easy |
| v1.3 | Inline tag editor — add/remove tags per link in admin panel | ✅ Done | Easy |
| **v1.4 — Fixes & /work** | | | |
| v1.4 | Future-only date resolution — "thursday" always means next/current Thu | ✅ Done | Easy |
| v1.4 | Cross-account event dedup — deduplicate events shared across multiple Google accounts | ✅ Done | Easy |
| v1.4 | Google Calendar reconnect workflow — detect invalid_grant, mark disconnected, admin badge + reconnect button | ✅ Done | Medium |
| v1.4 | Ideas "Done" button — mark idea as used/completed (distinct from trash), admin panel | ✅ Done | Easy |
| v1.4 | Em-dash fix — normalize WhatsApp autocorrected `—` back to `--` in parser | ✅ Done | Easy |
| v1.4 | `/work` — weekend to-do list with optional per-item reminder; Monday morning digest | ✅ Done | Medium |
| v1.4 | `/menu` refresh — required vs optional flags, shorthand aliases, all commands | ✅ Done | Easy |
| **v1.7 — Local Task Manager** | | | |
| v1.7 | `/task` — local task manager stored in Redis; rename current `/task` to `/gtask`; admin Tasks page replaces Google Tasks widget on dashboard | ✅ Done | Medium |
| **v1.8 — Snooze** | | | |
| v1.8 | Snooze for reminders, tasks, and work — Stage 1: web panel modal (1 day / 3 days / next Monday) + "Add reminder" for items without one. Stage 2: WhatsApp interactive buttons on reminder fire (Snooze 1 day / Next Monday / Dismiss) | ✅ Done | Medium |
| **v1.9 — Multi-User (precursors)** | | | |
| v1.9 | Third-party contacts — register named contacts (e.g. wife) who can send `/set` and `/menu` to create events for Santiago | ✅ Done | Medium |
| v1.9 | `/set` auto-saves as reminder by default; owner taps Reminder / Task / Schedule button to reclassify | ✅ Done | Medium |
| v1.9 | Done notification — when a task created via `/set` is marked done, the original sender is notified | ✅ Done | Easy |
| **v1.13 — Google Tasks Sync** | | | |
| v1.13 | `/task` ↔ Google Tasks two-way sync — local-wins conflict resolution, 15-min poll for Google-side changes, admin toggle | ✅ Done | Medium |
| **v1.14 — Review & Feature Request** | | | |
| v1.14 | Timezone — `/zone` command (IANA name or `GMT±N`), admin timezone input, QStash `CRON_TZ` replaces manual offset math | ✅ Done | Medium |
| v1.14 | Digest fires at wrong time — fixed: timezone change now regenerates all crons; `CRON_TZ` also removes DST drift | ✅ Done | Medium |
| v1.14 | Retire `/gtask` — merged into `/task` (gains `--notes`); sync toggle now gates all push-to-Google | ✅ Done | Medium |
| v1.14 | `/work` → `/ucla` — due dates with automatic 24h-before reminder, morning digest surfacing, data + schedule migration | ✅ Done | Medium |
| v1.14 | Kapso reliability — retry with backoff + request timeout, retries logged distinctly from hard failures | ✅ Done | Medium |
| v1.14 | `/mantis` — CRM inbox capture command | ✅ Done | Easy |
| v1.14 | Admin nav — Reminders split into its own page; Cron Manager moved under Settings | ✅ Done | Medium |
| v1.14 | Nightly health check — Kapso, Google tokens, QStash schedules, Redis; admin banner + best-effort WhatsApp alert | ✅ Done | Medium |
| v1.14 | `/schedule -v` — attach a Google Meet link via `conferenceData.createRequest` | ✅ Done | Easy |
| v1.14 | `/schedule @day` — all-day events; `--duration` flag for hours (timed) or days (`@day`) | ✅ Done | Medium |
| v1.14 | Extend 15-min sync to UCLA tasks with Google-side differentiation | ❌ Cut | — |
| v1.14 | _Cut: `/ucla` is a local-only list, so there are no UCLA tasks in Google Tasks to differentiate. Google Tasks has no per-task color at the API level (`colorId` is Calendar-only); a dedicated tasklist would be the mechanism if this is ever revisited._ | | |
| **v1.15 — Webhook Hardening** | | | |
| v1.15 | Webhook HMAC signature verification — re-enable `webhookSignatureVerify` once Kapso supports sending `x-webhook-signature`; `WEBHOOK_SECRET` env var already defined | ⬜ Pending | Easy |
| **v2.0 — Multi-User Platform** | | | |
| v2.0 | Full multi-user support (shared state, per-user permissions, multiple owners) | ⬜ Pending | Hard |
| **v2.1 — Secretariat for Groups** | | | |
| v2.1 | Group chat support — bot in WhatsApp group, @mention activation, shared ideas + group reminders | 🔒 Blocked | Hard |
| v2.1 | _Blocked: WhatsApp Business Cloud API does not support sending to group chats. Revisit when Kapso/Meta adds group messaging to the API._ | | |
| **v2.2 — Admin Secrets Manager** | | | |
| v2.2 | Env/token manager — configure Kapso, QStash, Google OAuth, Upstash and other secrets directly from the admin panel (no server .env edit) | ⬜ Pending | Medium |
| **v2.3 — Slack Integration** | | | |
| v2.3 | Slack integration — proactive Slack notification when an important message is awaiting a reply/action | ⬜ Pending | Medium |
| **v2.4 — Microsoft / Outlook** | | | |
| v2.4 | Azure / Outlook integration — OAuth2, calendar + tasks | ⬜ Pending | Hard |
| **v2.5 — NLP** | | | |
| v2.5 | AI natural language — interpret messages without `/` via Claude API | ⬜ Pending | Medium |
| **v2.6 — Reliability & Delivery** | | | |
| v2.6 | Meta-approved message template for proactive digests + health alerts — removes the 24h-window delivery risk | ⬜ Pending | Ops |
| ops | Better server — upgrade Render plan or migrate host | ⬜ Pending | Ops |
