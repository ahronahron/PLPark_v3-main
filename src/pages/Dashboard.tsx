import { useEffect, useState } from 'react';
import { supabase, type ParkingSlot, type Camera, type PlateRecognition, type ParkingSession, type VehicleType, type Direction } from '@/lib/supabase';
import { IconCar, IconMotorcycle, IconCamera, IconClock } from '@/components/Icons';

export function Dashboard() {
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [recognitions, setRecognitions] = useState<PlateRecognition[]>([]);
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [activeCamera, setActiveCamera] = useState<Camera | null>(null);
  const [cameraTab, setCameraTab] = useState<'entrance' | 'exit' | 'slot'>('entrance');
  const [maxCars, setMaxCars] = useState(30);
  const [maxMotos, setMaxMotos] = useState(20);
  const [manualForm, setManualForm] = useState({ plate: '', type: 'car' as VehicleType, direction: 'entry' as Direction, time: '', slot: '' });
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => setSlots(data || []));
    supabase.from('cameras').select('*').order('name').then(({ data }) => setCameras(data || []));
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(12).then(({ data }) => setRecognitions(data || []));
    supabase.from('parking_sessions').select('*').order('created_at', { ascending: false }).then(({ data }) => setSessions(data || []));
    supabase.from('settings').select('key, value').then(({ data }) => {
      if (data) {
        const m = Object.fromEntries(data.map((r: any) => [r.key, r.value]));
        setMaxCars(m.max_capacity_cars || 30);
        setMaxMotos(m.max_capacity_motorcycles || 20);
      }
    });
  }, []);

  const occupiedCarSlots = slots.filter(s => s.vehicle_type === 'car' && s.status === 'occupied').length;
  const occupiedMotoSlots = slots.filter(s => s.vehicle_type === 'motorcycle' && s.status === 'occupied').length;
  const availableCars = maxCars - occupiedCarSlots;
  const availableMotos = maxMotos - occupiedMotoSlots;

  const filteredCameras = cameras.filter(c => c.type === cameraTab);

  const handleManualSave = async () => {
    if (!manualForm.plate) { setSaveStatus('Plate number required'); return; }
    const time = manualForm.time || new Date().toISOString();
    const { error } = await supabase.from('plate_recognitions').insert({
      plate_number: manualForm.plate.toUpperCase(),
      vehicle_type: manualForm.type,
      direction: manualForm.direction,
      confidence: 100,
      camera_name: 'Manual Entry',
      created_at: time,
    });
    if (error) { setSaveStatus('Error saving'); return; }
    setSaveStatus('Saved successfully');
    setManualForm({ plate: '', type: 'car', direction: 'entry', time: '', slot: '' });
    setTimeout(() => setSaveStatus(''), 3000);
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(12).then(({ data }) => setRecognitions(data || []));
  };

  const liveTimestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

  return (
    <div className="dashboard-grid">
      <div className="capacity-row">
        <div className="capacity-card">
          <div className="capacity-header">
            <IconCar size={22} className="capacity-icon" />
            <span className="capacity-label">Cars</span>
          </div>
          <div className="capacity-value available">{availableCars} Available</div>
          <div className="capacity-max">{maxCars} max capacity</div>
        </div>
        <div className="capacity-card">
          <div className="capacity-header">
            <IconMotorcycle size={22} className="capacity-icon" />
            <span className="capacity-label">Motorcycles</span>
          </div>
          <div className="capacity-value available">{availableMotos} Available</div>
          <div className="capacity-max">{maxMotos} max capacity</div>
        </div>
        <div className="capacity-mini">
          <div className="mini-row"><span>Active Sessions</span><span className="mini-value">{sessions.filter(s => s.status === 'active').length}</span></div>
          <div className="mini-row"><span>Total Slots</span><span className="mini-value">{slots.length}</span></div>
        </div>
      </div>

      <div className="camera-row">
        <div className="camera-main">
          <div className="camera-feed">
            <div className="camera-feed-header">
              <span className="live-badge"><span className="live-dot" /> LIVE</span>
              <span className="camera-name">{activeCamera ? activeCamera.name : 'Select a camera'}</span>
              <span className="camera-timestamp">{liveTimestamp}</span>
            </div>
            <div className="camera-feed-body">
              <div className="camera-placeholder">
                <IconCamera size={42} className="camera-placeholder-icon" />
                <div className="camera-placeholder-text">{activeCamera ? activeCamera.location || 'Live feed' : 'No camera selected'}</div>
                {activeCamera && !activeCamera.is_online && <div className="camera-offline">Camera Offline</div>}
              </div>
              <div className="camera-overlay-grid" />
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
          <div className="recognition-list">
            {recognitions.map(r => (
              <div key={r.id} className="recognition-item">
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

      <div className="manual-entry-card">
        <div className="panel-header">Manual Vehicle Entry</div>
        <div className="manual-form">
          <div className="form-group">
            <label>Plate Number</label>
            <input value={manualForm.plate} onChange={e => setManualForm({ ...manualForm, plate: e.target.value })} placeholder="ABC 1234" />
          </div>
          <div className="form-group">
            <label>Vehicle Type</label>
            <select value={manualForm.type} onChange={e => setManualForm({ ...manualForm, type: e.target.value as VehicleType })}>
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
            <label>Time</label>
            <input type="datetime-local" value={manualForm.time} onChange={e => setManualForm({ ...manualForm, time: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Assigned Slot (optional)</label>
            <input value={manualForm.slot} onChange={e => setManualForm({ ...manualForm, slot: e.target.value })} placeholder="A1" />
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleManualSave}>Save</button>
            <button className="btn-secondary" onClick={() => setManualForm({ plate: '', type: 'car', direction: 'entry', time: '', slot: '' })}>Clear</button>
          </div>
          {saveStatus && <div className={`save-status ${saveStatus.includes('Error') ? 'error' : 'success'}`}>{saveStatus}</div>}
        </div>
      </div>
    </div>
  );
}
