ALTER TABLE whatsapp_conversations ALTER COLUMN last_inbound_at DROP NOT NULL;

ALTER TABLE whatsapp_messages DROP CONSTRAINT whatsapp_messages_status_check;
ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_status_check CHECK (status IN (
  'received', 'submitting', 'submitted', 'accepted', 'pending',
  'sent', 'delivered', 'read', 'failed', 'unknown'
));

CREATE TABLE whatsapp_omni_status (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  provider_message_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, provider_message_id)
);

ALTER TABLE whatsapp_omni_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp_omni_status FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('REVOKE ALL ON whatsapp_omni_status FROM %I', api_role);
  END LOOP;
END;
$$;
