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
| **v1.5 — Code Review & Hardening** | | | |
| v1.5 | Full code review — security audit, vulnerability check, command edge cases | ⬜ Pending | Medium |
| v1.5 | Env/token manager — configure Kapso, QStash, Google OAuth, Upstash and other secrets directly from the admin panel (no server .env edit) | ⬜ Pending | Medium |
| **v1.6 — Multi-User** | | | |
| v1.6 | User functionality — multi-user support, major open operation | ⬜ Pending | Hard |
| **v1.7 — Todoist** | | | |
| v1.7 | Todoist integration — create & list tasks via API key | ⬜ Pending | Medium |
| **v1.8 — Microsoft / Outlook** | | | |
| v1.8 | Azure / Outlook integration — OAuth2, calendar + tasks | ⬜ Pending | Hard |
| **v1.9 — NLP** | | | |
| v1.9 | AI natural language — interpret messages without `/` via Claude API | ⬜ Pending | Medium |
| ops | Better server — upgrade Render plan or migrate host | ⬜ Pending | Ops |
