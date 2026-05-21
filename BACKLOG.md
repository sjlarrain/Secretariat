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
| **v1.5 — Secretariat for Groups** | | | |
| v1.5 | Group chat support — bot in WhatsApp group, @mention activation, shared ideas + group reminders | 🔒 Blocked | Hard |
| v1.5 | _Blocked: WhatsApp Business Cloud API does not support sending to group chats. Revisit when Kapso/Meta adds group messaging to the API._ | | |
| **v1.6 — Code Review & Hardening** | | | |
| v1.6 | Full code review — security audit, vulnerability check, command edge cases | ⬜ Pending | Medium |
| v1.6 | Webhook HMAC signature verification — re-enable `webhookSignatureVerify` once Kapso supports sending `x-webhook-signature`; `WEBHOOK_SECRET` env var already defined | ⬜ Pending | Easy |
| v1.5 | Env/token manager — configure Kapso, QStash, Google OAuth, Upstash and other secrets directly from the admin panel (no server .env edit) | ⬜ Pending | Medium |
| **v1.7 — Local Task Manager** | | | |
| v1.7 | `/task` — local task manager stored in Redis; rename current `/task` to `/gtask`; admin Tasks page replaces Google Tasks widget on dashboard | ✅ Done | Medium |
| **v1.8 — Snooze** | | | |
| v1.8 | Snooze for reminders, tasks, and work — Stage 1: web panel modal (1 day / 3 days / next Monday) + "Add reminder" for items without one. Stage 2: WhatsApp interactive buttons on reminder fire (Snooze 1 day / Next Monday / Dismiss) | ✅ Done | Medium |
| **v1.9 — Multi-User** | | | |
| v1.9 | User functionality — multi-user support, major open operation | ⬜ Pending | Hard |
| **v1.10 — Todoist** | | | |
| v1.10 | Todoist integration — create & list tasks via API key | ⬜ Pending | Medium |
| **v1.11 — Microsoft / Outlook** | | | |
| v1.11 | Azure / Outlook integration — OAuth2, calendar + tasks | ⬜ Pending | Hard |
| **v1.12 — NLP** | | | |
| v1.12 | AI natural language — interpret messages without `/` via Claude API | ⬜ Pending | Medium |
| ops | Better server — upgrade Render plan or migrate host | ⬜ Pending | Ops |
