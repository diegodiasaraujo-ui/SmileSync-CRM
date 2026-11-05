BEGIN;

-- Avoid resolving table-specific fields (such as NEW.clinic_id) from a generic
-- trigger record when validating rows in clinics.
CREATE OR REPLACE FUNCTION app.validate_timezone_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
  clinic_id uuid;
BEGIN
  candidate := to_jsonb(NEW) ->> 'timezone';

  IF TG_TABLE_NAME = 'clinic_locations' AND candidate IS NULL THEN
    clinic_id := NULLIF(to_jsonb(NEW) ->> 'clinic_id', '')::uuid;

    SELECT c.timezone
    INTO candidate
    FROM clinics c
    WHERE c.id = clinic_id;
  END IF;

  IF candidate IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = candidate
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', candidate
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
