-- Prevent the same normalized plate from having multiple active parking sessions.
ALTER TABLE public.parking_sessions
  ADD COLUMN IF NOT EXISTS normalized_plate_number text
  GENERATED ALWAYS AS (upper(regexp_replace(plate_number, '[[:space:]-]+', '', 'g'))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parking_sessions_one_active_plate
  ON public.parking_sessions (normalized_plate_number)
  WHERE status = 'active';
