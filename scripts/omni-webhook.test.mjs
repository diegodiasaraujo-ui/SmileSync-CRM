import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createWebhookGateway, webhookPath } from "./omni-webhook.mjs";

async function start(server, context) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  return server.address().port;
}

test("expõe apenas POST do webhook e preserva os bytes e headers de assinatura", async (context) => {
  const body = gzipSync(Buffer.from('[ { "type": "MESSAGE_RECEIVED" } ]'));
  let forwarded;
  const source = createServer(async (incoming, outgoing) => {
    const content = [];
    for await (const chunk of incoming) content.push(chunk);
    forwarded = { path: incoming.url, headers: incoming.headers, body: Buffer.concat(content) };
    outgoing.setHeader("x-internal", "never forwarded").writeHead(204).end();
  });
  const upstreamPort = await start(source, context);
  const gatewayPort = await start(createWebhookGateway(upstreamPort), context);
  const url = `http://127.0.0.1:${gatewayPort}`;
  for (const path of ["/", "/api/health", "/api/auth/session", `${webhookPath}?x=1`]) {
    assert.equal((await fetch(`${url}${path}`)).status, 404);
  }
  assert.equal((await fetch(`${url}${webhookPath}`)).status, 404);
  assert.equal((await fetch(`${url}${webhookPath}`, { method: "POST", body: "[]" })).status, 403);
  assert.equal(forwarded, undefined);
  const response = await fetch(`${url}${webhookPath}`, {
    method: "POST", body,
    headers: { "content-type": "application/json", "content-encoding": "gzip",
      "x-webhook-signature": "t=123,v1=test", "x-idempotency-key": "topic:1:1",
      "x-webhook-delivery-id": "example", cookie: "x=private", authorization: "Bearer ignored" },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("x-internal"), null);
  assert.equal(forwarded.path, webhookPath);
  assert.deepEqual(forwarded.body, body);
  assert.equal(forwarded.headers["x-webhook-signature"], "t=123,v1=test");
  assert.equal(forwarded.headers["x-idempotency-key"], "topic:1:1");
  assert.equal(forwarded.headers["content-encoding"], "gzip");
  assert.equal(forwarded.headers.cookie, undefined);
  assert.equal(forwarded.headers.authorization, undefined);
});
