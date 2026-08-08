/**
 * Statistics.tsx — Parking Statistics Page
 *
 * This page aggregates and parses database entry, transaction, and capacity
 * logs to render administrative business intelligence charts. It displays:
 *
 * 1. **Daily Vehicle Entries** — Bar chart displaying daily traffic.
 * 2. **Hourly Parking Occupancy** — Hourly peak load visualizer.
 * 3. **Vehicle Type Distribution** — SVG Donut chart displaying vehicle category ratios (Cars vs Motorcycles).
 * 4. **Revenue by Day** — Bar chart of financial receipts.
 * 5. **Peak Parking Hours** — Highlight card identifying peak slots.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Statistics — Reporting statistics component.
 *
 * State:
 * - `dailyEntries`: Entry count mapped to day labels.
 * - `hourlyOccupancy`: Entry count mapped to hour slots.
 * - `vehicleTypes`: Count of cars vs motorcycles.
 * - `revenueByDay`: Income totals mapped to weekday names.
 *
 * @returns Statistics page markup.
 */
export function Statistics() {
  const [dailyEntries, setDailyEntries] = useState<{ label: string; value: number }[]>([]);
  const [hourlyOccupancy, setHourlyOccupancy] = useState<{ label: string; value: number }[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<{ car: number; motorcycle: number }>({ car: 0, motorcycle: 0 });
  const [revenueByDay, setRevenueByDay] = useState<{ label: string; value: number }[]>([]);

  /** Fetch plate recognition logs and financial transaction rows on mount to build graphs */
  useEffect(() => {
    // 1. Fetch plate recognition events (last 100 entries)
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(100).then(({ data }) => {
      const recs = data || [];
      const days: Record<string, number> = {};
      const hours: Record<string, number> = {};
      const types = { car: 0, motorcycle: 0 };

      // Process raw data records
      recs.forEach(r => {
        const d = new Date(r.created_at);
        const day = d.toLocaleDateString('en-US', { weekday: 'short' });
        days[day] = (days[day] || 0) + 1;

        const h = d.getHours();
        hours[`${h}:00`] = (hours[`${h}:00`] || 0) + 1;

        if (r.vehicle_type === 'car') types.car++;
        if (r.vehicle_type === 'motorcycle') types.motorcycle++;
      });

      // Construct ordered weekday data series
      const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      setDailyEntries(dayOrder.map(d => ({ label: d, value: days[d] || 0 })));

      // Construct sorted hourly data series
      const sortedHours = Object.entries(hours).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
      setHourlyOccupancy(sortedHours.map(([label, value]) => ({ label, value })));
      setVehicleTypes(types);
    });

    // 2. Fetch payments (last 50 rows) for income charts
    supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => {
      const pays = data || [];
      const rev: Record<string, number> = {};

      pays.forEach(p => {
        const d = new Date(p.created_at).toLocaleDateString('en-US', { weekday: 'short' });
        rev[d] = (rev[d] || 0) + parseFloat(p.total_amount);
      });

      const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      setRevenueByDay(dayOrder.map(d => ({ label: d, value: rev[d] || 0 })));
    });
  }, []);

  // Compute maximum values to scale custom CSS bar chart heights proportionally
  const maxValue = Math.max(...dailyEntries.map(d => d.value), 1);
  const maxHourly = Math.max(...hourlyOccupancy.map(d => d.value), 1);
  const maxRevenue = Math.max(...revenueByDay.map(d => d.value), 1);
  
  const totalVehicles = vehicleTypes.car + vehicleTypes.motorcycle || 1;
  const peakHours = hourlyOccupancy.filter(h => h.value === maxHourly).map(h => h.label);

  return (
    <div className="stats-page">
      <div className="stats-grid">
        {/* Daily entries chart */}
        <div className="chart-card">
          <div className="chart-title">Daily Vehicle Entries</div>
          <div className="bar-chart">
            {dailyEntries.map(d => (
              <div key={d.label} className="bar-col">
                <div className="bar" style={{ height: `${(d.value / maxValue) * 100}%`, background: 'var(--cursor-blue)' }} />
                <span className="bar-label">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Hourly occupancy chart */}
        <div className="chart-card">
          <div className="chart-title">Hourly Parking Occupancy</div>
          <div className="bar-chart">
            {hourlyOccupancy.slice(0, 12).map(h => (
              <div key={h.label} className="bar-col">
                <div className="bar" style={{ height: `${(h.value / maxHourly) * 100}%`, background: 'var(--cursor-cyan)' }} />
                <span className="bar-label">{h.label}</span>
              </div>
            ))}
            {hourlyOccupancy.length === 0 && <div className="empty-state">No data</div>}
          </div>
        </div>

        {/* Category donut distribution chart */}
        <div className="chart-card">
          <div className="chart-title">Vehicle Type Distribution</div>
          <div className="donut-container">
            <div className="donut">
              <div className="donut-inner">
                <span className="donut-total">{totalVehicles}</span>
                <span className="donut-label">Total</span>
              </div>
              <svg viewBox="0 0 42 42" className="donut-svg">
                <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--cursor-border)" strokeWidth="6" />
                <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--cursor-blue)" strokeWidth="6"
                  strokeDasharray={`${(vehicleTypes.car / totalVehicles) * 100} 100`} strokeDashoffset="25" transform="rotate(-90 21 21)" />
                <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--cursor-orange)" strokeWidth="6"
                  strokeDasharray={`${(vehicleTypes.motorcycle / totalVehicles) * 100} 100`} strokeDashoffset={`${25 - (vehicleTypes.car / totalVehicles) * 100}`} transform="rotate(-90 21 21)" />
              </svg>
            </div>
            <div className="donut-legend">
              <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--cursor-blue)' }} />Cars ({vehicleTypes.car})</div>
              <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--cursor-orange)' }} />Motorcycles ({vehicleTypes.motorcycle})</div>
            </div>
          </div>
        </div>

        {/* Weekly revenue chart */}
        <div className="chart-card">
          <div className="chart-title">Revenue by Day</div>
          <div className="bar-chart">
            {revenueByDay.map(d => (
              <div key={d.label} className="bar-col">
                <div className="bar" style={{ height: `${(d.value / maxRevenue) * 100}%`, background: 'var(--cursor-green)' }} />
                <span className="bar-label">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Peak hours analytics card */}
        <div className="chart-card stat-highlight">
          <div className="chart-title">Peak Parking Hours</div>
          <div className="peak-list">
            {peakHours.length > 0 ? peakHours.map(h => (
              <div key={h} className="peak-item"><span className="peak-time">{h}</span><span className="peak-count">{maxHourly} vehicles</span></div>
            )) : <div className="empty-state">No data</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
