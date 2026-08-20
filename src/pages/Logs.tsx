/**
 * Logs.tsx — Consolidated Logs Module
 *
 * Tab Sequence (Updated):
 * 1. **Vehicle Logs** (Default) — History of parking sessions with plate snapshots, details, and unified Pay/Exit action.
 * 2. **Payment Logs** — Financial audit logs with detailed receipt quick look.
 * 3. **User Management** — Staff/admin account management.
 */
import { useEffect, useState } from 'react';
import {
  supabase,
  type User,
  type Payment,
  type ParkingSession,
  type PaymentMethod
} from '@/lib/supabase';
import {
  IconSearch,
  IconTrash,
  IconKey,
  IconPlus,
  IconView,
  IconCar,
  IconMotorcycle,
  IconCheck,
  IconArrowRight,
  IconPayment
} from '@/components/Icons';

export function Logs() {
  /** Tabs: Vehicle Logs first, Payment Logs second, User Management third */
  const [activeTab, setActiveTab] = useState<'vehicles' | 'payments' | 'users'>('vehicles');

  /** State datasets */
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  /** Filtering */
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  /** Modals */
  const [viewSession, setViewSession] = useState<ParkingSession | null>(null);
  const [viewPayment, setViewPayment] = useState<Payment | null>(null);
  const [manageExitSession, setManageExitSession] = useState<ParkingSession | null>(null);
  const [exitConfirmSession, setExitConfirmSession] = useState<ParkingSession | null>(null);

  /** Manage Exit Modal State */
  const [exitPaymentMethod, setExitPaymentMethod] = useState<PaymentMethod>('cash');
  const [exitStatusMsg, setExitStatusMsg] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  /** Load data based on active tab */
  const loadData = () => {
    supabase.from('parking_sessions').select('*').order('created_at', { ascending: false }).then(({ data }) => setSessions(data || []));
    supabase.from('payments').select('*').order('created_at', { ascending: false }).then(({ data }) => setPayments(data || []));
    supabase.from('users').select('*').order('created_at', { ascending: false }).then(({ data }) => setUsers(data || []));
  };

  useEffect(() => {
    loadData();
    setSearchQuery('');
    setStatusFilter('all');
  }, [activeTab]);

  /** Deletions */
  const deleteSession = async (id: string) => {
    if (!confirm('Are you sure you want to delete this vehicle session?')) return;
    await supabase.from('parking_sessions').delete().eq('id', id);
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const deletePayment = async (id: string) => {
    if (!confirm('Are you sure you want to delete this payment record?')) return;
    await supabase.from('payments').delete().eq('id', id);
    setPayments(prev => prev.filter(p => p.id !== id));
  };

  const deleteUser = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    await supabase.from('users').delete().eq('id', id);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  // ============================================================
  // SEARCH & FILTER LOGIC
  // ============================================================

  const filteredSessions = sessions.filter(s => {
    const matchesSearch = !searchQuery.trim() ||
      s.plate_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.slot_id && s.slot_id.toLowerCase().includes(searchQuery.toLowerCase())) ||
      s.vehicle_type.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredPayments = payments.filter(p => {
    const matchesSearch = !searchQuery.trim() ||
      p.plate_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.receipt_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.payment_method.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredUsers = users.filter(u =>
    !searchQuery.trim() ||
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate duration & fee helper
  const calculateSessionDetails = (session: ParkingSession) => {
    const entryDate = new Date(session.entry_time);
    const exitDate = session.exit_time ? new Date(session.exit_time) : new Date();
    const durationHours = Math.max(0.5, Math.ceil(((exitDate.getTime() - entryDate.getTime()) / 3600000) * 2) / 2);
    const rate = session.vehicle_type === 'motorcycle' ? 25 : 50;
    const totalAmount = durationHours * rate;
    return { durationHours, rate, totalAmount };
  };

  // Check if manageExitSession is paid
  const manageSessionPayment = manageExitSession
    ? payments.find(p => p.session_id === manageExitSession.id && p.status === 'completed') ||
      (manageExitSession.concept === 'B' ? { status: 'completed', payment_method: 'wallet', receipt_number: 'APP-WALLET' } : null)
    : null;
  const isManageSessionPaid = Boolean(manageSessionPayment);

  /** Process payment in Manage Exit modal */
  const handleProcessPayment = async () => {
    if (!manageExitSession) return;
    setIsProcessingPayment(true);
    setExitStatusMsg(null);

    try {
      const { durationHours, rate, totalAmount } = calculateSessionDetails(manageExitSession);
      const { data: countData } = await supabase.from('payments').select('id');
      const receiptNum = `RCP-${new Date().getFullYear()}-${String((countData?.length || 0) + 1).padStart(4, '0')}`;

      const { error } = await supabase.from('payments').insert({
        receipt_number: receiptNum,
        plate_number: manageExitSession.plate_number,
        session_id: manageExitSession.id,
        duration_hours: durationHours,
        hourly_rate: rate,
        total_amount: totalAmount,
        payment_method: exitPaymentMethod,
        status: 'completed',
        processed_by: 'admin',
      });

      if (error) {
        setExitStatusMsg({ msg: 'Payment error: ' + error.message, ok: false });
        setIsProcessingPayment(false);
        return;
      }

      setExitStatusMsg({ msg: `Payment recorded (₱${totalAmount.toFixed(2)}) — Receipt: ${receiptNum} ✓`, ok: true });
      loadData();
    } catch (err: any) {
      setExitStatusMsg({ msg: 'Error: ' + err.message, ok: false });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  /** Complete manual exit from Manage modal */
  const handleConfirmExit = async () => {
    if (!exitConfirmSession) return;

    const session = exitConfirmSession;
    const exitTime = new Date().toISOString();

    await supabase.from('parking_sessions').update({
      status: 'completed',
      exit_time: exitTime,
      exit_camera: 'Manual Exit',
    }).eq('id', session.id);

    if (session.slot_id) {
      await supabase.from('parking_slots').update({
        status: 'available',
        current_session_id: null,
      }).eq('slot_id', session.slot_id);
    }

    await supabase.from('plate_recognitions').insert({
      plate_number: session.plate_number,
      vehicle_type: session.vehicle_type,
      direction: 'exit',
      confidence: 100,
      camera_name: 'Manual Exit',
      created_at: exitTime,
    });

    loadData();
    setExitConfirmSession(null);
    setManageExitSession(null);
    setExitStatusMsg({ msg: `Manual exit completed for ${session.plate_number} ✓`, ok: true });
  };

  // ============================================================
  // RENDER SUB-VIEWS
  // ============================================================

  /** 1. Vehicle Logs view (First Tab) */
  const renderVehicles = () => (
    <div className="logs-content-section">
      <div className="page-toolbar">
        <div className="search-wrapper">
          <IconSearch size={15} className="search-prefix" />
          <input
            className="search-input"
            placeholder="Search by plate number, slot, or vehicle type..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="logs-filter-select"
          >
            <option value="all">All Sessions</option>
            <option value="active">Active Sessions</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      <table className="data-table logs-table logs-vehicles-table">
        <thead>
          <tr>
            <th>Plate Number</th>
            <th>Type</th>
            <th>Slot</th>
            <th>Entry Time</th>
            <th>Exit Time</th>
            <th>Entrance Snapshot</th>
            <th>Status</th>
            <th style={{ width: '140px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredSessions.map(s => {
            const hasPaid = payments.some(p => p.session_id === s.id && p.status === 'completed') || s.concept === 'B';
            return (
              <tr key={s.id} className="logs-interactive-row" onClick={() => setViewSession(s)}>
                <td className="mono font-bold">{s.plate_number}</td>
                <td>
                  <span className="flex items-center gap-2">
                    {s.vehicle_type === 'car' ? <IconCar size={15} /> : <IconMotorcycle size={15} />}
                    <span className="capitalize">{s.vehicle_type}</span>
                  </span>
                </td>
                <td className="mono">{s.slot_id || '—'}</td>
                <td>{new Date(s.entry_time).toLocaleString()}</td>
                <td>{s.exit_time ? new Date(s.exit_time).toLocaleString() : '—'}</td>
                <td>
                  {s.image_url ? (
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <img
                        src={s.image_url}
                        alt="Entrance Snapshot"
                        style={{ width: '48px', height: '28px', borderRadius: '4px', objectFit: 'cover', border: '1px solid var(--cursor-border)' }}
                      />
                      <button className="action-btn" onClick={() => window.open(s.image_url || undefined)} title="View full image">
                        <IconView size={14} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-muted text-xs italic">No Image</span>
                  )}
                </td>
                <td>
                  <span className={`status-badge ${s.status}`}>{s.status}</span>
                </td>
                <td onClick={e => e.stopPropagation()}>
                  <div className="row-actions">
                    <button
                      className="action-btn"
                      title="Quick look details"
                      onClick={() => setViewSession(s)}
                    >
                      <IconView size={14} />
                    </button>

                    {/* Unified Exit & Pay Action Button for Active sessions */}
                    {s.status === 'active' ? (
                      <button
                        className="action-btn action-text btn-manage-exit"
                        title="Manage Payment & Exit"
                        onClick={() => {
                          setManageExitSession(s);
                          setExitStatusMsg(null);
                        }}
                      >
                        Exit / Pay
                      </button>
                    ) : (
                      <span className="text-muted text-xs font-semibold px-2">Completed</span>
                    )}

                    <button
                      className="action-btn action-danger"
                      title="Delete session"
                      onClick={() => deleteSession(s.id)}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {filteredSessions.length === 0 && <tr><td colSpan={8} className="empty-state">No vehicle sessions found</td></tr>}
        </tbody>
      </table>
    </div>
  );

  /** 2. Payment Logs view (Second Tab) */
  const renderPayments = () => (
    <div className="logs-content-section">
      <div className="page-toolbar">
        <div className="search-wrapper">
          <IconSearch size={15} className="search-prefix" />
          <input
            className="search-input"
            placeholder="Search by receipt number, plate, or payment method..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="logs-filter-select"
          >
            <option value="all">All Payments</option>
            <option value="completed">Completed</option>
            <option value="refunded">Refunded</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>

      <table className="data-table logs-table logs-payments-table">
        <thead>
          <tr>
            <th>Receipt No.</th>
            <th>Plate</th>
            <th>Duration</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Date & Time</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredPayments.map(p => (
            <tr key={p.id} className="logs-interactive-row" onClick={() => setViewPayment(p)}>
              <td className="mono font-bold" style={{ color: 'var(--cursor-blue)' }}>{p.receipt_number}</td>
              <td className="mono font-semibold">{p.plate_number}</td>
              <td>{p.duration_hours}h</td>
              <td className="font-bold">₱{Number(p.total_amount).toFixed(2)}</td>
              <td><span className={`method-badge ${p.payment_method}`}>{p.payment_method}</span></td>
              <td>{new Date(p.created_at).toLocaleString()}</td>
              <td><span className={`status-badge ${p.status}`}>{p.status}</span></td>
              <td onClick={e => e.stopPropagation()}>
                <div className="row-actions">
                  <button className="action-btn" title="View receipt details" onClick={() => setViewPayment(p)}>
                    <IconView size={14} />
                  </button>
                  <button className="action-btn action-danger" title="Delete payment" onClick={() => deletePayment(p.id)}>
                    <IconTrash size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {filteredPayments.length === 0 && <tr><td colSpan={8} className="empty-state">No payments found</td></tr>}
        </tbody>
      </table>
    </div>
  );

  /** 3. User Management view (Third Tab) */
  const renderUsers = () => (
    <div className="logs-content-section">
      <div className="page-toolbar">
        <div className="search-wrapper">
          <IconSearch size={15} className="search-prefix" />
          <input
            className="search-input"
            placeholder="Search users by name, username, or email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <button className="btn-primary" onClick={() => alert('Add User functionality')}>
            <IconPlus size={15} /> Add User
          </button>
        </div>
      </div>

      <table className="data-table logs-table logs-users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th>Email</th>
            <th>Last Login</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.map(u => (
            <tr key={u.id}>
              <td>{u.full_name}</td>
              <td className="mono">{u.username}</td>
              <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
              <td><span className={`status-badge ${u.status}`}>{u.status}</span></td>
              <td>{u.email}</td>
              <td>{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
              <td>
                <div className="row-actions">
                  <button className="action-btn" title="Delete" onClick={() => deleteUser(u.id)}><IconTrash size={14} /></button>
                  <button className="action-btn" title="Reset Password" onClick={() => alert('Password reset')}><IconKey size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
          {filteredUsers.length === 0 && <tr><td colSpan={7} className="empty-state">No users found</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="payments-page">
      <div className="payment-history-card">
        {/* Navigation tabs in requested sequence: Vehicles -> Payments -> Users */}
        <div className="logs-tabs">
          <button className={`logs-tab-btn ${activeTab === 'vehicles' ? 'active' : ''}`} onClick={() => setActiveTab('vehicles')}>
            Vehicle Logs
          </button>
          <button className={`logs-tab-btn ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>
            Payment Logs
          </button>
          <button className={`logs-tab-btn ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            User Management
          </button>
        </div>

        {/* Tab content panel */}
        <div style={{ padding: '0 20px 20px' }}>
          {activeTab === 'vehicles' && renderVehicles()}
          {activeTab === 'payments' && renderPayments()}
          {activeTab === 'users' && renderUsers()}
        </div>
      </div>

      {/* ===== 1. VEHICLE SESSION QUICK LOOK MODAL ===== */}
      {viewSession && (
        <div className="modal-overlay" onClick={() => setViewSession(null)}>
          <div className="modal-container quick-look-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="quick-look-title-bar">
                <span className={`status-badge ${viewSession.status}`}>
                  {viewSession.status.toUpperCase()}
                </span>
                <h3>Vehicle Session Details</h3>
              </div>
              <button className="close-btn" onClick={() => setViewSession(null)}>×</button>
            </div>

            <div className="modal-body">
              <div className="quick-look-banner">
                {viewSession.image_url ? (
                  <img src={viewSession.image_url} alt="Vehicle snapshot" className="quick-look-image" />
                ) : (
                  <div className="quick-look-icon-placeholder">
                    {viewSession.vehicle_type === 'car' ? <IconCar size={36} /> : <IconMotorcycle size={36} />}
                  </div>
                )}

                <div className="quick-look-plate-info">
                  <div className="quick-look-plate">{viewSession.plate_number}</div>
                  <div className="quick-look-type-row">
                    <span className="quick-look-type">{viewSession.vehicle_type}</span>
                    <span>•</span>
                    <span className="quick-look-cam">Slot: {viewSession.slot_id || 'None'}</span>
                  </div>
                  <div className="quick-look-cam">Entry Camera: <strong>{viewSession.entry_camera || 'Camera Feed'}</strong></div>
                </div>
              </div>

              <div className="quick-look-grid">
                <div className="quick-look-cell">
                  <span className="cell-label">Entry Time</span>
                  <span className="cell-val">{new Date(viewSession.entry_time).toLocaleString()}</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Exit Time</span>
                  <span className="cell-val">{viewSession.exit_time ? new Date(viewSession.exit_time).toLocaleString() : '— (Parked)'}</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Duration</span>
                  <span className="cell-val">{calculateSessionDetails(viewSession).durationHours} hrs</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Calculated Fee</span>
                  <span className="cell-val font-bold text-blue">₱{calculateSessionDetails(viewSession).totalAmount.toFixed(2)}</span>
                </div>
              </div>

              {/* Matched Payment info if any */}
              {(() => {
                const pay = payments.find(p => p.session_id === viewSession.id && p.status === 'completed');
                if (pay) {
                  return (
                    <div className="quick-look-receipt-box">
                      <div><strong>✓ Paid via {pay.payment_method.toUpperCase()}</strong></div>
                      <div>Receipt: {pay.receipt_number} • Amount: ₱{Number(pay.total_amount).toFixed(2)}</div>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="clean-modal-actions" style={{ marginTop: '16px' }}>
                <button className="btn-secondary" onClick={() => setViewSession(null)}>Close</button>
                {viewSession.status === 'active' && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      const sess = viewSession;
                      setViewSession(null);
                      setManageExitSession(sess);
                      setExitStatusMsg(null);
                    }}
                  >
                    Manage Exit / Pay
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 2. PAYMENT RECEIPT QUICK LOOK MODAL ===== */}
      {viewPayment && (
        <div className="modal-overlay" onClick={() => setViewPayment(null)}>
          <div className="modal-container quick-look-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="quick-look-title-bar">
                <span className={`status-badge ${viewPayment.status}`}>
                  {viewPayment.status.toUpperCase()}
                </span>
                <h3>Payment Receipt Details</h3>
              </div>
              <button className="close-btn" onClick={() => setViewPayment(null)}>×</button>
            </div>

            <div className="modal-body">
              <div className="payment-receipt-banner">
                <div className="receipt-banner-top">
                  <span className="receipt-label">Official Receipt Number</span>
                  <div className="receipt-main-number">{viewPayment.receipt_number}</div>
                </div>
                <div className="receipt-amount-badge">
                  ₱{Number(viewPayment.total_amount).toFixed(2)}
                </div>
              </div>

              <div className="quick-look-grid">
                <div className="quick-look-cell">
                  <span className="cell-label">Vehicle Plate</span>
                  <span className="cell-val mono font-bold">{viewPayment.plate_number}</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Payment Method</span>
                  <span className="cell-val">
                    <span className={`method-badge ${viewPayment.payment_method}`}>{viewPayment.payment_method}</span>
                  </span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Duration</span>
                  <span className="cell-val">{viewPayment.duration_hours} hours</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Hourly Rate</span>
                  <span className="cell-val">₱{Number(viewPayment.hourly_rate).toFixed(2)}/hr</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Payment Date & Time</span>
                  <span className="cell-val">{new Date(viewPayment.created_at).toLocaleString()}</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Processed By</span>
                  <span className="cell-val">{viewPayment.processed_by || 'Admin'}</span>
                </div>
              </div>

              <div className="clean-modal-actions" style={{ marginTop: '16px' }}>
                <button className="btn-secondary" onClick={() => setViewPayment(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 3. UNIFIED MANAGE EXIT & PAY MODAL FOR LOGS ===== */}
      {manageExitSession && (
        <div className="modal-overlay" onClick={() => setManageExitSession(null)}>
          <div className="modal-container manual-exit-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manage Session Exit & Payment</h3>
              <button className="close-btn" onClick={() => setManageExitSession(null)}>×</button>
            </div>

            <div className="modal-body">
              <div className="exit-session-card">
                <div className="exit-card-header">
                  <div className="exit-plate-title">
                    {manageExitSession.vehicle_type === 'car' ? <IconCar size={20} /> : <IconMotorcycle size={20} />}
                    <span>{manageExitSession.plate_number}</span>
                  </div>

                  <div className={`exit-pay-badge ${isManageSessionPaid ? 'paid' : 'pending'}`}>
                    {isManageSessionPaid ? (
                      <>
                        <IconCheck size={13} />
                        <span>Paid ({manageSessionPayment?.payment_method?.toUpperCase() || 'PAID'})</span>
                      </>
                    ) : (
                      <span>● Payment Pending</span>
                    )}
                  </div>
                </div>

                <div className="exit-details-grid">
                  <div className="exit-detail-cell">
                    <span className="cell-label">Vehicle Type</span>
                    <span className="cell-val">{manageExitSession.vehicle_type}</span>
                  </div>
                  <div className="exit-detail-cell">
                    <span className="cell-label">Assigned Slot</span>
                    <span className="cell-val">{manageExitSession.slot_id || 'None'}</span>
                  </div>
                  <div className="exit-detail-cell">
                    <span className="cell-label">Entry Time</span>
                    <span className="cell-val">{new Date(manageExitSession.entry_time).toLocaleTimeString()}</span>
                  </div>
                  <div className="exit-detail-cell">
                    <span className="cell-label">Duration</span>
                    <span className="cell-val">{calculateSessionDetails(manageExitSession).durationHours} hrs</span>
                  </div>
                </div>

                <div className="exit-total-bar">
                  <span>Total Parking Fee:</span>
                  <span className="exit-total-amount">₱{calculateSessionDetails(manageExitSession).totalAmount.toFixed(2)}</span>
                </div>

                {!isManageSessionPaid && (
                  <div className="exit-payment-action-box">
                    <div className="pay-method-row">
                      <label>Payment Method:</label>
                      <select
                        className="clean-select"
                        value={exitPaymentMethod}
                        onChange={e => setExitPaymentMethod(e.target.value as PaymentMethod)}
                      >
                        <option value="cash">Cash</option>
                        <option value="gcash">GCash</option>
                        <option value="card">Card</option>
                      </select>
                    </div>
                    <button
                      className="btn-primary pay-now-btn"
                      onClick={handleProcessPayment}
                      disabled={isProcessingPayment}
                    >
                      {isProcessingPayment ? 'Processing...' : `Process Manual Payment (₱${calculateSessionDetails(manageExitSession).totalAmount.toFixed(2)})`}
                    </button>
                  </div>
                )}
              </div>

              {exitStatusMsg && (
                <div className={`save-status ${exitStatusMsg.ok ? 'success' : 'error'}`} style={{ marginTop: '12px' }}>
                  {exitStatusMsg.msg}
                </div>
              )}

              <div className="clean-modal-actions" style={{ marginTop: '16px' }}>
                <button className="btn-secondary" onClick={() => setManageExitSession(null)}>Close</button>
                <button
                  className="btn-danger-action"
                  onClick={() => setExitConfirmSession(manageExitSession)}
                >
                  <IconArrowRight size={14} />
                  <span>Complete Exit</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 4. EXIT CONFIRMATION POPUP ===== */}
      {exitConfirmSession && (
        <div className="modal-overlay confirm-overlay" onClick={() => setExitConfirmSession(null)}>
          <div className="modal-container confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <h3>Confirm Manual Exit</h3>
            </div>
            <div className="confirm-modal-body">
              <p className="confirm-main-text">
                Are you sure you want to complete manual exit for vehicle <strong>{exitConfirmSession.plate_number}</strong>?
              </p>
              {exitConfirmSession.slot_id && (
                <p className="confirm-sub-text">
                  This will complete the session and free up Slot <strong>{exitConfirmSession.slot_id}</strong>.
                </p>
              )}
              {!isManageSessionPaid && (
                <div className="confirm-warn-box">
                  ⚠️ Note: This session has not been marked as paid.
                </div>
              )}
            </div>
            <div className="confirm-modal-actions">
              <button className="btn-secondary" onClick={() => setExitConfirmSession(null)}>Cancel</button>
              <button className="btn-danger-action" onClick={handleConfirmExit}>Confirm Exit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
