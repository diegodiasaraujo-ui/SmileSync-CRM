import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { publicSession, requireAuth, type AuthContext } from "../auth-context.js";
import type { AppConfig } from "../config.js";
import type { Database, DatabaseExecutor } from "../database.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { createOpaqueToken, hashToken } from "../security/tokens.js";

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());
const passwordSchema = z
  .string()
  .min(10, "Use ao menos 10 caracteres.")
  .max(128)
  .refine((password) => /[A-Za-zÀ-ÿ]/.test(password) && /\d/.test(password), {
    message: "Use letras e números na senha.",
  });

const registerSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: emailSchema,
  password: passwordSchema,
  clinicName: z.string().trim().min(3).max(160).optional(),
  clinicCity: z.string().trim().max(120).optional(),
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const resetRequestSchema = z.object({ email: emailSchema });
const resetConfirmSchema = z.object({
  token: z.string().min(32).max(256),
  password: passwordSchema,
});

const dummyPasswordHash = hashPassword("invalid-account-password-constant");

const roles = [
  { code: "administrador", name: "Administrador" },
  { code: "dentista", name: "Dentista" },
  { code: "secretaria", name: "Secretária" },
  { code: "recepcao", name: "Recepção" },
  { code: "financeiro", name: "Financeiro" },
] as const;

const rolePermissions: Record<(typeof roles)[number]["code"], string[]> = {
  administrador: [
    "patients.read",
    "patients.create",
    "patients.update",
    "patients.deactivate",
    "appointments.read",
    "appointments.create",
    "appointments.update",
    "appointments.cancel",
    "treatments.read",
    "treatments.write",
    "treatments.clinical.read",
    "treatments.clinical.write",
    "quotes.read",
    "quotes.create",
    "quotes.update",
    "quotes.approve",
    "finance.summary.read",
    "finance.details.read",
    "finance.charges.write",
    "finance.payments.write",
    "finance.payments.void",
    "team.read",
    "team.invite",
    "team.update",
    "clinic.settings.read",
    "clinic.settings.update",
    "integrations.read",
    "integrations.update",
    "automations.read",
    "automations.update",
    "reports.operational.export",
    "reports.financial.export",
    "audit.read",
  ],
  dentista: [
    "patients.read",
    "patients.create",
    "patients.update",
    "appointments.read",
    "appointments.create",
    "appointments.update",
    "appointments.cancel",
    "treatments.read",
    "treatments.write",
    "treatments.clinical.read",
    "treatments.clinical.write",
    "reports.operational.export",
  ],
  secretaria: [
    "patients.read",
    "patients.create",
    "patients.update",
    "appointments.read",
    "appointments.create",
    "appointments.update",
    "appointments.cancel",
    "treatments.read",
    "reports.operational.export",
  ],
  recepcao: [
    "patients.read",
    "patients.create",
    "patients.update",
    "appointments.read",
    "appointments.create",
    "appointments.update",
    "appointments.cancel",
  ],
  financeiro: [
    "patients.read",
    "quotes.read",
    "quotes.create",
    "quotes.update",
    "quotes.approve",
    "finance.summary.read",
    "finance.details.read",
    "finance.charges.write",
    "finance.payments.write",
    "finance.payments.void",
    "reports.financial.export",
  ],
};

type UserLoginRow = {
  user_id: string;
  email: string;
  full_name: string;
  password_hash: string | null;
  membership_id: string;
  clinic_id: string;
  clinic_name: string;
  timezone: string;
  role_code: string;
  role_name: string;
  permissions: string[];
};

function cookieOptions(config: AppConfig) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.nodeEnv === "production",
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
  };
}

function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string) {
  reply.setCookie(config.cookieName, token, cookieOptions(config));
}

function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(config.cookieName, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
  });
}

function toContext(row: UserLoginRow, sessionId: string): AuthContext {
  return {
    sessionId,
    userId: row.user_id,
    membershipId: row.membership_id,
    clinicId: row.clinic_id,
    email: row.email,
    fullName: row.full_name,
    roleCode: row.role_code,
    roleName: row.role_name,
    clinicName: row.clinic_name,
    timezone: row.timezone,
    permissions: row.permissions,
  };
}

async function createSession(
  database: DatabaseExecutor,
  config: AppConfig,
  userId: string,
  clinicId: string,
  membershipId: string,
) {
  const id = randomUUID();
  const { token, hash } = createOpaqueToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  await database.query(
    `
      INSERT INTO user_sessions
        (id, user_id, clinic_id, membership_id, token_hash, idle_expires_at,
         expires_at, last_seen_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $6, now(), now())
    `,
    [id, userId, clinicId, membershipId, hash, expiresAt],
  );
  return { id, token };
}

async function audit(
  database: DatabaseExecutor,
  input: {
    clinicId: string | null;
    userId: string | null;
    membershipId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    changedFields?: string[];
    requestId?: string;
  },
) {
  await database.query(
    `
      INSERT INTO audit_logs
        (id, clinic_id, actor_user_id, actor_membership_id, action, entity_type,
         entity_id, changed_fields, request_id, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
    `,
    [
      randomUUID(),
      input.clinicId,
      input.userId,
      input.membershipId,
      input.action,
      input.entityType,
      input.entityId,
      input.changedFields ?? [],
      input.requestId ?? null,
    ],
  );
}

async function insertRolePermissions(
  transaction: DatabaseExecutor,
  clinicId: string,
  roleId: string,
  roleCode: (typeof roles)[number]["code"],
) {
  for (const permission of rolePermissions[roleCode]) {
    await transaction.query(
      `
        INSERT INTO role_permissions (clinic_id, role_id, permission_code)
        SELECT $1, $2, code FROM permissions WHERE code = $3
        ON CONFLICT DO NOTHING
      `,
      [clinicId, roleId, permission],
    );
  }
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: { database: Database; config: AppConfig },
) {
  const { database, config } = dependencies;

  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Revise os dados informados.",
        });
      const { name, email, password, clinicName, clinicCity } = parsed.data;
      const existing = await database.query("SELECT id FROM app_users WHERE email = $1 LIMIT 1", [
        email,
      ]);
      if (existing.rowCount)
        return reply.code(409).send({
          error: "email_in_use",
          message: "Já existe uma conta com este e-mail.",
        });
      const passwordHash = await hashPassword(password);
      try {
        const result = await database.transaction(async (transaction) => {
          const userId = randomUUID();
          const clinicId = randomUUID();
          const membershipId = randomUUID();
          await transaction.query(
            `
              INSERT INTO app_users
                (id, email, full_name, password_hash, status, created_at, updated_at)
              VALUES ($1, $2, $3, $4, 'active', now(), now())
            `,
            [userId, email, name, passwordHash],
          );
          await transaction.query(
            `
              INSERT INTO clinics
                (id, display_name, city, timezone, currency, status, created_by, created_at, updated_at)
              VALUES ($1, $2, $3, 'America/Sao_Paulo', 'BRL', 'active', $4, now(), now())
            `,
            [
              clinicId,
              clinicName ?? `Clínica de ${name.split(" ")[0]}`,
              clinicCity ?? null,
              userId,
            ],
          );
          const roleIds = new Map<string, string>();
          for (const role of roles) {
            const roleId = randomUUID();
            roleIds.set(role.code, roleId);
            await transaction.query(
              `
                INSERT INTO roles (id, clinic_id, code, name, is_system, created_at)
                VALUES ($1, $2, $3, $4, true, now())
              `,
              [roleId, clinicId, role.code, role.name],
            );
            await insertRolePermissions(transaction, clinicId, roleId, role.code);
          }
          const administratorRoleId = roleIds.get("administrador");
          if (!administratorRoleId) throw new Error("Papel administrador não criado.");
          await transaction.query(
            `
              INSERT INTO clinic_memberships
                (id, clinic_id, user_id, role_id, status, joined_at, created_at, updated_at)
              VALUES ($1, $2, $3, $4, 'active', now(), now(), now())
            `,
            [membershipId, clinicId, userId, administratorRoleId],
          );
          await transaction.query(
            `
              INSERT INTO clinic_preferences
                (clinic_id, compact_mode, reminders_enabled, updated_by)
              VALUES ($1, false, true, $2)
            `,
            [clinicId, userId],
          );
          await transaction.query(
            `
              INSERT INTO professionals
                (id, clinic_id, membership_id, full_name, active, created_at, updated_at)
              VALUES ($1, $2, $3, $4, true, now(), now())
            `,
            [randomUUID(), clinicId, membershipId, name],
          );
          const locationId = randomUUID();
          await transaction.query(
            `
              INSERT INTO clinic_locations
                (id, clinic_id, name, city, timezone, active)
              VALUES ($1, $2, 'Unidade principal', $3, 'America/Sao_Paulo', true)
            `,
            [locationId, clinicId, clinicCity || "Não informada"],
          );
          for (const room of ["Sala 01", "Sala 02", "Sala 03"]) {
            await transaction.query(
              `
                INSERT INTO clinic_resources
                  (id, clinic_id, location_id, name, resource_type, active)
                VALUES ($1, $2, $3, $4, 'room', true)
              `,
              [randomUUID(), clinicId, locationId, room],
            );
          }
          const session = await createSession(transaction, config, userId, clinicId, membershipId);
          await audit(transaction, {
            clinicId,
            userId,
            membershipId,
            action: "account.registered",
            entityType: "app_user",
            entityId: userId,
            changedFields: ["email", "full_name", "status"],
            requestId: request.id,
          });
          return {
            session,
            context: {
              sessionId: session.id,
              userId,
              membershipId,
              clinicId,
              email,
              fullName: name,
              roleCode: "administrador",
              roleName: "Administrador",
              clinicName: clinicName ?? `Clínica de ${name.split(" ")[0]}`,
              timezone: "America/Sao_Paulo",
              permissions: rolePermissions.administrador,
            } satisfies AuthContext,
          };
        });
        setSessionCookie(reply, config, result.session.token);
        return reply.code(201).send({ session: publicSession(result.context) });
      } catch (error) {
        request.log.error({ error }, "registration failed");
        return reply.code(409).send({
          error: "registration_failed",
          message: "Não foi possível criar a conta. Revise os dados e tente novamente.",
        });
      }
    },
  );

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "validation_error",
          message: "Informe e-mail e senha.",
        });
      const result = await database.query<UserLoginRow>(
        `
          SELECT
            users.id AS user_id,
            users.email::text AS email,
            users.full_name,
            users.password_hash,
            memberships.id AS membership_id,
            memberships.clinic_id,
            clinics.display_name AS clinic_name,
            clinics.timezone,
            roles.code AS role_code,
            roles.name AS role_name,
            COALESCE(
              (
                SELECT ARRAY_AGG(rp.permission_code)
                FROM role_permissions rp
                WHERE rp.clinic_id = memberships.clinic_id
                  AND rp.role_id = roles.id
              ),
              ARRAY[]::text[]
            ) AS permissions
          FROM app_users users
          JOIN clinic_memberships memberships
            ON memberships.user_id = users.id AND memberships.status = 'active'
          JOIN clinics
            ON clinics.id = memberships.clinic_id AND clinics.status = 'active'
          JOIN roles
            ON roles.id = memberships.role_id AND roles.clinic_id = memberships.clinic_id
          WHERE users.email = $1 AND users.status = 'active'
          ORDER BY memberships.created_at
          LIMIT 1
        `,
        [parsed.data.email],
      );
      const row = result.rows[0];
      const valid = row?.password_hash
        ? await verifyPassword(parsed.data.password, row.password_hash)
        : await verifyPassword(parsed.data.password, await dummyPasswordHash);
      if (!row || !valid)
        return reply.code(401).send({
          error: "invalid_credentials",
          message: "E-mail ou senha inválidos.",
        });
      const session = await createSession(
        database,
        config,
        row.user_id,
        row.clinic_id,
        row.membership_id,
      );
      await database.query("UPDATE app_users SET last_login_at = now() WHERE id = $1", [
        row.user_id,
      ]);
      await audit(database, {
        clinicId: row.clinic_id,
        userId: row.user_id,
        membershipId: row.membership_id,
        action: "session.created",
        entityType: "user_session",
        entityId: session.id,
        requestId: request.id,
      });
      setSessionCookie(reply, config, session.token);
      return { session: publicSession(toContext(row, session.id)) };
    },
  );

  app.get("/api/auth/session", { preHandler: requireAuth }, async (request) => ({
    session: publicSession(request.auth!),
  }));

  app.post("/api/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    await database.query(
      `
          UPDATE user_sessions
          SET revoked_at = now(), revoke_reason = 'logout'
          WHERE id = $1 AND revoked_at IS NULL
        `,
      [request.auth!.sessionId],
    );
    await audit(database, {
      clinicId: request.auth!.clinicId,
      userId: request.auth!.userId,
      membershipId: request.auth!.membershipId,
      action: "session.revoked",
      entityType: "user_session",
      entityId: request.auth!.sessionId,
      requestId: request.id,
    });
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  app.post(
    "/api/auth/password-reset/request",
    { config: { rateLimit: { max: 5, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const parsed = resetRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "validation_error",
          message: "Informe um e-mail válido.",
        });
      const users = await database.query<{ id: string }>(
        "SELECT id FROM app_users WHERE email = $1 AND status = 'active' LIMIT 1",
        [parsed.data.email],
      );
      let testToken: string | undefined;
      const user = users.rows[0];
      if (user) {
        const reset = createOpaqueToken(32);
        const expiresAt = new Date(Date.now() + config.passwordResetTtlMinutes * 60_000);
        await database.transaction(async (transaction) => {
          await transaction.query(
            `
              UPDATE password_reset_tokens
              SET revoked_at = now()
              WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL
            `,
            [user.id],
          );
          await transaction.query(
            `
              INSERT INTO password_reset_tokens
                (id, user_id, token_hash, expires_at, created_at)
              VALUES ($1, $2, $3, $4, now())
            `,
            [randomUUID(), user.id, reset.hash, expiresAt],
          );
        });
        if (config.exposeTestResetTokens) testToken = reset.token;
      }
      return reply.send({
        accepted: true,
        delivery: "not_configured",
        message:
          "Se a conta existir, a solicitação foi registrada. O envio de e-mail ainda depende da configuração do provedor.",
        ...(testToken ? { testToken } : {}),
      });
    },
  );

  app.post(
    "/api/auth/password-reset/confirm",
    { config: { rateLimit: { max: 5, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const parsed = resetConfirmSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Solicitação inválida.",
        });
      const passwordHash = await hashPassword(parsed.data.password);
      const resetHash = hashToken(parsed.data.token);
      const changed = await database.transaction(async (transaction) => {
        const tokens = await transaction.query<{ id: string; user_id: string }>(
          `
            SELECT id, user_id
            FROM password_reset_tokens
            WHERE token_hash = $1
              AND used_at IS NULL
              AND revoked_at IS NULL
              AND expires_at > now()
            FOR UPDATE
          `,
          [resetHash],
        );
        const token = tokens.rows[0];
        if (!token) return false;
        await transaction.query(
          "UPDATE app_users SET password_hash = $1, updated_at = now() WHERE id = $2 AND status = 'active'",
          [passwordHash, token.user_id],
        );
        await transaction.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [
          token.id,
        ]);
        await transaction.query(
          `
            UPDATE user_sessions
            SET revoked_at = now(), revoke_reason = 'password_reset'
            WHERE user_id = $1 AND revoked_at IS NULL
          `,
          [token.user_id],
        );
        return true;
      });
      if (!changed)
        return reply.code(400).send({
          error: "invalid_or_expired_token",
          message: "Este link é inválido ou expirou. Solicite uma nova recuperação.",
        });
      clearSessionCookie(reply, config);
      return { changed: true };
    },
  );
}
