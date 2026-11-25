import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { WhatsAppConfig } from "../config.js";

const providerMessageId = z.string().min(1).max(512);
const phoneDigits = z.string().regex(/^\+?[1-9]\d{7,14}$/);
const timestamp = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform((value) => Number(value) * 1000);
const inboundMessage = z.object({
  id: providerMessageId,
  from: phoneDigits,
  timestamp,
  type: z.string().regex(/^[a-z_]{1,64}$/),
  text: z.object({ body: z.string().max(8192) }).optional(),
  button: z.object({ text: z.string().max(512) }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string().max(512) }).optional(),
      list_reply: z.object({ title: z.string().max(512) }).optional(),
    })
    .optional(),
  image: z.object({ caption: z.string().max(8192).optional() }).optional(),
  video: z.object({ caption: z.string().max(8192).optional() }).optional(),
  document: z.object({ caption: z.string().max(8192).optional() }).optional(),
});
const providerStatus = z.object({
  id: providerMessageId,
  recipient_id: phoneDigits,
  timestamp,
  status: z.enum(["sent", "delivered", "read", "failed"]),
  biz_opaque_callback_data: z.string().optional(),
  errors: z.array(z.object({ code: z.number().int().optional() })).optional(),
});
const webhook = z.object({
  object: z.string(),
  entry: z.array(z.unknown()).default([]),
});
const webhookEntry = z.object({ id: z.string(), changes: z.array(z.unknown()) });
const webhookChange = z.object({
  field: z.literal("messages"),
  value: z.object({
    messaging_product: z.literal("whatsapp"),
    metadata: z.object({ phone_number_id: z.string() }),
    messages: z.array(z.unknown()).default([]),
    statuses: z.array(z.unknown()).default([]),
  }),
});

export type IncomingMessage = {
  providerId: string;
  phone: string;
  occurredAt: Date;
  kind: string;
  text: string | null;
};
export type IncomingStatus = {
  providerId: string;
  internalId: string | null;
  phone: string;
  occurredAt: Date;
  status: z.infer<typeof providerStatus>["status"];
  failureCode: string | null;
};

export function verifyWebhookSignature(body: Buffer, signature: unknown, appSecret: string) {
  if (typeof signature !== "string" || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", appSecret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

export function verifyChallengeToken(value: string, expected: string) {
  const hash = (input: string) => createHash("sha256").update(input).digest();
  return timingSafeEqual(hash(value), hash(expected));
}

export function decodeWebhook(payload: unknown, config: WhatsAppConfig, receivedAt: Date) {
  const body = webhook.safeParse(payload);
  if (!body.success) return null;
  const messages: IncomingMessage[] = [];
  const statuses: IncomingStatus[] = [];
  if (body.data.object !== "whatsapp_business_account") return { messages, statuses };
  const eventTime = (time: number) => new Date(Math.min(time, receivedAt.getTime()));
  const canonicalPhone = (phone: string) => `+${phone.replace(/^\+/, "")}`;

  for (const value of body.data.entry) {
    const entry = webhookEntry.safeParse(value);
    if (!entry.success || entry.data.id !== config.businessAccountId) continue;
    for (const value of entry.data.changes) {
      const change = webhookChange.safeParse(value);
      if (!change.success || change.data.value.metadata.phone_number_id !== config.phoneNumberId)
        continue;
      for (const entryMessage of change.data.value.messages) {
        const item = inboundMessage.safeParse(entryMessage);
        if (!item.success) continue;
        const message = item.data;
        const text =
          message.text?.body ??
          message.button?.text ??
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          message.image?.caption ??
          message.video?.caption ??
          message.document?.caption ??
          null;
        messages.push({
          providerId: message.id,
          phone: canonicalPhone(message.from),
          occurredAt: eventTime(message.timestamp),
          kind: message.type,
          text: text?.replaceAll("\u0000", "") || null,
        });
      }
      for (const entryStatus of change.data.value.statuses) {
        const item = providerStatus.safeParse(entryStatus);
        if (!item.success) continue;
        const status = item.data;
        const internalId = z.uuid().safeParse(status.biz_opaque_callback_data);
        statuses.push({
          providerId: status.id,
          internalId: internalId.success ? internalId.data : null,
          phone: canonicalPhone(status.recipient_id),
          occurredAt: eventTime(status.timestamp),
          status: status.status,
          failureCode: status.errors?.[0]?.code?.toString() ?? null,
        });
      }
    }
  }
  messages.sort((first, second) => first.occurredAt.getTime() - second.occurredAt.getTime());
  return { messages, statuses };
}

const templateSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string().min(1),
  status: z.literal("APPROVED"),
  category: z.literal("UTILITY"),
  language: z.string().min(1),
  components: z.array(
    z.object({
      type: z.enum(["HEADER", "BODY", "FOOTER"]),
      format: z.literal("TEXT").optional(),
      text: z
        .string()
        .min(1)
        .refine((value) => !value.includes("{{") && !value.includes("\u0000")),
    }),
  ),
});

type Template = { id: string; name: string; languageCode: string; text: string };
export type OutgoingMessage = { text: string } | { template: Template };

const sendResponseSchema = z.object({
  messages: z.array(z.object({ id: providerMessageId })).min(1),
});
const templateResponseSchema = z.object({
  data: z.array(z.unknown()),
  paging: z
    .object({
      next: z.string().optional(),
      cursors: z.object({ after: z.string().optional() }).optional(),
    })
    .optional(),
});
const graphErrorSchema = z.object({ error: z.object({ code: z.number().int() }) });

export class MetaRequestError extends Error {
  constructor(
    readonly code: string,
    readonly definite: boolean,
  ) {
    super("O serviço do WhatsApp não confirmou a operação.");
  }
}

export function createMetaClient(config: WhatsAppConfig, fetcher: typeof fetch = fetch) {
  const base = `https://graph.facebook.com/${config.graphApiVersion}`;

  async function graph(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetcher(`${base}/${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${config.accessToken}`, ...init?.headers },
        signal: AbortSignal.timeout(9_000),
        redirect: "error",
      });
    } catch {
      throw new MetaRequestError("provider_unreachable", false);
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = graphErrorSchema.safeParse(payload);
      const definite = parsed.success && response.status >= 400 && response.status < 500;
      throw new MetaRequestError(
        parsed.success ? `meta_${parsed.data.error.code}` : "provider_http_error",
        definite,
      );
    }
    return payload;
  }

  async function loadTemplates() {
    const templates: Template[] = [];
    const query = new URLSearchParams({
      fields: "id,name,status,category,language,components",
      limit: "100",
    });
    for (let page = 0; page < 10; page += 1) {
      const body = templateResponseSchema.safeParse(
        await graph(`${config.businessAccountId}/message_templates?${query}`),
      );
      if (!body.success) throw new MetaRequestError("unexpected_template_response", false);
      for (const item of body.data.data) {
        const template = templateSchema.safeParse(item);
        if (!template.success) continue;
        if (!template.data.components.some((component) => component.type === "BODY")) continue;
        templates.push({
          id: template.data.id,
          name: template.data.name,
          languageCode: template.data.language,
          text: template.data.components.map((component) => component.text).join("\n"),
        });
      }
      const after = body.data.paging?.cursors?.after;
      if (!body.data.paging?.next || !after || query.get("after") === after) break;
      query.set("after", after);
    }
    return templates;
  }

  let templateCache: { expiresAt: number; value: Promise<Template[]> } | undefined;
  return {
    async send(phone: string, id: string, message: OutgoingMessage) {
      const payload =
        "text" in message
          ? { type: "text", text: { body: message.text, preview_url: false } }
          : {
              type: "template",
              template: {
                name: message.template.name,
                language: { code: message.template.languageCode },
              },
            };
      const body = sendResponseSchema.safeParse(
        await graph(`${config.phoneNumberId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone.slice(1),
            biz_opaque_callback_data: id,
            ...payload,
          }),
        }),
      );
      if (!body.success) throw new MetaRequestError("unexpected_send_response", false);
      return body.data.messages[0]!.id;
    },
    templates() {
      if (!templateCache || templateCache.expiresAt <= Date.now()) {
        const value = loadTemplates().catch((error: unknown) => {
          // Cache failed lookups briefly to avoid retrying on each inbox poll.
          if (templateCache?.value === value) templateCache.expiresAt = Date.now() + 10_000;
          throw error;
        });
        templateCache = { expiresAt: Date.now() + 60_000, value };
      }
      return templateCache.value;
    },
  };
}
