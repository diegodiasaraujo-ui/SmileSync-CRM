import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import type { Database } from "./database.js";
import { hashToken } from "./security/tokens.js";

export type AuthContext = {
  sessionId: string;
  userId: string;
  membershipId: string;
  clinicId: string;
  email: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  clinicName: string;
  timezone: string;
  permissions: string[];
};

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

type SessionRow = {
  session_id: string;
  user_id: string;
  membership_id: string;
  clinic_id: string;
  email: string;
  full_name: string;
  role_code: string;
  role_name: string;
  clinic_name: string;
  timezone: string;
  permissions: string[];
};

export async function loadAuthContext(
  request: FastifyRequest,
  database: Database,
  config: AppConfig,
) {
  request.auth = null;
  const token = request.cookies[config.cookieName];
  if (!token || token.length < 32 || token.length > 256) return;
  const result = await database.query<SessionRow>(
    `
      SELECT
        sessions.id AS session_id,
        users.id AS user_id,
        memberships.id AS membership_id,
        memberships.clinic_id,
        users.email::text AS email,
        users.full_name,
        roles.code AS role_code,
        roles.name AS role_name,
        clinics.display_name AS clinic_name,
        clinics.timezone,
        COALESCE(
          ARRAY_AGG(role_permissions.permission_code)
            FILTER (WHERE role_permissions.permission_code IS NOT NULL),
          ARRAY[]::text[]
        ) AS permissions
      FROM user_sessions sessions
      JOIN app_users users ON users.id = sessions.user_id
      JOIN clinic_memberships memberships
        ON memberships.id = sessions.membership_id
       AND memberships.user_id = users.id
      JOIN clinics ON clinics.id = memberships.clinic_id
      JOIN roles
        ON roles.id = memberships.role_id
       AND roles.clinic_id = memberships.clinic_id
      LEFT JOIN role_permissions
        ON role_permissions.clinic_id = roles.clinic_id
       AND role_permissions.role_id = roles.id
      WHERE sessions.token_hash = $1
        AND sessions.revoked_at IS NULL
        AND sessions.idle_expires_at > now()
        AND sessions.expires_at > now()
        AND users.status = 'active'
        AND memberships.status = 'active'
        AND clinics.status = 'active'
      GROUP BY sessions.id, users.id, memberships.id, memberships.clinic_id,
        roles.code, roles.name, clinics.display_name, clinics.timezone
      LIMIT 1
    `,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return;
  request.auth = {
    sessionId: row.session_id,
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
  await database.query("UPDATE user_sessions SET last_seen_at = now() WHERE id = $1", [
    row.session_id,
  ]);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (request.auth) return;
  await reply.code(401).send({
    error: "authentication_required",
    message: "Entre novamente para continuar.",
  });
}

export function publicSession(context: AuthContext) {
  return {
    userId: context.userId,
    clinicId: context.clinicId,
    name: context.fullName,
    email: context.email,
    clinic: context.clinicName,
    timezone: context.timezone,
    role: context.roleName,
    roleCode: context.roleCode,
    permissions: context.permissions,
  };
}
