-- Link mobile profiles to Supabase Auth and store required vehicle make data.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS make text;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS normalized_plate_number text
  GENERATED ALWAYS AS (upper(regexp_replace(plate_number, '[[:space:]-]+', '', 'g'))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_normalized_plate_unique
  ON public.vehicles (normalized_plate_number);
