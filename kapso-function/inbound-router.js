/**
 * Kapso Function — inbound WhatsApp routing.
 *
 * Kapso allows one Meta webhook per phone number, so exactly one thing is the
 * front door for the shared number. This is it: Santiago's number goes to v1,
 * everyone else goes to v2.
 *
 *   WhatsApp -> Kapso -> this Function (Cloudflare) -> v1 or v2
 *
 * The point is that the hop into v1 is Cloudflare->Render. v2 used to forward
 * to v1 itself and Render's edge refused that Render->Render hop with 429 on
 * every attempt, instantly, regardless of timeout or retry ladder. See
 * docs/v1-routing-fix.md.
 *
 * Runtime contract: Kapso wraps this and calls `handler(request, env)`.
 * No `export default`, and no `ctx` — so no `ctx.waitUntil()`. Await the fetch
 * and let Kapso retry (+10s/+40s/+90s); that is the cold-start story, and it is
 * the only one needed. Do not ack early to dodge Kapso's 10s deadline.
 *
 * This file is the source of truth for what is deployed. Kapso Functions are
 * created and deployed in the dashboard (neither the CLI nor the MCP manages
 * them), so keeping the code here is what makes it reviewable and diffable.
 * Paste it into the Function editor; if you edit it there, edit it here too.
 *
 * Secrets (Function page -> Secrets tab; requires the Function to be deployed
 * first):
 *   V1_NUMBER   Santiago's number, digits only, no '+'
 *   V1_WEBHOOK  https://secretariat-r2on.onrender.com/webhook/whatsapp
 *   V2_WEBHOOK  v2's public URL + /webhook/whatsapp
 *
 * Cutover to v2: replace the `target` line with `const target = env.V2_WEBHOOK;`
 * (or repoint the Kapso webhook straight at v2 and delete the Function). The
 * same switch rolls back.
 */
async function handler(request, env) {
  const body = await request.json().catch(() => ({}));

  // Meta envelope. `from` arrives without a '+', so V1_NUMBER is stored the
  // same way. Payloads with no message (status callbacks) have from === "" and
  // go to v2, which answers 200 {ok:false, reason:'no-sender'}. Harmless.
  //
  // If more numbers ever belong to v1, make V1_NUMBER comma-separated and use
  // env.V1_NUMBER.split(",").includes(from).
  const from = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ?? "";
  const target = from && from === env.V1_NUMBER ? env.V1_WEBHOOK : env.V2_WEBHOOK;

  // Forwarded byte-for-byte. Both services re-parse the Meta envelope with
  // their own normalizeWebhook() and dedup on the message id inside it.
  // Never reconstruct fields.
  const resp = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return new Response(JSON.stringify({ ok: resp.ok, status: resp.status }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
