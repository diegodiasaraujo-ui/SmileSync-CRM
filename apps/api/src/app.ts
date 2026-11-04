import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { loadAuthContext } from "./auth-context.js";
import { loadConfig, type AppConfig } from "./config.js";
import { createDatabase, migrateDatabase, type Database } from "./database.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBootstrapRoutes } from "./routes/bootstrap.js";
import { registerCommandRoutes } from "./routes/commands.js";

declare module "fastify" {
  interface FastifyInstance {
    database: Database;
    appConfig: AppConfig;
  }
}

export type BuildAppOptions = {
  config?: AppConfig;
  database?: Database;
  migrate?: boolean;
  logger?: boolean;
};

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const ownsDatabase = !options.database;
  const database = options.database ?? createDatabase(config.databaseUrl);
  if (options.migrate ?? config.migrateOnStart) await migrateDatabase(database);

  const app = Fastify({
    logger: options.logger ?? config.nodeEnv !== "test",
    trustProxy: config.nodeEnv === "production",
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id",
  });
  app.decorate("database", database);
  app.decorate("appConfig", config);
  app.decorateRequest("auth", null);

  await app.register(cookie);
  await app.register(cors, {
    origin: config.appOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    global: true,
    max: 180,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", async (request) => {
    await loadAuthContext(request, database, config);
  });
  app.addHook("onRequest", async (request, reply) => {
    if (!unsafeMethods.has(request.method)) return;
    if (!request.cookies[config.cookieName]) return;
    if (request.headers.origin === config.appOrigin) return;
    return reply.code(403).send({
      error: "invalid_origin",
      message: "Origem da solicitação não autorizada.",
    });
  });

  app.get("/api/health", async () => {
    await database.query("SELECT 1 AS healthy");
    return { status: "ok" };
  });
  await registerAuthRoutes(app, { database, config });
  await registerBootstrapRoutes(app, { database });
  await registerCommandRoutes(app, { database });

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: "not_found", message: "Rota não encontrada." }),
  );
  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ error }, "request failed");
    const failure =
      error instanceof Error ? error : new Error("Falha desconhecida na solicitação.");
    const details = failure as Error & { statusCode?: number; code?: unknown };
    const status = details.statusCode && details.statusCode < 500 ? details.statusCode : 500;
    const publicCode =
      typeof details.code === "string" && /^[a-z][a-z0-9_]*$/.test(details.code)
        ? details.code
        : undefined;
    return reply.code(status).send({
      error:
        status === 429
          ? "rate_limit_exceeded"
          : status < 500
            ? (publicCode ?? "request_failed")
            : "internal_error",
      message:
        status === 429
          ? "Muitas tentativas. Aguarde antes de tentar novamente."
          : status < 500
            ? failure.message
            : "Não foi possível concluir a solicitação.",
    });
  });
  if (ownsDatabase) app.addHook("onClose", async () => database.close());
  return app;
}
