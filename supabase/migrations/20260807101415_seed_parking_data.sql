/*
	Clear demo/dummy data and insert a single clean admin record.

	IMPORTANT:
	- This migration truncates demo tables using RESTART IDENTITY CASCADE.
	- It does NOT create a Supabase Auth password. To enable login, create an Auth user
		in the Supabase Dashboard (Authentication → Users → New User) using the credentials
		shown at the end of this file.

	Run this SQL in your Supabase SQL editor or via your deployment pipeline.
*/

BEGIN;

-- Remove demo data (truncate in an order-agnostic way)
TRUNCATE TABLE activity_logs, notifications, payments, parking_sessions, plate_recognitions, cameras, parking_slots, vehicles, app_users, users, settings RESTART IDENTITY CASCADE;

-- Insert a single admin user (application table)
INSERT INTO users (full_name, username, role, status, email, last_login)
VALUES ('Administrator', 'admin', 'admin', 'active', 'admin@parking.local', now())
ON CONFLICT (username) DO UPDATE SET full_name=EXCLUDED.full_name, role=EXCLUDED.role, status=EXCLUDED.status, email=EXCLUDED.email;

-- Minimal settings to avoid missing-key errors in the app
INSERT INTO settings (key, value) VALUES
('max_capacity_cars', '0'::jsonb),
('max_capacity_motorcycles', '0'::jsonb),
('hourly_rate_car', '0'::jsonb),
('hourly_rate_motorcycle', '0'::jsonb),
('currency', '"₱"'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;

COMMIT;

-- SUGGESTED ADMIN AUTH CREDENTIALS (create these via Supabase Dashboard)
-- Email: admin@parking.local
-- Password: StrongP@ssw0rd!
-- Steps to enable login:
-- 1. Open Supabase project → Authentication → Users → New User
-- 2. Enter the email and password above and create the user.
-- 3. (Optional) If your application links auth users to the `users` table by email, they should match.
--    If you use a different linkage (e.g. auth.uid -> users.id), update your app or link records accordingly.

