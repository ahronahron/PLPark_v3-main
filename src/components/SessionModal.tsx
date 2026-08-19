import { useEffect, useState } from 'react';
import { supabase, type ParkingSession, type PaymentMethod } from '@/lib/supabase';
import { IconCar, IconMotorcycle } from '@/components/Icons';

export type SessionAction = 'exit' | 'payment';

interface SessionModalProps {
  session: ParkingSession | null;
  sessions: ParkingSession[];
  action: SessionAction;
  onClose: () => void;
  onComplete: () => void;
}

const durationFor = (session: ParkingSession) => Math.max(0.5, (Date.now() - new Date(session.entry_time).getTime()) / 3600000);

export function SessionModal({ session: initialSession, sessions, action, onClose, onComplete }: SessionModalProps) {
  const activeSessions = sessions.filter(item => item.status === 'active');
  const [query, setQuery] = useState(initialSession?.plate_number || '');
  const [selected, setSelected] = useState<ParkingSession | null>(initialSession);
  const [duration, setDuration] = useState(initialSession ? durationFor(initialSession).toFixed(2) : '');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [status, setStatus] = useState('');
  const matches = activeSessions.filter(item => item.plate_number.toLowerCase().includes(query.toLowerCase()));
  const rate = selected?.vehicle_type === 'motorcycle' ? 25 : 50;
  const total = Number(duration || 0) * rate;

  useEffect(() => {
    if (initialSession) {
      setSelected(initialSession);
      setQuery(initialSession.plate_number);
      setDuration(durationFor(initialSession).toFixed(2));
    }
  }, [initialSession]);

  const choose = (item: ParkingSession) => {
    setSelected(item);
    setQuery(item.plate_number);
    setDuration(durationFor(item).toFixed(2));
    setStatus('');
  };

  const submit = async () => {
    if (!selected) {
      setStatus('Plate number does not match an active session.');
      return;
    }
    if (action === 'payment') {
      const { data: payments } = await supabase.from('payments').select('id');
      const receipt = `RCP-${new Date().getFullYear()}-${String((payments?.length || 0) + 1).padStart(4, '0')}`;
      const { error } = await supabase.from('payments').insert({ receipt_number: receipt, plate_number: selected.plate_number, session_id: selected.id, duration_hours: Number(duration), hourly_rate: rate, total_amount: total, payment_method: method, status: 'completed', processed_by: 'admin' });
      if (error) { setStatus(error.message); return; }
      setStatus(`Payment successful. Receipt: ${receipt}`);
    } else {
      const { error } = await supabase.from('parking_sessions').update({ status: 'completed', exit_time: new Date().toISOString() }).eq('id', selected.id);
      if (error) { setStatus(error.message); return; }
      if (selected.slot_id) await supabase.from('parking_slots').update({ status: 'available', current_session_id: null }).eq('slot_id', selected.slot_id);
      await supabase.from('plate_recognitions').insert({ plate_number: selected.plate_number, vehicle_type: selected.vehicle_type, direction: 'exit', confidence: 100, camera_name: 'Manual Exit', created_at: new Date().toISOString() });
      setStatus('Manual exit completed.');
    }
    setTimeout(() => { onComplete(); onClose(); }, 700);
  };

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-container session-modal" onClick={event => event.stopPropagation()}>
      <div className="modal-header"><h3>{action === 'exit' ? 'Manual Exit' : 'Manual Payment'}</h3><button className="close-btn" onClick={onClose}>×</button></div>
      <div className="modal-body">
        <div className="form-group session-plate-search"><label>Search active plate number</label><input autoFocus value={query} onChange={event => { setQuery(event.target.value.toUpperCase()); setSelected(null); setStatus(''); }} placeholder="ABC 1234" />
          {query && !selected && <div className="plate-suggestions">{matches.map(item => <button key={item.id} onClick={() => choose(item)}>{item.plate_number}<span>{item.vehicle_type} {item.slot_id ? `• Slot ${item.slot_id}` : ''}</span></button>)}{matches.length === 0 && <div className="plate-no-match">Plate number does not match an active session.</div>}</div>}
        </div>
        {selected && <div className="session-detail-panel">{selected.image_url || selected.plate_image_url ? <img src={selected.plate_image_url || selected.image_url || ''} alt="Plate snapshot" className="session-plate-image" /> : <div className="session-vehicle-icon">{selected.vehicle_type === 'car' ? <IconCar size={28} /> : <IconMotorcycle size={28} />}</div>}<div><strong>{selected.plate_number}</strong><div>Vehicle type: {selected.vehicle_type}</div><div>Assigned slot: {selected.slot_id || 'None'}</div><div>Entry: {new Date(selected.entry_time).toLocaleString()}</div></div></div>}
        {selected && action === 'payment' && <><div className="form-group"><label>Parking Duration (hrs)</label><input type="number" step="0.5" value={duration} onChange={event => setDuration(event.target.value)} /></div><div className="form-group"><label>Payment Method</label><select value={method} onChange={event => setMethod(event.target.value as PaymentMethod)}><option value="cash">Cash</option><option value="gcash">GCash</option><option value="card">Card</option></select></div><div className="total-amount">₱{total.toFixed(2)}</div></>}
        {status && <div className={`save-status ${status.toLowerCase().includes('successful') || status.includes('completed') ? 'success' : 'error'}`}>{status}</div>}
        <div className="form-actions session-modal-actions"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!selected} onClick={submit}>{action === 'exit' ? 'Complete Exit' : 'Process Payment'}</button></div>
      </div>
    </div>
  </div>;
}