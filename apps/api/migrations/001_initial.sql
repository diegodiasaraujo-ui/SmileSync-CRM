BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

-- Authentication identities. Passwords and bearer tokens are never stored in
-- plaintext: password_hash is a versioned scrypt encoded hash, while token_hash
-- columns contain a lowercase SHA-256 digest of a high-entropy random token.
CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text NOT NULL,
  password_hash text,
  auth_provider text,
  auth_subject text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'disabled')),
  email_verified_at timestamptz,
  password_changed_at timestamptz,
  failed_login_attempts integer NOT NULL DEFAULT 0
    CHECK (failed_login_attempts >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (password_hash IS NULL OR length(password_hash) >= 50),
  CHECK (
    (auth_provider IS NULL AND auth_subject IS NULL)
    OR (auth_provider IS NOT NULL AND auth_subject IS NOT NULL)
  )
);

CREATE UNIQUE INDEX app_users_email_unique_idx
  ON app_users (lower(btrim(email)));

CREATE UNIQUE INDEX app_users_provider_subject_unique_idx
  ON app_users (auth_provider, auth_subject)
  WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  clinic_id uuid,
  membership_id uuid,
  token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  rotated_from_session_id uuid REFERENCES user_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  ip_address inet,
  user_agent text,
  CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CHECK (idle_expires_at > created_at),
  CHECK (expires_at >= idle_expires_at),
  CHECK ((clinic_id IS NULL) = (membership_id IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE INDEX user_sessions_user_active_idx
  ON user_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX user_sessions_family_idx
  ON user_sessions (family_id);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  requested_ip inet,
  CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE INDEX password_reset_tokens_user_active_idx
  ON password_reset_tokens (user_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text,
  display_name text NOT NULL,
  phone_e164 text,
  email text,
  city text,
  state_code varchar(2),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  currency char(3) NOT NULL DEFAULT 'BRL',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TABLE clinic_preferences (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  compact_mode boolean NOT NULL DEFAULT false,
  reminders_enabled boolean NOT NULL DEFAULT true,
  default_appointment_minutes integer NOT NULL DEFAULT 30
    CHECK (default_appointment_minutes BETWEEN 5 AND 480),
  locale text NOT NULL DEFAULT 'pt-BR',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id)
);

CREATE TABLE permissions (
  code text PRIMARY KEY,
  description text NOT NULL,
  sensitivity text NOT NULL DEFAULT 'normal'
    CHECK (sensitivity IN ('normal', 'clinical', 'financial', 'administrative'))
);

INSERT INTO permissions (code, description, sensitivity) VALUES
  ('patients.read', 'Consultar dados cadastrais de pacientes', 'normal'),
  ('patients.create', 'Cadastrar pacientes', 'normal'),
  ('patients.update', 'Editar dados cadastrais de pacientes', 'normal'),
  ('patients.deactivate', 'Inativar pacientes', 'administrative'),
  ('appointments.read', 'Consultar agenda', 'normal'),
  ('appointments.create', 'Criar consultas', 'normal'),
  ('appointments.update', 'Reagendar e atualizar consultas', 'normal'),
  ('appointments.cancel', 'Cancelar consultas', 'normal'),
  ('treatments.read', 'Consultar tratamentos sem evolução clínica', 'normal'),
  ('treatments.write', 'Criar e atualizar tratamentos', 'clinical'),
  ('treatments.clinical.read', 'Consultar dados clínicos sensíveis', 'clinical'),
  ('treatments.clinical.write', 'Registrar evolução e documentos clínicos', 'clinical'),
  ('quotes.read', 'Consultar orçamentos', 'financial'),
  ('quotes.create', 'Criar orçamentos', 'financial'),
  ('quotes.update', 'Editar orçamentos', 'financial'),
  ('quotes.approve', 'Aprovar, rejeitar e converter orçamentos', 'financial'),
  ('finance.summary.read', 'Consultar resumo financeiro', 'financial'),
  ('finance.details.read', 'Consultar financeiro detalhado', 'financial'),
  ('finance.charges.write', 'Criar e cancelar cobranças', 'financial'),
  ('finance.payments.write', 'Registrar pagamentos', 'financial'),
  ('finance.payments.void', 'Anular pagamentos', 'financial'),
  ('team.read', 'Consultar equipe e papéis', 'administrative'),
  ('team.invite', 'Convidar integrantes', 'administrative'),
  ('team.update', 'Alterar papéis e desativar integrantes', 'administrative'),
  ('clinic.settings.read', 'Consultar configurações da clínica', 'administrative'),
  ('clinic.settings.update', 'Alterar configurações da clínica', 'administrative'),
  ('integrations.read', 'Consultar estado das integrações', 'administrative'),
  ('integrations.update', 'Configurar integrações', 'administrative'),
  ('automations.read', 'Consultar automações', 'administrative'),
  ('automations.update', 'Criar e alterar automações', 'administrative'),
  ('reports.operational.export', 'Exportar relatórios operacionais', 'normal'),
  ('reports.financial.export', 'Exportar relatórios financeiros', 'financial'),
  ('audit.read', 'Consultar trilha de auditoria', 'administrative')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  code text NOT NULL,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, code)
);

CREATE TABLE role_permissions (
  clinic_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_code text NOT NULL REFERENCES permissions(code),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES app_users(id),
  PRIMARY KEY (clinic_id, role_id, permission_code),
  FOREIGN KEY (clinic_id, role_id)
    REFERENCES roles(clinic_id, id) ON DELETE CASCADE
);

CREATE TABLE clinic_memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  user_id uuid NOT NULL REFERENCES app_users(id),
  role_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'disabled')),
  joined_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, user_id),
  FOREIGN KEY (clinic_id, role_id) REFERENCES roles(clinic_id, id),
  CHECK ((status = 'disabled') = (disabled_at IS NOT NULL))
);

CREATE TABLE clinic_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  email text NOT NULL,
  invitee_name text NOT NULL,
  role_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  invited_by uuid NOT NULL REFERENCES app_users(id),
  accepted_by uuid REFERENCES app_users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, role_id) REFERENCES roles(clinic_id, id),
  CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);

ALTER TABLE user_sessions
  ADD CONSTRAINT user_sessions_membership_fk
  FOREIGN KEY (clinic_id, membership_id)
  REFERENCES clinic_memberships(clinic_id, id);

CREATE UNIQUE INDEX clinic_invites_pending_email_idx
  ON clinic_invites (clinic_id, lower(btrim(email)))
  WHERE status = 'pending';

CREATE TABLE professionals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  membership_id uuid,
  full_name text NOT NULL,
  registration_type text,
  registration_number text,
  registration_state varchar(2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, membership_id)
    REFERENCES clinic_memberships(clinic_id, id),
  CHECK (registration_state IS NULL OR registration_state ~ '^[A-Z]{2}$')
);

CREATE UNIQUE INDEX professionals_membership_unique_idx
  ON professionals (clinic_id, membership_id)
  WHERE membership_id IS NOT NULL;

CREATE UNIQUE INDEX professionals_registration_unique_idx
  ON professionals (
    clinic_id,
    registration_type,
    registration_number,
    registration_state
  )
  WHERE registration_number IS NOT NULL;

CREATE TABLE clinic_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  city text NOT NULL,
  state_code varchar(2),
  timezone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, name),
  CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$')
);

CREATE TABLE clinic_resources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  location_id uuid NOT NULL,
  name text NOT NULL,
  resource_type text NOT NULL DEFAULT 'room',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, location_id, name),
  FOREIGN KEY (clinic_id, location_id)
    REFERENCES clinic_locations(clinic_id, id)
);

CREATE TABLE patients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  full_name text NOT NULL,
  preferred_name text,
  phone_e164 text,
  email text,
  birth_date date,
  city text,
  state_code varchar(2),
  notes text,
  assigned_professional_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app_users(id),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, assigned_professional_id)
    REFERENCES professionals(clinic_id, id),
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

CREATE INDEX patients_clinic_active_name_idx
  ON patients (clinic_id, active, lower(full_name))
  WHERE deleted_at IS NULL;

CREATE INDEX patients_clinic_phone_idx
  ON patients (clinic_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX patients_clinic_email_idx
  ON patients (clinic_id, lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  color text,
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, name)
);

CREATE TABLE patient_tags (
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, patient_id, tag_id),
  FOREIGN KEY (clinic_id, patient_id)
    REFERENCES patients(clinic_id, id) ON DELETE CASCADE,
  FOREIGN KEY (clinic_id, tag_id)
    REFERENCES tags(clinic_id, id) ON DELETE CASCADE
);

CREATE TABLE patient_consents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  channel text NOT NULL
    CHECK (channel IN ('whatsapp', 'sms', 'email', 'phone')),
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('granted', 'revoked')),
  evidence_source text NOT NULL,
  evidence_reference text,
  recorded_at timestamptz NOT NULL,
  revoked_at timestamptz,
  recorded_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE TABLE treatments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  source_quote_id uuid,
  name text NOT NULL,
  treatment_type text,
  contracted_amount numeric(14,2) NOT NULL DEFAULT 0
    CHECK (contracted_amount >= 0),
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN (
      'planning', 'awaiting_approval', 'awaiting_payment', 'scheduled',
      'in_progress', 'paused', 'completed', 'cancelled'
    )),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  start_date date,
  expected_end_date date,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  clinical_summary text,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id)
    REFERENCES professionals(clinic_id, id),
  CHECK (expected_end_date IS NULL OR start_date IS NULL OR expected_end_date >= start_date),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX treatments_source_quote_unique_idx
  ON treatments (clinic_id, source_quote_id)
  WHERE source_quote_id IS NOT NULL;

CREATE INDEX treatments_patient_status_idx
  ON treatments (clinic_id, patient_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  treatment_id uuid,
  professional_id uuid NOT NULL,
  location_id uuid NOT NULL,
  resource_id uuid,
  procedure_name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN (
      'scheduled', 'awaiting_confirmation', 'confirmed', 'checked_in',
      'in_progress', 'completed', 'cancelled', 'no_show'
    )),
  cancellation_reason text,
  notes text,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  FOREIGN KEY (clinic_id, treatment_id) REFERENCES treatments(clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id)
    REFERENCES professionals(clinic_id, id),
  FOREIGN KEY (clinic_id, location_id)
    REFERENCES clinic_locations(clinic_id, id),
  FOREIGN KEY (clinic_id, resource_id)
    REFERENCES clinic_resources(clinic_id, id),
  CHECK (ends_at > starts_at),
  CHECK ((status = 'cancelled') = (cancellation_reason IS NOT NULL))
);

CREATE INDEX appointments_clinic_start_idx
  ON appointments (clinic_id, starts_at)
  WHERE deleted_at IS NULL;

CREATE INDEX appointments_professional_start_idx
  ON appointments (clinic_id, professional_id, starts_at)
  WHERE deleted_at IS NULL;

CREATE INDEX appointments_patient_start_idx
  ON appointments (clinic_id, patient_id, starts_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE appointment_status_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid NOT NULL REFERENCES app_users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id)
    REFERENCES appointments(clinic_id, id)
);

CREATE TABLE treatment_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  treatment_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduled', 'completed', 'skipped', 'cancelled')),
  due_date date,
  completed_at timestamptz,
  completed_by uuid REFERENCES app_users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, treatment_id, sequence_no),
  FOREIGN KEY (clinic_id, treatment_id)
    REFERENCES treatments(clinic_id, id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE treatment_status_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  treatment_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid NOT NULL REFERENCES app_users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, treatment_id)
    REFERENCES treatments(clinic_id, id)
);

CREATE TABLE clinical_evolutions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  treatment_id uuid NOT NULL,
  appointment_id uuid,
  professional_id uuid NOT NULL,
  supersedes_id uuid,
  content text NOT NULL,
  amendment_reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, treatment_id)
    REFERENCES treatments(clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id)
    REFERENCES appointments(clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id)
    REFERENCES professionals(clinic_id, id),
  FOREIGN KEY (clinic_id, supersedes_id)
    REFERENCES clinical_evolutions(clinic_id, id),
  CHECK ((supersedes_id IS NULL) = (amendment_reason IS NULL))
);

CREATE TABLE medications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  treatment_id uuid NOT NULL,
  description text NOT NULL,
  recorded_by_professional_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, treatment_id)
    REFERENCES treatments(clinic_id, id),
  FOREIGN KEY (clinic_id, recorded_by_professional_id)
    REFERENCES professionals(clinic_id, id)
);

CREATE TABLE clinical_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  treatment_id uuid,
  document_type text NOT NULL,
  original_filename text NOT NULL,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  checksum_sha256 text NOT NULL,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, storage_key),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  FOREIGN KEY (clinic_id, treatment_id) REFERENCES treatments(clinic_id, id),
  CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE patient_interactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  appointment_id uuid,
  kind text NOT NULL,
  channel text,
  subject text NOT NULL,
  body text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id)
    REFERENCES appointments(clinic_id, id)
);

CREATE INDEX patient_interactions_patient_time_idx
  ON patient_interactions (clinic_id, patient_id, occurred_at DESC);

CREATE TABLE follow_up_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid,
  treatment_id uuid,
  assigned_membership_id uuid,
  title text NOT NULL,
  description text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  FOREIGN KEY (clinic_id, treatment_id) REFERENCES treatments(clinic_id, id),
  FOREIGN KEY (clinic_id, assigned_membership_id)
    REFERENCES clinic_memberships(clinic_id, id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE quotes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'sent', 'viewed', 'approved', 'rejected', 'expired', 'cancelled'
    )),
  valid_until date,
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  sent_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  CHECK (discount_amount <= subtotal),
  CHECK (total_amount = subtotal - discount_amount),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CHECK (status <> 'rejected' OR rejected_at IS NOT NULL)
);

CREATE TABLE quote_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  description text NOT NULL,
  quantity numeric(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total numeric(14,2)
    GENERATED ALWAYS AS (quantity * unit_price - discount_amount) STORED,
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, quote_id, sequence_no),
  FOREIGN KEY (clinic_id, quote_id)
    REFERENCES quotes(clinic_id, id) ON DELETE CASCADE,
  CHECK (discount_amount <= quantity * unit_price)
);

CREATE TABLE quote_status_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid NOT NULL REFERENCES app_users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, quote_id) REFERENCES quotes(clinic_id, id)
);

ALTER TABLE treatments
  ADD CONSTRAINT treatments_source_quote_fk
  FOREIGN KEY (clinic_id, source_quote_id) REFERENCES quotes(clinic_id, id);

CREATE TABLE receivables (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  treatment_id uuid,
  source_quote_id uuid,
  description text NOT NULL,
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'settled', 'cancelled')),
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancellation_reason text,
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  FOREIGN KEY (clinic_id, treatment_id) REFERENCES treatments(clinic_id, id),
  FOREIGN KEY (clinic_id, source_quote_id) REFERENCES quotes(clinic_id, id),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancellation_reason IS NOT NULL))
);

CREATE UNIQUE INDEX receivables_source_quote_unique_idx
  ON receivables (clinic_id, source_quote_id)
  WHERE source_quote_id IS NOT NULL;

CREATE UNIQUE INDEX receivables_active_treatment_unique_idx
  ON receivables (clinic_id, treatment_id)
  WHERE treatment_id IS NOT NULL AND status <> 'cancelled';

CREATE INDEX receivables_patient_status_idx
  ON receivables (clinic_id, patient_id, status);

CREATE TABLE installments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  receivable_id uuid NOT NULL,
  installment_no integer NOT NULL CHECK (installment_no > 0),
  due_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  automatic_reminder boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, receivable_id, installment_no),
  FOREIGN KEY (clinic_id, receivable_id)
    REFERENCES receivables(clinic_id, id)
);

CREATE INDEX installments_due_idx
  ON installments (clinic_id, due_date)
  WHERE cancelled_at IS NULL;

CREATE TABLE payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL,
  paid_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted', 'voided', 'refunded')),
  idempotency_key text NOT NULL,
  external_reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES app_users(id),
  void_reason text,
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, idempotency_key),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  CHECK (
    (status = 'voided') =
    (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
  )
);

CREATE TABLE payment_allocations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  installment_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, payment_id, installment_id),
  FOREIGN KEY (clinic_id, payment_id) REFERENCES payments(clinic_id, id),
  FOREIGN KEY (clinic_id, installment_id)
    REFERENCES installments(clinic_id, id)
);

CREATE VIEW installment_balances AS
SELECT
  i.clinic_id,
  i.id AS installment_id,
  i.receivable_id,
  i.due_date,
  i.amount,
  COALESCE(
    SUM(pa.amount) FILTER (WHERE p.status = 'posted'),
    0::numeric
  )::numeric(14,2) AS paid_amount,
  (
    i.amount - COALESCE(
      SUM(pa.amount) FILTER (WHERE p.status = 'posted'),
      0::numeric
    )
  )::numeric(14,2) AS outstanding_amount
FROM installments i
LEFT JOIN payment_allocations pa
  ON pa.clinic_id = i.clinic_id AND pa.installment_id = i.id
LEFT JOIN payments p
  ON p.clinic_id = pa.clinic_id AND p.id = pa.payment_id
GROUP BY i.clinic_id, i.id, i.receivable_id, i.due_date, i.amount;

CREATE TABLE integration_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'active', 'failed', 'disabled')),
  secret_ref text,
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, provider),
  CHECK (jsonb_typeof(public_config) = 'object')
);

CREATE TABLE message_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  provider text NOT NULL,
  external_template_id text,
  purpose text NOT NULL,
  name text NOT NULL,
  language_code text NOT NULL DEFAULT 'pt_BR',
  status text NOT NULL
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'disabled')),
  body_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, name, language_code)
);

CREATE TABLE message_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  appointment_id uuid,
  template_id uuid,
  channel text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  status text NOT NULL
    CHECK (status IN (
      'draft', 'scheduled', 'queued', 'submitted', 'sent', 'delivered', 'read',
      'failed', 'cancelled', 'received'
    )),
  provider_message_id text,
  deduplication_key text NOT NULL,
  scheduled_for timestamptz,
  submitted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_detail_redacted text,
  payload_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, deduplication_key),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id)
    REFERENCES appointments(clinic_id, id),
  FOREIGN KEY (clinic_id, template_id)
    REFERENCES message_templates(clinic_id, id),
  CHECK (jsonb_typeof(payload_redacted) = 'object')
);

CREATE UNIQUE INDEX message_events_provider_id_unique_idx
  ON message_events (clinic_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE automation_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  trigger_type text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type text NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, name),
  CHECK (jsonb_typeof(conditions) = 'object'),
  CHECK (jsonb_typeof(action_config) = 'object')
);

CREATE TABLE automation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  source_event_type text NOT NULL,
  source_event_id uuid,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  last_error_redacted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, idempotency_key),
  FOREIGN KEY (clinic_id, rule_id)
    REFERENCES automation_rules(clinic_id, id)
);

CREATE TABLE scheduled_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  automation_run_id uuid,
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  deduplication_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  locked_at timestamptz,
  locked_by text,
  last_error_redacted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, deduplication_key),
  FOREIGN KEY (clinic_id, automation_run_id)
    REFERENCES automation_runs(clinic_id, id)
);

CREATE INDEX scheduled_jobs_ready_idx
  ON scheduled_jobs (run_at)
  WHERE status = 'queued';

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES clinics(id),
  provider text NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_valid boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error_redacted text,
  UNIQUE (provider, external_event_id),
  CHECK (jsonb_typeof(payload_redacted) = 'object')
);

CREATE TABLE api_idempotency_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  key text NOT NULL,
  scope text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, scope, key),
  CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES clinics(id),
  actor_user_id uuid REFERENCES app_users(id),
  actor_membership_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  changed_fields text[],
  before_redacted jsonb,
  after_redacted jsonb,
  request_id text,
  source_ip inet,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, actor_membership_id)
    REFERENCES clinic_memberships(clinic_id, id),
  CHECK (before_redacted IS NULL OR jsonb_typeof(before_redacted) = 'object'),
  CHECK (after_redacted IS NULL OR jsonb_typeof(after_redacted) = 'object')
);

CREATE INDEX audit_logs_clinic_time_idx
  ON audit_logs (clinic_id, occurred_at DESC);

CREATE INDEX audit_logs_entity_idx
  ON audit_logs (clinic_id, entity_type, entity_id, occurred_at DESC);

CREATE TABLE data_retention_policies (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  data_category text NOT NULL,
  retention_months integer NOT NULL CHECK (retention_months > 0),
  legal_basis text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id),
  PRIMARY KEY (clinic_id, data_category)
);

CREATE TABLE data_erasure_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN ('requested', 'reviewing', 'blocked', 'completed', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  legal_hold_reason text,
  requested_by uuid REFERENCES app_users(id),
  reviewed_by uuid REFERENCES app_users(id),
  PRIMARY KEY (id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

COMMIT;
