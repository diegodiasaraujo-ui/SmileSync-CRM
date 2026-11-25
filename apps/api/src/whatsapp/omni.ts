import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { OmniConfig } from "../config.js";
import type { IncomingMessage } from "./meta.js";

const maxBodySize = 3_145_728;
const twentyFourHours = 86_400_000;
const providerId = z.string().regex(/^[a-z0-9-]{1,128}$/i);

export function brazilPhone(value: string) {
  const input = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(input)) return null;
  let digits = input.replace(/\D/g, "");
  if (!input.startsWith("+") && (digits.length === 10 || digits.length === 11))
    digits = `55${digits}`;
  return /^55[1-9][1-9](?:[2-9]\d{7}|9\d{8})$/.test(digits) ? `+${digits}` : null;
}

export function sameBrazilPhone(left: string, right: string) {
  if (left === right) return true;
  const legacy = (number: string) =>
    /^\+55\d{2}9[6-9]\d{7}$/.test(number) ? `${number.slice(0, 5)}${number.slice(6)}` : number;
  return legacy(left) === legacy(right);
}

export const omniChannelKey = (config: OmniConfig) => `omni:${config.channelId}`;
const omniMessageKey = (config: OmniConfig, id: string) =>
  `${omniChannelKey(config)}:${id.toLowerCase()}`;

export function verifyOmniWebhook(input: {
  raw: Buffer;
  signature: unknown;
  idempotencyKey: unknown;
  contentEncoding: unknown;
  secret: string;
  now?: Date;
}) {
  if (typeof input.signature !== "string" || typeof input.idempotencyKey !== "string") return null;
  const signature = /^t=(\d{1,12}),\s*v1=([a-f\d]{64})$/i.exec(input.signature);
  const event = /^([a-z\d_.:-]{1,150}):(\d{1,12}):(\d{1,24})$/i.exec(input.idempotencyKey);
  if (!signature || !event) return null;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - Number(signature[1])) > 300) return null;

  let body: Buffer;
  try {
    if (input.contentEncoding === "gzip")
      body = gunzipSync(input.raw, { maxOutputLength: maxBodySize });
    else if (!input.contentEncoding || input.contentEncoding === "identity") body = input.raw;
    else return null;
  } catch {
    return null;
  }
  if (body.length > maxBodySize) return null;
  const prefix = `${signature[1]}\n${event[1]}\n${event[2]}\n${event[3]}\n`;
  const expected = createHmac("sha256", input.secret).update(prefix).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature[2]!, "hex")) ? body : null;
}

const party = z.object({ identifier: z.string().max(256) }).optional();
const item = z.object({
  type: z.string().max(100).optional(),
  message: z.string().optional(),
  caption: z.string().optional(),
  moment: z.number().finite().optional(),
  state: z.object({ name: z.string().max(100) }).optional(),
  internal_information: z.object({ group_id: z.unknown().optional() }).optional(),
});
const envelope = z.object({
  message: z.object({
    _id: providerId,
    channel_id: providerId,
    created: z.number().finite().optional(),
    metadata: z
      .object({ from_me: z.boolean().optional(), moment: z.number().finite().optional() })
      .optional(),
    sender: party,
    recipient: party,
    contents: z.array(z.unknown()).default([]),
    attachments: z.array(z.unknown()).default([]),
  }),
});

export type OmniStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type OmniEvent =
  | { message: IncomingMessage }
  | {
      providerId: string;
      status: OmniStatus;
      occurredAt: Date;
    };

function statusFromCallback(
  type: string | undefined,
  state: string | undefined,
): OmniStatus | null {
  if (type === "ErrorCallback") return "failed";
  if (type !== "MessageStatusCallback" && type !== "DeliveryCallback") return null;
  switch (state?.toUpperCase()) {
    case "PENDING":
      return "pending";
    case "SENT":
      return "sent";
    case "RECEIVED":
    case "DELIVERED":
      return "delivered";
    case "READ":
    case "PLAYED":
      return "read";
    case "ERROR":
    case "FAILED":
      return "failed";
    default:
      return null;
  }
}

export function decodeOmniEvents(payload: unknown, config: OmniConfig, now: Date) {
  const events: OmniEvent[] = [];
  const milliseconds = now.getTime();
  const eventDate = (moment: number | undefined) =>
    new Date(moment !== undefined && moment >= 0 ? Math.min(milliseconds, moment) : milliseconds);
  for (const value of Array.isArray(payload) ? payload : [payload]) {
    const parsed = envelope.safeParse(value);
    if (!parsed.success) continue;
    const message = parsed.data.message;
    if (message.channel_id.toUpperCase() !== config.channelId) continue;
    const items = [...message.contents, ...message.attachments].flatMap((content) => {
      const parsedItem = item.safeParse(content);
      return parsedItem.success ? [parsedItem.data] : [];
    });
    if (items.some((item) => item.internal_information?.group_id)) continue;
    const id = omniMessageKey(config, message._id);
    const statusEvent = items.find((item) => statusFromCallback(item.type, item.state?.name));
    const status = statusFromCallback(statusEvent?.type, statusEvent?.state?.name);
    if (status) {
      if (message.metadata?.from_me === false) continue;
      events.push({
        providerId: id,
        status,
        occurredAt: eventDate(statusEvent?.moment ?? message.metadata?.moment ?? message.created),
      });
      continue;
    }
    if (message.metadata?.from_me !== false || !message.sender) continue;
    const phone = brazilPhone(message.sender.identifier);
    if (!phone) continue;
    // Some status and connection events share the same envelope. Only message
    // contents (with a documented delivery type) may create an inbox row.
    const content =
      items.find((item) => item.type === "TEXT") ??
      items.find((item) =>
        /^(IMAGE|AUDIO|VIDEO|DOCUMENT|STICKER|LOCATION|CONTACT_ARRAY)$/.test(item.type ?? ""),
      );
    if (!content) continue;
    const text =
      (content.message ?? content.caption)?.replaceAll("\u0000", "").slice(0, 8192) || null;
    events.push({
      message: {
        providerId: id,
        phone,
        occurredAt: eventDate(message.created ?? message.metadata.moment),
        kind: content.type === "CONTACT_ARRAY" ? "contacts" : content.type!.toLowerCase(),
        text,
      },
    });
  }
  return events;
}

export class OmniRequestError extends Error {
  constructor(
    readonly code: string,
    readonly definite: boolean,
  ) {
    super("A Omni não confirmou esta operação.");
  }
}

const channelResponse = z.object({
  id: providerId,
  type: z.string(),
  whatsappConnected: z.boolean().optional(),
  phoneNumberConnected: z.string().nullable().optional(),
});
const sendResponse = z.object({ messageId: providerId });
const errorResponse = z.object({ subCode: z.string().optional() });

export type OmniConnection = Awaited<ReturnType<ReturnType<typeof createOmniClient>["connection"]>>;

export function createOmniClient(config: OmniConfig, fetcher: typeof fetch = fetch) {
  const path = `${config.baseUrl}/v1/channels/${encodeURIComponent(config.channelId)}`;

  async function request(suffix: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetcher(`${path}${suffix}`, {
        ...init,
        headers: { Authorization: `Bearer ${config.secretKey}`, ...init?.headers },
        redirect: "error",
        signal: AbortSignal.timeout(init?.method === "POST" ? 8000 : 3000),
      });
    } catch {
      throw new OmniRequestError("omni_unavailable", false);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = errorResponse.safeParse(payload);
      const code =
        error.data?.subCode === "CHANNEL_DISCONNECTED"
          ? "omni_channel_disconnected"
          : response.status === 401 || response.status === 403
            ? "omni_unauthorized"
            : `omni_http_${response.status}`;
      throw new OmniRequestError(
        code,
        response.status >= 400 && response.status < 500 && response.status !== 408,
      );
    }
    return payload;
  }

  type Connection = { status: "connected" | "disconnected" | "unknown"; phone: string | null };
  let cached: { expiresAt: number; result: Promise<Connection> } | undefined;
  const connection = () => {
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const result = request("")
      .then((payload): Connection => {
        const parsed = channelResponse.safeParse(payload);
        if (
          !parsed.success ||
          parsed.data.id.toUpperCase() !== config.channelId ||
          parsed.data.type !== "Z_API_WHATSAPP"
        )
          return { status: "unknown", phone: null };
        const phone = brazilPhone(parsed.data.phoneNumberConnected ?? "");
        if (parsed.data.whatsappConnected === false) return { status: "disconnected", phone };
        return { status: parsed.data.whatsappConnected === true ? "connected" : "unknown", phone };
      })
      .catch((): Connection => ({ status: "unknown", phone: null }));
    cached = { expiresAt: Date.now() + 12_000, result };
    return result;
  };

  return {
    connection,
    async sendText(phone: string, text: string) {
      const normalized = brazilPhone(phone);
      if (!normalized) throw new OmniRequestError("invalid_brazil_phone", true);
      try {
        const payload = await request("/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { identifier: normalized.slice(1) },
            content: {
              type: "TEXT",
              body: { message: text },
            },
          }),
        });
        const parsed = sendResponse.safeParse(payload);
        if (!parsed.success) throw new OmniRequestError("omni_invalid_response", false);
        return omniMessageKey(config, parsed.data.messageId);
      } catch (error) {
        if (error instanceof OmniRequestError && error.code === "omni_channel_disconnected")
          cached = undefined;
        throw error;
      }
    },
  };
}
