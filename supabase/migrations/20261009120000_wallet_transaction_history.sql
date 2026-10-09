-- Audit wallet credits and parking-fee deductions for mobile app users.
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.parking_sessions(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('top_up', 'deduction')),
  amount numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created
  ON public.wallet_transactions (app_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_session
  ON public.wallet_transactions (session_id);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_transactions TO anon, authenticated;
DROP POLICY IF EXISTS anon_full_access_wallet_transactions ON public.wallet_transa ctions;
CREATE POLICY anon_full_access_wallet_transactions ON public.wallet_transactions
  FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS authenticated_full_access_wallet_transactions ON public.wallet_transactions;
CREATE POLICY authenticated_full_access_wallet_transactions ON public.wallet_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

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

REVOKE ALL ON FUNCTION public.apply_wallet_transaction(uuid, numeric, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, numeric, text, uuid, uuid, text) TO anon, authenticated;
