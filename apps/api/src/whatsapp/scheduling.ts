import { createHash, randomBytes } from "node:crypto";
import {
  appointmentConflicts,
  appointmentWithinHours,
  lockAppointmentPatient,
} from "../appointments.js";
import type { Database, DatabaseExecutor } from "../database.js";
import { extractBookingWithAi } from "./booking-ai.js";
import {
  foldBookingText,
  localBookingDate,
  minimizeBookingText,
  parseBookingDate,
  parseBookingMessage,
  parseBookingTime,
  verifiedServiceQuote,
  type BookingServiceTerms,
} from "./booking-parser.js";

export type WhatsAppSchedulingContext = {
  database: Database;
  clinicId: string;
  conversationId: string;
  patientId: string | null;
  from: string;
  messageId: string;
  text: string;
  occurredAt: Date;
  sendText: (text: string, idempotencyKey: string) => Promise<void>;
};

type BookingSettings = {
  timezone: string;
  user_id: string;
  membership_id: string;
  working_days: number[];
  opens_at: string;
  closes_at: string;
};

type BookingService = BookingServiceTerms & {
  duration_minutes: number;
  professional_id: string;
  resource_id: string;
  location_id: string;
  location_name: string;
};

type PendingSelection = {
  patientId: string | null;
  serviceId: string | null;
  date: string | null;
  time: string | null;
};

type PendingBooking = PendingSelection & {
  code: string | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
  fingerprint: string | null;
  lastInputAt: Date;
};

type Proposal = {
  code: string;
  issuedAt: Date;
  expiresAt: Date;
  fingerprint: string;
};

type Slot = {
  patientId: string;
  date: string;
  time: string;
  service: BookingService;
};

type AiHints = Awaited<ReturnType<typeof extractBookingWithAi>>;
type Turn = Pick<
  WhatsAppSchedulingContext,
  "clinicId" | "conversationId" | "patientId" | "from" | "messageId" | "text" | "occurredAt"
>;

const hourMs = 3_600_000;
const bookingHandoff =
  "A equipe precisa conferir seu cadastro ou pedido. Aguarde o atendimento por aqui.";
const unavailable = "Esse horário não está disponível. Envie outra data e horário, por favor.";
const confirmExactly =
  "Para confirmar, copie a instrução CONFIRMAR com o código da última proposta.";
const expired = "A proposta expirou ou mudou. Para continuar, envie a data e o horário desejados.";

async function getSettings(database: DatabaseExecutor, clinicId: string) {
  const { rows } = await database.query<BookingSettings>(
    `
      SELECT c.timezone, m.user_id, m.id AS membership_id, s.working_days,
             left(s.opens_at::text, 5) AS opens_at,
             left(s.closes_at::text, 5) AS closes_at
      FROM whatsapp_booking_settings s
      JOIN clinics c ON c.id = s.clinic_id
      JOIN clinic_memberships m ON m.clinic_id = s.clinic_id AND m.id = s.actor_membership_id
      JOIN app_users u ON u.id = m.user_id
      JOIN role_permissions rp ON rp.clinic_id = m.clinic_id AND rp.role_id = m.role_id
        AND rp.permission_code = 'appointments.create'
      WHERE s.clinic_id = $1 AND s.enabled AND m.status = 'active' AND u.status = 'active'
        AND c.status = 'active' AND c.deleted_at IS NULL
    `,
    [clinicId],
  );
  return rows[0];
}

async function getServices(database: DatabaseExecutor, clinicId: string) {
  const { rows } = await database.query<BookingService>(
    `
      SELECT s.id, s.name, s.aliases, s.duration_minutes, s.professional_id, s.resource_id,
             l.id AS location_id, l.name AS location_name
      FROM whatsapp_booking_services s
      JOIN professionals p ON p.clinic_id = s.clinic_id AND p.id = s.professional_id
      JOIN clinic_resources r ON r.clinic_id = s.clinic_id AND r.id = s.resource_id
      JOIN clinic_locations l ON l.clinic_id = r.clinic_id AND l.id = r.location_id
      WHERE s.clinic_id = $1 AND s.active AND p.active AND r.active AND l.active
      ORDER BY s.name, s.id
    `,
    [clinicId],
  );
  return rows;
}

async function getState(database: DatabaseExecutor, turn: Turn) {
  const { rows } = await database.query<PendingBooking>(
    `
      SELECT patient_id AS "patientId", service_id AS "serviceId",
             to_char(desired_date::timestamp, 'YYYY-MM-DD') AS date,
             left(desired_time::text, 5) AS time,
             proposal_code AS code, proposal_issued_at AS "issuedAt",
             proposal_expires_at AS "expiresAt", proposal_snapshot ->> 'fingerprint' AS fingerprint,
             last_input_at AS "lastInputAt"
      FROM whatsapp_booking_state
      WHERE clinic_id = $1 AND conversation_id = $2
    `,
    [turn.clinicId, turn.conversationId],
  );
  return rows[0];
}

async function saveState(
  database: DatabaseExecutor,
  turn: Turn,
  pending: PendingSelection | null,
  proposal?: Proposal,
) {
  await database.query(
    `
      INSERT INTO whatsapp_booking_state (
        clinic_id, conversation_id, patient_id, service_id, desired_date, desired_time,
        proposal_code, proposal_issued_at, proposal_expires_at, proposal_snapshot, last_input_at
      ) VALUES ($1, $2, $3, $4, $5::date, $6::time, $7, $8, $9, $10::jsonb, $11)
      ON CONFLICT (clinic_id, conversation_id) DO UPDATE SET
        patient_id = EXCLUDED.patient_id, service_id = EXCLUDED.service_id,
        desired_date = EXCLUDED.desired_date, desired_time = EXCLUDED.desired_time,
        proposal_code = EXCLUDED.proposal_code, proposal_issued_at = EXCLUDED.proposal_issued_at,
        proposal_expires_at = EXCLUDED.proposal_expires_at, proposal_snapshot = EXCLUDED.proposal_snapshot,
        last_input_at = EXCLUDED.last_input_at
    `,
    [
      turn.clinicId,
      turn.conversationId,
      pending?.patientId ?? null,
      pending?.serviceId ?? null,
      pending?.date ?? null,
      pending?.time ?? null,
      proposal?.code ?? null,
      proposal?.issuedAt ?? null,
      proposal?.expiresAt ?? null,
      proposal ? JSON.stringify({ fingerprint: proposal.fingerprint }) : null,
      turn.occurredAt,
    ],
  );
}

async function verifyPatient(database: DatabaseExecutor, turn: Turn, name: string | null) {
  if (!turn.patientId || !/^\+?[1-9][0-9]{7,14}$/.test(turn.from)) return null;
  await lockAppointmentPatient(database, turn.clinicId, turn.patientId);
  const { rows } = await database.query<{
    id: string;
    full_name: string;
    preferred_name: string | null;
  }>(
    `
      SELECT id, full_name, preferred_name FROM patients
      WHERE clinic_id = $1 AND phone_e164 = $2 AND active AND deleted_at IS NULL
      LIMIT 2
    `,
    [turn.clinicId, "+" + turn.from.replace(/^\+/, "")],
  );
  const matched = rows.length === 1 && rows[0]?.id === turn.patientId ? rows[0] : null;
  if (!matched || !name) return matched?.id ?? null;
  const normalizedName = name.replace(/\s+/g, " ");
  const sameName = [matched.full_name, matched.preferred_name].some((value) => {
    const normalized = foldBookingText(value ?? "").replace(/\s+/g, " ");
    return normalized === normalizedName || normalized.split(" ")[0] === normalizedName;
  });
  return sameName ? matched.id : null;
}

function slotFingerprint(slot: Slot, settings: BookingSettings) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        slot.patientId,
        slot.date,
        slot.time,
        slot.service.id,
        slot.service.name,
        slot.service.professional_id,
        slot.service.resource_id,
        slot.service.duration_minutes,
        slot.service.location_id,
        slot.service.location_name,
        settings.timezone,
      ]),
    )
    .digest("hex");
}

async function availableSlot(
  database: DatabaseExecutor,
  clinicId: string,
  settings: BookingSettings,
  slot: Slot,
) {
  const isoDay = new Date(slot.date + "T00:00:00Z").getUTCDay() || 7;
  if (
    !settings.working_days.includes(isoDay) ||
    !appointmentWithinHours(
      slot.time,
      slot.service.duration_minutes,
      settings.opens_at,
      settings.closes_at,
    )
  )
    return null;
  const { rows } = await database.query<{ starts_at: Date; ends_at: Date }>(
    `
      SELECT wall_start AT TIME ZONE $1 AS starts_at, wall_end AT TIME ZONE $1 AS ends_at
      FROM (
        SELECT $2::date + $3::time AS wall_start,
               $2::date + $3::time + make_interval(mins => $4) AS wall_end
      ) AS local_time
      WHERE wall_start AT TIME ZONE $1 > now()
        AND (wall_start AT TIME ZONE $1) AT TIME ZONE $1 = wall_start
        AND (wall_end AT TIME ZONE $1) AT TIME ZONE $1 = wall_end
        AND (wall_end AT TIME ZONE $1) - (wall_start AT TIME ZONE $1) = make_interval(mins => $4)
    `,
    [settings.timezone, slot.date, slot.time, slot.service.duration_minutes],
  );
  if (
    !rows[0] ||
    (await appointmentConflicts(database, clinicId, {
      patientId: slot.patientId,
      professionalId: slot.service.professional_id,
      resourceId: slot.service.resource_id,
      date: slot.date,
      time: slot.time,
      duration: slot.service.duration_minutes,
    }))
  )
    return null;
  return rows[0];
}

async function createAppointment(
  database: DatabaseExecutor,
  databaseKind: Database["kind"],
  turn: Turn,
  settings: BookingSettings,
  slot: Slot,
  times: { starts_at: Date; ends_at: Date },
) {
  if (databaseKind === "postgres") {
    await database.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true),
              set_config('app.membership_id', $3, true), set_config('app.request_id', $4, true)`,
      [settings.user_id, turn.clinicId, settings.membership_id, turn.messageId],
    );
  }
  const { rows } = await database.query<{ id: string }>(
    `
      INSERT INTO appointments (
        clinic_id, patient_id, professional_id, location_id, resource_id, procedure_name,
        starts_at, ends_at, status, source, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'whatsapp', $9)
      RETURNING id
    `,
    [
      turn.clinicId,
      slot.patientId,
      slot.service.professional_id,
      slot.service.location_id,
      slot.service.resource_id,
      slot.service.name,
      times.starts_at,
      times.ends_at,
      settings.user_id,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("WhatsApp booking insertion returned no appointment.");
  await database.query(
    `INSERT INTO appointment_status_history (clinic_id, appointment_id, to_status, reason, changed_by)
      VALUES ($1, $2, 'confirmed', 'Confirmada pelo paciente via WhatsApp', $3)`,
    [turn.clinicId, id, settings.user_id],
  );
  await database.query(
    `INSERT INTO patient_interactions (
        clinic_id, patient_id, appointment_id, kind, channel, subject, created_by
      ) VALUES ($1, $2, $3, 'WhatsApp', 'whatsapp', 'Agendamento confirmado pelo WhatsApp', $4)`,
    [turn.clinicId, slot.patientId, id, settings.user_id],
  );
  await database.query(
    `INSERT INTO audit_logs (
        clinic_id, actor_user_id, actor_membership_id, action, entity_type, entity_id, request_id
      ) VALUES ($1, $2, $3, 'appointment.create.whatsapp', 'appointment', $4, $5)`,
    [turn.clinicId, settings.user_id, settings.membership_id, id, turn.messageId],
  );
}

function slotSummary(slot: Slot) {
  const date = slot.date.split("-").reverse().join("/");
  return (
    slot.service.name +
    " em " +
    date +
    " às " +
    slot.time +
    " (" +
    slot.service.duration_minutes +
    " min) — " +
    slot.service.location_name +
    "."
  );
}

function verifiedTimeOrDate(
  quote: string | null,
  original: string,
  localDate: string,
  field: "date" | "time",
) {
  const term = foldBookingText(quote ?? "");
  if (!term || !original.includes(term)) return null;
  return (field === "date" ? parseBookingDate(term, localDate) : parseBookingTime(term)).value;
}

async function decideReply(
  database: DatabaseExecutor,
  kind: Database["kind"],
  turn: Turn,
  settings: BookingSettings,
  services: BookingService[],
  hints: AiHints,
  now: Date,
): Promise<string | null> {
  const previous = await getState(database, turn);
  const lastInput = previous?.lastInputAt;
  if (lastInput && new Date(lastInput).getTime() > turn.occurredAt.getTime()) return null;
  const active =
    previous?.patientId && lastInput && now.getTime() - new Date(lastInput).getTime() < 24 * hourMs
      ? previous
      : undefined;
  const referenceDate = localBookingDate(turn.occurredAt, settings.timezone);
  const parsed = parseBookingMessage(turn.text, referenceDate, services);

  if (parsed.stop || parsed.handoff) {
    if (active) await saveState(database, turn, null);
    return active || parsed.asksToBook ? bookingHandoff : null;
  }
  if (!(active || parsed.asksToBook || parsed.confirmation || hints?.intent)) return null;
  if (!services.length) return null;

  const patientId = await verifyPatient(database, turn, parsed.name);
  if (!patientId) {
    await saveState(database, turn, null);
    return bookingHandoff;
  }
  const pending = active?.patientId === patientId ? active : undefined;
  const previousCode = pending?.code;
  const priorProposalValid = !!(
    previousCode &&
    pending.issuedAt &&
    pending.expiresAt &&
    turn.occurredAt.getTime() >= new Date(pending.issuedAt).getTime() &&
    now.getTime() < new Date(pending.expiresAt).getTime()
  );
  if (parsed.confirmation) {
    const service = services.find(({ id }) => id === pending?.serviceId);
    if (
      !pending ||
      !previousCode ||
      !priorProposalValid ||
      !service ||
      !pending.date ||
      !pending.time
    ) {
      await saveState(database, turn, {
        patientId,
        serviceId: service?.id ?? null,
        date: null,
        time: null,
      });
      return expired;
    }
    if (previousCode !== parsed.confirmation) return confirmExactly;
    const slot: Slot = { patientId, service, date: pending.date, time: pending.time };
    if (slotFingerprint(slot, settings) !== pending.fingerprint) {
      await saveState(database, turn, { patientId, serviceId: service.id, date: null, time: null });
      return expired;
    }
    const times = await availableSlot(database, turn.clinicId, settings, slot);
    if (!times) {
      await saveState(database, turn, { patientId, serviceId: service.id, date: null, time: null });
      return unavailable;
    }
    await createAppointment(database, kind, turn, settings, slot, times);
    await saveState(database, turn, null);
    return "Agendamento confirmado: " + slotSummary(slot);
  }

  const aiService =
    !parsed.service.attempted && hints
      ? verifiedServiceQuote(hints.serviceQuote, parsed.text, services)
      : null;
  const aiDate =
    !parsed.date.attempted && hints
      ? verifiedTimeOrDate(hints.dateQuote, parsed.text, referenceDate, "date")
      : null;
  const aiTime =
    !parsed.time.attempted && hints
      ? verifiedTimeOrDate(hints.timeQuote, parsed.text, referenceDate, "time")
      : null;

  if (
    priorProposalValid &&
    !(
      parsed.service.attempted ||
      parsed.date.attempted ||
      parsed.time.attempted ||
      aiService ||
      aiDate ||
      aiTime
    )
  )
    return confirmExactly;

  const expiredProposal = !!previousCode && !priorProposalValid;
  const serviceId = parsed.service.attempted
    ? parsed.service.value
    : (aiService ?? pending?.serviceId ?? null);
  const service = services.find(({ id }) => id === serviceId);
  const date = parsed.date.attempted
    ? parsed.date.value
    : (aiDate ?? (!expiredProposal ? pending?.date : null) ?? null);
  const time = parsed.time.attempted
    ? parsed.time.value
    : (aiTime ?? (!expiredProposal ? pending?.time : null) ?? null);
  const selection = { patientId, serviceId: service?.id ?? null, date, time };
  if (!service || !date || !time) {
    await saveState(database, turn, selection);
    const missing = [
      !service && "o procedimento",
      !date && "a data (DD/MM/AAAA)",
      !time && "o horário (HH:MM)",
    ]
      .filter(Boolean)
      .join(", ");
    const choices = !service
      ? " Procedimentos disponíveis para agendar por aqui: " +
        services
          .slice(0, 5)
          .map(({ name }) => name)
          .join(", ") +
        "."
      : "";
    return "Para consultar a agenda, informe " + missing + "." + choices;
  }

  const slot = { patientId, date, time, service };
  const times = await availableSlot(database, turn.clinicId, settings, slot);
  if (!times) {
    await saveState(database, turn, { ...selection, date: null, time: null });
    return unavailable;
  }
  const code = randomBytes(4).toString("hex");
  const issuedAt = new Date(Math.floor(now.getTime() / 1_000) * 1_000);
  const expiresAt = new Date(
    Math.min(now.getTime() + 15 * 60_000, new Date(times.starts_at).getTime()),
  );
  await saveState(database, turn, selection, {
    code,
    issuedAt,
    expiresAt,
    fingerprint: slotFingerprint(slot, settings),
  });
  return (
    "Horário disponível: " +
    slotSummary(slot) +
    " Para confirmar em até 15 minutos, responda exatamente CONFIRMAR " +
    code.toUpperCase() +
    "."
  );
}

async function readReceipt(database: DatabaseExecutor, turn: Turn) {
  const { rows } = await database.query<{ reply_text: string | null }>(
    "SELECT reply_text FROM whatsapp_booking_receipts WHERE clinic_id = $1 AND message_id = $2",
    [turn.clinicId, turn.messageId],
  );
  return rows[0];
}

async function getAiHints(database: DatabaseExecutor, turn: Turn): Promise<AiHints> {
  if (!turn.patientId || process.env.WHATSAPP_BOOKING_OPENAI_ENABLED !== "true") return null;
  const settings = await getSettings(database, turn.clinicId);
  if (!settings) return null;
  const services = await getServices(database, turn.clinicId);
  if (!services.length) return null;
  const localDate = localBookingDate(turn.occurredAt, settings.timezone);
  const parsed = parseBookingMessage(turn.text, localDate, services);
  if (parsed.stop || parsed.handoff || parsed.confirmation) return null;
  if (
    !(
      parsed.asksToBook ||
      parsed.service.attempted ||
      parsed.date.attempted ||
      parsed.time.attempted
    )
  )
    return null;
  const text = minimizeBookingText(turn.text, services);
  if (!text) return null;
  return extractBookingWithAi({ text, localDate, timeZone: settings.timezone, services }).catch(
    () => null,
  );
}

export async function processWhatsAppScheduling(context: WhatsAppSchedulingContext): Promise<void> {
  const { database, sendText, ...turn } = context;
  const now = new Date();
  const age = now.getTime() - turn.occurredAt.getTime();
  if (!Number.isFinite(age) || age >= 24 * hourMs || age < -5 * 60_000) return;
  const receipt = await readReceipt(database, turn);
  const hints = receipt ? null : await getAiHints(database, turn);
  const process = () =>
    database.transaction(async (transaction) => {
      // The conversation lock serializes booking state transitions and duplicate
      // webhooks while the external provider call runs only after commit.
      const conversation = await transaction.query(
        "SELECT id FROM whatsapp_conversations WHERE clinic_id = $1 AND id = $2 FOR UPDATE",
        [turn.clinicId, turn.conversationId],
      );
      if (!conversation.rowCount) return null;
      const previousReceipt = await readReceipt(transaction, turn);
      if (previousReceipt) return previousReceipt.reply_text;
      const settings = await getSettings(transaction, turn.clinicId);
      if (!settings) return null;
      const services = await getServices(transaction, turn.clinicId);
      const reply = await decideReply(
        transaction,
        database.kind,
        turn,
        settings,
        services,
        hints,
        now,
      );
      await transaction.query(
        "INSERT INTO whatsapp_booking_receipts (clinic_id, message_id, reply_text) VALUES ($1, $2, $3)",
        [turn.clinicId, turn.messageId, reply],
      );
      return reply;
    });
  const reply = receipt
    ? receipt.reply_text
    : await process().catch((error: unknown) => {
        // A conflicting manual write may win after our preflight. In PostgreSQL
        // the exclusion constraint aborts that write; retry after rollback.
        if ((error as { code?: string })?.code === "23P01") return process();
        throw error;
      });
  if (!reply) return;
  await sendText(reply, "booking:" + turn.messageId);
  await database.query(
    "UPDATE whatsapp_booking_receipts SET reply_text = NULL WHERE clinic_id = $1 AND message_id = $2",
    [turn.clinicId, turn.messageId],
  );
}
