/**
 * Dashboard.tsx — Main Admin Dashboard Page
 *
 * Modern, fixed-height, non-scrolling dashboard layout:
 * - Left: Large, full-height Live Camera feed with integrated mode switch & camera dropdown
 * - Right:
 *   1. Single Unified Stats Card (Cars, Motorcycles, Active Sessions, Total Slots)
 *   2. Compact Quick Actions (Manual Entry, Manual Exit)
 *   3. Recent Plate Recognition List with interactive Quick Look details modal
 * - Modals:
 *   - Plate Recognition Quick Look Modal (snapshot, direction, matched session, payment status)
 *   - Clean Manual Entry (Plate, Vehicle Type, Auto-Timestamp)
 *   - Search-based Manual Exit with Payment Status, Manual Payment, and Exit Confirmation
 */
import { useEffect, useState, useCallback } from 'react';
import {
  supabase,
  type ParkingSlot,
  type Camera,
  type PlateRecognition,
  type ParkingSession,
  type Payment,
  type VehicleType,
  type PaymentMethod
} from '@/lib/supabase';
import {
  IconCar,
  IconMotorcycle,
  IconCamera,
  IconPlus,
  IconPayment,
  IconCheck,
  IconArrowRight,
  IconSearch,
  IconView,
  IconClock
} from '@/components/Icons';
import { CameraFeed } from '@/components/CameraFeed';
import type { EntranceResult, ExitResult } from '@/lib/visionEngine';

/** Helper to get current datetime formatted for datetime-local input */
const getCurrentDateTimeLocal = (): string => {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000;
  return (new Date(Date.now() - tzoffset)).toISOString().slice(0, 16);
};

export function Dashboard() {
  // ============================================================
  // STATE MANAGEMENT
  // ============================================================
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [recognitions, setRecognitions] = useState<PlateRecognition[]>([]);
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activeCamera, setActiveCamera] = useState<Camera | null>(null);
  const [cameraTab, setCameraTab] = useState<'entrance' | 'exit' | 'slot'>('entrance');
  const [maxCars, setMaxCars] = useState(30);
  const [maxMotos, setMaxMotos] = useState(20);

  /** Modals */
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [selectedRecognition, setSelectedRecognition] = useState<PlateRecognition | null>(null);
  const [exitConfirmSession, setExitConfirmSession] = useState<ParkingSession | null>(null);

  /** Manual Entry Form state */
  const [manualForm, setManualForm] = useState(() => {
    return {
      plate: '',
      type: 'car' as VehicleType,
      time: getCurrentDateTimeLocal(),
    };
  });
  const [entryStatus, setEntryStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  /** Manual Exit Search & Form state */
  const [exitSearchQuery, setExitSearchQuery] = useState('');
  const [selectedExitSession, setSelectedExitSession] = useState<ParkingSession | null>(null);
  const [exitPaymentMethod, setExitPaymentMethod] = useState<PaymentMethod>('cash');
  const [exitStatus, setExitStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // ============================================================
  // DATA FETCHING & REALTIME
  // ============================================================
  const refreshData = useCallback(() => {
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(25).then(({ data }) => setRecognitions(data || []));
    supabase.from('parking_sessions').select('*').order('created_at', { ascending: false }).then(({ data }) => setSessions(data || []));
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => setSlots(data || []));
    supabase.from('payments').select('*').order('created_at', { ascending: false }).then(({ data }) => setPayments(data || []));
  }, []);

  useEffect(() => {
    refreshData();

    supabase.from('cameras').select('*').order('name').then(({ data }) => {
      const loaded = data || [];
      setCameras(loaded);
      const firstEntrance = loaded.find(c => c.type === 'entrance');
      if (firstEntrance) setActiveCamera(firstEntrance);
      else if (loaded.length > 0) setActiveCamera(loaded[0]);
    });

    supabase.from('settings').select('key, value').then(({ data }) => {
      if (data) {
        const m = Object.fromEntries(data.map((r: any) => [r.key, r.value]));
        setMaxCars(Number(m.max_capacity_cars) || 30);
        setMaxMotos(Number(m.max_capacity_motorcycles) || 20);
      }
    });

    const channel = supabase
      .channel('dashboard-realtime-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plate_recognitions' }, refreshData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_sessions' }, refreshData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, refreshData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, refreshData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshData]);

  /** When user clicks mode tab, switch active camera to first of that type */
  const handleTabChange = (tab: 'entrance' | 'exit' | 'slot') => {
    setCameraTab(tab);
    const matching = cameras.filter(c => c.type === tab);
    if (matching.length > 0) {
      setActiveCamera(matching[0]);
    }
  };

  /** When user selects from the camera dropdown, switch activeCamera and tab */
  const handleCameraSelect = (cameraId: string) => {
    const cam = cameras.find(c => c.id === cameraId);
    if (cam) {
      setActiveCamera(cam);
      if (cam.type === 'entrance' || cam.type === 'exit' || cam.type === 'slot') {
        setCameraTab(cam.type);
      }
    }
  };

  /** Vision callbacks */
  const handleEntranceResult = useCallback((result: EntranceResult) => {
    console.log('[Dashboard] Entrance detection:', result.plateNumber);
    refreshData();
  }, [refreshData]);

  const handleExitResult = useCallback((result: ExitResult) => {
    console.log('[Dashboard] Exit detection:', result.plateNumber, result.totalAmount);
    refreshData();
  }, [refreshData]);

  // ============================================================
  // COMPUTED PROPERTIES
  // ============================================================
  const occupiedCarSlots = slots.filter(s => s.vehicle_type === 'car' && s.status === 'occupied').length;
  const occupiedMotoSlots = slots.filter(s => s.vehicle_type === 'motorcycle' && s.status === 'occupied').length;
  const availableCars = Math.max(0, maxCars - occupiedCarSlots);
  const availableMotos = Math.max(0, maxMotos - occupiedMotoSlots);
  const activeSessions = sessions.filter(s => s.status === 'active');
  const availableSlotsCount = slots.filter(s => s.status === 'available').length;

  const liveTimestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

  // Matching active sessions for manual exit search
  const exitMatches = activeSessions.filter(s => {
    if (!exitSearchQuery.trim()) return false;
    const q = exitSearchQuery.toLowerCase().trim();
    return s.plate_number.toLowerCase().includes(q) || (s.slot_id && s.slot_id.toLowerCase().includes(q));
  });

  // Check if the currently selected exit session is paid
  const sessionPayment = selectedExitSession
    ? payments.find(p => p.session_id === selectedExitSession.id && p.status === 'completed') ||
      (selectedExitSession.concept === 'B' ? { status: 'completed', payment_method: 'wallet', receipt_number: 'APP-WALLET' } : null)
    : null;
  const isSessionPaid = Boolean(sessionPayment);

  // Calculate duration & fee for exit session
  const calculateExitDetails = (session: ParkingSession) => {
    const entryDate = new Date(session.entry_time);
    const durationHours = Math.max(0.5, Math.ceil(((Date.now() - entryDate.getTime()) / 3600000) * 2) / 2);
    const rate = session.vehicle_type === 'motorcycle' ? 25 : 50;
    const totalAmount = durationHours * rate;
    return { durationHours, rate, totalAmount };
  };

  // Matched session & payment for Quick Look recognition modal
  const recognitionMatchedSession = selectedRecognition
    ? sessions.find(s => s.plate_number.toUpperCase() === selectedRecognition.plate_number.toUpperCase())
    : null;
  const recognitionMatchedPayment = recognitionMatchedSession
    ? payments.find(p => p.session_id === recognitionMatchedSession.id && p.status === 'completed')
    : (selectedRecognition ? payments.find(p => p.plate_number.toUpperCase() === selectedRecognition.plate_number.toUpperCase() && p.status === 'completed') : null);

  // ============================================================
  // ACTION HANDLERS
  // ============================================================

  /** Handle Manual Entry Submit */
  const handleManualEntrySubmit = async () => {
    const formattedPlate = manualForm.plate.toUpperCase().replace(/[^A-Z0-9 -]/g, '').trim();

    if (!formattedPlate || formattedPlate.length < 3) {
      setEntryStatus({ msg: 'Please enter a valid plate number (at least 3 characters).', ok: false });
      return;
    }

    const time = manualForm.time ? new Date(manualForm.time).toISOString() : new Date().toISOString();

    // 1. Create a parking session
    const { error: sessionErr } = await supabase.from('parking_sessions').insert({
      plate_number: formattedPlate,
      vehicle_type: manualForm.type,
      entry_time: time,
      entry_camera: 'Manual Entry',
      status: 'active',
      concept: 'A',
    });

    if (sessionErr) {
      setEntryStatus({ msg: 'Error creating session: ' + sessionErr.message, ok: false });
      return;
    }

    // 2. Log recognition event
    await supabase.from('plate_recognitions').insert({
      plate_number: formattedPlate,
      vehicle_type: manualForm.type,
      direction: 'entry',
      confidence: 100,
      camera_name: 'Manual Entry',
      created_at: time,
    });

    // 3. Create notification
    await supabase.from('notifications').insert({
      type: 'info',
      title: `Manual Entry: ${formattedPlate}`,
      message: `Vehicle (${manualForm.type}) logged manually at ${new Date(time).toLocaleTimeString()}.`,
    });

    setEntryStatus({ msg: `Vehicle ${formattedPlate} logged successfully ✓`, ok: true });
    refreshData();

    setTimeout(() => {
      setEntryStatus(null);
      setIsEntryModalOpen(false);
      setManualForm({ plate: '', type: 'car', time: getCurrentDateTimeLocal() });
    }, 1200);
  };

  /** Process Manual Payment for the selected exit session */
  const handleProcessManualPayment = async () => {
    if (!selectedExitSession) return;
    setIsProcessingPayment(true);
    setExitStatus(null);

    try {
      const { durationHours, rate, totalAmount } = calculateExitDetails(selectedExitSession);
      const { data: countData } = await supabase.from('payments').select('id');
      const receiptNum = `RCP-${new Date().getFullYear()}-${String((countData?.length || 0) + 1).padStart(4, '0')}`;

      const { error } = await supabase.from('payments').insert({
        receipt_number: receiptNum,
        plate_number: selectedExitSession.plate_number,
        session_id: selectedExitSession.id,
        duration_hours: durationHours,
        hourly_rate: rate,
        total_amount: totalAmount,
        payment_method: exitPaymentMethod,
        status: 'completed',
        processed_by: 'admin',
      });

      if (error) {
        setExitStatus({ msg: 'Payment error: ' + error.message, ok: false });
        setIsProcessingPayment(false);
        return;
      }

      setExitStatus({ msg: `Payment recorded (₱${totalAmount.toFixed(2)}) — Receipt: ${receiptNum} ✓`, ok: true });
      refreshData();
    } catch (err: any) {
      setExitStatus({ msg: 'Error: ' + err.message, ok: false });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  /** Trigger Exit Confirmation Popup */
  const handlePromptExitConfirm = () => {
    if (!selectedExitSession) return;
    setExitConfirmSession(selectedExitSession);
  };

  /** Complete Manual Exit */
  const handleConfirmExit = async () => {
    if (!exitConfirmSession) return;

    const session = exitConfirmSession;
    const exitTime = new Date().toISOString();

    // 1. Complete session
    await supabase.from('parking_sessions').update({
      status: 'completed',
      exit_time: exitTime,
      exit_camera: 'Manual Exit',
    }).eq('id', session.id);

    // 2. Free up slot if assigned
    if (session.slot_id) {
      await supabase.from('parking_slots').update({
        status: 'available',
        current_session_id: null,
      }).eq('slot_id', session.slot_id);
    }

    // 3. Log exit recognition
    await supabase.from('plate_recognitions').insert({
      plate_number: session.plate_number,
      vehicle_type: session.vehicle_type,
      direction: 'exit',
      confidence: 100,
      camera_name: 'Manual Exit',
      created_at: exitTime,
    });

    // 4. Notification
    await supabase.from('notifications').insert({
      type: 'success',
      title: `Vehicle Exited: ${session.plate_number}`,
      message: `Manual exit completed for ${session.plate_number}.`,
    });

    refreshData();
    setExitConfirmSession(null);
    setSelectedExitSession(null);
    setExitSearchQuery('');
    setExitStatus({ msg: `Manual exit completed for ${session.plate_number} ✓`, ok: true });

    setTimeout(() => {
      setExitStatus(null);
      setIsExitModalOpen(false);
    }, 1000);
  };

  // ============================================================
  // RENDER UI
  // ============================================================
  return (
    <div className="dashboard-fixed-layout">
      {/* ===== LEFT COLUMN: FULL-HEIGHT LIVE CAMERA SECTION ===== */}
      <div className="dashboard-camera-col">
        <div className="camera-main-card">
          {/* Header with Live indicator, mode tabs, and camera dropdown */}
          <div className="camera-main-header">
            <div className="camera-header-left">
              <span className="live-badge"><span className="live-dot" /> LIVE</span>
              <span className="camera-title-name">{activeCamera?.name || 'Live Camera Feed'}</span>
            </div>

            {/* Camera Switcher Tabs (Entrance, Exit, Slots) */}
            <div className="camera-mode-switcher">
              <button
                className={`cam-mode-tab ${cameraTab === 'entrance' ? 'active' : ''}`}
                onClick={() => handleTabChange('entrance')}
              >
                Entrance
              </button>
              <button
                className={`cam-mode-tab ${cameraTab === 'exit' ? 'active' : ''}`}
                onClick={() => handleTabChange('exit')}
              >
                Exit
              </button>
              <button
                className={`cam-mode-tab ${cameraTab === 'slot' ? 'active' : ''}`}
                onClick={() => handleTabChange('slot')}
              >
                Slots
              </button>
            </div>

            {/* Upper-right Camera Dropdown Selector */}
            <div className="camera-header-right">
              <div className="camera-select-wrapper">
                <IconCamera size={14} className="camera-select-icon" />
                <select
                  className="camera-dropdown-select"
                  value={activeCamera?.id || ''}
                  onChange={e => handleCameraSelect(e.target.value)}
                  title="Switch Camera Feed"
                >
                  {cameras.length === 0 && <option value="">No cameras configured</option>}
                  {cameras.map(c => (
                    <option key={c.id} value={c.id}>
                      [{c.type.toUpperCase()}] {c.name} {c.slot_range ? `(${c.slot_range})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <span className="camera-live-clock">{liveTimestamp}</span>
            </div>
          </div>

          {/* Camera Feed Viewport */}
          <div className="camera-viewport">
            {(cameraTab === 'entrance' || cameraTab === 'exit') ? (
              <CameraFeed
                mode={cameraTab as 'entrance' | 'exit'}
                deviceId={activeCamera?.device_id}
                onEntranceResult={handleEntranceResult}
                onExitResult={handleExitResult}
              />
            ) : (
              <div className="camera-placeholder">
                <IconCamera size={48} className="camera-placeholder-icon" />
                <div className="camera-placeholder-text">
                  {activeCamera ? (activeCamera.name || activeCamera.location) : 'No slot camera selected'}
                </div>
                {activeCamera?.slot_range && (
                  <div className="slot-cam-range" style={{ marginTop: '4px', fontSize: '12px' }}>
                    Monitoring Slots: {activeCamera.slot_range}
                  </div>
                )}
                {activeCamera && !activeCamera.is_online && (
                  <div className="camera-offline">Camera Offline</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== RIGHT COLUMN: UNIFIED STATS + QUICK ACTIONS + RECOGNITIONS ===== */}
      <div className="dashboard-sidebar-col">
        {/* 1. SINGLE UNIFIED STATS CARD */}
        <div className="unified-stats-card">
          <div className="unified-stats-header">
            <span className="unified-stats-title">Facility Overview</span>
            <span className="stats-live-dot" />
          </div>

          <div className="unified-stats-grid">
            {/* Cars */}
            <div className="stat-item">
              <div className="stat-item-top">
                <IconCar size={16} className="stat-icon car" />
                <span className="stat-label">Cars</span>
              </div>
              <div className="stat-number available">{availableCars}</div>
              <div className="stat-sub">{maxCars} max capacity</div>
            </div>

            {/* Motorcycles */}
            <div className="stat-item">
              <div className="stat-item-top">
                <IconMotorcycle size={16} className="stat-icon moto" />
                <span className="stat-label">Motorcycles</span>
              </div>
              <div className="stat-number available">{availableMotos}</div>
              <div className="stat-sub">{maxMotos} max capacity</div>
            </div>

            {/* Active Sessions */}
            <div className="stat-item">
              <div className="stat-item-top">
                <span className="session-dot" />
                <span className="stat-label">Active Sessions</span>
              </div>
              <div className="stat-number">{activeSessions.length}</div>
              <div className="stat-sub">Vehicles parked</div>
            </div>

            {/* Total Slots */}
            <div className="stat-item">
              <div className="stat-item-top">
                <span className="slot-dot" />
                <span className="stat-label">Slots</span>
              </div>
              <div className="stat-number">{availableSlotsCount} <span className="stat-denom">/ {slots.length}</span></div>
              <div className="stat-sub">Available spaces</div>
            </div>
          </div>
        </div>

        {/* 2. COMPACT QUICK ACTIONS */}
        <div className="quick-actions-bar">
          <button className="quick-action-btn primary" onClick={() => { setIsEntryModalOpen(true); setEntryStatus(null); }}>
            <IconPlus size={15} />
            <span>Manual Entry</span>
          </button>
          <button className="quick-action-btn secondary" onClick={() => { setIsExitModalOpen(true); setExitStatus(null); setSelectedExitSession(null); setExitSearchQuery(''); }}>
            <IconPayment size={15} />
            <span>Manual Exit</span>
          </button>
        </div>

        {/* 3. RECENT PLATE RECOGNITION PANEL */}
        <div className="recognition-compact-panel">
          <div className="recognition-panel-header">
            <span>Recent Recognitions</span>
            <span className="rec-count-tag">{recognitions.length}</span>
          </div>

          <div className="recognition-compact-list">
            {recognitions.slice(0, 12).map(r => (
              <button
                key={r.id}
                className="recognition-compact-item"
                onClick={() => setSelectedRecognition(r)}
                title="Click for full recognition details"
              >
                <div className="rec-item-left">
                  <div className="rec-compact-plate">{r.plate_number}</div>
                  <div className="rec-compact-sub">
                    <span>{r.vehicle_type}</span>
                    <span>•</span>
                    <span>{new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                <div className="rec-item-right">
                  <span className={`rec-badge ${r.direction}`}>{r.direction}</span>
                  <span className="rec-conf">{r.confidence}%</span>
                </div>
              </button>
            ))}

            {recognitions.length === 0 && (
              <div className="empty-state" style={{ padding: '24px 12px', fontSize: '12px' }}>
                No plate recognitions yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== 1. RECOGNITION DETAILS QUICK LOOK MODAL ===== */}
      {selectedRecognition && (
        <div className="modal-overlay" onClick={() => setSelectedRecognition(null)}>
          <div className="modal-container quick-look-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="quick-look-title-bar">
                <span className={`rec-badge ${selectedRecognition.direction}`} style={{ fontSize: '11px', padding: '3px 8px' }}>
                  {selectedRecognition.direction.toUpperCase()} EVENT
                </span>
                <h3>Plate Recognition Details</h3>
              </div>
              <button className="close-btn" onClick={() => setSelectedRecognition(null)}>×</button>
            </div>

            <div className="modal-body">
              {/* Top Banner: Plate + Image */}
              <div className="quick-look-banner">
                {selectedRecognition.image_url || recognitionMatchedSession?.image_url ? (
                  <img
                    src={selectedRecognition.image_url || recognitionMatchedSession?.image_url || ''}
                    alt="Plate snapshot"
                    className="quick-look-image"
                  />
                ) : (
                  <div className="quick-look-icon-placeholder">
                    {selectedRecognition.vehicle_type === 'car' ? <IconCar size={36} /> : <IconMotorcycle size={36} />}
                  </div>
                )}

                <div className="quick-look-plate-info">
                  <div className="quick-look-plate">{selectedRecognition.plate_number}</div>
                  <div className="quick-look-type-row">
                    <span className="quick-look-type">{selectedRecognition.vehicle_type}</span>
                    <span className="quick-look-conf">Confidence: {selectedRecognition.confidence}%</span>
                  </div>
                  <div className="quick-look-cam">Captured by: <strong>{selectedRecognition.camera_name}</strong></div>
                </div>
              </div>

              {/* Details Grid */}
              <div className="quick-look-grid">
                <div className="quick-look-cell">
                  <span className="cell-label">Date & Time</span>
                  <span className="cell-val">{new Date(selectedRecognition.created_at).toLocaleString()}</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Assigned Slot</span>
                  <span className="cell-val">{recognitionMatchedSession?.slot_id || 'None'}</span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Session Status</span>
                  <span className="cell-val">
                    {recognitionMatchedSession ? (
                      <span className={`status-badge ${recognitionMatchedSession.status}`}>{recognitionMatchedSession.status}</span>
                    ) : (
                      <span className="text-muted">No active session</span>
                    )}
                  </span>
                </div>
                <div className="quick-look-cell">
                  <span className="cell-label">Payment Status</span>
                  <span className="cell-val">
                    {recognitionMatchedPayment ? (
                      <span className="text-green font-semibold">✓ Paid ({recognitionMatchedPayment.payment_method})</span>
                    ) : recognitionMatchedSession?.status === 'active' ? (
                      <span className="text-yellow font-semibold">● Payment Pending</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Extra Payment Info if paid */}
              {recognitionMatchedPayment && (
                <div className="quick-look-receipt-box">
                  <div><strong>Receipt No:</strong> {recognitionMatchedPayment.receipt_number}</div>
                  <div><strong>Amount:</strong> ₱{Number(recognitionMatchedPayment.total_amount).toFixed(2)} ({recognitionMatchedPayment.duration_hours} hrs)</div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="clean-modal-actions" style={{ marginTop: '16px' }}>
                <button className="btn-secondary" onClick={() => setSelectedRecognition(null)}>Close</button>

                {/* If session is active, allow quick jump to Manual Exit/Pay */}
                {recognitionMatchedSession && recognitionMatchedSession.status === 'active' && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      const sess = recognitionMatchedSession;
                      setSelectedRecognition(null);
                      setSelectedExitSession(sess);
                      setExitSearchQuery(sess.plate_number);
                      setIsExitModalOpen(true);
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

      {/* ===== 2. CLEAN MANUAL ENTRY MODAL ===== */}
      {isEntryModalOpen && (
        <div className="modal-overlay" onClick={() => setIsEntryModalOpen(false)}>
          <div className="modal-container manual-clean-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manual Vehicle Entry</h3>
              <button className="close-btn" onClick={() => setIsEntryModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="clean-form-group">
                <label>Plate Number</label>
                <input
                  className="clean-plate-input"
                  autoFocus
                  value={manualForm.plate}
                  onChange={e => setManualForm({ ...manualForm, plate: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 8) })}
                  placeholder="e.g. ABC 1234"
                  maxLength={8}
                />
              </div>

              <div className="clean-form-group">
                <label>Vehicle Type</label>
                <div className="vehicle-type-segmented">
                  <button
                    type="button"
                    className={`type-seg-btn ${manualForm.type === 'car' ? 'active' : ''}`}
                    onClick={() => setManualForm({ ...manualForm, type: 'car' })}
                  >
                    <IconCar size={16} />
                    <span>Car</span>
                  </button>
                  <button
                    type="button"
                    className={`type-seg-btn ${manualForm.type === 'motorcycle' ? 'active' : ''}`}
                    onClick={() => setManualForm({ ...manualForm, type: 'motorcycle' })}
                  >
                    <IconMotorcycle size={16} />
                    <span>Motorcycle</span>
                  </button>
                </div>
              </div>

              <div className="clean-form-group">
                <label>Timestamp (Auto / Editable)</label>
                <input
                  type="datetime-local"
                  className="clean-input"
                  value={manualForm.time}
                  onChange={e => setManualForm({ ...manualForm, time: e.target.value })}
                />
              </div>

              {entryStatus && (
                <div className={`save-status ${entryStatus.ok ? 'success' : 'error'}`}>
                  {entryStatus.msg}
                </div>
              )}

              <div className="clean-modal-actions">
                <button className="btn-secondary" onClick={() => setIsEntryModalOpen(false)}>Cancel</button>
                <button className="btn-primary" onClick={handleManualEntrySubmit}>Log Entry</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 3. SEARCH-BASED MANUAL EXIT & PAYMENT MODAL ===== */}
      {isExitModalOpen && (
        <div className="modal-overlay" onClick={() => setIsExitModalOpen(false)}>
          <div className="modal-container manual-exit-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manual Exit & Payment</h3>
              <button className="close-btn" onClick={() => setIsExitModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {/* Search Bar for active plates */}
              <div className="exit-search-bar">
                <IconSearch size={15} className="exit-search-icon" />
                <input
                  autoFocus
                  className="exit-search-input"
                  placeholder="Search plate number (e.g. ABC 1234)..."
                  value={exitSearchQuery}
                  onChange={e => {
                    setExitSearchQuery(e.target.value.toUpperCase());
                    setSelectedExitSession(null);
                    setExitStatus(null);
                  }}
                />
              </div>

              {/* Suggestions dropdown if search query typed but session not chosen */}
              {exitSearchQuery && !selectedExitSession && (
                <div className="exit-suggestions-list">
                  {exitMatches.map(s => (
                    <button
                      key={s.id}
                      className="exit-suggestion-item"
                      onClick={() => {
                        setSelectedExitSession(s);
                        setExitSearchQuery(s.plate_number);
                        setExitStatus(null);
                      }}
                    >
                      <span className="sug-plate">{s.plate_number}</span>
                      <span className="sug-meta">{s.vehicle_type} {s.slot_id ? `• Slot ${s.slot_id}` : ''} • Entered {new Date(s.entry_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </button>
                  ))}
                  {exitMatches.length === 0 && (
                    <div className="exit-no-match">No active session found for "{exitSearchQuery}"</div>
                  )}
                </div>
              )}

              {/* Selected Session Details Card */}
              {selectedExitSession && (
                <div className="exit-session-card">
                  <div className="exit-card-header">
                    <div className="exit-plate-title">
                      {selectedExitSession.vehicle_type === 'car' ? <IconCar size={20} /> : <IconMotorcycle size={20} />}
                      <span>{selectedExitSession.plate_number}</span>
                    </div>

                    {/* Payment Status Badge */}
                    <div className={`exit-pay-badge ${isSessionPaid ? 'paid' : 'pending'}`}>
                      {isSessionPaid ? (
                        <>
                          <IconCheck size={13} />
                          <span>Paid ({sessionPayment?.payment_method?.toUpperCase() || 'PAID'})</span>
                        </>
                      ) : (
                        <span>● Payment Pending</span>
                      )}
                    </div>
                  </div>

                  <div className="exit-details-grid">
                    <div className="exit-detail-cell">
                      <span className="cell-label">Vehicle Type</span>
                      <span className="cell-val">{selectedExitSession.vehicle_type}</span>
                    </div>
                    <div className="exit-detail-cell">
                      <span className="cell-label">Assigned Slot</span>
                      <span className="cell-val">{selectedExitSession.slot_id || 'None'}</span>
                    </div>
                    <div className="exit-detail-cell">
                      <span className="cell-label">Entry Time</span>
                      <span className="cell-val">{new Date(selectedExitSession.entry_time).toLocaleTimeString()}</span>
                    </div>
                    <div className="exit-detail-cell">
                      <span className="cell-label">Duration</span>
                      <span className="cell-val">{calculateExitDetails(selectedExitSession).durationHours} hrs</span>
                    </div>
                  </div>

                  <div className="exit-total-bar">
                    <span>Total Parking Fee:</span>
                    <span className="exit-total-amount">₱{calculateExitDetails(selectedExitSession).totalAmount.toFixed(2)}</span>
                  </div>

                  {/* If NOT paid yet, show Manual Payment Section */}
                  {!isSessionPaid && (
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
                        onClick={handleProcessManualPayment}
                        disabled={isProcessingPayment}
                      >
                        {isProcessingPayment ? 'Processing...' : `Process Manual Payment (₱${calculateExitDetails(selectedExitSession).totalAmount.toFixed(2)})`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {exitStatus && (
                <div className={`save-status ${exitStatus.ok ? 'success' : 'error'}`} style={{ marginTop: '12px' }}>
                  {exitStatus.msg}
                </div>
              )}

              <div className="clean-modal-actions" style={{ marginTop: '16px' }}>
                <button className="btn-secondary" onClick={() => setIsExitModalOpen(false)}>Close</button>

                {/* Manual Exit button */}
                <button
                  className="btn-danger-action"
                  disabled={!selectedExitSession}
                  onClick={handlePromptExitConfirm}
                >
                  <IconArrowRight size={14} />
                  <span>Manual Exit</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 4. MANUAL EXIT CONFIRMATION MODAL POPUP ===== */}
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
              {!isSessionPaid && (
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
