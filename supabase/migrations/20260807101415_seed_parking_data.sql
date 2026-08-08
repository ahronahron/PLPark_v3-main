/*
# Seed Initial Data

Populates all tables with realistic demo data:
- 5 admin users with various roles
- 4 app users with wallet balances
- 5 registered vehicles
- 16 parking slots across 2 floors
- 6 cameras
- 12 plate recognition events
- 8 parking sessions
- 10 payment records
- 6 notifications
- System settings (jsonb values)
- Activity logs

Uses ON CONFLICT DO NOTHING for idempotency.
*/

-- USERS
INSERT INTO users (full_name, username, role, status, email, last_login) VALUES
('Admin User', 'admin', 'admin', 'active', 'admin@parking.ph', now()),
('Sarah Cruz', 'scruz', 'operator', 'active', 'scruz@parking.ph', now() - interval '2 hours'),
('Mike Santos', 'msantos', 'operator', 'active', 'msantos@parking.ph', now() - interval '5 hours'),
('Anna Reyes', 'areyes', 'viewer', 'inactive', 'areyes@parking.ph', now() - interval '3 days'),
('John Dela Cruz', 'jdelacruz', 'admin', 'active', 'jdelacruz@parking.ph', now() - interval '1 hour')
ON CONFLICT (username) DO NOTHING;

-- APP USERS
INSERT INTO app_users (full_name, email, phone, wallet_balance, status) VALUES
('Carlos Mendoza', 'carlos@email.com', '0917-123-4567', 850.00, 'active'),
('Liza Garcia', 'liza@email.com', '0917-234-5678', 320.50, 'active'),
('Roberto Lim', 'roberto@email.com', '0917-345-6789', -75.00, 'active'),
('Maria Torres', 'maria@email.com', '0917-456-7890', 1500.00, 'active')
ON CONFLICT (email) DO NOTHING;

-- VEHICLES
INSERT INTO vehicles (app_user_id, plate_number, vehicle_type, color, image_url)
SELECT id, 'NAB 1234', 'car', 'Silver', NULL FROM app_users WHERE email='carlos@email.com'
UNION ALL
SELECT id, 'XY 7890', 'motorcycle', 'Red', NULL FROM app_users WHERE email='liza@email.com'
UNION ALL
SELECT id, 'ABC 4567', 'car', 'Black', NULL FROM app_users WHERE email='roberto@email.com'
UNION ALL
SELECT id, 'PQR 9012', 'motorcycle', 'Blue', NULL FROM app_users WHERE email='maria@email.com'
UNION ALL
SELECT id, 'DEF 3456', 'car', 'White', NULL FROM app_users WHERE email='carlos@email.com'
ON CONFLICT DO NOTHING;

-- PARKING SLOTS
INSERT INTO parking_slots (slot_id, floor, vehicle_type, status) VALUES
('A1', 'Ground', 'car', 'occupied'),
('A2', 'Ground', 'car', 'available'),
('A3', 'Ground', 'car', 'occupied'),
('A4', 'Ground', 'car', 'available'),
('A5', 'Ground', 'car', 'reserved'),
('A6', 'Ground', 'car', 'available'),
('A7', 'Ground', 'car', 'disabled'),
('A8', 'Ground', 'car', 'available'),
('M1', 'Ground', 'motorcycle', 'occupied'),
('M2', 'Ground', 'motorcycle', 'available'),
('M3', 'Ground', 'motorcycle', 'available'),
('M4', 'Ground', 'motorcycle', 'disabled'),
('B1', 'Second', 'car', 'available'),
('B2', 'Second', 'car', 'occupied'),
('B3', 'Second', 'car', 'available'),
('B4', 'Second', 'car', 'available')
ON CONFLICT DO NOTHING;

-- CAMERAS
INSERT INTO cameras (name, type, location, is_online, slot_range) VALUES
('Entrance Camera 01', 'entrance', 'Main Gate', true, NULL),
('Exit Camera 01', 'exit', 'Main Gate Exit', true, NULL),
('Slot Camera A', 'slot', 'Ground Floor Zone A', true, 'A1-A4'),
('Slot Camera B', 'slot', 'Ground Floor Zone B', true, 'A5-A8'),
('Slot Camera M', 'slot', 'Ground Floor Motorcycle Zone', true, 'M1-M4'),
('Slot Camera B2F', 'slot', 'Second Floor Zone B', false, 'B1-B4')
ON CONFLICT DO NOTHING;

-- PLATE RECOGNITIONS
INSERT INTO plate_recognitions (plate_number, vehicle_type, direction, confidence, camera_name, created_at) VALUES
('NAB 1234', 'car', 'entry', 98.5, 'Entrance Camera 01', now() - interval '3 hours'),
('XY 7890', 'motorcycle', 'entry', 95.2, 'Entrance Camera 01', now() - interval '2 hours'),
('ABC 4567', 'car', 'entry', 97.8, 'Entrance Camera 01', now() - interval '90 minutes'),
('PQR 9012', 'motorcycle', 'entry', 92.1, 'Entrance Camera 01', now() - interval '45 minutes'),
('NAB 1234', 'car', 'exit', 96.3, 'Exit Camera 01', now() - interval '30 minutes'),
('ZXC 8899', 'car', 'entry', 89.5, 'Entrance Camera 01', now() - interval '20 minutes'),
('GHI 1122', 'motorcycle', 'entry', 94.0, 'Entrance Camera 01', now() - interval '15 minutes'),
('JKL 3344', 'car', 'entry', 99.1, 'Entrance Camera 01', now() - interval '10 minutes'),
('ABC 4567', 'car', 'exit', 97.2, 'Exit Camera 01', now() - interval '5 minutes'),
('MNO 5566', 'car', 'entry', 91.7, 'Slot Camera A', now() - interval '3 minutes'),
('PQR 7788', 'motorcycle', 'entry', 88.9, 'Slot Camera M', now() - interval '2 minutes'),
('STU 9900', 'car', 'entry', 96.4, 'Entrance Camera 01', now() - interval '1 minute')
ON CONFLICT DO NOTHING;

-- PARKING SESSIONS
INSERT INTO parking_sessions (plate_number, vehicle_type, color, concept, entry_camera, exit_camera, slot_id, status, entry_time, exit_time) VALUES
('NAB 1234', 'car', 'Silver', 'A', 'Entrance Camera 01', 'Exit Camera 01', 'A1', 'completed', now() - interval '3 hours', now() - interval '30 minutes'),
('XY 7890', 'motorcycle', 'Red', 'A', 'Entrance Camera 01', NULL, 'M1', 'active', now() - interval '2 hours', NULL),
('ABC 4567', 'car', 'Black', 'A', 'Entrance Camera 01', 'Exit Camera 01', 'A3', 'completed', now() - interval '90 minutes', now() - interval '5 minutes'),
('PQR 9012', 'motorcycle', 'Blue', 'A', 'Entrance Camera 01', NULL, NULL, 'active', now() - interval '45 minutes', NULL),
('ZXC 8899', 'car', 'Unrecognized', 'A', 'Entrance Camera 01', NULL, NULL, 'active', now() - interval '20 minutes', NULL),
('GHI 1122', 'motorcycle', 'White', 'C', 'Slot Camera A', NULL, 'A2', 'active', now() - interval '15 minutes', NULL),
('JKL 3344', 'car', 'Green', 'C', 'Slot Camera B', NULL, 'A6', 'active', now() - interval '10 minutes', NULL),
('MNO 5566', 'car', 'Silver', 'C', 'Slot Camera A', NULL, 'A4', 'active', now() - interval '3 minutes', NULL)
ON CONFLICT DO NOTHING;

-- PAYMENTS
INSERT INTO payments (receipt_number, plate_number, duration_hours, hourly_rate, total_amount, payment_method, status, processed_by, created_at) VALUES
('RCP-2024-0001', 'NAB 1234', 2.5, 50.00, 125.00, 'gcash', 'completed', 'admin', now() - interval '30 minutes'),
('RCP-2024-0002', 'ABC 4567', 1.5, 50.00, 75.00, 'cash', 'completed', 'scruz', now() - interval '5 minutes'),
('RCP-2024-0003', 'TUV 1001', 4.0, 50.00, 200.00, 'card', 'completed', 'admin', now() - interval '6 hours'),
('RCP-2024-0004', 'WXY 2002', 1.0, 50.00, 50.00, 'cash', 'completed', 'msantos', now() - interval '1 day'),
('RCP-2024-0005', 'YZA 3003', 3.5, 50.00, 175.00, 'gcash', 'completed', 'scruz', now() - interval '1 day'),
('RCP-2024-0006', 'BCD 4004', 2.0, 50.00, 100.00, 'card', 'refunded', 'admin', now() - interval '2 days'),
('RCP-2024-0007', 'EFG 5005', 5.0, 50.00, 250.00, 'gcash', 'completed', 'admin', now() - interval '2 days'),
('RCP-2024-0008', 'HIJ 6006', 0.5, 50.00, 25.00, 'cash', 'completed', 'msantos', now() - interval '3 days'),
('RCP-2024-0009', 'KLM 7007', 3.0, 50.00, 150.00, 'card', 'completed', 'scruz', now() - interval '3 days'),
('RCP-2024-0010', 'NOP 8008', 6.0, 50.00, 300.00, 'gcash', 'completed', 'admin', now() - interval '4 days')
ON CONFLICT (receipt_number) DO NOTHING;

-- NOTIFICATIONS
INSERT INTO notifications (type, title, message, is_read, created_at) VALUES
('success', 'Payment Completed', 'Payment of ₱125.00 for NAB 1234 has been completed.', false, now() - interval '30 minutes'),
('info', 'New Vehicle Entered', 'Vehicle PQR 9012 entered the parking facility.', false, now() - interval '45 minutes'),
('warning', 'Parking Nearly Full', 'Car slots are 75% occupied. Consider monitoring capacity.', false, now() - interval '1 hour'),
('error', 'Camera Offline', 'Slot Camera B2F (Second Floor) is offline.', false, now() - interval '2 hours'),
('warning', 'Plate Recognition Failed', 'Low confidence (88.9%) on camera Slot Camera M.', true, now() - interval '2 hours'),
('success', 'Payment Completed', 'Payment of ₱75.00 for ABC 4567 has been completed.', true, now() - interval '5 minutes')
ON CONFLICT DO NOTHING;

-- SETTINGS (jsonb values must be valid JSON)
INSERT INTO settings (key, value) VALUES
('max_capacity_cars', '30'::jsonb),
('max_capacity_motorcycles', '20'::jsonb),
('hourly_rate_car', '50'::jsonb),
('hourly_rate_motorcycle', '25'::jsonb),
('currency', '"₱"'::jsonb),
('payment_methods', '["cash", "gcash", "card"]'::jsonb),
('receipt_template', '{"header": "SmartPark Parking System", "address": "Pasig City, Philippines", "footer": "Thank you for parking with us!"}'::jsonb),
('plate_recognition_confidence_threshold', '85'::jsonb),
('camera_fps', '30'::jsonb),
('notification_settings', '{"new_vehicle": true, "parking_full": true, "payment_completed": true, "camera_offline": true, "recognition_failed": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ACTIVITY LOGS
INSERT INTO activity_logs (user_name, action, module, details, created_at) VALUES
('admin', 'Processed Payment', 'Payments', 'Processed payment RCP-2024-0001 for NAB 1234', now() - interval '30 minutes'),
('scruz', 'Processed Payment', 'Payments', 'Processed payment RCP-2024-0002 for ABC 4567', now() - interval '5 minutes'),
('admin', 'Updated Settings', 'Settings', 'Updated hourly rate to ₱50', now() - interval '1 hour'),
('msantos', 'Manual Entry', 'Dashboard', 'Manually entered vehicle JKL 3344', now() - interval '10 minutes'),
('admin', 'Added User', 'User Management', 'Added new operator user: msantos', now() - interval '1 day'),
('scruz', 'Refunded Payment', 'Payments', 'Refunded payment RCP-2024-0006 for BCD 4004', now() - interval '2 days'),
('admin', 'Updated Slot', 'Slot Management', 'Disabled slot M4 on Ground floor', now() - interval '2 days'),
('admin', 'Exported Data', 'User Management', 'Exported user list to CSV', now() - interval '3 days')
ON CONFLICT DO NOTHING;
