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
| v1.3 | Links Manager — save & tag URLs via WhatsApp, read archive, admin panel | 🔄 Testing | Easy |
| **v1.4 — Code Review & Hardening** | | | |
| v1.4 | Full code review — security audit, vulnerability check, command edge cases | ⬜ Pending | Medium |
| **v1.5 — Multi-User** | | | |
| v1.5 | User functionality — multi-user support, major open operation | ⬜ Pending | Hard |
| **v1.6 — Todoist** | | | |
| v1.6 | Todoist integration — create & list tasks via API key | ⬜ Pending | Medium |
| **v1.7 — Microsoft / Outlook** | | | |
| v1.7 | Azure / Outlook integration — OAuth2, calendar + tasks | ⬜ Pending | Hard |
| **v1.8 — NLP** | | | |
| v1.8 | AI natural language — interpret messages without `/` via Claude API | ⬜ Pending | Medium |
| ops | Better server — upgrade Render plan or migrate host | ⬜ Pending | Ops |
