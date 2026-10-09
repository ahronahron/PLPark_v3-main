-- Link mobile profiles to Supabase Auth and store required vehicle make data.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS make text;
