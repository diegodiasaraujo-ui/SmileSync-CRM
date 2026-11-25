import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request as forwardRequest } from "node:http";
import { pathToFileURL } from "node:url";

export const webhookPath = "/api/whatsapp/omni/webhook";
const maxBytes = 2 * 1024 * 1024;
const forwardedHeaders = [
  "content-type", "content-encoding", "x-webhook-signature",
  "x-idempotency-key", "x-webhook-delivery-id",
];

export function createWebhookGateway(upstreamPort) {
  return createServer({ headersTimeout: 5_000, requestTimeout: 10_000 }, async (incoming, outgoing) => {
    const finish = (status) => {
      if (!outgoing.destroyed && !outgoing.writableEnded) outgoing.writeHead(status).end();
    };
    if (incoming.url !== webhookPath || incoming.method !== "POST") return finish(404);
    if (Number(incoming.headers["content-length"]) > maxBytes) return finish(413);
    if (typeof incoming.headers["x-webhook-signature"] !== "string" ||
        typeof incoming.headers["x-idempotency-key"] !== "string") return finish(403);

    const chunks = [];
    let length = 0;
    try {
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > maxBytes) {
          finish(413);
          return;
        }
        chunks.push(chunk);
      }
    } catch {
      return finish(400);
    }

    const headers = { "content-length": length };
    for (const header of forwardedHeaders) {
      if (typeof incoming.headers[header] === "string") headers[header] = incoming.headers[header];
    }
    const upstream = forwardRequest({
      host: "127.0.0.1", port: upstreamPort, path: webhookPath, method: "POST", headers,
      timeout: 4_000,
    }, (response) => {
      // Return only status, never application error details or headers.
      response.resume();
      finish(response.statusCode ?? 502);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => finish(502));
    outgoing.on("close", () => upstream.destroy());
    upstream.end(Buffer.concat(chunks, length));
  });
}

async function main() {
  try { process.loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const appPort = Number(process.env.SMILESYNC_PORT ?? 4173);
  const gatewayPort = Number(process.env.SMILESYNC_WEBHOOK_PORT ?? 4180);
  if ([appPort, gatewayPort].some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) || appPort === gatewayPort) {
    throw new Error("Use portas locais distintas entre 1024 e 65535 para o CRM e o webhook.");
  }
  const origin = `http://127.0.0.1:${gatewayPort}`;
  const gateway = createWebhookGateway(appPort);
  gateway.listen(gatewayPort, "127.0.0.1");
  await once(gateway, "listening");
  console.log(`Gateway local: ${origin}${webhookPath}`);
  if (!process.argv.includes("--tunnel")) return;

  const tunnel = spawn("cloudflared", ["tunnel", "--url", origin], { stdio: ["ignore", "pipe", "pipe"] });
  let printed = false;
  const showUrl = (output, stream) => {
    stream.write(output);
    const url = String(output).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0];
    if (url && !printed) {
      printed = true;
      console.log(`\nWebhook para cadastrar na Omni: ${url}${webhookPath}\n`);
    }
  };
  tunnel.stdout.on("data", (output) => showUrl(output, process.stdout));
  tunnel.stderr.on("data", (output) => showUrl(output, process.stderr));
  tunnel.on("error", () => {
    console.error("cloudflared não está disponível. Instale a ferramenta da Cloudflare para abrir o túnel.");
    gateway.close();
    process.exitCode = 1;
  });
  tunnel.on("exit", (code) => { gateway.close(); process.exitCode = code ?? 0; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { tunnel.kill(signal); gateway.close(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`Não foi possível iniciar o gateway: ${error.message}`); process.exitCode = 1; });
}
