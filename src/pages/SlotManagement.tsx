import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase, type Camera, type ParkingSlot, type SlotStatus } from '@/lib/supabase';
import { IconBan, IconCamera, IconCar, IconCheck, IconEdit, IconLock, IconMotorcycle, IconPlus, IconTrash } from '@/components/Icons';
import {
  CameraManager,
  SlotMonitorProcessor,
  type CameraDevice,
  type Detection,
  type PipelineStatus,
  type SlotAOIConfig,
  type SlotDetectionResult,
} from '@/lib/visionEngine';

type Point = [number, number];

interface SlotAOI {
  slotId: string;
  points: Point[];
  color: string;
}

const AOI_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#eab308', '#ef4444', '#06b6d4', '#ec4899'];

export function SlotManagement() {
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [activeCamera, setActiveCamera] = useState<Camera | null>(null);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [aoiMap, setAoiMap] = useState<Record<string, SlotAOI>>({});
  const [saveStatus, setSaveStatus] = useState<{ slotId: string; msg: string; ok: boolean } | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(true);

  // Load data from Supabase
  useEffect(() => {
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => {
      const loadedSlots = (data || []) as ParkingSlot[];
      setSlots(loadedSlots);
      const map: Record<string, SlotAOI> = {};
      loadedSlots.forEach(slot => {
        if (slot.aoi_polygon && Array.isArray(slot.aoi_polygon) && slot.aoi_polygon.length >= 3) {
          map[slot.id] = { slotId: slot.slot_id, points: slot.aoi_polygon as Point[], color: slot.aoi_color || AOI_COLORS[0] };
        }
      });
      setAoiMap(map);
    });
    supabase.from('cameras').select('*').order('name').then(({ data }) => {
      const loadedCameras = (data || []) as Camera[];
      setCameras(loadedCameras);
      const slotCamera = loadedCameras.find(camera => camera.type === 'slot');
      if (slotCamera) setActiveCamera(slotCamera);
    });

    // Realtime subscription for slot status changes
    const channel = supabase
      .channel('slot-management-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newSlot = payload.new as ParkingSlot;
          setSlots(prev => [...prev, newSlot].sort((a, b) => a.slot_id.localeCompare(b.slot_id)));
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as ParkingSlot;
          setSlots(prev => prev.map(slot => slot.id === updated.id ? { ...slot, ...updated } : slot));
        } else if (payload.eventType === 'DELETE') {
          const deleted = payload.old as ParkingSlot;
          setSlots(prev => prev.filter(slot => slot.id !== deleted.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  /** Get slots assigned to the active camera (by camera_id or slot_range match) */
  const cameraSlots = useCallback((): ParkingSlot[] => {
    if (!activeCamera) return [];

    // First: slots explicitly assigned to this camera via camera_id
    const byCamera = slots.filter(slot => slot.camera_id === activeCamera.id);
    if (byCamera.length > 0) return byCamera;

    // Second: match by slot_range pattern
    if (!activeCamera.slot_range) return slots; // Show all slots if no range set
    const range = activeCamera.slot_range.toUpperCase();
    const match = range.match(/^([A-Z]+)(\d+)\s*-\s*([A-Z]+)(\d+)$/);
    if (!match) {
      const parts = range.split('-').map(part => part.trim());
      return slots.filter(slot => parts.includes(slot.slot_id.toUpperCase()));
    }
    const [, prefix1, startStr, prefix2, endStr] = match;
    const prefix = prefix1 || prefix2;
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    return slots.filter(slot => {
      const slotMatch = slot.slot_id.toUpperCase().match(/^([A-Z]+)(\d+)$/);
      if (!slotMatch) return false;
      const slotNumber = parseInt(slotMatch[2], 10);
      return slotMatch[1] === prefix && slotNumber >= start && slotNumber <= end;
    });
  }, [activeCamera, slots]);

  const updateSlot = async (id: string, updates: Partial<ParkingSlot>) => {
    const { error } = await supabase.from('parking_slots').update(updates).eq('id', id);
    if (!error) setSlots(prev => prev.map(slot => slot.id === id ? { ...slot, ...updates } : slot));
  };

  const saveAOI = async (slotId: string) => {
    const aoi = aoiMap[slotId];
    if (!aoi || aoi.points.length < 3) {
      setSaveStatus({ slotId, msg: 'Need at least 3 points', ok: false });
      return;
    }
    const updates = { aoi_polygon: aoi.points, aoi_color: aoi.color, camera_id: activeCamera?.id || null };
    const { error } = await supabase.from('parking_slots').update(updates).eq('id', slotId);
    setSaveStatus({ slotId, msg: error ? 'Save failed' : 'AOI saved ✓', ok: !error });
    if (!error) setSlots(prev => prev.map(slot => slot.id === slotId ? { ...slot, ...updates } : slot));
    setTimeout(() => setSaveStatus(null), 2500);
  };

  const clearAOI = async (slotId: string) => {
    setAoiMap(prev => { const next = { ...prev }; delete next[slotId]; return next; });
    await supabase.from('parking_slots').update({ aoi_polygon: null, aoi_color: null }).eq('id', slotId);
    setSlots(prev => prev.map(slot => slot.id === slotId ? { ...slot, aoi_polygon: null, aoi_color: null } : slot));
    setSaveStatus({ slotId, msg: 'AOI cleared', ok: true });
    setTimeout(() => setSaveStatus(null), 2000);
  };

  const startEditing = (slotId: string) => {
    const slot = slots.find(item => item.id === slotId);
    if (!slot) return;
    if (!aoiMap[slotId]) {
      setAoiMap(prev => ({ ...prev, [slotId]: { slotId: slot.slot_id, points: [], color: AOI_COLORS[Object.keys(prev).length % AOI_COLORS.length] } }));
    }
    setEditingSlotId(slotId);
    if (!isCameraOpen) setIsCameraOpen(true);
  };

  /** Add a new slot to Supabase */
  const addSlot = async (slotName: string, vehicleType: 'car' | 'motorcycle') => {
    const { data, error } = await supabase.from('parking_slots').insert({
      slot_id: slotName,
      floor: 'Ground',
      vehicle_type: vehicleType,
      status: 'available',
      camera_id: activeCamera?.id || null,
    }).select().single();

    if (error) {
      setSaveStatus({ slotId: '', msg: 'Error: ' + error.message, ok: false });
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }
    if (data) {
      setSlots(prev => [...prev, data as ParkingSlot].sort((a, b) => a.slot_id.localeCompare(b.slot_id)));
      setSaveStatus({ slotId: '', msg: `Slot ${slotName} added ✓`, ok: true });
      setTimeout(() => setSaveStatus(null), 2000);
    }
  };

  /** Delete a slot from Supabase */
  const deleteSlot = async (id: string) => {
    const slot = slots.find(s => s.id === id);
    if (!slot) return;
    if (!confirm(`Delete slot ${slot.slot_id}? This cannot be undone.`)) return;

    const { error } = await supabase.from('parking_slots').delete().eq('id', id);
    if (!error) {
      setSlots(prev => prev.filter(s => s.id !== id));
      setAoiMap(prev => { const next = { ...prev }; delete next[id]; return next; });
      if (editingSlotId === id) setEditingSlotId(null);
    }
  };

  const slotCameras = cameras.filter(camera => camera.type === 'slot');
  const currentSlots = cameraSlots();

  return (
    <div className="slots-page">
      {/* Camera selector tabs */}
      <div className="slot-camera-tabs">
        {slotCameras.map(camera => (
          <button key={camera.id} className={`slot-cam-tab ${activeCamera?.id === camera.id ? 'active' : ''}`} onClick={() => { setActiveCamera(camera); setEditingSlotId(null); }}>
            <IconCamera size={16} /><span>{camera.name}</span>
            {camera.slot_range && <span className="slot-cam-range">{camera.slot_range}</span>}
            <span className={`slot-cam-status ${camera.is_online ? 'online' : 'offline'}`} />
          </button>
        ))}
        {slotCameras.length === 0 && (
          <div className="empty-state" style={{ padding: '8px 0', fontSize: '13px' }}>
            No slot cameras configured. Add a camera with type "Slot" in Settings.
          </div>
        )}
        {/* Toggle Camera View */}
        {activeCamera && (
          <button className={`slot-cam-tab ${isCameraOpen ? 'active' : ''}`} onClick={() => setIsCameraOpen(prev => !prev)} style={{ marginLeft: 'auto' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {isCameraOpen
                ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
              }
            </svg>
            <span>{isCameraOpen ? 'Hide Camera' : 'Show Camera'}</span>
          </button>
        )}
      </div>

      {/* Collapsible Camera Panel */}
      {activeCamera && isCameraOpen && (
        <CameraPanel
          camera={activeCamera} slots={currentSlots} aoiMap={aoiMap} setAoiMap={setAoiMap}
          editingSlotId={editingSlotId} onStartEditing={startEditing} onStopEditing={() => setEditingSlotId(null)}
          onSaveAOI={saveAOI} onClearAOI={clearAOI} onDeleteSlot={deleteSlot} onAddSlot={addSlot}
          saveStatus={saveStatus}
        />
      )}

      {/* Slot Cards Grid */}
      <div className="slot-summary-section">
        <h3 className="slot-summary-title">Slots in {activeCamera?.name || 'Camera'} ({currentSlots.length})</h3>
        <div className="slots-grid">
          {currentSlots.map(slot => (
            <SlotCard key={slot.id} slot={slot} aoi={aoiMap[slot.id]} isEditing={editingSlotId === slot.id}
              onEdit={() => startEditing(slot.id)} onUpdate={updateSlot} onDelete={() => deleteSlot(slot.id)} />
          ))}
          {currentSlots.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
              No slots yet. Use the "Add Slot" button in the sidebar to create parking slots.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   CameraPanel — Camera feed + AOI overlay + Slot sidebar
   ================================================================ */
function CameraPanel({
  camera, slots, aoiMap, setAoiMap, editingSlotId,
  onStartEditing, onStopEditing, onSaveAOI, onClearAOI, onDeleteSlot, onAddSlot,
  saveStatus,
}: {
  camera: Camera;
  slots: ParkingSlot[];
  aoiMap: Record<string, SlotAOI>;
  setAoiMap: Dispatch<SetStateAction<Record<string, SlotAOI>>>;
  editingSlotId: string | null;
  onStartEditing: (slotId: string) => void;
  onStopEditing: () => void;
  onSaveAOI: (slotId: string) => void;
  onClearAOI: (slotId: string) => void;
  onDeleteSlot: (slotId: string) => void;
  onAddSlot: (name: string, type: 'car' | 'motorcycle') => void;
  saveStatus: { slotId: string; msg: string; ok: boolean } | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const processorRef = useRef<SlotMonitorProcessor | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Monitoring state
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [monitorStatus, setMonitorStatus] = useState<PipelineStatus>('idle');
  const [detections, setDetections] = useState<Detection[]>([]);
  const [initProgress, setInitProgress] = useState('');
  const [monitorError, setMonitorError] = useState('');

  // Add slot form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSlotName, setNewSlotName] = useState('');
  const [newSlotType, setNewSlotType] = useState<'car' | 'motorcycle'>('car');

  const editingAoi = editingSlotId ? aoiMap[editingSlotId] : null;
  const editingSlot = slots.find(slot => slot.id === editingSlotId);

  // Enumerate camera devices
  useEffect(() => {
    const cam = new CameraManager();
    cam.enumerateDevices().then(devs => {
      setDevices(devs);
      if (devs.length > 0) {
        setSelectedDevice(camera.device_id && devs.some(d => d.deviceId === camera.device_id) ? camera.device_id : devs[0].deviceId);
      }
    });
  }, [camera.device_id]);

  // Sync slot configs to processor
  useEffect(() => {
    if (!processorRef.current || !isMonitoring) return;
    const configs: SlotAOIConfig[] = slots
      .filter(slot => aoiMap[slot.id]?.points.length >= 3)
      .map(slot => ({ slotId: slot.slot_id, dbId: slot.id, polygon: aoiMap[slot.id].points as [number, number][] }));
    processorRef.current.setSlots(configs);
  }, [aoiMap, slots, isMonitoring]);

  // Draw YOLO bounding boxes
  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scaleX = rect.width / (video.videoWidth || 1);
    const scaleY = rect.height / (video.videoHeight || 1);
    for (const det of detections) {
      if (!det.vehicleType) continue;
      const [x1, y1, x2, y2] = det.bbox;
      const dx = x1 * scaleX, dy = y1 * scaleY, dw = (x2 - x1) * scaleX, dh = (y2 - y1) * scaleY;
      ctx.strokeStyle = det.vehicleType === 'motorcycle' ? '#f59e0b' : '#22d3ee';
      ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.strokeRect(dx, dy, dw, dh);
      const cornerLen = Math.min(15, dw * 0.15, dh * 0.15);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(dx, dy + cornerLen); ctx.lineTo(dx, dy); ctx.lineTo(dx + cornerLen, dy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dx + dw - cornerLen, dy); ctx.lineTo(dx + dw, dy); ctx.lineTo(dx + dw, dy + cornerLen); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dx, dy + dh - cornerLen); ctx.lineTo(dx, dy + dh); ctx.lineTo(dx + cornerLen, dy + dh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dx + dw - cornerLen, dy + dh); ctx.lineTo(dx + dw, dy + dh); ctx.lineTo(dx + dw, dy + dh - cornerLen); ctx.stroke();
      const label = `${det.className} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = '12px Inter, sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = det.vehicleType === 'motorcycle' ? 'rgba(245,158,11,0.85)' : 'rgba(34,211,238,0.85)';
      ctx.fillRect(dx, dy - 20, tw + 10, 20);
      ctx.fillStyle = '#000'; ctx.fillText(label, dx + 5, dy - 6);
    }
  }, [detections]);

  useEffect(() => { drawOverlay(); }, [detections, drawOverlay]);
  useEffect(() => { return () => { processorRef.current?.stop(); processorRef.current = null; }; }, [camera.id]);

  // Monitoring controls
  const handleStartMonitoring = async () => {
    if (!videoRef.current) return;
    setMonitorError('');
    try {
      setInitProgress('Loading YOLO model...');
      const processor = new SlotMonitorProcessor();
      processor.onStatusChange(s => setMonitorStatus(s));
      processor.onDetections(d => setDetections(d));
      processor.onFrame(() => drawOverlay());
      processor.onSlotChange((changes: SlotDetectionResult[]) => { console.log('[SlotManagement] Slot changes:', changes); });
      await processor.initialize();
      setInitProgress('Starting camera...');
      await processor.startCamera(selectedDevice, videoRef.current);
      const configs: SlotAOIConfig[] = slots
        .filter(slot => aoiMap[slot.id]?.points.length >= 3)
        .map(slot => ({ slotId: slot.slot_id, dbId: slot.id, polygon: aoiMap[slot.id].points as [number, number][] }));
      processor.setSlots(configs);
      processor.startProcessing();
      processorRef.current = processor;
      setIsMonitoring(true); setInitProgress('');
    } catch (err: any) { setMonitorError(err.message || 'Failed to start monitoring'); setInitProgress(''); }
  };

  const handleStopMonitoring = async () => {
    if (processorRef.current) { await processorRef.current.stop(); processorRef.current = null; }
    setIsMonitoring(false); setDetections([]); setMonitorStatus('idle');
    const canvas = overlayRef.current;
    if (canvas) { const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height); }
  };

  // AOI editing
  const getPoint = (event: React.MouseEvent): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  const updatePoints = (points: Point[]) => {
    if (editingSlotId) setAoiMap(prev => ({ ...prev, [editingSlotId]: { ...prev[editingSlotId], points } }));
  };
  const toSvgPoints = (points: Point[]) => points.map(p => `${p[0] * 100},${p[1] * 100}`).join(' ');
  const handleMove = (event: React.MouseEvent) => {
    if (dragIdx === null || !editingAoi) return;
    const point = getPoint(event);
    if (point) updatePoints(editingAoi.points.map((item, i) => i === dragIdx ? point : item));
  };

  const handleAddSlot = () => {
    const name = newSlotName.trim().toUpperCase();
    if (!name) return;
    onAddSlot(name, newSlotType);
    setNewSlotName('');
    setShowAddForm(false);
  };

  const vehicleCount = detections.filter(d => d.vehicleType).length;

  return (
    <div className="camera-panel-container">
      {/* ===== LEFT: Camera feed ===== */}
      <div className="camera-panel-feed">
        <div className="camera-feed-header">
          <span className="live-badge"><span className="live-dot" /> LIVE</span>
          <span className="camera-name">{camera.name}</span>
          <span className="camera-timestamp">{new Date().toLocaleTimeString('en-US', { hour12: false })}</span>
        </div>

        <div className="camera-feed-body" onMouseMove={handleMove} onMouseUp={() => setDragIdx(null)} onMouseLeave={() => setDragIdx(null)}>
          <video ref={videoRef} className="camera-video-element" playsInline muted style={{ display: isMonitoring ? 'block' : 'none' }} />
          <canvas ref={overlayRef} className="camera-overlay-canvas" style={{ display: isMonitoring ? 'block' : 'none' }} />

          {!isMonitoring && !initProgress && (
            <div className="camera-placeholder">
              <IconCamera size={42} className="camera-placeholder-icon" />
              <div className="camera-placeholder-text">{camera.location || 'Select a slot and click Edit AOI to start drawing'}</div>
            </div>
          )}

          {initProgress && (<div className="camera-init-overlay"><div className="camera-init-spinner" /><span>{initProgress}</span></div>)}

          {isMonitoring && (
            <div className={`camera-status-badge status-${monitorStatus === 'scanning' ? 'scanning' : 'idle'}`}>
              <span className="camera-status-dot" />{monitorStatus === 'scanning' ? 'Monitoring' : monitorStatus}
            </div>
          )}
          {isMonitoring && vehicleCount > 0 && (
            <div className="camera-mode-badge entrance" style={{ background: 'rgba(34,197,94,0.9)' }}>
              🚗 {vehicleCount} vehicle{vehicleCount !== 1 ? 's' : ''}
            </div>
          )}

          {editingSlotId && editingSlot && (
            <div className="slot-editing-indicator">
              ✏️ Drawing AOI for <strong>{editingSlot.slot_id}</strong> — click to add points
            </div>
          )}

          {/* AOI SVG Overlay */}
          <svg ref={svgRef} className="aoi-overlay" viewBox="0 0 100 100" preserveAspectRatio="none"
            onClick={e => { if (!editingAoi) return; const p = getPoint(e); if (p) updatePoints([...editingAoi.points, p]); }}
            style={{ cursor: editingSlotId ? 'crosshair' : 'default' }}>
            <defs><pattern id="aoi-grid" width="6.25" height="6.25" patternUnits="userSpaceOnUse"><path d="M 6.25 0 L 0 0 0 6.25" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.15" /></pattern></defs>
            <rect width="100" height="100" fill="url(#aoi-grid)" />
            {slots.map(slot => {
              const aoi = aoiMap[slot.id]; if (!aoi || aoi.points.length < 2) return null;
              const isEd = editingSlotId === slot.id;
              const op = editingSlotId ? (isEd ? 0.9 : 0.25) : 0.5;
              const cx = aoi.points.reduce((s, p) => s + p[0], 0) / aoi.points.length * 100;
              const cy = aoi.points.reduce((s, p) => s + p[1], 0) / aoi.points.length * 100;
              return (<g key={slot.id}>
                {aoi.points.length >= 3 && <polygon points={toSvgPoints(aoi.points)} fill={aoi.color} fillOpacity={isEd ? 0.15 : (slot.status === 'occupied' ? 0.35 : 0.08)} stroke={aoi.color} strokeWidth={isEd ? 0.5 : 0.3} strokeOpacity={op} strokeDasharray={isEd ? '' : '0.5,0.5'} />}
                {aoi.points.length === 2 && <line x1={aoi.points[0][0]*100} y1={aoi.points[0][1]*100} x2={aoi.points[1][0]*100} y2={aoi.points[1][1]*100} stroke={aoi.color} strokeWidth={0.4} strokeOpacity={op} />}
                {aoi.points.length >= 3 && <><rect x={cx-4} y={cy-2} width="8" height="4" rx="1" fill={aoi.color} fillOpacity={op} /><text x={cx} y={cy+0.5} textAnchor="middle" fill="white" fontSize="2.5" fontWeight="700">{slot.slot_id}</text><circle cx={cx} cy={cy+2.5} r="0.8" fill={slot.status==='available'?'#22c55e':slot.status==='occupied'?'#ef4444':slot.status==='reserved'?'#eab308':'#5c5c5c'} /></>}
                {isEd && aoi.points.map((pt, i) => <g key={i}><circle cx={pt[0]*100} cy={pt[1]*100} r="1.2" fill={aoi.color} stroke="white" strokeWidth="0.3" className="aoi-point" onMouseDown={ev => { ev.stopPropagation(); setDragIdx(i); }} onDoubleClick={ev => { ev.stopPropagation(); updatePoints(aoi.points.filter((_,j)=>j!==i)); }} /><text x={pt[0]*100+1.5} y={pt[1]*100-1} fill={aoi.color} fontSize="1.8" fontWeight="600">{i+1}</text></g>)}
              </g>);
            })}
          </svg>
          {!camera.is_online && <div className="camera-feed-offline" />}
        </div>

        {/* Monitoring controls */}
        <div className="slot-monitor-controls">
          <div className="camera-device-select">
            <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)} disabled={isMonitoring}>
              {devices.length === 0 && <option value="">No cameras found</option>}
              {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
            </select>
          </div>
          <div className="camera-action-btns">
            {!isMonitoring ? (
              <button className="camera-start-btn" onClick={handleStartMonitoring} disabled={devices.length === 0 || !!initProgress}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                Start Monitoring
              </button>
            ) : (
              <button className="camera-stop-btn" onClick={handleStopMonitoring}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                Stop
              </button>
            )}
          </div>
          {isMonitoring && (
            <div className="camera-detection-count">
              <span className="camera-det-num">{vehicleCount}</span>
              <span className="camera-det-label">vehicle{vehicleCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {monitorError && (<div className="camera-error-bar"><span>⚠ {monitorError}</span><button onClick={() => setMonitorError('')}>✕</button></div>)}
      </div>

      {/* ===== RIGHT: Slots sidebar ===== */}
      <div className="camera-panel-side">
        <div className="camera-panel-header">
          <span>Slots in View ({slots.length})</span>
          <button className="aoi-add-btn" onClick={() => setShowAddForm(prev => !prev)} title="Add a new slot">
            <IconPlus size={13} /> Add Slot
          </button>
        </div>

        {/* Add Slot Form (inline, at top of sidebar) */}
        {showAddForm && (
          <div className="aoi-add-form">
            <div className="aoi-add-form-row">
              <input
                className="aoi-add-input"
                value={newSlotName}
                onChange={e => setNewSlotName(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder="Slot name (e.g. A1)"
                maxLength={6}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleAddSlot(); }}
              />
              <select className="aoi-add-type" value={newSlotType} onChange={e => setNewSlotType(e.target.value as any)}>
                <option value="car">Car</option>
                <option value="motorcycle">Motorcycle</option>
              </select>
            </div>
            <div className="aoi-add-form-actions">
              <button className="aoi-save-btn" onClick={handleAddSlot} disabled={!newSlotName.trim()}>Create Slot</button>
              <button className="aoi-cancel-btn" onClick={() => { setShowAddForm(false); setNewSlotName(''); }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Global save status */}
        {saveStatus && saveStatus.slotId === '' && (
          <div className={`aoi-save-msg ${saveStatus.ok ? 'ok' : 'err'}`} style={{ margin: '8px 8px 0' }}>{saveStatus.msg}</div>
        )}

        {/* Slot list */}
        <div className="camera-panel-slots">
          {slots.map(slot => {
            const aoi = aoiMap[slot.id];
            const isEditing = editingSlotId === slot.id;
            const hasAoi = aoi && aoi.points.length >= 3;

            return (
              <div key={slot.id} className={`aoi-slot-row ${isEditing ? 'editing' : ''}`}>
                <div className="aoi-slot-info">
                  <span className="aoi-slot-color" style={{ background: aoi?.color || '#333' }} />
                  <span className="aoi-slot-id">{slot.slot_id}</span>
                  <span className={`aoi-slot-status aoi-status-${slot.status}`}>{slot.status}</span>
                  {hasAoi && <span className="aoi-point-count">{aoi.points.length} pts</span>}
                  {!hasAoi && <span className="aoi-point-count" style={{ color: 'var(--cursor-yellow)' }}>No AOI</span>}
                </div>
                <div className="aoi-slot-actions">
                  {!isEditing ? (
                    <>
                      <button className="aoi-edit-btn" onClick={() => onStartEditing(slot.id)} title="Edit AOI polygon">
                        <IconEdit size={13} />
                      </button>
                      <button className="aoi-clear-btn" onClick={() => onDeleteSlot(slot.id)} title="Delete slot">
                        <IconTrash size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="aoi-editing-label">Drawing...</span>
                      <button className="aoi-save-btn" onClick={() => { onSaveAOI(slot.id); onStopEditing(); }} title="Save AOI" disabled={!editingAoi || editingAoi.points.length < 3}>
                        Save
                      </button>
                      {aoi && aoi.points.length > 0 && (
                        <button className="aoi-clear-btn" onClick={() => onClearAOI(slot.id)} title="Clear all points">
                          <IconTrash size={13} />
                        </button>
                      )}
                      <button className="aoi-cancel-btn" onClick={onStopEditing} title="Cancel editing">✕</button>
                    </>
                  )}
                </div>
                {saveStatus?.slotId === slot.id && (
                  <div className={`aoi-save-msg ${saveStatus.ok ? 'ok' : 'err'}`}>{saveStatus.msg}</div>
                )}
              </div>
            );
          })}
          {slots.length === 0 && (
            <div className="empty-state" style={{ padding: '24px 16px', textAlign: 'center' }}>
              <p style={{ marginBottom: '8px' }}>No slots yet</p>
              <p style={{ fontSize: '12px', color: 'var(--cursor-text-muted)' }}>Click "Add Slot" above to create your first parking slot, then draw its polygon on the camera feed.</p>
            </div>
          )}
        </div>

        {/* AOI Editing panel (color picker + instructions) */}
        {editingSlotId && editingAoi && (
          <div className="aoi-edit-panel">
            <div className="aoi-edit-title">Editing: {editingSlot?.slot_id}</div>
            <div className="aoi-edit-hint">
              <p>• Click on camera feed to add polygon points</p>
              <p>• Drag points to reposition them</p>
              <p>• Double-click a point to remove it</p>
              <p>• Minimum 3 points required to save</p>
            </div>
            <div className="aoi-color-picker">
              <span className="aoi-color-label">Color:</span>
              {AOI_COLORS.map(color => (
                <button key={color} className={`aoi-color-swatch ${editingAoi.color === color ? 'selected' : ''}`}
                  style={{ background: color }}
                  onClick={() => setAoiMap(prev => ({ ...prev, [editingSlotId]: { ...prev[editingSlotId], color } }))} />
              ))}
            </div>
            <div className="aoi-edit-points">
              <span>Points: {editingAoi.points.length}</span>
              {editingAoi.points.length >= 3 && <span className="aoi-ready">✓ Ready to save</span>}
              {editingAoi.points.length > 0 && editingAoi.points.length < 3 && <span style={{ color: 'var(--cursor-yellow)', fontSize: '12px' }}>Need {3 - editingAoi.points.length} more</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   SlotCard — Individual slot card in the grid
   ================================================================ */
function SlotCard({ slot, aoi, isEditing, onEdit, onUpdate, onDelete }: {
  slot: ParkingSlot; aoi?: SlotAOI; isEditing: boolean;
  onEdit: () => void; onUpdate: (id: string, updates: Partial<ParkingSlot>) => void;
  onDelete: () => void;
}) {
  return (
    <div className={`slot-card slot-${slot.status} ${isEditing ? 'slot-editing' : ''}`}>
      <div className="slot-card-header">
        <span className="slot-id">{slot.slot_id}</span>
        <span className="slot-type-icon">{slot.vehicle_type === 'car' ? <IconCar size={18} /> : <IconMotorcycle size={18} />}</span>
      </div>
      <div className="slot-card-type">{slot.vehicle_type}</div>
      <div className={`slot-status-text slot-${slot.status}`}>{slot.status}</div>
      <div className="slot-aoi-indicator">
        {aoi && aoi.points.length >= 3 ? <span className="aoi-set" style={{ color: aoi.color }}>AOI: {aoi.points.length} pts</span> : <span className="aoi-unset">No AOI</span>}
      </div>
      <div className="slot-card-actions">
        <button className="slot-action-btn" title="Edit AOI" onClick={onEdit}><IconEdit size={14} /><span>Edit AOI</span></button>
        {slot.status !== 'disabled'
          ? <button className="slot-action-btn" title="Disable" onClick={() => onUpdate(slot.id, { status: 'disabled' as SlotStatus })}><IconBan size={14} /><span>Disable</span></button>
          : <button className="slot-action-btn" title="Enable" onClick={() => onUpdate(slot.id, { status: 'available' as SlotStatus })}><IconCheck size={14} /><span>Enable</span></button>
        }
        <button className="slot-action-btn" title="Reserve" onClick={() => onUpdate(slot.id, { status: 'reserved' as SlotStatus })}><IconLock size={14} /><span>Reserve</span></button>
        <button className="slot-action-btn" title="Delete Slot" onClick={onDelete} style={{ color: 'var(--cursor-red)' }}><IconTrash size={14} /><span>Delete</span></button>
      </div>
    </div>
  );
}