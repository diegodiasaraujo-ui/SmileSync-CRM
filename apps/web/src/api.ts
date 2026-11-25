import type { DemoData, Role } from "./data";

export type Session = {
  userId: string;
  clinicId: string;
  name: string;
  email: string;
  clinic: string;
  role: Role;
  permissions: string[];
};

export type WhatsAppConversation = {
  id: string;
  patientId: string | null;
  patientName: string | null;
  phone: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  awaitingReply: boolean;
  canSendText: boolean;
  sendBlock: "channel_disabled" | "contact_opted_out" | "window_closed" | null;
};

export type WhatsAppMessage = {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
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
  occurredAt: string;
};

export type WhatsAppTemplate = { id: string; name: string; languageCode: string };
export type WhatsAppConnectionStatus =
  | "connected"
  | "disconnected"
  | "connecting"
  | "unknown"
  | "not_configured";
export type WhatsAppInbox = {
  configured: boolean;
  provider?: "meta" | "zapi_omni";
  connectionStatus?: WhatsAppConnectionStatus;
  canStart?: boolean;
  conversations: WhatsAppConversation[];
};
export type WhatsAppThread = {
  conversation: WhatsAppConversation;
  messages: WhatsAppMessage[];
  templates: WhatsAppTemplate[];
  nextCursor: string | null;
  templatesUnavailable: boolean;
};

export type WhatsAppSend =
  | { text: string; templateId?: never; idempotencyKey: string }
  | { text?: never; templateId: string; idempotencyKey: string };

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { message?: string; code?: string }
    | T
    | null;

  if (!response.ok) {
    const error = payload as { message?: string; code?: string } | null;
    throw new ApiError(
      error?.message || "Não foi possível concluir a solicitação.",
      response.status,
      error?.code,
    );
  }

  return payload as T;
}

export const api = {
  session: () => request<{ session: Session }>("/api/auth/session"),
  login: (email: string, password: string) =>
    request<{ session: Session }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (name: string, email: string, password: string) =>
    request<{ session: Session }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),
  logout: () =>
    request<{ ok: true }>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  requestPasswordReset: (email: string) =>
    request<{ accepted: true; delivery: "queued" | "not_configured" }>(
      "/api/auth/password-reset/request",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
    ),
  bootstrap: (signal?: AbortSignal) =>
    request<{ data: DemoData }>("/api/bootstrap", signal ? { signal } : {}),
  whatsappInbox: (signal?: AbortSignal, patientId?: string) =>
    request<WhatsAppInbox>(
      patientId
        ? `/api/whatsapp/conversations?${new URLSearchParams({ patientId })}`
        : "/api/whatsapp/conversations",
      { ...(signal ? { signal } : {}) },
    ),
  whatsappThread: (id: string, signal?: AbortSignal, before?: string) =>
    request<WhatsAppThread>(
      `/api/whatsapp/conversations/${encodeURIComponent(id)}${before ? `?${new URLSearchParams({ before })}` : ""}`,
      signal ? { signal } : {},
    ),
  startWhatsAppConversation: (patientId: string) =>
    request<{ conversation: WhatsAppConversation }>("/api/whatsapp/conversations", {
      method: "POST",
      body: JSON.stringify({ patientId }),
    }),
  sendWhatsApp: (id: string, input: WhatsAppSend) =>
    request<{ message: WhatsAppMessage }>(
      `/api/whatsapp/conversations/${encodeURIComponent(id)}/messages`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  command: <T>(type: string, payload: Record<string, unknown>, idempotencyKey: string) =>
    request<{ data: DemoData; result: T }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({ type, payload, idempotencyKey }),
    }),
};
