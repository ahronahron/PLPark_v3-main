import { useEffect, useState } from 'react';
import { supabase, type ParkingSlot, type SlotStatus, type VehicleType } from '@/lib/supabase';
import { IconCar, IconMotorcycle, IconEdit, IconBan, IconLock, IconCheck } from '@/components/Icons';

export function SlotManagement() {
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [floorFilter, setFloorFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => setSlots(data || []));
  }, []);

  const updateSlot = async (id: string, updates: Partial<ParkingSlot>) => {
    await supabase.from('parking_slots').update(updates).eq('id', id);
    setSlots(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const filtered = slots.filter(s =>
    (floorFilter === 'all' || s.floor === floorFilter) &&
    (typeFilter === 'all' || s.vehicle_type === typeFilter) &&
    (statusFilter === 'all' || s.status === statusFilter)
  );

  const floors = [...new Set(slots.map(s => s.floor))];

  return (
    <div className="slots-page">
      <div className="slot-filters">
        <select value={floorFilter} onChange={e => setFloorFilter(e.target.value)}>
          <option value="all">All Floors</option>
          {floors.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          <option value="car">Car</option>
          <option value="motorcycle">Motorcycle</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="available">Available</option>
          <option value="occupied">Occupied</option>
          <option value="reserved">Reserved</option>
          <option value="disabled">Disabled</option>
        </select>
        <div className="slot-legend">
          <span className="legend-item"><span className="legend-dot slot-available" />Available</span>
          <span className="legend-item"><span className="legend-dot slot-occupied" />Occupied</span>
          <span className="legend-item"><span className="legend-dot slot-reserved" />Reserved</span>
          <span className="legend-item"><span className="legend-dot slot-disabled" />Disabled</span>
        </div>
      </div>

      <div className="slots-grid">
        {filtered.map(slot => (
          <div key={slot.id} className={`slot-card slot-${slot.status}`}>
            <div className="slot-card-header">
              <span className="slot-id">{slot.slot_id}</span>
              <span className="slot-type-icon">
                {slot.vehicle_type === 'car' ? <IconCar size={18} /> : <IconMotorcycle size={18} />}
              </span>
            </div>
            <div className="slot-card-type">{slot.vehicle_type}</div>
            <div className={`slot-status-text slot-${slot.status}`}>{slot.status}</div>
            <div className="slot-card-actions">
              <button className="slot-action-btn" title="Edit Slot"><IconEdit size={14} /><span>Edit</span></button>
              {slot.status !== 'disabled' ? (
                <button className="slot-action-btn" title="Disable" onClick={() => updateSlot(slot.id, { status: 'disabled' as SlotStatus })}><IconBan size={14} /><span>Disable</span></button>
              ) : (
                <button className="slot-action-btn" title="Enable" onClick={() => updateSlot(slot.id, { status: 'available' as SlotStatus })}><IconCheck size={14} /><span>Enable</span></button>
              )}
              <button className="slot-action-btn" title="Reserve" onClick={() => updateSlot(slot.id, { status: 'reserved' as SlotStatus })}><IconLock size={14} /><span>Reserve</span></button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-state">No slots match filters</div>}
      </div>
    </div>
  );
}
