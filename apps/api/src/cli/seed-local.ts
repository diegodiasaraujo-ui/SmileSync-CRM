import { createHash } from "node:crypto";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createDatabase, migrateDatabase, type Database } from "../database.js";

const email = "demo@smilesync.test";
const password = "SmileSyncDemo2026!";
const displayName = "Dra. Marina Exemplo";
const seedKey = "academico-v1";

type SeedState = {
  clinic_id: string;
  reference_date: string;
  completed: boolean;
};

function fixtureKey(name: string) {
  const hash = createHash("sha256").update(`smilesync:${seedKey}:${name}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function moveDate(date: string, days: number) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

async function seedLocalDemo(database: Database, origin: string) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS app.local_demo_seed (
      seed_key text PRIMARY KEY,
      clinic_id uuid NOT NULL REFERENCES public.clinics(id),
      reference_date date NOT NULL,
      completed boolean NOT NULL DEFAULT false
    )
  `);
  const state = await database.query<SeedState>(
    "SELECT clinic_id, reference_date::text, completed FROM app.local_demo_seed WHERE seed_key = $1",
    [seedKey],
  );
  const previous = state.rows[0];
  if (previous?.completed) return previous.clinic_id;

  const app = await buildApp({
    config: loadConfig({ NODE_ENV: "test", APP_ORIGIN: origin }),
    database,
    migrate: false,
    logger: false,
  });
  try {
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: displayName,
        email,
        password,
        clinicName: "Clínica SmileSync · Demonstração",
      },
    });
    if (registration.statusCode !== 201 && registration.json().error !== "email_in_use") {
      throw new Error(`Falha ao criar a conta de demonstração (HTTP ${registration.statusCode}).`);
    }
    const login =
      registration.statusCode === 201
        ? registration
        : await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { email, password },
          });
    if (login.statusCode !== 200 && login.statusCode !== 201) {
      throw new Error(
        "A conta de demonstração já existe com outra senha. Use SMILESYNC_SEED_DEMO=false para iniciar sem recriá-la.",
      );
    }
    const { session } = login.json<{ session: { clinicId: string; name: string } }>();
    if (previous && previous.clinic_id !== session.clinicId) {
      throw new Error("A clínica da conta não corresponde à clínica de demonstração local.");
    }
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    if (!cookie) throw new Error("Não foi possível abrir a sessão de demonstração.");
    const headers = { cookie, origin };

    try {
      const today =
        previous?.reference_date ??
        new Intl.DateTimeFormat("sv-SE", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
      await database.query(
        "INSERT INTO app.local_demo_seed (seed_key, clinic_id, reference_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [seedKey, session.clinicId, today],
      );

      async function command(name: string, key: string, payload: Record<string, unknown>) {
        const response = await app.inject({
          method: "POST",
          url: "/api/commands",
          headers,
          payload: { type: name, payload, idempotencyKey: fixtureKey(key) },
        });
        if (response.statusCode !== 200)
          throw new Error(`Falha ao preparar ${name} (HTTP ${response.statusCode}).`);
        return response.json<{
          result: { id: string };
          data: { charges: { id: string; value: number }[] };
        }>();
      }

      const evaluation = await command("patient.create", "patient-evaluation", {
        name: "Clara Exemplo",
        email: "clara@smilesync.test",
        city: "Patos de Minas",
        notes: "Cadastro fictício da apresentação acadêmica.",
      });
      const followup = await command("patient.create", "patient-followup", {
        name: "Lucas Exemplo",
        email: "lucas@smilesync.test",
        city: "Patos de Minas",
        notes: "Cadastro fictício da apresentação acadêmica.",
      });
      const treatment = await command("treatment.create", "treatment", {
        patientId: followup.result.id,
        name: "Acompanhamento preventivo",
        professional: session.name,
        total: 360,
        steps: ["Avaliação", "Orientação", "Retorno"],
      });
      const consultation = await command("appointment.save", "appointment-evaluation", {
        patientId: evaluation.result.id,
        date: today,
        time: "09:30",
        procedure: "Avaliação odontológica",
        duration: 30,
        professional: session.name,
        room: "Sala 01",
      });
      await command("appointment.status", "confirm-evaluation", {
        appointmentId: consultation.result.id,
        status: "Confirmado",
      });
      await command("appointment.save", "appointment-followup", {
        patientId: followup.result.id,
        treatmentId: treatment.result.id,
        date: today,
        time: "14:00",
        procedure: "Retorno preventivo",
        duration: 30,
        professional: session.name,
        room: "Sala 01",
      });
      await command("quote.create", "quote", {
        patientId: evaluation.result.id,
        procedure: "Avaliação e profilaxia",
        value: 340,
        discount: 0,
        validity: moveDate(today, 30),
      });
      const plan = await command("payment-plan.create", "plan", {
        treatmentId: treatment.result.id,
        count: 2,
        firstDueDate: today,
      });
      const installment = plan.data.charges[0];
      if (installment)
        await command("payment.create", "payment", {
          installmentId: installment.id,
          paidOn: today,
          method: "Pix",
          amount: installment.value,
        });
      await database.query("UPDATE app.local_demo_seed SET completed = true WHERE seed_key = $1", [
        seedKey,
      ]);
      return session.clinicId;
    } finally {
      await app.inject({ method: "POST", url: "/api/auth/logout", headers, payload: {} });
    }
  } finally {
    await app.close();
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("pglite://") || databaseUrl === "pglite://memory") {
  throw new Error("A demonstração aceita apenas banco PGlite local em disco.");
}
const database = createDatabase(databaseUrl);
try {
  await migrateDatabase(database);
  const clinicId = await seedLocalDemo(database, process.env.APP_ORIGIN ?? "http://127.0.0.1:4173");
  process.stdout.write(JSON.stringify({ clinicId }));
} finally {
  await database.close();
}
