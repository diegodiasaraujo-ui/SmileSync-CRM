import { z } from "zod";

const booleanFromEnvironment = z.enum(["true", "false"]).transform((value) => value === "true");

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    APP_ORIGIN: z.string().url().optional(),
    DATABASE_URL: z.string().min(1).optional(),
    MIGRATE_ON_START: booleanFromEnvironment.optional(),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
    COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default("smilesync_session"),
    EXPOSE_TEST_RESET_TOKENS: booleanFromEnvironment.optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") return;
    if (!value.APP_ORIGIN)
      context.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "APP_ORIGIN é obrigatório em produção.",
      });
    if (!value.DATABASE_URL?.startsWith("postgres"))
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "Produção exige uma conexão PostgreSQL explícita.",
      });
    if (value.EXPOSE_TEST_RESET_TOKENS)
      context.addIssue({
        code: "custom",
        path: ["EXPOSE_TEST_RESET_TOKENS"],
        message: "Tokens de teste não podem ser expostos em produção.",
      });
  });

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  appOrigin: string;
  databaseUrl: string;
  migrateOnStart: boolean;
  sessionTtlDays: number;
  passwordResetTtlMinutes: number;
  cookieName: string;
  exposeTestResetTokens: boolean;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const test = parsed.NODE_ENV === "test";
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    appOrigin: parsed.APP_ORIGIN ?? "http://127.0.0.1:4173",
    databaseUrl: parsed.DATABASE_URL ?? (test ? "pglite://memory" : "pglite://./.data/smilesync"),
    migrateOnStart: parsed.MIGRATE_ON_START ?? parsed.NODE_ENV !== "production",
    sessionTtlDays: parsed.SESSION_TTL_DAYS,
    passwordResetTtlMinutes: parsed.PASSWORD_RESET_TTL_MINUTES,
    cookieName: parsed.COOKIE_NAME,
    exposeTestResetTokens: test && (parsed.EXPOSE_TEST_RESET_TOKENS ?? false),
  };
}
