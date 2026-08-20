/**
 * Dashboard.tsx — Main Admin Dashboard Page
 *
 * The central hub of the PLPark admin interface. This page provides
 * a real-time overview of the entire parking facility, including:
 *
 * 1. **Capacity Cards** — Available car and motorcycle spaces vs. max capacity
 * 2. **Active Sessions & Slot Stats** — Quick mini metrics
 * 3. **Live Camera Feed** — Camera selector with Entrance/Exit/Slot tabs
 * 4. **Plate Recognition Panel** — Scrollable list of recent OCR detections
 * 5. **Manual Vehicle Entry** — Form for manually logging plate recognitions
 *
 * All data is fetched from Supabase on component mount and displayed
 * in a responsive grid layout.
 */
import { useEffect, useState, useCallback } from 'react';
import { supabase, type ParkingSlot, type Camera, type PlateRecognition, type ParkingSession, type VehicleType, type Direction } from '@/lib/supabase';
import { IconCar, IconMotorcycle, IconCamera, IconPlus, IconPayment, IconClock } from '@/components/Icons';
import { CameraFeed } from '@/components/CameraFeed';
import { SessionModal, type SessionAction } from '@/components/SessionModal';
import type { EntranceResult, ExitResult } from '@/lib/visionEngine';

/**
 * getCurrentDateTimeLocal — Helper to get current local date/time formatted
 * for a datetime-local input (YYYY-MM-DDTHH:MM).
 *
 * @returns {string} The formatted datetime string.
 */
const getCurrentDateTimeLocal = (): string => {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000;
  const localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, 16);
  return localISOTime;
};

/**
 * Dashboard — Main Admin Dashboard Page
 *
 * Provides capacity overviews, active sessions, quick action modals for manual entry
 * and payments, live camera feed tabs, and recent plate detection logs.
 *
 * @returns The dashboard page UI.
 */
export function Dashboard({ searchQuery = '' }: { searchQuery?: string }) {
  // ============================================================
  // STATE MANAGEMENT
  // ============================================================
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [recognitions, setRecognitions] = useState<PlateRecognition[]>([]);
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [activeCamera, setActiveCamera] = useState<Camera | null>(null);
  const [cameraTab, setCameraTab] = useState<'entrance' | 'exit' | 'slot'>('entrance');
  const [maxCars, setMaxCars] = useState(30);
  const [maxMotos, setMaxMotos] = useState(20);

  /** Modal triggers */
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [sessionModal, setSessionModal] = useState<{ session: ParkingSession | null; action: SessionAction } | null>(null);

  /** Status messages */
  const [saveStatus, setSaveStatus] = useState('');
  const [payStatus, setPayStatus] = useState('');

  /**
   * Manual Entry Form State — Uses global draft persistence from localStorage.
   * Defaults to empty fields and current system time.
   */
  const [manualForm, setManualForm] = useState(() => {
    const saved = localStorage.getItem('plp_draft_manual_entry');
    return saved ? JSON.parse(saved) : { plate: '', type: 'car' as VehicleType, direction: 'entry' as Direction, time: getCurrentDateTimeLocal(), slot: '' };
  });

  /**
   * Manual Payment Form State — Uses global draft persistence from localStorage.
   * Defaults to empty fields, ₱50 rate, and cash payment method.
   */
  const [paymentForm, setPaymentForm] = useState(() => {
    const saved = localStorage.getItem('plp_draft_manual_payment');
    return saved ? JSON.parse(saved) : { plate: '', duration: '', rate: '50', method: 'cash' as any };
  });

  /** Recognition list expand/scroll state */
  const [recognitionsExpanded, setRecognitionsExpanded] = useState(false);

  // ============================================================
  // VISION PIPELINE CALLBACKS
  // ============================================================

  /** Refresh recognitions and sessions from DB after a vision event */
  const refreshAfterDetection = useCallback(() => {
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(12).then(({ data }) => setRecognitions(data || []));
    supabase.from('parking_sessions').select('*').order('created_at', { ascending: false }).then(({ data }) => setSessions(data || []));
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => setSlots(data || []));
  }, []);

  /** Called when entrance vision pipeline confirms a vehicle */
  const handleEntranceResult = useCallback((result: EntranceResult) => {
    console.log('[Dashboard] Entrance result:', result.plateNumber);
    refreshAfterDetection();
  }, [refreshAfterDetection]);

  /** Called when exit vision pipeline completes a session */
  const handleExitResult = useCallback((result: ExitResult) => {
    console.log('[Dashboard] Exit result:', result.plateNumber, '₱' + result.totalAmount);
    refreshAfterDetection();
  }, [refreshAfterDetection]);

  // ============================================================
  // SIDE-EFFECTS & PERSISTENCE
  // ============================================================

  /** Fetch initial database records and subscribe to realtime updates */
  useEffect(() => {
    refreshAfterDetection();

    supabase.from('cameras').select('*').order('name').then(({ data }) => setCameras(data || []));
    supabase.from('settings').select('key, value').then(({ data }) => {
      if (data) {
        const m = Object.fromEntries(data.map((r: any) => [r.key, r.value]));
        setMaxCars(m.max_capacity_cars || 30);
        setMaxMotos(m.max_capacity_motorcycles || 20);
      }
    });

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plate_recognitions' }, () => {
        refreshAfterDetection();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_sessions' }, () => {
        refreshAfterDetection();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshAfterDetection]);

  /** Save Manual Entry Form drafts to localStorage on change */
  useEffect(() => {
    localStorage.setItem('plp_draft_manual_entry', JSON.stringify(manualForm));
  }, [manualForm]);

  /** Save Manual Payment Form drafts to localStorage on change */
  useEffect(() => {
    localStorage.setItem('plp_draft_manual_payment', JSON.stringify(paymentForm));
  }, [paymentForm]);

  // ============================================================
  // COMPUTED PROPERTIES
  // ============================================================
  const occupiedCarSlots = slots.filter(s => s.vehicle_type === 'car' && s.status === 'occupied').length;
  const occupiedMotoSlots = slots.filter(s => s.vehicle_type === 'motorcycle' && s.status === 'occupied').length;
  const availableCars = maxCars - occupiedCarSlots;
  const availableMotos = maxMotos - occupiedMotoSlots;
  const filteredCameras = cameras.filter(c => c.type === cameraTab);
  const availableSlotOptions = slots
    .filter(s => s.status === 'available' && s.vehicle_type === manualForm.type)
    .map(s => s.slot_id);
  const payTotal = parseFloat(paymentForm.duration || '0') * parseFloat(paymentForm.rate || '0');
  const RECOGNITIONS_COLLAPSE_THRESHOLD = 6; // show See more when list exceeds this
  const activeSessions = sessions.filter(session => session.status === 'active');
  const visibleRecognitions = recognitions.filter(recognition => !searchQuery || [recognition.plate_number, recognition.camera_name, recognition.direction, recognition.vehicle_type].some(value => value?.toLowerCase().includes(searchQuery.toLowerCase())));
  const matchingExitSessions = activeSessions.filter(session => session.plate_number.toLowerCase().includes(manualForm.plate.toLowerCase()));
  const matchingPaymentSessions = activeSessions.filter(session => session.plate_number.toLowerCase().includes(paymentForm.plate.toLowerCase()));

  // ============================================================
  // MUTATION WORKFLOWS
  // ============================================================

  /**
   * handleManualSave — Submits a manual vehicle entry event.
   *
   * Validates:
   * 1. Plate number presence.
   * 2. Alphanumeric formatting.
   * 3. Character length constraint (between 3 and 8).
   *
   * Saves to database and schedules success feedback.
   */
  const handleManualSave = async () => {
    const formattedPlate = manualForm.plate.toUpperCase().replace(/[^A-Z0-9 -]/g, '').trim();

    if (!formattedPlate) {
      setSaveStatus('Plate number is required.');
      return;
    }
    if (formattedPlate.length < 3 || formattedPlate.length > 8) {
      setSaveStatus('Plate number must be between 3 and 8 characters.');
      return;
    }

    if (manualForm.direction === 'exit') {
      const session = activeSessions.find(item => item.plate_number.toUpperCase() === formattedPlate);
      if (!session) {
        setSaveStatus('Plate number does not match an active session.');
        return;
      }
      const { error } = await supabase.from('parking_sessions').update({ status: 'completed', exit_time: new Date().toISOString() }).eq('id', session.id);
      if (error) { setSaveStatus('Error saving: ' + error.message); return; }
      if (session.slot_id) await supabase.from('parking_slots').update({ status: 'available', current_session_id: null }).eq('slot_id', session.slot_id);
      setSaveStatus('Manual exit completed.');
      refreshAfterDetection();
      setTimeout(() => { setSaveStatus(''); setIsEntryModalOpen(false); }, 1000);
      return;
    }

    const time = manualForm.time || new Date().toISOString();

    const { error } = await supabase.from('plate_recognitions').insert({
      plate_number: formattedPlate,
      vehicle_type: manualForm.type,
      direction: manualForm.direction,
      confidence: 100,
      camera_name: 'Manual Entry',
      created_at: time,
    });

    if (error) {
      setSaveStatus('Error saving: ' + error.message);
      return;
    }

    setSaveStatus('Saved successfully.');
    setManualForm({ plate: '', type: 'car', direction: 'entry', time: getCurrentDateTimeLocal(), slot: '' });
    localStorage.removeItem('plp_draft_manual_entry');

    setTimeout(() => {
      setSaveStatus('');
      setIsEntryModalOpen(false);
    }, 1500);

    // Refresh recognitions
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(12).then(({ data }) => setRecognitions(data || []));
  };

  /**
   * handleProcessPayment — Submits a manual payment event.
   *
   * Validates:
   * 1. Plate number presence and bounds.
   * 2. Duration presence.
   *
   * Saves to database and schedules success feedback.
   */
  const handleProcessPayment = async () => {
    const formattedPlate = paymentForm.plate.toUpperCase().replace(/[^A-Z0-9 -]/g, '').trim();

    if (!formattedPlate) {
      setPayStatus('Plate number is required.');
      return;
    }
    if (formattedPlate.length < 3 || formattedPlate.length > 8) {
      setPayStatus('Plate must be between 3 and 8 characters.');
      return;
    }
    if (!paymentForm.duration || parseFloat(paymentForm.duration) <= 0) {
      setPayStatus('Valid duration is required.');
      return;
    }

    const activeSession = activeSessions.find(session => session.plate_number.toUpperCase() === formattedPlate);
    if (!activeSession) {
      setPayStatus('Plate number does not match an active session.');
      return;
    }

    // Fetch existing payment count to build unique receipt sequence
    const { data: countData } = await supabase.from('payments').select('id');
    const receiptNum = `RCP-2024-${String((countData?.length || 0) + 1).padStart(4, '0')}`;

    const { error } = await supabase.from('payments').insert({
      receipt_number: receiptNum,
      plate_number: formattedPlate,
      duration_hours: parseFloat(paymentForm.duration),
      hourly_rate: parseFloat(paymentForm.rate),
      total_amount: payTotal,
      session_id: activeSession.id,
      payment_method: paymentForm.method,
      status: 'completed',
      processed_by: 'admin',
    });

    if (error) {
      setPayStatus('Error processing: ' + error.message);
      return;
    }

    setPayStatus(`Payment Successful. Receipt: ${receiptNum}`);
    setPaymentForm({ plate: '', duration: '', rate: '50', method: 'cash' });
    localStorage.removeItem('plp_draft_manual_payment');

    setTimeout(() => {
      setPayStatus('');
      setIsPaymentModalOpen(false);
    }, 2000);
  };

  const liveTimestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

  // ============================================================
  // RENDER UI
  // ============================================================
  return (
    <div className="dashboard-grid">

      {/* ===== ROW 1: CAPACITY CARDS & QUICK ACTIONS ===== */}
      <div className="capacity-row">
        {/* Compact Car capacity card */}
        <div className="capacity-card compact">
          <div className="capacity-header">
            <IconCar size={18} className="capacity-icon" />
            <span className="capacity-label">Cars</span>
          </div>
          <div className="capacity-value available">{availableCars} Available</div>
          <div className="capacity-max">{maxCars} max capacity</div>
        </div>

        {/* Compact Motorcycle capacity card */}
        <div className="capacity-card compact">
          <div className="capacity-header">
            <IconMotorcycle size={18} className="capacity-icon" />
            <span className="capacity-label">Motorcycles</span>
          </div>
          <div className="capacity-value available">{availableMotos} Available</div>
          <div className="capacity-max">{maxMotos} max capacity</div>
        </div>

        {/* Compact Mini stats card */}
        <div className="capacity-mini compact">
          <div className="mini-row"><span>Active Sessions</span><span className="mini-value">{sessions.filter(s => s.status === 'active').length}</span></div>
          <div className="mini-row"><span>Total Slots</span><span className="mini-value">{slots.length}</span></div>
        </div>

        {/* Quick Actions Card (Upper-Right dashboard position) */}
        <div className="quick-actions-card">
          <div className="quick-actions-title">Quick Actions</div>
          <div className="quick-actions-grid">
            <button className="quick-action-btn" onClick={() => setIsEntryModalOpen(true)}>
              <IconPlus size={16} />
              <span>Manual Entry</span>
            </button>
            <button className="quick-action-btn" onClick={() => setIsPaymentModalOpen(true)}>
              <IconPayment size={16} />
              <span>Manual Payment</span>
            </button>
          </div>
        </div>
      </div>

      {/* ===== ROW 2: CAMERA FEED + RECOGNITION PANEL ===== */}
      <div className="camera-row">
        <div className="camera-main">
          <div className="camera-feed">
            <div className="camera-feed-header">
              <span className="live-badge"><span className="live-dot" /> LIVE</span>
              <span className="camera-name">{cameraTab === 'entrance' ? 'Entrance Camera' : cameraTab === 'exit' ? 'Exit Camera' : 'Slot Monitor'}</span>
              <span className="camera-timestamp">{liveTimestamp}</span>
            </div>
            <div className="camera-feed-body">
              {(cameraTab === 'entrance' || cameraTab === 'exit') ? (
                <CameraFeed
                  mode={cameraTab as 'entrance' | 'exit'}
                  deviceId={activeCamera?.device_id}
                  onEntranceResult={handleEntranceResult}
                  onExitResult={handleExitResult}
                />
              ) : (
                <div className="camera-placeholder">
                  <IconCamera size={42} className="camera-placeholder-icon" />
                  <div className="camera-placeholder-text">{activeCamera ? activeCamera.location || 'Live feed' : 'No camera selected'}</div>
                  {activeCamera && !activeCamera.is_online && <div className="camera-offline">Camera Offline</div>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="camera-tabs-panel">
          <div className="camera-tabs">
            <button className={cameraTab === 'entrance' ? 'active' : ''} onClick={() => setCameraTab('entrance')}>Entrance</button>
            <button className={cameraTab === 'exit' ? 'active' : ''} onClick={() => setCameraTab('exit')}>Exit</button>
            <button className={cameraTab === 'slot' ? 'active' : ''} onClick={() => setCameraTab('slot')}>Slots</button>
          </div>
          <div className="camera-list">
            {filteredCameras.map(cam => (
              <button
                key={cam.id}
                className={`camera-list-item ${activeCamera?.id === cam.id ? 'selected' : ''}`}
                onClick={() => setActiveCamera(cam)}
              >
                <span className={`cam-status ${cam.is_online ? 'online' : 'offline'}`} />
                <div className="cam-info">
                  <div className="cam-name">{cam.name}</div>
                  {cam.slot_range && <div className="cam-slot-range">Slot {cam.slot_range}</div>}
                  <div className="cam-location">{cam.location}</div>
                </div>
              </button>
            ))}
            {filteredCameras.length === 0 && <div className="empty-state">No cameras</div>}
          </div>
        </div>

        <div className="recognition-panel">
          <div className="panel-header">Plate Recognition</div>
          {/* Wrapper keeps header, list and footer (button) inside a fixed-height panel */}
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '360px' }}>
            <div
              className="recognition-list"
              style={{
                // take available space and allow scrolling only when expanded
                overflowY: recognitionsExpanded ? 'auto' : 'hidden',
                flex: '1 1 auto',
              }}
            >
              {(recognitionsExpanded ? visibleRecognitions : visibleRecognitions.slice(0, RECOGNITIONS_COLLAPSE_THRESHOLD)).map(r => (
                <button key={r.id} className="recognition-item recognition-item-button" onClick={() => {
                  const session = sessions.find(item => item.plate_number.toUpperCase() === r.plate_number.toUpperCase() && item.status === 'active');
                  setSessionModal({ session: session || null, action: r.direction === 'exit' ? 'exit' : 'payment' });
                }}>
                  <div className="rec-plate">{r.plate_number}</div>
                  <div className="rec-details">
                    <div className="rec-row"><span className="rec-label">Type</span><span className="rec-value">{r.vehicle_type}</span></div>
                    <div className="rec-row"><span className="rec-label">Direction</span><span className={`rec-badge ${r.direction}`}>{r.direction}</span></div>
                    <div className="rec-row"><span className="rec-label">Date</span><span className="rec-value">{new Date(r.created_at).toLocaleDateString()}</span></div>
                    <div className="rec-row"><span className="rec-label">Time</span><span className="rec-value">{new Date(r.created_at).toLocaleTimeString('en-US', { hour12: false })}</span></div>
                    <div className="rec-row"><span className="rec-label">Confidence</span><span className="rec-value">{r.confidence}%</span></div>
                    <div className="rec-row"><span className="rec-label">Camera</span><span className="rec-value">{r.camera_name}</span></div>
                  </div>
                </button>
              ))}
              {recognitions.length === 0 && <div className="empty-state">No detections</div>}
            </div>

            {/* Footer always visible at bottom of panel when list is long */}
            {recognitions.length > RECOGNITIONS_COLLAPSE_THRESHOLD && (
              <div style={{ padding: '8px 0 0', textAlign: 'center', flex: '0 0 auto' }}>
                <button className="see-more-btn" onClick={() => setRecognitionsExpanded(prev => !prev)} style={{ cursor: 'pointer' }}>
                  {recognitionsExpanded ? 'See less' : `See more (${recognitions.length})`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== FLOATING MANUAL ENTRY MODAL ===== */}
      {isEntryModalOpen && (
        <div className="modal-overlay" onClick={() => setIsEntryModalOpen(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manual Vehicle Entry</h3>
              <button className="close-btn" onClick={() => setIsEntryModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
                <div className="manual-entry-grid">
                <div className="form-group full-width">
                  <label>Plate Number</label>
                  <input
                    value={manualForm.plate}
                    onChange={e => setManualForm({ ...manualForm, plate: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 8) })}
                    placeholder="ABC 1234"
                    maxLength={8}
                  />
                  {manualForm.direction === 'exit' && manualForm.plate && <div className="plate-suggestions">{matchingExitSessions.map(session => <button key={session.id} onClick={() => setManualForm({ ...manualForm, plate: session.plate_number, type: session.vehicle_type, slot: session.slot_id || '' })}>{session.plate_number}<span>{session.vehicle_type} {session.slot_id ? `• Slot ${session.slot_id}` : ''}</span></button>)}{matchingExitSessions.length === 0 && <div className="plate-no-match">Plate number does not match an active session.</div>}</div>}
                  <span className="form-hint">Enforces uppercase alphanumeric (3-8 chars).</span>
                </div>
                <div className="form-group">
                  <label>Vehicle Type</label>
                  <select disabled={manualForm.direction === 'exit'} value={manualForm.type} onChange={e => setManualForm({ ...manualForm, type: e.target.value as VehicleType, slot: '' })}>
                    <option value="car">Car</option>
                    <option value="motorcycle">Motorcycle</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Entry / Exit</label>
                  <select value={manualForm.direction} onChange={e => setManualForm({ ...manualForm, direction: e.target.value as Direction })}>
                    <option value="entry">Entry</option>
                    <option value="exit">Exit</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Assigned Slot</label>
                  <select disabled={manualForm.direction === 'exit'} value={manualForm.slot} onChange={e => setManualForm({ ...manualForm, slot: e.target.value })}>
                    <option value="">Select a slot</option>
                    {availableSlotOptions.map(slotId => (
                      <option key={slotId} value={slotId}>{slotId}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Time</label>
                  <input disabled={manualForm.direction === 'exit'} type="datetime-local" value={manualForm.time} onChange={e => setManualForm({ ...manualForm, time: e.target.value })} />
                  <span className="form-hint">Defaults to current local time; editable.</span>
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: '20px', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={() => {
                  setManualForm({ plate: '', type: 'car', direction: 'entry', time: getCurrentDateTimeLocal(), slot: '' });
                  localStorage.removeItem('plp_draft_manual_entry');
                }}>Cancel</button>
                <button className="btn-primary" onClick={handleManualSave}>Save Entry</button>
              </div>
              {saveStatus && <div className={`save-status ${saveStatus.includes('Error') || saveStatus.includes('must be') ? 'error' : 'success'}`} style={{ marginTop: '12px' }}>{saveStatus}</div>}
            </div>
          </div>
        </div>
      )}

      {/* ===== FLOATING MANUAL PAYMENT MODAL ===== */}
      {isPaymentModalOpen && (
        <div className="modal-overlay" onClick={() => setIsPaymentModalOpen(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Process Manual Payment</h3>
              <button className="close-btn" onClick={() => setIsPaymentModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="payment-form-grid">
                <div className="form-group">
                  <label>Plate Number</label>
                  <input
                    value={paymentForm.plate}
                    onChange={e => setPaymentForm({ ...paymentForm, plate: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 8) })}
                    placeholder="ABC 1234"
                    maxLength={8}
                  />
                  {paymentForm.plate && matchingPaymentSessions.length > 0 && <div className="plate-suggestions">{matchingPaymentSessions.map(session => <button key={session.id} onClick={() => setPaymentForm({ ...paymentForm, plate: session.plate_number, duration: Math.max(0.5, (Date.now() - new Date(session.entry_time).getTime()) / 3600000).toFixed(2), rate: session.vehicle_type === 'motorcycle' ? '25' : '50' })}>{session.plate_number}<span>{session.vehicle_type} {session.slot_id ? `• Slot ${session.slot_id}` : ''}</span></button>)}</div>}
                </div>
                <div className="form-group">
                  <label>Parking Duration (hrs)</label>
                  <input type="number" step="0.5" value={paymentForm.duration} onChange={e => setPaymentForm({ ...paymentForm, duration: e.target.value })} placeholder="2.5" />
                </div>
                <div className="form-group full-width">
                  <label>Hourly Rate (₱)</label>
                  <input type="number" value={paymentForm.rate} onChange={e => setPaymentForm({ ...paymentForm, rate: e.target.value })} />
                </div>
                <div className="form-group full-width">
                  <label>Payment Method</label>
                  <select value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value as any })}>
                    <option value="cash">Cash</option>
                    <option value="gcash">GCash</option>
                    <option value="card">Card</option>
                  </select>
                </div>
                <div className="form-group full-width" style={{ marginTop: '8px' }}>
                  <label>Total Amount</label>
                  <div className="total-amount" style={{ padding: '4px 0' }}>₱{payTotal.toFixed(2)}</div>
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: '20px', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={() => {
                  setPaymentForm({ plate: '', duration: '', rate: '50', method: 'cash' });
                  localStorage.removeItem('plp_draft_manual_payment');
                }}>Cancel</button>
                <button className="btn-primary" onClick={handleProcessPayment}>Process Payment</button>
              </div>
              {payStatus && <div className={`save-status ${payStatus.includes('Error') || payStatus.includes('must be') ? 'error' : 'success'}`} style={{ marginTop: '12px' }}>{payStatus}</div>}
            </div>
          </div>
        </div>
      )}

      {sessionModal && <SessionModal session={sessionModal.session} sessions={sessions} action={sessionModal.action} onClose={() => setSessionModal(null)} onComplete={refreshAfterDetection} />}

    </div>
  );
}

