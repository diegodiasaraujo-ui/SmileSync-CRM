import type { DatabaseExecutor } from "./database.js";

export function appointmentWithinHours(
  time: string,
  duration: number,
  opensAt = "08:00",
  closesAt = "18:00",
) {
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = minutes(time);
  return start >= minutes(opensAt) && start + duration <= minutes(closesAt);
}

export async function lockAppointmentPatient(
  database: DatabaseExecutor,
  clinicId: string,
  patientId: string,
) {
  // Patient-level writers take this lock before checking overlap. PostgreSQL
  // also enforces professional and room conflicts with exclusion constraints.
  await database.query("SELECT id FROM patients WHERE clinic_id = $1 AND id = $2 FOR UPDATE", [
    clinicId,
    patientId,
  ]);
}

export async function appointmentConflicts(
  database: DatabaseExecutor,
  clinicId: string,
  input: {
    appointmentId?: string;
    patientId: string;
    professionalId: string;
    resourceId: string | null;
    date: string;
    time: string;
    duration: number;
  },
) {
  const { rows } = await database.query<{ id: string }>(
    `
      SELECT appointments.id
      FROM appointments
      JOIN clinics ON clinics.id = appointments.clinic_id
      WHERE appointments.clinic_id = $1
        AND appointments.deleted_at IS NULL
        AND appointments.status NOT IN ('cancelled', 'no_show')
        AND ($2::uuid IS NULL OR appointments.id <> $2::uuid)
        AND (appointments.professional_id = $3 OR appointments.resource_id = $4
          OR appointments.patient_id = $8)
        AND appointments.starts_at <
          ((($5::date + $6::time) + make_interval(mins => $7)) AT TIME ZONE clinics.timezone)
        AND appointments.ends_at > (($5::date + $6::time) AT TIME ZONE clinics.timezone)
      LIMIT 1
    `,
    [
      clinicId,
      input.appointmentId ?? null,
      input.professionalId,
      input.resourceId,
      input.date,
      input.time,
      input.duration,
      input.patientId,
    ],
  );
  return rows.length > 0;
}
