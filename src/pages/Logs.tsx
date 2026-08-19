/**
 * Logs.tsx — Consolidated Logs Module
 *
 * This page consolidates three major system log and administration views into
 * a single tabbed module. The sub-views are:
 *
 * 1. **User Management** — Full CRUD management for admin/staff accounts.
 * 2. **Payment Logs** — A purely read-only audit log of all financial transactions.
 * 3. **Vehicle Logs** — History of all parking sessions, showing vehicle details,
 *    assigned slots, timestamps, and camera plate snapshots.
 */
import { useEffect, useState } from 'react';
import { supabase, type User, type Payment, type ParkingSession } from '@/lib/supabase';
import { IconSearch, IconTrash, IconKey, IconPlus, IconDownload, IconView, IconCar, IconMotorcycle } from '@/components/Icons';
import { SessionModal, type SessionAction } from '@/components/SessionModal';

/**
 * Logs — Main Logs component.
 *
 * State:
 * - `activeTab`: Currently active tab ID ('users' | 'payments' | 'vehicles').
 * - `users`: Array of admin/staff users.
 * - `payments`: Array of all payment transactions.
 * - `sessions`: Array of all historical/active parking sessions.
 * - `searchQuery`: General search term applied to the active tab's dataset.
 * - `statusFilter`: Filter for session/payment status.
 *
 * @returns The logs page UI with tab navigation and corresponding sub-views.
 */
export function Logs() {
  /** The currently selected sub-view tab */
  const [activeTab, setActiveTab] = useState<'users' | 'payments' | 'vehicles'>('users');

  /** List of staff users (for User Management tab) */
  const [users, setUsers] = useState<User[]>([]);

  /** List of payments (for Payment Logs tab) */
  const [payments, setPayments] = useState<Payment[]>([]);

  /** List of sessions (for Vehicle Logs tab) */
  const [sessions, setSessions] = useState<ParkingSession[]>([]);

  /** Text query for filtering logs */
  const [searchQuery, setSearchQuery] = useState('');

  /** Filter by status (active/completed for sessions; completed/refunded/pending for payments) */
  const [statusFilter, setStatusFilter] = useState('all');
  const [sessionModal, setSessionModal] = useState<{ session: ParkingSession; action: SessionAction } | null>(null);

  /**
   * loadData — Loads data from Supabase depending on the active tab.
   *
   * Saves network bandwidth by only fetching the dataset needed
   * for the currently selected sub-view.
   */
  const loadData = () => {
    if (activeTab === 'users') {
      supabase.from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .then(({ data }) => setUsers(data || []));
    } else if (activeTab === 'payments') {
      supabase.from('payments')
        .select('*')
        .order('created_at', { ascending: false })
        .then(({ data }) => setPayments(data || []));
    } else if (activeTab === 'vehicles') {
      supabase.from('parking_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .then(({ data }) => setSessions(data || []));
    }
  };

  /** Trigger loading whenever the active tab changes */
  useEffect(() => {
    loadData();
    setSearchQuery('');
    setStatusFilter('all');
  }, [activeTab]);

  /**
   * deleteUser — Deletes a staff account from the database.
   *
   * Optimistically removes the deleted user from local state to ensure
   * instant UI feedback before database completion.
   *
   * @param id — UUID of the user to delete
   */
  const deleteUser = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    await supabase.from('users').delete().eq('id', id);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  const deletePayment = async (id: string) => {
    if (!confirm('Are you sure you want to delete this payment record?')) return;
    await supabase.from('payments').delete().eq('id', id);
    setPayments(prev => prev.filter(payment => payment.id !== id));
  };

  const deleteSession = async (id: string) => {
    if (!confirm('Are you sure you want to delete this vehicle session?')) return;
    await supabase.from('parking_sessions').delete().eq('id', id);
    setSessions(prev => prev.filter(session => session.id !== id));
  };

  // ============================================================
  // SEARCH & FILTER LOGIC
  // ============================================================

  /** Filtered user records based on search query */
  const filteredUsers = users.filter(u =>
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  /** Filtered payment records based on search query and status filter */
  const filteredPayments = payments.filter(p => {
    const matchesSearch = p.plate_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.receipt_number.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  /** Filtered session records based on search query and status filter */
  const filteredSessions = sessions.filter(s => {
    const matchesSearch = s.plate_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.slot_id && s.slot_id.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // ============================================================
  // RENDER SUB-VIEWS
  // ============================================================

  /**
   * renderUsers — Renders User Management CRUD view
   */
  const renderUsers = () => (
    <div className="logs-content-section">
      <div className="page-toolbar">
        <div className="search-wrapper">
          <IconSearch size={16} className="search-prefix" />
          <input
            className="search-input"
            placeholder="Search users..."
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
                  <button className="action-btn" title="Delete" onClick={() => deleteUser(u.id)}><IconTrash size={15} /></button>
                  <button className="action-btn" title="Reset Password" onClick={() => alert('Password reset')}><IconKey size={15} /></button>
                </div>
              </td>
            </tr>
          ))}
          {filteredUsers.length === 0 && <tr><td colSpan={7} className="empty-state">No users found</td></tr>}
        </tbody>
      </table>
    </div>
  );

  /**
   * renderPayments — Renders read-only Payment Logs view
   */
  const renderPayments = () => (
    <div className="logs-content-section">
      <div className="page-toolbar">
        <div className="search-wrapper">
          <IconSearch size={16} className="search-prefix" />
          <input
            className="search-input"
            placeholder="Search by plate or receipt number..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="search-input"
            style={{ width: '150px', background: 'var(--cursor-bg-tertiary)', border: '1px solid var(--cursor-border)' }}
          >
            <option value="all">All Status</option>
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
            <th>Date</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredPayments.map(p => (
            <tr key={p.id}>
              <td className="mono">{p.receipt_number}</td>
              <td className="mono">{p.plate_number}</td>
              <td>{p.duration_hours}h</td>
              <td>₱{p.total_amount.toFixed(2)}</td>
              <td><span className={`method-badge ${p.payment_method}`}>{p.payment_method}</span></td>
              <td>{new Date(p.created_at).toLocaleString()}</td>
              <td><span className={`status-badge ${p.status}`}>{p.status}</span></td>
              <td><div className="row-actions"><button className="action-btn action-danger" title="Delete payment" onClick={() => deletePayment(p.id)}><IconTrash size={15} /></button></div></td>
            </tr>
          ))}
          {filteredPayments.length === 0 && <tr><td colSpan={8} className="empty-state">No payments found</td></tr>}
        </tbody>
      </table>
    </div>
  );

  /**
   * renderVehicles — Renders Vehicle Logs view including session plate snapshots
   */
  const renderVehicles = () => (
    <div className="logs-content-section">
      <div className="page-toolbar">
        <div className="search-wrapper">
          <IconSearch size={16} className="search-prefix" />
          <input
            className="search-input"
            placeholder="Search plate or slot..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="toolbar-actions">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="search-input"
            style={{ width: '150px', background: 'var(--cursor-bg-tertiary)', border: '1px solid var(--cursor-border)' }}
          >
            <option value="all">All Status</option>
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
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredSessions.map(s => (
            <tr key={s.id}>
              <td className="mono font-bold">{s.plate_number}</td>
              <td>
                <span className="flex items-center gap-2">
                  {s.vehicle_type === 'car' ? <IconCar size={16} /> : <IconMotorcycle size={16} />}
                  <span className="capitalize">{s.vehicle_type}</span>
                </span>
              </td>
              <td className="mono">{s.slot_id || '—'}</td>
              <td>{new Date(s.entry_time).toLocaleString()}</td>
              <td>{s.exit_time ? new Date(s.exit_time).toLocaleString() : '—'}</td>
              <td>
                {s.image_url ? (
                  <div className="flex items-center gap-2">
                    <img
                      src={s.image_url}
                      alt="Entrance Snapshot"
                      style={{ width: '48px', height: '28px', borderRadius: '4px', objectFit: 'cover', border: '1px solid var(--cursor-border)' }}
                    />
                    <button className="action-btn" onClick={() => window.open(s.image_url || undefined)} title="View Image">
                      <IconView size={14} />
                    </button>
                  </div>
                ) : (
                  <span className="text-gray-500 text-xs italic">No Image</span>
                )}
              </td>
              <td><span className={`status-badge ${s.status}`}>{s.status}</span></td>
              <td><div className="row-actions"><button className="action-btn action-text" title="Manual Exit" onClick={() => setSessionModal({ session: s, action: 'exit' })}>Exit</button><button className="action-btn action-text" title="Manual Payment" onClick={() => setSessionModal({ session: s, action: 'payment' })}>Pay</button><button className="action-btn action-danger" title="Delete session" onClick={() => deleteSession(s.id)}><IconTrash size={15} /></button></div></td>
            </tr>
          ))}
          {filteredSessions.length === 0 && <tr><td colSpan={8} className="empty-state">No vehicle sessions found</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="payments-page">
      <div className="payment-history-card">
        {/* Navigation tabs */}
        <div className="logs-tabs">
          <button className={`logs-tab-btn ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            User Management
          </button>
          <button className={`logs-tab-btn ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>
            Payment Logs
          </button>
          <button className={`logs-tab-btn ${activeTab === 'vehicles' ? 'active' : ''}`} onClick={() => setActiveTab('vehicles')}>
            Vehicle Logs
          </button>
        </div>

        {/* Tab content panel */}
        <div style={{ padding: '0 20px 20px' }}>
          {activeTab === 'users' && renderUsers()}
          {activeTab === 'payments' && renderPayments()}
          {activeTab === 'vehicles' && renderVehicles()}
        </div>
      </div>
      {sessionModal && <SessionModal session={sessionModal.session} sessions={sessions} action={sessionModal.action} onClose={() => setSessionModal(null)} onComplete={loadData} />}
    </div>
  );
}
