BEGIN;

-- Kept out of 001 so the base schema can run in PGlite. Production PostgreSQL
-- uses btree_gist for database-enforced scheduling conflicts and pg_trgm for
-- indexed patient search.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX patients_name_trgm_idx
  ON patients USING gin (lower(full_name) gin_trgm_ops)
  WHERE deleted_at IS NULL;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_professional_overlap
  EXCLUDE USING gist (
    clinic_id WITH =,
    professional_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show') AND deleted_at IS NULL);

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_resource_overlap
  EXCLUDE USING gist (
    clinic_id WITH =,
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (
    resource_id IS NOT NULL
    AND status NOT IN ('cancelled', 'no_show')
    AND deleted_at IS NULL
  );

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.set_updated_at_and_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_users_touch_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER clinics_touch_updated_at
BEFORE UPDATE ON clinics
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER clinic_preferences_touch_updated_at
BEFORE UPDATE ON clinic_preferences
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER roles_touch_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER clinic_memberships_touch_updated_at
BEFORE UPDATE ON clinic_memberships
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER professionals_touch_updated_at
BEFORE UPDATE ON professionals
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER clinic_locations_touch_updated_at
BEFORE UPDATE ON clinic_locations
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER clinic_resources_touch_updated_at
BEFORE UPDATE ON clinic_resources
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER patients_touch_updated_at
BEFORE UPDATE ON patients
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at_and_version();

CREATE TRIGGER treatments_touch_updated_at
BEFORE UPDATE ON treatments
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at_and_version();

CREATE TRIGGER appointments_touch_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at_and_version();

CREATE TRIGGER treatment_steps_touch_updated_at
BEFORE UPDATE ON treatment_steps
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER follow_up_tasks_touch_updated_at
BEFORE UPDATE ON follow_up_tasks
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER quotes_touch_updated_at
BEFORE UPDATE ON quotes
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at_and_version();

CREATE TRIGGER receivables_touch_updated_at
BEFORE UPDATE ON receivables
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER integration_configs_touch_updated_at
BEFORE UPDATE ON integration_configs
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER message_templates_touch_updated_at
BEFORE UPDATE ON message_templates
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER message_events_touch_updated_at
BEFORE UPDATE ON message_events
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER automation_rules_touch_updated_at
BEFORE UPDATE ON automation_rules
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER scheduled_jobs_touch_updated_at
BEFORE UPDATE ON scheduled_jobs
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE OR REPLACE FUNCTION app.validate_timezone_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  candidate := CASE
    WHEN TG_TABLE_NAME = 'clinics' THEN NEW.timezone
    ELSE COALESCE(NEW.timezone, (
      SELECT c.timezone FROM clinics c WHERE c.id = NEW.clinic_id
    ))
  END;

  IF candidate IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = candidate
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', candidate
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER clinics_validate_timezone
BEFORE INSERT OR UPDATE OF timezone ON clinics
FOR EACH ROW EXECUTE FUNCTION app.validate_timezone_name();

CREATE TRIGGER clinic_locations_validate_timezone
BEFORE INSERT OR UPDATE OF timezone, clinic_id ON clinic_locations
FOR EACH ROW EXECUTE FUNCTION app.validate_timezone_name();

CREATE OR REPLACE FUNCTION app.recalculate_quote_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  target_clinic_id uuid;
  target_quote_id uuid;
  new_subtotal numeric(14,2);
  new_discount numeric(14,2);
  new_total numeric(14,2);
BEGIN
  target_clinic_id := COALESCE(NEW.clinic_id, OLD.clinic_id);
  target_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);

  SELECT
    COALESCE(SUM(quantity * unit_price), 0)::numeric(14,2),
    COALESCE(SUM(discount_amount), 0)::numeric(14,2),
    COALESCE(SUM(line_total), 0)::numeric(14,2)
  INTO new_subtotal, new_discount, new_total
  FROM quote_items
  WHERE clinic_id = target_clinic_id AND quote_id = target_quote_id;

  UPDATE quotes
  SET
    subtotal = new_subtotal,
    discount_amount = new_discount,
    total_amount = new_total
  WHERE clinic_id = target_clinic_id AND id = target_quote_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER quote_items_recalculate_totals
AFTER INSERT OR UPDATE OR DELETE ON quote_items
FOR EACH ROW EXECUTE FUNCTION app.recalculate_quote_totals();

CREATE OR REPLACE FUNCTION app.validate_installment_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  receivable_total numeric(14,2);
  planned_total numeric(14,2);
BEGIN
  SELECT total_amount
  INTO receivable_total
  FROM receivables
  WHERE clinic_id = NEW.clinic_id AND id = NEW.receivable_id
  FOR UPDATE;

  IF receivable_total IS NULL THEN
    RAISE EXCEPTION 'Receivable not found for installment'
      USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(SUM(amount), 0)::numeric(14,2)
  INTO planned_total
  FROM installments
  WHERE clinic_id = NEW.clinic_id
    AND receivable_id = NEW.receivable_id
    AND id <> NEW.id
    AND cancelled_at IS NULL;

  planned_total := planned_total + NEW.amount;

  IF planned_total > receivable_total THEN
    RAISE EXCEPTION 'Installment plan (%) exceeds receivable total (%)',
      planned_total, receivable_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER installments_validate_total
BEFORE INSERT OR UPDATE OF amount, receivable_id, clinic_id, cancelled_at
ON installments
FOR EACH ROW
WHEN (NEW.cancelled_at IS NULL)
EXECUTE FUNCTION app.validate_installment_total();

CREATE OR REPLACE FUNCTION app.validate_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  payment_total numeric(14,2);
  payment_patient_id uuid;
  payment_status text;
  installment_total numeric(14,2);
  receivable_patient_id uuid;
  receivable_status text;
  installment_cancelled_at timestamptz;
  allocated_to_payment numeric(14,2);
  allocated_to_installment numeric(14,2);
BEGIN
  SELECT amount, patient_id, status
  INTO payment_total, payment_patient_id, payment_status
  FROM payments
  WHERE clinic_id = NEW.clinic_id AND id = NEW.payment_id
  FOR UPDATE;

  IF payment_total IS NULL THEN
    RAISE EXCEPTION 'Payment not found for allocation'
      USING ERRCODE = '23503';
  END IF;

  SELECT i.amount, r.patient_id, r.status, i.cancelled_at
  INTO installment_total, receivable_patient_id, receivable_status,
    installment_cancelled_at
  FROM installments i
  JOIN receivables r
    ON r.clinic_id = i.clinic_id AND r.id = i.receivable_id
  WHERE i.clinic_id = NEW.clinic_id AND i.id = NEW.installment_id
  FOR UPDATE OF i, r;

  IF installment_total IS NULL THEN
    RAISE EXCEPTION 'Installment not found for allocation'
      USING ERRCODE = '23503';
  END IF;

  IF payment_status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted payments can be allocated'
      USING ERRCODE = '23514';
  END IF;

  IF receivable_status <> 'open' OR installment_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot allocate to a cancelled or closed receivable'
      USING ERRCODE = '23514';
  END IF;

  IF payment_patient_id <> receivable_patient_id THEN
    RAISE EXCEPTION 'Payment and installment belong to different patients'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0)::numeric(14,2)
  INTO allocated_to_payment
  FROM payment_allocations
  WHERE clinic_id = NEW.clinic_id
    AND payment_id = NEW.payment_id
    AND id <> NEW.id;

  SELECT COALESCE(SUM(pa.amount), 0)::numeric(14,2)
  INTO allocated_to_installment
  FROM payment_allocations pa
  JOIN payments p
    ON p.clinic_id = pa.clinic_id AND p.id = pa.payment_id
  WHERE pa.clinic_id = NEW.clinic_id
    AND pa.installment_id = NEW.installment_id
    AND pa.id <> NEW.id
    AND p.status = 'posted';

  IF allocated_to_payment + NEW.amount > payment_total THEN
    RAISE EXCEPTION 'Allocation exceeds payment amount'
      USING ERRCODE = '23514';
  END IF;

  IF allocated_to_installment + NEW.amount > installment_total THEN
    RAISE EXCEPTION 'Allocation exceeds installment balance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_allocations_validate
BEFORE INSERT OR UPDATE OF clinic_id, payment_id, installment_id, amount
ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION app.validate_payment_allocation();

CREATE OR REPLACE FUNCTION app.protect_payment_core_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('voided', 'refunded') THEN
    RAISE EXCEPTION 'A voided or refunded payment is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.clinic_id <> OLD.clinic_id
    OR NEW.patient_id <> OLD.patient_id
    OR NEW.amount <> OLD.amount
    OR NEW.method <> OLD.method
    OR NEW.paid_at <> OLD.paid_at
    OR NEW.idempotency_key <> OLD.idempotency_key
    OR NEW.created_by <> OLD.created_by
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Core payment fields are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'posted' AND NEW.status NOT IN ('posted', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'Invalid payment status transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_protect_core_fields
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION app.protect_payment_core_fields();

CREATE OR REPLACE FUNCTION app.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
REVOKE ALL ON user_sessions, password_reset_tokens FROM PUBLIC;

-- These policies are for restricted database roles and for a possible future
-- direct-access client. The current API connects as the schema owner, keeps the
-- database private, and enforces tenant/permission predicates in every query.
-- Mutating API transactions also set this context so audit triggers can record
-- the authenticated actor. Never expose the owner connection to a browser.
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_clinic_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.clinic_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_membership_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.membership_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_request_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.request_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app.is_active_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clinic_memberships m
    JOIN clinics c ON c.id = m.clinic_id
    WHERE m.id = app.current_membership_id()
      AND m.clinic_id = app.current_clinic_id()
      AND m.user_id = app.current_user_id()
      AND m.status = 'active'
      AND c.status = 'active'
      AND c.deleted_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION app.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clinic_memberships m
    JOIN clinics c ON c.id = m.clinic_id
    JOIN role_permissions rp
      ON rp.clinic_id = m.clinic_id AND rp.role_id = m.role_id
    WHERE m.id = app.current_membership_id()
      AND m.clinic_id = app.current_clinic_id()
      AND m.user_id = app.current_user_id()
      AND m.status = 'active'
      AND c.status = 'active'
      AND c.deleted_at IS NULL
      AND rp.permission_code = required_permission
  )
$$;

REVOKE EXECUTE ON FUNCTION app.is_active_member() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.has_permission(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.configure_tenant_rls(
  target_table regclass,
  read_permission text,
  create_permission text,
  update_permission text,
  delete_permission text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);

  IF read_permission IS NOT NULL THEN
    EXECUTE format(
      'CREATE POLICY tenant_select ON %s FOR SELECT USING '
      || '(clinic_id = app.current_clinic_id() AND app.has_permission(%L))',
      target_table,
      read_permission
    );
  END IF;

  IF create_permission IS NOT NULL THEN
    EXECUTE format(
      'CREATE POLICY tenant_insert ON %s FOR INSERT WITH CHECK '
      || '(clinic_id = app.current_clinic_id() AND app.has_permission(%L))',
      target_table,
      create_permission
    );
  END IF;

  IF update_permission IS NOT NULL THEN
    EXECUTE format(
      'CREATE POLICY tenant_update ON %s FOR UPDATE USING '
      || '(clinic_id = app.current_clinic_id() AND app.has_permission(%L)) '
      || 'WITH CHECK '
      || '(clinic_id = app.current_clinic_id() AND app.has_permission(%L))',
      target_table,
      update_permission,
      update_permission
    );
  END IF;

  IF delete_permission IS NOT NULL THEN
    EXECUTE format(
      'CREATE POLICY tenant_delete ON %s FOR DELETE USING '
      || '(clinic_id = app.current_clinic_id() AND app.has_permission(%L))',
      target_table,
      delete_permission
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.configure_internal_tenant_rls(target_table regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format(
    'CREATE POLICY tenant_member_all ON %s FOR ALL USING '
    || '(clinic_id = app.current_clinic_id() AND app.is_active_member()) '
    || 'WITH CHECK '
    || '(clinic_id = app.current_clinic_id() AND app.is_active_member())',
    target_table
  );
END;
$$;

ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinics_select ON clinics
FOR SELECT
USING (id = app.current_clinic_id() AND app.is_active_member());

CREATE POLICY clinics_update ON clinics
FOR UPDATE
USING (
  id = app.current_clinic_id()
  AND app.has_permission('clinic.settings.update')
)
WITH CHECK (
  id = app.current_clinic_id()
  AND app.has_permission('clinic.settings.update')
);

SELECT app.configure_tenant_rls(
  'clinic_preferences',
  'clinic.settings.read', NULL, 'clinic.settings.update'
);
SELECT app.configure_tenant_rls(
  'roles', 'team.read', 'team.update', 'team.update'
);
SELECT app.configure_tenant_rls(
  'role_permissions', 'team.read', 'team.update', 'team.update'
);
SELECT app.configure_tenant_rls(
  'clinic_memberships', 'team.read', 'team.invite', 'team.update'
);
SELECT app.configure_tenant_rls(
  'clinic_invites', 'team.read', 'team.invite', 'team.update'
);
SELECT app.configure_tenant_rls(
  'professionals', 'team.read', 'team.update', 'team.update'
);
SELECT app.configure_tenant_rls(
  'clinic_locations',
  'clinic.settings.read', 'clinic.settings.update', 'clinic.settings.update'
);
SELECT app.configure_tenant_rls(
  'clinic_resources',
  'clinic.settings.read', 'clinic.settings.update', 'clinic.settings.update'
);

SELECT app.configure_tenant_rls(
  'patients', 'patients.read', 'patients.create', 'patients.update'
);
SELECT app.configure_tenant_rls(
  'tags', 'patients.read', 'patients.update', 'patients.update'
);
SELECT app.configure_tenant_rls(
  'patient_tags', 'patients.read', 'patients.update', 'patients.update'
);
SELECT app.configure_tenant_rls(
  'patient_consents', 'patients.read', 'patients.update', 'patients.update'
);
SELECT app.configure_tenant_rls(
  'patient_interactions', 'patients.read', 'patients.update', 'patients.update'
);
SELECT app.configure_tenant_rls(
  'follow_up_tasks', 'patients.read', 'patients.update', 'patients.update'
);

SELECT app.configure_tenant_rls(
  'appointments',
  'appointments.read', 'appointments.create', 'appointments.update'
);
SELECT app.configure_tenant_rls(
  'appointment_status_history',
  'appointments.read', 'appointments.update', NULL
);

SELECT app.configure_tenant_rls(
  'treatments', 'treatments.read', 'treatments.write', 'treatments.write'
);
SELECT app.configure_tenant_rls(
  'treatment_steps', 'treatments.read', 'treatments.write', 'treatments.write'
);
SELECT app.configure_tenant_rls(
  'treatment_status_history',
  'treatments.read', 'treatments.write', NULL
);
SELECT app.configure_tenant_rls(
  'clinical_evolutions',
  'treatments.clinical.read', 'treatments.clinical.write', NULL
);
SELECT app.configure_tenant_rls(
  'medications',
  'treatments.clinical.read', 'treatments.clinical.write', NULL
);
SELECT app.configure_tenant_rls(
  'clinical_documents',
  'treatments.clinical.read', 'treatments.clinical.write',
  'treatments.clinical.write'
);

SELECT app.configure_tenant_rls(
  'quotes', 'quotes.read', 'quotes.create', 'quotes.update'
);
SELECT app.configure_tenant_rls(
  'quote_items', 'quotes.read', 'quotes.create', 'quotes.update'
);
SELECT app.configure_tenant_rls(
  'quote_status_history', 'quotes.read', 'quotes.approve', NULL
);

SELECT app.configure_tenant_rls(
  'receivables',
  'finance.details.read', 'finance.charges.write', 'finance.charges.write'
);
SELECT app.configure_tenant_rls(
  'installments',
  'finance.details.read', 'finance.charges.write', 'finance.charges.write'
);
SELECT app.configure_tenant_rls(
  'payments',
  'finance.details.read', 'finance.payments.write', 'finance.payments.void'
);
SELECT app.configure_tenant_rls(
  'payment_allocations',
  'finance.details.read', 'finance.payments.write', 'finance.payments.write'
);

SELECT app.configure_tenant_rls(
  'integration_configs',
  'integrations.read', 'integrations.update', 'integrations.update'
);
SELECT app.configure_tenant_rls(
  'message_templates',
  'integrations.read', 'integrations.update', 'integrations.update'
);
SELECT app.configure_tenant_rls(
  'message_events',
  'automations.read', 'automations.update', 'automations.update'
);
SELECT app.configure_tenant_rls(
  'automation_rules',
  'automations.read', 'automations.update', 'automations.update'
);
SELECT app.configure_tenant_rls(
  'audit_logs', 'audit.read', NULL, NULL
);
SELECT app.configure_tenant_rls(
  'data_retention_policies',
  'clinic.settings.read', 'clinic.settings.update', 'clinic.settings.update'
);
SELECT app.configure_tenant_rls(
  'data_erasure_requests',
  'clinic.settings.read', 'clinic.settings.update', 'clinic.settings.update'
);

SELECT app.configure_internal_tenant_rls('automation_runs');
SELECT app.configure_internal_tenant_rls('scheduled_jobs');
SELECT app.configure_internal_tenant_rls('api_idempotency_keys');

-- Webhooks can arrive before a user context exists. Only the worker/service role
-- should have table privileges; ordinary RLS-bound roles receive no policy.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Minimal audit entries contain identifiers and the list of changed columns,
-- never unrestricted clinical/financial payload snapshots.
CREATE OR REPLACE FUNCTION app.record_minimal_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
SET row_security = off
AS $$
DECLARE
  old_row jsonb := COALESCE(to_jsonb(OLD), '{}'::jsonb);
  new_row jsonb := COALESCE(to_jsonb(NEW), '{}'::jsonb);
  row_clinic_id uuid;
  row_entity_id uuid;
  field_names text[];
BEGIN
  row_clinic_id := COALESCE(
    nullif(new_row ->> 'clinic_id', '')::uuid,
    nullif(old_row ->> 'clinic_id', '')::uuid
  );
  row_entity_id := COALESCE(
    nullif(new_row ->> 'id', '')::uuid,
    nullif(old_row ->> 'id', '')::uuid
  );

  SELECT array_agg(keys.key ORDER BY keys.key)
  INTO field_names
  FROM (
    SELECT COALESCE(n.key, o.key) AS key
    FROM jsonb_each(new_row) n
    FULL JOIN jsonb_each(old_row) o USING (key)
    WHERE n.value IS DISTINCT FROM o.value
  ) keys;

  INSERT INTO audit_logs (
    clinic_id,
    actor_user_id,
    actor_membership_id,
    action,
    entity_type,
    entity_id,
    changed_fields,
    request_id
  ) VALUES (
    row_clinic_id,
    app.current_user_id(),
    app.current_membership_id(),
    lower(TG_OP),
    TG_TABLE_NAME,
    row_entity_id,
    field_names,
    app.current_request_id()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER patients_audit
AFTER INSERT OR UPDATE OR DELETE ON patients
FOR EACH ROW EXECUTE FUNCTION app.record_minimal_audit_event();

CREATE TRIGGER appointments_audit
AFTER INSERT OR UPDATE OR DELETE ON appointments
FOR EACH ROW EXECUTE FUNCTION app.record_minimal_audit_event();

CREATE TRIGGER treatments_audit
AFTER INSERT OR UPDATE OR DELETE ON treatments
FOR EACH ROW EXECUTE FUNCTION app.record_minimal_audit_event();

CREATE TRIGGER quotes_audit
AFTER INSERT OR UPDATE OR DELETE ON quotes
FOR EACH ROW EXECUTE FUNCTION app.record_minimal_audit_event();

CREATE TRIGGER receivables_audit
AFTER INSERT OR UPDATE OR DELETE ON receivables
FOR EACH ROW EXECUTE FUNCTION app.record_minimal_audit_event();

CREATE TRIGGER payments_audit
AFTER INSERT OR UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION app.record_minimal_audit_event();

CREATE TRIGGER clinic_memberships_audit
AFTER INSERT OR UPDATE OR DELETE ON clinic_memberships
FOR EACH ROW EXECUTE FUNCTION app.record_minimal_audit_event();

CREATE TRIGGER automation_rules_audit
AFTER INSERT OR UPDATE OR DELETE ON automation_rules
FOR EACH ROW EXECUTE FUNCTION app.record_minimal_audit_event();

COMMIT;
