-- Each trigger has its own NEW record shape. Access the location-only
-- clinic_id in a separate statement so a clinics write never resolves it.
CREATE OR REPLACE FUNCTION app.validate_timezone_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  candidate text := NEW.timezone;
BEGIN
  IF TG_TABLE_NAME = 'clinic_locations' AND candidate IS NULL THEN
    SELECT timezone INTO candidate FROM public.clinics WHERE id = NEW.clinic_id;
  END IF;

  IF candidate IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = candidate
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', candidate
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;
