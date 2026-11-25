import { createHash, randomUUID } from "node:crypto";
import type { Database, DatabaseExecutor } from "../database.js";
import {
  brazilPhone,
  OmniRequestError,
  sameBrazilPhone,
  type createOmniClient,
  type OmniStatus,
} from "./omni.js";
import {
  MetaRequestError,
  type createMetaClient,
  type IncomingMessage,
  type IncomingStatus,
  type OutgoingMessage,
} from "./meta.js";

type SendInput = { text: string } | { templateId: string };
export type ChannelScope = { clinicId: string; phoneNumberId: string; provider?: "zapi_omni" };
type MessageRow = {
  id: string;
  clinic_id: string;
  conversation_id: string;
  request_hash: string | null;
  failure_code: string | null;
  direction: "inbound" | "outbound";
  kind: string;
  text_content: string | null;
  status:
    | "received"
    | "submitting"
    | "submitted"
    | "accepted"
    | "pending"
    | "sent"
    | "delivered"
    | "read"
    | "failed"
    | "unknown";
  occurred_at: Date;
};
type ConversationRow = {
  id: string;
  phone_e164: string;
  phone_number_id: string;
  patient_id: string | null;
  patient_name: string | null;
  last_inbound_at: Date | null;
  conversation_created_at: Date;
  opted_out_at: Date | null;
  latest_text_content: string | null;
  latest_kind: string | null;
  latest_at: Date | null;
  last_reply_at: Date | null;
};

const contactWindowMs = 24 * 60 * 60 * 1000;

export class WhatsAppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const messageLabels: Record<string, string> = {
  audio: "Áudio",
  image: "Imagem",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  reaction: "Reação",
};

function visibleText(text: string | null, kind: string) {
  if (kind === "text" || kind === "template") return text ?? "Mensagem";
  const label = Object.hasOwn(messageLabels, kind) ? messageLabels[kind]! : "Mensagem do WhatsApp";
  return text ? `${label} · ${text}` : label;
}

export function publicMessage(row: MessageRow) {
  const staleRequest =
    row.status === "submitting" && Date.now() - row.occurred_at.getTime() > 30_000;
  return {
    id: row.id,
    direction: row.direction,
    text: visibleText(row.text_content, row.kind),
    status: staleRequest ? "unknown" : row.status,
    ...(row.status === "failed" && row.failure_code ? { failureCode: row.failure_code } : {}),
    occurredAt: row.occurred_at.toISOString(),
  };
}

function windowOpen(lastInboundAt: Date | null) {
  return lastInboundAt !== null && Date.now() - lastInboundAt.getTime() < contactWindowMs;
}

export function publicConversation(row: ConversationRow, config: ChannelScope | undefined) {
  const sendBlock =
    !config || config.phoneNumberId !== row.phone_number_id
      ? "channel_disabled"
      : row.opted_out_at
        ? "contact_opted_out"
        : config.provider !== "zapi_omni" && !windowOpen(row.last_inbound_at)
          ? "window_closed"
          : null;
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    phone: row.phone_e164,
    lastMessage: row.latest_kind ? visibleText(row.latest_text_content, row.latest_kind) : null,
    lastMessageAt: (
      row.latest_at ??
      row.last_inbound_at ??
      row.conversation_created_at
    ).toISOString(),
    awaitingReply:
      row.last_inbound_at !== null &&
      (!row.last_reply_at || row.last_reply_at < row.last_inbound_at),
    canSendText: sendBlock === null,
    sendBlock,
  };
}

export async function listConversations(
  database: DatabaseExecutor,
  clinicId: string,
  filters: { id?: string; patientId?: string; before?: string },
) {
  const result = await database.query<ConversationRow>(
    `
    SELECT c.id, c.phone_e164, c.phone_number_id, c.last_inbound_at, c.opted_out_at,
           c.created_at AS conversation_created_at,
           p.id AS patient_id, p.full_name AS patient_name,
           latest.text_content AS latest_text_content, latest.kind AS latest_kind,
           latest.occurred_at AS latest_at, replied.occurred_at AS last_reply_at
    FROM whatsapp_conversations c
    LEFT JOIN patients p ON p.clinic_id = c.clinic_id AND p.id = c.patient_id
      AND p.active AND p.deleted_at IS NULL AND p.phone_e164 = c.phone_e164
    LEFT JOIN LATERAL (
      SELECT text_content, kind, occurred_at
      FROM whatsapp_messages
      WHERE clinic_id = c.clinic_id AND conversation_id = c.id
      ORDER BY occurred_at DESC, id DESC LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT occurred_at FROM whatsapp_messages
      WHERE clinic_id = c.clinic_id AND conversation_id = c.id AND direction = 'outbound'
        AND status IN ('submitted', 'sent', 'delivered', 'read')
      ORDER BY occurred_at DESC LIMIT 1
    ) replied ON true
    WHERE c.clinic_id = $1 AND ($2::uuid IS NULL OR c.id = $2)
      AND ($3::uuid IS NULL OR p.id = $3)
      AND ($4::uuid IS NULL OR (GREATEST(c.last_inbound_at, c.created_at, latest.occurred_at), c.id) < (
        SELECT GREATEST(cursor.last_inbound_at, cursor.created_at, (
          SELECT MAX(occurred_at) FROM whatsapp_messages
          WHERE clinic_id = cursor.clinic_id AND conversation_id = cursor.id
        )), cursor.id FROM whatsapp_conversations cursor
        WHERE cursor.clinic_id = $1 AND cursor.id = $4
      ))
    ORDER BY GREATEST(c.last_inbound_at, c.created_at, latest.occurred_at) DESC, c.id DESC LIMIT 101
  `,
    [clinicId, filters.id ?? null, filters.patientId ?? null, filters.before ?? null],
  );
  return result.rows;
}

export async function listMessages(
  database: Database,
  clinicId: string,
  conversationId: string,
  before: string | undefined,
) {
  const result = await database.query<MessageRow>(
    `
    SELECT id, clinic_id, conversation_id, direction, kind, text_content, status, failure_code, occurred_at
    FROM whatsapp_messages
    WHERE clinic_id = $1 AND conversation_id = $2
      AND ($3::uuid IS NULL OR (occurred_at, id) < (
        SELECT cursor.occurred_at, cursor.id FROM whatsapp_messages cursor
        WHERE cursor.clinic_id = $1 AND cursor.conversation_id = $2 AND cursor.id = $3
      ))
    ORDER BY occurred_at DESC, id DESC LIMIT 101
  `,
    [clinicId, conversationId, before ?? null],
  );
  return result.rows;
}

function asksToStop(text: string | null) {
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/[.!]+$/, "");
  return [
    "pare",
    "stop",
    "sair",
    "cancelar mensagens",
    "nao quero receber mensagens",
    "descadastrar",
  ].includes(normalized);
}

export async function receiveMessage(
  database: Database,
  config: ChannelScope,
  message: IncomingMessage,
) {
  return database.transaction((transaction) => recordInboundMessage(transaction, config, message));
}

export async function recordInboundMessage(
  transaction: DatabaseExecutor,
  config: ChannelScope,
  message: IncomingMessage,
) {
  const match = await transaction.query<{ id: string }>(
    `
      SELECT id FROM patients WHERE clinic_id = $1 AND phone_e164 = $2
        AND active AND deleted_at IS NULL LIMIT 2
    `,
    [config.clinicId, message.phone],
  );
  const patientId = match.rows.length === 1 ? match.rows[0]!.id : null;
  const optsOut = message.kind === "text" && asksToStop(message.text);
  const found = await transaction.query<{
    id: string;
    patient_id: string | null;
    opted_out_at: Date | null;
  }>(
    `
      INSERT INTO whatsapp_conversations (clinic_id, phone_number_id, phone_e164, patient_id, last_inbound_at, opted_out_at)
      SELECT id, $2, $3, $4, $5, $6 FROM clinics WHERE id = $1 AND status = 'active'
      ON CONFLICT (clinic_id, phone_number_id, phone_e164) DO UPDATE
        SET last_inbound_at = GREATEST(whatsapp_conversations.last_inbound_at, EXCLUDED.last_inbound_at),
            patient_id = EXCLUDED.patient_id,
            opted_out_at = GREATEST(whatsapp_conversations.opted_out_at, EXCLUDED.opted_out_at)
      RETURNING id, patient_id, opted_out_at
    `,
    [
      config.clinicId,
      config.phoneNumberId,
      message.phone,
      patientId,
      message.occurredAt,
      optsOut ? message.occurredAt : null,
    ],
  );
  const conversation = found.rows[0];
  if (!conversation)
    throw new WhatsAppError(503, "clinic_inactive", "A clínica da integração está indisponível.");
  const created = await transaction.query<{ id: string }>(
    `
      INSERT INTO whatsapp_messages
        (clinic_id, conversation_id, provider_message_id, direction, kind, text_content, status, occurred_at)
      VALUES ($1, $2, $3, 'inbound', $4, $5, 'received', $6)
      ON CONFLICT (clinic_id, provider_message_id) DO NOTHING
      RETURNING id
    `,
    [
      config.clinicId,
      conversation.id,
      message.providerId,
      message.kind,
      message.text,
      message.occurredAt,
    ],
  );
  const stored =
    created.rows[0] ??
    (
      await transaction.query<{ id: string }>(
        `
      SELECT id FROM whatsapp_messages
      WHERE clinic_id = $1 AND conversation_id = $2 AND provider_message_id = $3 AND direction = 'inbound'
    `,
        [config.clinicId, conversation.id, message.providerId],
      )
    ).rows[0];
  return stored ? { ...conversation, messageId: stored.id } : null;
}

export async function receiveStatus(
  database: Database,
  config: ChannelScope,
  event: IncomingStatus,
) {
  await database.query(
    `
    UPDATE whatsapp_messages m
    SET provider_message_id = $2, status = $6, provider_status_at = $7, failure_code = $8
    FROM whatsapp_conversations c
    WHERE m.clinic_id = $1 AND m.direction = 'outbound'
      AND (m.provider_message_id = $2 OR (m.provider_message_id IS NULL AND m.id = $3))
      AND c.clinic_id = m.clinic_id AND c.id = m.conversation_id
      AND c.phone_number_id = $4 AND c.phone_e164 = $5
      AND CASE
        WHEN $6 = 'sent' THEN m.status IN ('submitting', 'unknown', 'submitted')
        WHEN $6 = 'delivered' THEN m.status IN ('submitting', 'unknown', 'submitted', 'sent', 'failed')
        WHEN $6 = 'read' THEN m.status IN ('submitting', 'unknown', 'submitted', 'sent', 'delivered', 'failed')
        WHEN $6 = 'failed' THEN m.status IN ('submitting', 'unknown', 'submitted', 'sent')
          AND (m.provider_status_at IS NULL OR m.provider_status_at <= $7)
        ELSE false
      END
  `,
    [
      config.clinicId,
      event.providerId,
      event.internalId,
      config.phoneNumberId,
      event.phone,
      event.status,
      event.occurredAt,
      event.failureCode,
    ],
  );
}

export async function allowsTemplate(
  database: DatabaseExecutor,
  clinicId: string,
  row: ConversationRow,
) {
  if (!row.patient_id || row.opted_out_at) return false;
  const consent = await database.query<{ status: string }>(
    `
    SELECT status FROM patient_consents
    WHERE clinic_id = $1 AND patient_id = $2 AND channel = 'whatsapp' AND purpose = 'whatsapp_utility'
      AND recorded_at <= now()
    ORDER BY recorded_at DESC, created_at DESC, id DESC LIMIT 1
  `,
    [clinicId, row.patient_id],
  );
  return consent.rows[0]?.status === "granted";
}

function canUseConversation(row: ConversationRow | undefined, config: ChannelScope) {
  if (!row || row.phone_number_id !== config.phoneNumberId)
    throw new WhatsAppError(404, "conversation_not_found", "Conversa do WhatsApp não encontrada.");
  if (row.opted_out_at)
    throw new WhatsAppError(
      409,
      "contact_opted_out",
      "Este contato pediu para parar de receber mensagens.",
    );
  return row;
}

export async function sendMessage(
  database: Database,
  config: ChannelScope,
  transport: ReturnType<typeof createMetaClient> | ReturnType<typeof createOmniClient>,
  conversationId: string,
  input: SendInput,
  idempotencyKey: string,
  userId: string | null,
) {
  const actorKey = userId ? `user:${userId}:${idempotencyKey}` : `automation:${idempotencyKey}`;
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");

  async function findPrior(executor: DatabaseExecutor) {
    const prior = (
      await executor.query<MessageRow>(
        `
      SELECT * FROM whatsapp_messages WHERE clinic_id = $1 AND conversation_id = $2 AND idempotency_key = $3
    `,
        [config.clinicId, conversationId, actorKey],
      )
    ).rows[0];
    if (prior && prior.request_hash !== hash)
      throw new WhatsAppError(
        409,
        "idempotency_conflict",
        "Esta tentativa já está vinculada a outra mensagem.",
      );
    return prior;
  }

  const prior = await findPrior(database);
  if (prior) return prior;

  const row = canUseConversation(
    (await listConversations(database, config.clinicId, { id: conversationId }))[0],
    config,
  );
  const omni = "sendText" in transport ? transport : null;
  if (omni) await assertOmniRecipient(omni, row.phone_e164);
  let message: OutgoingMessage;
  if ("text" in input) {
    message = input;
  } else {
    if (!("templates" in transport))
      throw new WhatsAppError(
        400,
        "template_not_available",
        "O canal Omni deste CRM envia mensagens de texto.",
      );
    if (!(await allowsTemplate(database, config.clinicId, row)))
      throw new WhatsAppError(
        409,
        "template_consent_required",
        "Este contato precisa autorizar mensagens de serviço por WhatsApp.",
      );
    const template = (await transport.templates()).find(
      (candidate) => candidate.id === input.templateId,
    );
    if (!template)
      throw new WhatsAppError(
        400,
        "template_not_available",
        "Este modelo não está disponível para envio.",
      );
    message = { template };
  }

  const draft = await database.transaction(async (transaction) => {
    await transaction.query(
      "SELECT id FROM whatsapp_conversations WHERE clinic_id = $1 AND id = $2 FOR UPDATE",
      [config.clinicId, conversationId],
    );
    const prior = await findPrior(transaction);
    if (prior) return { row: prior, created: false as const };
    const row = canUseConversation(
      (await listConversations(transaction, config.clinicId, { id: conversationId }))[0],
      config,
    );
    if (!omni && "text" in message && !windowOpen(row.last_inbound_at))
      throw new WhatsAppError(
        409,
        "whatsapp_window_closed",
        "A janela de atendimento de 24 horas encerrou. Use um modelo aprovado quando houver autorização do contato.",
      );
    if ("template" in message && !(await allowsTemplate(transaction, config.clinicId, row)))
      throw new WhatsAppError(
        409,
        "template_consent_required",
        "Este contato precisa autorizar mensagens de serviço por WhatsApp.",
      );
    const result = await transaction.query<MessageRow>(
      `
      INSERT INTO whatsapp_messages
        (id, clinic_id, conversation_id, idempotency_key, request_hash, direction, kind, text_content, status, occurred_at, sent_by)
      VALUES ($1, $2, $3, $4, $5, 'outbound', $6, $7, 'submitting', now(), $8) RETURNING *
    `,
      [
        randomUUID(),
        config.clinicId,
        conversationId,
        actorKey,
        hash,
        "text" in message ? "text" : "template",
        "text" in message ? message.text : message.template.text,
        userId,
      ],
    );
    return { row: result.rows[0]!, created: true as const, phone: row.phone_e164 };
  });
  if (!draft.created) return draft.row;

  let providerId: string | null = null;
  let status = omni ? "accepted" : "submitted";
  let failureCode: string | null = null;
  try {
    if ("send" in transport) providerId = await transport.send(draft.phone, draft.row.id, message);
    else if ("text" in message) providerId = await transport.sendText(draft.phone, message.text);
  } catch (error) {
    const requestError = error instanceof MetaRequestError || error instanceof OmniRequestError;
    status = requestError && error.definite ? "failed" : "unknown";
    failureCode = requestError ? error.code : "unknown_provider_error";
  }
  // A callback can arrive before the HTTP response. Preserve its newer delivery status.
  const result = await database.query<MessageRow>(
    `
    UPDATE whatsapp_messages SET provider_message_id = COALESCE(provider_message_id, $3),
      status = CASE WHEN status = 'submitting' THEN $4 ELSE status END,
      failure_code = CASE WHEN status = 'submitting' THEN $5 ELSE failure_code END
    WHERE clinic_id = $1 AND id = $2 RETURNING *
  `,
    [config.clinicId, draft.row.id, providerId, status, failureCode],
  );
  if (omni && providerId) {
    const updated = await applyOmniStatus(database, config.clinicId, providerId);
    if (updated) return updated;
    // The callback may already have updated it immediately after the UPDATE.
    const latest = await findPrior(database);
    if (latest) return latest;
  }
  return result.rows[0]!;
}

export async function assertOmniRecipient(
  omni: ReturnType<typeof createOmniClient>,
  phone: string,
) {
  const normalized = brazilPhone(phone);
  if (!normalized)
    throw new WhatsAppError(
      400,
      "invalid_brazil_phone",
      "Informe um telefone brasileiro com DDD no cadastro do paciente.",
    );
  const connection = await omni.connection();
  if (connection.status === "disconnected")
    throw new WhatsAppError(
      409,
      "omni_channel_disconnected",
      "O canal Omni está desconectado. Reconecte o WhatsApp no painel Omni.",
    );
  if (connection.status !== "connected" || !connection.phone)
    throw new WhatsAppError(
      503,
      "omni_connection_unknown",
      "A Omni não confirmou a conexão e o número remetente. Confira a chave de API e o canal.",
    );
  if (sameBrazilPhone(normalized, connection.phone))
    throw new WhatsAppError(
      400,
      "omni_self_send",
      "Escolha um contato autorizado diferente do número conectado ao canal.",
    );
}

export async function startOmniConversation(
  database: Database,
  config: ChannelScope,
  omni: ReturnType<typeof createOmniClient>,
  patientId: string,
) {
  const patient = (
    await database.query<{ phone_e164: string | null }>(
      `SELECT p.phone_e164 FROM patients p JOIN clinics c ON c.id = p.clinic_id
      WHERE p.clinic_id = $1 AND p.id = $2 AND p.active AND p.deleted_at IS NULL AND c.status = 'active'`,
      [config.clinicId, patientId],
    )
  ).rows[0];
  if (!patient)
    throw new WhatsAppError(
      404,
      "patient_not_found",
      "Paciente ativo não encontrado nesta clínica.",
    );
  const phone = brazilPhone(patient.phone_e164 ?? "");
  if (!phone)
    throw new WhatsAppError(
      400,
      "invalid_brazil_phone",
      "Informe um telefone brasileiro com DDD no cadastro do paciente.",
    );
  await assertOmniRecipient(omni, phone);
  const result = await database.query<{ id: string }>(
    `INSERT INTO whatsapp_conversations (clinic_id, phone_number_id, phone_e164, patient_id)
     SELECT clinic_id, $2, $3, id FROM patients
     WHERE clinic_id = $1 AND id = $4 AND phone_e164 = $3 AND active AND deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM patients other
         WHERE other.clinic_id = $1 AND other.phone_e164 = $3 AND other.id <> $4
         AND other.active AND other.deleted_at IS NULL)
     ON CONFLICT (clinic_id, phone_number_id, phone_e164) DO UPDATE SET patient_id = EXCLUDED.patient_id
     RETURNING id`,
    [config.clinicId, config.phoneNumberId, phone, patientId],
  );
  const id = result.rows[0]?.id;
  if (!id)
    throw new WhatsAppError(
      409,
      "ambiguous_patient_phone",
      "O telefone mudou ou aparece em mais de um cadastro ativo.",
    );
  return (await listConversations(database, config.clinicId, { id }))[0]!;
}

export async function recordOmniStatus(
  database: DatabaseExecutor,
  clinicId: string,
  event: {
    providerId: string;
    status: OmniStatus;
    occurredAt: Date;
  },
) {
  await database.query(
    `INSERT INTO whatsapp_omni_status (clinic_id, provider_message_id, status, occurred_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (clinic_id, provider_message_id) DO UPDATE
     SET status = EXCLUDED.status, occurred_at = EXCLUDED.occurred_at
     WHERE EXCLUDED.occurred_at >= whatsapp_omni_status.occurred_at
     AND array_position(ARRAY['pending','sent','failed','delivered','read'], EXCLUDED.status)
         >= array_position(ARRAY['pending','sent','failed','delivered','read'], whatsapp_omni_status.status)`,
    [clinicId, event.providerId, event.status, event.occurredAt],
  );
}

export async function applyOmniStatus(
  database: DatabaseExecutor,
  clinicId: string,
  providerId: string,
) {
  const result = await database.query<MessageRow>(
    `UPDATE whatsapp_messages AS m SET status = s.status, provider_status_at = s.occurred_at,
       failure_code = CASE WHEN s.status = 'failed' THEN 'omni_delivery_failed' ELSE NULL END
     FROM whatsapp_omni_status AS s
     WHERE m.clinic_id = $1 AND m.provider_message_id = $2 AND m.direction = 'outbound'
       AND m.clinic_id = s.clinic_id AND m.provider_message_id = s.provider_message_id
       AND (m.provider_status_at IS NULL OR s.occurred_at >= m.provider_status_at)
       AND COALESCE(array_position(ARRAY['pending','sent','failed','delivered','read'], m.status), 0)
           <= array_position(ARRAY['pending','sent','failed','delivered','read'], s.status)
     RETURNING m.*`,
    [clinicId, providerId],
  );
  return result.rows[0];
}
