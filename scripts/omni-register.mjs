import { randomUUID } from "node:crypto";
import { access, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { webhookPath } from "./omni-webhook.mjs";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
const api = "https://api.omni.z-api.io";

async function main() {
  let url;
  try { url = new URL(process.argv[2]); } catch { throw new Error(`Informe a URL pública HTTPS terminando em ${webhookPath}.`); }
  if (url.protocol !== "https:" || url.pathname !== webhookPath || url.username || url.password || url.search || url.hash) {
    throw new Error(`Informe a URL pública HTTPS terminando em ${webhookPath}.`);
  }
  const file = await lstat(envFile).catch(() => null);
  if (!file?.isFile()) throw new Error("Crie o .env na raiz com uma cópia de .env.example antes de continuar.");
  await access(envFile, constants.R_OK | constants.W_OK);
  const original = await readFile(envFile, "utf8");
  const env = parseEnv(original);
  const channel = env.OMNI_CHANNEL_ID?.trim();
  const key = env.OMNI_SECRET_KEY?.trim();
  const webhook = env.OMNI_WEBHOOK_ID?.trim() || "";
  if (!channel || !/^[A-Za-z0-9_-]{1,80}$/.test(channel) || !key || !/^[A-Za-z0-9_-]{0,80}$/.test(webhook)) {
    throw new Error("Preencha OMNI_CHANNEL_ID e OMNI_SECRET_KEY no .env local.");
  }
  if (env.OMNI_WEBHOOK_SECRET && !webhook) {
    throw new Error("Já há um segredo no .env. Informe OMNI_WEBHOOK_ID do webhook correspondente ou atualize a URL pelo painel.");
  }
  const rotate = !webhook || !env.OMNI_WEBHOOK_SECRET;
  const endpoint = `${api}/v1/channels/${encodeURIComponent(channel)}/webhooks${webhook ? `/${encodeURIComponent(webhook)}` : ""}`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: webhook ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.href, events: ["MESSAGE_RECEIVED", "MESSAGE_DELIVERY", "MESSAGE_STATUS"],
        payloadFormat: "DEFAULT", ...(rotate ? { signing: true } : {}) }),
      signal: AbortSignal.timeout(12_000), redirect: "error",
    });
  } catch {
    throw new Error("Falha de rede. Confira no painel se o webhook já foi criado antes de repetir.");
  }
  if (!response.ok) throw new Error(`A Omni respondeu HTTP ${response.status}. Confira canal, chave e URL pública.`);
  if (!rotate) {
    console.log("URL do webhook atualizada, com a assinatura existente.");
    return;
  }

  const reply = await response.json().catch(() => null);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(reply?.id ?? "") || !/^[0-9a-f]{64}$/i.test(reply?.secret ?? "")) {
    throw new Error("A Omni não retornou o ID e segredo esperados. Confira o webhook no painel.");
  }
  const updated = original.replace(/^\s*(?:OMNI_WEBHOOK_ID|OMNI_WEBHOOK_SECRET)[ \t]*=.*(?:\r?\n|$)/gm, "").trimEnd();
  const temporary = `${envFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${updated}\nOMNI_WEBHOOK_ID=${reply.id}\nOMNI_WEBHOOK_SECRET=${reply.secret}\n`, { mode: 0o600, flag: "wx" });
    if (await readFile(envFile, "utf8") !== original) throw new Error("Arquivo alterado durante o cadastro.");
    await rename(temporary, envFile);
  } catch {
    throw new Error("O webhook foi cadastrado, mas o .env não foi atualizado. Confira o painel antes de repetir.");
  } finally {
    await unlink(temporary).catch(() => {});
  }
  console.log("Webhook assinado cadastrado. O segredo ficou no .env local. Reinicie o CRM.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
