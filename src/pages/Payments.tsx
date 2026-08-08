import { useEffect, useState } from 'react';
import { supabase, type Payment, type PaymentMethod } from '@/lib/supabase';
import { IconCheck, IconView, IconRefund, IconPrint, IconClock } from '@/components/Icons';

export function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentForm, setPaymentForm] = useState({ plate: '', duration: '', rate: '50', method: 'cash' as PaymentMethod });
  const [success, setSuccess] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('all');
  const perPage = 8;

  useEffect(() => {
    supabase.from('payments').select('*').order('created_at', { ascending: false }).then(({ data }) => setPayments(data || []));
  }, []);

  const total = parseFloat(paymentForm.duration || '0') * parseFloat(paymentForm.rate || '0');

  const processPayment = async () => {
    if (!paymentForm.plate || !paymentForm.duration) return;
    const receiptNum = `RCP-2024-${String(payments.length + 1).padStart(4, '0')}`;
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
    setSuccess(true);
    setTimeout(() => setSuccess(false), 4000);
    setPaymentForm({ plate: '', duration: '', rate: '50', method: 'cash' });
    supabase.from('payments').select('*').order('created_at', { ascending: false }).then(({ data }) => setPayments(data || []));
  };

  const filteredPayments = filter === 'all' ? payments : payments.filter(p => p.status === filter);
  const pagePayments = filteredPayments.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(filteredPayments.length / perPage);

  return (
    <div className="payments-page">
      <div className="payment-panel-card">
        <div className="panel-header">Process Payment</div>
        <div className="payment-form-grid">
          <div className="form-group">
            <label>Plate Number</label>
            <input value={paymentForm.plate} onChange={e => setPaymentForm({ ...paymentForm, plate: e.target.value })} placeholder="ABC 1234" />
          </div>
          <div className="form-group">
            <label>Parking Duration (hrs)</label>
            <input type="number" step="0.5" value={paymentForm.duration} onChange={e => setPaymentForm({ ...paymentForm, duration: e.target.value })} placeholder="2.5" />
          </div>
          <div className="form-group">
            <label>Hourly Rate</label>
            <input type="number" value={paymentForm.rate} onChange={e => setPaymentForm({ ...paymentForm, rate: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Total Amount</label>
            <div className="total-amount">₱{total.toFixed(2)}</div>
          </div>
          <div className="form-group">
            <label>Payment Method</label>
            <select value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value as PaymentMethod })}>
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="card">Credit/Debit Card</option>
            </select>
          </div>
          <div className="form-actions payment-actions">
            <button className="btn-primary" onClick={processPayment}>Process Payment</button>
            <button className="btn-secondary">Print Receipt</button>
            <button className="btn-secondary">Send Digital Receipt</button>
          </div>
        </div>
        {success && (
          <div className="payment-success">
            <span className="success-icon"><IconCheck size={16} /></span>
            Payment Successful
          </div>
        )}
      </div>

      <div className="payment-history-card">
        <div className="panel-header">
          <span>Payment Management</span>
          <div className="filter-row">
            <select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}>
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="refunded">Refunded</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>
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
                  <div className="row-actions">
                    <button className="action-btn" title="View Receipt"><IconView size={15} /></button>
                    <button className="action-btn" title="Refund"><IconRefund size={15} /></button>
                    <button className="action-btn" title="Print"><IconPrint size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {pagePayments.length === 0 && <tr><td colSpan={8} className="empty-state">No payments found</td></tr>}
          </tbody>
        </table>
        <div className="pagination">
          <button className="page-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {totalPages || 1}</span>
          <button className="page-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
