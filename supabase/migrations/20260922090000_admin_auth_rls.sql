/*
  Admin Auth + RLS lock-down

  - Link `users` (admin profiles) to Supabase Auth via user_id + email
  - Remove anon INSERT/UPDATE/DELETE on operational and admin tables
  - Keep anon SELECT only on public-facing occupancy/camera data
    (cameras, parking_slots). Mobile app_users login is unchanged in the
    React app; those writes now require an authenticated JWT.
*/

-- Link admin profile rows to auth.users
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

-- Match existing profile emails to Auth users when both already exist
UPDATE users u
SET user_id = au.id
FROM auth.users au
WHERE u.user_id IS NULL
  AND lower(u.email) = lower(au.email);

-- Helper: drop legacy open policies, then recreate role-scoped ones
-- users (admin profiles) — authenticated only
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

-- payments
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

-- parking_sessions
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

-- app_users (mobile profiles still exist; writes now require Auth)
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

-- vehicles
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

-- cameras — public read for occupancy/status; writes authenticated only
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

-- parking_slots — public read for slot status; writes authenticated only
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

-- plate_recognitions
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

-- notifications
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

-- settings
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

-- activity_logs
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
