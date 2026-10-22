import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { logActivity, supabase, type Camera, type ParkingSlot, type SlotStatus } from '@/lib/supabase';
import { IconBan, IconCamera, IconCar, IconCheck, IconEdit, IconLock, IconMore, IconMotorcycle, IconPlus, IconTrash, IconUnlock } from '@/components/Icons';
import {
  CameraManager,
  SlotMonitorProcessor,
  type CameraDevice,
  type Detection,
  type PipelineStatus,
  type SlotAOIConfig,
  type SlotDetectionResult,
} from '@/lib/visionEngine';

import { useSlots } from '@/lib/hooks';

type Point = [number, number];

interface SlotAOI {
  slotId: string;
  points: Point[];
  color: string;
}

const AOI_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#eab308', '#ef4444', '#06b6d4', '#ec4899'];
const DEFAULT_SLOT_ACTIONS = { reservation: true, disable: true, edit: true, delete: true };
type SlotActionSettings = typeof DEFAULT_SLOT_ACTIONS;

export function SlotManagement() {
  const { slots, setSlots } = useSlots();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [activeCamera, setActiveCamera] = useState<Camera | null>(null);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [aoiMap, setAoiMap] = useState<Record<string, SlotAOI>>({});
  const [saveStatus, setSaveStatus] = useState<{ slotId: string; msg: string; ok: boolean } | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(true);
  const [slotActions, setSlotActions] = useState<SlotActionSettings>(DEFAULT_SLOT_ACTIONS);
  const [liveSlotStates, setLiveSlotStates] = useState<Record<string, any>>({});

  // Sync AOI map from slots whenever slots change
  useEffect(() => {
    setAoiMap(prev => {
      const map: Record<string, SlotAOI> = { ...prev };
      slots.forEach(slot => {
        if (slot.aoi_polygon && Array.isArray(slot.aoi_polygon) && slot.aoi_polygon.length >= 3) {
          map[slot.id] = { slotId: slot.slot_id, points: slot.aoi_polygon as Point[], color: slot.aoi_color || prev[slot.id]?.color || AOI_COLORS[0] };
        }
      });
      return map;
    });
  }, [slots]);

  // Load cameras & settings from Supabase
  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'slot_action_settings').maybeSingle().then(({ data }) => {
      if (data?.value && typeof data.value === 'object') {
        setSlotActions({ ...DEFAULT_SLOT_ACTIONS, ...data.value });
      }
    });
    supabase.from('cameras').select('*').order('name').then(({ data }) => {
      const loadedCameras = (data || []) as Camera[];
      setCameras(loadedCameras);
      const slotCamera = loadedCameras.find(camera => camera.type === 'slot');
      if (slotCamera) setActiveCamera(slotCamera);
    });
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
    if (!error) await logActivity('Saved slot AOI', 'Slot Management', { slot_id: slotId, camera_id: activeCamera?.id || null });
    setTimeout(() => setSaveStatus(null), 2500);
  };

  const clearAOI = async (slotId: string) => {
    setAoiMap(prev => { const next = { ...prev }; delete next[slotId]; return next; });
    await supabase.from('parking_slots').update({ aoi_polygon: null, aoi_color: null }).eq('id', slotId);
    await logActivity('Cleared slot AOI', 'Slot Management', { slot_id: slotId });
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
      await logActivity('Added parking slot', 'Slot Management', { slot_id: slotName, vehicle_type: vehicleType });
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
      await logActivity('Deleted parking slot', 'Slot Management', { slot_id: slot.slot_id });
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
          liveSlotStates={liveSlotStates}
          onSlotStatesChange={(newMap) => {
            // Guarantee fresh object reference for React re-render
            setLiveSlotStates(prev => ({ ...prev, ...newMap }));
          }}
        />
      )}

      {/* Slot Cards Grid */}
      <div className="slot-summary-section">
        <h3 className="slot-summary-title">Slots in {activeCamera?.name || 'Camera'} ({currentSlots.length})</h3>
        <div className="slots-grid">
          {currentSlots.map(slot => {
            const live = liveSlotStates[slot.id] ||
              liveSlotStates[slot.slot_id] ||
              liveSlotStates[slot.slot_id.toLowerCase()] ||
              liveSlotStates[slot.slot_id.toUpperCase()] ||
              Object.values(liveSlotStates).find((s: any) =>
                (s.dbId && String(s.dbId).toLowerCase() === String(slot.id).toLowerCase()) ||
                (s.slotId && String(s.slotId).toLowerCase() === String(slot.slot_id).toLowerCase()) ||
                (s.name && String(s.name).toLowerCase() === String(slot.slot_id).toLowerCase())
              );

            return (
              <SlotCard key={slot.id} slot={slot} aoi={aoiMap[slot.id]} isEditing={editingSlotId === slot.id}
                enabledActions={slotActions}
                liveState={live}
                onEdit={() => startEditing(slot.id)} onUpdate={updateSlot} onDelete={() => deleteSlot(slot.id)} />
            );
          })}
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
  saveStatus, liveSlotStates, onSlotStatesChange,
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
  liveSlotStates?: Record<string, any>;
  onSlotStatesChange?: (states: Record<string, any>) => void;
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

  // Debug state for IP camera
  const slotMonitorUrl = import.meta.env.VITE_SLOT_MONITOR_URL || 'http://127.0.0.1:8766';
  const [showDebug, setShowDebug] = useState(false);
  const [debugState, setDebugState] = useState<any>(null);

  // Poll /state every second for the debug panel when active camera is IP
  useEffect(() => {
    if (camera.connection_method !== 'ip') return;
    const interval = setInterval(() => {
      fetch(`${slotMonitorUrl}/state`)
        .then(res => res.json())
        .then(data => setDebugState(data))
        .catch(err => {
          console.debug('[SlotMonitor Debug] /state poll error:', err);
        });
    }, 1000);
    return () => clearInterval(interval);
  }, [camera.connection_method, slotMonitorUrl]);

  // Calibration state
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState<boolean | null>(null);
  const [calibrateMsg, setCalibrateMsg] = useState('');

  // IP Camera Health & Connection State
  const [ipFeedStatus, setIpFeedStatus] = useState<{ status: 'connecting' | 'connected' | 'error'; message: string }>({
    status: 'connecting',
    message: 'Connecting...'
  });

  // Poll /health every second when active camera is IP
  useEffect(() => {
    if (camera.connection_method !== 'ip') return;

    const rawUrl = (camera.ip_address || '').trim();
    const formattedUrl = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`) : '';

    // Reset displayed status when camera changes until /health confirms
    setIpFeedStatus({
      status: 'connecting',
      message: rawUrl ? `Connecting to ${rawUrl}...` : 'No IP address configured'
    });

    const pollHealth = async () => {
      try {
        const res = await fetch(`${slotMonitorUrl}/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (typeof data.calibrated === 'boolean') {
          setIsCalibrated(data.calibrated);
        }

        const norm = (u: string) => (u ? (u.startsWith('http') ? u : `http://${u}`).replace(/\/+$/, '').toLowerCase() : '');
        const expectedNorm = norm(formattedUrl);
        const returnedNorm = norm(data.cameraUrl || data.url || '');
        const urlMatches = Boolean(expectedNorm && returnedNorm && expectedNorm === returnedNorm);

        // Confirmed when cameraConnected is true, frame arrived within last 5s, and URL matches
        const isOk = Boolean(data.cameraConnected && urlMatches && (data.frameAge !== undefined ? data.frameAge < 5 : true));

        if (isOk) {
          setIpFeedStatus({ status: 'connected', message: 'Camera feed OK' });
        } else {
          setIpFeedStatus({ status: 'error', message: `No frames from ${rawUrl || 'camera'}` });
        }
      } catch {
        setIpFeedStatus({ status: 'error', message: `No frames from ${rawUrl || 'camera'}` });
      }
    };

    pollHealth();
    const interval = setInterval(pollHealth, 1000);
    return () => clearInterval(interval);
  }, [camera.id, camera.connection_method, camera.ip_address, slotMonitorUrl]);

  const handleCalibrateEmpty = async () => {
    setIsCalibrating(true);
    setCalibrateMsg('');
    try {
      const res = await fetch(`${slotMonitorUrl}/calibrate-empty`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        setIsCalibrated(true);
        setCalibrateMsg('Empty reference saved');
      } else {
        setCalibrateMsg(data.message || 'Calibration failed');
      }
    } catch (err: any) {
      setCalibrateMsg(err.message || 'Error connecting to service');
    } finally {
      setIsCalibrating(false);
      setTimeout(() => setCalibrateMsg(''), 4000);
    }
  };

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
      .map(slot => ({
        slotId: slot.slot_id,
        dbId: slot.id,
        polygon: aoiMap[slot.id].points as [number, number][],
        vehicleType: slot.vehicle_type
      }));
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

  // Monitoring controls
  const handleStartMonitoring = async () => {
    if (camera.connection_method !== 'ip' && !videoRef.current) return;
    setMonitorError('');
    try {
      setInitProgress('Starting...');
      const processor = new SlotMonitorProcessor();
      processor.onStatusChange(s => setMonitorStatus(s));
      processor.onDetections(d => setDetections(d));
      processor.onFrame(() => drawOverlay());
      processor.onSlotState((states: any[]) => {
        const map: Record<string, any> = {};
        for (const s of states) {
          if (s.dbId) map[s.dbId] = s;
          if (s.slotId) map[s.slotId] = s;
        }
        onSlotStatesChange?.(map);
        // Also update debugState slots directly from processor stream
        setDebugState((prev: any) => ({
          cameraConnected: true,
          fps: prev?.fps || 0,
          ...prev,
          slots: states
        }));
      });
      processor.onSlotChange((changes: SlotDetectionResult[]) => { console.log('[SlotManagement] Slot changes:', changes); });
      processor.onIpError((err: string) => { setMonitorError(err); });
      await processor.initialize();
      setInitProgress('Starting camera...');
      await processor.startCamera(selectedDevice, videoRef.current as any, camera);
      const configs: SlotAOIConfig[] = slots
        .filter(slot => aoiMap[slot.id]?.points.length >= 3)
        .map(slot => ({ slotId: slot.slot_id, dbId: slot.id, polygon: aoiMap[slot.id].points as [number, number][], vehicleType: slot.vehicle_type as any }));
      processor.setSlots(configs);
      processor.startProcessing();
      processorRef.current = processor;
      setIsMonitoring(true); setInitProgress('');
    } catch (err: any) { setMonitorError(err.message || 'Failed to start monitoring'); setInitProgress(''); }
  };

  // Cleanly switch cameras: stop previous processor, POST /config with new camera URL, and auto-start monitoring on IP cameras
  useEffect(() => {
    let cancelled = false;

    const initForCamera = async () => {
      if (processorRef.current) {
        await processorRef.current.stop();
        processorRef.current = null;
      }
      setIsMonitoring(false);
      setDetections([]);
      setMonitorStatus('idle');

      if (camera.connection_method === 'ip' && camera.ip_address) {
        const rawUrl = (camera.ip_address || '').trim();
        const formattedUrl = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`) : '';
        const comparableSlots = slots
          .filter(slot => aoiMap[slot.id]?.points.length >= 3)
          .map(slot => ({
            slotId: slot.slot_id,
            dbId: slot.id,
            polygon: aoiMap[slot.id].points as [number, number][],
            vehicleType: slot.vehicle_type
          }));

        console.log('[SlotManagement] Sending slot config to Python on camera switch:');
        comparableSlots.forEach(s => {
          console.log(`  -> Slot "${s.slotId}" (dbId: ${s.dbId}): vehicleType="${s.vehicleType}"`);
        });

        // POST /config with new camera's URL immediately when selected camera changes
        try {
          await fetch(`${slotMonitorUrl}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              camera: { url: formattedUrl, mode: 'mjpeg' },
              slots: comparableSlots,
              replaceAll: true
            })
          });
        } catch (e) {
          console.warn('[SlotManagement] Error posting /config on camera switch:', e);
        }

        if (!cancelled) {
          await handleStartMonitoring();
        }
      }
    };

    initForCamera();

    return () => {
      cancelled = true;
      processorRef.current?.stop();
      processorRef.current = null;
      setIsMonitoring(false);
    };
  }, [camera.id, camera.connection_method, camera.ip_address, slotMonitorUrl]);

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
          {camera.connection_method === 'ip' ? (
            camera.ip_address ? (
              <img 
                className="camera-video-element" 
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} 
                src={`${import.meta.env.VITE_SLOT_MONITOR_URL || 'http://127.0.0.1:8766'}/${editingSlotId ? 'raw' : 'preview'}.mjpg?t=${camera.id}_${editingSlotId ? 'raw' : 'preview'}`}
                alt="IP Camera Stream"
              />
            ) : null
          ) : (
            <video ref={videoRef} className="camera-video-element" playsInline muted style={{ display: isMonitoring ? 'block' : 'none' }} />
          )}
          {camera.connection_method !== 'ip' && <canvas ref={overlayRef} className="camera-overlay-canvas" style={{ display: isMonitoring ? 'block' : 'none' }} />}

          {!isMonitoring && !initProgress && (
            <div className="camera-placeholder">
              <IconCamera size={42} className="camera-placeholder-icon" />
              <div className="camera-placeholder-text">{camera.location || 'Select a slot and click Edit AOI to start drawing'}</div>
            </div>
          )}

          {initProgress && (<div className="camera-init-overlay"><div className="camera-init-spinner" /><span>{initProgress}</span></div>)}

          {camera.connection_method === 'ip' ? (
            ipFeedStatus.status === 'connected' ? (
              <div className="camera-status-badge status-confirmed" style={{ textTransform: 'none', background: 'rgba(22, 163, 74, 0.35)', color: '#86efac' }}>
                <span className="camera-status-dot" style={{ background: '#22c55e' }} /> Camera feed OK
              </div>
            ) : ipFeedStatus.status === 'error' ? (
              <div className="camera-status-badge status-error" style={{ textTransform: 'none', background: 'rgba(220, 38, 38, 0.35)', color: '#fca5a5' }}>
                <span className="camera-status-dot" style={{ background: '#ef4444' }} /> {ipFeedStatus.message}
              </div>
            ) : (
              <div className="camera-status-badge status-loading" style={{ textTransform: 'none', background: 'rgba(30, 41, 59, 0.7)', color: '#94a3b8' }}>
                <span className="camera-status-dot" style={{ background: '#3b82f6' }} /> {ipFeedStatus.message}
              </div>
            )
          ) : (
            isMonitoring && (
              <div className={`camera-status-badge status-${monitorStatus === 'scanning' ? 'scanning' : 'idle'}`}>
                <span className="camera-status-dot" />{monitorStatus === 'scanning' ? 'Monitoring' : monitorStatus}
              </div>
            )
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
          {camera.connection_method === 'ip' ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Monitoring via Python IP Camera Backend ({camera.ip_address})
                {isCalibrated !== null && (
                  <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 6px', borderRadius: 4, background: isCalibrated ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)', color: isCalibrated ? '#22c55e' : '#eab308' }}>
                    {isCalibrated ? '✓ Calibrated' : 'Not calibrated'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {calibrateMsg && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{calibrateMsg}</span>}
                <button
                  className="camera-start-btn"
                  onClick={handleCalibrateEmpty}
                  disabled={isCalibrating}
                  title="Capture current view as empty parking lot reference for improved color accuracy"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                  {isCalibrating ? 'Saving…' : 'Set empty reference'}
                </button>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
          {isMonitoring && (
            <div className="camera-detection-count">
              <span className="camera-det-num">{vehicleCount}</span>
              <span className="camera-det-label">vehicle{vehicleCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {monitorError && (<div className="camera-error-bar"><span>⚠ {monitorError}</span><button onClick={() => setMonitorError('')}>✕</button></div>)}

        {/* IP Camera Debug Panel */}
        {camera.connection_method === 'ip' && (
          <div style={{ marginTop: 8, padding: '6px 12px', background: 'rgba(0, 0, 0, 0.45)', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.08)', fontSize: 12 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setShowDebug(prev => !prev)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--text-muted)' }}>
                <span>{showDebug ? '▼' : '►'}</span>
                <span>Debug — Raw /state ({debugState?.slots?.length ?? 0} slots, {debugState?.fps ?? 0} fps)</span>
              </div>
              <span style={{ fontSize: 11, color: debugState?.cameraConnected ? '#22c55e' : '#ef4444' }}>
                {debugState?.cameraConnected ? '● Online (1s refresh)' : '○ No state'}
              </span>
            </div>

            {showDebug && (
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
                {(!debugState || !debugState.slots || debugState.slots.length === 0) ? (
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                    No slot data received yet from {slotMonitorUrl}/state
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {debugState.slots.map((s: any, idx: number) => {
                      const dbgSlotType = s.expectedType || s.rawSlotType || s.vehicleTypeConfig || 'unknown';
                      const dbgDetectedType = s.detectedType || (s.stableOccupied ? (s.vehicleType || 'unknown') : 'none');
                      const dbgMismatchStr = s.slotTypeMismatch ? 'yes' : 'no';
                      const compareText = `Slot: ${dbgSlotType} | Detected: ${dbgDetectedType} | Mismatch: ${dbgMismatchStr}`;

                      return (
                        <div key={s.slotId || s.dbId || idx} style={{ background: 'rgba(0, 0, 0, 0.5)', padding: '6px 8px', borderRadius: 4, border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <strong style={{ color: s.stableOccupied ? '#ef4444' : '#22c55e' }}>
                              {s.slotId || 'Unnamed'} (dbId: {s.dbId || 'none'})
                            </strong>
                            <span style={{ fontSize: 11, color: s.stableOccupied ? '#ef4444' : '#22c55e' }}>
                              {s.stableOccupied ? 'OCCUPIED' : 'AVAILABLE'}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: s.slotTypeMismatch ? '#ef4444' : '#38bdf8', marginBottom: 4, fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                            {compareText}
                          </div>
                          <pre style={{ margin: 0, fontSize: 10.5, color: '#a1a1aa', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'Consolas, monospace' }}>
                            {JSON.stringify(s, null, 2)}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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

            // For slots on an IP camera, overlay the live occupied state from Python /state (stableOccupied)
            let displayStatus = slot.status;
            if (camera.connection_method === 'ip' && liveSlotStates && slot.status !== 'disabled' && slot.status !== 'reserved') {
              const live = liveSlotStates[slot.id] ||
                liveSlotStates[slot.slot_id] ||
                liveSlotStates[slot.slot_id.toLowerCase()] ||
                liveSlotStates[slot.slot_id.toUpperCase()] ||
                Object.values(liveSlotStates).find((s: any) =>
                  (s.dbId && String(s.dbId).toLowerCase() === String(slot.id).toLowerCase()) ||
                  (s.slotId && String(s.slotId).toLowerCase() === String(slot.slot_id).toLowerCase()) ||
                  (s.name && String(s.name).toLowerCase() === String(slot.slot_id).toLowerCase())
                );
              if (live !== undefined && live.stableOccupied !== undefined) {
                displayStatus = live.stableOccupied ? 'occupied' : 'available';
              }
            }

            return (
              <div key={slot.id} className={`aoi-slot-row ${isEditing ? 'editing' : ''}`}>
                <div className="aoi-slot-info">
                  <span className="aoi-slot-color" style={{ background: aoi?.color || '#333' }} />
                  <span className="aoi-slot-id">{slot.slot_id}</span>
                  <span className={`aoi-slot-status aoi-status-${displayStatus}`}>{displayStatus}</span>
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
function SlotCard({ slot, aoi, isEditing, enabledActions, liveState, onEdit, onUpdate, onDelete }: {
  slot: ParkingSlot; aoi?: SlotAOI; isEditing: boolean;
  enabledActions: SlotActionSettings;
  liveState?: any;
  onEdit: () => void; onUpdate: (id: string, updates: Partial<ParkingSlot>) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [domData, setDomData] = useState({
    type: '', color: '', conf: '', mismatch: 'false',
    liveType: '', liveColor: '', liveConf: '', liveOverlap: '',
    stableOccupied: 'false',
    expectedType: '', detectedType: ''
  });
  const [thumbKey, setThumbKey] = useState(Date.now());
  const [thumbLoaded, setThumbLoaded] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const interval = setInterval(() => {
      setDomData({
        type: el.getAttribute('data-vehicle-type') || '',
        color: el.getAttribute('data-color') || '',
        conf: el.getAttribute('data-type-conf') || '',
        mismatch: el.getAttribute('data-mismatch') || 'false',
        liveType: el.getAttribute('data-live-type') || '',
        liveColor: el.getAttribute('data-live-color') || '',
        liveConf: el.getAttribute('data-live-conf') || '',
        liveOverlap: el.getAttribute('data-live-overlap') || '',
        stableOccupied: el.getAttribute('data-stable-occupied') || 'false',
        expectedType: el.getAttribute('data-expected-type') || '',
        detectedType: el.getAttribute('data-detected-type') || '',
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const slotMonitorUrl = import.meta.env.VITE_SLOT_MONITOR_URL || 'http://127.0.0.1:8766';

  // Evaluate state (liveState prop with domData fallback)
  const isStable = liveState !== undefined ? Boolean(liveState.stableOccupied) : (domData.stableOccupied === 'true');
  const isOccupied = slot.status === 'occupied' || isStable;

  const stableType = liveState?.vehicleType ?? domData.type;
  const stableColor = liveState?.color ?? domData.color;
  const stableConf = liveState?.typeConfidence ?? (domData.conf ? parseFloat(domData.conf) : 0);
  const isMismatch = liveState !== undefined ? Boolean(liveState.slotTypeMismatch) : (domData.mismatch === 'true');

  const liveType = liveState?.liveVehicleType ?? domData.liveType;
  const liveColor = liveState?.liveColor ?? domData.liveColor;
  const liveConf = liveState?.liveConfidence ?? (domData.liveConf ? parseFloat(domData.liveConf) : 0);
  const liveOverlap = liveState?.liveOverlap ?? (domData.liveOverlap ? parseFloat(domData.liveOverlap) : 0);

  const hasLiveDetection = Boolean(
    (liveType && liveType !== 'unknown' && liveType !== '—') ||
    (liveConf && liveConf > 0)
  );

  useEffect(() => {
    if (isOccupied) {
      const interval = setInterval(() => setThumbKey(Date.now()), 2000);
      return () => clearInterval(interval);
    } else {
      setThumbLoaded(false);
    }
  }, [isOccupied]);

  const formatVal = (v: any) => {
    if (!v || v === 'unknown' || v === 'Unknown' || v === 'null') return '—';
    return String(v);
  };

  const formatPct = (c: any) => {
    if (c === null || c === undefined || c === '' || isNaN(Number(c)) || Number(c) <= 0) return '—';
    const num = Number(c);
    const pct = num <= 1 ? Math.round(num * 100) : Math.round(num);
    return `${pct}%`;
  };

  // Effective display status: if disabled or reserved, respect that; otherwise follow occupancy
  const effectiveStatus = (slot.status === 'disabled' || slot.status === 'reserved')
    ? slot.status
    : (isOccupied ? 'occupied' : 'available');

  const comparedSlot = liveState?.expectedType || domData.expectedType || slot.vehicle_type || 'unknown';
  const comparedDetected = isStable
    ? (liveState?.detectedType || domData.detectedType || stableType || 'unknown')
    : (hasLiveDetection ? (liveState?.liveVehicleType || liveType || 'detecting') : 'none');
  const mismatchStr = isMismatch ? 'yes' : 'no';
  const cardTooltip = `Slot: ${comparedSlot} | Detected: ${comparedDetected} | Mismatch: ${mismatchStr}`;

  return (
    <div id={`slot-card-${slot.id}`} ref={cardRef} title={cardTooltip} className={`slot-card slot-${effectiveStatus} ${isEditing ? 'slot-editing' : ''} ${isMismatch ? 'mismatch' : ''}`}>
      <div className="slot-card-header">
        <span className="slot-id">{slot.slot_id}</span>
        <div className="slot-card-header-actions">
          <span className="slot-type-icon">{slot.vehicle_type === 'car' ? <IconCar size={18} /> : <IconMotorcycle size={18} />}</span>
          <button
            type="button"
            className="slot-menu-trigger"
            title="Slot actions"
            aria-label={`Actions for slot ${slot.slot_id}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
          >
            <IconMore size={18} />
          </button>
          {menuOpen && (
            <div className="slot-actions-menu">
              {enabledActions.edit && <button className="slot-action-btn" onClick={() => { setMenuOpen(false); onEdit(); }}><IconEdit size={14} /><span>Edit AOI</span></button>}
              {enabledActions.disable && (slot.status !== 'disabled'
                ? <button className="slot-action-btn" onClick={() => { setMenuOpen(false); onUpdate(slot.id, { status: 'disabled' as SlotStatus }); }}><IconBan size={14} /><span>Disable</span></button>
                : <button className="slot-action-btn" onClick={() => { setMenuOpen(false); onUpdate(slot.id, { status: 'available' as SlotStatus }); }}><IconCheck size={14} /><span>Enable</span></button>)}
              {enabledActions.reservation && (slot.status !== 'reserved'
                ? <button className="slot-action-btn" onClick={() => { setMenuOpen(false); onUpdate(slot.id, { status: 'reserved' as SlotStatus }); }}><IconLock size={14} /><span>Reserve</span></button>
                : <button className="slot-action-btn" onClick={() => { setMenuOpen(false); onUpdate(slot.id, { status: 'available' as SlotStatus }); }}><IconUnlock size={14} /><span>Cancel reservation</span></button>)}
              {enabledActions.delete && <button className="slot-action-btn slot-action-danger" onClick={() => { setMenuOpen(false); onDelete(); }}><IconTrash size={14} /><span>Delete</span></button>}
              {!enabledActions.edit && !enabledActions.disable && !enabledActions.reservation && !enabledActions.delete && (
                <span className="slot-actions-empty">No actions enabled</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="slot-card-type">{slot.vehicle_type}</div>
      <div className={`slot-status-text slot-${effectiveStatus}`}>{effectiveStatus}</div>
      <div className="slot-aoi-indicator">
        {aoi && aoi.points.length >= 3 ? <span className="aoi-set" style={{ color: aoi.color }}>AOI: {aoi.points.length} pts</span> : <span className="aoi-unset">No AOI</span>}
      </div>
      
      {/* Live / Stable Detection Feedback */}
      <div style={{ marginTop: 8, fontSize: 11, background: 'rgba(0,0,0,0.4)', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,200,0.06)' }}>
        {isStable ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
              <strong style={{ color: '#22c55e' }}>Confirmed</strong>
            </div>
            <div style={{ color: 'var(--cursor-text, #e4e4e7)' }}>
              {formatVal(stableType)} · {formatVal(stableColor)} · {formatPct(stableConf)}
            </div>
          </div>
        ) : hasLiveDetection ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
              <strong style={{ color: '#f59e0b' }}>Detecting…</strong>
            </div>
            <div style={{ color: 'var(--cursor-text, #e4e4e7)' }}>
              {formatVal(liveType)} · {formatVal(liveColor)} · {formatPct(liveConf)}{liveOverlap > 0 ? ` · ${Math.round(Number(liveOverlap))}% ov` : ''}
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--cursor-text-muted, #71717a)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#71717a' }} />
            <span>No vehicle</span>
          </div>
        )}

        {isMismatch && (
          <div title={cardTooltip} style={{ color: '#ef4444', fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>⚠</span> Type Mismatch
          </div>
        )}
      </div>

      {/* Vehicle thumbnail crop while occupied */}
      {isOccupied && (
        <div style={{ marginTop: 8, borderRadius: 6, overflow: 'hidden', height: 80, background: '#18181b', border: '1px solid rgba(255,255,255,0.08)', position: 'relative' }}>
          <img
            src={`${slotMonitorUrl}/slot/${encodeURIComponent(slot.slot_id)}.jpg?t=${thumbKey}`}
            alt={`Vehicle in slot ${slot.slot_id}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: thumbLoaded ? 'block' : 'none' }}
            onLoad={() => setThumbLoaded(true)}
            onError={() => setThumbLoaded(false)}
          />
          {!thumbLoaded && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 11, color: 'var(--cursor-text-muted, #71717a)' }}>
              Vehicle crop
            </div>
          )}
        </div>
      )}
    </div>
  );
}