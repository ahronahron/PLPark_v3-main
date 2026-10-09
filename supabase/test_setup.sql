-- =============================================================================
-- PLPark TEST PROJECT SETUP
-- Paste this entire file into the SQL Editor of an EMPTY Supabase test project.
-- Do NOT run this against production.
--
-- Combined from supabase/migrations/ in filename order:
--   1. 20260807101219_parking_management_schema.sql
--   2. 20260807101415_seed_parking_data.sql   (hourly rates set to 50 / 25)
--   3. 20260809020000_vision_pipeline_storage.sql
--   4. 20260819072802_add_aoi_polygon_to_parking_slots.sql
--   5. 20260819090000_add_camera_device_id.sql
--   6. 20260825090000_camera_connection_details.sql
--   7. 20260922090000_admin_auth_rls.sql
--   8. 20261009090000_mobile_account_vehicle_fields.sql
--   9. 20261009110000_prevent_duplicate_active_sessions.sql
--   10. 20261009120000_wallet_transaction_history.sql
--
-- Original migration files were not modified.
-- Storage recap + dashboard steps are at the bottom (section 8).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema: tables, open RLS policies, indexes
--    (from 20260807101219_parking_management_schema.sql)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  username text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'admin',
  status text NOT NULL DEFAULT 'active',
  email text UNIQUE NOT NULL,
  last_login timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_users" ON users;
CREATE POLICY "anon_select_users" ON users FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_users" ON users;
CREATE POLICY "anon_insert_users" ON users FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_users" ON users;
CREATE POLICY "anon_update_users" ON users FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_users" ON users;
CREATE POLICY "anon_delete_users" ON users FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  wallet_balance numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_app_users" ON app_users;
CREATE POLICY "anon_select_app_users" ON app_users FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_app_users" ON app_users;
CREATE POLICY "anon_insert_app_users" ON app_users FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_app_users" ON app_users;
CREATE POLICY "anon_update_app_users" ON app_users FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_app_users" ON app_users;
CREATE POLICY "anon_delete_app_users" ON app_users FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  plate_number text NOT NULL,
  normalized_plate_number text GENERATED ALWAYS AS (upper(regexp_replace(plate_number, '[[:space:]-]+', '', 'g'))) STORED,
  vehicle_type text NOT NULL DEFAULT 'car',
  make text,
  color text,
  image_url text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_vehicles" ON vehicles;
CREATE POLICY "anon_select_vehicles" ON vehicles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_vehicles" ON vehicles;
CREATE POLICY "anon_insert_vehicles" ON vehicles FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_vehicles" ON vehicles;
CREATE POLICY "anon_update_vehicles" ON vehicles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_vehicles" ON vehicles;
CREATE POLICY "anon_delete_vehicles" ON vehicles FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS parking_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id text NOT NULL,
  floor text NOT NULL DEFAULT 'Ground',
  vehicle_type text NOT NULL DEFAULT 'car',
  status text NOT NULL DEFAULT 'available',
  current_session_id uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE parking_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_parking_slots" ON parking_slots;
CREATE POLICY "anon_select_parking_slots" ON parking_slots FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_parking_slots" ON parking_slots;
CREATE POLICY "anon_insert_parking_slots" ON parking_slots FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_parking_slots" ON parking_slots;
CREATE POLICY "anon_update_parking_slots" ON parking_slots FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_parking_slots" ON parking_slots;
CREATE POLICY "anon_delete_parking_slots" ON parking_slots FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS parking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text NOT NULL,
  normalized_plate_number text GENERATED ALWAYS AS (upper(regexp_replace(plate_number, '[[:space:]-]+', '', 'g'))) STORED,
  vehicle_type text NOT NULL DEFAULT 'car',
  color text,
  image_url text,
  concept text NOT NULL DEFAULT 'A',
  entry_camera text,
  exit_camera text,
  slot_id text,
  status text NOT NULL DEFAULT 'active',
  entry_time timestamptz NOT NULL DEFAULT now(),
  exit_time timestamptz,
  app_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE parking_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_parking_sessions" ON parking_sessions;
CREATE POLICY "anon_select_parking_sessions" ON parking_sessions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_parking_sessions" ON parking_sessions;
CREATE POLICY "anon_insert_parking_sessions" ON parking_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_parking_sessions" ON parking_sessions;
CREATE POLICY "anon_update_parking_sessions" ON parking_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_parking_sessions" ON parking_sessions;
CREATE POLICY "anon_delete_parking_sessions" ON parking_sessions FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'entrance',
  location text,
  is_online boolean NOT NULL DEFAULT true,
  slot_range text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE cameras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_cameras" ON cameras;
CREATE POLICY "anon_select_cameras" ON cameras FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_cameras" ON cameras;
CREATE POLICY "anon_insert_cameras" ON cameras FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_cameras" ON cameras;
CREATE POLICY "anon_update_cameras" ON cameras FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_cameras" ON cameras;
CREATE POLICY "anon_delete_cameras" ON cameras FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS plate_recognitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text NOT NULL,
  vehicle_type text,
  direction text NOT NULL DEFAULT 'entry',
  confidence numeric(5,2) NOT NULL DEFAULT 95.00,
  camera_id uuid REFERENCES cameras(id) ON DELETE SET NULL,
  camera_name text,
  image_url text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE plate_recognitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_plate_recognitions" ON plate_recognitions;
CREATE POLICY "anon_select_plate_recognitions" ON plate_recognitions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_plate_recognitions" ON plate_recognitions;
CREATE POLICY "anon_insert_plate_recognitions" ON plate_recognitions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_plate_recognitions" ON plate_recognitions;
CREATE POLICY "anon_update_plate_recognitions" ON plate_recognitions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_plate_recognitions" ON plate_recognitions;
CREATE POLICY "anon_delete_plate_recognitions" ON plate_recognitions FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text UNIQUE NOT NULL,
  plate_number text NOT NULL,
  session_id uuid REFERENCES parking_sessions(id) ON DELETE SET NULL,
  duration_hours numeric(8,2) NOT NULL DEFAULT 0,
  hourly_rate numeric(8,2) NOT NULL DEFAULT 50.00,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'completed',
  processed_by text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_payments" ON payments;
CREATE POLICY "anon_select_payments" ON payments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
CREATE POLICY "anon_insert_payments" ON payments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_payments" ON payments;
CREATE POLICY "anon_update_payments" ON payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_payments" ON payments;
CREATE POLICY "anon_delete_payments" ON payments FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES parking_sessions(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('top_up', 'deduction')),
  amount numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_transactions TO anon, authenticated;
CREATE POLICY anon_full_access_wallet_transactions ON wallet_transactions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY authenticated_full_access_wallet_transactions ON wallet_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_app_user_id uuid,
  p_amount numeric,
  p_transaction_type text,
  p_session_id uuid,
  p_payment_id uuid,
  p_description text
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_balance_after numeric(12,2);
BEGIN
  IF p_transaction_type NOT IN ('top_up', 'deduction') THEN
    RAISE EXCEPTION 'Unsupported wallet transaction type';
  END IF;
  IF (p_transaction_type = 'top_up' AND p_amount <= 0)
     OR (p_transaction_type = 'deduction' AND p_amount >= 0) THEN
    RAISE EXCEPTION 'Wallet transaction amount has the wrong sign';
  END IF;
  UPDATE public.app_users SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_app_user_id RETURNING wallet_balance INTO v_balance_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'App user not found'; END IF;
  INSERT INTO public.wallet_transactions (app_user_id, session_id, payment_id, transaction_type, amount, balance_after, description)
  VALUES (p_app_user_id, p_session_id, p_payment_id, p_transaction_type, p_amount, v_balance_after, p_description);
  RETURN v_balance_after;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_wallet_transaction(uuid, numeric, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, numeric, text, uuid, uuid, text) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text,
  image_url text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_notifications" ON notifications;
CREATE POLICY "anon_select_notifications" ON notifications FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_notifications" ON notifications;
CREATE POLICY "anon_insert_notifications" ON notifications FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_notifications" ON notifications;
CREATE POLICY "anon_update_notifications" ON notifications FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_notifications" ON notifications;
CREATE POLICY "anon_delete_notifications" ON notifications FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_settings" ON settings;
CREATE POLICY "anon_select_settings" ON settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_settings" ON settings;
CREATE POLICY "anon_insert_settings" ON settings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_settings" ON settings;
CREATE POLICY "anon_update_settings" ON settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_settings" ON settings;
CREATE POLICY "anon_delete_settings" ON settings FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_name text,
  action text NOT NULL,
  module text NOT NULL,
  details text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_activity_logs" ON activity_logs;
CREATE POLICY "anon_select_activity_logs" ON activity_logs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_activity_logs" ON activity_logs;
CREATE POLICY "anon_insert_activity_logs" ON activity_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_activity_logs" ON activity_logs;
CREATE POLICY "anon_update_activity_logs" ON activity_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_activity_logs" ON activity_logs;
CREATE POLICY "anon_delete_activity_logs" ON activity_logs FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_parking_sessions_plate ON parking_sessions(plate_number);
CREATE INDEX IF NOT EXISTS idx_parking_sessions_status ON parking_sessions(status);
CREATE INDEX IF NOT EXISTS idx_plate_recognitions_created ON plate_recognitions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created ON wallet_transactions(app_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_session ON wallet_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_parking_slots_status ON parking_slots(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_normalized_plate_unique ON vehicles(normalized_plate_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parking_sessions_one_active_plate ON parking_sessions(normalized_plate_number) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 2. Seed data
--    (from 20260807101415_seed_parking_data.sql)
--    TEST-ONLY change: hourly_rate_car = 50, hourly_rate_motorcycle = 25
--    Original migration still seeds 0; do not use that file for this test project.
-- ---------------------------------------------------------------------------

BEGIN;

TRUNCATE TABLE activity_logs, notifications, wallet_transactions, payments, parking_sessions, plate_recognitions, cameras, parking_slots, vehicles, app_users, users, settings RESTART IDENTITY CASCADE;

INSERT INTO users (full_name, username, role, status, email, last_login)
VALUES ('Administrator', 'admin', 'admin', 'active', 'admin@parking.local', now())
ON CONFLICT (username) DO UPDATE SET full_name=EXCLUDED.full_name, role=EXCLUDED.role, status=EXCLUDED.status, email=EXCLUDED.email;

INSERT INTO settings (key, value) VALUES
('max_capacity_cars', '0'::jsonb),
('max_capacity_motorcycles', '0'::jsonb),
('hourly_rate_car', '50'::jsonb),
('hourly_rate_motorcycle', '25'::jsonb),
('currency', '"₱"'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Vision pipeline: plate_image_url + storage bucket
--    (from 20260809020000_vision_pipeline_storage.sql)
-- ---------------------------------------------------------------------------

ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS plate_image_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-snapshots',
  'vehicle-snapshots',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read access for vehicle snapshots" ON storage.objects;
CREATE POLICY "Public read access for vehicle snapshots"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots');

DROP POLICY IF EXISTS "Allow upload vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow upload vehicle snapshots"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'vehicle-snapshots');

DROP POLICY IF EXISTS "Allow update vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow update vehicle snapshots"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots')
WITH CHECK (bucket_id = 'vehicle-snapshots');

DROP POLICY IF EXISTS "Allow delete vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow delete vehicle snapshots"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots');

-- ---------------------------------------------------------------------------
-- 4. AOI polygon on parking_slots
--    (from 20260819072802_add_aoi_polygon_to_parking_slots.sql)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parking_slots' AND column_name = 'aoi_polygon') THEN
    ALTER TABLE parking_slots ADD COLUMN aoi_polygon jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parking_slots' AND column_name = 'camera_id') THEN
    ALTER TABLE parking_slots ADD COLUMN camera_id uuid REFERENCES cameras(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parking_slots' AND column_name = 'aoi_color') THEN
    ALTER TABLE parking_slots ADD COLUMN aoi_color text;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Camera device_id
--    (from 20260819090000_add_camera_device_id.sql)
-- ---------------------------------------------------------------------------

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS device_id text;

-- ---------------------------------------------------------------------------
-- 6. Camera connection details
--    (from 20260825090000_camera_connection_details.sql)
-- ---------------------------------------------------------------------------

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'device';

-- ---------------------------------------------------------------------------
-- 7. Existing branch RLS policies (from 20260922090000_admin_auth_rls.sql)
--    Included because it is already in migrations/. This task does not
--    change that migration. After this section, writes require authenticated.
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

UPDATE users u
SET user_id = au.id
FROM auth.users au
WHERE u.user_id IS NULL
  AND lower(u.email) = lower(au.email);

DROP POLICY IF EXISTS "anon_select_users" ON users;
DROP POLICY IF EXISTS "anon_insert_users" ON users;
DROP POLICY IF EXISTS "anon_update_users" ON users;
DROP POLICY IF EXISTS "anon_delete_users" ON users;
DROP POLICY IF EXISTS "authenticated_select_users" ON users;
DROP POLICY IF EXISTS "authenticated_insert_users" ON users;
DROP POLICY IF EXISTS "authenticated_update_users" ON users;
DROP POLICY IF EXISTS "authenticated_delete_users" ON users;
CREATE POLICY "authenticated_select_users" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_users" ON users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_users" ON users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_users" ON users FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_payments" ON payments;
DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
DROP POLICY IF EXISTS "anon_update_payments" ON payments;
DROP POLICY IF EXISTS "anon_delete_payments" ON payments;
DROP POLICY IF EXISTS "authenticated_select_payments" ON payments;
DROP POLICY IF EXISTS "authenticated_insert_payments" ON payments;
DROP POLICY IF EXISTS "authenticated_update_payments" ON payments;
DROP POLICY IF EXISTS "authenticated_delete_payments" ON payments;
CREATE POLICY "authenticated_select_payments" ON payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_payments" ON payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_payments" ON payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_payments" ON payments FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_parking_sessions" ON parking_sessions;
DROP POLICY IF EXISTS "anon_insert_parking_sessions" ON parking_sessions;
DROP POLICY IF EXISTS "anon_update_parking_sessions" ON parking_sessions;
DROP POLICY IF EXISTS "anon_delete_parking_sessions" ON parking_sessions;
DROP POLICY IF EXISTS "authenticated_select_parking_sessions" ON parking_sessions;
DROP POLICY IF EXISTS "authenticated_insert_parking_sessions" ON parking_sessions;
DROP POLICY IF EXISTS "authenticated_update_parking_sessions" ON parking_sessions;
DROP POLICY IF EXISTS "authenticated_delete_parking_sessions" ON parking_sessions;
CREATE POLICY "authenticated_select_parking_sessions" ON parking_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_parking_sessions" ON parking_sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_parking_sessions" ON parking_sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_parking_sessions" ON parking_sessions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_app_users" ON app_users;
DROP POLICY IF EXISTS "anon_insert_app_users" ON app_users;
DROP POLICY IF EXISTS "anon_update_app_users" ON app_users;
DROP POLICY IF EXISTS "anon_delete_app_users" ON app_users;
DROP POLICY IF EXISTS "authenticated_select_app_users" ON app_users;
DROP POLICY IF EXISTS "authenticated_insert_app_users" ON app_users;
DROP POLICY IF EXISTS "authenticated_update_app_users" ON app_users;
DROP POLICY IF EXISTS "authenticated_delete_app_users" ON app_users;
CREATE POLICY "authenticated_select_app_users" ON app_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_app_users" ON app_users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_app_users" ON app_users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_app_users" ON app_users FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_vehicles" ON vehicles;
DROP POLICY IF EXISTS "anon_insert_vehicles" ON vehicles;
DROP POLICY IF EXISTS "anon_update_vehicles" ON vehicles;
DROP POLICY IF EXISTS "anon_delete_vehicles" ON vehicles;
DROP POLICY IF EXISTS "authenticated_select_vehicles" ON vehicles;
DROP POLICY IF EXISTS "authenticated_insert_vehicles" ON vehicles;
DROP POLICY IF EXISTS "authenticated_update_vehicles" ON vehicles;
DROP POLICY IF EXISTS "authenticated_delete_vehicles" ON vehicles;
CREATE POLICY "authenticated_select_vehicles" ON vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_vehicles" ON vehicles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_vehicles" ON vehicles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_vehicles" ON vehicles FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_cameras" ON cameras;
DROP POLICY IF EXISTS "anon_insert_cameras" ON cameras;
DROP POLICY IF EXISTS "anon_update_cameras" ON cameras;
DROP POLICY IF EXISTS "anon_delete_cameras" ON cameras;
DROP POLICY IF EXISTS "authenticated_select_cameras" ON cameras;
DROP POLICY IF EXISTS "authenticated_insert_cameras" ON cameras;
DROP POLICY IF EXISTS "authenticated_update_cameras" ON cameras;
DROP POLICY IF EXISTS "authenticated_delete_cameras" ON cameras;
DROP POLICY IF EXISTS "public_select_cameras" ON cameras;
CREATE POLICY "public_select_cameras" ON cameras FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated_insert_cameras" ON cameras FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_cameras" ON cameras FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_cameras" ON cameras FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_parking_slots" ON parking_slots;
DROP POLICY IF EXISTS "anon_insert_parking_slots" ON parking_slots;
DROP POLICY IF EXISTS "anon_update_parking_slots" ON parking_slots;
DROP POLICY IF EXISTS "anon_delete_parking_slots" ON parking_slots;
DROP POLICY IF EXISTS "authenticated_insert_parking_slots" ON parking_slots;
DROP POLICY IF EXISTS "authenticated_update_parking_slots" ON parking_slots;
DROP POLICY IF EXISTS "authenticated_delete_parking_slots" ON parking_slots;
DROP POLICY IF EXISTS "public_select_parking_slots" ON parking_slots;
CREATE POLICY "public_select_parking_slots" ON parking_slots FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated_insert_parking_slots" ON parking_slots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_parking_slots" ON parking_slots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_parking_slots" ON parking_slots FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_plate_recognitions" ON plate_recognitions;
DROP POLICY IF EXISTS "anon_insert_plate_recognitions" ON plate_recognitions;
DROP POLICY IF EXISTS "anon_update_plate_recognitions" ON plate_recognitions;
DROP POLICY IF EXISTS "anon_delete_plate_recognitions" ON plate_recognitions;
DROP POLICY IF EXISTS "authenticated_select_plate_recognitions" ON plate_recognitions;
DROP POLICY IF EXISTS "authenticated_insert_plate_recognitions" ON plate_recognitions;
DROP POLICY IF EXISTS "authenticated_update_plate_recognitions" ON plate_recognitions;
DROP POLICY IF EXISTS "authenticated_delete_plate_recognitions" ON plate_recognitions;
CREATE POLICY "authenticated_select_plate_recognitions" ON plate_recognitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_plate_recognitions" ON plate_recognitions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_plate_recognitions" ON plate_recognitions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_plate_recognitions" ON plate_recognitions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_notifications" ON notifications;
DROP POLICY IF EXISTS "anon_insert_notifications" ON notifications;
DROP POLICY IF EXISTS "anon_update_notifications" ON notifications;
DROP POLICY IF EXISTS "anon_delete_notifications" ON notifications;
DROP POLICY IF EXISTS "authenticated_select_notifications" ON notifications;
DROP POLICY IF EXISTS "authenticated_insert_notifications" ON notifications;
DROP POLICY IF EXISTS "authenticated_update_notifications" ON notifications;
DROP POLICY IF EXISTS "authenticated_delete_notifications" ON notifications;
CREATE POLICY "authenticated_select_notifications" ON notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_notifications" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_notifications" ON notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_notifications" ON notifications FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_settings" ON settings;
DROP POLICY IF EXISTS "anon_insert_settings" ON settings;
DROP POLICY IF EXISTS "anon_update_settings" ON settings;
DROP POLICY IF EXISTS "anon_delete_settings" ON settings;
DROP POLICY IF EXISTS "authenticated_select_settings" ON settings;
DROP POLICY IF EXISTS "authenticated_insert_settings" ON settings;
DROP POLICY IF EXISTS "authenticated_update_settings" ON settings;
DROP POLICY IF EXISTS "authenticated_delete_settings" ON settings;
CREATE POLICY "authenticated_select_settings" ON settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_settings" ON settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_settings" ON settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_settings" ON settings FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "anon_insert_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "anon_update_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "anon_delete_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "authenticated_select_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "authenticated_insert_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "authenticated_update_activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "authenticated_delete_activity_logs" ON activity_logs;
CREATE POLICY "authenticated_select_activity_logs" ON activity_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert_activity_logs" ON activity_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_activity_logs" ON activity_logs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_delete_activity_logs" ON activity_logs FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 8. STORAGE BUCKET (recap)
-- =============================================================================
-- The app uploads entrance/plate JPEGs via supabase.storage.from('vehicle-snapshots')
-- in src/lib/visionEngine.ts (constant STORAGE_BUCKET).
--
-- Exact bucket name: vehicle-snapshots
-- Public: yes (getPublicUrl is used)
-- Max size: 5MB
-- MIME types: image/jpeg, image/png, image/webp
-- Policies: SELECT/INSERT/UPDATE/DELETE for anon + authenticated on this bucket
--
-- Section 3 above already creates the bucket and policies (idempotent).
-- If Storage still shows no bucket, re-run the SQL below, or use the dashboard.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-snapshots',
  'vehicle-snapshots',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read access for vehicle snapshots" ON storage.objects;
CREATE POLICY "Public read access for vehicle snapshots"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots');

DROP POLICY IF EXISTS "Allow upload vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow upload vehicle snapshots"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'vehicle-snapshots');

DROP POLICY IF EXISTS "Allow update vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow update vehicle snapshots"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots')
WITH CHECK (bucket_id = 'vehicle-snapshots');

DROP POLICY IF EXISTS "Allow delete vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow delete vehicle snapshots"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots');

-- Dashboard fallback (if SQL on storage.objects is blocked):
-- 1. Storage → New bucket
-- 2. Name: vehicle-snapshots
-- 3. Public bucket: ON
-- 4. File size limit: 5 MB
-- 5. Allowed MIME types: image/jpeg, image/png, image/webp
-- 6. Storage → vehicle-snapshots → Policies → New policy, four times:
--    - SELECT  for roles anon, authenticated  WITH: bucket_id = 'vehicle-snapshots'
--    - INSERT  for roles anon, authenticated  WITH CHECK: bucket_id = 'vehicle-snapshots'
--    - UPDATE  for roles anon, authenticated  USING and WITH CHECK: bucket_id = 'vehicle-snapshots'
--    - DELETE  for roles anon, authenticated  USING: bucket_id = 'vehicle-snapshots'
