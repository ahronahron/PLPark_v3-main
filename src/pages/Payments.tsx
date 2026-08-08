/**
 * Payments.tsx — Payment Processing & History Page
 *
 * This page handles two core payment functions:
 *
 * 1. **Process Payment Form** — Allows admin to manually process
 *    a parking payment by entering plate number, duration, and rate.
 *    Calculates the total amount automatically and creates a payment
 *    record with a generated receipt number.
 *
 * 2. **Payment History Table** — Paginated, filterable table showing
 *    all payment transactions with status badges, method labels,
 *    and action buttons (View, Refund, Print).
 *
 * Data is fetched from the `payments` table in Supabase.
 */
import { useEffect, useState } from 'react';
import { supabase, type Payment, type PaymentMethod } from '@/lib/supabase';
import { IconCheck, IconView, IconRefund, IconPrint, IconClock } from '@/components/Icons';

/**
 * Payments — Payment management page component.
 *
 * Manages the complete payment workflow:
 * - Form inputs for processing new payments
 * - Auto-calculation of total from duration × rate
 * - Receipt number generation (RCP-2024-XXXX format)
 * - Paginated history table with status filters
 *
 * @returns The payments page UI with process form and history table
 */
export function Payments() {
  /** All payment records fetched from the database */
  const [payments, setPayments] = useState<Payment[]>([]);

  /** Payment form state — tracks plate, duration, rate, and method */
  const [paymentForm, setPaymentForm] = useState({ plate: '', duration: '', rate: '50', method: 'cash' as PaymentMethod });

  /** Success flag — triggers the green success banner for 4 seconds */
  const [success, setSuccess] = useState(false);

  /** Current page index for pagination (0-based) */
  const [page, setPage] = useState(0);

  /** Active status filter — 'all', 'completed', 'refunded', or 'pending' */
  const [filter, setFilter] = useState('all');

  /** Number of payment records displayed per page */
  const perPage = 8;

  /**
   * Initial data fetch — loads all payment records on component mount.
   * Results are ordered by creation date (newest first).
   */
  useEffect(() => {
    supabase.from('payments').select('*').order('created_at', { ascending: false }).then(({ data }) => setPayments(data || []));
  }, []);

  /**
   * total — Auto-calculated payment total.
   * Multiplies the duration (hours) by the hourly rate.
   * Handles empty strings by defaulting to 0.
   */
  const total = parseFloat(paymentForm.duration || '0') * parseFloat(paymentForm.rate || '0');

  /**
   * processPayment — Handles the "Process Payment" button click.
   *
   * Validation:
   * - Plate number and duration are required
   *
   * Process:
   * 1. Generates a unique receipt number (RCP-2024-XXXX)
   * 2. Inserts a new payment record with 'completed' status
   * 3. Shows success banner for 4 seconds
   * 4. Clears the form and refreshes the payment list
   *
   * The total is pre-calculated from duration × rate.
   * Plate number is automatically converted to uppercase.
   */
  const processPayment = async () => {
    // Validate required fields
    if (!paymentForm.plate || !paymentForm.duration) return;

    // Generate sequential receipt number
    const receiptNum = `RCP-2024-${String(payments.length + 1).padStart(4, '0')}`;

    // Insert payment record into Supabase
    const { error } = await supabase.from('payments').insert({
      receipt_number: receiptNum,
      plate_number: paymentForm.plate.toUpperCase(),
      duration_hours: parseFloat(paymentForm.duration),
      hourly_rate: parseFloat(paymentForm.rate),
      total_amount: total,
      payment_method: paymentForm.method,
      status: 'completed',
      processed_by: 'admin',
    });

    if (error) return;

    // Show success feedback and auto-hide after 4 seconds
    setSuccess(true);
    setTimeout(() => setSuccess(false), 4000);

    // Reset form to defaults
    setPaymentForm({ plate: '', duration: '', rate: '50', method: 'cash' });

    // Refresh payment list from database
    supabase.from('payments').select('*').order('created_at', { ascending: false }).then(({ data }) => setPayments(data || []));
  };

  // ============================================================
  // PAGINATION & FILTERING — Computed from payments array
  // ============================================================

  /** Payments filtered by the active status filter */
  const filteredPayments = filter === 'all' ? payments : payments.filter(p => p.status === filter);

  /** Current page slice of filtered payments */
  const pagePayments = filteredPayments.slice(page * perPage, (page + 1) * perPage);

  /** Total number of pages based on filtered results */
  const totalPages = Math.ceil(filteredPayments.length / perPage);

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="payments-page">
      {/* ===== PROCESS PAYMENT FORM ===== */}
      <div className="payment-panel-card">
        <div className="panel-header">Process Payment</div>
        <div className="payment-form-grid">
          {/* Plate number input */}
          <div className="form-group">
            <label>Plate Number</label>
            <input value={paymentForm.plate} onChange={e => setPaymentForm({ ...paymentForm, plate: e.target.value })} placeholder="ABC 1234" />
          </div>
          {/* Duration in hours (supports decimals like 2.5) */}
          <div className="form-group">
            <label>Parking Duration (hrs)</label>
            <input type="number" step="0.5" value={paymentForm.duration} onChange={e => setPaymentForm({ ...paymentForm, duration: e.target.value })} placeholder="2.5" />
          </div>
          {/* Hourly rate — pre-filled with default, editable */}
          <div className="form-group">
            <label>Hourly Rate</label>
            <input type="number" value={paymentForm.rate} onChange={e => setPaymentForm({ ...paymentForm, rate: e.target.value })} />
          </div>
          {/* Auto-calculated total amount display */}
          <div className="form-group">
            <label>Total Amount</label>
            <div className="total-amount">₱{total.toFixed(2)}</div>
          </div>
          {/* Payment method dropdown */}
          <div className="form-group">
            <label>Payment Method</label>
            <select value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value as PaymentMethod })}>
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="card">Credit/Debit Card</option>
            </select>
          </div>
          {/* Action buttons */}
          <div className="form-actions payment-actions">
            <button className="btn-primary" onClick={processPayment}>Process Payment</button>
            <button className="btn-secondary">Print Receipt</button>
            <button className="btn-secondary">Send Digital Receipt</button>
          </div>
        </div>
        {/* Success banner — shown for 4 seconds after successful payment */}
        {success && (
          <div className="payment-success">
            <span className="success-icon"><IconCheck size={16} /></span>
            Payment Successful
          </div>
        )}
      </div>

      {/* ===== PAYMENT HISTORY TABLE ===== */}
      <div className="payment-history-card">
        <div className="panel-header">
          <span>Payment Management</span>
          {/* Status filter dropdown — resets pagination when changed */}
          <div className="filter-row">
            <select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}>
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="refunded">Refunded</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>

        {/* Data table with payment records */}
        <table className="data-table">
          <thead>
            <tr>
              <th>Receipt No.</th>
              <th>Plate</th>
              <th>Duration</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagePayments.map(p => (
              <tr key={p.id}>
                <td className="mono">{p.receipt_number}</td>
                <td className="mono">{p.plate_number}</td>
                <td>{p.duration_hours}h</td>
                <td>₱{p.total_amount.toFixed(2)}</td>
                <td><span className={`method-badge ${p.payment_method}`}>{p.payment_method}</span></td>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td><span className={`status-badge ${p.status}`}>{p.status}</span></td>
                <td>
                  {/* Row action buttons: View receipt, Refund, Print */}
                  <div className="row-actions">
                    <button className="action-btn" title="View Receipt"><IconView size={15} /></button>
                    <button className="action-btn" title="Refund"><IconRefund size={15} /></button>
                    <button className="action-btn" title="Print"><IconPrint size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {/* Empty state when no payments match the filter */}
            {pagePayments.length === 0 && <tr><td colSpan={8} className="empty-state">No payments found</td></tr>}
          </tbody>
        </table>

        {/* Pagination controls */}
        <div className="pagination">
          <button className="page-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {totalPages || 1}</span>
          <button className="page-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
