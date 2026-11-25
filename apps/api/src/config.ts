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
    WHATSAPP_PROVIDER: z.enum(["meta", "zapi_omni", "disabled"]).optional(),
    OMNI_API_BASE_URL: z.string().optional(),
    OMNI_CHANNEL_ID: z.string().optional(),
    OMNI_SECRET_KEY: z.string().optional(),
    OMNI_WEBHOOK_SECRET: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
    WHATSAPP_APP_SECRET: z.string().min(1).optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().min(16).max(256).optional(),
    WHATSAPP_PHONE_NUMBER_ID: z
      .string()
      .regex(/^\d{5,32}$/)
      .optional(),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z
      .string()
      .regex(/^\d{5,32}$/)
      .optional(),
    WHATSAPP_CLINIC_ID: z.string().optional(),
    WHATSAPP_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d{1,3}\.0$/)
      .optional(),
    WHATSAPP_SCHEDULING_ENABLED: booleanFromEnvironment.optional(),
  })
  .superRefine((value, context) => {
    const whatsappKeys = [
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "WHATSAPP_CLINIC_ID",
      "WHATSAPP_GRAPH_API_VERSION",
    ] as const;
    if (
      value.WHATSAPP_PROVIDER === "meta" ||
      (value.WHATSAPP_PROVIDER === undefined &&
        (whatsappKeys.some((key) => key !== "WHATSAPP_CLINIC_ID" && value[key]) ||
          value.WHATSAPP_SCHEDULING_ENABLED))
    ) {
      for (const key of whatsappKeys) {
        if (
          !value[key] ||
          (key === "WHATSAPP_CLINIC_ID" && !z.uuid().safeParse(value[key]).success)
        )
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Variável necessária para ativar a integração com WhatsApp.",
          });
      }
    }
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

export type WhatsAppConfig = {
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  clinicId: string;
  graphApiVersion: string;
  schedulingEnabled: boolean;
};

export type OmniConfig = {
  clinicId: string;
  channelId: string;
  baseUrl: string;
  secretKey: string;
  webhookSecret?: string;
};

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
  whatsapp?: WhatsAppConfig;
  whatsappProvider?: "meta" | "zapi_omni";
  omni?: OmniConfig;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const test = parsed.NODE_ENV === "test";
  const isOmni = parsed.WHATSAPP_PROVIDER === "zapi_omni";
  const isMeta =
    parsed.WHATSAPP_PROVIDER === "meta" ||
    (parsed.WHATSAPP_PROVIDER === undefined && Boolean(parsed.WHATSAPP_ACCESS_TOKEN));
  const omniBase = (parsed.OMNI_API_BASE_URL?.trim() || "https://api.omni.z-api.io").replace(
    /\/+$/,
    "",
  );
  const webhookSecret = parsed.OMNI_WEBHOOK_SECRET?.trim();
  const omni =
    isOmni &&
    omniBase === "https://api.omni.z-api.io" &&
    /^[0-9a-f]{32}$/i.test(parsed.OMNI_CHANNEL_ID?.trim() ?? "") &&
    parsed.OMNI_SECRET_KEY?.trim() &&
    z.uuid().safeParse(parsed.WHATSAPP_CLINIC_ID?.trim()).success
      ? {
          clinicId: parsed.WHATSAPP_CLINIC_ID!.trim().toLowerCase(),
          channelId: parsed.OMNI_CHANNEL_ID!.trim().toUpperCase(),
          baseUrl: omniBase,
          secretKey: parsed.OMNI_SECRET_KEY.trim(),
          ...(/^[0-9a-f]{64}$/i.test(webhookSecret ?? "") ? { webhookSecret: webhookSecret! } : {}),
        }
      : undefined;
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
    ...(isOmni ? { whatsappProvider: "zapi_omni" as const, ...(omni ? { omni } : {}) } : {}),
    ...(isMeta && parsed.WHATSAPP_ACCESS_TOKEN
      ? {
          whatsappProvider: "meta" as const,
          whatsapp: {
            accessToken: parsed.WHATSAPP_ACCESS_TOKEN,
            appSecret: parsed.WHATSAPP_APP_SECRET!,
            verifyToken: parsed.WHATSAPP_VERIFY_TOKEN!,
            phoneNumberId: parsed.WHATSAPP_PHONE_NUMBER_ID!,
            businessAccountId: parsed.WHATSAPP_BUSINESS_ACCOUNT_ID!,
            clinicId: parsed.WHATSAPP_CLINIC_ID!.toLowerCase(),
            graphApiVersion: parsed.WHATSAPP_GRAPH_API_VERSION!,
            schedulingEnabled: parsed.WHATSAPP_SCHEDULING_ENABLED ?? false,
          },
        }
      : {}),
  };
}
