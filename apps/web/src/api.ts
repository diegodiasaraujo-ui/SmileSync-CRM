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
  bootstrap: () => request<{ data: DemoData }>("/api/bootstrap"),
  command: <T>(type: string, payload: Record<string, unknown>, idempotencyKey: string) =>
    request<{ data: DemoData; result: T }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({ type, payload, idempotencyKey }),
    }),
};
