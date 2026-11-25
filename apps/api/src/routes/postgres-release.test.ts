import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createDatabase } from "../database.js";

const testDatabaseUrl = process.env.SMILESYNC_TEST_POSTGRES_URL;

it.skipIf(!testDatabaseUrl)(
  "exercita o cadastro, os fusos e a agenda no PostgreSQL",
  async () => {
    const url = new URL(testDatabaseUrl!);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/smilesync_test(?:_[a-z0-9]+)?$/.test(url.pathname) ||
      url.search
    ) {
      throw new Error("Use um banco PostgreSQL local e descartável chamado smilesync_test.");
    }

    const database = createDatabase(url.href);
    const config = loadConfig({ NODE_ENV: "test" });
    const email = `cadastro-${randomUUID()}@example.test`;
    const password = "SenhaSomenteTeste123";
    const name = "Profissional de Teste";
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;

    try {
      const server = await buildApp({ config, database, migrate: true, logger: false });
      app = server;
      const register = await server.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { name, email, password, clinicCity: "Patos de Minas" },
      });
      expect(register.statusCode, register.body).toBe(201);
      const { clinicId } = register.json<{ session: { clinicId: string } }>().session;

      const login = await server.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password },
      });
      expect(login.statusCode, login.body).toBe(200);
      const cookie = String(login.headers["set-cookie"]).split(";", 1)[0]!;
      const headers = { cookie, origin: config.appOrigin };

      await database.query("UPDATE clinic_locations SET timezone = NULL WHERE clinic_id = $1", [
        clinicId,
      ]);
      await expect(
        database.query("UPDATE clinics SET timezone = $2 WHERE id = $1", [
          clinicId,
          "Invalid/Zone",
        ]),
      ).rejects.toMatchObject({ code: "22023" });
      await expect(
        database.query("UPDATE clinic_locations SET timezone = $2 WHERE clinic_id = $1", [
          clinicId,
          "Invalid/Zone",
        ]),
      ).rejects.toMatchObject({ code: "22023" });

      const command = (type: string, payload: Record<string, unknown>) =>
        server.inject({
          method: "POST",
          url: "/api/commands",
          headers,
          payload: { type, payload, idempotencyKey: randomUUID() },
        });
      const patient = await command("patient.create", {
        name: "Paciente fictício",
        phone: "(34) 98888-1234",
      });
      expect(patient.statusCode, patient.body).toBe(200);
      const { id: patientId } = patient.json<{ result: { id: string } }>().result;

      const appointment = {
        patientId,
        date: "2031-01-15",
        time: "09:00",
        duration: 45,
        procedure: "Avaliação de teste",
        professional: name,
        room: "Sala 01",
      };
      const created = await command("appointment.save", appointment);
      expect(created.statusCode, created.body).toBe(200);
      const { id: appointmentId } = created.json<{ result: { id: string } }>().result;
      const conflict = await command("appointment.save", {
        ...appointment,
        time: "09:15",
        room: "Sala 02",
      });
      expect(conflict.statusCode, conflict.body).toBe(409);
      expect(conflict.json()).toMatchObject({ code: "appointment_conflict" });

      const bootstrap = await server.inject({ method: "GET", url: "/api/bootstrap", headers });
      expect(bootstrap.statusCode, bootstrap.body).toBe(200);
      expect(bootstrap.json()).toMatchObject({
        data: {
          appointments: expect.arrayContaining([expect.objectContaining({ id: appointmentId })]),
        },
      });
    } finally {
      await app?.close();
      await database.close();
    }
  },
  20_000,
);
