import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { AppConfig } from "../config.js";
import { createDatabase, type Database } from "../database.js";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  appOrigin: "http://127.0.0.1:4173",
  databaseUrl: "pglite://memory",
  migrateOnStart: true,
  sessionTtlDays: 7,
  passwordResetTtlMinutes: 30,
  cookieName: "smilesync_session",
  exposeTestResetTokens: true,
};

function cookieFrom(headers: Record<string, unknown>) {
  const header = headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : String(header);
  return value.split(";", 1)[0]!;
}

describe("autenticação", () => {
  let database: Database;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    database = createDatabase("pglite://memory");
    app = await buildApp({ config, database, migrate: true, logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await database.close();
  });

  async function register(email = "admin@clinica.test") {
    return app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: "Ana Administradora",
        email,
        password: "SenhaSegura123",
        clinicName: "Clínica Teste",
        clinicCity: "Patos de Minas",
      },
    });
  }

  it("cria clínica, administrador e uma sessão opaca em cookie", async () => {
    const response = await register();
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      session: {
        name: "Ana Administradora",
        email: "admin@clinica.test",
        clinic: "Clínica Teste",
        timezone: "America/Sao_Paulo",
        role: "Administrador",
        roleCode: "administrador",
      },
    });
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");

    const sessions = await database.query<{ token_hash: string }>(
      "SELECT token_hash FROM user_sessions",
    );
    expect(sessions.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(setCookie).not.toContain(sessions.rows[0]!.token_hash);
  });

  it("recupera a sessão e rejeita cookie adulterado", async () => {
    const registered = await register();
    const cookie = cookieFrom(registered.headers);
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().session.email).toBe("admin@clinica.test");

    const tampered = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: `${config.cookieName}=token-adulterado-com-tamanho-suficiente-123456789` },
    });
    expect(tampered.statusCode).toBe(401);
  });

  it("valida credenciais e não revela qual campo está incorreto", async () => {
    await register();
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@clinica.test", password: "senha-errada" },
    });
    const unknownAccount = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ninguem@clinica.test", password: "senha-errada" },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownAccount.json());

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@clinica.test", password: "SenhaSegura123" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toBeTruthy();
  });

  it("protege mutações autenticadas contra origem cruzada e encerra a sessão", async () => {
    const registered = await register();
    const cookie = cookieFrom(registered.headers);

    const blocked = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, origin: "https://site-malicioso.example" },
    });
    expect(blocked.statusCode).toBe(403);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, origin: config.appOrigin },
    });
    expect(logout.statusCode).toBe(204);

    const expired = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });
    expect(expired.statusCode).toBe(401);
  });

  it("invalida imediatamente a sessão de uma associação desativada", async () => {
    const registered = await register();
    const cookie = cookieFrom(registered.headers);
    await database.query("UPDATE clinic_memberships SET status = 'disabled', disabled_at = now()");
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(401);
  });

  it("troca a senha com token de uso único e revoga todas as sessões", async () => {
    const registered = await register();
    const oldCookie = cookieFrom(registered.headers);
    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { email: "admin@clinica.test" },
    });
    expect(requested.statusCode).toBe(200);
    expect(requested.json().delivery).toBe("not_configured");
    const token = requested.json().testToken as string;
    expect(token).toBeTruthy();

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload: { token, password: "SenhaNovaSegura456" },
    });
    expect(changed.statusCode).toBe(200);

    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload: { token, password: "OutraSenha789" },
    });
    expect(replay.statusCode).toBe(400);

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: oldCookie },
    });
    expect(oldSession.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@clinica.test", password: "SenhaNovaSegura456" },
    });
    expect(login.statusCode).toBe(200);
  });
});
