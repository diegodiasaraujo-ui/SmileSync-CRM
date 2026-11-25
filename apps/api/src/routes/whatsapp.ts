import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth-context.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../database.js";
import {
  allowsTemplate,
  applyOmniStatus,
  listConversations,
  listMessages,
  publicConversation,
  publicMessage,
  recordInboundMessage,
  recordOmniStatus,
  receiveMessage,
  receiveStatus,
  sendMessage,
  startOmniConversation,
  WhatsAppError,
} from "../whatsapp/conversations.js";
import {
  createMetaClient,
  decodeWebhook,
  MetaRequestError,
  verifyChallengeToken,
  verifyWebhookSignature,
} from "../whatsapp/meta.js";
import {
  createOmniClient,
  decodeOmniEvents,
  omniChannelKey,
  verifyOmniWebhook,
} from "../whatsapp/omni.js";

export const whatsappWebhookPath = "/api/whatsapp/webhook";
export const omniWebhookPath = "/api/whatsapp/omni/webhook";

export type SchedulingContext = {
  database: Database;
  clinicId: string;
  conversationId: string;
  patientId: string | null;
  from: string;
  messageId: string;
  text: string;
  occurredAt: Date;
  sendText: (text: string, idempotencyKey: string) => Promise<void>;
};
export type WhatsAppScheduler = (context: SchedulingContext) => Promise<void>;

const uuid = z.uuid();
const challengeQuery = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1).max(256),
  "hub.challenge": z.string().regex(/^\d{1,30}$/),
});
const inboxQuery = z.object({ patientId: uuid.optional(), before: uuid.optional() });
const threadQuery = z.object({ before: uuid.optional() });
const conversationParams = z.object({ id: uuid });
const startConversationBody = z.object({ patientId: uuid });
const sendBody = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes("\u0000"))
      .optional(),
    templateId: z
      .string()
      .regex(/^\d{1,32}$/)
      .optional(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/),
  })
  .refine((body) => Boolean(body.text) !== Boolean(body.templateId));

function errorResponse(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: code, code, message });
}

function requireInboxPermission(permission: "whatsapp.inbox.read" | "whatsapp.inbox.send") {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) return requireAuth(request, reply);
    if (request.auth.permissions.includes(permission)) return;
    return errorResponse(
      reply,
      403,
      "permission_denied",
      "Seu perfil não possui permissão para esta ação.",
    );
  };
}

export async function registerWhatsAppRoutes(
  app: FastifyInstance,
  options: {
    database: Database;
    config: AppConfig;
    fetcher?: typeof fetch;
    schedule?: WhatsAppScheduler;
  },
) {
  const { database, fetcher, schedule } = options;
  const config = options.config.whatsapp;
  const meta = config ? createMetaClient(config, fetcher) : undefined;
  const omniConfig = options.config.omni;
  const omni = omniConfig ? createOmniClient(omniConfig, fetcher) : undefined;
  const omniScope = omniConfig
    ? {
        clinicId: omniConfig.clinicId,
        phoneNumberId: omniChannelKey(omniConfig),
        provider: "zapi_omni" as const,
      }
    : undefined;
  const activeScope = (clinicId: string) =>
    omniScope?.clinicId === clinicId
      ? omniScope
      : config?.clinicId === clinicId
        ? config
        : undefined;

  // This scope receives the exact body bytes. Other API routes continue using
  // Fastify's normal JSON parser and session validation.
  await app.register(async (webhooks) => {
    webhooks.removeContentTypeParser("application/json");
    webhooks.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    webhooks.post(omniWebhookPath, { bodyLimit: 3_145_728 }, async (request, reply) => {
      if (!omniConfig?.webhookSecret || !omniScope) return reply.code(404).send();
      const key = request.headers["x-idempotency-key"];
      const raw = Buffer.isBuffer(request.body)
        ? verifyOmniWebhook({
            raw: request.body,
            signature: request.headers["x-webhook-signature"],
            idempotencyKey: key,
            contentEncoding: request.headers["content-encoding"],
            secret: omniConfig.webhookSecret,
          })
        : null;
      if (!raw || typeof key !== "string")
        return errorResponse(reply, 403, "invalid_signature", "Assinatura inválida.");

      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        return errorResponse(reply, 400, "invalid_webhook", "Formato inválido.");
      }
      const events = decodeOmniEvents(payload, omniConfig, new Date());
      if (!events.length) return reply.code(200).send({ ok: true });
      try {
        await database.transaction(async (transaction) => {
          // Use the signed delivery key, not unsigned metadata headers. Write
          // its receipt in the same transaction as the messages and statuses.
          const { rowCount } = await transaction.query(
            `INSERT INTO webhook_events (clinic_id, provider, external_event_id, event_type,
              signature_valid, processed_at)
             VALUES ($1,'zapi_omni',$2,'omni_event', true, now())
             ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id`,
            [omniScope.clinicId, `${omniScope.clinicId}:${omniScope.phoneNumberId}:${key}`],
          );
          if (!rowCount) return;
          for (const event of events) {
            if ("message" in event)
              await recordInboundMessage(transaction, omniScope, event.message);
            else await recordOmniStatus(transaction, omniScope.clinicId, event);
          }
        });
        // Reconcile after the receipt is durable. The sender also reconciles
        // after saving the provider ID, covering either order of arrival.
        for (const event of events) {
          if (!("message" in event))
            await applyOmniStatus(database, omniScope.clinicId, event.providerId);
        }
      } catch {
        request.log.warn("Omni webhook processing will be retried");
        return errorResponse(
          reply,
          503,
          "webhook_retry",
          "Não foi possível concluir o processamento.",
        );
      }
      return reply.code(200).send({ ok: true });
    });

    webhooks.get(whatsappWebhookPath, async (request, reply) => {
      if (!config) return reply.code(404).send();
      const query = challengeQuery.safeParse(request.query);
      if (
        !query.success ||
        !verifyChallengeToken(query.data["hub.verify_token"], config.verifyToken)
      )
        return reply.code(403).send();
      return reply
        .header("Cache-Control", "no-store")
        .type("text/plain")
        .send(query.data["hub.challenge"]);
    });

    webhooks.post(whatsappWebhookPath, { bodyLimit: 3_145_728 }, async (request, reply) => {
      if (!config || !meta) return reply.code(404).send();
      if (
        !Buffer.isBuffer(request.body) ||
        !verifyWebhookSignature(
          request.body,
          request.headers["x-hub-signature-256"],
          config.appSecret,
        )
      )
        return errorResponse(reply, 403, "invalid_signature", "Assinatura inválida.");

      let payload: unknown;
      try {
        payload = JSON.parse(request.body.toString("utf8"));
      } catch {
        return errorResponse(reply, 400, "invalid_webhook", "Formato inválido.");
      }
      const decoded = decodeWebhook(payload, config, new Date());
      if (!decoded) return errorResponse(reply, 400, "invalid_webhook", "Formato inválido.");

      try {
        for (const event of decoded.statuses) await receiveStatus(database, config, event);
        for (const message of decoded.messages) {
          const saved = await receiveMessage(database, config, message);
          if (
            !saved ||
            saved.opted_out_at ||
            !schedule ||
            !config.schedulingEnabled ||
            !message.text ||
            message.kind !== "text"
          )
            continue;
          await schedule({
            database,
            clinicId: config.clinicId,
            conversationId: saved.id,
            patientId: saved.patient_id,
            from: message.phone,
            messageId: saved.messageId,
            text: message.text,
            occurredAt: message.occurredAt,
            sendText: async (text, key) => {
              // A definitive rejection or an ambiguous attempt stays visible in
              // the inbox. Replaying the same provider event never resends it.
              try {
                await sendMessage(database, config, meta, saved.id, { text }, key, null);
              } catch (error) {
                if (error instanceof WhatsAppError && error.status < 500) return;
                throw error;
              }
            },
          });
        }
      } catch {
        request.log.warn("WhatsApp webhook processing will be retried");
        return errorResponse(
          reply,
          503,
          "webhook_retry",
          "Não foi possível concluir o processamento.",
        );
      }
      return reply.code(200).send({ ok: true });
    });
  });

  const authRead = { preHandler: requireInboxPermission("whatsapp.inbox.read") };
  const authSend = { preHandler: requireInboxPermission("whatsapp.inbox.send") };

  app.get("/api/whatsapp/conversations", authRead, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const query = inboxQuery.safeParse(request.query);
    if (!query.success) return errorResponse(reply, 400, "invalid_filter", "Filtro inválido.");
    const clinicId = request.auth!.clinicId;
    const scope = activeScope(clinicId);
    const [rows, connection] = await Promise.all([
      listConversations(database, clinicId, {
        ...(query.data.patientId ? { patientId: query.data.patientId } : {}),
        ...(query.data.before ? { before: query.data.before } : {}),
      }),
      omni && omniScope?.clinicId === clinicId ? omni.connection() : null,
    ]);
    return {
      configured: Boolean(scope),
      ...(options.config.whatsappProvider ? { provider: options.config.whatsappProvider } : {}),
      ...(options.config.whatsappProvider === "zapi_omni" || omni
        ? {
            connectionStatus: connection?.status ?? "not_configured",
            canStart: Boolean(
              connection?.status === "connected" &&
              connection.phone &&
              request.auth!.permissions.includes("whatsapp.inbox.send"),
            ),
          }
        : {}),
      conversations: rows.slice(0, 100).map((row) => publicConversation(row, scope)),
      nextCursor: rows.length > 100 ? rows[99]!.id : null,
    };
  });

  app.post("/api/whatsapp/conversations", authSend, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!request.auth!.permissions.includes("whatsapp.inbox.read"))
      return errorResponse(
        reply,
        403,
        "permission_denied",
        "Seu perfil precisa de acesso à caixa de entrada.",
      );
    const body = startConversationBody.safeParse(request.body);
    if (!body.success)
      return errorResponse(reply, 400, "invalid_patient", "Selecione um paciente.");
    if (!omni || omniScope?.clinicId !== request.auth!.clinicId)
      return errorResponse(
        reply,
        409,
        "omni_not_configured",
        "Configure um canal Omni para iniciar conversas pelo CRM.",
      );
    try {
      const row = await startOmniConversation(database, omniScope, omni, body.data.patientId);
      return { conversation: publicConversation(row, omniScope) };
    } catch (error) {
      if (error instanceof WhatsAppError)
        return errorResponse(reply, error.status, error.code, error.message);
      throw error;
    }
  });

  app.get("/api/whatsapp/conversations/:id", authRead, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const params = conversationParams.safeParse(request.params);
    const query = threadQuery.safeParse(request.query);
    if (!params.success || !query.success)
      return errorResponse(reply, 400, "invalid_filter", "Filtro inválido.");
    const { id } = params.data;
    const clinicId = request.auth!.clinicId;
    const activeConfig = config?.clinicId === clinicId ? config : undefined;
    const [rows, messages] = await Promise.all([
      listConversations(database, clinicId, { id }),
      listMessages(database, clinicId, id, query.data.before),
    ]);
    const row = rows[0];
    if (!row)
      return errorResponse(reply, 404, "conversation_not_found", "Conversa não encontrada.");

    let templates: { id: string; name: string; languageCode: string }[] = [];
    let templatesUnavailable = false;
    if (
      !query.data.before &&
      meta &&
      activeConfig?.phoneNumberId === row.phone_number_id &&
      request.auth!.permissions.includes("whatsapp.inbox.send") &&
      (await allowsTemplate(database, clinicId, row))
    ) {
      try {
        templates = (await meta.templates()).map(({ id, name, languageCode }) => ({
          id,
          name,
          languageCode,
        }));
      } catch {
        templatesUnavailable = true;
      }
    }
    return {
      conversation: publicConversation(row, activeScope(clinicId)),
      messages: messages.slice(0, 100).reverse().map(publicMessage),
      nextCursor: messages.length > 100 ? messages[99]!.id : null,
      templates,
      templatesUnavailable,
    };
  });

  app.post("/api/whatsapp/conversations/:id/messages", authSend, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const params = conversationParams.safeParse(request.params);
    const body = sendBody.safeParse(request.body);
    if (!params.success || !body.success)
      return errorResponse(
        reply,
        400,
        "invalid_message",
        "Informe um texto de até 4.096 caracteres ou selecione um modelo.",
      );
    const clinicId = request.auth!.clinicId;
    const scope = activeScope(clinicId);
    const transport = omniScope?.clinicId === clinicId ? omni : meta;
    if (!transport || !scope)
      return errorResponse(
        reply,
        503,
        "whatsapp_not_configured",
        "O WhatsApp ainda não está configurado nesta clínica.",
      );
    const { text, templateId, idempotencyKey } = body.data;
    try {
      const row = await sendMessage(
        database,
        scope,
        transport,
        params.data.id,
        text ? { text } : { templateId: templateId! },
        idempotencyKey,
        request.auth!.userId,
      );
      return { message: publicMessage(row) };
    } catch (error) {
      if (error instanceof WhatsAppError)
        return errorResponse(reply, error.status, error.code, error.message);
      if (error instanceof MetaRequestError)
        return errorResponse(
          reply,
          502,
          "templates_unavailable",
          "Não foi possível consultar os modelos do WhatsApp.",
        );
      request.log.warn("WhatsApp send result could not be stored");
      return errorResponse(
        reply,
        503,
        "whatsapp_send_pending",
        "Não foi possível verificar o envio. Confira o histórico antes de tentar novamente.",
      );
    }
  });
}
