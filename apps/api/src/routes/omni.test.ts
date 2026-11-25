import { createHmac, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig, type OmniConfig } from "../config.js";
import { createDatabase, type Database } from "../database.js";
import { brazilPhone } from "../whatsapp/omni.js";
import { omniWebhookPath } from "./whatsapp.js";

const clinicPhone = "5534999990001";
const contactPhone = "5534999990002";
const channelId = "01A00000000000000000000000000001";
const outboundId = "01A00000000000000000000000000002";
const webhookSecret = "a".repeat(64);
const token = "fixture-non-secret";
const base: AppConfig = loadConfig({ NODE_ENV: "test" });
const inboxUrl = "/api/whatsapp/conversations";

function envelope(message: Record<string, unknown>) {
  return { message: { channel_id: channelId, ...message }, messageEventType: "NEW_MESSAGE" };
}

function sign(
  payload: object,
  offset: number,
  options: { gzip?: boolean; stale?: boolean; invalid?: boolean } = {},
) {
  const body = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000) - (options.stale ? 330 : 0);
  const hash = createHmac("sha256", options.invalid ? "bad-secret" : webhookSecret)
    .update(`${timestamp}\nwebhook.delivery.event\n0\n${offset}\n`)
    .update(body)
    .digest("hex");
  return {
    method: "POST" as const,
    url: omniWebhookPath,
    payload: options.gzip ? gzipSync(body) : body,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": `t=${timestamp},v1=${hash}`,
      "x-idempotency-key": `webhook.delivery.event:0:${offset}`,
      ...(options.gzip ? { "content-encoding": "gzip" } : {}),
    },
  };
}

function callback(name: string, moment: number) {
  return envelope({
    _id: outboundId,
    metadata: { from_me: true, from_api: false },
    contents: [{ type: "MessageStatusCallback", state: { name }, moment, phone: "12345@lid" }],
    recipient: { identifier: contactPhone },
  });
}

describe("Z-API Omni", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: Database;
  let patientId: string;
  let selfPatientId: string;
  let headers: { origin: string; cookie: string };
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let sendHandler: (() => Promise<Response>) | undefined;

  beforeEach(async () => {
    database = createDatabase("pglite://memory");
    const seed = await buildApp({ config: base, database, migrate: true });
    const owner = await seed.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: "Conta Fictícia Omni",
        email: "omni@example.test",
        password: "SenhaDemo1234",
      },
    });
    expect(owner.statusCode, owner.body).toBe(201);
    const { userId, clinicId } = owner.json().session;
    headers = {
      origin: base.appOrigin,
      cookie: String(owner.headers["set-cookie"]).split(";", 1)[0]!,
    };
    patientId = randomUUID();
    selfPatientId = randomUUID();
    await database.query(
      `INSERT INTO patients (id, clinic_id, full_name, phone_e164, created_by)
       VALUES ($1,$2,'Paciente Fictício',$3,$4),($5,$2,'Remetente Fictício',$6,$4)`,
      [patientId, clinicId, `+${contactPhone}`, userId, selfPatientId, `+${clinicPhone}`],
    );
    await seed.close();
    const omni: OmniConfig = {
      clinicId,
      channelId,
      baseUrl: "https://api.omni.z-api.io",
      secretKey: token,
      webhookSecret,
    };
    sendHandler = undefined;
    fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      expect(String(input)).toBe(
        `${omni.baseUrl}/v1/channels/${channelId}${init?.method === "POST" ? "/messages" : ""}`,
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          recipient: { identifier: contactPhone },
          content: { type: "TEXT", body: { message: "Olá, teste autorizado." } },
        });
        return sendHandler ? sendHandler() : Response.json({ messageId: outboundId });
      }
      return Response.json({
        id: channelId,
        type: "Z_API_WHATSAPP",
        whatsappConnected: true,
        phoneNumberConnected: "+55 (34) 99999-0001",
      });
    });
    app = await buildApp({
      config: { ...base, omni, whatsappProvider: "zapi_omni" },
      database,
      migrate: false,
      whatsappFetch: fetcher,
    });
  });

  afterEach(async () => {
    await app?.close();
    await database?.close();
  });

  const start = (srv: Awaited<ReturnType<typeof buildApp>>, auth: typeof headers, id: string) =>
    srv.inject({ method: "POST", url: inboxUrl, payload: { patientId: id }, headers: auth });

  const send = (srv: Awaited<ReturnType<typeof buildApp>>, auth: typeof headers, id: string) =>
    srv.inject({
      method: "POST",
      url: `${inboxUrl}/${id}/messages`,
      payload: { text: "Olá, teste autorizado.", idempotencyKey: "send-test-1" },
      headers: auth,
    });

  it("aceita brasileiros formatados sem deduzir identificadores ou aceitar números incompletos", () => {
    expect(brazilPhone("(34) 99999-0002")).toBe(`+${contactPhone}`);
    expect(brazilPhone("+55 (34) 99999-0002")).toBe(`+${contactPhone}`);
    expect(brazilPhone("99999-0002")).toBeNull();
    expect(brazilPhone("5534999990002@lid")).toBeNull();
    expect(
      loadConfig({ NODE_ENV: "test", WHATSAPP_PROVIDER: "zapi_omni", OMNI_SECRET_KEY: "bad" }).omni,
    ).toBeUndefined();
  });

  it("envia pelo contrato documentado e mantém etapas distintas, sem regredir com callbacks antigos", async () => {
    const inbox = await app.inject({ url: inboxUrl, headers });
    expect(inbox.json()).toMatchObject({
      configured: true,
      canStart: true,
      connectionStatus: "connected",
    });
    const opened = await start(app, headers, patientId);
    expect(opened.statusCode, opened.body).toBe(200);
    const { conversation } = opened.json();
    expect(conversation).toMatchObject({
      patientId,
      phone: `+${contactPhone}`,
      canSendText: true,
      awaitingReply: false,
    });
    const result = await send(app, headers, conversation.id);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().message.status).toBe("accepted");
    const bodyAt = Date.now() - 1000;
    const pending = await app.inject(sign(callback("PENDING", bodyAt), 1));
    expect(pending.statusCode, pending.body).toBe(200);
    const history = () => app.inject({ url: `${inboxUrl}/${conversation.id}`, headers });
    expect((await history()).json().messages[0].status).toBe("pending");
    const delivered = await app.inject(sign(callback("RECEIVED", bodyAt + 500), 2, { gzip: true }));
    expect(delivered.statusCode, delivered.body).toBe(200);
    expect((await app.inject(sign(callback("SENT", bodyAt + 250), 3))).statusCode).toBe(200);
    expect((await history()).json().messages[0].status).toBe("delivered");
    expect((await send(app, headers, conversation.id)).json().message.status).toBe("delivered");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("guarda confirmação que chega antes da resposta HTTP da Omni", async () => {
    const opened = await start(app, headers, patientId);
    expect(opened.statusCode, opened.body).toBe(200);
    sendHandler = async () => {
      const ack = await app.inject(sign(callback("SENT", Date.now()), 40));
      expect(ack.statusCode, ack.body).toBe(200);
      return Response.json({ messageId: outboundId });
    };
    const response = await send(app, headers, opened.json().conversation.id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().message.status).toBe("sent");
  });

  it("exige HMAC, rejeita replays antigos e deduplica mensagens ligadas ao paciente", async () => {
    const message = envelope({
      _id: "01A00000000000000000000000000003",
      created: Date.now(),
      metadata: { from_me: false },
      sender: { identifier: "+55 (34) 99999-0002" },
      contents: [{ type: "TEXT", message: "Mensagem de teste recebida." }],
    });
    expect((await app.inject(sign(message, 1, { invalid: true }))).statusCode).toBe(403);
    expect((await app.inject(sign(message, 1, { stale: true }))).statusCode).toBe(403);
    expect((await app.inject(sign(message, 1))).statusCode).toBe(200);
    expect((await app.inject(sign(message, 1))).statusCode).toBe(200);
    expect((await app.inject(sign(message, 9))).statusCode).toBe(200);
    const listing = await app.inject({ url: inboxUrl, headers });
    expect(listing.json().conversations).toHaveLength(1);
    expect(listing.json().conversations[0]).toMatchObject({ patientId, awaitingReply: true });
    const detail = await app.inject({
      url: `${inboxUrl}/${listing.json().conversations[0].id}`,
      headers,
    });
    expect(detail.json().messages).toMatchObject([
      { direction: "inbound", text: "Mensagem de teste recebida." },
    ]);
  });

  it("não tenta enviar para o próprio número conectado", async () => {
    const opened = await start(app, headers, selfPatientId);
    expect(opened.statusCode, opened.body).toBe(400);
    expect(opened.json().code).toBe("omni_self_send");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});
