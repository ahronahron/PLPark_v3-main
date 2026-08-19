import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase, type Camera, type ParkingSlot, type SlotStatus } from '@/lib/supabase';
import { IconBan, IconCamera, IconCar, IconCheck, IconEdit, IconLock, IconMotorcycle, IconTrash } from '@/components/Icons';

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
  }, []);

  const cameraSlots = useCallback((): ParkingSlot[] => {
    if (!activeCamera?.slot_range) return [];
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
    setSaveStatus({ slotId, msg: error ? 'Save failed' : 'AOI saved', ok: !error });
    if (!error) setSlots(prev => prev.map(slot => slot.id === slotId ? { ...slot, ...updates } : slot));
    setTimeout(() => setSaveStatus(null), 2500);
  };

  const clearAOI = async (slotId: string) => {
    setAoiMap(prev => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
    await supabase.from('parking_slots').update({ aoi_polygon: null, aoi_color: null }).eq('id', slotId);
    setSlots(prev => prev.map(slot => slot.id === slotId ? { ...slot, aoi_polygon: null, aoi_color: null } : slot));
  };

  const startEditing = (slotId: string) => {
    const slot = slots.find(item => item.id === slotId);
    if (!slot) return;
    if (!aoiMap[slotId]) {
      setAoiMap(prev => ({ ...prev, [slotId]: { slotId: slot.slot_id, points: [], color: AOI_COLORS[Object.keys(prev).length % AOI_COLORS.length] } }));
    }
    setEditingSlotId(slotId);
  };

  const slotCameras = cameras.filter(camera => camera.type === 'slot');
  const currentSlots = cameraSlots();

  return (
    <div className="slots-page">
      <div className="slot-camera-tabs">
        {slotCameras.map(camera => <button key={camera.id} className={`slot-cam-tab ${activeCamera?.id === camera.id ? 'active' : ''}`} onClick={() => { setActiveCamera(camera); setEditingSlotId(null); }}><IconCamera size={16} /><span>{camera.name}</span>{camera.slot_range && <span className="slot-cam-range">{camera.slot_range}</span>}<span className={`slot-cam-status ${camera.is_online ? 'online' : 'offline'}`} /></button>)}
      </div>
      {activeCamera && <CameraPanel camera={activeCamera} slots={currentSlots} aoiMap={aoiMap} setAoiMap={setAoiMap} editingSlotId={editingSlotId} onStartEditing={startEditing} onStopEditing={() => setEditingSlotId(null)} onSaveAOI={saveAOI} onClearAOI={clearAOI} saveStatus={saveStatus} />}
      <div className="slot-summary-section">
        <h3 className="slot-summary-title">Slots in {activeCamera?.name || 'Camera'} ({activeCamera?.slot_range || ''})</h3>
        <div className="slots-grid">{currentSlots.map(slot => <SlotCard key={slot.id} slot={slot} aoi={aoiMap[slot.id]} isEditing={editingSlotId === slot.id} onEdit={() => startEditing(slot.id)} onUpdate={updateSlot} />)}{currentSlots.length === 0 && <div className="empty-state">No slots assigned to this camera</div>}</div>
      </div>
    </div>
  );
}

function CameraPanel({ camera, slots, aoiMap, setAoiMap, editingSlotId, onStartEditing, onStopEditing, onSaveAOI, onClearAOI, saveStatus }: { camera: Camera; slots: ParkingSlot[]; aoiMap: Record<string, SlotAOI>; setAoiMap: Dispatch<SetStateAction<Record<string, SlotAOI>>>; editingSlotId: string | null; onStartEditing: (slotId: string) => void; onStopEditing: () => void; onSaveAOI: (slotId: string) => void; onClearAOI: (slotId: string) => void; saveStatus: { slotId: string; msg: string; ok: boolean } | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const editingAoi = editingSlotId ? aoiMap[editingSlotId] : null;
  const editingSlot = slots.find(slot => slot.id === editingSlotId);
  const getPoint = (event: React.MouseEvent): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  const updatePoints = (points: Point[]) => {
    if (editingSlotId) setAoiMap(prev => ({ ...prev, [editingSlotId]: { ...prev[editingSlotId], points } }));
  };
  const toSvgPoints = (points: Point[]) => points.map(point => `${point[0] * 100},${point[1] * 100}`).join(' ');
  const handleMove = (event: React.MouseEvent) => {
    if (dragIdx === null || !editingAoi) return;
    const point = getPoint(event);
    if (point) updatePoints(editingAoi.points.map((item, index) => index === dragIdx ? point : item));
  };

  return <div className="camera-panel-container">
    <div className="camera-panel-feed">
      <div className="camera-feed-header"><span className="live-badge"><span className="live-dot" /> LIVE</span><span className="camera-name">{camera.name}</span><span className="camera-timestamp">{new Date().toLocaleTimeString('en-US', { hour12: false })}</span></div>
      <div className="camera-feed-body" onMouseMove={handleMove} onMouseUp={() => setDragIdx(null)} onMouseLeave={() => setDragIdx(null)}>
        <div className="camera-placeholder"><IconCamera size={42} className="camera-placeholder-icon" /><div className="camera-placeholder-text">{camera.location || 'Live feed'}</div>{!camera.is_online && <div className="camera-offline">Camera Offline</div>}</div>
        <svg ref={svgRef} className="aoi-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" onClick={event => { if (!editingAoi) return; const point = getPoint(event); if (point) updatePoints([...editingAoi.points, point]); }} style={{ cursor: editingSlotId ? 'crosshair' : 'default' }}>
          <defs><pattern id="aoi-grid" width="6.25" height="6.25" patternUnits="userSpaceOnUse"><path d="M 6.25 0 L 0 0 0 6.25" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.15" /></pattern></defs><rect width="100" height="100" fill="url(#aoi-grid)" />
          {slots.map(slot => { const aoi = aoiMap[slot.id]; if (!aoi || aoi.points.length < 2) return null; const isEditing = editingSlotId === slot.id; const opacity = editingSlotId ? (isEditing ? 0.9 : 0.25) : 0.5; const centerX = aoi.points.reduce((sum, point) => sum + point[0], 0) / aoi.points.length * 100; const centerY = aoi.points.reduce((sum, point) => sum + point[1], 0) / aoi.points.length * 100; return <g key={slot.id}>
            {aoi.points.length >= 3 && <polygon points={toSvgPoints(aoi.points)} fill={aoi.color} fillOpacity={isEditing ? 0.15 : (slot.status === 'occupied' ? 0.2 : 0.08)} stroke={aoi.color} strokeWidth={isEditing ? 0.5 : 0.3} strokeOpacity={opacity} strokeDasharray={isEditing ? '' : '0.5,0.5'} />}
            {aoi.points.length === 2 && <line x1={aoi.points[0][0] * 100} y1={aoi.points[0][1] * 100} x2={aoi.points[1][0] * 100} y2={aoi.points[1][1] * 100} stroke={aoi.color} strokeWidth={0.4} strokeOpacity={opacity} />}
            {aoi.points.length >= 3 && <><rect x={centerX - 4} y={centerY - 2} width="8" height="4" rx="1" fill={aoi.color} fillOpacity={opacity} /><text x={centerX} y={centerY + 0.5} textAnchor="middle" fill="white" fontSize="2.5" fontWeight="700">{slot.slot_id}</text><circle cx={centerX} cy={centerY + 2.5} r="0.8" fill={slot.status === 'available' ? '#22c55e' : slot.status === 'occupied' ? '#ef4444' : slot.status === 'reserved' ? '#eab308' : '#5c5c5c'} /></>}
            {isEditing && aoi.points.map((point, index) => <g key={index}><circle cx={point[0] * 100} cy={point[1] * 100} r="1.2" fill={aoi.color} stroke="white" strokeWidth="0.3" className="aoi-point" onMouseDown={event => { event.stopPropagation(); setDragIdx(index); }} onDoubleClick={event => { event.stopPropagation(); updatePoints(aoi.points.filter((_, pointIndex) => pointIndex !== index)); }} /><text x={point[0] * 100 + 1.5} y={point[1] * 100 - 1} fill={aoi.color} fontSize="1.8" fontWeight="600">{index + 1}</text></g>)}
          </g>; })}
        </svg>
        {!camera.is_online && <div className="camera-feed-offline" />}
      </div>
    </div>
    <div className="camera-panel-side">
      <div className="camera-panel-header"><span>Slots in view ({slots.length})</span>{editingSlotId && <button className="aoi-done-btn" onClick={onStopEditing}>Done Editing</button>}</div>
      <div className="camera-panel-slots">{slots.map(slot => { const aoi = aoiMap[slot.id]; const isEditing = editingSlotId === slot.id; return <div key={slot.id} className={`aoi-slot-row ${isEditing ? 'editing' : ''}`}>
        <div className="aoi-slot-info"><span className="aoi-slot-color" style={{ background: aoi?.color || '#333' }} /><span className="aoi-slot-id">{slot.slot_id}</span><span className={`aoi-slot-status aoi-status-${slot.status}`}>{slot.status}</span>{aoi && <span className="aoi-point-count">{aoi.points.length} pts</span>}</div>
        <div className="aoi-slot-actions">{!isEditing ? <button className="aoi-edit-btn" onClick={() => onStartEditing(slot.id)} title="Edit AOI"><IconEdit size={13} /></button> : <><span className="aoi-editing-label">Drawing...</span><button className="aoi-save-btn" onClick={() => onSaveAOI(slot.id)} title="Save AOI">Save</button>{aoi && aoi.points.length > 0 && <button className="aoi-clear-btn" onClick={() => onClearAOI(slot.id)} title="Clear AOI"><IconTrash size={13} /></button>}</>}</div>
        {saveStatus?.slotId === slot.id && <div className={`aoi-save-msg ${saveStatus.ok ? 'ok' : 'err'}`}>{saveStatus.msg}</div>}
      </div>; })}{slots.length === 0 && <div className="empty-state">No slots in this camera&apos;s range</div>}</div>
      {editingSlotId && editingAoi && <div className="aoi-edit-panel"><div className="aoi-edit-title">Editing AOI: {editingSlot?.slot_id}</div><div className="aoi-edit-hint"><p>Click on the camera feed to add points.</p><p>Drag points to move them.</p><p>Double-click a point to delete it.</p><p>Need at least 3 points to save.</p></div><div className="aoi-color-picker"><span className="aoi-color-label">Color:</span>{AOI_COLORS.map(color => <button key={color} className={`aoi-color-swatch ${editingAoi.color === color ? 'selected' : ''}`} style={{ background: color }} onClick={() => setAoiMap(prev => ({ ...prev, [editingSlotId]: { ...prev[editingSlotId], color } }))} />)}</div><div className="aoi-edit-points"><span>Points: {editingAoi.points.length}</span>{editingAoi.points.length >= 3 && <span className="aoi-ready">Ready to save</span>}</div></div>}
    </div>
  </div>;
}

function SlotCard({ slot, aoi, isEditing, onEdit, onUpdate }: { slot: ParkingSlot; aoi?: SlotAOI; isEditing: boolean; onEdit: () => void; onUpdate: (id: string, updates: Partial<ParkingSlot>) => void }) {
  return <div className={`slot-card slot-${slot.status} ${isEditing ? 'slot-editing' : ''}`}><div className="slot-card-header"><span className="slot-id">{slot.slot_id}</span><span className="slot-type-icon">{slot.vehicle_type === 'car' ? <IconCar size={18} /> : <IconMotorcycle size={18} />}</span></div><div className="slot-card-type">{slot.vehicle_type}</div><div className={`slot-status-text slot-${slot.status}`}>{slot.status}</div><div className="slot-aoi-indicator">{aoi && aoi.points.length >= 3 ? <span className="aoi-set" style={{ color: aoi.color }}>AOI: {aoi.points.length} pts</span> : <span className="aoi-unset">No AOI</span>}</div><div className="slot-card-actions"><button className="slot-action-btn" title="Edit AOI" onClick={onEdit}><IconEdit size={14} /><span>Edit AOI</span></button>{slot.status !== 'disabled' ? <button className="slot-action-btn" title="Disable" onClick={() => onUpdate(slot.id, { status: 'disabled' as SlotStatus })}><IconBan size={14} /><span>Disable</span></button> : <button className="slot-action-btn" title="Enable" onClick={() => onUpdate(slot.id, { status: 'available' as SlotStatus })}><IconCheck size={14} /><span>Enable</span></button>}<button className="slot-action-btn" title="Reserve" onClick={() => onUpdate(slot.id, { status: 'reserved' as SlotStatus })}><IconLock size={14} /><span>Reserve</span></button></div></div>;
}