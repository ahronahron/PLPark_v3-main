import { supabase, type ParkingSession } from '@/lib/supabase';

export async function settleRegisteredSessionWallet(
  session: ParkingSession,
  durationHours: number,
  hourlyRate: number,
  processedBy: string,
) {
  if (!session.app_user_id) throw new Error('This session is not linked to an app user.');

  const { data: existingPayment, error: lookupError } = await supabase.from('payments')
    .select('id').eq('session_id', session.id).eq('status', 'completed').maybeSingle();
  if (lookupError) throw lookupError;
  if (existingPayment) return { charged: false, amount: 0 };

  const amount = Math.round(durationHours * hourlyRate * 100) / 100;
  if (amount <= 0) return { charged: false, amount: 0 };
  const receiptNumber = `WAL-${session.id.slice(0, 8)}-${Date.now()}`;
  const { data: payment, error: paymentError } = await supabase.from('payments').insert({
    receipt_number: receiptNumber,
    plate_number: session.plate_number,
    session_id: session.id,
    duration_hours: durationHours,
    hourly_rate: hourlyRate,
    total_amount: amount,
    payment_method: 'wallet',
    status: 'completed',
    processed_by: processedBy,
  }).select('id').single();
  if (paymentError || !payment) throw paymentError || new Error('Could not create wallet payment.');

  const { error: walletError } = await supabase.rpc('apply_wallet_transaction', {
    p_app_user_id: session.app_user_id,
    p_amount: -amount,
    p_transaction_type: 'deduction',
    p_session_id: session.id,
    p_payment_id: payment.id,
    p_description: `Automatic exit charge for ${session.plate_number}`,
  });
  if (walletError) {
    await supabase.from('payments').delete().eq('id', payment.id);
    throw walletError;
  }

  return { charged: true, amount };
}
