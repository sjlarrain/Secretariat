# Inbound routing fix — Kapso Function

Status: **code cleanup done (§7); Kapso dashboard wiring (§4 secrets, §4 wiring)
still owed by Santiago.** Until the Function is created and the Meta webhook is
repointed at it, Kapso is still delivering to whatever it was pointed at before,
and v2 no longer forwards anything to v1 — so Santiago's messages are handled by
v2 (or dropped as unrecognized) rather than by v1.
Supersedes the `platform/v1-proxy.ts` shim, now deleted; `docs/v2-plan.md` §C.8
has been rewritten around the Function.

---

## 1. The problem being fixed

Kapso allows one Meta webhook per phone number, so v2 became the front door and
forwarded Santiago's messages to v1. That hop is Render→Render, and Render's edge
refuses it with **429 on every attempt**, immediately, regardless of retry
schedule or timeout. Confirmed:

| Probe | Result |
|---|---|
| `GET /health` on v1, from an ordinary client | 200 — v1 is up and reachable |
| `POST /webhook/whatsapp` from v2 | 429, instantly, every attempt |
| 429 anywhere in v1's source | none — its webhook returns 200 as its first statement |

No amount of retrying, waiting, or waking fixes this from inside v2. Four
successive attempts to do so are being removed in §5.

## 2. Decision

**Route inbound messages through a Kapso Function.**

Kapso Functions run on Cloudflare Workers (`docs/functions/overview.mdx`), expose
a public invoke URL, and can `fetch()` arbitrary hosts. Pointing Kapso's webhook
at a Function makes the call into v1 **Cloudflare→Render** — the same shape as the
probe that returns 200. The failing hop ceases to exist rather than being worked
around.

Rejected alternative: relaying through Upstash QStash. It works, but adds a third
platform, a fixed ~60s delay, and keeps every piece of state machinery in §5
alive. The Function has one moving part and no delay.

## 3. Target architecture

```
WhatsApp → Kapso → Kapso Function (Cloudflare)
                        ├─ sender is Santiago → v1 /webhook/whatsapp
                        └─ everyone else      → v2 /webhook/whatsapp
```

v2 no longer talks to v1 at all. v1's code is untouched, and — unlike a
two-webhook fan-out — v1 never sees v2's users, so no `whitelistMiddleware`
change on `main` is needed.

## 4. The Function

Source of truth: **`kapso-function/inbound-router.js`** — deployable as-is, with
the design notes below kept as comments beside the code they explain.

Runtime contract: Kapso wraps the code and calls `handler(request, env)`. No
`export default`.

Notes:

- **The body is forwarded byte-for-byte.** Both services re-parse the Meta
  envelope with their own `normalizeWebhook()` and dedup on the message id inside
  it. Never reconstruct fields.
- **Payloads with no message** (status callbacks) have `from === ""` and go to v2,
  which answers `200 {ok:false, reason:'no-sender'}`. Harmless.
- **Multiple numbers** — if more numbers ever belong to v1, make `V1_NUMBER` a
  comma-separated secret and use `.split(",").includes(from)`.
- **The dashboard is the only way to deploy it.** Neither the Kapso CLI nor the
  Kapso MCP manages functions, so the repo copy and the deployed copy are kept in
  step by hand. Edit one, edit the other.

### Secrets (Function page → Secrets tab)

| Name | Value |
|---|---|
| `V1_NUMBER` | Santiago's number, digits only, no `+` |
| `V1_WEBHOOK` | `https://secretariat-r2on.onrender.com/webhook/whatsapp` |
| `V2_WEBHOOK` | v2's public URL + `/webhook/whatsapp` |

Secrets require the function to be deployed first.

### Wiring

1. Create + deploy the Function in the Kapso dashboard (the CLI does not manage
   functions).
2. Set `public_endpoint: true` so Kapso can invoke it without an API key.
3. Repoint the existing **Meta** webhook for the shared number at the Function's
   invoke URL: `https://api.kapso.ai/platform/v1/functions/{function_id}/invoke`.
   Keep it Meta-kind — both services already parse that envelope.

## 5. Cold starts, and why nothing more is needed

If v1 is spun down, the Function's `fetch` is held ~50s by Render's router.
Kapso's deadline is 10s, so that delivery is recorded failed and retried at
**+10s, +40s, +90s**. By the second or third retry v1 is warm and answers fast.
v1's own dedup (`secretariat:dedup:<id>`, 5-minute TTL) absorbs any duplicate
that lands inside the window.

This is exactly how v1 behaved for months before v2 existed. Kapso's retries are
the recovery mechanism — which is why no pending-payload store, redrive, or retry
ladder is needed on either side.

**Do not ack early to dodge the 10s deadline.** The documented runtime signature
is `handler(request, env)` with no `ctx`, so `ctx.waitUntil()` is likely
unavailable and work started after the response may be killed. Await the fetch
and let Kapso retry.

## 6. Cutover to v2

Change one line — `const target = env.V2_WEBHOOK;` — or repoint the Kapso webhook
straight at v2 and delete the Function. Same switch rolls back.

## 7. Cleanup

All of the following exists only to serve the v2→v1 hop and is deleted with it.

### Delete outright

- `backend/src/platform/v1-proxy.ts`
- `backend/src/__tests__/v1-proxy.test.ts`

### Edit

| File | Change |
|---|---|
| `backend/src/platform/routes/webhook.ts` | Drop the `v1ProxyMiddleware` import (line 6), its mount in `router.post('/')` (line 66), and the comment above it (lines 63-65) |
| `backend/src/platform/sweeper.ts` | Drop the `redriveV1Forwards` import (line 13), `SweepResult.v1Redrive` (line 124), and the redrive block in `runSweep()` (lines 145-157) |
| `backend/src/shared/redis/keys.ts` | Remove `'v1-pending'` from `SystemCollection` (lines 49-52) |
| `backend/src/shared/env.ts` | Remove `V1_WEBHOOK_URL` and `V1_PROXY_NUMBERS` from the schema (lines 77-81) and the `v1ProxyNumbers` export (lines 129-137) |
| `backend/src/index.ts` | Remove the `v1Proxy` field from `/health` (line 48). **Keep `commit`.** |
| `backend/src/auth/middleware/resolve-sender.ts` | In the unrecognized-sender log (line 214), drop the `V1_PROXY_NUMBERS` hint; keep the rest of the line |
| `CLAUDE.md` | Delete the "Inbound routing (v2)" bullet and its four sub-bullets (lines 216-219); replace with a short pointer to this document |
| `docs/v2-plan.md` | Rewrite §C.8 (lines 93-107) around the Function |

### Redis

**Status: checked, deliberately left in place** (2026-08-18). `HLEN sys:v1-pending`
returned **3** — all from Santiago's own number, two ~1h old and one ~5h. These are
messages v2 acked to Kapso (so Kapso recorded them delivered) that never reached
v1 and never got a reply.

They were already unrecoverable before the cleanup: the redrive that was supposed
to rescue them runs over the Render->Render hop, which is the 429 in §1, so every
hourly sweep failed until the 24h expiry dropped them silently. Deleting the shim
did not strand them; it removed the machinery that was failing to un-strand them.

Nothing reads or writes this key now, so it is inert. Santiago's call was to leave
it and decide later rather than write the payloads off. Delete when ready:

```bash
HLEN sys:v1-pending   # confirm before destroying
DEL  sys:v1-pending
```

Do **not** try to replay them into v1: same 429, and a successful replay of 1-5h-old
commands can duplicate whatever they created (a reminder, a task).

### Environment

Remove `V1_WEBHOOK_URL` and `V1_PROXY_NUMBERS` from the v2 Render service.

## 8. What stays

- **The `[inbound]` / `[v1-proxy]` routing logs** in `resolve-sender.ts` — minus
  the v1 references. These made the 429 diagnosable at all; the equivalent blind
  spot should not be reintroduced.
- **The `commit` field on `/health`** — the only way to tell which build is live.
- **Both envelope branches** in `extractWebhookData`. The Function forwards the
  Meta envelope, so the Meta branch is the live path, but the Kapso-events branch
  and its warning are worth keeping as a tripwire.

## 9. Verification

1. `npx tsc --noEmit` and `npx vitest run` clean after the cleanup. Expect the
   count to drop by 25 — the v1-proxy suite goes with the module.
2. `grep -rn "v1-proxy\|V1_WEBHOOK_URL\|v1-pending\|redriveV1Forwards" backend/src`
   returns nothing.
3. Send a message from Santiago's number → v1 replies. v2's log shows no
   `[inbound]` line for it, because the Function never routed it there.
4. Send from a registered v2 number → v2 replies, and v1's log shows nothing.
5. Leave v1 idle 15+ minutes, then send. Reply arrives after ~50s via Kapso's
   retry. No message lost.

## 10. Open questions

- **Cloudflare Worker duration** on a ~50s held fetch. Wall-clock time waiting on
  a subrequest is not CPU time, so it should be fine, but this is unverified for
  Kapso's setup. If the Worker is killed mid-fetch, the fallback is the same:
  Kapso retries.
- **`ctx.waitUntil()` availability.** Not in the documented signature. Only
  matters if §5's rely-on-Kapso-retries approach proves insufficient.
- **`public_endpoint: true`** makes the invoke URL callable without an API key.
  Anyone who learns the URL can post a forged webhook. Both services validate the
  sender against their own registries, so a forged payload from an unknown number
  is dropped — but a payload forged *as Santiago* would be processed by v1.
  Consider a shared secret header checked by the Function.
