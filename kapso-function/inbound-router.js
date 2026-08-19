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

  // Two envelopes can arrive depending on how Kapso invokes this:
  //   meta          -> entry[].changes[].value.messages[].from
  //   kapso-events  -> message.from  (top level)
  // The original design assumed only the first. If Kapso wraps the payload,
  // the Meta path yields undefined, `from` is "", and EVERY message silently
  // routes to v2 — which looks like "the function runs but never redirects".
  const metaFrom = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
  const eventsFrom = typeof body?.message?.from === "string" ? body.message.from : undefined;
  const shape = metaFrom ? "meta" : eventsFrom ? "kapso-events" : "unknown";

  // Compare on digits only, so a stray '+' or whitespace in the V1_NUMBER
  // secret cannot silently mis-route every message.
  const digits = (v) => String(v ?? "").replace(/\D/g, "");
  const from = digits(metaFrom ?? eventsFrom);
  const v1 = env.V1_NUMBER.split(",").map(digits).filter(Boolean);

  const isV1 = from !== "" && v1.includes(from);
  const target = isV1 ? env.V1_WEBHOOK : env.V2_WEBHOOK;

  // Without this, a mis-route is invisible: both outcomes return 200.
  console.log(`[route] shape=${shape} from=${from || "(none)"} -> ${isV1 ? "v1" : "v2"}`);

  // Forwarded byte-for-byte. Both services re-parse the envelope with their own
  // normalizeWebhook() and dedup on the message id inside it.
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
