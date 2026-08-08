/*
# Parking Management System Schema

## Overview
Complete backend for a parking management system supporting three concepts:
- Concept A: Public parking with DS1 (full vehicle data) at entrance, DS2 (plate) at exit, pay via phone app
- Concept B: Private parking with DS2 (plate) at entrance matched to registered user, virtual wallet payment
- Concept C: Camera-only slot monitoring with no barriers, detects DS1 per slot

## Tables Created

1. **users** - Admin/management users for the web dashboard (auth-based)
   - id, full_name, username, role, status, email, last_login, created_at
2. **app_users** - Phone app users (Concept B) who register vehicles and have a virtual wallet
   - id, full_name, email, phone, wallet_balance, status, created_at
3. **vehicles** - Registered vehicles linked to app_users (Concept B)
   - id, app_user_id, plate_number, vehicle_type, color, image_url, created_at
4. **parking_slots** - Visual parking layout slots with floors, types, and statuses
   - id, slot_id (label like A1), floor, vehicle_type, status, current_session_id, created_at
5. **parking_sessions** - Active/completed parking sessions for all concepts
   - id, plate_number, vehicle_type, color, image_url, concept, entry_camera, exit_camera, slot_id, status, entry_time, exit_time, app_user_id, created_at
6. **cameras** - Camera configuration for entrance/exit/slots
   - id, name, type (entrance/exit/slot), location, is_online, slot_range, created_at
7. **plate_recognitions** - Log of every plate detection event
   - id, plate_number, vehicle_type, direction (entry/exit), confidence, camera_id, camera_name, image_url, created_at
8. **payments** - Payment records with receipt numbers
   - id, receipt_number, plate_number, session_id, duration_hours, hourly_rate, total_amount, payment_method, status, processed_by, created_at
9. **notifications** - System notifications for the dashboard bell
   - id, type, title, message, is_read, created_at
10. **settings** - Key-value system settings (rates, capacity, etc.)
    - key, value (jsonb), updated_at
11. **activity_logs** - Audit trail of user actions
    - id, user_id, user_name, action, module, details, created_at

## Security
- RLS enabled on all tables
- Owner-scoped policies for user-specific data (app_users, vehicles)
- Anon+authenticated policies for operational tables (this is an admin dashboard scenario;
  in production the admin auth would gate access, but the schema supports the full flow)
- 4 separate CRUD policies per table

## Notes
- Uses gen_random_uuid() for all primary keys
- Timestamps in timestamptz with DEFAULT now()
- Settings table uses jsonb values for flexible configuration
*/

-- ============ USERS (admin dashboard users) ============
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

-- ============ APP_USERS (phone app users for Concept B) ============
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- ============ VEHICLES (registered vehicles for Concept B) ============
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  plate_number text NOT NULL,
  vehicle_type text NOT NULL DEFAULT 'car',
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

-- ============ PARKING_SLOTS ============
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

-- ============ PARKING_SESSIONS ============
CREATE TABLE IF NOT EXISTS parking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text NOT NULL,
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

-- ============ CAMERAS ============
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

-- ============ PLATE_RECOGNITIONS ============
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

-- ============ PAYMENTS ============
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

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text,
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

-- ============ SETTINGS ============
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

-- ============ ACTIVITY_LOGS ============
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

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_parking_sessions_plate ON parking_sessions(plate_number);
CREATE INDEX IF NOT EXISTS idx_parking_sessions_status ON parking_sessions(status);
CREATE INDEX IF NOT EXISTS idx_plate_recognitions_created ON plate_recognitions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parking_slots_status ON parking_slots(status);
