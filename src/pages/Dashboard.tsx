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
import { useEffect, useState } from 'react';
import { supabase, type ParkingSlot, type Camera, type PlateRecognition, type ParkingSession, type VehicleType, type Direction } from '@/lib/supabase';
import { IconCar, IconMotorcycle, IconCamera, IconClock } from '@/components/Icons';

/**
 * Dashboard — Main dashboard component.
 *
 * Fetches data from four tables (parking_slots, cameras, plate_recognitions,
 * parking_sessions) plus system settings on mount. Computes derived metrics
 * like available capacity and renders the complete dashboard grid.
 *
 * @returns The dashboard page UI with capacity cards, camera feed, recognition panel, and manual entry form
 */
export function Dashboard() {
  /** All parking slots — used to compute occupied vs. available counts */
  const [slots, setSlots] = useState<ParkingSlot[]>([]);

  /** All camera configurations — filtered by type for the camera panel tabs */
  const [cameras, setCameras] = useState<Camera[]>([]);

  /** Recent plate recognition events — displayed in the recognition panel */
  const [recognitions, setRecognitions] = useState<PlateRecognition[]>([]);

  /** All parking sessions — used for active session count */
  const [sessions, setSessions] = useState<ParkingSession[]>([]);

  /** Currently selected camera in the feed viewer (null = no selection) */
  const [activeCamera, setActiveCamera] = useState<Camera | null>(null);

  /** Active camera list tab — filters cameras by their functional role */
  const [cameraTab, setCameraTab] = useState<'entrance' | 'exit' | 'slot'>('entrance');

  /** Maximum car capacity — loaded from system settings */
  const [maxCars, setMaxCars] = useState(30);

  /** Maximum motorcycle capacity — loaded from system settings */
  const [maxMotos, setMaxMotos] = useState(20);

  /** Manual entry form state — tracks all form field values */
  const [manualForm, setManualForm] = useState({ plate: '', type: 'car' as VehicleType, direction: 'entry' as Direction, time: '', slot: '' });

  /** Status message displayed after a manual save attempt */
  const [saveStatus, setSaveStatus] = useState('');

  /**
   * Initial data fetch — runs once on component mount.
   *
   * Fetches from five Supabase tables in parallel:
   * 1. parking_slots — ordered by slot_id for grid display
   * 2. cameras — ordered by name for the camera list
   * 3. plate_recognitions — last 12 events, newest first
   * 4. parking_sessions — all sessions, newest first
   * 5. settings — key-value pairs for capacity limits
   */
  useEffect(() => {
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => setSlots(data || []));
    supabase.from('cameras').select('*').order('name').then(({ data }) => setCameras(data || []));
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(12).then(({ data }) => setRecognitions(data || []));
    supabase.from('parking_sessions').select('*').order('created_at', { ascending: false }).then(({ data }) => setSessions(data || []));

    // Load system settings (max capacities) from the key-value settings table
    supabase.from('settings').select('key, value').then(({ data }) => {
      if (data) {
        const m = Object.fromEntries(data.map((r: any) => [r.key, r.value]));
        setMaxCars(m.max_capacity_cars || 30);
        setMaxMotos(m.max_capacity_motorcycles || 20);
      }
    });
  }, []);

  // ============================================================
  // DERIVED METRICS — Computed from fetched data
  // ============================================================

  /** Count of car slots currently occupied */
  const occupiedCarSlots = slots.filter(s => s.vehicle_type === 'car' && s.status === 'occupied').length;

  /** Count of motorcycle slots currently occupied */
  const occupiedMotoSlots = slots.filter(s => s.vehicle_type === 'motorcycle' && s.status === 'occupied').length;

  /** Available car spaces (max capacity minus occupied) */
  const availableCars = maxCars - occupiedCarSlots;

  /** Available motorcycle spaces (max capacity minus occupied) */
  const availableMotos = maxMotos - occupiedMotoSlots;

  /** Cameras filtered by the currently selected tab (entrance/exit/slot) */
  const filteredCameras = cameras.filter(c => c.type === cameraTab);

  /**
   * handleManualSave — Handles the "Save" button click for manual vehicle entry.
   *
   * Validates that a plate number is provided, then inserts a new record
   * into the `plate_recognitions` table with:
   * - Uppercase plate number
   * - Selected vehicle type and direction
   * - 100% confidence (manual entries are always considered certain)
   * - "Manual Entry" as the camera name
   * - Either the user-specified time or current system time
   *
   * After successful insert:
   * 1. Shows a success message for 3 seconds
   * 2. Clears the form
   * 3. Refreshes the recognition panel data
   */
  const handleManualSave = async () => {
    // Validate required field
    if (!manualForm.plate) { setSaveStatus('Plate number required'); return; }

    // Use form time if provided, otherwise default to current system time
    const time = manualForm.time || new Date().toISOString();

    // Insert the manual plate recognition record
    const { error } = await supabase.from('plate_recognitions').insert({
      plate_number: manualForm.plate.toUpperCase(),
      vehicle_type: manualForm.type,
      direction: manualForm.direction,
      confidence: 100,
      camera_name: 'Manual Entry',
      created_at: time,
    });

    if (error) { setSaveStatus('Error saving'); return; }

    // Show success feedback and reset form
    setSaveStatus('Saved successfully');
    setManualForm({ plate: '', type: 'car', direction: 'entry', time: '', slot: '' });

    // Auto-clear the status message after 3 seconds
    setTimeout(() => setSaveStatus(''), 3000);

    // Refresh the recognition panel with latest data
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(12).then(({ data }) => setRecognitions(data || []));
  };

  /** Current system time formatted as HH:MM:SS for the camera feed timestamp */
  const liveTimestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

  // ============================================================
  // RENDER — Dashboard grid layout
  // ============================================================
  return (
    <div className="dashboard-grid">

      {/* ===== ROW 1: CAPACITY CARDS ===== */}
      <div className="capacity-row">
        {/* Car capacity card — shows available spaces and max */}
        <div className="capacity-card">
          <div className="capacity-header">
            <IconCar size={22} className="capacity-icon" />
            <span className="capacity-label">Cars</span>
          </div>
          <div className="capacity-value available">{availableCars} Available</div>
          <div className="capacity-max">{maxCars} max capacity</div>
        </div>

        {/* Motorcycle capacity card — shows available spaces and max */}
        <div className="capacity-card">
          <div className="capacity-header">
            <IconMotorcycle size={22} className="capacity-icon" />
            <span className="capacity-label">Motorcycles</span>
          </div>
          <div className="capacity-value available">{availableMotos} Available</div>
          <div className="capacity-max">{maxMotos} max capacity</div>
        </div>

        {/* Mini stats card — active sessions and total slots */}
        <div className="capacity-mini">
          <div className="mini-row"><span>Active Sessions</span><span className="mini-value">{sessions.filter(s => s.status === 'active').length}</span></div>
          <div className="mini-row"><span>Total Slots</span><span className="mini-value">{slots.length}</span></div>
        </div>
      </div>

      {/* ===== ROW 2: CAMERA FEED + TABS + RECOGNITION PANEL ===== */}
      <div className="camera-row">
        {/* Main camera feed viewer — shows selected camera's live feed */}
        <div className="camera-main">
          <div className="camera-feed">
            <div className="camera-feed-header">
              {/* Live indicator badge */}
              <span className="live-badge"><span className="live-dot" /> LIVE</span>
              {/* Active camera name or placeholder */}
              <span className="camera-name">{activeCamera ? activeCamera.name : 'Select a camera'}</span>
              {/* Current timestamp */}
              <span className="camera-timestamp">{liveTimestamp}</span>
            </div>
            <div className="camera-feed-body">
              {/* Placeholder content — replaced by actual video feed when camera hardware is connected */}
              <div className="camera-placeholder">
                <IconCamera size={42} className="camera-placeholder-icon" />
                <div className="camera-placeholder-text">{activeCamera ? activeCamera.location || 'Live feed' : 'No camera selected'}</div>
                {/* Offline warning when a selected camera is not connected */}
                {activeCamera && !activeCamera.is_online && <div className="camera-offline">Camera Offline</div>}
              </div>
              {/* Grid overlay for visual alignment reference */}
              <div className="camera-overlay-grid" />
            </div>
          </div>
        </div>

        {/* Camera selection tabs and list — filters by Entrance/Exit/Slot */}
        <div className="camera-tabs-panel">
          <div className="camera-tabs">
            <button className={cameraTab === 'entrance' ? 'active' : ''} onClick={() => setCameraTab('entrance')}>Entrance</button>
            <button className={cameraTab === 'exit' ? 'active' : ''} onClick={() => setCameraTab('exit')}>Exit</button>
            <button className={cameraTab === 'slot' ? 'active' : ''} onClick={() => setCameraTab('slot')}>Slots</button>
          </div>
          {/* Scrollable list of cameras matching the active tab */}
          <div className="camera-list">
            {filteredCameras.map(cam => (
              <button
                key={cam.id}
                className={`camera-list-item ${activeCamera?.id === cam.id ? 'selected' : ''}`}
                onClick={() => setActiveCamera(cam)}
              >
                {/* Online/offline status indicator dot */}
                <span className={`cam-status ${cam.is_online ? 'online' : 'offline'}`} />
                <div className="cam-info">
                  <div className="cam-name">{cam.name}</div>
                  {/* Slot range label (only for slot-type cameras) */}
                  {cam.slot_range && <div className="cam-slot-range">Slot {cam.slot_range}</div>}
                  <div className="cam-location">{cam.location}</div>
                </div>
              </button>
            ))}
            {filteredCameras.length === 0 && <div className="empty-state">No cameras</div>}
          </div>
        </div>

        {/* Plate Recognition panel — scrollable list of recent OCR events */}
        <div className="recognition-panel">
          <div className="panel-header">Plate Recognition</div>
          <div className="recognition-list">
            {recognitions.map(r => (
              <div key={r.id} className="recognition-item">
                {/* Plate number displayed prominently */}
                <div className="rec-plate">{r.plate_number}</div>
                <div className="rec-details">
                  <div className="rec-row"><span className="rec-label">Type</span><span className="rec-value">{r.vehicle_type}</span></div>
                  <div className="rec-row"><span className="rec-label">Direction</span><span className={`rec-badge ${r.direction}`}>{r.direction}</span></div>
                  <div className="rec-row"><span className="rec-label">Date</span><span className="rec-value">{new Date(r.created_at).toLocaleDateString()}</span></div>
                  <div className="rec-row"><span className="rec-label">Time</span><span className="rec-value">{new Date(r.created_at).toLocaleTimeString('en-US', { hour12: false })}</span></div>
                  <div className="rec-row"><span className="rec-label">Confidence</span><span className="rec-value">{r.confidence}%</span></div>
                  <div className="rec-row"><span className="rec-label">Camera</span><span className="rec-value">{r.camera_name}</span></div>
                </div>
              </div>
            ))}
            {recognitions.length === 0 && <div className="empty-state">No detections</div>}
          </div>
        </div>
      </div>

      {/* ===== ROW 3: MANUAL VEHICLE ENTRY FORM ===== */}
      <div className="manual-entry-card">
        <div className="panel-header">Manual Vehicle Entry</div>
        <div className="manual-form">
          {/* Plate number input */}
          <div className="form-group">
            <label>Plate Number</label>
            <input value={manualForm.plate} onChange={e => setManualForm({ ...manualForm, plate: e.target.value })} placeholder="ABC 1234" />
          </div>
          {/* Vehicle type selector */}
          <div className="form-group">
            <label>Vehicle Type</label>
            <select value={manualForm.type} onChange={e => setManualForm({ ...manualForm, type: e.target.value as VehicleType })}>
              <option value="car">Car</option>
              <option value="motorcycle">Motorcycle</option>
            </select>
          </div>
          {/* Entry/Exit direction selector */}
          <div className="form-group">
            <label>Entry / Exit</label>
            <select value={manualForm.direction} onChange={e => setManualForm({ ...manualForm, direction: e.target.value as Direction })}>
              <option value="entry">Entry</option>
              <option value="exit">Exit</option>
            </select>
          </div>
          {/* Timestamp input — defaults to current time if left empty */}
          <div className="form-group">
            <label>Time</label>
            <input type="datetime-local" value={manualForm.time} onChange={e => setManualForm({ ...manualForm, time: e.target.value })} />
          </div>
          {/* Optional slot assignment */}
          <div className="form-group">
            <label>Assigned Slot (optional)</label>
            <input value={manualForm.slot} onChange={e => setManualForm({ ...manualForm, slot: e.target.value })} placeholder="A1" />
          </div>
          {/* Form action buttons */}
          <div className="form-actions">
            <button className="btn-primary" onClick={handleManualSave}>Save</button>
            <button className="btn-secondary" onClick={() => setManualForm({ plate: '', type: 'car', direction: 'entry', time: '', slot: '' })}>Clear</button>
          </div>
          {/* Save status message — shows success or error */}
          {saveStatus && <div className={`save-status ${saveStatus.includes('Error') ? 'error' : 'success'}`}>{saveStatus}</div>}
        </div>
      </div>
    </div>
  );
}
