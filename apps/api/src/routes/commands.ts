import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth, type AuthContext } from "../auth-context.js";
import type { Database, DatabaseExecutor } from "../database.js";
import { getBootstrap } from "./bootstrap.js";

const envelopeSchema = z.object({
  type: z.string().trim().min(1).max(80),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().uuid(),
});

const idSchema = z.string().uuid();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => {
      const year = Number(value.slice(0, 4));
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return (
        year >= 1900 &&
        year <= 2200 &&
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    },
    { message: "Informe uma data válida." },
  );
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optionalContactSchema = z.string().trim().max(254).default("");
const optionalEmailSchema = z
  .string()
  .trim()
  .max(254)
  .refine((email) => !email || z.string().email().safeParse(email).success, {
    message: "Informe um e-mail válido.",
  })
  .default("");
const nonNegativeMoneySchema = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, {
    message: "Use no máximo duas casas decimais.",
  });
const positiveMoneySchema = nonNegativeMoneySchema.refine((value) => value >= 0.01, {
  message: "O valor deve ser de pelo menos R$ 0,01.",
});
const roleSchema = z.enum(["Administrador", "Dentista", "Secretária", "Recepção", "Financeiro"]);
const interactionKindSchema = z.enum([
  "Operação",
  "Contato",
  "Clínico",
  "Atestado",
  "Afastamento",
  "Prescrição",
  "Medicação",
]);

const schemas = {
  "patient.create": z.object({
    name: z.string().trim().min(2).max(160),
    phone: optionalContactSchema,
    email: optionalEmailSchema,
    city: z.string().trim().max(120).default(""),
    notes: z.string().trim().max(4_000).default(""),
  }),
  "patient.update": z.object({
    patientId: idSchema,
    name: z.string().trim().min(2).max(160),
    phone: optionalContactSchema,
    email: optionalEmailSchema,
    city: z.string().trim().max(120).default(""),
    notes: z.string().trim().max(4_000).default(""),
  }),
  "patient.bulk-tag": z.object({
    patientIds: z.array(idSchema).min(1).max(200),
    text: z.string().trim().min(1).max(80),
  }),
  "interaction.create": z.object({
    patientId: idSchema,
    title: z.string().trim().min(1).max(180),
    text: z.string().trim().max(10_000).default(""),
    kind: interactionKindSchema.default("Operação"),
  }),
  "interaction.bulk-create": z.object({
    patientIds: z.array(idSchema).min(1).max(200),
    text: z.string().trim().min(1).max(10_000),
  }),
  "appointment.save": z.object({
    id: idSchema.optional(),
    patientId: idSchema,
    treatmentId: idSchema.optional(),
    date: dateSchema,
    time: timeSchema,
    procedure: z.string().trim().min(2).max(240),
    duration: z.number().int().min(5).max(480),
    professional: z.string().trim().min(2).max(160),
    room: z.string().trim().min(1).max(120),
  }),
  "appointment.reschedule": z.object({
    appointmentId: idSchema,
    date: dateSchema,
    time: timeSchema,
  }),
  "appointment.status": z.object({
    appointmentId: idSchema,
    status: z.string().trim().min(1).max(80),
  }),
  "treatment.create": z.object({
    patientId: idSchema,
    name: z.string().trim().min(2).max(240),
    professional: z.string().trim().min(2).max(160),
    total: nonNegativeMoneySchema,
    steps: z.array(z.string().trim().min(1).max(240)).min(1).max(100),
  }),
  "treatment.update": z
    .object({
      treatmentId: idSchema,
      status: z.string().trim().min(1).max(80).optional(),
      priority: z.string().trim().min(1).max(40).optional(),
      total: nonNegativeMoneySchema.optional(),
    })
    .refine(
      (value) =>
        value.status !== undefined || value.priority !== undefined || value.total !== undefined,
    ),
  "treatment.step.complete": z.object({
    treatmentId: idSchema,
    stepIndex: z.number().int().min(0).max(999),
  }),
  "quote.create": z.object({
    patientId: idSchema,
    procedure: z.string().trim().min(2).max(240),
    value: positiveMoneySchema,
    discount: nonNegativeMoneySchema,
    validity: dateSchema,
  }),
  "quote.status": z.object({
    quoteId: idSchema,
    status: z.string().trim().min(1).max(80),
  }),
  "quote.convert": z.object({ quoteId: idSchema }),
  "payment-plan.create": z.object({
    treatmentId: idSchema,
    count: z.number().int().min(1).max(60),
    firstDueDate: dateSchema,
  }),
  "payment.create": z.object({
    installmentId: idSchema,
    paidOn: dateSchema,
    method: z.string().trim().min(1).max(80),
    amount: positiveMoneySchema,
  }),
  "installment.reminder": z.object({
    installmentId: idSchema,
    automatic: z.boolean(),
  }),
  "clinic.update": z.object({
    name: z.string().trim().min(2).max(160),
    phone: optionalContactSchema.optional(),
    city: z.string().trim().max(160).default(""),
  }),
  "profile.update": z.object({
    name: z.string().trim().min(2).max(160),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
  }),
  "preferences.update": z.object({ compact: z.boolean(), reminders: z.boolean() }),
  "team.role.update": z.object({ memberId: idSchema, role: roleSchema }),
  "team.invite": z.object({
    name: z.string().trim().min(2).max(160),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
    role: roleSchema,
  }),
  "automation.set": z.object({ index: z.number().int().min(0).max(4), enabled: z.boolean() }),
  "message.draft": z.object({
    patientId: idSchema,
    message: z.string().trim().min(1).max(4_096),
  }),
} as const;

type CommandName = keyof typeof schemas;
type CommandPayload<Name extends CommandName> = z.infer<(typeof schemas)[Name]>;

class CommandError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

const appointmentStatuses: Record<string, string> = {
  Agendado: "scheduled",
  Remarcado: "scheduled",
  Encaixe: "scheduled",
  "Aguardando confirmação": "awaiting_confirmation",
  Confirmado: "confirmed",
  "Em espera": "checked_in",
  "Em atendimento": "in_progress",
  Concluído: "completed",
  Cancelado: "cancelled",
  Faltou: "no_show",
};

const treatmentStatuses: Record<string, string> = {
  Planejamento: "planning",
  "Aguardando aprovação": "awaiting_approval",
  "Aguardando pagamento": "awaiting_payment",
  Agendado: "scheduled",
  "Em andamento": "in_progress",
  "Aguardando retorno": "paused",
  Pausado: "paused",
  Concluído: "completed",
  Cancelado: "cancelled",
};

const priorities: Record<string, string> = {
  Baixa: "low",
  Média: "medium",
  Alta: "high",
  Urgente: "urgent",
};

const quoteStatuses: Record<string, string> = {
  Rascunho: "draft",
  Enviado: "sent",
  Visualizado: "viewed",
  Aprovado: "approved",
  Recusado: "rejected",
  Expirado: "expired",
  Cancelado: "cancelled",
};

const automationDefinitions = [
  ["Lembrete de consulta", "appointment_upcoming", "whatsapp_draft"],
  ["Confirmação automática", "appointment_confirmation", "whatsapp_draft"],
  ["Cobrança automática", "installment_upcoming", "whatsapp_draft"],
  ["Acompanhamento pós-procedimento", "appointment_completed", "whatsapp_draft"],
  ["Paciente sem retorno", "patient_without_follow_up", "create_task"],
] as const;

function parsePayload<Name extends CommandName>(
  name: Name,
  payload: Record<string, unknown>,
): CommandPayload<Name> {
  const schema = schemas[name] as unknown as z.ZodType<CommandPayload<Name>>;
  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new CommandError(
      400,
      "validation_error",
      parsed.error.issues[0]?.message ?? "Revise os dados informados.",
    );
  return parsed.data;
}

function hasPermission(auth: AuthContext, ...permissions: string[]) {
  if (permissions.some((permission) => auth.permissions.includes(permission))) return;
  throw new CommandError(
    403,
    "permission_denied",
    "Seu perfil não possui permissão para esta ação.",
  );
}

function normalizePhone(input: string | undefined) {
  if (!input?.trim()) return null;
  const digits = input.replace(/\D/g, "");
  const normalized = input.trim().startsWith("+")
    ? `+${digits}`
    : digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? `+${digits}`
      : digits.length === 10 || digits.length === 11
        ? `+55${digits}`
        : "";
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized))
    throw new CommandError(400, "invalid_phone", "Informe um telefone válido com DDD.");
  return normalized;
}

function assertAppointmentHours(time: string, duration: number) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const start = hours * 60 + minutes;
  if (start < 8 * 60 || start + duration > 18 * 60)
    throw new CommandError(
      400,
      "outside_business_hours",
      "Escolha um horário entre 08:00 e 18:00.",
    );
}

function money(value: number) {
  return value.toFixed(2);
}

function decimalToCents(value: string | number) {
  const normalized = String(value);
  const [whole = "0", fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

function centsToMoney(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function addMonthsClamped(date: string, months: number) {
  const [year = 0, month = 0, day = 1] = date.split("-").map(Number);
  const targetStart = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(targetStart.getUTCFullYear(), targetStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  targetStart.setUTCDate(Math.min(day, lastDay));
  return targetStart.toISOString().slice(0, 10);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function audit(
  database: DatabaseExecutor,
  auth: AuthContext,
  requestId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  changedFields: string[] = [],
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
      auth.clinicId,
      auth.userId,
      auth.membershipId,
      action,
      entityType,
      entityId,
      changedFields,
      requestId,
    ],
  );
}

async function assertPatients(database: DatabaseExecutor, clinicId: string, patientIds: string[]) {
  const uniqueIds = [...new Set(patientIds)];
  const result = await database.query<{ id: string }>(
    `SELECT id FROM patients WHERE clinic_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL AND active`,
    [clinicId, uniqueIds],
  );
  if (result.rows.length !== uniqueIds.length)
    throw new CommandError(404, "patient_not_found", "Paciente não encontrado nesta clínica.");
}

async function interaction(
  database: DatabaseExecutor,
  auth: AuthContext,
  patientId: string,
  subject: string,
  body: string,
  kind: string,
) {
  const id = randomUUID();
  const normalizedKind = kind
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const sensitivity = [
    "clinico",
    "atestado",
    "afastamento",
    "prescricao",
    "medicacao",
    "documento",
    "evolucao",
  ].includes(normalizedKind)
    ? "clinical"
    : ["financeiro", "pagamento", "cobranca"].includes(normalizedKind)
      ? "financial"
      : "operational";
  await database.query(
    `
      INSERT INTO patient_interactions
        (id, clinic_id, patient_id, kind, sensitivity, subject, body, occurred_at, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, now())
    `,
    [id, auth.clinicId, patientId, kind, sensitivity, subject, body || null, auth.userId],
  );
  return id;
}

async function resolveProfessional(database: DatabaseExecutor, auth: AuthContext, name: string) {
  const result = await database.query<{ id: string }>(
    `
      SELECT id FROM professionals
      WHERE clinic_id = $1 AND active AND lower(btrim(full_name)) = lower(btrim($2))
      LIMIT 1
    `,
    [auth.clinicId, name],
  );
  const row = result.rows[0];
  if (!row)
    throw new CommandError(400, "professional_not_found", "Profissional não encontrado na equipe.");
  return row.id;
}

async function resolveRoom(database: DatabaseExecutor, auth: AuthContext, name: string) {
  const result = await database.query<{ id: string; location_id: string }>(
    `
      SELECT resources.id, resources.location_id
      FROM clinic_resources resources
      JOIN clinic_locations locations
        ON locations.clinic_id = resources.clinic_id AND locations.id = resources.location_id
      WHERE resources.clinic_id = $1 AND resources.active AND locations.active
        AND lower(btrim(resources.name)) = lower(btrim($2))
      LIMIT 1
    `,
    [auth.clinicId, name],
  );
  const row = result.rows[0];
  if (!row) throw new CommandError(400, "room_not_found", "Sala não encontrada nesta clínica.");
  return row;
}

async function assertNoAppointmentConflict(
  database: DatabaseExecutor,
  auth: AuthContext,
  input: {
    appointmentId?: string;
    professionalId: string;
    resourceId: string;
    date: string;
    time: string;
    duration: number;
  },
) {
  const result = await database.query<{ id: string }>(
    `
      SELECT appointments.id
      FROM appointments
      JOIN clinics ON clinics.id = appointments.clinic_id
      WHERE appointments.clinic_id = $1
        AND appointments.deleted_at IS NULL
        AND appointments.status <> 'cancelled'
        AND appointments.id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND (appointments.professional_id = $3 OR appointments.resource_id = $4)
        AND appointments.starts_at <
          ((($5::date + $6::time) + make_interval(mins => $7)) AT TIME ZONE clinics.timezone)
        AND appointments.ends_at > (($5::date + $6::time) AT TIME ZONE clinics.timezone)
      LIMIT 1
    `,
    [
      auth.clinicId,
      input.appointmentId ?? null,
      input.professionalId,
      input.resourceId,
      input.date,
      input.time,
      input.duration,
    ],
  );
  if (result.rows.length)
    throw new CommandError(
      409,
      "appointment_conflict",
      "Este horário conflita com outro atendimento do profissional ou da sala.",
    );
}

async function executeCommand(
  database: DatabaseExecutor,
  auth: AuthContext,
  requestId: string,
  name: CommandName,
  rawPayload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<unknown> {
  switch (name) {
    case "patient.create": {
      hasPermission(auth, "patients.create");
      const payload = parsePayload(name, rawPayload);
      const phone = normalizePhone(payload.phone);
      const email = payload.email ? payload.email.toLowerCase() : null;
      if (phone || email) {
        const duplicate = await database.query(
          `
            SELECT id FROM patients
            WHERE clinic_id = $1 AND deleted_at IS NULL
              AND (($2::text IS NOT NULL AND phone_e164 = $2) OR
                   ($3::text IS NOT NULL AND lower(email) = lower($3)))
            LIMIT 1
          `,
          [auth.clinicId, phone, email],
        );
        if (duplicate.rows.length)
          throw new CommandError(
            409,
            "patient_duplicate",
            "Já existe um paciente com este telefone ou e-mail.",
          );
      }
      const id = randomUUID();
      await database.query(
        `
          INSERT INTO patients
            (id, clinic_id, full_name, phone_e164, email, city, notes, active,
             created_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, now(), now())
        `,
        [
          id,
          auth.clinicId,
          payload.name,
          phone,
          email,
          payload.city || null,
          payload.notes || null,
          auth.userId,
        ],
      );
      const tagId = randomUUID();
      await database.query(
        `
          INSERT INTO tags (id, clinic_id, name) VALUES ($1, $2, 'Novo paciente')
          ON CONFLICT (clinic_id, name) DO NOTHING
        `,
        [tagId, auth.clinicId],
      );
      await database.query(
        `
          INSERT INTO patient_tags (clinic_id, patient_id, tag_id)
          SELECT $1, $2, id FROM tags WHERE clinic_id = $1 AND name = 'Novo paciente'
          ON CONFLICT DO NOTHING
        `,
        [auth.clinicId, id],
      );
      await interaction(
        database,
        auth,
        id,
        "Paciente cadastrado",
        "Cadastro realizado pela equipe.",
        "Operação",
      );
      await audit(database, auth, requestId, "patient.create", "patient", id, [
        "full_name",
        "phone_e164",
        "email",
        "city",
        "notes",
      ]);
      const today = await database.query<{ today: string }>(
        `SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today FROM clinics WHERE id = $1`,
        [auth.clinicId],
      );
      return {
        id,
        name: payload.name,
        phone: phone ?? "",
        email: email ?? "",
        city: payload.city,
        since: today.rows[0]?.today ?? new Date().toISOString().slice(0, 10),
        tags: ["Novo paciente"],
        notes: payload.notes,
      };
    }
    case "patient.update": {
      hasPermission(auth, "patients.update");
      const payload = parsePayload(name, rawPayload);
      const phone = normalizePhone(payload.phone);
      const email = payload.email ? payload.email.toLowerCase() : null;
      const duplicate = await database.query(
        `
          SELECT id FROM patients
          WHERE clinic_id = $1 AND id <> $2 AND deleted_at IS NULL
            AND (($3::text IS NOT NULL AND phone_e164 = $3) OR
                 ($4::text IS NOT NULL AND lower(email) = lower($4)))
          LIMIT 1
        `,
        [auth.clinicId, payload.patientId, phone, email],
      );
      if (duplicate.rows.length)
        throw new CommandError(
          409,
          "patient_duplicate",
          "Já existe um paciente com este telefone ou e-mail.",
        );
      const result = await database.query(
        `
          UPDATE patients
          SET full_name = $3, phone_e164 = $4, email = $5, city = $6, notes = $7,
              row_version = row_version + 1, updated_at = now()
          WHERE clinic_id = $1 AND id = $2 AND deleted_at IS NULL
        `,
        [
          auth.clinicId,
          payload.patientId,
          payload.name,
          phone,
          email,
          payload.city || null,
          payload.notes || null,
        ],
      );
      if (!result.rowCount)
        throw new CommandError(404, "patient_not_found", "Paciente não encontrado.");
      await audit(database, auth, requestId, "patient.update", "patient", payload.patientId, [
        "full_name",
        "phone_e164",
        "email",
        "city",
        "notes",
      ]);
      return { id: payload.patientId };
    }
    case "patient.bulk-tag": {
      hasPermission(auth, "patients.update");
      const payload = parsePayload(name, rawPayload);
      await assertPatients(database, auth.clinicId, payload.patientIds);
      const tagId = randomUUID();
      await database.query(
        `INSERT INTO tags (id, clinic_id, name) VALUES ($1, $2, $3) ON CONFLICT (clinic_id, name) DO NOTHING`,
        [tagId, auth.clinicId, payload.text],
      );
      await database.query(
        `
          INSERT INTO patient_tags (clinic_id, patient_id, tag_id)
          SELECT $1, patient_id, tags.id
          FROM unnest($2::uuid[]) AS patient_id
          CROSS JOIN tags
          WHERE tags.clinic_id = $1 AND tags.name = $3
          ON CONFLICT DO NOTHING
        `,
        [auth.clinicId, [...new Set(payload.patientIds)], payload.text],
      );
      await audit(database, auth, requestId, "patient.bulk_tag", "patient", null, ["tags"]);
      return { updated: new Set(payload.patientIds).size };
    }
    case "interaction.create": {
      hasPermission(auth, "patients.update");
      const payload = parsePayload(name, rawPayload);
      if (["Clínico", "Atestado", "Afastamento", "Prescrição", "Medicação"].includes(payload.kind))
        hasPermission(auth, "treatments.clinical.write");
      await assertPatients(database, auth.clinicId, [payload.patientId]);
      const id = await interaction(
        database,
        auth,
        payload.patientId,
        payload.title,
        payload.text,
        payload.kind,
      );
      await audit(database, auth, requestId, "interaction.create", "patient_interaction", id);
      return { id };
    }
    case "interaction.bulk-create": {
      hasPermission(auth, "patients.update");
      const payload = parsePayload(name, rawPayload);
      const ids = [...new Set(payload.patientIds)];
      await assertPatients(database, auth.clinicId, ids);
      for (const patientId of ids)
        await interaction(
          database,
          auth,
          patientId,
          "Interação registrada em lote",
          payload.text,
          "Contato",
        );
      await audit(
        database,
        auth,
        requestId,
        "interaction.bulk_create",
        "patient_interaction",
        null,
      );
      return { created: ids.length };
    }
    case "appointment.save": {
      hasPermission(
        auth,
        payloadIsUpdate(rawPayload) ? "appointments.update" : "appointments.create",
      );
      const payload = parsePayload(name, rawPayload);
      assertAppointmentHours(payload.time, payload.duration);
      await assertPatients(database, auth.clinicId, [payload.patientId]);
      const professionalId = await resolveProfessional(database, auth, payload.professional);
      const room = await resolveRoom(database, auth, payload.room);
      if (payload.treatmentId) {
        const treatment = await database.query(
          `SELECT id FROM treatments WHERE clinic_id = $1 AND id = $2 AND patient_id = $3 AND deleted_at IS NULL`,
          [auth.clinicId, payload.treatmentId, payload.patientId],
        );
        if (!treatment.rows.length)
          throw new CommandError(
            400,
            "invalid_treatment",
            "O tratamento não pertence ao paciente selecionado.",
          );
      }
      if (payload.id) {
        const existing = await database.query(
          `SELECT id FROM appointments WHERE clinic_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [auth.clinicId, payload.id],
        );
        if (!existing.rows.length)
          throw new CommandError(404, "appointment_not_found", "Consulta não encontrada.");
      }
      await assertNoAppointmentConflict(database, auth, {
        ...(payload.id ? { appointmentId: payload.id } : {}),
        professionalId,
        resourceId: room.id,
        date: payload.date,
        time: payload.time,
        duration: payload.duration,
      });
      const id = payload.id ?? randomUUID();
      if (payload.id) {
        await database.query(
          `
            UPDATE appointments
            SET patient_id = $3, treatment_id = $4, professional_id = $5,
                location_id = $6, resource_id = $7, procedure_name = $8,
                starts_at = (($9::date + $10::time) AT TIME ZONE clinics.timezone),
                ends_at = ((($9::date + $10::time) + make_interval(mins => $11)) AT TIME ZONE clinics.timezone),
                status = 'scheduled', cancellation_reason = NULL,
                row_version = row_version + 1, updated_at = now()
            FROM clinics
            WHERE appointments.clinic_id = $1 AND appointments.id = $2 AND clinics.id = appointments.clinic_id
          `,
          [
            auth.clinicId,
            id,
            payload.patientId,
            payload.treatmentId ?? null,
            professionalId,
            room.location_id,
            room.id,
            payload.procedure,
            payload.date,
            payload.time,
            payload.duration,
          ],
        );
      } else {
        await database.query(
          `
            INSERT INTO appointments
              (id, clinic_id, patient_id, treatment_id, professional_id, location_id,
               resource_id, procedure_name, starts_at, ends_at, status, created_by,
               created_at, updated_at)
            SELECT $1, $2, $3, $4, $5, $6, $7, $8,
                   (($9::date + $10::time) AT TIME ZONE timezone),
                   ((($9::date + $10::time) + make_interval(mins => $11)) AT TIME ZONE timezone),
                   'awaiting_confirmation', $12, now(), now()
            FROM clinics WHERE id = $2
          `,
          [
            id,
            auth.clinicId,
            payload.patientId,
            payload.treatmentId ?? null,
            professionalId,
            room.location_id,
            room.id,
            payload.procedure,
            payload.date,
            payload.time,
            payload.duration,
            auth.userId,
          ],
        );
      }
      await database.query(
        `
          INSERT INTO appointment_status_history
            (id, clinic_id, appointment_id, from_status, to_status, reason, changed_by)
          VALUES ($1, $2, $3, NULL, $4, $5, $6)
        `,
        [
          randomUUID(),
          auth.clinicId,
          id,
          payload.id ? "scheduled" : "awaiting_confirmation",
          payload.id ? "Consulta remarcada" : "Consulta criada",
          auth.userId,
        ],
      );
      await interaction(
        database,
        auth,
        payload.patientId,
        payload.id ? "Consulta remarcada" : "Consulta agendada",
        `${payload.procedure} · ${payload.date} · ${payload.time}`,
        "Agenda",
      );
      await audit(
        database,
        auth,
        requestId,
        payload.id ? "appointment.reschedule" : "appointment.create",
        "appointment",
        id,
      );
      return {
        id,
        patientId: payload.patientId,
        ...(payload.treatmentId ? { treatmentId: payload.treatmentId } : {}),
        procedure: payload.procedure,
        date: payload.date,
        time: payload.time,
        duration: payload.duration,
        professional: payload.professional,
        room: payload.room,
        status: payload.id ? "Agendado" : "Aguardando confirmação",
      };
    }
    case "appointment.reschedule": {
      hasPermission(auth, "appointments.update");
      const payload = parsePayload(name, rawPayload);
      const existing = await database.query<{
        patient_id: string;
        professional_id: string;
        resource_id: string;
        duration: number;
      }>(
        `
          SELECT patient_id, professional_id, resource_id,
                 EXTRACT(EPOCH FROM (ends_at - starts_at))::integer / 60 AS duration
          FROM appointments
          WHERE clinic_id = $1 AND id = $2 AND deleted_at IS NULL
        `,
        [auth.clinicId, payload.appointmentId],
      );
      const appointment = existing.rows[0];
      if (!appointment)
        throw new CommandError(404, "appointment_not_found", "Consulta não encontrada.");
      assertAppointmentHours(payload.time, Number(appointment.duration));
      await assertNoAppointmentConflict(database, auth, {
        appointmentId: payload.appointmentId,
        professionalId: appointment.professional_id,
        resourceId: appointment.resource_id,
        date: payload.date,
        time: payload.time,
        duration: Number(appointment.duration),
      });
      await database.query(
        `
          UPDATE appointments
          SET starts_at = (($3::date + $4::time) AT TIME ZONE clinics.timezone),
              ends_at = ((($3::date + $4::time) + (ends_at - starts_at)) AT TIME ZONE clinics.timezone),
              status = 'scheduled', cancellation_reason = NULL,
              row_version = row_version + 1, updated_at = now()
          FROM clinics
          WHERE appointments.clinic_id = $1 AND appointments.id = $2 AND clinics.id = appointments.clinic_id
        `,
        [auth.clinicId, payload.appointmentId, payload.date, payload.time],
      );
      await interaction(
        database,
        auth,
        appointment.patient_id,
        "Consulta remarcada na agenda",
        `${payload.date} · ${payload.time}`,
        "Agenda",
      );
      await audit(
        database,
        auth,
        requestId,
        "appointment.reschedule",
        "appointment",
        payload.appointmentId,
        ["starts_at", "ends_at", "status"],
      );
      return { id: payload.appointmentId };
    }
    case "appointment.status": {
      const payload = parsePayload(name, rawPayload);
      hasPermission(
        auth,
        payload.status === "Cancelado" ? "appointments.cancel" : "appointments.update",
      );
      const status = appointmentStatuses[payload.status];
      if (!status) throw new CommandError(400, "invalid_status", "Status de consulta inválido.");
      const existing = await database.query<{
        patient_id: string;
        procedure_name: string;
        status: string;
      }>(
        `SELECT patient_id, procedure_name, status FROM appointments WHERE clinic_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [auth.clinicId, payload.appointmentId],
      );
      const appointment = existing.rows[0];
      if (!appointment)
        throw new CommandError(404, "appointment_not_found", "Consulta não encontrada.");
      await database.query(
        `
          UPDATE appointments
          SET status = $3,
              cancellation_reason = CASE WHEN $3 = 'cancelled' THEN 'Cancelada pela equipe' ELSE NULL END,
              row_version = row_version + 1, updated_at = now()
          WHERE clinic_id = $1 AND id = $2
        `,
        [auth.clinicId, payload.appointmentId, status],
      );
      await database.query(
        `
          INSERT INTO appointment_status_history
            (id, clinic_id, appointment_id, from_status, to_status, reason, changed_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          randomUUID(),
          auth.clinicId,
          payload.appointmentId,
          appointment.status,
          status,
          status === "cancelled" ? "Cancelada pela equipe" : null,
          auth.userId,
        ],
      );
      await interaction(
        database,
        auth,
        appointment.patient_id,
        `Consulta: ${payload.status.toLowerCase()}`,
        appointment.procedure_name,
        "Agenda",
      );
      await audit(
        database,
        auth,
        requestId,
        "appointment.status",
        "appointment",
        payload.appointmentId,
        ["status"],
      );
      return { id: payload.appointmentId };
    }
    case "treatment.create": {
      hasPermission(auth, "treatments.write", "treatments.clinical.write");
      const payload = parsePayload(name, rawPayload);
      if (payload.total > 0) hasPermission(auth, "finance.charges.write", "quotes.approve");
      await assertPatients(database, auth.clinicId, [payload.patientId]);
      const professionalId = await resolveProfessional(database, auth, payload.professional);
      const id = randomUUID();
      await database.query(
        `
          INSERT INTO treatments
            (id, clinic_id, patient_id, professional_id, name, contracted_amount,
             status, priority, created_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'planning', 'medium', $7, now(), now())
        `,
        [
          id,
          auth.clinicId,
          payload.patientId,
          professionalId,
          payload.name,
          money(payload.total),
          auth.userId,
        ],
      );
      for (const [index, step] of payload.steps.entries())
        await database.query(
          `
            INSERT INTO treatment_steps
              (id, clinic_id, treatment_id, sequence_no, name, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', now(), now())
          `,
          [randomUUID(), auth.clinicId, id, index + 1, step],
        );
      await interaction(
        database,
        auth,
        payload.patientId,
        "Tratamento adicionado",
        payload.name,
        "Clínico",
      );
      await audit(database, auth, requestId, "treatment.create", "treatment", id);
      return { id };
    }
    case "treatment.update": {
      hasPermission(auth, "treatments.write", "treatments.clinical.write");
      const payload = parsePayload(name, rawPayload);
      const fields: string[] = [];
      const values: (string | number | boolean | Date | null | string[])[] = [
        auth.clinicId,
        payload.treatmentId,
      ];
      const changed: string[] = [];
      if (payload.status !== undefined) {
        const status = treatmentStatuses[payload.status];
        if (!status)
          throw new CommandError(400, "invalid_status", "Status de tratamento inválido.");
        values.push(status);
        fields.push(`status = $${values.length}`);
        fields.push(
          `completed_at = CASE WHEN $${values.length} = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END`,
        );
        fields.push(
          `cancelled_at = CASE WHEN $${values.length} = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE NULL END`,
        );
        fields.push(
          `cancellation_reason = CASE WHEN $${values.length} = 'cancelled' THEN 'Cancelado pela equipe' ELSE NULL END`,
        );
        changed.push("status");
      }
      if (payload.priority !== undefined) {
        const priority = priorities[payload.priority];
        if (!priority) throw new CommandError(400, "invalid_priority", "Prioridade inválida.");
        values.push(priority);
        fields.push(`priority = $${values.length}`);
        changed.push("priority");
      }
      if (payload.total !== undefined) {
        hasPermission(auth, "finance.charges.write", "quotes.approve");
        values.push(money(payload.total));
        fields.push(`contracted_amount = $${values.length}`);
        changed.push("contracted_amount");
      }
      const before = await database.query<{ patient_id: string; status: string }>(
        `SELECT patient_id, status FROM treatments WHERE clinic_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [auth.clinicId, payload.treatmentId],
      );
      const treatment = before.rows[0];
      if (!treatment)
        throw new CommandError(404, "treatment_not_found", "Tratamento não encontrado.");
      if (payload.status === "Concluído") {
        const pending = await database.query(
          `SELECT id FROM treatment_steps WHERE clinic_id = $1 AND treatment_id = $2 AND status <> 'completed' LIMIT 1`,
          [auth.clinicId, payload.treatmentId],
        );
        if (pending.rows.length)
          throw new CommandError(
            409,
            "pending_steps",
            "Conclua as etapas antes de finalizar o tratamento.",
          );
      }
      await database.query(
        `UPDATE treatments SET ${fields.join(", ")}, row_version = row_version + 1, updated_at = now() WHERE clinic_id = $1 AND id = $2`,
        values,
      );
      if (payload.status !== undefined)
        await database.query(
          `
            INSERT INTO treatment_status_history
              (id, clinic_id, treatment_id, from_status, to_status, reason, changed_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            randomUUID(),
            auth.clinicId,
            payload.treatmentId,
            treatment.status,
            treatmentStatuses[payload.status] ?? payload.status,
            payload.status === "Cancelado" ? "Cancelado pela equipe" : null,
            auth.userId,
          ],
        );
      await audit(
        database,
        auth,
        requestId,
        "treatment.update",
        "treatment",
        payload.treatmentId,
        changed,
      );
      return { id: payload.treatmentId };
    }
    case "treatment.step.complete": {
      hasPermission(auth, "treatments.write", "treatments.clinical.write");
      const payload = parsePayload(name, rawPayload);
      const treatmentResult = await database.query<{ patient_id: string; name: string }>(
        `SELECT patient_id, name FROM treatments WHERE clinic_id = $1 AND id = $2 AND deleted_at IS NULL AND status <> 'cancelled'`,
        [auth.clinicId, payload.treatmentId],
      );
      const treatment = treatmentResult.rows[0];
      if (!treatment)
        throw new CommandError(404, "treatment_not_found", "Tratamento não encontrado.");
      const stepResult = await database.query<{ id: string; name: string; sequence_no: number }>(
        `SELECT id, name, sequence_no FROM treatment_steps WHERE clinic_id = $1 AND treatment_id = $2 AND sequence_no = $3`,
        [auth.clinicId, payload.treatmentId, payload.stepIndex + 1],
      );
      const step = stepResult.rows[0];
      if (!step) throw new CommandError(404, "step_not_found", "Etapa não encontrada.");
      const earlier = await database.query(
        `SELECT id FROM treatment_steps WHERE clinic_id = $1 AND treatment_id = $2 AND sequence_no < $3 AND status <> 'completed' LIMIT 1`,
        [auth.clinicId, payload.treatmentId, step.sequence_no],
      );
      if (earlier.rows.length)
        throw new CommandError(409, "step_order", "Conclua as etapas anteriores primeiro.");
      await database.query(
        `UPDATE treatment_steps SET status = 'completed', completed_at = COALESCE(completed_at, now()), completed_by = $4, updated_at = now() WHERE clinic_id = $1 AND treatment_id = $2 AND id = $3`,
        [auth.clinicId, payload.treatmentId, step.id, auth.userId],
      );
      const remaining = await database.query(
        `SELECT id FROM treatment_steps WHERE clinic_id = $1 AND treatment_id = $2 AND status <> 'completed' LIMIT 1`,
        [auth.clinicId, payload.treatmentId],
      );
      await database.query(
        `
          UPDATE treatments
          SET status = $3,
              completed_at = CASE WHEN $3 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
              updated_at = now(), row_version = row_version + 1
          WHERE clinic_id = $1 AND id = $2
        `,
        [auth.clinicId, payload.treatmentId, remaining.rows.length ? "in_progress" : "completed"],
      );
      await interaction(
        database,
        auth,
        treatment.patient_id,
        "Etapa concluída",
        step.name,
        "Clínico",
      );
      await audit(database, auth, requestId, "treatment.step.complete", "treatment_step", step.id, [
        "status",
        "completed_at",
      ]);
      return { id: step.id };
    }
    case "quote.create": {
      hasPermission(auth, "quotes.create");
      const payload = parsePayload(name, rawPayload);
      if (payload.discount >= payload.value)
        throw new CommandError(
          400,
          "invalid_discount",
          "O desconto deve ser menor que o valor do orçamento.",
        );
      await assertPatients(database, auth.clinicId, [payload.patientId]);
      const id = randomUUID();
      const total = payload.value - payload.discount;
      await database.query(
        `
          INSERT INTO quotes
            (id, clinic_id, patient_id, status, valid_until, subtotal,
             discount_amount, total_amount, created_by, created_at, updated_at)
          VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, now(), now())
        `,
        [
          id,
          auth.clinicId,
          payload.patientId,
          payload.validity,
          money(payload.value),
          money(payload.discount),
          money(total),
          auth.userId,
        ],
      );
      await database.query(
        `
          INSERT INTO quote_items
            (id, clinic_id, quote_id, sequence_no, description, quantity, unit_price, discount_amount)
          VALUES ($1, $2, $3, 1, $4, 1, $5, $6)
        `,
        [
          randomUUID(),
          auth.clinicId,
          id,
          payload.procedure,
          money(payload.value),
          money(payload.discount),
        ],
      );
      await interaction(
        database,
        auth,
        payload.patientId,
        "Orçamento criado",
        payload.procedure,
        "Orçamento",
      );
      await audit(database, auth, requestId, "quote.create", "quote", id);
      return { id };
    }
    case "quote.status": {
      hasPermission(auth, "quotes.update", "quotes.approve");
      const payload = parsePayload(name, rawPayload);
      const status = quoteStatuses[payload.status];
      if (!status) throw new CommandError(400, "invalid_status", "Status de orçamento inválido.");
      if (["approved", "rejected"].includes(status)) hasPermission(auth, "quotes.approve");
      const before = await database.query<{ status: string; patient_id: string }>(
        `SELECT status, patient_id FROM quotes WHERE clinic_id = $1 AND id = $2`,
        [auth.clinicId, payload.quoteId],
      );
      const quote = before.rows[0];
      if (!quote) throw new CommandError(404, "quote_not_found", "Orçamento não encontrado.");
      const converted = await database.query(
        `SELECT id FROM treatments WHERE clinic_id = $1 AND source_quote_id = $2 LIMIT 1`,
        [auth.clinicId, payload.quoteId],
      );
      if (converted.rows.length)
        throw new CommandError(
          409,
          "quote_converted",
          "Este orçamento já foi convertido em tratamento.",
        );
      await database.query(
        `
          UPDATE quotes
          SET status = $3,
              sent_at = CASE WHEN $3 = 'sent' THEN COALESCE(sent_at, now()) ELSE sent_at END,
              approved_at = CASE WHEN $3 = 'approved' THEN COALESCE(approved_at, now()) ELSE NULL END,
              rejected_at = CASE WHEN $3 = 'rejected' THEN COALESCE(rejected_at, now()) ELSE NULL END,
              row_version = row_version + 1, updated_at = now()
          WHERE clinic_id = $1 AND id = $2
        `,
        [auth.clinicId, payload.quoteId, status],
      );
      await database.query(
        `INSERT INTO quote_status_history (id, clinic_id, quote_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), auth.clinicId, payload.quoteId, quote.status, status, auth.userId],
      );
      await interaction(
        database,
        auth,
        quote.patient_id,
        `Orçamento ${payload.status.toLowerCase()}`,
        "Status da proposta atualizado.",
        "Orçamento",
      );
      await audit(database, auth, requestId, "quote.status", "quote", payload.quoteId, ["status"]);
      return { id: payload.quoteId };
    }
    case "quote.convert": {
      hasPermission(auth, "quotes.approve");
      const payload = parsePayload(name, rawPayload);
      const existing = await database.query<{ id: string }>(
        `SELECT id FROM treatments WHERE clinic_id = $1 AND source_quote_id = $2 LIMIT 1`,
        [auth.clinicId, payload.quoteId],
      );
      if (existing.rows[0]) return { id: existing.rows[0].id };
      const result = await database.query<{
        patient_id: string;
        total_amount: string;
        description: string;
        professional_id: string;
      }>(
        `
          SELECT quotes.patient_id, quotes.total_amount, items.description,
                 COALESCE(patients.assigned_professional_id,
                   (SELECT id FROM professionals WHERE clinic_id = quotes.clinic_id AND active ORDER BY created_at LIMIT 1)
                 ) AS professional_id
          FROM quotes
          JOIN patients ON patients.clinic_id = quotes.clinic_id AND patients.id = quotes.patient_id
          JOIN quote_items items ON items.clinic_id = quotes.clinic_id AND items.quote_id = quotes.id AND items.sequence_no = 1
          WHERE quotes.clinic_id = $1 AND quotes.id = $2 AND quotes.status = 'approved'
          LIMIT 1
        `,
        [auth.clinicId, payload.quoteId],
      );
      const quote = result.rows[0];
      if (!quote)
        throw new CommandError(
          409,
          "quote_not_approved",
          "Aprove o orçamento antes de convertê-lo.",
        );
      if (!quote.professional_id)
        throw new CommandError(
          409,
          "professional_required",
          "Cadastre um profissional antes de converter o orçamento.",
        );
      const id = randomUUID();
      await database.query(
        `
          INSERT INTO treatments
            (id, clinic_id, patient_id, professional_id, source_quote_id, name,
             contracted_amount, status, priority, created_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'planning', 'medium', $8, now(), now())
        `,
        [
          id,
          auth.clinicId,
          quote.patient_id,
          quote.professional_id,
          payload.quoteId,
          quote.description,
          quote.total_amount,
          auth.userId,
        ],
      );
      const defaultSteps = ["Avaliação", "Planejamento", "Procedimento", "Retorno", "Finalização"];
      for (const [index, step] of defaultSteps.entries())
        await database.query(
          `INSERT INTO treatment_steps (id, clinic_id, treatment_id, sequence_no, name, status) VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [randomUUID(), auth.clinicId, id, index + 1, step],
        );
      await interaction(
        database,
        auth,
        quote.patient_id,
        "Orçamento convertido em tratamento",
        quote.description,
        "Clínico",
      );
      await audit(database, auth, requestId, "quote.convert", "treatment", id, ["source_quote_id"]);
      return { id };
    }
    case "payment-plan.create": {
      hasPermission(auth, "finance.charges.write");
      const payload = parsePayload(name, rawPayload);
      const result = await database.query<{
        patient_id: string;
        name: string;
        contracted_amount: string;
      }>(
        `SELECT patient_id, name, contracted_amount FROM treatments WHERE clinic_id = $1 AND id = $2 AND deleted_at IS NULL AND status <> 'cancelled'`,
        [auth.clinicId, payload.treatmentId],
      );
      const treatment = result.rows[0];
      if (!treatment)
        throw new CommandError(404, "treatment_not_found", "Tratamento não encontrado.");
      const totalCents = decimalToCents(treatment.contracted_amount);
      if (totalCents <= 0)
        throw new CommandError(
          409,
          "treatment_without_value",
          "Informe o valor contratado antes de criar o plano.",
        );
      const alreadyExists = await database.query(
        `SELECT id FROM receivables WHERE clinic_id = $1 AND treatment_id = $2 AND status <> 'cancelled' LIMIT 1`,
        [auth.clinicId, payload.treatmentId],
      );
      if (alreadyExists.rows.length)
        throw new CommandError(
          409,
          "payment_plan_exists",
          "Este tratamento já possui um plano financeiro.",
        );
      const receivableId = randomUUID();
      await database.query(
        `
          INSERT INTO receivables
            (id, clinic_id, patient_id, treatment_id, description, total_amount,
             status, created_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, now(), now())
        `,
        [
          receivableId,
          auth.clinicId,
          treatment.patient_id,
          payload.treatmentId,
          treatment.name,
          treatment.contracted_amount,
          auth.userId,
        ],
      );
      const regular = Math.floor(totalCents / payload.count);
      for (let index = 0; index < payload.count; index += 1) {
        const cents = index === payload.count - 1 ? totalCents - regular * index : regular;
        if (cents <= 0)
          throw new CommandError(
            400,
            "invalid_installments",
            "Reduza a quantidade de parcelas para este valor.",
          );
        await database.query(
          `
            INSERT INTO installments
              (id, clinic_id, receivable_id, installment_no, due_date, amount, automatic_reminder)
            VALUES ($1, $2, $3, $4, $5, $6, false)
          `,
          [
            randomUUID(),
            auth.clinicId,
            receivableId,
            index + 1,
            addMonthsClamped(payload.firstDueDate, index),
            centsToMoney(cents),
          ],
        );
      }
      await database.query(
        `UPDATE treatments SET status = CASE WHEN status = 'planning' THEN 'awaiting_payment' ELSE status END, updated_at = now() WHERE clinic_id = $1 AND id = $2`,
        [auth.clinicId, payload.treatmentId],
      );
      await interaction(
        database,
        auth,
        treatment.patient_id,
        "Plano de pagamento criado",
        `${payload.count} parcela(s)`,
        "Financeiro",
      );
      await audit(database, auth, requestId, "payment_plan.create", "receivable", receivableId);
      return { id: receivableId };
    }
    case "payment.create": {
      hasPermission(auth, "finance.payments.write");
      const payload = parsePayload(name, rawPayload);
      const result = await database.query<{
        patient_id: string;
        receivable_id: string;
        outstanding_amount: string;
        installment_no: number;
      }>(
        `
          SELECT receivables.patient_id, installments.receivable_id,
                 (
                   installments.amount - COALESCE((
                     SELECT SUM(allocations.amount)
                     FROM payment_allocations allocations
                     JOIN payments
                       ON payments.clinic_id = allocations.clinic_id
                      AND payments.id = allocations.payment_id
                     WHERE allocations.clinic_id = installments.clinic_id
                       AND allocations.installment_id = installments.id
                       AND payments.status = 'posted'
                   ), 0)
                 )::numeric(14,2) AS outstanding_amount,
                 installments.installment_no
          FROM installments
          JOIN receivables
            ON receivables.clinic_id = installments.clinic_id
           AND receivables.id = installments.receivable_id
          WHERE installments.clinic_id = $1 AND installments.id = $2
            AND installments.cancelled_at IS NULL AND receivables.status = 'open'
          FOR UPDATE OF installments
        `,
        [auth.clinicId, payload.installmentId],
      );
      const installment = result.rows[0];
      if (!installment)
        throw new CommandError(404, "installment_not_found", "Parcela em aberto não encontrada.");
      const amountCents = Math.round(payload.amount * 100);
      const outstandingCents = decimalToCents(installment.outstanding_amount);
      if (amountCents > outstandingCents)
        throw new CommandError(
          409,
          "overpayment",
          "O pagamento não pode exceder o saldo da parcela.",
        );
      const paymentId = randomUUID();
      await database.query(
        `
          INSERT INTO payments
            (id, clinic_id, patient_id, amount, method, paid_at, status,
             idempotency_key, created_by, created_at)
          SELECT $1, $2, $3, $4, $5,
                 (($6::date + time '12:00') AT TIME ZONE timezone),
                 'posted', $7, $8, now()
          FROM clinics WHERE id = $2
        `,
        [
          paymentId,
          auth.clinicId,
          installment.patient_id,
          centsToMoney(amountCents),
          payload.method,
          payload.paidOn,
          idempotencyKey,
          auth.userId,
        ],
      );
      await database.query(
        `INSERT INTO payment_allocations (id, clinic_id, payment_id, installment_id, amount) VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), auth.clinicId, paymentId, payload.installmentId, centsToMoney(amountCents)],
      );
      await database.query(
        `
          UPDATE receivables
          SET status = CASE
                WHEN NOT EXISTS (
                  SELECT 1 FROM installment_balances balances
                  WHERE balances.clinic_id = $1 AND balances.receivable_id = $2
                    AND balances.outstanding_amount > 0
                ) THEN 'settled' ELSE status END,
              updated_at = now()
          WHERE clinic_id = $1 AND id = $2
        `,
        [auth.clinicId, installment.receivable_id],
      );
      await interaction(
        database,
        auth,
        installment.patient_id,
        `Pagamento de R$ ${centsToMoney(amountCents).replace(".", ",")} registrado`,
        `Parcela ${installment.installment_no} · ${payload.method}`,
        "Financeiro",
      );
      await audit(database, auth, requestId, "payment.create", "payment", paymentId);
      return { id: paymentId };
    }
    case "installment.reminder": {
      hasPermission(auth, "finance.charges.write");
      const payload = parsePayload(name, rawPayload);
      const result = await database.query(
        `
          UPDATE installments
          SET automatic_reminder = $3
          FROM receivables
          WHERE installments.clinic_id = $1 AND installments.id = $2
            AND receivables.clinic_id = installments.clinic_id
            AND receivables.id = installments.receivable_id
            AND receivables.status = 'open'
        `,
        [auth.clinicId, payload.installmentId, payload.automatic],
      );
      if (!result.rowCount)
        throw new CommandError(404, "installment_not_found", "Parcela não encontrada.");
      await audit(
        database,
        auth,
        requestId,
        "installment.reminder",
        "installment",
        payload.installmentId,
        ["automatic_reminder"],
      );
      return { id: payload.installmentId };
    }
    case "clinic.update": {
      hasPermission(auth, "clinic.settings.update");
      const payload = parsePayload(name, rawPayload);
      const phone = normalizePhone(payload.phone);
      await database.query(
        `UPDATE clinics SET display_name = $2, phone_e164 = $3, city = $4, updated_at = now() WHERE id = $1`,
        [auth.clinicId, payload.name, phone, payload.city || null],
      );
      await database.query(
        `UPDATE clinic_locations SET city = $2, updated_at = now() WHERE clinic_id = $1 AND name = 'Unidade principal'`,
        [auth.clinicId, payload.city || "Não informada"],
      );
      await audit(database, auth, requestId, "clinic.update", "clinic", auth.clinicId, [
        "display_name",
        "phone_e164",
        "city",
      ]);
      return { id: auth.clinicId };
    }
    case "profile.update": {
      const payload = parsePayload(name, rawPayload);
      const duplicate = await database.query(
        `SELECT id FROM app_users WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1`,
        [payload.email, auth.userId],
      );
      if (duplicate.rows.length)
        throw new CommandError(409, "email_in_use", "Já existe uma conta com este e-mail.");
      await database.query(
        `UPDATE app_users SET full_name = $2, email = $3, updated_at = now() WHERE id = $1`,
        [auth.userId, payload.name, payload.email],
      );
      await database.query(
        `UPDATE professionals SET full_name = $3, updated_at = now() WHERE clinic_id = $1 AND membership_id = $2`,
        [auth.clinicId, auth.membershipId, payload.name],
      );
      await audit(database, auth, requestId, "profile.update", "user", auth.userId, [
        "full_name",
        "email",
      ]);
      return { id: auth.userId };
    }
    case "preferences.update": {
      hasPermission(auth, "clinic.settings.update");
      const payload = parsePayload(name, rawPayload);
      await database.query(
        `
          INSERT INTO clinic_preferences
            (clinic_id, compact_mode, reminders_enabled, updated_by, updated_at)
          VALUES ($1, $2, $3, $4, now())
          ON CONFLICT (clinic_id) DO UPDATE
          SET compact_mode = EXCLUDED.compact_mode,
              reminders_enabled = EXCLUDED.reminders_enabled,
              updated_by = EXCLUDED.updated_by, updated_at = now()
        `,
        [auth.clinicId, payload.compact, payload.reminders, auth.userId],
      );
      await audit(
        database,
        auth,
        requestId,
        "preferences.update",
        "clinic_preferences",
        auth.clinicId,
        ["compact_mode", "reminders_enabled"],
      );
      return { id: auth.clinicId };
    }
    case "team.role.update": {
      hasPermission(auth, "team.update");
      const payload = parsePayload(name, rawPayload);
      if (payload.memberId === auth.membershipId)
        throw new CommandError(
          409,
          "self_role_change",
          "Outro administrador deve alterar sua própria função.",
        );
      const roleResult = await database.query<{ id: string }>(
        `SELECT id FROM roles WHERE clinic_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [auth.clinicId, payload.role],
      );
      const role = roleResult.rows[0];
      if (!role) throw new CommandError(400, "role_not_found", "Função não encontrada.");
      const membership = await database.query(
        `UPDATE clinic_memberships SET role_id = $3, updated_at = now() WHERE clinic_id = $1 AND id = $2`,
        [auth.clinicId, payload.memberId, role.id],
      );
      if (!membership.rowCount) {
        const invite = await database.query(
          `UPDATE clinic_invites SET role_id = $3 WHERE clinic_id = $1 AND id = $2 AND status = 'pending'`,
          [auth.clinicId, payload.memberId, role.id],
        );
        if (!invite.rowCount)
          throw new CommandError(404, "team_member_not_found", "Integrante não encontrado.");
      }
      await audit(database, auth, requestId, "team.role.update", "membership", payload.memberId, [
        "role_id",
      ]);
      return { id: payload.memberId };
    }
    case "team.invite": {
      hasPermission(auth, "team.invite");
      const payload = parsePayload(name, rawPayload);
      const roleResult = await database.query<{ id: string }>(
        `SELECT id FROM roles WHERE clinic_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [auth.clinicId, payload.role],
      );
      const role = roleResult.rows[0];
      if (!role) throw new CommandError(400, "role_not_found", "Função não encontrada.");
      const duplicate = await database.query(
        `
          SELECT memberships.id
          FROM clinic_memberships memberships
          JOIN app_users users ON users.id = memberships.user_id
          WHERE memberships.clinic_id = $1 AND lower(users.email) = lower($2)
          UNION ALL
          SELECT id FROM clinic_invites
          WHERE clinic_id = $1 AND lower(email) = lower($2) AND status = 'pending'
          LIMIT 1
        `,
        [auth.clinicId, payload.email],
      );
      if (duplicate.rows.length)
        throw new CommandError(409, "team_email_exists", "Este e-mail já está na equipe.");
      const id = randomUUID();
      const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
      await database.query(
        `
          INSERT INTO clinic_invites
            (id, clinic_id, email, invitee_name, role_id, token_hash, status,
             expires_at, invited_by, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'pending', now() + interval '7 days', $7, now())
        `,
        [id, auth.clinicId, payload.email, payload.name, role.id, tokenHash, auth.userId],
      );
      await audit(database, auth, requestId, "team.invite", "clinic_invite", id);
      return { id, delivery: "not_configured" };
    }
    case "automation.set": {
      hasPermission(auth, "automations.update");
      const payload = parsePayload(name, rawPayload);
      for (const [index, definition] of automationDefinitions.entries()) {
        const [ruleName, triggerType, actionType] = definition;
        await database.query(
          `
            INSERT INTO automation_rules
              (id, clinic_id, name, trigger_type, conditions, action_type,
               action_config, enabled, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, '{}'::jsonb, $6, $7, now(), now())
            ON CONFLICT (clinic_id, name) DO UPDATE
            SET enabled = CASE WHEN $8 THEN EXCLUDED.enabled ELSE automation_rules.enabled END,
                version = CASE WHEN $8 THEN automation_rules.version + 1 ELSE automation_rules.version END,
                updated_at = CASE WHEN $8 THEN now() ELSE automation_rules.updated_at END
          `,
          [
            randomUUID(),
            auth.clinicId,
            ruleName,
            triggerType,
            actionType,
            index === payload.index ? payload.enabled : false,
            auth.userId,
            index === payload.index,
          ],
        );
      }
      await audit(database, auth, requestId, "automation.set", "automation_rule", null, [
        "enabled",
      ]);
      return { index: payload.index, enabled: payload.enabled };
    }
    case "message.draft": {
      hasPermission(auth, "patients.update");
      const payload = parsePayload(name, rawPayload);
      await assertPatients(database, auth.clinicId, [payload.patientId]);
      const id = randomUUID();
      const contentHash = createHash("sha256").update(payload.message).digest("hex");
      await database.query(
        `
          INSERT INTO message_events
            (id, clinic_id, patient_id, channel, direction, status,
             deduplication_key, payload_redacted, created_at, updated_at)
          VALUES ($1, $2, $3, 'whatsapp', 'outbound', 'draft', $4,
                  $5::jsonb, now(), now())
        `,
        [
          id,
          auth.clinicId,
          payload.patientId,
          idempotencyKey,
          JSON.stringify({ contentHash, length: payload.message.length, externalSending: false }),
        ],
      );
      await interaction(
        database,
        auth,
        payload.patientId,
        "Rascunho de WhatsApp salvo",
        `Rascunho protegido · ${payload.message.length} caracteres · nenhum envio realizado.`,
        "WhatsApp",
      );
      await audit(database, auth, requestId, "message.draft", "message_event", id);
      return { id, status: "draft", sent: false };
    }
  }
}

function payloadIsUpdate(payload: Record<string, unknown>) {
  return typeof payload.id === "string" && payload.id.length > 0;
}

type IdempotencyRow = {
  request_hash: string;
  response_body: unknown;
};

async function commandHandler(request: FastifyRequest, reply: FastifyReply, database: Database) {
  if (!request.auth)
    return reply
      .code(401)
      .send({ error: "authentication_required", message: "Entre novamente para continuar." });
  const parsed = envelopeSchema.safeParse(request.body);
  if (!parsed.success)
    return reply.code(400).send({
      error: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Revise os dados informados.",
    });
  if (!(parsed.data.type in schemas))
    return reply.code(400).send({ error: "unknown_command", message: "Ação não reconhecida." });

  const auth = request.auth;
  const name = parsed.data.type as CommandName;
  const requestHash = createHash("sha256")
    .update(stableStringify({ type: name, payload: parsed.data.payload }))
    .digest("hex");

  try {
    const transactionResult = await database.transaction(async (transaction) => {
      if (database.kind === "postgres")
        await transaction.query(
          `
            SELECT
              set_config('app.user_id', $1, true),
              set_config('app.clinic_id', $2, true),
              set_config('app.membership_id', $3, true),
              set_config('app.request_id', $4, true)
          `,
          [auth.userId, auth.clinicId, auth.membershipId, String(request.id)],
        );
      await transaction.query(
        `
          DELETE FROM api_idempotency_keys
          WHERE clinic_id = $1 AND scope = $2 AND key = $3 AND expires_at <= now()
        `,
        [auth.clinicId, name, parsed.data.idempotencyKey],
      );
      const claimed = await transaction.query<IdempotencyRow>(
        `
          INSERT INTO api_idempotency_keys
            (id, clinic_id, key, scope, request_hash, expires_at, created_at)
          VALUES ($1, $2, $3, $4, $5, now() + interval '24 hours', now())
          ON CONFLICT (clinic_id, scope, key) DO NOTHING
          RETURNING request_hash, response_body
        `,
        [randomUUID(), auth.clinicId, parsed.data.idempotencyKey, name, requestHash],
      );
      if (!claimed.rowCount) {
        const existing = await transaction.query<IdempotencyRow>(
          `
            SELECT request_hash, response_body
            FROM api_idempotency_keys
            WHERE clinic_id = $1 AND scope = $2 AND key = $3
            LIMIT 1
          `,
          [auth.clinicId, name, parsed.data.idempotencyKey],
        );
        const previous = existing.rows[0];
        if (!previous)
          throw new CommandError(409, "command_in_progress", "Esta operação já está em andamento.");
        if (previous.request_hash !== requestHash)
          throw new CommandError(
            409,
            "idempotency_conflict",
            "Esta chave de repetição já foi usada com outros dados.",
          );
        if (previous.response_body) {
          const body =
            typeof previous.response_body === "string"
              ? JSON.parse(previous.response_body)
              : previous.response_body;
          return { replayed: true as const, result: (body as { result: unknown }).result };
        }
        throw new CommandError(409, "command_in_progress", "Esta operação já está em andamento.");
      }
      const result = await executeCommand(
        transaction,
        auth,
        String(request.id),
        name,
        parsed.data.payload,
        parsed.data.idempotencyKey,
      );
      await transaction.query(
        `
          UPDATE api_idempotency_keys
          SET response_status = 200, response_body = $4::jsonb
          WHERE clinic_id = $1 AND scope = $2 AND key = $3
        `,
        [auth.clinicId, name, parsed.data.idempotencyKey, JSON.stringify({ result })],
      );
      return { replayed: false as const, result };
    });
    const data = await getBootstrap(database, auth);
    return reply.send({ result: transactionResult.result, data });
  } catch (error) {
    if (error instanceof CommandError)
      return reply
        .code(error.statusCode)
        .send({ error: error.code, code: error.code, message: error.message });
    request.log.error({ error, command: name }, "command failed");
    return reply.code(500).send({
      error: "command_failed",
      code: "command_failed",
      message: "Não foi possível concluir a operação.",
    });
  }
}

export async function registerCommandRoutes(
  app: FastifyInstance,
  dependencies: { database: Database },
) {
  const { database } = dependencies;
  app.post("/api/commands", { preHandler: requireAuth }, async (request, reply) =>
    commandHandler(request, reply, database),
  );
}
