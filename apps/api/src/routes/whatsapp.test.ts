import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { AppConfig, WhatsAppConfig } from "../config.js";
import { createDatabase, type Database } from "../database.js";
import type { WhatsAppScheduler } from "./whatsapp.js";

const baseConfig: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  appOrigin: "http://127.0.0.1:4173",
  databaseUrl: "pglite://memory",
  migrateOnStart: true,
  sessionTtlDays: 7,
  passwordResetTtlMinutes: 30,
  cookieName: "smilesync_session",
  exposeTestResetTokens: false,
};

const webhookUrl = "/api/whatsapp/webhook";
const inboxUrl = "/api/whatsapp/conversations";
const patientPhone = "5534999990000";
const timestamp = (offsetMs = 0) => String(Math.floor((Date.now() + offsetMs) / 1000));

function databaseUrlForTests() {
  const explicit = process.env.SMILESYNC_TEST_POSTGRES_URL;
  if (!explicit) return baseConfig.databaseUrl;
  const url = new URL(explicit);
  if (
    url.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !["/smilesync_test", "/smilesync_waqa"].includes(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use um PostgreSQL local e exclusivo chamado smilesync_test ou smilesync_waqa.",
    );
  return explicit;
}

function cookieFrom(headers: Record<string, unknown>) {
  const value = headers["set-cookie"];
  return (Array.isArray(value) ? String(value[0]) : String(value)).split(";", 1)[0]!;
}

describe("WhatsApp Cloud API", () => {
  let database: Database;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let whatsapp: WhatsAppConfig;
  let clinicId: string;
  let patientId: string;
  let ownerId: string;
  let headers: { origin: string; cookie: string };
  let secondHeaders: { origin: string; cookie: string };
  let meta: ReturnType<typeof vi.fn<typeof fetch>>;
  let schedule: ReturnType<typeof vi.fn<WhatsAppScheduler>>;

  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_BOOKING_OPENAI_ENABLED", "false");
    database = createDatabase(databaseUrlForTests());
    const bootstrap = await buildApp({ database, config: baseConfig, logger: false });
    const register = (name: string, email: string) =>
      bootstrap.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { name, email, password: "SenhaSegura123" },
      });
    const owner = await register("Administradora Clínica", `${randomUUID()}@example.test`);
    const second = await register("Administrador Outra", `${randomUUID()}@example.test`);
    expect(owner.statusCode, owner.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);
    const session = owner.json().session;
    clinicId = session.clinicId;
    ownerId = session.userId;
    headers = { origin: baseConfig.appOrigin, cookie: cookieFrom(owner.headers) };
    secondHeaders = { origin: baseConfig.appOrigin, cookie: cookieFrom(second.headers) };
    patientId = randomUUID();
    await database.query(
      `INSERT INTO patients (id, clinic_id, full_name, phone_e164, created_by)
      VALUES ($1, $2, 'Paciente Fictício', $3, $4)`,
      [patientId, clinicId, `+${patientPhone}`, ownerId],
    );
    await bootstrap.close();
    whatsapp = {
      clinicId,
      accessToken: "fake-api-token-for-tests",
      appSecret: "fake-app-secret-for-tests",
      verifyToken: "fake-verification-token-for-tests",
      phoneNumberId: "1234500001",
      businessAccountId: "1234500002",
      graphApiVersion: "v27.0",
      schedulingEnabled: true,
    };
    let sent = 0;
    meta = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      if (init?.method === "POST")
        return Response.json({
          messages: [{ id: `wamid.OUT.${String(++sent).padStart(3, "0")}` }],
        });
      return Response.json({
        data: [
          {
            id: "1000",
            name: "servico_clinica",
            status: "APPROVED",
            category: "UTILITY",
            language: "pt_BR",
            components: [{ type: "BODY", text: "Entre em contato com nossa recepção." }],
          },
          {
            id: "2000",
            name: "modelo_invalido",
            status: "APPROVED",
            category: "UTILITY",
            language: "pt_BR",
            components: [{ type: "BODY", text: "Olá, {{1}}" }],
          },
        ],
      });
    });
    schedule = vi.fn<WhatsAppScheduler>().mockResolvedValue(undefined);
    app = await buildApp({
      database,
      config: { ...baseConfig, whatsapp },
      migrate: false,
      logger: false,
      whatsappFetch: meta,
      whatsappScheduler: schedule,
    });
  });

  afterEach(async () => {
    await app?.close();
    await database?.close();
    vi.unstubAllEnvs();
  });

  function packet(
    payload: Record<string, unknown>,
    phoneNumberId = whatsapp.phoneNumberId,
    wabaId = whatsapp.businessAccountId,
  ) {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: wabaId,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: phoneNumberId },
                ...payload,
              },
            },
          ],
        },
      ],
    };
  }

  function inbound(text = "Quero agendar uma avaliação", time = timestamp(), id = "wamid.IN.001") {
    return { id, timestamp: time, from: patientPhone, type: "text", text: { body: text } };
  }

  function signed(payload: object, valid = true) {
    const raw = JSON.stringify(payload, null, 2);
    const signature = createHmac("sha256", valid ? whatsapp.appSecret : "wrong-fake-test-secret")
      .update(raw)
      .digest("hex");
    return app.inject({
      method: "POST",
      url: webhookUrl,
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${signature}`,
      },
    });
  }

  async function conversation() {
    const reply = await app.inject({ method: "GET", url: inboxUrl, headers });
    expect(reply.statusCode, reply.body).toBe(200);
    return reply.json().conversations[0];
  }

  function send(conversationId: string, payload: Record<string, string>) {
    return app.inject({
      method: "POST",
      url: `${inboxUrl}/${conversationId}/messages`,
      headers,
      payload,
    });
  }

  it("verifica o desafio e a assinatura dos bytes antes de persistir", async () => {
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": whatsapp.verifyToken,
      "hub.challenge": "462812",
    });
    const verification = await app.inject({ method: "GET", url: `${webhookUrl}?${query}` });
    expect(verification.statusCode).toBe(200);
    expect(verification.body).toBe("462812");
    expect(verification.headers["content-type"]).toContain("text/plain");
    query.set("hub.verify_token", "invalid");
    expect((await app.inject({ method: "GET", url: `${webhookUrl}?${query}` })).statusCode).toBe(
      403,
    );

    const message = inbound();
    expect((await signed(packet({ messages: [message] }), false)).statusCode).toBe(403);
    expect((await signed(packet({ messages: [message] }, "1234599999"))).statusCode).toBe(200);
    expect(
      (await signed(packet({ messages: [message] }, whatsapp.phoneNumberId, "1234599999")))
        .statusCode,
    ).toBe(200);
    expect(
      (await database.query("SELECT id FROM whatsapp_messages WHERE clinic_id = $1", [clinicId]))
        .rowCount,
    ).toBe(0);
  });

  it("vincula o telefone ao paciente, preserva o histórico e deduplica reentregas", async () => {
    const packetContent = packet({ messages: [inbound()] });
    for (let retry = 0; retry < 2; retry += 1) {
      const response = await signed(packetContent);
      expect(response.statusCode, response.body).toBe(200);
    }
    const thread = await conversation();
    expect(thread).toMatchObject({
      patientId,
      patientName: "Paciente Fictício",
      phone: `+${patientPhone}`,
      awaitingReply: true,
      canSendText: true,
    });
    const detail = await app.inject({ method: "GET", url: `${inboxUrl}/${thread.id}`, headers });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().messages).toEqual([
      expect.objectContaining({
        text: "Quero agendar uma avaliação",
        direction: "inbound",
        status: "received",
      }),
    ]);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(schedule.mock.calls[0]?.[0].messageId).toBe(schedule.mock.calls[1]?.[0].messageId);
    expect(
      (await app.inject({ method: "GET", url: `${inboxUrl}/${thread.id}`, headers: secondHeaders }))
        .statusCode,
    ).toBe(404);
    expect((await app.inject({ method: "GET", url: inboxUrl })).statusCode).toBe(401);
  });

  it("envia uma vez por chave e não retrocede de entregue para enviado", async () => {
    expect((await signed(packet({ messages: [inbound()] }))).statusCode).toBe(200);
    const thread = await conversation();
    const payload = { text: "Boa tarde!", idempotencyKey: "send-once-1" };
    const response = await send(thread.id, payload);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().message.status).toBe("submitted");
    expect(meta.mock.calls[0]?.[0]).toBe(
      `https://graph.facebook.com/${whatsapp.graphApiVersion}/${whatsapp.phoneNumberId}/messages`,
    );
    const externalBody = JSON.parse(String(meta.mock.calls[0]?.[1]?.body));
    expect(externalBody).toMatchObject({
      messaging_product: "whatsapp",
      to: patientPhone,
      type: "text",
      text: { body: "Boa tarde!" },
      biz_opaque_callback_data: response.json().message.id,
    });
    expect((await send(thread.id, payload)).json().message.id).toBe(response.json().message.id);
    expect((await send(thread.id, { ...payload, text: "Outro texto" })).statusCode).toBe(409);
    expect(meta).toHaveBeenCalledTimes(1);
    for (const status of ["delivered", "sent"]) {
      const reply = await signed(
        packet({
          statuses: [
            { id: "wamid.OUT.001", recipient_id: patientPhone, timestamp: timestamp(), status },
          ],
        }),
      );
      expect(reply.statusCode, reply.body).toBe(200);
    }
    const detail = (
      await app.inject({ method: "GET", url: `${inboxUrl}/${thread.id}`, headers })
    ).json();
    expect(detail.messages.at(-1)).toMatchObject({ direction: "outbound", status: "delivered" });
    expect(detail.conversation.awaitingReply).toBe(false);
  });

  it("fecha a janela de 24h e restringe modelos a autorização registrada e aprovação vigente", async () => {
    expect(
      (
        await signed(
          packet({ messages: [inbound("Mensagem anterior", timestamp(-25 * 60 * 60 * 1000))] }),
        )
      ).statusCode,
    ).toBe(200);
    const thread = await conversation();
    expect(thread).toMatchObject({ canSendText: false, sendBlock: "window_closed" });
    const textResult = await send(thread.id, {
      text: "Resposta expirada",
      idempotencyKey: "window",
    });
    expect(textResult.json().code).toBe("whatsapp_window_closed");
    expect(
      (await send(thread.id, { templateId: "1000", idempotencyKey: "template" })).json().code,
    ).toBe("template_consent_required");
    expect(meta).not.toHaveBeenCalled();

    await database.query(
      `INSERT INTO patient_consents
      (clinic_id, patient_id, channel, purpose, status, evidence_source, recorded_at)
      VALUES ($1, $2, 'whatsapp', 'whatsapp_utility', 'granted', 'test', now())`,
      [clinicId, patientId],
    );
    const detail = await app.inject({ method: "GET", url: `${inboxUrl}/${thread.id}`, headers });
    expect(detail.json().templates).toEqual([
      { id: "1000", name: "servico_clinica", languageCode: "pt_BR" },
    ]);
    expect(
      (await send(thread.id, { templateId: "2000", idempotencyKey: "unusable-template" })).json()
        .code,
    ).toBe("template_not_available");
    const result = await send(thread.id, { templateId: "1000", idempotencyKey: "template" });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().message).toMatchObject({
      text: "Entre em contato com nossa recepção.",
      status: "submitted",
    });
    expect(meta).toHaveBeenCalledTimes(2);
  });

  it("preserva envio incerto e reconcilia confirmação oficial pelo identificador opaco", async () => {
    expect((await signed(packet({ messages: [inbound()] }))).statusCode).toBe(200);
    const thread = await conversation();
    meta.mockRejectedValueOnce(new Error("fake timed out response"));
    const payload = { text: "Olá", idempotencyKey: "uncertain-send" };
    const response = await send(thread.id, payload);
    expect(response.json().message.status).toBe("unknown");
    expect((await send(thread.id, payload)).json().message.status).toBe("unknown");
    expect(meta).toHaveBeenCalledTimes(1);
    const status = await signed(
      packet({
        statuses: [
          {
            id: "wamid.OUT.RECONCILE",
            recipient_id: patientPhone,
            timestamp: timestamp(),
            status: "read",
            biz_opaque_callback_data: response.json().message.id,
          },
        ],
      }),
    );
    expect(status.statusCode, status.body).toBe(200);
    expect((await send(thread.id, payload)).json().message.status).toBe("read");
  });

  it("respeita o pedido de parar e não envia mensagens nem aciona automação", async () => {
    expect(
      (await signed(packet({ messages: [inbound("Não quero receber mensagens!")] }))).statusCode,
    ).toBe(200);
    const thread = await conversation();
    expect(thread).toMatchObject({ canSendText: false, sendBlock: "contact_opted_out" });
    expect((await send(thread.id, { text: "Olá", idempotencyKey: "opt-out" })).json().code).toBe(
      "contact_opted_out",
    );
    expect(schedule).not.toHaveBeenCalled();
    expect(meta).not.toHaveBeenCalled();
  });

  it("permite consultar histórico anterior sem duplicar a fronteira da página", async () => {
    expect(
      (await signed(packet({ messages: [inbound("Mensagem mais recente")] }))).statusCode,
    ).toBe(200);
    const { id } = await conversation();
    await database.query(
      `INSERT INTO whatsapp_messages
        (clinic_id, conversation_id, provider_message_id, direction, kind, text_content, status, occurred_at)
       SELECT $1, $2, 'wamid.HISTORY.' || n, 'inbound', 'text', 'Página anterior ' || n, 'received',
              now() - make_interval(hours => 1, secs => n)
       FROM generate_series(1, 102) AS series(n)`,
      [clinicId, id],
    );
    const url = `${inboxUrl}/${id}`;
    const first = (await app.inject({ url, headers })).json();
    expect(first.messages).toHaveLength(100);
    expect(first.messages.at(-1).text).toBe("Mensagem mais recente");
    expect(first.nextCursor).toBe(first.messages[0].id);
    const older = (await app.inject({ url: `${url}?before=${first.nextCursor}`, headers })).json();
    expect(older.messages).toHaveLength(3);
    expect(older.nextCursor).toBeNull();
    expect(older.messages.map((message: { text: string }) => message.text)).toEqual([
      "Página anterior 102",
      "Página anterior 101",
      "Página anterior 100",
    ]);
  });

  it("permite atendimento a um funcionário autorizado, sem acesso à configuração de integrações", async () => {
    expect((await signed(packet({ messages: [inbound()] }))).statusCode).toBe(200);
    const thread = await conversation();
    await database.query(
      `UPDATE clinic_memberships m SET role_id = r.id
       FROM roles r WHERE r.clinic_id = m.clinic_id AND r.code = 'recepcao'
         AND m.clinic_id = $1 AND m.user_id = $2`,
      [clinicId, ownerId],
    );
    expect((await app.inject({ method: "GET", url: inboxUrl, headers })).statusCode).toBe(403);

    const grant = (permission: string) =>
      database.query(
        `INSERT INTO role_permissions (clinic_id, role_id, permission_code)
         SELECT clinic_id, id, $2 FROM roles WHERE clinic_id = $1 AND code = 'recepcao'`,
        [clinicId, permission],
      );
    await grant("whatsapp.inbox.read");
    expect((await app.inject({ method: "GET", url: inboxUrl, headers })).statusCode).toBe(200);
    const response = { text: "Boa tarde", idempotencyKey: "reception-reply" };
    expect((await send(thread.id, response)).statusCode).toBe(403);
    await grant("whatsapp.inbox.send");
    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers });
    expect(session.json().session.permissions).not.toContain("integrations.update");
    expect((await send(thread.id, response)).statusCode).toBe(200);
  });

  it("processa o agendamento pelo webhook assinado e publica a consulta na agenda original", async () => {
    await app.close();
    app = await buildApp({
      database,
      config: { ...baseConfig, whatsapp },
      migrate: false,
      whatsappFetch: meta,
      // Use the same scheduler wired in production. Only Meta's HTTP is controlled here.
    });
    await database.query(
      `INSERT INTO whatsapp_booking_settings
          (clinic_id, actor_membership_id, enabled, working_days, opens_at, closes_at)
       SELECT clinic_id, id, true, ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[], '08:00', '18:00'
       FROM clinic_memberships WHERE clinic_id = $1 AND user_id = $2`,
      [clinicId, ownerId],
    );
    await database.query(
      `INSERT INTO whatsapp_booking_services
          (clinic_id, name, aliases, duration_minutes, professional_id, resource_id)
       SELECT p.clinic_id, 'Avaliação odontológica', ARRAY['avaliação'], 30, p.id, r.id
       FROM professionals p JOIN clinic_resources r ON r.clinic_id = p.clinic_id AND r.name = 'Sala 01'
       WHERE p.clinic_id = $1`,
      [clinicId],
    );

    const patientMessage = (id: string, text: string) =>
      packet({ messages: [inbound(text, timestamp(), id)] });
    const sendPatientMessage = async (id: string, text: string) => {
      const response = await signed(patientMessage(id, text));
      expect(response.statusCode, response.body).toBe(200);
      return JSON.parse(String(meta.mock.lastCall?.[1]?.body)).text.body as string;
    };
    const appointments = () =>
      database.query(
        `SELECT patient_id, source, status, procedure_name FROM appointments WHERE clinic_id = $1`,
        [clinicId],
      );

    expect(await sendPatientMessage("wamid.BOOK.1", "Quero agendar avaliação amanhã")).toMatch(
      /informe o horário/,
    );
    const offer = await sendPatientMessage("wamid.BOOK.2", "14:00");
    const code = offer.match(/CONFIRMAR ([A-F0-9]{8})/)?.[1];
    expect(code, offer).toBeDefined();
    expect((await appointments()).rows).toEqual([]);
    expect(await sendPatientMessage("wamid.BOOK.3", "sim")).toMatch(/copie a instrução/);
    expect((await appointments()).rows).toEqual([]);
    expect(await sendPatientMessage("wamid.BOOK.4", `CONFIRMAR ${code}`)).toContain(
      "Agendamento confirmado",
    );
    expect((await appointments()).rows).toEqual([
      {
        patient_id: patientId,
        source: "whatsapp",
        status: "confirmed",
        procedure_name: "Avaliação odontológica",
      },
    ]);

    const originalCount = meta.mock.calls.length;
    const duplicate = await signed(patientMessage("wamid.BOOK.4", `CONFIRMAR ${code}`));
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(meta.mock.calls).toHaveLength(originalCount);
    expect(
      await sendPatientMessage("wamid.BOOK.5", "Quero agendar avaliação amanhã às 14:00"),
    ).toMatch(/não está disponível/);
    expect((await appointments()).rowCount).toBe(1);

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers });
    expect(bootstrap.statusCode, bootstrap.body).toBe(200);
    expect(bootstrap.json().data.appointments).toContainEqual(
      expect.objectContaining({ patientId, source: "whatsapp", time: "14:00" }),
    );
  });
});
