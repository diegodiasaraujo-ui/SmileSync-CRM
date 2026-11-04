BEGIN;

ALTER TABLE patient_interactions
  ADD COLUMN IF NOT EXISTS sensitivity text;

UPDATE patient_interactions
SET sensitivity = CASE
  WHEN lower(kind) IN (
    'clínico', 'clinico', 'atestado', 'afastamento', 'prescrição', 'prescricao',
    'medicação', 'medicacao', 'documento', 'evolução', 'evolucao'
  ) THEN 'clinical'
  WHEN lower(kind) IN ('financeiro', 'pagamento', 'cobrança', 'cobranca') THEN 'financial'
  ELSE 'operational'
END
WHERE sensitivity IS NULL;

ALTER TABLE patient_interactions
  ALTER COLUMN sensitivity SET DEFAULT 'operational';

ALTER TABLE patient_interactions
  ALTER COLUMN sensitivity SET NOT NULL;

ALTER TABLE patient_interactions
  ADD CONSTRAINT patient_interactions_sensitivity_check
  CHECK (sensitivity IN ('operational', 'clinical', 'financial'));

CREATE INDEX patient_interactions_sensitivity_time_idx
  ON patient_interactions (clinic_id, sensitivity, occurred_at DESC);

DELETE FROM role_permissions permissions
USING roles
WHERE permissions.clinic_id = roles.clinic_id
  AND permissions.role_id = roles.id
  AND roles.is_system = true
  AND roles.code IN ('dentista', 'secretaria')
  AND permissions.permission_code IN ('quotes.read', 'quotes.create');

COMMIT;
