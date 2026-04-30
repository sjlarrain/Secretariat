# Secretariat — Claude Code Rules

## Commit Convention

Every commit must follow this format:

```
[vMAJOR.MINOR.PATCH] scope: short description
```

**Rules:**
- `MAJOR.MINOR` maps to the feature version currently being worked on (e.g. `1.1`, `1.2`). Check `BACKLOG.md` for the current version.
- `PATCH` is a sequential counter that increments with each commit on that minor version. Look at the most recent `git log` to find the last patch number and add 1.
- `scope` is the component changed: `backend`, `admin`, `ops`, `ideas`, `parser`, `cron`, `docs`, or a handler name.
- Description is lowercase, imperative, concise (50 chars max).

The message is a single line — no body, no bullet points, no co-author.

**Examples:**
```
[v1.1.4] ideas: projects support + admin Ideas page
[v1.2.1] admin: add activity log page
[v1.1.3] docs: add README and commit convention
```

**Before committing:** run `git log --oneline -5` to confirm the last patch number used.

---

## Project context

See `context.md` for full architecture, folder structure, env vars, and implementation decisions.
See `BACKLOG.md` for the ordered feature queue.

The bot owner is a single WhatsApp user. All commands are prefixed with `/`. Non-command messages are currently rejected (future v1.4: natural language via Claude API).
