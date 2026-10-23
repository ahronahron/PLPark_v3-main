-- Dashboard accounts are linked to Auth users through users.user_id.
CREATE OR REPLACE FUNCTION public.link_dashboard_profile_to_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET user_id = NEW.id
  WHERE user_id IS NULL
    AND lower(email) = lower(NEW.email);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.link_dashboard_profile_to_auth_user() FROM PUBLIC;
DROP TRIGGER IF EXISTS link_dashboard_profile_after_auth_signup ON auth.users;
CREATE TRIGGER link_dashboard_profile_after_auth_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.link_dashboard_profile_to_auth_user();

UPDATE public.users AS profile
SET user_id = auth_user.id
FROM auth.users AS auth_user
WHERE profile.user_id IS NULL
  AND lower(profile.email) = lower(auth_user.email);

CREATE OR REPLACE FUNCTION public.current_dashboard_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.users
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_write_parking_data()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_dashboard_role() IS NULL
    OR public.current_dashboard_role() = 'admin';
$$;

REVOKE ALL ON FUNCTION public.current_dashboard_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_parking_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_dashboard_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_parking_data() TO authenticated;

-- Clients may resolve their own profile for login, while only admins can list profiles.
DROP POLICY IF EXISTS "authenticated_select_users" ON public.users;
CREATE POLICY "authenticated_select_users" ON public.users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_dashboard_role() = 'admin');

DROP POLICY IF EXISTS "authenticated_insert_users" ON public.users;
DROP POLICY IF EXISTS "authenticated_update_users" ON public.users;
DROP POLICY IF EXISTS "authenticated_delete_users" ON public.users;
CREATE POLICY "authenticated_insert_users" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (public.current_dashboard_role() = 'admin');
CREATE POLICY "authenticated_update_users" ON public.users
  FOR UPDATE TO authenticated
  USING (public.current_dashboard_role() = 'admin')
  WITH CHECK (public.current_dashboard_role() = 'admin');
CREATE POLICY "authenticated_delete_users" ON public.users
  FOR DELETE TO authenticated
  USING (public.current_dashboard_role() = 'admin');

-- Preserve authenticated writes for mobile-only Auth users without a dashboard profile.
DO $$
DECLARE
  table_name text;
  operation text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'payments',
    'parking_sessions',
    'app_users',
    'vehicles',
    'cameras',
    'parking_slots',
    'plate_recognitions',
    'notifications',
    'settings',
    'activity_logs'
  ] LOOP
    FOREACH operation IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_' || operation || '_' || table_name, table_name);
      IF operation = 'insert' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_write_parking_data())',
          'authenticated_' || operation || '_' || table_name,
          table_name
        );
      ELSIF operation = 'update' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_write_parking_data()) WITH CHECK (public.can_write_parking_data())',
          'authenticated_' || operation || '_' || table_name,
          table_name
        );
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_write_parking_data())',
          'authenticated_' || operation || '_' || table_name,
          table_name
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Wallet transactions use a single FOR ALL policy, so replace it explicitly.
DROP POLICY IF EXISTS authenticated_full_access_wallet_transactions ON public.wallet_transactions;
DROP POLICY IF EXISTS authenticated_select_wallet_transactions ON public.wallet_transactions;
DROP POLICY IF EXISTS authenticated_insert_wallet_transactions ON public.wallet_transactions;
DROP POLICY IF EXISTS authenticated_update_wallet_transactions ON public.wallet_transactions;
DROP POLICY IF EXISTS authenticated_delete_wallet_transactions ON public.wallet_transactions;
CREATE POLICY authenticated_select_wallet_transactions ON public.wallet_transactions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_insert_wallet_transactions ON public.wallet_transactions
  FOR INSERT TO authenticated WITH CHECK (public.can_write_parking_data());
CREATE POLICY authenticated_update_wallet_transactions ON public.wallet_transactions
  FOR UPDATE TO authenticated USING (public.can_write_parking_data()) WITH CHECK (public.can_write_parking_data());
CREATE POLICY authenticated_delete_wallet_transactions ON public.wallet_transactions
  FOR DELETE TO authenticated USING (public.can_write_parking_data());

-- The wallet RPC runs as its owner, so enforce dashboard role restrictions inside it too.
CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_app_user_id uuid,
  p_amount numeric,
  p_transaction_type text,
  p_session_id uuid,
  p_payment_id uuid,
  p_description text
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_after numeric(12,2);
BEGIN
  IF public.current_dashboard_role() IS NOT NULL
     AND public.current_dashboard_role() <> 'admin' THEN
    RAISE EXCEPTION 'Client dashboard accounts cannot modify wallet transactions';
  END IF;

  IF p_transaction_type NOT IN ('top_up', 'deduction') THEN
    RAISE EXCEPTION 'Unsupported wallet transaction type';
  END IF;

  IF (p_transaction_type = 'top_up' AND p_amount <= 0)
     OR (p_transaction_type = 'deduction' AND p_amount >= 0) THEN
    RAISE EXCEPTION 'Wallet transaction amount has the wrong sign';
  END IF;

  UPDATE public.app_users
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_app_user_id
  RETURNING wallet_balance INTO v_balance_after;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'App user not found';
  END IF;

  INSERT INTO public.wallet_transactions (
    app_user_id, session_id, payment_id, transaction_type, amount, balance_after, description
  ) VALUES (
    p_app_user_id, p_session_id, p_payment_id, p_transaction_type, p_amount, v_balance_after, p_description
  );

  RETURN v_balance_after;
END;
$$;