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
// Identifies the human party of the conversation, whatever the payload kind and
// however it is nested:
//   inbound message  -> value.messages[].from
//   status callback  -> value.contacts[].wa_id / value.statuses[].recipient_id
// Statuses carry no `from`, so keying only on that sent every delivery receipt
// to v2 regardless of which service actually sent the message.
function findParty(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return undefined;

  const v = node?.value ?? node;
  const cand =
    v?.messages?.[0]?.from ??
    v?.messages?.[0]?.phone_number ??
    v?.contacts?.[0]?.wa_id ??
    v?.statuses?.[0]?.recipient_id ??
    node?.message?.from ??
    node?.message?.phone_number;
  if (typeof cand === "string" && cand) return cand;

  for (const child of Array.isArray(node) ? node : Object.values(node)) {
    const hit = findParty(child, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

async function handler(request, env) {
  const body = await request.json().catch(() => ({}));

  // Digits-only comparison, so a stray '+' or whitespace in the V1_NUMBER
  // secret cannot mis-route every message. Comma-separated V1_NUMBER works too.
  const digits = (v) => String(v ?? "").replace(/\D/g, "");
  const from = digits(findParty(body));
  const v1 = String(env.V1_NUMBER ?? "").split(",").map(digits).filter(Boolean);

  const isV1 = from !== "" && v1.includes(from);
  const target = isV1 ? env.V1_WEBHOOK : env.V2_WEBHOOK;

  // Both outcomes return 200, so without this a mis-route is invisible. When no
  // sender is found, dump the shape — that is the only way to learn the wrapper.
  console.log(`[route] from=${from || "(none)"} v1=[${v1.join(",")}] -> ${isV1 ? "v1" : "v2"}`);
  if (!from) console.log(`[route] NO SENDER; body=${JSON.stringify(body).slice(0, 1500)}`);

  // Forwarded byte-for-byte. Both services re-parse the envelope with their own
  // normalizeWebhook() and dedup on the message id inside it.
  const resp = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // `from`/`route` are echoed because Kapso's invocation log captures
  // response_body but not console output — this is the only visible diagnostic.
  return new Response(JSON.stringify({ ok: resp.ok, status: resp.status, from: from || null, route: isV1 ? "v1" : "v2" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
