/**
 * SlotManagement.tsx — Parking Slot Management Page
 *
 * This page allows administrators to monitor and manage individual parking slot
 * statuses. It provides:
 *
 * 1. **Filters** — Interactive selectors to filter slots by floor level, vehicle type, and status.
 * 2. **Legend** — Clear color-coded mapping for available, occupied, reserved, and disabled slots.
 * 3. **Grid Layout** — Card-based rendering of all slots showing status details and configuration buttons.
 *
 * Actions:
 * - Edit Slot (Coordinate ROI settings mock).
 * - Disable / Enable slots (updates status in Supabase table).
 * - Reserve slots (locks the slot status to Reserved).
 */
import { useEffect, useState } from 'react';
import { supabase, type ParkingSlot, type SlotStatus } from '@/lib/supabase';
import { IconCar, IconMotorcycle, IconEdit, IconBan, IconLock, IconCheck } from '@/components/Icons';

/**
 * SlotManagement — Slot management module component.
 *
 * State:
 * - `slots`: Full list of slot records fetched from the database.
 * - `floorFilter`: Currently active floor level filter.
 * - `typeFilter`: Currently active vehicle classification constraint filter.
 * - `statusFilter`: Currently active slot operational state filter.
 *
 * @returns SlotManagement interface.
 */
export function SlotManagement() {
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [floorFilter, setFloorFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  /** Fetch all slots ordered by slot ID on component mount */
  useEffect(() => {
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => setSlots(data || []));
  }, []);

  /**
   * updateSlot — Modifies a slot's record in Supabase and updates local component state.
   *
   * @param id — The slot UUID
   * @param updates — Partial object containing column changes
   */
  const updateSlot = async (id: string, updates: Partial<ParkingSlot>) => {
    const { error } = await supabase.from('parking_slots').update(updates).eq('id', id);
    if (!error) {
      setSlots(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    }
  };

  /** Filter the slot records according to active filter dropdown values */
  const filtered = slots.filter(s =>
    (floorFilter === 'all' || s.floor === floorFilter) &&
    (typeFilter === 'all' || s.vehicle_type === typeFilter) &&
    (statusFilter === 'all' || s.status === statusFilter)
  );

  /** Generate unique lists of floor levels present in the dataset */
  const floors = [...new Set(slots.map(s => s.floor))];

  return (
    <div className="slots-page">
      {/* Filtering toolbar */}
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

      {/* Grid of slot cards */}
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
            
            {/* Quick configuration actions */}
            <div className="slot-card-actions">
              <button className="slot-action-btn" title="Edit Slot" onClick={() => alert('ROI boundary editor coordinate setup')}>
                <IconEdit size={14} /><span>Edit</span>
              </button>
              {slot.status !== 'disabled' ? (
                <button className="slot-action-btn" title="Disable" onClick={() => updateSlot(slot.id, { status: 'disabled' as SlotStatus })}>
                  <IconBan size={14} /><span>Disable</span>
                </button>
              ) : (
                <button className="slot-action-btn" title="Enable" onClick={() => updateSlot(slot.id, { status: 'available' as SlotStatus })}>
                  <IconCheck size={14} /><span>Enable</span>
                </button>
              )}
              <button className="slot-action-btn" title="Reserve" onClick={() => updateSlot(slot.id, { status: 'reserved' as SlotStatus })}>
                <IconLock size={14} /><span>Reserve</span>
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-state">No slots match filters</div>}
      </div>
    </div>
  );
}
