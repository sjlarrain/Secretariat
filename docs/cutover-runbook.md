# Cutover runbook — moving Santiago's number to v2

Companion to `docs/v1-routing-fix.md` (the routing design) and
`backend/src/scripts/migrate-v1-user.ts` (the data move).

Order matters: **register → migrate → flip → verify.** Registration and the
migration both work over the web and CLI and need no WhatsApp, so the router
flip comes last and is the only step anyone could notice.

---

## 0. Blockers — check these first

Four things will fail, two of them silently. None can be checked from inside the
app.

### 0.1 `GOOGLE_CLIENT_ID` must be identical in v1 and v2 — critical

Google refresh tokens are bound to the OAuth client that issued them. The
migration copies and re-encrypts the tokens, but if `v2.env` names a *different*
Google Cloud project or client id, every migrated token is dead on arrival: the
first refresh returns `invalid_grant` and every calendar command fails.

```bash
grep '^GOOGLE_CLIENT_ID=' Secretariat.env v2.env
```

If they differ, either point v2 at the same client, or accept that you will
reconnect Google by hand after the flip.

### 0.2 Per-user Google OAuth is broken today — needs a code change

`getAuthUrl()` builds the consent URL from a single `GOOGLE_REDIRECT_URI`
(`core/integrations/google/oauth.ts:12`), but there are **two** callback routes:

| Flow | Callback |
|---|---|
| Ops / admin (`ops/routes/google-oauth.ts`) | `/auth/google/callback` |
| Per-user panel (`platform/routes/user-google-oauth.ts`) | `/auth/user/google/callback` |

Google redirects only to the one the env var names, so exactly one of these can
complete. v1's value was `<base>/auth/google/callback`, so if `v2.env` inherited
it, the ops flow works and **a real user can never link their calendar** — they
consent, and Google returns them to a route that demands an admin session.

The fix is small: give `getAuthUrl()` an optional redirect-uri argument, pass
the per-user callback from `user-google-oauth.ts`, and register that second URI
in the Google Console (one client may have many).

This does not block your own cutover — your account arrives via the migration.
It blocks the first friend or family member who tries to connect a calendar.

### 0.3 `WHITELISTED_NUMBERS` in `v2.env` must include the leading `+`

`shared/env.ts:119` splits on commas and trims, but does **not** normalize. Two
things read it:

- `resolveSender()` compares it against a number already normalized to `+…`, so
  without the `+` the legacy-owner fallback never matches.
- The ops Google flow saves the connected account under `whitelistedNumbers[0]`
  *verbatim*. Without the `+`, tokens land in `u:56991296313:accounts`, which
  nothing ever reads.

```bash
grep '^WHITELISTED_NUMBERS=' v2.env
```

Must read `+56991296313`.

### 0.4 The hourly sweeper schedule must exist on v2

One QStash cron drives every digest, reminder promotion, and Google Tasks sync
for every user (`platform/sweeper.ts`). It is created once at boot by
`ensureSweeperSchedule()` — best-effort, so if QStash was unreachable at boot,
the server started anyway and nothing recurring will ever fire.

Confirm exactly one schedule targets `/internal/tick` in the QStash console for
**v2's** project. If it is missing, restart the v2 service. The nightly health
check also reports this as `qstash:sweeper-missing`.

---

## Step 2 — Register the number, then migrate the data

### 2a. Confirm v2 is up

```bash
curl -s https://<v2-host>/health
```

### 2b. Create an invite

Ops console → **Settings → Invites** (`/settings/invites`), signed in at
`/login` with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Generates a single-use token.

### 2c. Register

Open `https://<v2-host>/register/<token>` and submit:

- **WhatsApp number** `+56991296313`
- **Name**
- **Timezone** `America/Santiago`
- **Email** — leave blank. Supplying one sets `calendarAccess: 'pending'` and
  starts the operator approval flow, which you do not need: your Google account
  is already connected in v1 and the migration carries it over.

This writes the `sys:users` entry. The sweeper only processes users in that
registry, so this must happen before the flip.

### 2d. Dry-run the migration

```bash
cd backend && npm run migrate -- --user +56991296313 --from ../Secretariat.env --to ../v2.env
```

Read the report before going further:

- Every `:seq` must equal that list's **highest id**, not its item count. A `0`
  or a missing line means stop — applying in that state lets the next create
  overwrite a real item.
- Item counts should match what `/ideas`, `/links`, `/task`, `/mba` show on v1.
- Registration in 2c wrote a settings row and the migration **overwrites it**
  with v1's. That is intended — just use the same timezone in both.

### 2e. Apply

```bash
cd backend && npm run migrate -- --user +56991296313 --from ../Secretariat.env --to ../v2.env --apply
```

This cancels each queued reminder on v1's QStash and re-queues it against v2.
v1's Redis is never written. Re-running is safe.

---

## Step 3 — Flip the router

Kapso dashboard → the inbound-router Function → editor. In
`kapso-function/inbound-router.js`, replace:

```js
const target = isV1 ? env.V1_WEBHOOK : env.V2_WEBHOOK;
```

with:

```js
const target = env.V2_WEBHOOK;
```

Deploy the Function. Neither v1 nor v2 is redeployed. Keep this repo's copy in
sync with what is in the editor.

**Simpler alternative:** clear the `V1_NUMBER` secret. With no numbers to match,
`isV1` is always false and everything routes to v2 — same effect, and restoring
the secret rolls back without touching code.

---

## Step 4 — Verify, in this order

1. `/start` — routing, sender resolution, registry entry.
2. `/ideas`, `/links`, `/mba`, `/task` — the migration. Then **add one new item
   to each** and confirm it does not overwrite an existing one. This is the real
   test of the `:seq` seeding.
3. `/myschedule` — proves the migrated Google tokens still refresh (see 0.1).
4. `/status` — Kapso and QStash health.
5. `/panel` — sends a one-time sign-in link; proves panel sessions.
6. `/reminder test -f today -a <20 minutes out>` — wait for it to fire. Proves
   the QStash round trip end to end.
7. Next morning: confirm the digest arrives. The sweeper is **hourly**, so an
   08:30 digest now lands during the 08:00–08:59 tick.

---

## Rollback

Restore the `V1_NUMBER` secret, or the original `target` line, in the Function.
v1 is untouched and still deployed.

One caveat: reminders re-queued to v2 in step 2e fire from v2 even while you are
back on v1. They are not lost, they just arrive from the other service.

---

## Google Cloud Console — what is manual, and when

There is **no API** for any of this. The console is the only surface.

### Publishing status decides how often this hurts

While the OAuth app is in **Testing**, refresh tokens expire after **7 days**.
For one user that is a weekly reconnect; for ten it is untenable. Move the app
to **In production** before onboarding real users. That needs a verification
review because `calendar` and `tasks` are both sensitive scopes — so start it
early, not the week you want to invite people.

### Adding a new user while still in Testing

APIs & Services → OAuth consent screen → **Test users** → *Add users* → their
Google address. Up to 100.

The app tracks this because it cannot do it: registering with an email sets
`calendarAccess: 'pending'`, the address shows on the ops **Users** page, and
marking it ready fires the WhatsApp notification with their connect link. The
"ready" action only records that you did the console step — it grants nothing.

### Redirect URIs

APIs & Services → Credentials → the OAuth client → **Authorized redirect URIs**.
Add both v2 callbacks:

```
https://<v2-host>/auth/google/callback
https://<v2-host>/auth/user/google/callback
```

The second is inert until 0.2 is fixed in code, but adding it now costs nothing.

---

## Meta / WhatsApp — the 24-hour window

Any proactive outbound message to someone who has not messaged in 24h requires
an approved Meta message template, or it **fails silently**. That covers morning
digests, weekly summaries, reminder fires, and the calendar-ready notification.

v1 got away with this because Santiago messages daily. A friend who goes quiet
for two days stops receiving reminders and is never told why.

Submit a template in the Meta WhatsApp Manager before onboarding anyone else.
Until then, every proactive send is best-effort.

---

## Onboarding each additional user

1. Ops → Settings → Invites → generate a token; share the link out of band.
2. They register (number, name, timezone, optionally email).
3. If they gave an email: add it as a Google test user in the console, then mark
   them ready on the ops **Users** page — that sends their connect link.
4. They send `/panel` for a sign-in link, and link their calendar.
5. Watch ops → Settings → **Unrecognized** for numbers that messaged without an
   invite. Unregistered senders get no reply by design.
