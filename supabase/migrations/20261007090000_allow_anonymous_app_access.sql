-- These policies expose all parking-system records to anyone using the
-- public anon key. They are required by the app's unauthenticated mode.
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.users,
  public.app_users,
  public.vehicles,
  public.parking_slots,
  public.parking_sessions,
  public.cameras,
  public.plate_recognitions,
  public.payments,
  public.notifications,
  public.settings,
  public.activity_logs
TO anon;

DROP POLICY IF EXISTS anon_full_access_users ON public.users;
CREATE POLICY anon_full_access_users ON public.users FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_app_users ON public.app_users;
CREATE POLICY anon_full_access_app_users ON public.app_users FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_vehicles ON public.vehicles;
CREATE POLICY anon_full_access_vehicles ON public.vehicles FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_parking_slots ON public.parking_slots;
CREATE POLICY anon_full_access_parking_slots ON public.parking_slots FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_parking_sessions ON public.parking_sessions;
CREATE POLICY anon_full_access_parking_sessions ON public.parking_sessions FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_cameras ON public.cameras;
CREATE POLICY anon_full_access_cameras ON public.cameras FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_plate_recognitions ON public.plate_recognitions;
CREATE POLICY anon_full_access_plate_recognitions ON public.plate_recognitions FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_payments ON public.payments;
CREATE POLICY anon_full_access_payments ON public.payments FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_notifications ON public.notifications;
CREATE POLICY anon_full_access_notifications ON public.notifications FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_settings ON public.settings;
CREATE POLICY anon_full_access_settings ON public.settings FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_full_access_activity_logs ON public.activity_logs;
CREATE POLICY anon_full_access_activity_logs ON public.activity_logs FOR ALL TO anon USING (true) WITH CHECK (true);