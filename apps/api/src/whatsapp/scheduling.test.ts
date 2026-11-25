import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, migrateDatabase } from "../database.js";
import { localBookingDate } from "./booking-parser.js";
import { processWhatsAppScheduling } from "./scheduling.js";

const database = createDatabase("pglite://memory");
const timezone = "America/Sao_Paulo";
type SendText = (text: string, idempotencyKey: string) => Promise<void>;

async function setup() {
  const clinicId = randomUUID();
  const roleId = randomUUID();
  const actor = randomUUID();
  const membership = randomUUID();
  const practitioner = randomUUID();
  const location = randomUUID();
  const resource = randomUUID();
  const patientId = randomUUID();
  const conversationId = randomUUID();
  const from = "+5534999993411";
  await database.query(
    "INSERT INTO clinics (id, display_name, timezone) VALUES ($1, 'Clínica teste', $2)",
    [clinicId, timezone],
  );
  await database.query(
    "INSERT INTO app_users (id, email, full_name) VALUES ($1, $2, 'Equipe teste')",
    [actor, actor + "@example.test"],
  );
  await database.query(
    "INSERT INTO roles (id, clinic_id, code, name) VALUES ($1, $2, 'scheduler', 'Equipe')",
    [roleId, clinicId],
  );
  await database.query(
    "INSERT INTO role_permissions (clinic_id, role_id, permission_code) VALUES ($1, $2, 'appointments.create')",
    [clinicId, roleId],
  );
  await database.query(
    "INSERT INTO clinic_memberships (id, clinic_id, user_id, role_id) VALUES ($1, $2, $3, $4)",
    [membership, clinicId, actor, roleId],
  );
  await database.query(
    "INSERT INTO professionals (id, clinic_id, full_name) VALUES ($1, $2, 'Profissional teste')",
    [practitioner, clinicId],
  );
  await database.query(
    "INSERT INTO clinic_locations (id, clinic_id, name, city) VALUES ($1, $2, 'Unidade teste', 'Patos de Minas')",
    [location, clinicId],
  );
  await database.query(
    "INSERT INTO clinic_resources (id, clinic_id, location_id, name) VALUES ($1, $2, $3, 'Sala teste')",
    [resource, clinicId, location],
  );
  await database.query(
    "INSERT INTO patients (id, clinic_id, full_name, phone_e164, created_by) VALUES ($1, $2, 'Alice Teste', $3, $4)",
    [patientId, clinicId, from, actor],
  );
  await database.query(
    "INSERT INTO whatsapp_conversations (id, clinic_id, phone_number_id, phone_e164, patient_id, last_inbound_at) VALUES ($1, $2, '12345', $3, $4, now())",
    [conversationId, clinicId, from, patientId],
  );
  await database.query(
    "INSERT INTO whatsapp_booking_settings (clinic_id, actor_membership_id, enabled, working_days, opens_at, closes_at) VALUES ($1, $2, true, '{1,2,3,4,5,6,7}', '09:00', '17:00')",
    [clinicId, membership],
  );
  await database.query(
    "INSERT INTO whatsapp_booking_services (clinic_id, name, aliases, duration_minutes, professional_id, resource_id) VALUES ($1, 'Avaliação', '{avaliacao,consulta}', 30, $2, $3)",
    [clinicId, practitioner, resource],
  );
  const sendText = vi.fn<SendText>().mockResolvedValue(undefined);

  async function receive(text: string, target = patientId, outbound: SendText = sendText) {
    const messageId = randomUUID();
    const occurredAt = new Date();
    await database.query(
      `INSERT INTO whatsapp_messages (id, clinic_id, conversation_id, provider_message_id, direction, kind, text_content, status, occurred_at)
        VALUES ($1, $2, $3, $4, 'inbound', 'text', $5, 'received', $6)`,
      [messageId, clinicId, conversationId, "wamid." + messageId, text, occurredAt],
    );
    return () =>
      processWhatsAppScheduling({
        database,
        clinicId,
        conversationId,
        from,
        messageId,
        occurredAt,
        patientId: target || null,
        text,
        sendText: outbound,
      });
  }
  async function turn(text: string) {
    await (
      await receive(text)
    )();
    return sendText.mock.lastCall?.[0] ?? "";
  }

  async function countAppointments() {
    const { rows } = await database.query("SELECT id FROM appointments WHERE clinic_id = $1", [
      clinicId,
    ]);
    return rows.length;
  }

  return {
    clinicId,
    actor,
    patientId,
    practitioner,
    location,
    resource,
    turn,
    sendText,
    receive,
    countAppointments,
  };
}

const codeFrom = (reply: string) => reply.match(/CONFIRMAR ([A-F0-9]{8})/)?.[1];

describe("agendamento existente via WhatsApp", () => {
  beforeAll(async () => migrateDatabase(database), 15_000);
  afterAll(async () => database.close());

  it("pede dados faltantes, exige código literal e grava na agenda com origem e histórico", async () => {
    const context = await setup();
    expect(await context.turn("Me chamo Alice. Quero agendar uma avaliação amanhã.")).toContain(
      "horário",
    );
    let code = codeFrom(await context.turn("14:00"));
    expect(code).toBeDefined();
    expect(await context.turn("sim")).toContain("copie");
    expect(await context.countAppointments()).toBe(0);
    expect(await context.turn("CONFIRMAR ffffffff")).toContain("copie");

    // A retry after the provider connection failed must not create a second
    // appointment. The exact outbound payload and key remain recoverable.
    const outbound = vi
      .fn<SendText>()
      .mockRejectedValueOnce(new Error("injected provider failure"))
      .mockResolvedValue(undefined);
    const confirm = await context.receive("CONFIRMAR " + code, context.patientId, outbound);
    await expect(confirm()).rejects.toThrow("injected provider failure");
    await confirm();
    await confirm();
    expect(outbound).toHaveBeenCalledTimes(2);
    expect(outbound.mock.calls[0]).toEqual(outbound.mock.calls[1]);
    expect(outbound.mock.lastCall?.[0]).toContain("Agendamento confirmado");
    expect(await context.countAppointments()).toBe(1);
    const { rows } = await database.query(
      `SELECT a.source, a.status, h.to_status, p.channel,
        to_char(a.starts_at AT TIME ZONE $2, 'HH24:MI') AS local_time
        FROM appointments a
        JOIN appointment_status_history h ON h.clinic_id = a.clinic_id AND h.appointment_id = a.id
        JOIN patient_interactions p ON p.clinic_id = a.clinic_id AND p.appointment_id = a.id
        WHERE a.clinic_id = $1`,
      [context.clinicId, timezone],
    );
    expect(rows).toEqual([
      {
        source: "whatsapp",
        status: "confirmed",
        to_status: "confirmed",
        channel: "whatsapp",
        local_time: "14:00",
      },
    ]);
  }, 15_000);

  it("respeita duração e regras de expediente, revalida conflitos e encaminha número sem vínculo", async () => {
    const context = await setup();
    const proposal = "Quero agendar uma avaliação amanhã às ";
    expect(await context.turn(proposal + "16:45")).toContain("não está disponível");
    await (
      await context.receive(proposal + "14:00", "")
    )();
    expect(context.sendText.mock.lastCall?.[0]).toContain("conferir seu cadastro");
    const code = codeFrom(await context.turn(proposal + "14:00"));
    expect(code).toBeDefined();

    // A manual booking for the same patient wins before confirmation, even
    // with a different professional and no shared room.
    const other = randomUUID();
    await database.query(
      "INSERT INTO professionals (id, clinic_id, full_name) VALUES ($1, $2, 'Outro profissional')",
      [other, context.clinicId],
    );
    const tomorrow = localBookingDate(new Date(Date.now() + 86_400_000), timezone);
    await database.query(
      `INSERT INTO appointments (clinic_id, patient_id, professional_id, location_id, procedure_name, starts_at, ends_at, created_by)
        VALUES ($1, $2, $3, $4, 'Manual', (($5::date + time '14:15') AT TIME ZONE $6), (($5::date + time '14:45') AT TIME ZONE $6), $7)`,
      [
        context.clinicId,
        context.patientId,
        other,
        context.location,
        tomorrow,
        timezone,
        context.actor,
      ],
    );
    expect(await context.turn("CONFIRMAR " + code)).toContain("não está disponível");
    expect(await context.countAppointments()).toBe(1);
  }, 15_000);
});
