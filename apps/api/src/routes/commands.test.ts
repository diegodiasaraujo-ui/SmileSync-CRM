import { randomUUID } from "node:crypto";
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

type Actor = { cookie: string; email: string; name: string };

describe("comandos persistentes", () => {
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

  async function register(
    email: string,
    name = "Ana Administradora",
    clinicName = "Clínica Teste",
  ): Promise<Actor> {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name,
        email,
        password: "SenhaSegura123",
        clinicName,
        clinicCity: "Patos de Minas",
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return { cookie: cookieFrom(response.headers), email, name };
  }

  function commandRequest(
    actor: Actor,
    type: string,
    payload: Record<string, unknown>,
    idempotencyKey = randomUUID(),
  ) {
    return app.inject({
      method: "POST",
      url: "/api/commands",
      headers: { cookie: actor.cookie, origin: config.appOrigin },
      payload: { type, payload, idempotencyKey },
    });
  }

  async function command<Result = Record<string, unknown>>(
    actor: Actor,
    type: string,
    payload: Record<string, unknown>,
    idempotencyKey = randomUUID(),
  ) {
    const response = await commandRequest(actor, type, payload, idempotencyKey);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { result: Result; data: Record<string, unknown> };
  }

  async function createPatient(actor: Actor, suffix = "01") {
    const created = await command<{ id: string }>(actor, "patient.create", {
      name: `Paciente Teste ${suffix}`,
      phone: `(34) 99999-${suffix.padStart(4, "0")}`,
      email: `paciente-${suffix}@example.test`,
      city: "Patos de Minas",
      notes: "Registro inteiramente fictício para teste automatizado.",
    });
    return created.result.id;
  }

  async function setRole(actor: Actor, role: "dentista" | "recepcao") {
    await database.query(
      `
        UPDATE clinic_memberships memberships
        SET role_id = roles.id, updated_at = now()
        FROM roles, app_users users
        WHERE memberships.user_id = users.id
          AND roles.clinic_id = memberships.clinic_id
          AND roles.code = $2
          AND users.email = $1
      `,
      [actor.email, role],
    );
  }

  it("carrega a sessão e mantém pacientes após novo bootstrap e login", async () => {
    const actor = await register("persistencia@clinica.test");
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: actor.cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().session).toMatchObject({
      email: actor.email,
      role: "Administrador",
    });

    const patientId = await createPatient(actor, "11");
    const bootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: { cookie: actor.cookie },
    });
    expect(bootstrap.statusCode, bootstrap.body).toBe(200);
    expect(bootstrap.json().data.patients).toContainEqual(
      expect.objectContaining({ id: patientId, name: "Paciente Teste 11" }),
    );

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: actor.email, password: "SenhaSegura123" },
    });
    expect(login.statusCode, login.body).toBe(200);
    const afterLogin = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: { cookie: cookieFrom(login.headers) },
    });
    expect(afterLogin.json().data.patients).toContainEqual(
      expect.objectContaining({ id: patientId }),
    );
  });

  it("impede conflito de horário para o mesmo profissional", async () => {
    const actor = await register("agenda@clinica.test", "Dra. Agenda");
    const patientId = await createPatient(actor, "21");

    const outsideHours = await commandRequest(actor, "appointment.save", {
      patientId,
      date: "2031-01-15",
      time: "07:30",
      procedure: "Horário inválido",
      duration: 30,
      professional: actor.name,
      room: "Sala 01",
    });
    expect(outsideHours.statusCode, outsideHours.body).toBe(400);
    expect(outsideHours.json()).toMatchObject({ code: "outside_business_hours" });

    const first = await command<{ id: string }>(actor, "appointment.save", {
      patientId,
      date: "2031-01-15",
      time: "09:00",
      procedure: "Avaliação fictícia",
      duration: 60,
      professional: actor.name,
      room: "Sala 01",
    });
    expect(first.result.id).toMatch(/^[0-9a-f-]{36}$/);

    const conflicting = await commandRequest(actor, "appointment.save", {
      patientId,
      date: "2031-01-15",
      time: "09:30",
      procedure: "Retorno fictício",
      duration: 30,
      professional: actor.name,
      room: "Sala 02",
    });
    expect(conflicting.statusCode, conflicting.body).toBe(409);
    expect(conflicting.json()).toMatchObject({ code: "appointment_conflict" });
  });

  it("executa tratamento, orçamento, conversão, parcelamento e pagamento", async () => {
    const actor = await register("financeiro@clinica.test", "Dra. Financeiro");
    const patientId = await createPatient(actor, "31");

    const treatment = await command<{ id: string }>(actor, "treatment.create", {
      patientId,
      name: "Tratamento de teste",
      professional: actor.name,
      total: 1_200,
      steps: ["Avaliação", "Procedimento", "Retorno"],
    });

    const quote = await command<{ id: string }>(actor, "quote.create", {
      patientId,
      procedure: "Procedimento orçado fictício",
      value: 1_500,
      discount: 150,
      validity: "2031-02-28",
    });
    await command(actor, "quote.status", {
      quoteId: quote.result.id,
      status: "Aprovado",
    });
    const converted = await command<{ id: string }>(actor, "quote.convert", {
      quoteId: quote.result.id,
    });
    const convertedAgain = await command<{ id: string }>(actor, "quote.convert", {
      quoteId: quote.result.id,
    });
    expect(convertedAgain.result.id).toBe(converted.result.id);

    const plan = await command(actor, "payment-plan.create", {
      treatmentId: treatment.result.id,
      count: 3,
      firstDueDate: "2031-01-10",
    });
    const planData = plan.data as {
      charges: { id: string; value: number; paid?: string }[];
    };
    expect(planData.charges).toHaveLength(3);
    expect(planData.charges.map(({ value }) => value)).toEqual([400, 400, 400]);

    const firstCharge = planData.charges[0]!;
    const paid = await command(actor, "payment.create", {
      installmentId: firstCharge.id,
      paidOn: "2031-01-10",
      method: "Pix",
      amount: firstCharge.value,
    });
    const paidData = paid.data as {
      charges: { id: string; value: number; paid?: string; method?: string }[];
    };
    expect(paidData.charges.find(({ id }) => id === firstCharge.id)).toMatchObject({
      paid: "2031-01-10",
      method: "Pix",
    });

    const secondCharge = planData.charges[1]!;
    const overpayment = await commandRequest(actor, "payment.create", {
      installmentId: secondCharge.id,
      paidOn: "2031-01-10",
      method: "Pix",
      amount: secondCharge.value + 0.01,
    });
    expect(overpayment.statusCode, overpayment.body).toBe(409);
    expect(overpayment.json()).toMatchObject({ code: "overpayment" });
  });

  it("rejeita dados inválidos e duplicidade de contato", async () => {
    const actor = await register("validacao@clinica.test");
    const invalidEmail = await commandRequest(actor, "patient.create", {
      name: "Paciente Inválido",
      phone: "(34) 99999-0061",
      email: "email-invalido",
      city: "Patos de Minas",
      notes: "Teste",
    });
    expect(invalidEmail.statusCode, invalidEmail.body).toBe(400);
    expect(invalidEmail.json()).toMatchObject({ code: "validation_error" });

    await createPatient(actor, "61");
    const duplicate = await commandRequest(actor, "patient.create", {
      name: "Paciente Duplicado",
      phone: "(34) 99999-0061",
      email: "outro-email@example.test",
      city: "Patos de Minas",
      notes: "Não deve persistir",
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "patient_duplicate" });
  });

  it("repete com segurança uma chave idempotente e rejeita seu reuso com outro corpo", async () => {
    const actor = await register("idempotencia@clinica.test");
    const key = randomUUID();
    const payload = {
      name: "Paciente Idempotente",
      phone: "(34) 99999-0041",
      email: "idempotente@example.test",
      city: "Patos de Minas",
      notes: "Teste",
    };
    const first = await command<{ id: string }>(actor, "patient.create", payload, key);
    const replay = await command<{ id: string }>(actor, "patient.create", payload, key);
    expect(replay.result.id).toBe(first.result.id);
    expect((replay.data as { patients: unknown[] }).patients).toHaveLength(1);

    const conflict = await commandRequest(
      actor,
      "patient.create",
      { ...payload, name: "Outro Nome" },
      key,
    );
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "idempotency_conflict" });

    const concurrentKey = randomUUID();
    const concurrentPayload = {
      ...payload,
      name: "Paciente Concorrente",
      phone: "(34) 99999-0042",
      email: "concorrente@example.test",
    };
    const [concurrentA, concurrentB] = await Promise.all([
      commandRequest(actor, "patient.create", concurrentPayload, concurrentKey),
      commandRequest(actor, "patient.create", concurrentPayload, concurrentKey),
    ]);
    expect(concurrentA.statusCode, concurrentA.body).toBe(200);
    expect(concurrentB.statusCode, concurrentB.body).toBe(200);
    expect(concurrentA.json().result.id).toBe(concurrentB.json().result.id);
  });

  it("isola clínicas e aplica a permissão atual no servidor", async () => {
    const clinicA = await register("tenant-a@clinica.test", "Admin Tenant A", "Clínica A");
    const patientA = await createPatient(clinicA, "51");
    const clinicB = await register("tenant-b@clinica.test", "Admin Tenant B", "Clínica B");

    const bootstrapB = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: { cookie: clinicB.cookie },
    });
    expect(bootstrapB.statusCode, bootstrapB.body).toBe(200);
    expect(bootstrapB.json().data.patients).toEqual([]);

    const crossTenant = await commandRequest(clinicB, "patient.update", {
      patientId: patientA,
      name: "Tentativa entre clínicas",
      phone: "(34) 99999-0052",
      email: "isolamento@example.test",
      city: "Patos de Minas",
      notes: "Não deve persistir",
    });
    expect(crossTenant.statusCode, crossTenant.body).toBe(404);
    expect(crossTenant.json()).toMatchObject({ code: "patient_not_found" });

    await database.query(
      `
        UPDATE clinic_memberships memberships
        SET role_id = roles.id, updated_at = now()
        FROM roles, app_users users
        WHERE memberships.user_id = users.id
          AND roles.clinic_id = memberships.clinic_id
          AND roles.code = 'recepcao'
          AND users.email = $1
      `,
      [clinicB.email],
    );
    const forbidden = await commandRequest(clinicB, "quote.create", {
      patientId: patientA,
      procedure: "Não autorizado",
      value: 100,
      discount: 0,
      validity: "2031-02-28",
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: "permission_denied" });
  });

  it("oculta orçamentos e interações clínicas de perfis sem autorização", async () => {
    const actor = await register("sensibilidade@clinica.test", "Dra. Sensibilidade");
    const patientId = await createPatient(actor, "71");
    await command(actor, "quote.create", {
      patientId,
      procedure: "Orçamento sensível fictício",
      value: 900,
      discount: 0,
      validity: "2031-02-28",
    });
    await command(actor, "interaction.create", {
      patientId,
      title: "Prescrição fictícia",
      text: "Conteúdo exclusivamente fictício.",
      kind: "Prescrição",
    });

    await setRole(actor, "recepcao");
    const bootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: { cookie: actor.cookie },
    });
    expect(bootstrap.statusCode, bootstrap.body).toBe(200);
    expect(bootstrap.json().data.quotes).toEqual([]);
    expect(bootstrap.json().data.interactions).not.toContainEqual(
      expect.objectContaining({ title: "Prescrição fictícia" }),
    );

    const forbidden = await commandRequest(actor, "interaction.create", {
      patientId,
      title: "Tentativa clínica",
      text: "Não deve persistir.",
      kind: "Atestado",
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: "permission_denied" });
  });

  it("exige permissão financeira para definir valor contratado", async () => {
    const actor = await register("valor-tratamento@clinica.test", "Dra. Tratamento");
    const patientId = await createPatient(actor, "81");
    await setRole(actor, "dentista");

    const forbidden = await commandRequest(actor, "treatment.create", {
      patientId,
      name: "Tratamento com valor indevido",
      professional: actor.name,
      total: 500,
      steps: ["Avaliação"],
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: "permission_denied" });

    const allowed = await commandRequest(actor, "treatment.create", {
      patientId,
      name: "Tratamento clínico sem valor",
      professional: actor.name,
      total: 0,
      steps: ["Avaliação"],
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
  });
});
