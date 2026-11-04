import type { FastifyInstance } from "fastify";
import { requireAuth, type AuthContext } from "../auth-context.js";
import type { DatabaseExecutor } from "../database.js";

export const AUTOMATION_RULE_NAMES = [
  "Lembrete de consulta",
  "Confirmação automática",
  "Cobrança automática",
  "Acompanhamento pós-procedimento",
  "Paciente sem retorno",
] as const;

type Role = "Administrador" | "Dentista" | "Secretária" | "Recepção" | "Financeiro";

type Patient = {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  since: string;
  tags: string[];
  notes: string;
};

type Treatment = {
  id: string;
  patientId: string;
  name: string;
  professional: string;
  total: number;
  status: string;
  priority: string;
  steps: { name: string; date: string; done: boolean }[];
};

type Appointment = {
  id: string;
  patientId: string;
  treatmentId?: string;
  procedure: string;
  date: string;
  time: string;
  duration: number;
  professional: string;
  room: string;
  status: string;
};

type Quote = {
  id: string;
  patientId: string;
  procedure: string;
  value: number;
  discount: number;
  validity: string;
  status: string;
  sent?: string;
  approved?: string;
  treatmentId?: string;
};

type Charge = {
  id: string;
  patientId: string;
  treatmentId: string;
  title: string;
  value: number;
  due: string;
  paid?: string;
  method?: string;
  automatic: boolean;
};

type Interaction = {
  id: string;
  patientId: string;
  date: string;
  title: string;
  text: string;
  kind: string;
};

export type BootstrapData = {
  patients: Patient[];
  treatments: Treatment[];
  appointments: Appointment[];
  quotes: Quote[];
  charges: Charge[];
  interactions: Interaction[];
  automations: boolean[];
  clinic: string;
  clinicPhone: string;
  clinicCity: string;
  account: { name: string; email: string };
  team: { id: string; name: string; email: string; role: Role; status: string }[];
  preferences: { compact: boolean; reminders: boolean };
};

type ClinicRow = {
  display_name: string;
  phone_e164: string | null;
  city: string | null;
  state_code: string | null;
  compact_mode: boolean | null;
  reminders_enabled: boolean | null;
  account_name: string;
  account_email: string;
};

type PatientRow = {
  id: string;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
  city: string | null;
  since: string;
  tags: string[];
  notes: string | null;
};

type TreatmentRow = {
  id: string;
  patient_id: string;
  name: string;
  professional: string;
  contracted_amount: string | number;
  status: string;
  priority: string;
};

type StepRow = {
  treatment_id: string;
  name: string;
  due_date: string | null;
  status: string;
};

type AppointmentRow = {
  id: string;
  patient_id: string;
  treatment_id: string | null;
  procedure_name: string;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: string | number;
  professional: string;
  room: string | null;
  status: string;
};

type QuoteRow = {
  id: string;
  patient_id: string;
  procedure: string;
  total_amount: string | number;
  discount_amount: string | number;
  valid_until: string | null;
  status: string;
  sent_at: string | null;
  approved_at: string | null;
  treatment_id: string | null;
};

type ChargeRow = {
  id: string;
  patient_id: string;
  treatment_id: string | null;
  description: string;
  installment_no: string | number;
  amount: string | number;
  outstanding_amount: string | number;
  due_date: string;
  paid_at: string | null;
  method: string | null;
  automatic_reminder: boolean;
};

type InteractionRow = {
  id: string;
  patient_id: string;
  occurred_at: string;
  subject: string;
  body: string | null;
  kind: string;
};

type TeamRow = {
  id: string;
  name: string;
  email: string;
  role_code: string;
  status: string;
};

type InviteRow = {
  id: string;
  name: string;
  email: string;
  role_code: string;
  status: string;
};

type AutomationRow = { name: string; enabled: boolean };

const appointmentStatuses: Record<string, string> = {
  scheduled: "Agendado",
  awaiting_confirmation: "Aguardando confirmação",
  confirmed: "Confirmado",
  checked_in: "Em espera",
  in_progress: "Em atendimento",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Faltou",
};

const treatmentStatuses: Record<string, string> = {
  planning: "Planejamento",
  awaiting_approval: "Aguardando aprovação",
  awaiting_payment: "Aguardando pagamento",
  scheduled: "Agendado",
  in_progress: "Em andamento",
  paused: "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const priorities: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

const quoteStatuses: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  viewed: "Visualizado",
  approved: "Aprovado",
  rejected: "Recusado",
  expired: "Expirado",
  cancelled: "Cancelado",
};

const roleLabels: Record<string, Role> = {
  administrador: "Administrador",
  dentista: "Dentista",
  secretaria: "Secretária",
  recepcao: "Recepção",
  financeiro: "Financeiro",
};

function numberValue(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayPhone(phone: string | null) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length === 13)
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.startsWith("55") && digits.length === 12)
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return phone;
}

function roleLabel(code: string): Role {
  return roleLabels[code] ?? "Recepção";
}

function hasPermission(auth: AuthContext, permission: string) {
  return auth.permissions.includes(permission);
}

export async function getBootstrap(
  database: DatabaseExecutor,
  auth: AuthContext,
): Promise<BootstrapData> {
  const canReadPatients = hasPermission(auth, "patients.read");
  const canReadAppointments = hasPermission(auth, "appointments.read");
  const canReadTreatments = hasPermission(auth, "treatments.read");
  const canReadClinical = hasPermission(auth, "treatments.clinical.read");
  const canReadQuotes = hasPermission(auth, "quotes.read");
  const canReadFinancial = hasPermission(auth, "finance.details.read");
  const canReadTeam = hasPermission(auth, "team.read");
  const canReadAutomations = hasPermission(auth, "automations.read");

  const clinicResult = await database.query<ClinicRow>(
    `
      SELECT
        c.display_name,
        c.phone_e164,
        c.city,
        c.state_code,
        cp.compact_mode,
        cp.reminders_enabled,
        u.full_name AS account_name,
        u.email AS account_email
      FROM clinics c
      LEFT JOIN clinic_preferences cp ON cp.clinic_id = c.id
      JOIN app_users u ON u.id = $2
      WHERE c.id = $1
      LIMIT 1
    `,
    [auth.clinicId, auth.userId],
  );

  const [
    patientResult,
    treatmentResult,
    stepResult,
    appointmentResult,
    quoteResult,
    chargeResult,
    interactionResult,
    teamResult,
    inviteResult,
    automationResult,
  ] = await Promise.all([
    canReadPatients
      ? database.query<PatientRow>(
          `
            SELECT
              p.id,
              p.full_name,
              p.phone_e164,
              p.email,
              p.city,
              to_char(p.created_at AT TIME ZONE c.timezone, 'YYYY-MM-DD') AS since,
              COALESCE(
                array_agg(t.name ORDER BY lower(t.name))
                  FILTER (WHERE t.id IS NOT NULL),
                ARRAY[]::text[]
              ) AS tags,
              p.notes
            FROM patients p
            JOIN clinics c ON c.id = p.clinic_id
            LEFT JOIN patient_tags pt
              ON pt.clinic_id = p.clinic_id AND pt.patient_id = p.id
            LEFT JOIN tags t
              ON t.clinic_id = pt.clinic_id AND t.id = pt.tag_id
            WHERE p.clinic_id = $1
              AND p.active = true
              AND p.deleted_at IS NULL
            GROUP BY p.id, p.full_name, p.phone_e164, p.email, p.city,
              p.created_at, c.timezone, p.notes
            ORDER BY lower(p.full_name), p.id
          `,
          [auth.clinicId],
        )
      : Promise.resolve({ rows: [] as PatientRow[], rowCount: 0 }),
    canReadTreatments
      ? database.query<TreatmentRow>(
          `
            SELECT
              t.id,
              t.patient_id,
              t.name,
              p.full_name AS professional,
              t.contracted_amount,
              t.status,
              t.priority
            FROM treatments t
            JOIN professionals p
              ON p.clinic_id = t.clinic_id AND p.id = t.professional_id
            WHERE t.clinic_id = $1 AND t.deleted_at IS NULL
            ORDER BY t.created_at DESC, t.id
          `,
          [auth.clinicId],
        )
      : Promise.resolve({ rows: [] as TreatmentRow[], rowCount: 0 }),
    canReadTreatments
      ? database.query<StepRow>(
          `
            SELECT ts.treatment_id, ts.name, ts.due_date::text, ts.status
            FROM treatment_steps ts
            JOIN treatments t
              ON t.clinic_id = ts.clinic_id AND t.id = ts.treatment_id
            WHERE ts.clinic_id = $1 AND t.deleted_at IS NULL
            ORDER BY ts.treatment_id, ts.sequence_no
          `,
          [auth.clinicId],
        )
      : Promise.resolve({ rows: [] as StepRow[], rowCount: 0 }),
    canReadAppointments
      ? database.query<AppointmentRow>(
          `
            SELECT
              a.id,
              a.patient_id,
              a.treatment_id,
              a.procedure_name,
              to_char(a.starts_at AT TIME ZONE c.timezone, 'YYYY-MM-DD') AS appointment_date,
              to_char(a.starts_at AT TIME ZONE c.timezone, 'HH24:MI') AS appointment_time,
              round(extract(epoch FROM (a.ends_at - a.starts_at)) / 60)::integer
                AS duration_minutes,
              p.full_name AS professional,
              r.name AS room,
              a.status
            FROM appointments a
            JOIN clinics c ON c.id = a.clinic_id
            JOIN professionals p
              ON p.clinic_id = a.clinic_id AND p.id = a.professional_id
            LEFT JOIN clinic_resources r
              ON r.clinic_id = a.clinic_id AND r.id = a.resource_id
            WHERE a.clinic_id = $1 AND a.deleted_at IS NULL
            ORDER BY a.starts_at, a.id
          `,
          [auth.clinicId],
        )
      : Promise.resolve({ rows: [] as AppointmentRow[], rowCount: 0 }),
    canReadQuotes
      ? database.query<QuoteRow>(
          `
            SELECT
              q.id,
              q.patient_id,
              COALESCE(
                (SELECT qi.description
                 FROM quote_items qi
                 WHERE qi.clinic_id = q.clinic_id AND qi.quote_id = q.id
                 ORDER BY qi.sequence_no
                 LIMIT 1),
                'Orçamento'
              ) AS procedure,
              q.subtotal AS total_amount,
              q.discount_amount,
              q.valid_until::text,
              q.status,
              CASE WHEN q.sent_at IS NULL THEN NULL
                ELSE to_char(q.sent_at AT TIME ZONE c.timezone, 'YYYY-MM-DD') END AS sent_at,
              CASE WHEN q.approved_at IS NULL THEN NULL
                ELSE to_char(q.approved_at AT TIME ZONE c.timezone, 'YYYY-MM-DD') END AS approved_at,
              t.id AS treatment_id
            FROM quotes q
            JOIN clinics c ON c.id = q.clinic_id
            LEFT JOIN treatments t
              ON t.clinic_id = q.clinic_id
             AND t.source_quote_id = q.id
             AND t.deleted_at IS NULL
            WHERE q.clinic_id = $1
            ORDER BY q.created_at DESC, q.id
          `,
          [auth.clinicId],
        )
      : Promise.resolve({ rows: [] as QuoteRow[], rowCount: 0 }),
    canReadFinancial
      ? database.query<ChargeRow>(
          `
            SELECT
              i.id,
              r.patient_id,
              r.treatment_id,
              r.description,
              i.installment_no,
              i.amount,
              b.outstanding_amount,
              i.due_date::text,
              CASE WHEN b.outstanding_amount <= 0 THEN (
                SELECT to_char(p.paid_at AT TIME ZONE c.timezone, 'YYYY-MM-DD')
                FROM payment_allocations pa
                JOIN payments p
                  ON p.clinic_id = pa.clinic_id AND p.id = pa.payment_id
                WHERE pa.clinic_id = i.clinic_id
                  AND pa.installment_id = i.id
                  AND p.status = 'posted'
                ORDER BY p.paid_at DESC, p.id DESC
                LIMIT 1
              ) ELSE NULL END AS paid_at,
              CASE WHEN b.outstanding_amount <= 0 THEN (
                SELECT p.method
                FROM payment_allocations pa
                JOIN payments p
                  ON p.clinic_id = pa.clinic_id AND p.id = pa.payment_id
                WHERE pa.clinic_id = i.clinic_id
                  AND pa.installment_id = i.id
                  AND p.status = 'posted'
                ORDER BY p.paid_at DESC, p.id DESC
                LIMIT 1
              ) ELSE NULL END AS method,
              i.automatic_reminder
            FROM installments i
            JOIN installment_balances b
              ON b.clinic_id = i.clinic_id AND b.installment_id = i.id
            JOIN receivables r
              ON r.clinic_id = i.clinic_id AND r.id = i.receivable_id
            JOIN clinics c ON c.id = i.clinic_id
            WHERE i.clinic_id = $1
              AND i.cancelled_at IS NULL
              AND r.status <> 'cancelled'
            ORDER BY i.due_date, i.installment_no, i.id
          `,
          [auth.clinicId],
        )
      : Promise.resolve({ rows: [] as ChargeRow[], rowCount: 0 }),
    canReadPatients
      ? database.query<InteractionRow>(
          `
            SELECT
              pi.id,
              pi.patient_id,
              to_char(pi.occurred_at AT TIME ZONE c.timezone, 'YYYY-MM-DD"T"HH24:MI')
                AS occurred_at,
              pi.subject,
              pi.body,
              pi.kind
            FROM patient_interactions pi
            JOIN clinics c ON c.id = pi.clinic_id
            WHERE pi.clinic_id = $1
              AND ($2::boolean OR pi.sensitivity <> 'clinical')
              AND ($3::boolean OR pi.sensitivity <> 'financial')
            ORDER BY pi.occurred_at DESC, pi.id DESC
          `,
          [auth.clinicId, canReadClinical, canReadFinancial],
        )
      : Promise.resolve({ rows: [] as InteractionRow[], rowCount: 0 }),
    database.query<TeamRow>(
      `
        SELECT
          m.id,
          u.full_name AS name,
          u.email,
          r.code AS role_code,
          m.status
        FROM clinic_memberships m
        JOIN app_users u ON u.id = m.user_id
        JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
        WHERE m.clinic_id = $1
          AND ($2::boolean OR m.id = $3)
        ORDER BY CASE WHEN m.id = $3 THEN 0 ELSE 1 END, lower(u.full_name), m.id
      `,
      [auth.clinicId, canReadTeam, auth.membershipId],
    ),
    canReadTeam
      ? database.query<InviteRow>(
          `
            SELECT
              i.id,
              i.invitee_name AS name,
              i.email,
              r.code AS role_code,
              i.status
            FROM clinic_invites i
            JOIN roles r ON r.clinic_id = i.clinic_id AND r.id = i.role_id
            WHERE i.clinic_id = $1 AND i.status = 'pending'
            ORDER BY i.created_at DESC, i.id
          `,
          [auth.clinicId],
        )
      : Promise.resolve({ rows: [] as InviteRow[], rowCount: 0 }),
    canReadAutomations
      ? database.query<AutomationRow>(
          `SELECT name, enabled FROM automation_rules WHERE clinic_id = $1`,
          [auth.clinicId],
        )
      : Promise.resolve({ rows: [] as AutomationRow[], rowCount: 0 }),
  ]);

  const clinic = clinicResult.rows[0];
  if (!clinic) throw new Error("Clínica da sessão não encontrada.");

  const stepsByTreatment = new Map<string, Treatment["steps"]>();
  for (const row of stepResult.rows) {
    const steps = stepsByTreatment.get(row.treatment_id) ?? [];
    steps.push({
      name: row.name,
      date: row.due_date ?? "",
      done: row.status === "completed",
    });
    stepsByTreatment.set(row.treatment_id, steps);
  }

  const patients: Patient[] = patientResult.rows.map((row) => ({
    id: row.id,
    name: row.full_name,
    phone: displayPhone(row.phone_e164),
    email: row.email ?? "",
    city: row.city ?? "",
    since: row.since,
    tags: row.tags,
    notes: row.notes ?? "",
  }));

  const treatments: Treatment[] = treatmentResult.rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    name: row.name,
    professional: row.professional,
    total: canReadFinancial ? numberValue(row.contracted_amount) : 0,
    status: treatmentStatuses[row.status] ?? row.status,
    priority: priorities[row.priority] ?? row.priority,
    steps: stepsByTreatment.get(row.id) ?? [],
  }));

  const appointments: Appointment[] = appointmentResult.rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    ...(row.treatment_id ? { treatmentId: row.treatment_id } : {}),
    procedure: row.procedure_name,
    date: row.appointment_date,
    time: row.appointment_time,
    duration: numberValue(row.duration_minutes),
    professional: row.professional,
    room: row.room ?? "Sem sala",
    status: appointmentStatuses[row.status] ?? row.status,
  }));

  const quotes: Quote[] = quoteResult.rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    procedure: row.procedure,
    value: numberValue(row.total_amount),
    discount: numberValue(row.discount_amount),
    validity: row.valid_until ?? "",
    status: quoteStatuses[row.status] ?? row.status,
    ...(row.sent_at ? { sent: row.sent_at } : {}),
    ...(row.approved_at ? { approved: row.approved_at } : {}),
    ...(row.treatment_id ? { treatmentId: row.treatment_id } : {}),
  }));

  const charges: Charge[] = chargeResult.rows.map((row) => {
    const paid = numberValue(row.outstanding_amount) <= 0;
    return {
      id: row.id,
      patientId: row.patient_id,
      treatmentId: row.treatment_id ?? "",
      title: `${row.description} · Parcela ${row.installment_no}`,
      value: paid ? numberValue(row.amount) : numberValue(row.outstanding_amount),
      due: row.due_date,
      ...(row.paid_at ? { paid: row.paid_at } : {}),
      ...(row.method ? { method: row.method } : {}),
      automatic: row.automatic_reminder,
    };
  });

  const interactions: Interaction[] = interactionResult.rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    date: row.occurred_at,
    title: row.subject,
    text: row.body ?? "",
    kind: row.kind,
  }));

  const memberStatus: Record<string, string> = {
    active: "Ativo",
    invited: "Convite pendente",
    disabled: "Inativo",
  };
  const team = [
    ...teamResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: roleLabel(row.role_code),
      status: memberStatus[row.status] ?? row.status,
    })),
    ...inviteResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: roleLabel(row.role_code),
      status: "Convite pendente",
    })),
  ];

  const automationMap = new Map(
    automationResult.rows.map((row) => [row.name, row.enabled] as const),
  );
  const clinicCity = [clinic.city, clinic.state_code].filter(Boolean).join(" - ");

  return {
    patients,
    treatments,
    appointments,
    quotes,
    charges,
    interactions,
    automations: AUTOMATION_RULE_NAMES.map((name) => automationMap.get(name) ?? false),
    clinic: clinic.display_name,
    clinicPhone: displayPhone(clinic.phone_e164),
    clinicCity,
    account: { name: clinic.account_name, email: clinic.account_email },
    team,
    preferences: {
      compact: clinic.compact_mode ?? false,
      reminders: clinic.reminders_enabled ?? true,
    },
  };
}

export async function registerBootstrapRoutes(
  app: FastifyInstance,
  dependencies: { database: DatabaseExecutor },
) {
  app.get("/api/bootstrap", { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply;
    return { data: await getBootstrap(dependencies.database, request.auth) };
  });
}
