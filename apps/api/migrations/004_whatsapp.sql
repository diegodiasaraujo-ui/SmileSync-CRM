CREATE TABLE whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  phone_number_id text NOT NULL,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  patient_id uuid,
  last_inbound_at timestamptz NOT NULL,
  opted_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, phone_number_id, phone_e164),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id)
);

CREATE INDEX whatsapp_conversations_clinic_activity_idx
  ON whatsapp_conversations (clinic_id, last_inbound_at DESC, id DESC);
CREATE INDEX whatsapp_conversations_patient_idx
  ON whatsapp_conversations (clinic_id, patient_id);

CREATE TABLE whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  provider_message_id text,
  idempotency_key text,
  request_hash text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  kind text NOT NULL,
  text_content text,
  status text NOT NULL CHECK (status IN (
    'received', 'submitting', 'submitted', 'sent', 'delivered', 'read', 'failed', 'unknown'
  )),
  occurred_at timestamptz NOT NULL,
  provider_status_at timestamptz,
  failure_code text,
  sent_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, provider_message_id),
  UNIQUE (clinic_id, conversation_id, idempotency_key),
  FOREIGN KEY (clinic_id, conversation_id) REFERENCES whatsapp_conversations(clinic_id, id),
  CHECK (
    (direction = 'inbound' AND status = 'received' AND provider_message_id IS NOT NULL
      AND idempotency_key IS NULL AND request_hash IS NULL)
    OR (direction = 'outbound' AND status <> 'received'
      AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL)
  )
);

CREATE INDEX whatsapp_messages_conversation_time_idx
  ON whatsapp_messages (clinic_id, conversation_id, occurred_at DESC, id DESC);
CREATE INDEX whatsapp_messages_outbound_time_idx
  ON whatsapp_messages (clinic_id, conversation_id, occurred_at DESC)
  WHERE direction = 'outbound' AND status IN ('submitted', 'sent', 'delivered', 'read');
CREATE INDEX whatsapp_messages_sender_idx ON whatsapp_messages (sent_by);
CREATE INDEX patient_consents_whatsapp_latest_idx
  ON patient_consents (clinic_id, patient_id, recorded_at DESC, created_at DESC, id DESC)
  WHERE channel = 'whatsapp' AND purpose = 'whatsapp_utility';

-- These tables belong to the private Fastify database connection. An empty
-- policy set denies access via PostgREST even if default privileges change.
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp_conversations, whatsapp_messages FROM PUBLIC;
DO $$
DECLARE
  api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('REVOKE ALL ON whatsapp_conversations, whatsapp_messages FROM %I', api_role);
  END LOOP;
END;
$$;
