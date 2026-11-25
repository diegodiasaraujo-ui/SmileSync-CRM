BEGIN;

ALTER TABLE appointments
  ADD COLUMN source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'whatsapp'));

CREATE TABLE whatsapp_booking_settings (
  clinic_id uuid PRIMARY KEY REFERENCES clinics (id),
  actor_membership_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  working_days smallint[] NOT NULL,
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  FOREIGN KEY (clinic_id, actor_membership_id)
    REFERENCES clinic_memberships (clinic_id, id),
  CHECK (cardinality(working_days) BETWEEN 1 AND 7
    AND working_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
    AND array_position(working_days, NULL) IS NULL),
  CHECK (opens_at >= time '08:00' AND closes_at <= time '18:00'
    AND opens_at < closes_at
    AND extract(second FROM opens_at) = 0 AND extract(second FROM closes_at) = 0)
);

CREATE TABLE whatsapp_booking_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES whatsapp_booking_settings (clinic_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 150),
  aliases text[] NOT NULL DEFAULT '{}',
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  professional_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, name),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES professionals (clinic_id, id),
  FOREIGN KEY (clinic_id, resource_id) REFERENCES clinic_resources (clinic_id, id),
  CHECK (cardinality(aliases) <= 15 AND array_position(aliases, NULL) IS NULL)
);

CREATE INDEX whatsapp_booking_services_professional_idx
  ON whatsapp_booking_services (clinic_id, professional_id);
CREATE INDEX whatsapp_booking_services_resource_idx
  ON whatsapp_booking_services (clinic_id, resource_id);

CREATE TABLE whatsapp_booking_state (
  clinic_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  patient_id uuid,
  service_id uuid,
  desired_date date,
  desired_time time,
  proposal_code text CHECK (proposal_code IS NULL OR proposal_code ~ '^[a-f0-9]{8}$'),
  proposal_issued_at timestamptz,
  proposal_expires_at timestamptz,
  proposal_snapshot jsonb,
  last_input_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, conversation_id),
  FOREIGN KEY (clinic_id, conversation_id)
    REFERENCES whatsapp_conversations (clinic_id, id) ON DELETE CASCADE,
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, service_id) REFERENCES whatsapp_booking_services (clinic_id, id)
    ON DELETE SET NULL (service_id),
  CHECK (proposal_snapshot IS NULL OR jsonb_typeof(proposal_snapshot) = 'object'),
  CHECK (
    (proposal_code IS NULL AND proposal_issued_at IS NULL AND proposal_expires_at IS NULL
      AND proposal_snapshot IS NULL)
    OR
    (proposal_code IS NOT NULL AND proposal_issued_at IS NOT NULL AND proposal_expires_at IS NOT NULL
      AND proposal_snapshot IS NOT NULL AND proposal_issued_at < proposal_expires_at)
  )
);

CREATE INDEX whatsapp_booking_state_service_idx
  ON whatsapp_booking_state (clinic_id, service_id) WHERE service_id IS NOT NULL;
CREATE INDEX whatsapp_booking_state_patient_idx
  ON whatsapp_booking_state (clinic_id, patient_id) WHERE patient_id IS NOT NULL;

CREATE TABLE whatsapp_booking_receipts (
  clinic_id uuid NOT NULL,
  message_id uuid NOT NULL,
  reply_text text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, message_id),
  FOREIGN KEY (clinic_id, message_id)
    REFERENCES whatsapp_messages (clinic_id, id) ON DELETE CASCADE
);

-- Access is delegated to the existing private backend database connection.
-- Restricted roles have no policy, including the Supabase Data API roles.
ALTER TABLE whatsapp_booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_booking_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_booking_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_booking_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp_booking_settings, whatsapp_booking_services,
  whatsapp_booking_state, whatsapp_booking_receipts FROM PUBLIC;
DO $$
DECLARE
  api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('REVOKE ALL ON whatsapp_booking_settings, whatsapp_booking_services,
      whatsapp_booking_state, whatsapp_booking_receipts FROM %I', api_role);
  END LOOP;
END;
$$;

COMMIT;
