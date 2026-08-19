# Secretariat v2.0 — Multi-User Build Plan

## Goal

Transform Secretariat from a single-user bot into a multi-user platform serving ~5–20 people (friends & family) on one shared WhatsApp number, without disrupting the v1 instance while it's being built.

**Not in scope for v2.0:** payments, pricing, public signup, scaling beyond ~20 users.

---

## Ground rules

- One repo, one branch (`multiuser`), **one deployable** — four directories inside a single Express app, not four Render services.
- v1 stays on its current Render service and Upstash DB. v2 gets its own of each.
- One shared WhatsApp number. v2 owns the Kapso webhook; Santiago's own number is proxied to v1 until cutover.
- Merge direction is one-way: `main → multiuser`. Never the reverse.

---

## A. Admin (ops console)

Operator-only surface, separate session from user panels.

**Functionality required:**

1. **Invite users** — generate single-use invite tokens, view outstanding/redeemed tokens, revoke unused ones.
2. **Analytics** — messages per user, active users, command usage, error counts. Read-only.
3. **Approve calendar emails** — list users who submitted an email during onboarding and are awaiting Google access. A "mark ready to link" action fires the WhatsApp notification to that user.
4. **Unrecognized senders** — live list of numbers that messaged without being registered, with a block action.
5. **User management** — view registry, disable a user (stops message processing).

**Note on #3:** the actual granting is manual — Santiago adds the email as a test user in Google Cloud Console. There's no public API for this; the console is the only surface. The admin action only records that it's done and notifies the user.

---

## B. Onboarding flow

**1. Landing page** (public, unauthenticated)
- Explains what Secretariat is and lists the in-house products: reminders, tasks, links, calendar, digests.
- No pricing, no plans, no billing copy.
- Sign-in entry point for existing users.
- Registration is *not* open from here — it requires an invite token.

**2. Registration** (invite token required)
- Santiago shares a single-use token link out-of-band.
- Form fields: WhatsApp number (registrant enters their own), name, **timezone (required)**, consent checkbox, email (optional — only if they want calendar linking).
- On submit: registry entry created, token marked redeemed.

**3. Calendar linking** (two-step, asynchronous)
- If an email was provided, the user is told it's pending.
- Santiago adds it as a Google test user, marks it ready in the admin console.
- User gets a WhatsApp notification with their OAuth connect link.

**4. Panel access**
- User requests access; bot sends a one-time link via WhatsApp to their registered number.
- Link establishes a session. Panel routes are scoped to the session's `userId`.

**5. Unregistered senders**
- No reply is sent. Admin is notified via WhatsApp *and* an ops console entry.

**6. Offboarding**
- Disable-only for v2.0: registry entry marked inactive, message processing stops. Full data deletion goes on the backlog.

---

## C. Backend changes

**1. Key namespacing**
Every Redis key becomes per-user: `secretariat:ideas` → `u:<phone>:ideas`, and the same for links, accounts, settings. `userId` is the phone number. Add a `key(userId, name)` helper and make raw key strings a lint failure so nothing regresses.

**2. Context threading**
Every handler and integration function takes `ctx: { userId, timezone }` instead of reading globals or env. All day-boundary math uses `ctx.timezone` via `Intl.DateTimeFormat` — never `new Date()` + `setHours()`.

**3. User registry**
`WHITELISTED_NUMBERS` env var is replaced by Redis: `users:<phone> → { userId, name, timezone, email, status, createdAt }`. Plus `invites:<token>` and `blocked:<phone>`.

**4. Concurrency**
Current pattern is read-whole-array → mutate → write-whole-array, which loses updates when the cron and an inbound message hit the same key. Fix by moving mutated collections to Redis hashes/sorted sets so each write is atomic. **This is a prerequisite for the namespacing work — same files, same pass.**

**5. Cron collapse**
Five QStash crons become **one hourly sweeper** (`/internal/tick`) that iterates users and fires what's due in each user's timezone. QStash free tier caps at 3 crons; per-user schedules are not viable. Idempotency via `fired:<userId>:<job>:<localDate>` with 48h TTL.

**6. Per-user private access**
Panel routes under `/app` resolve data from the session's `userId` only — never from a URL parameter. Unguessable URLs are not the access control; the session is. A user must not be able to reach another user's data by editing a URL.

**7. Module boundaries**
- `core/` — commands, parsing, integrations (all take `ctx`)
- `platform/` — webhook ingress, user panel, OAuth callbacks
- `ops/` — admin console
- `auth/` — phone→user resolution, user sessions, admin sessions

**8. Inbound routing — Kapso Function**
Kapso allows **one** raw-webhook subscription per phone number (a second `Meta`-type one fails with `already has a meta webhook configured`), so exactly one thing is the front door for the shared number. That front door is a **Kapso Function**, which routes by sender:

```
WhatsApp -> Kapso -> Kapso Function (Cloudflare)
                       |- sender is Santiago -> v1 /webhook/whatsapp
                       `- everyone else      -> v2 /webhook/whatsapp
```

Full design, function source, secrets, and wiring: **`docs/v1-routing-fix.md`**.

- **The routing hop is Cloudflare->Render, not Render->Render.** That is the whole point. v2 previously owned the webhook and forwarded Santiago's messages to v1 itself (`platform/v1-proxy.ts`); Render's edge refused that hop with **429 on every attempt**, instantly, regardless of timeout, retry ladder, or waking v1 first. `GET /health` on v1 from an ordinary client returned 200 throughout. The failing hop no longer exists rather than being worked around.
- **Forward the raw body**, never reconstructed fields. Both services re-parse the Meta envelope with their own `normalizeWebhook()` and dedup on the message id inside it. The webhook stays Meta-kind for the same reason.
- **No message is ever handled by both services.** The Function picks exactly one target. v1 never sees v2's users, so v1's `whitelistMiddleware` needs no change on `main` and never replies `❌ Unauthorized number.` to a new v2 user.
- **Cold starts are Kapso's problem, and Kapso already solves them.** If v1 is spun down, the Function's `fetch` is held ~50s by Render's router, past Kapso's 10s deadline, so the delivery is recorded failed and retried at +10s/+40s/+90s. By the second or third retry v1 is warm. v1's own dedup (`secretariat:dedup:<id>`, 5-minute TTL) absorbs the duplicate. This is how v1 behaved for months before v2 existed — which is why **no pending-payload store, redrive, or retry ladder exists on either side**. Do not ack early inside the Function to dodge the 10s deadline: the documented signature is `handler(request, env)` with no `ctx`, so `ctx.waitUntil()` is likely unavailable and post-response work may be killed.
- **Cutover is one line in the Function** — `const target = env.V2_WEBHOOK;` — or repointing the Kapso webhook straight at v2 and deleting the Function. The same switch rolls back. No deploy of either service.

**Rejected alternatives.** Two subscriptions fanning out to both services: needs v1's `whitelistMiddleware` edited so it stops replying to v2's users, which is a change to live production code, and the second subscription must be `Kapso (events)` type, whose envelope `normalizeWebhook()` does not parse. v2 proxying to v1 in-process: implemented, then deleted — Render->Render is the 429 above, and no amount of timeout, retry, or wake logic reaches it. Relaying through Upstash QStash: works, but adds a third platform, a fixed ~60s delay, and keeps the whole pending/redrive apparatus alive.

**9. Encryption**
Extend the existing AES-256-GCM pattern to sensitive per-user content. Encrypt values only, never keys. Never encrypt a field used for filtering or sorting.

---

## D. Autonomous execution setup

Claude Code works unattended on `multiuser`. Independence is granted via an **allowlist + `dontAsk` mode** — anything not explicitly permitted is silently denied, rather than blocking only what was remembered.

**Allowed:** read/edit/write in repo, all read-only git, commit, push to `multiuser` only, `npm run`/`npm test`, `node`, `tsc`, standard shell utilities, `curl` to localhost for testing the running app.

**Denied:** all package installation (npm/pnpm/yarn/bun/pip/brew/apt), all network egress except git push (`wget`, `scp`, `rsync`, `nc`, `ssh`), reads of `.env` and credential files, pushes to `main`, force-push, `git reset --hard`, remote reconfiguration, `sudo`, `rm -rf`.

Project-specific rules (branch protection, no-install, timezone handling, stopping conditions) live in `CLAUDE.md` at the repo root, which loads automatically into every session and applies to built-in commands including `/goal`. Do **not** define a custom `/goal` command — a custom command named after a bundled skill shadows the built-in one.

**Two guardrails permission rules cannot enforce — set these separately:**

1. **GitHub branch protection on `main`.** Permission patterns match command prefixes, so they can't reliably catch every way an agent might push to `main`. Since `main` is what deploys to live v1, this needs a server-side protection rule, not just a deny pattern.
2. **Render auto-deploy on `multiuser`.** If enabled, every autonomous push deploys. Decide deliberately: auto-deploy is useful for end-to-end testing, noisy if the agent commits frequently.

### Work units

Each runs as an autonomous goal. Success conditions are machine-verifiable — this is a requirement, not a preference. A goal without a testable end state either terminates early or never terminates.

**Goal 1 — Storage layer: concurrency + namespacing + context threading**
Move mutated collections to Redis hashes/sorted sets, namespace every key by `userId`, thread `ctx: { userId, timezone }` through all handlers.
*Verify:* `npm test` passes; `grep -rn "secretariat:" src/` returns no results outside the key-builder module; `npx tsc --noEmit` clean.

**Goal 2 — Registry, onboarding, landing page**
Invite tokens, registration form, landing page, panel sessions, per-user route scoping.
*Verify:* `npm test` passes including new tests proving a session for user A cannot read user B's data; `npx tsc --noEmit` clean.

**Goal 3 — Cron collapse**
Five QStash crons → one hourly sweeper with per-user timezone resolution and idempotency keys.
*Verify:* `npm test` passes including a test that a doubled sweeper run fires each job exactly once.

**Goal 4 — Module boundaries + v1 proxy shim**
`core/` / `platform/` / `ops/` / `auth/` split, unrecognized-sender routing.
*Verify:* `npx tsc --noEmit` clean; `npm test` passes; no imports from `ops/` into `core/`.

---

## Steps before deploying

1. Verify current Google OAuth publishing-status behavior in Cloud Console (Testing mode expires refresh tokens — confirm before relying on it).
2. Create v2 Upstash DB and v2 Render service.
3. Branch `multiuser` off `main`. Enable GitHub branch protection on `main`.
4. Install `.claude/settings.json` and `CLAUDE.md`. Confirm the test command actually works before handing over — every success condition depends on it.
5. Run Goals 1–4 in sequence. Review each before starting the next.
6. Admin console: invites, analytics, email approvals, unrecognized senders.
7. Point the Kapso webhook at v2. Verify Santiago's messages still proxy to v1 correctly.
8. Test end-to-end with one non-Santiago user before inviting the rest.
9. Migrate Santiago's v1 data to `u:<santiago>:*`, remove the proxy shim, leave v1 deployed but idle for one week.

### Migration requirement: seed every `:seq` counter

**The migration script must set each id-minting collection's `:seq` key to the highest id it just wrote.** Skipping this silently destroys data.

`HashCollection.nextId()` mints ids with `INCR` on `u:<userId>:<name>:seq`, which starts at 0 in a fresh namespace. If the migration writes ideas 1–40 but leaves `:seq` unset, the next `/ideas` mints id 1 and the `HSET` **overwrites idea 1** — no error, no duplicate-key failure, the item is just gone.

Six collections mint their own ids and need seeding: `projects`, `ideas`, `links`, `plans`, `tasks`, `mba`. Build the key with `userSeqKey(userId, name)` — never by hand. `SET <seq> <maxId>` (not `INCR`), so re-running the migration is idempotent.

The remaining collections take externally supplied ids and have no `:seq`: `reminders` (string ids), `accounts` (UUIDs), `third-party-*` (phone numbers), `health-alerts`.

---

## Open

- **Meta pricing changes** — noted as understood; not modeled here. Message templates become mandatory for proactive digests outside the 24h window, which is a v2.0 requirement regardless of cost.
- **Number of parallel environments** — this plan assumes two (v1 + v2). A third would need an explicit sender-routing table, since one Kapso number has only one webhook URL.
