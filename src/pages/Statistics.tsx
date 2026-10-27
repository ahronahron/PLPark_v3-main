/**
 * Statistics.tsx — Enterprise-Grade Statistics & Analytics Page for PLPark
 *
 * Operational intelligence dashboard featuring:
 * 1. Single Unified Top Filter Bar: Date/time range pickers, presets, aggregation interval,
 *    multi-dimensional filter drawer (Concept, Vehicle, Payment, Status, Gate, Plate Search),
 *    active filter chips, and live sync controls.
 * 2. 4 Executive KPI Cards: Total Revenue, Vehicle Volume, Average Dwell Time, Peak Occupancy.
 * 3. Tabbed Analytics Views:
 *    - Tab 1: Revenue & Traffic (Financial & volume trends, specific inspection, interval breakdown table).
 *    - Tab 2: Peak Hours & Demand (Adjustable by Day of Week, Gate Direction, Rush Windows, hourly audit table).
 *    - Tab 3: Duration & Turnaround (15m/30m/1h/standard steps, min dwell threshold, turnaround dynamics).
 *    - Tab 4: Audience & Fleet (Volume, Revenue ₱, and Hours metrics, Concept filtering, cross-matrix table).
 *    - Tab 5: All Views (Combined executive dashboard layout).
 * 4. Creative & Detailed Multi-Tab Excel (.xlsx) Report Export with clean headings, subheadings,
 *    native formatting, row heights, and auto-adjusted column widths.
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  CarFront,
  Clock3,
  DollarSign,
  Download,
  FileSpreadsheet,
  Filter,
  Gauge,
  Layers,
  PieChart,
  RefreshCw,
  RotateCcw,
  Search,
  Table,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { VehicleType, ConceptType, PaymentMethod, PaymentStatus, Direction } from '@/lib/supabase';

// ============================================================
// CONSTANTS & FORMATTERS
// ============================================================

const PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;

const currencyFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFmt = new Intl.NumberFormat('en-PH');

const percentFmt = new Intl.NumberFormat('en-PH', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// ============================================================
// TYPE DEFINITIONS
// ============================================================

type DatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'custom';
type AggInterval = 'hourly' | 'daily' | 'weekly' | 'monthly';
type ConceptFilter = 'all' | 'A' | 'B';
type VehicleFilter = 'all' | 'car' | 'motorcycle' | 'bus' | 'truck' | 'van';
type PayMethodFilter = 'all' | 'cash' | 'gcash' | 'card' | 'wallet';
type PayStatusFilter = 'all' | 'completed' | 'pending' | 'refunded';
type GateFilter = 'all' | 'entrance' | 'exit';

type TabView = 'revenue' | 'peak' | 'duration' | 'audience' | 'all';

// Duration filters
type DurationGranularity = '15m' | '30m' | '1h' | 'standard';
type TimeOfDayFilter = 'all' | 'morning' | 'afternoon' | 'evening' | 'night';

// Peak Hours filters
type PeakDayFilter = 'all' | 'weekdays' | 'weekends' | '0' | '1' | '2' | '3' | '4' | '5' | '6';
type PeakGateFilter = 'both' | 'entry' | 'exit';
type PeakWindowFilter = '24h' | 'operating' | 'morning' | 'evening';

// Audience & Fleet filters
type SegmentMetric = 'volume' | 'revenue' | 'duration';
type SegmentConceptFilter = 'all' | 'A' | 'B';

interface SessionRow {
  id: string;
  plate_number: string;
  vehicle_type: VehicleType;
  concept: ConceptType;
  entry_time: string;
  exit_time: string | null;
  status: string;
  app_user_id: string | null;
}

interface PaymentRow {
  id: string;
  session_id: string | null;
  plate_number: string;
  total_amount: number;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  created_at: string;
  duration_hours: number;
  hourly_rate: number;
}

interface RecognitionRow {
  id: string;
  plate_number: string;
  vehicle_type: VehicleType | null;
  direction: Direction;
  confidence: number;
  camera_name: string | null;
  created_at: string;
}

interface GlobalFilters {
  preset: DatePreset;
  startDate: string; // YYYY-MM-DDTHH:mm
  endDate: string;   // YYYY-MM-DDTHH:mm
  interval: AggInterval;
  concept: ConceptFilter;
  vehicleType: VehicleFilter;
  payMethod: PayMethodFilter;
  payStatus: PayStatusFilter;
  gate: GateFilter;
  plateSearch: string;
}

interface ExportOptions {
  executiveSummary: boolean;
  revenueTraffic: boolean;
  peakHours: boolean;
  dwellTime: boolean;
  segmentation: boolean;
  sessionRecords: boolean;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalISODateTime(d: Date): string {
  return `${toLocalISODate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getPresetRange(preset: DatePreset): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfToday = new Date(today.getTime() + DAY_MS - 1);

  switch (preset) {
    case 'today':
      return { start: today, end: endOfToday };
    case 'yesterday': {
      const yd = new Date(today.getTime() - DAY_MS);
      return { start: yd, end: new Date(yd.getTime() + DAY_MS - 1) };
    }
    case 'last7':
      return { start: new Date(today.getTime() - 6 * DAY_MS), end: endOfToday };
    case 'last30':
      return { start: new Date(today.getTime() - 29 * DAY_MS), end: endOfToday };
    case 'thisMonth':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0), end: endOfToday };
    default:
      return { start: today, end: endOfToday };
  }
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}

function formatReadableDateTime(isoOrStr: string): string {
  const d = new Date(isoOrStr);
  if (Number.isNaN(d.getTime())) return isoOrStr;
  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Paginated Supabase fetch */
async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// ============================================================
// CHART COMPONENTS
// ============================================================

/** Generic Bar Chart rendered with pure CSS */
function BarChartSimple({
  data,
  barColor = 'var(--cursor-blue)',
  height = 200,
  formatTooltip,
  formatLabel,
  secondaryData,
  secondaryColor,
  selectedIndex,
  onSelectIndex,
}: {
  data: { label: string; value: number }[];
  barColor?: string;
  height?: number;
  formatTooltip?: (item: { label: string; value: number }, idx: number) => string;
  formatLabel?: (item: { label: string; value: number }) => string;
  secondaryData?: { label: string; value: number }[];
  secondaryColor?: string;
  selectedIndex?: number | null;
  onSelectIndex?: (idx: number) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const max2 = secondaryData ? Math.max(1, ...secondaryData.map((d) => d.value)) : 1;
  const barWidth = Math.max(8, Math.min(36, Math.floor(640 / Math.max(1, data.length)) - 4));

  return (
    <div className="stat-chart-bars" style={{ height, alignItems: 'flex-end' }}>
      {data.map((item, i) => {
        const h = Math.max(item.value ? 4 : 0, (item.value / max) * (height - 36));
        const s = secondaryData?.[i];
        const h2 = s ? Math.max(s.value ? 4 : 0, (s.value / max2) * (height - 36)) : 0;
        const isSelected = selectedIndex === i;

        return (
          <div
            key={`${item.label}-${i}`}
            className={`stat-chart-bar-col ${isSelected ? 'selected' : ''}`}
            title={formatTooltip ? formatTooltip(item, i) : `${item.label}: ${numberFmt.format(item.value)}`}
            onClick={() => onSelectIndex?.(i)}
            style={{ cursor: onSelectIndex ? 'pointer' : 'default' }}
          >
            <div className="stat-chart-bar-group">
              {secondaryData && (
                <div
                  className="stat-chart-bar-fill stat-chart-bar-secondary"
                  style={{
                    height: h2,
                    width: barWidth / 2,
                    background: secondaryColor || '#94a3b8',
                    opacity: isSelected ? 1 : 0.85,
                  }}
                />
              )}
              <div
                className="stat-chart-bar-fill"
                style={{
                  height: h,
                  width: secondaryData ? barWidth / 2 : barWidth,
                  background: barColor,
                  boxShadow: isSelected ? '0 0 8px rgba(37,99,235,0.5)' : undefined,
                }}
              />
            </div>
            <span className="stat-chart-bar-lbl">{formatLabel ? formatLabel(item) : item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Donut Chart rendered with conic-gradient */
function DonutChart({
  segments,
  size = 150,
  label,
  valueFormatter = (val) => numberFmt.format(val),
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  label?: string;
  valueFormatter?: (val: number) => string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div className="stat-empty-chart">No data recorded</div>;

  let acc = 0;
  const stops = segments
    .map((seg) => {
      const start = acc;
      acc += (seg.value / total) * 360;
      return `${seg.color} ${start}deg ${acc}deg`;
    })
    .join(', ');

  return (
    <div className="stat-donut-wrap">
      <div
        className="stat-donut"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(${stops})`,
        }}
      >
        <div className="stat-donut-hole">
          {label && <span className="stat-donut-label">{label}</span>}
          <strong className="stat-donut-total">{valueFormatter(total)}</strong>
        </div>
      </div>
      <div className="stat-donut-legend">
        {segments.map((seg) => (
          <div key={seg.label} className="stat-donut-legend-item">
            <span className="stat-donut-dot" style={{ background: seg.color }} />
            <span className="stat-donut-legend-text">{seg.label}</span>
            <strong>{valueFormatter(seg.value)}</strong>
            <small>{percentFmt.format(seg.value / total)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// CLEAN, CREATIVE & DETAILED EXCEL EXPORT (Professional Layout)
// ============================================================

async function exportCustomExcel(
  filters: GlobalFilters,
  kpis: {
    totalRevenue: number;
    totalVolume: number;
    avgDwellMinutes: number;
    peakOccupancy: number;
  },
  timeSeriesData: { label: string; revenue: number; sessions: number; entries: number; exits: number }[],
  peakHoursDetailed: {
    hourLabel: string;
    entries: number;
    exits: number;
    total: number;
    shareOfTotal: number;
    flowType: string;
    isPeak: boolean;
  }[],
  dwellData: { label: string; count: number; percentage: number; totalMinutes: number; revenueEst: number }[],
  audienceDetailed: {
    concept: string;
    sessions: number;
    volumeShare: number;
    revenue: number;
    revenueShare: number;
    avgFee: number;
    avgDwell: number;
  }[],
  fleetDetailed: {
    type: string;
    sessions: number;
    volumeShare: number;
    revenue: number;
    revenueShare: number;
    avgFee: number;
    avgDwell: number;
  }[],
  sessions: SessionRow[],
  payments: PaymentRow[],
  options: ExportOptions,
) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const formattedStart = formatReadableDateTime(filters.startDate);
  const formattedEnd = formatReadableDateTime(filters.endDate);
  const nowFormatted = formatReadableDateTime(new Date().toISOString());

  const autoColWidths = (rows: (string | number | null | undefined)[][]) => {
    const colMax: number[] = [];
    rows.forEach((row) => {
      row.forEach((val, idx) => {
        const len = val != null ? String(val).length : 0;
        colMax[idx] = Math.max(colMax[idx] || 12, len + 4);
      });
    });
    return colMax.map((w) => ({ wch: Math.min(65, Math.max(14, w)) }));
  };

  const applyCellFormats = (ws: any, rowStart: number, colTypes: Record<number, string>) => {
    if (!ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = rowStart; R <= range.e.r; ++R) {
      for (const [colIdxStr, fmt] of Object.entries(colTypes)) {
        const C = Number(colIdxStr);
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
          ws[cellRef].z = fmt;
        }
      }
    }
  };

  // 1. EXECUTIVE SUMMARY SHEET
  if (options.executiveSummary) {
    const sumRows: (string | number)[][] = [
      ['═════════════════════════════════════════════════════════════════════════════════'],
      ['  PLPARK OPERATIONS INTELLIGENCE — EXECUTIVE PERFORMANCE REPORT'],
      ['═════════════════════════════════════════════════════════════════════════════════'],
      [],
      ['REPORT METADATA & SCOPE'],
      ['Generated On', nowFormatted],
      ['Date Range', `${formattedStart} to ${formattedEnd}`],
      ['Aggregation Interval', filters.interval.toUpperCase()],
      ['Concept Type Filter', filters.concept === 'all' ? 'All (Public Concept A & Registered Concept B)' : filters.concept === 'A' ? 'Public (Concept A)' : 'Registered (Concept B)'],
      ['Vehicle Type Filter', filters.vehicleType === 'all' ? 'All Vehicle Types' : filters.vehicleType.toUpperCase()],
      ['Payment Method Filter', filters.payMethod === 'all' ? 'All Payment Methods' : filters.payMethod.toUpperCase()],
      ['Payment Status Filter', filters.payStatus === 'all' ? 'All Statuses' : filters.payStatus.toUpperCase()],
      ['Plate Search Filter', filters.plateSearch || 'None (All Plates)'],
      [],
      ['KEY PERFORMANCE INDICATORS (KPIS)'],
      ['Metric', 'Value', 'Unit / Benchmark'],
      ['Total Parking Revenue', kpis.totalRevenue, 'PHP (Completed Payments)'],
      ['Total Parking Volume', kpis.totalVolume, 'Unique Vehicle Sessions'],
      ['Average Dwell Duration', formatDuration(kpis.avgDwellMinutes), 'Turnaround Time'],
      ['Peak Capacity Occupancy', +(kpis.peakOccupancy * 100).toFixed(1), '% of Total Slots'],
      [],
      ['OPERATIONAL SUMMARY HIGHLIGHTS'],
      ['Top Revenue Vehicle Class', fleetDetailed.reduce((top, f) => (f.revenue > top.revenue ? f : top), fleetDetailed[0])?.type.toUpperCase() || '—'],
      ['Registered Driver Adoption Rate', `${(audienceDetailed.find((a) => a.concept.includes('Registered'))?.volumeShare ?? 0 * 100).toFixed(1)}%`],
      ['Total Gate Inflow Events', peakHoursDetailed.reduce((s, h) => s + h.entries, 0)],
      ['Total Gate Outflow Events', peakHoursDetailed.reduce((s, h) => s + h.exits, 0)],
      [],
      ['═════════════════════════════════════════════════════════════════════════════════'],
      ['  PLPark Automated Operations System • Confidential Analytics Data'],
      ['═════════════════════════════════════════════════════════════════════════════════'],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sumRows);
    ws['!cols'] = autoColWidths(sumRows);
    ws['!rows'] = [{ hpt: 18 }, { hpt: 26 }, { hpt: 18 }];
    applyCellFormats(ws, 15, { 1: '"₱"#,##0.00' });
    XLSX.utils.book_append_sheet(wb, ws, 'Executive Summary');
  }

  // 2. REVENUE & TRAFFIC TIME-SERIES SHEET
  if (options.revenueTraffic) {
    const totalRev = timeSeriesData.reduce((s, r) => s + r.revenue, 0);
    const totalSess = timeSeriesData.reduce((s, r) => s + r.sessions, 0);
    const totalEnt = timeSeriesData.reduce((s, r) => s + r.entries, 0);
    const totalEx = timeSeriesData.reduce((s, r) => s + r.exits, 0);

    let runningRev = 0;
    const rtRows: (string | number)[][] = [
      ['═════════════════════════════════════════════════════════════════════════════════════════════════════'],
      ['  FINANCIAL & TRAFFIC TIME-SERIES BREAKDOWN'],
      ['  Date Range: ' + formattedStart + ' to ' + formattedEnd],
      ['═════════════════════════════════════════════════════════════════════════════════════════════════════'],
      [],
      ['PERIOD', 'REVENUE (PHP)', 'CUMULATIVE (PHP)', 'TOTAL SESSIONS', 'GATE ENTRIES', 'GATE EXITS', 'NET FLOW', 'AVG / SESSION (PHP)', 'SHARE OF REVENUE (%)'],
      ...timeSeriesData.map((d) => {
        runningRev += d.revenue;
        return [
          d.label,
          d.revenue,
          runningRev,
          d.sessions,
          d.entries,
          d.exits,
          d.entries - d.exits,
          d.sessions > 0 ? +(d.revenue / d.sessions).toFixed(2) : 0,
          totalRev > 0 ? +(d.revenue / totalRev).toFixed(4) : 0,
        ];
      }),
      [],
      ['SUMMARY TOTAL', totalRev, runningRev, totalSess, totalEnt, totalEx, totalEnt - totalEx, totalSess > 0 ? +(totalRev / totalSess).toFixed(2) : 0, 1.0],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rtRows);
    ws['!cols'] = autoColWidths(rtRows);
    ws['!rows'] = [{ hpt: 16 }, { hpt: 24 }, { hpt: 18 }];
    applyCellFormats(ws, 6, {
      1: '"₱"#,##0.00',
      2: '"₱"#,##0.00',
      3: '#,##0',
      4: '#,##0',
      5: '#,##0',
      6: '#,##0',
      7: '"₱"#,##0.00',
      8: '0.0%',
    });
    XLSX.utils.book_append_sheet(wb, ws, 'Revenue & Traffic');
  }

  // 3. PEAK HOURS & HOURLY LOAD DISTRIBUTION SHEET
  if (options.peakHours) {
    const totalEvents = peakHoursDetailed.reduce((s, h) => s + h.total, 0);
    const phRows: (string | number)[][] = [
      ['═════════════════════════════════════════════════════════════════════════════════════'],
      ['  24-HOUR PEAK HOURS & GATE TRAFFIC LOAD DISTRIBUTION'],
      ['  Facility Operating Window: 24 Hours • Total Gate Events: ' + totalEvents],
      ['═════════════════════════════════════════════════════════════════════════════════════'],
      [],
      ['HOUR (24H)', 'GATE ENTRIES', 'GATE EXITS', 'TOTAL GATE EVENTS', 'TRAFFIC SHARE (%)', 'FLOW DYNAMICS', 'STATUS'],
      ...peakHoursDetailed.map((h) => [
        h.hourLabel,
        h.entries,
        h.exits,
        h.total,
        h.shareOfTotal,
        h.flowType,
        h.isPeak ? '★ PEAK HOUR' : 'Normal',
      ]),
      [],
      ['TOTAL GATE ACTIVITY', peakHoursDetailed.reduce((s, h) => s + h.entries, 0), peakHoursDetailed.reduce((s, h) => s + h.exits, 0), totalEvents, 1.0, '—', '—'],
    ];

    const ws = XLSX.utils.aoa_to_sheet(phRows);
    ws['!cols'] = autoColWidths(phRows);
    ws['!rows'] = [{ hpt: 16 }, { hpt: 24 }, { hpt: 18 }];
    applyCellFormats(ws, 6, { 1: '#,##0', 2: '#,##0', 3: '#,##0', 4: '0.0%' });
    XLSX.utils.book_append_sheet(wb, ws, 'Peak Hours');
  }

  // 4. DURATION & TURNAROUND ANALYSIS SHEET
  if (options.dwellTime) {
    const totalDwellSessions = dwellData.reduce((s, b) => s + b.count, 0);
    const totalDwellHours = dwellData.reduce((s, b) => s + b.totalMinutes, 0) / 60;
    const totalEstRev = dwellData.reduce((s, b) => s + b.revenueEst, 0);

    const dtRows: (string | number)[][] = [
      ['═══════════════════════════════════════════════════════════════════════════════════════════'],
      ['  VEHICLE DWELL TIME & TURNAROUND DYNAMICS'],
      ['  Average Facility Dwell Time: ' + formatDuration(kpis.avgDwellMinutes) + ' • Total Hours Parked: ' + totalDwellHours.toFixed(1) + ' hrs'],
      ['═══════════════════════════════════════════════════════════════════════════════════════════'],
      [],
      ['DURATION BRACKET', 'VEHICLE SESSIONS', 'VOLUME SHARE (%)', 'TOTAL HOURS PARKED', 'TOTAL REVENUE (PHP)', 'AVG FEE / VEHICLE (PHP)'],
      ...dwellData.map((b) => [
        b.label,
        b.count,
        b.percentage,
        +(b.totalMinutes / 60).toFixed(1),
        b.revenueEst,
        b.count > 0 ? +(b.revenueEst / b.count).toFixed(2) : 0,
      ]),
      [],
      ['TOTAL ANALYZED', totalDwellSessions, 1.0, +totalDwellHours.toFixed(1), totalEstRev, totalDwellSessions > 0 ? +(totalEstRev / totalDwellSessions).toFixed(2) : 0],
    ];

    const ws = XLSX.utils.aoa_to_sheet(dtRows);
    ws['!cols'] = autoColWidths(dtRows);
    ws['!rows'] = [{ hpt: 16 }, { hpt: 24 }, { hpt: 18 }];
    applyCellFormats(ws, 6, { 1: '#,##0', 2: '0.0%', 3: '#,##0.0', 4: '"₱"#,##0.00', 5: '"₱"#,##0.00' });
    XLSX.utils.book_append_sheet(wb, ws, 'Duration Analysis');
  }

  // 5. AUDIENCE & FLEET INTELLIGENCE SHEET
  if (options.segmentation) {
    const segRows: (string | number)[][] = [
      ['═══════════════════════════════════════════════════════════════════════════════════════════════════'],
      ['  AUDIENCE (CONCEPT TYPE) & VEHICLE FLEET INTELLIGENCE'],
      ['═══════════════════════════════════════════════════════════════════════════════════════════════════'],
      [],
      ['1.0 AUDIENCE SEGMENTATION (CONCEPT A VS CONCEPT B)'],
      ['CONCEPT TYPE', 'SESSIONS', 'VOLUME SHARE (%)', 'TOTAL REVENUE (PHP)', 'REVENUE SHARE (%)', 'AVG TICKET (PHP)', 'AVG DWELL DURATION'],
      ...audienceDetailed.map((a) => [
        a.concept,
        a.sessions,
        a.volumeShare,
        a.revenue,
        a.revenueShare,
        a.avgFee,
        formatDuration(a.avgDwell),
      ]),
      [],
      ['2.0 VEHICLE FLEET CLASSIFICATION BREAKDOWN'],
      ['VEHICLE TYPE', 'SESSIONS', 'VOLUME SHARE (%)', 'TOTAL REVENUE (PHP)', 'REVENUE SHARE (%)', 'AVG TICKET (PHP)', 'AVG DWELL DURATION'],
      ...fleetDetailed.map((f) => [
        f.type.toUpperCase(),
        f.sessions,
        f.volumeShare,
        f.revenue,
        f.revenueShare,
        f.avgFee,
        formatDuration(f.avgDwell),
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(segRows);
    ws['!cols'] = autoColWidths(segRows);
    ws['!rows'] = [{ hpt: 16 }, { hpt: 24 }, { hpt: 18 }];
    applyCellFormats(ws, 6, { 1: '#,##0', 2: '0.0%', 3: '"₱"#,##0.00', 4: '0.0%', 5: '"₱"#,##0.00' });
    XLSX.utils.book_append_sheet(wb, ws, 'Audience & Fleet');
  }

  // 6. FILTERED SESSIONS AUDIT LOG SHEET
  if (options.sessionRecords) {
    const paymentMap = new Map<string, PaymentRow>();
    payments.forEach((p) => {
      if (p.session_id) paymentMap.set(p.session_id, p);
    });

    const sessRows: (string | number)[][] = [
      ['═════════════════════════════════════════════════════════════════════════════════════════════════════════'],
      ['  PARKING SESSIONS AUDIT LOG (FILTERED RANGE)'],
      ['  Exported Range: ' + formattedStart + ' to ' + formattedEnd + ' • Total Sessions: ' + sessions.length],
      ['═════════════════════════════════════════════════════════════════════════════════════════════════════════'],
      [],
      ['SESSION ID', 'PLATE NUMBER', 'USER CONCEPT', 'VEHICLE TYPE', 'ENTRY TIMESTAMP', 'EXIT TIMESTAMP', 'DURATION (MINS)', 'FEE (PHP)', 'PAYMENT METHOD', 'PAYMENT STATUS'],
      ...sessions.map((s) => {
        const p = paymentMap.get(s.id);
        const mins = s.exit_time ? Math.round((new Date(s.exit_time).getTime() - new Date(s.entry_time).getTime()) / 60_000) : '';
        return [
          s.id,
          s.plate_number,
          s.concept === 'B' || s.app_user_id ? 'Registered (Concept B)' : 'Public (Concept A)',
          s.vehicle_type ? s.vehicle_type.toUpperCase() : 'UNKNOWN',
          formatReadableDateTime(s.entry_time),
          s.exit_time ? formatReadableDateTime(s.exit_time) : 'Active / Parked',
          mins,
          p ? Number(p.total_amount) || 0 : 0,
          p?.payment_method ? p.payment_method.toUpperCase() : '—',
          p?.status ? p.status.toUpperCase() : (s.status === 'active' ? 'ACTIVE' : '—'),
        ];
      }),
    ];

    const ws = XLSX.utils.aoa_to_sheet(sessRows);
    ws['!cols'] = autoColWidths(sessRows);
    ws['!rows'] = [{ hpt: 16 }, { hpt: 24 }, { hpt: 18 }];
    applyCellFormats(ws, 6, { 6: '#,##0', 7: '"₱"#,##0.00' });
    XLSX.utils.book_append_sheet(wb, ws, 'Sessions Audit Log');
  }

  const filename = `PLPark_Analytics_${toLocalISODate(new Date(filters.startDate))}_to_${toLocalISODate(new Date(filters.endDate))}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function Statistics() {
  // -------- Single Unified Global Filter State --------
  const defaultRange = getPresetRange('last30');
  const [filters, setFilters] = useState<GlobalFilters>({
    preset: 'last30',
    startDate: toLocalISODateTime(defaultRange.start),
    endDate: toLocalISODateTime(defaultRange.end),
    interval: 'daily',
    concept: 'all',
    vehicleType: 'all',
    payMethod: 'all',
    payStatus: 'all',
    gate: 'all',
    plateSearch: '',
  });

  // -------- Tab Navigation State --------
  const [activeTab, setActiveTab] = useState<TabView>('revenue');

  // -------- Data State --------
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [recognitions, setRecognitions] = useState<RecognitionRow[]>([]);
  const [totalCapacity, setTotalCapacity] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // -------- Filter Bar UI State --------
  const [showFilters, setShowFilters] = useState(false);

  // -------- Revenue & Traffic Card State --------
  const [rtViewMode, setRtViewMode] = useState<'both' | 'revenue' | 'volume'>('both');
  const [rtSelectedIntervalIdx, setRtSelectedIntervalIdx] = useState<number | null>(null);
  const [showRtTable, setShowRtTable] = useState(false);

  // -------- Duration Analysis Card State --------
  const [durationGranularity, setDurationGranularity] = useState<DurationGranularity>('30m');
  const [durationMinMins, setDurationMinMins] = useState<number>(0);
  const [durationMaxMins, setDurationMaxMins] = useState<number>(1440);
  const [durationTimeOfDay, setDurationTimeOfDay] = useState<TimeOfDayFilter>('all');
  const [selectedDurationBucket, setSelectedDurationBucket] = useState<string | null>(null);

  // -------- Peak Hours Distribution Card State --------
  const [peakDayFilter, setPeakDayFilter] = useState<PeakDayFilter>('all');
  const [peakGateFilter, setPeakGateFilter] = useState<PeakGateFilter>('both');
  const [peakWindowFilter, setPeakWindowFilter] = useState<PeakWindowFilter>('24h');
  const [showPeakTable, setShowPeakTable] = useState(false);
  const [selectedPeakHour, setSelectedPeakHour] = useState<number | null>(null);

  // -------- Audience & Fleet Card State --------
  const [segmentMetric, setSegmentMetric] = useState<SegmentMetric>('volume');
  const [segmentConceptFilter, setSegmentConceptFilter] = useState<SegmentConceptFilter>('all');
  const [showSegmentTable, setShowSegmentTable] = useState(false);

  // -------- Previous Period Revenue for Comparison --------
  const [prevRevenue, setPrevRevenue] = useState<number | null>(null);

  // -------- Export Modal State --------
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    executiveSummary: true,
    revenueTraffic: true,
    peakHours: true,
    dwellTime: true,
    segmentation: true,
    sessionRecords: false,
  });

  // -------- Filter Update Helper --------
  const updateFilter = useCallback(<K extends keyof GlobalFilters>(key: K, value: GlobalFilters[K]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'preset' && value !== 'custom') {
        const range = getPresetRange(value as DatePreset);
        next.startDate = toLocalISODateTime(range.start);
        next.endDate = toLocalISODateTime(range.end);
      }
      if (key === 'startDate' || key === 'endDate') {
        next.preset = 'custom';
      }
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    const range = getPresetRange('last30');
    setFilters({
      preset: 'last30',
      startDate: toLocalISODateTime(range.start),
      endDate: toLocalISODateTime(range.end),
      interval: 'daily',
      concept: 'all',
      vehicleType: 'all',
      payMethod: 'all',
      payStatus: 'all',
      gate: 'all',
      plateSearch: '',
    });
    setRtSelectedIntervalIdx(null);
  }, []);

  // ============================================================
  // DATA FETCHING
  // ============================================================

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const startISO = new Date(filters.startDate).toISOString();
        const endISO = new Date(filters.endDate).toISOString();

        // Previous comparison window
        const startMs = new Date(filters.startDate).getTime();
        const endMs = new Date(filters.endDate).getTime();
        const periodMs = Math.max(DAY_MS, endMs - startMs);
        const prevStartISO = new Date(startMs - periodMs).toISOString();

        const [sessionsData, paymentsData, recognitionsData, prevPaymentsData, slotsData] = await Promise.all([
          fetchAllPages<SessionRow>((from, to) =>
            supabase
              .from('parking_sessions')
              .select('id,plate_number,vehicle_type,concept,entry_time,exit_time,status,app_user_id')
              .gte('entry_time', startISO)
              .lte('entry_time', endISO)
              .order('entry_time', { ascending: true })
              .range(from, to),
          ),
          fetchAllPages<PaymentRow>((from, to) =>
            supabase
              .from('payments')
              .select('id,session_id,plate_number,total_amount,payment_method,status,created_at,duration_hours,hourly_rate')
              .gte('created_at', startISO)
              .lte('created_at', endISO)
              .order('created_at', { ascending: true })
              .range(from, to),
          ),
          fetchAllPages<RecognitionRow>((from, to) =>
            supabase
              .from('plate_recognitions')
              .select('id,plate_number,vehicle_type,direction,confidence,camera_name,created_at')
              .gte('created_at', startISO)
              .lte('created_at', endISO)
              .order('created_at', { ascending: true })
              .range(from, to),
          ),
          fetchAllPages<{ total_amount: number; status: string }>((from, to) =>
            supabase
              .from('payments')
              .select('total_amount,status')
              .gte('created_at', prevStartISO)
              .lt('created_at', startISO)
              .range(from, to),
          ),
          supabase.from('parking_slots').select('id', { count: 'exact', head: true }),
        ]);

        if (!active) return;

        setSessions(sessionsData);
        setPayments(paymentsData);
        setRecognitions(recognitionsData);

        const prevRev = prevPaymentsData
          .filter((p) => p.status === 'completed')
          .reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
        setPrevRevenue(prevRev);

        setTotalCapacity(slotsData.count ?? 50);
        setUpdatedAt(new Date());
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load statistics data.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [filters.startDate, filters.endDate, refreshKey]);

  // ============================================================
  // FILTERED DATASETS
  // ============================================================

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filters.concept !== 'all' && s.concept !== filters.concept) return false;
      if (filters.vehicleType !== 'all' && s.vehicle_type !== filters.vehicleType) return false;
      if (filters.plateSearch) {
        const search = filters.plateSearch.toUpperCase().replace(/\s/g, '');
        if (!s.plate_number.toUpperCase().replace(/\s/g, '').includes(search)) return false;
      }
      return true;
    });
  }, [sessions, filters.concept, filters.vehicleType, filters.plateSearch]);

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      if (filters.payMethod !== 'all' && p.payment_method !== filters.payMethod) return false;
      if (filters.payStatus !== 'all' && p.status !== filters.payStatus) return false;
      if (filters.plateSearch) {
        const search = filters.plateSearch.toUpperCase().replace(/\s/g, '');
        if (!p.plate_number.toUpperCase().replace(/\s/g, '').includes(search)) return false;
      }
      return true;
    });
  }, [payments, filters.payMethod, filters.payStatus, filters.plateSearch]);

  const filteredRecognitions = useMemo(() => {
    return recognitions.filter((r) => {
      if (filters.gate === 'entrance' && r.direction !== 'entry') return false;
      if (filters.gate === 'exit' && r.direction !== 'exit') return false;
      if (filters.vehicleType !== 'all' && r.vehicle_type !== filters.vehicleType) return false;
      if (filters.plateSearch) {
        const search = filters.plateSearch.toUpperCase().replace(/\s/g, '');
        if (!r.plate_number.toUpperCase().replace(/\s/g, '').includes(search)) return false;
      }
      return true;
    });
  }, [recognitions, filters.gate, filters.vehicleType, filters.plateSearch]);

  const paymentBySessionId = useMemo(() => {
    const map = new Map<string, PaymentRow>();
    filteredPayments.forEach((p) => {
      if (p.session_id) map.set(p.session_id, p);
    });
    return map;
  }, [filteredPayments]);

  // -------- KPI Calculations --------
  const kpis = useMemo(() => {
    const completedPayments = filteredPayments.filter((p) => p.status === 'completed');
    const totalRevenue = completedPayments.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
    const totalVolume = filteredSessions.length;

    const completedSessions = filteredSessions.filter((s) => s.exit_time);
    const durations = completedSessions
      .map((s) => (new Date(s.exit_time!).getTime() - new Date(s.entry_time).getTime()) / 60_000)
      .filter((d) => Number.isFinite(d) && d > 0);
    const avgDwellMinutes = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const activeSessions = filteredSessions.filter((s) => s.status === 'active').length;
    const peakOccupancy = totalCapacity > 0 ? Math.min(1, activeSessions / totalCapacity) : 0;

    const revenueChange = prevRevenue != null && prevRevenue > 0
      ? ((totalRevenue - prevRevenue) / prevRevenue)
      : null;

    return {
      totalRevenue,
      revenueChange,
      totalVolume,
      avgDwellMinutes,
      peakOccupancy,
    };
  }, [filteredSessions, filteredPayments, totalCapacity, prevRevenue]);

  // ============================================================
  // REVENUE & TRAFFIC TIME-SERIES (Unified Filter)
  // ============================================================

  const rtTimeSeriesData = useMemo(() => {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

    const buckets: { label: string; revenue: number; sessions: number; entries: number; exits: number }[] = [];
    const interval = filters.interval;
    let cursor = new Date(start);

    while (cursor <= end) {
      let bucketEnd: Date;
      let label: string;

      if (interval === 'hourly') {
        bucketEnd = new Date(cursor.getTime() + 3_600_000);
        label = `${String(cursor.getHours()).padStart(2, '0')}:00 (${cursor.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })})`;
      } else if (interval === 'daily') {
        bucketEnd = new Date(cursor.getTime() + DAY_MS);
        label = cursor.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
      } else if (interval === 'weekly') {
        bucketEnd = new Date(cursor.getTime() + 7 * DAY_MS);
        label = `Wk ${cursor.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
      } else {
        bucketEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        label = cursor.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
      }

      const startTs = cursor.getTime();
      const endTs = bucketEnd.getTime();

      const rev = filteredPayments
        .filter((p) => p.status === 'completed' && new Date(p.created_at).getTime() >= startTs && new Date(p.created_at).getTime() < endTs)
        .reduce((s, p) => s + (Number(p.total_amount) || 0), 0);

      const sess = filteredSessions.filter((s) => {
        const t = new Date(s.entry_time).getTime();
        return t >= startTs && t < endTs;
      }).length;

      const ent = filteredRecognitions.filter((r) => {
        const t = new Date(r.created_at).getTime();
        return r.direction === 'entry' && t >= startTs && t < endTs;
      }).length;

      const ex = filteredRecognitions.filter((r) => {
        const t = new Date(r.created_at).getTime();
        return r.direction === 'exit' && t >= startTs && t < endTs;
      }).length;

      buckets.push({ label, revenue: rev, sessions: sess, entries: ent, exits: ex });
      cursor = bucketEnd;

      if (interval === 'hourly' && buckets.length > 200) break;
      if (buckets.length > 500) break;
    }

    return buckets;
  }, [filteredSessions, filteredPayments, filteredRecognitions, filters.startDate, filters.endDate, filters.interval]);

  const rtSummary = useMemo(() => {
    const totalRev = rtTimeSeriesData.reduce((s, b) => s + b.revenue, 0);
    const totalVol = rtTimeSeriesData.reduce((s, b) => s + b.sessions, 0);
    const avgRev = rtTimeSeriesData.length > 0 ? totalRev / rtTimeSeriesData.length : 0;
    const peakBucket = rtTimeSeriesData.reduce(
      (peak, b) => (b.revenue > peak.revenue ? b : peak),
      { label: '—', revenue: 0, sessions: 0, entries: 0, exits: 0 },
    );
    return { totalRev, totalVol, avgRev, peakBucket };
  }, [rtTimeSeriesData]);

  const activeRtInterval = useMemo(() => {
    if (rtSelectedIntervalIdx != null && rtTimeSeriesData[rtSelectedIntervalIdx]) {
      return rtTimeSeriesData[rtSelectedIntervalIdx];
    }
    return rtTimeSeriesData.length > 0 ? rtTimeSeriesData[rtTimeSeriesData.length - 1] : null;
  }, [rtSelectedIntervalIdx, rtTimeSeriesData]);

  // ============================================================
  // DURATION ANALYSIS (Turnaround Dynamics)
  // ============================================================

  const durationBuckets = useMemo(() => {
    let rawBuckets: { label: string; min: number; max: number }[] = [];

    if (durationGranularity === '15m') {
      rawBuckets = [
        { label: '0–15m (Grace)', min: 0, max: 15 },
        { label: '15–30m', min: 15, max: 30 },
        { label: '30–45m', min: 30, max: 45 },
        { label: '45–60m', min: 45, max: 60 },
        { label: '1h–2h', min: 60, max: 120 },
        { label: '2h–4h', min: 120, max: 240 },
        { label: '4h+', min: 240, max: Infinity },
      ];
    } else if (durationGranularity === '30m') {
      rawBuckets = [
        { label: '0–30m (Grace)', min: 0, max: 30 },
        { label: '30m–1h', min: 30, max: 60 },
        { label: '1h–1.5h', min: 60, max: 90 },
        { label: '1.5h–2h', min: 90, max: 120 },
        { label: '2h–3h', min: 120, max: 180 },
        { label: '3h–5h', min: 180, max: 300 },
        { label: '5h+', min: 300, max: Infinity },
      ];
    } else if (durationGranularity === '1h') {
      rawBuckets = [
        { label: '0–1h', min: 0, max: 60 },
        { label: '1h–2h', min: 60, max: 120 },
        { label: '2h–3h', min: 120, max: 180 },
        { label: '3h–4h', min: 180, max: 240 },
        { label: '4h–6h', min: 240, max: 360 },
        { label: '6h–8h', min: 360, max: 480 },
        { label: '8h+', min: 480, max: Infinity },
      ];
    } else {
      rawBuckets = [
        { label: '<30m (Quick)', min: 0, max: 30 },
        { label: '30m–2h (Short)', min: 30, max: 120 },
        { label: '2h–5h (Medium)', min: 120, max: 300 },
        { label: '5h–12h (Extended)', min: 300, max: 720 },
        { label: '12h+ (Overnight)', min: 720, max: Infinity },
      ];
    }

    const validSessions = filteredSessions.filter((s) => {
      if (!s.exit_time) return false;
      const mins = (new Date(s.exit_time).getTime() - new Date(s.entry_time).getTime()) / 60_000;
      if (!Number.isFinite(mins) || mins <= 0) return false;
      if (mins < durationMinMins || mins > durationMaxMins) return false;

      if (durationTimeOfDay !== 'all') {
        const hour = new Date(s.entry_time).getHours();
        if (durationTimeOfDay === 'morning' && (hour < 6 || hour >= 12)) return false;
        if (durationTimeOfDay === 'afternoon' && (hour < 12 || hour >= 18)) return false;
        if (durationTimeOfDay === 'evening' && (hour < 18 || hour >= 24)) return false;
        if (durationTimeOfDay === 'night' && hour >= 6) return false;
      }
      return true;
    });

    const totalValid = validSessions.length;
    const bucketCounts = rawBuckets.map((b) => ({
      ...b,
      count: 0,
      totalMinutes: 0,
      percentage: 0,
      revenueEst: 0,
    }));

    validSessions.forEach((s) => {
      const mins = (new Date(s.exit_time!).getTime() - new Date(s.entry_time).getTime()) / 60_000;
      const payment = paymentBySessionId.get(s.id);
      const fee = payment ? Number(payment.total_amount) || 0 : 0;

      for (const b of bucketCounts) {
        if (mins >= b.min && mins < b.max) {
          b.count++;
          b.totalMinutes += mins;
          b.revenueEst += fee;
          break;
        }
      }
    });

    bucketCounts.forEach((b) => {
      b.percentage = totalValid > 0 ? b.count / totalValid : 0;
    });

    return {
      buckets: bucketCounts,
      totalSessions: totalValid,
      avgMins: totalValid > 0 ? bucketCounts.reduce((s, b) => s + b.totalMinutes, 0) / totalValid : 0,
    };
  }, [filteredSessions, durationGranularity, durationMinMins, durationMaxMins, durationTimeOfDay, paymentBySessionId]);

  // ============================================================
  // PEAK HOURS DISTRIBUTION (Adjustable by Day, Gate & Window)
  // ============================================================

  const peakHoursDetailed = useMemo(() => {
    const matchingRecognitions = filteredRecognitions.filter((r) => {
      const d = new Date(r.created_at);
      const dayOfWeek = d.getDay();

      if (peakDayFilter === 'weekdays' && (dayOfWeek === 0 || dayOfWeek === 6)) return false;
      if (peakDayFilter === 'weekends' && dayOfWeek !== 0 && dayOfWeek !== 6) return false;
      if (peakDayFilter !== 'all' && peakDayFilter !== 'weekdays' && peakDayFilter !== 'weekends') {
        if (dayOfWeek !== Number(peakDayFilter)) return false;
      }

      if (peakGateFilter === 'entry' && r.direction !== 'entry') return false;
      if (peakGateFilter === 'exit' && r.direction !== 'exit') return false;

      return true;
    });

    const rawHours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      hourLabel: `${String(i).padStart(2, '0')}:00`,
      entries: 0,
      exits: 0,
      total: 0,
    }));

    matchingRecognitions.forEach((r) => {
      const h = new Date(r.created_at).getHours();
      if (r.direction === 'entry') rawHours[h].entries++;
      else rawHours[h].exits++;
      rawHours[h].total++;
    });

    let visibleHours = rawHours;
    if (peakWindowFilter === 'operating') {
      visibleHours = rawHours.filter((h) => h.hour >= 6 && h.hour <= 22);
    } else if (peakWindowFilter === 'morning') {
      visibleHours = rawHours.filter((h) => h.hour >= 6 && h.hour <= 12);
    } else if (peakWindowFilter === 'evening') {
      visibleHours = rawHours.filter((h) => h.hour >= 15 && h.hour <= 21);
    }

    const totalInView = visibleHours.reduce((s, h) => s + h.total, 0);
    const maxHourTotal = Math.max(1, ...visibleHours.map((h) => h.total));

    return visibleHours.map((h) => ({
      hour: h.hour,
      hourLabel: h.hourLabel,
      entries: h.entries,
      exits: h.exits,
      total: h.total,
      shareOfTotal: totalInView > 0 ? h.total / totalInView : 0,
      isPeak: h.total > 0 && h.total === maxHourTotal,
      flowType:
        h.entries > h.exits * 1.5 ? 'Inflow Heavy' : h.exits > h.entries * 1.5 ? 'Outflow Heavy' : 'Balanced Flow',
    }));
  }, [filteredRecognitions, peakDayFilter, peakGateFilter, peakWindowFilter]);

  const peakMorningHour = useMemo(() => {
    const morning = peakHoursDetailed.filter((h) => h.hour >= 6 && h.hour <= 12);
    return morning.reduce((p, h) => (h.total > p.total ? h : p), morning[0] || { hourLabel: '—', total: 0 });
  }, [peakHoursDetailed]);

  const peakEveningHour = useMemo(() => {
    const evening = peakHoursDetailed.filter((h) => h.hour >= 15 && h.hour <= 21);
    return evening.reduce((p, h) => (h.total > p.total ? h : p), evening[0] || { hourLabel: '—', total: 0 });
  }, [peakHoursDetailed]);

  // ============================================================
  // AUDIENCE & FLEET INTELLIGENCE (Metric & Concept Toggles)
  // ============================================================

  const audienceDetailed = useMemo(() => {
    const sessionsToAnalyze = filteredSessions;
    const totalSessionsCount = sessionsToAnalyze.length;

    let registeredCount = 0;
    let registeredRev = 0;
    let registeredDwellTotal = 0;
    let registeredDwellCount = 0;

    let guestCount = 0;
    let guestRev = 0;
    let guestDwellTotal = 0;
    let guestDwellCount = 0;

    sessionsToAnalyze.forEach((s) => {
      const isRegistered = s.concept === 'B' || s.app_user_id;
      const payment = paymentBySessionId.get(s.id);
      const fee = payment ? Number(payment.total_amount) || 0 : 0;
      const dwell = s.exit_time ? (new Date(s.exit_time).getTime() - new Date(s.entry_time).getTime()) / 60_000 : 0;

      if (isRegistered) {
        registeredCount++;
        registeredRev += fee;
        if (dwell > 0) { registeredDwellTotal += dwell; registeredDwellCount++; }
      } else {
        guestCount++;
        guestRev += fee;
        if (dwell > 0) { guestDwellTotal += dwell; guestDwellCount++; }
      }
    });

    const totalRev = registeredRev + guestRev;

    return [
      {
        concept: 'Registered Drivers (Concept B)',
        sessions: registeredCount,
        volumeShare: totalSessionsCount > 0 ? registeredCount / totalSessionsCount : 0,
        revenue: registeredRev,
        revenueShare: totalRev > 0 ? registeredRev / totalRev : 0,
        avgFee: registeredCount > 0 ? registeredRev / registeredCount : 0,
        avgDwell: registeredDwellCount > 0 ? registeredDwellTotal / registeredDwellCount : 0,
        totalDwellHours: +(registeredDwellTotal / 60).toFixed(1),
        color: '#6366f1',
      },
      {
        concept: 'Public / Guest Users (Concept A)',
        sessions: guestCount,
        volumeShare: totalSessionsCount > 0 ? guestCount / totalSessionsCount : 0,
        revenue: guestRev,
        revenueShare: totalRev > 0 ? guestRev / totalRev : 0,
        avgFee: guestCount > 0 ? guestRev / guestCount : 0,
        avgDwell: guestDwellCount > 0 ? guestDwellTotal / guestDwellCount : 0,
        totalDwellHours: +(guestDwellTotal / 60).toFixed(1),
        color: '#f59e0b',
      },
    ];
  }, [filteredSessions, paymentBySessionId]);

  const fleetDetailed = useMemo(() => {
    const targetSessions = filteredSessions.filter((s) => {
      if (segmentConceptFilter === 'A') return s.concept === 'A' && !s.app_user_id;
      if (segmentConceptFilter === 'B') return s.concept === 'B' || s.app_user_id;
      return true;
    });

    const totalCount = targetSessions.length;
    const typeMap: Record<string, { count: number; revenue: number; dwellMins: number; dwellCount: number }> = {
      car: { count: 0, revenue: 0, dwellMins: 0, dwellCount: 0 },
      motorcycle: { count: 0, revenue: 0, dwellMins: 0, dwellCount: 0 },
      bus: { count: 0, revenue: 0, dwellMins: 0, dwellCount: 0 },
      truck: { count: 0, revenue: 0, dwellMins: 0, dwellCount: 0 },
      van: { count: 0, revenue: 0, dwellMins: 0, dwellCount: 0 },
      unknown: { count: 0, revenue: 0, dwellMins: 0, dwellCount: 0 },
    };

    targetSessions.forEach((s) => {
      const t = s.vehicle_type || 'unknown';
      if (!typeMap[t]) typeMap[t] = { count: 0, revenue: 0, dwellMins: 0, dwellCount: 0 };
      typeMap[t].count++;

      const p = paymentBySessionId.get(s.id);
      if (p) typeMap[t].revenue += Number(p.total_amount) || 0;

      if (s.exit_time) {
        const d = (new Date(s.exit_time).getTime() - new Date(s.entry_time).getTime()) / 60_000;
        if (d > 0) { typeMap[t].dwellMins += d; typeMap[t].dwellCount++; }
      }
    });

    const totalFleetRev = Object.values(typeMap).reduce((s, item) => s + item.revenue, 0);
    const colors: Record<string, string> = {
      car: '#3b82f6',
      motorcycle: '#10b981',
      bus: '#f59e0b',
      truck: '#ef4444',
      van: '#8b5cf6',
      unknown: '#94a3b8',
    };

    return Object.entries(typeMap)
      .filter(([_, data]) => data.count > 0 || totalCount === 0)
      .map(([type, data]) => ({
        type,
        sessions: data.count,
        volumeShare: totalCount > 0 ? data.count / totalCount : 0,
        revenue: data.revenue,
        revenueShare: totalFleetRev > 0 ? data.revenue / totalFleetRev : 0,
        avgFee: data.count > 0 ? data.revenue / data.count : 0,
        avgDwell: data.dwellCount > 0 ? data.dwellMins / data.dwellCount : 0,
        totalDwellHours: +(data.dwellMins / 60).toFixed(1),
        color: colors[type] || '#94a3b8',
      }));
  }, [filteredSessions, paymentBySessionId, segmentConceptFilter]);

  const dynamicAudienceSegments = useMemo(() => {
    return audienceDetailed.map((a) => ({
      label: a.concept.split(' (')[0],
      value: segmentMetric === 'revenue' ? a.revenue : segmentMetric === 'duration' ? a.totalDwellHours : a.sessions,
      color: a.color,
    }));
  }, [audienceDetailed, segmentMetric]);

  const dynamicFleetSegments = useMemo(() => {
    return fleetDetailed.map((f) => ({
      label: f.type.charAt(0).toUpperCase() + f.type.slice(1),
      value: segmentMetric === 'revenue' ? f.revenue : segmentMetric === 'duration' ? f.totalDwellHours : f.sessions,
      color: f.color,
    }));
  }, [fleetDetailed, segmentMetric]);

  // ============================================================
  // EXPORT HANDLER
  // ============================================================

  const handleExecuteExport = useCallback(() => {
    void exportCustomExcel(
      filters,
      kpis,
      rtTimeSeriesData,
      peakHoursDetailed,
      durationBuckets.buckets,
      audienceDetailed,
      fleetDetailed,
      filteredSessions,
      filteredPayments,
      exportOptions,
    );
    setExportModalOpen(false);
  }, [filters, kpis, rtTimeSeriesData, peakHoursDetailed, durationBuckets.buckets, audienceDetailed, fleetDetailed, filteredSessions, filteredPayments, exportOptions]);

  // ============================================================
  // UI PRESETS & FILTER HELPERS
  // ============================================================

  const presets: { key: DatePreset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last7', label: 'Last 7 Days' },
    { key: 'last30', label: 'Last 30 Days' },
    { key: 'thisMonth', label: 'This Month' },
    { key: 'custom', label: 'Custom' },
  ];

  const activeFilterList = useMemo(() => {
    const list: { key: keyof GlobalFilters; label: string; display: string }[] = [];
    if (filters.concept !== 'all') {
      list.push({ key: 'concept', label: 'Concept', display: filters.concept === 'A' ? 'Concept A (Public)' : 'Concept B (Registered)' });
    }
    if (filters.vehicleType !== 'all') {
      list.push({ key: 'vehicleType', label: 'Vehicle', display: filters.vehicleType.toUpperCase() });
    }
    if (filters.payMethod !== 'all') {
      list.push({ key: 'payMethod', label: 'Payment', display: filters.payMethod.toUpperCase() });
    }
    if (filters.payStatus !== 'all') {
      list.push({ key: 'payStatus', label: 'Status', display: filters.payStatus.toUpperCase() });
    }
    if (filters.gate !== 'all') {
      list.push({ key: 'gate', label: 'Gate', display: filters.gate === 'entrance' ? 'Entrance Only' : 'Exit Only' });
    }
    if (filters.plateSearch) {
      list.push({ key: 'plateSearch', label: 'Plate', display: filters.plateSearch.toUpperCase() });
    }
    return list;
  }, [filters]);

  const lastUpdated = updatedAt
    ? `Live Sync: ${updatedAt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`
    : '';

  // ============================================================
  // RENDER SECTIONS
  // ============================================================

  const renderRevenueSection = (
    <article className="stat-panel stat-panel-wide">
      <div className="stat-panel-head">
        <div>
          <span className="stat-panel-kicker">FINANCIAL & CAPACITY TRENDS</span>
          <h2>Revenue & Vehicle Volume Analysis</h2>
          <p className="stat-panel-sub">
            Collected ticket amounts, vehicle volume counts, and period breakdown.
          </p>
        </div>

        <div className="stat-rt-controls">
          <div className="stat-toggle-group">
            <button
              type="button"
              className={`stat-toggle-btn ${rtViewMode === 'both' ? 'active' : ''}`}
              onClick={() => setRtViewMode('both')}
            >
              Combined
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${rtViewMode === 'revenue' ? 'active' : ''}`}
              onClick={() => setRtViewMode('revenue')}
            >
              Revenue (₱)
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${rtViewMode === 'volume' ? 'active' : ''}`}
              onClick={() => setRtViewMode('volume')}
            >
              Volume
            </button>
          </div>

          <button
            type="button"
            className={`stat-action-btn ${showRtTable ? 'active' : ''}`}
            onClick={() => setShowRtTable((v) => !v)}
            title="Toggle detailed breakdown table"
          >
            <Table size={13} />
            {showRtTable ? 'Hide Table' : 'View Specific Table'}
          </button>
        </div>
      </div>

      {/* Specific Amounts & Volumes Summary Bar */}
      <div className="stat-rt-metrics-bar">
        <div className="stat-rt-metric-chip">
          <span>Selected Total Revenue</span>
          <strong>{currencyFmt.format(rtSummary.totalRev)}</strong>
        </div>
        <div className="stat-rt-metric-chip">
          <span>Total Vehicle Volume</span>
          <strong>{numberFmt.format(rtSummary.totalVol)} sessions</strong>
        </div>
        <div className="stat-rt-metric-chip">
          <span>Average per Interval</span>
          <strong>{currencyFmt.format(rtSummary.avgRev)}</strong>
        </div>
        <div className="stat-rt-metric-chip highlight">
          <span>Peak Interval Record</span>
          <strong>{rtSummary.peakBucket.label}: {currencyFmt.format(rtSummary.peakBucket.revenue)}</strong>
          <small>({rtSummary.peakBucket.sessions} vehicles)</small>
        </div>
      </div>

      {/* Active Inspected Period Banner */}
      {activeRtInterval && (
        <div className="stat-rt-active-banner">
          <span className="stat-rt-active-tag">Inspected: <strong>{activeRtInterval.label}</strong></span>
          <div className="stat-rt-active-metrics">
            <span>Revenue: <strong>{currencyFmt.format(activeRtInterval.revenue)}</strong></span>
            <span>Volume: <strong>{numberFmt.format(activeRtInterval.sessions)} vehicles</strong></span>
            <span>Gate Entries: <strong>{numberFmt.format(activeRtInterval.entries)}</strong></span>
            <span>Gate Exits: <strong>{numberFmt.format(activeRtInterval.exits)}</strong></span>
            <span>Avg/Vehicle: <strong>{activeRtInterval.sessions > 0 ? currencyFmt.format(activeRtInterval.revenue / activeRtInterval.sessions) : '—'}</strong></span>
          </div>
        </div>
      )}

      {/* Chart Visualization */}
      {loading ? (
        <div className="stat-chart-loading" />
      ) : rtTimeSeriesData.some((d) => d.revenue > 0 || d.sessions > 0) ? (
        <>
          <BarChartSimple
            data={
              rtViewMode === 'volume'
                ? rtTimeSeriesData.map((d) => ({ label: d.label, value: d.sessions }))
                : rtTimeSeriesData.map((d) => ({ label: d.label, value: d.revenue }))
            }
            barColor={rtViewMode === 'volume' ? '#22d3ee' : '#6366f1'}
            secondaryData={
              rtViewMode === 'both'
                ? rtTimeSeriesData.map((d) => ({ label: d.label, value: d.sessions }))
                : undefined
            }
            secondaryColor="#22d3ee"
            height={240}
            selectedIndex={rtSelectedIntervalIdx}
            onSelectIndex={(idx) => setRtSelectedIntervalIdx(idx)}
            formatTooltip={(item, i) => {
              const d = rtTimeSeriesData[i];
              return `${d.label}\nRevenue: ${currencyFmt.format(d.revenue)}\nVolume: ${d.sessions} vehicles\nEntries: ${d.entries} | Exits: ${d.exits}`;
            }}
          />
          <div className="stat-chart-footnote">
            <div className="stat-panel-meta">
              {rtViewMode !== 'volume' && (
                <span className="stat-legend-item">
                  <span className="stat-legend-dot" style={{ background: '#6366f1' }} />
                  Revenue (₱)
                </span>
              )}
              {rtViewMode !== 'revenue' && (
                <span className="stat-legend-item">
                  <span className="stat-legend-dot" style={{ background: '#22d3ee' }} />
                  Vehicle Volume (Sessions)
                </span>
              )}
            </div>
            <span className="stat-chart-hint">Tip: Click on any bar to inspect specific values</span>
          </div>
        </>
      ) : (
        <div className="stat-empty-chart">No revenue or traffic data within the selected timeframe</div>
      )}

      {/* Expandable Table */}
      {showRtTable && (
        <div className="stat-rt-table-section">
          <div className="stat-rt-table-head">
            <h3>Specific Amount & Volume Breakdown</h3>
            <span>{rtTimeSeriesData.length} intervals recorded</span>
          </div>
          <div className="stat-rt-table-wrap">
            <table className="stat-rt-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Revenue (₱)</th>
                  <th>Sessions (Volume)</th>
                  <th>Gate Entries</th>
                  <th>Gate Exits</th>
                  <th>Avg / Session</th>
                </tr>
              </thead>
              <tbody>
                {rtTimeSeriesData.map((row, idx) => (
                  <tr
                    key={row.label}
                    className={rtSelectedIntervalIdx === idx ? 'highlighted' : ''}
                    onClick={() => setRtSelectedIntervalIdx(idx)}
                  >
                    <td className="stat-font-medium">{row.label}</td>
                    <td className="mono font-semibold">{currencyFmt.format(row.revenue)}</td>
                    <td className="mono">{numberFmt.format(row.sessions)}</td>
                    <td className="mono">{numberFmt.format(row.entries)}</td>
                    <td className="mono">{numberFmt.format(row.exits)}</td>
                    <td className="mono text-muted">
                      {row.sessions > 0 ? currencyFmt.format(row.revenue / row.sessions) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>TOTAL</th>
                  <th className="mono">{currencyFmt.format(rtSummary.totalRev)}</th>
                  <th className="mono">{numberFmt.format(rtSummary.totalVol)}</th>
                  <th className="mono">{numberFmt.format(rtTimeSeriesData.reduce((s, r) => s + r.entries, 0))}</th>
                  <th className="mono">{numberFmt.format(rtTimeSeriesData.reduce((s, r) => s + r.exits, 0))}</th>
                  <th className="mono">
                    {rtSummary.totalVol > 0 ? currencyFmt.format(rtSummary.totalRev / rtSummary.totalVol) : '—'}
                  </th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </article>
  );

  const renderPeakSection = (
    <article className="stat-panel stat-panel-wide">
      <div className="stat-panel-head">
        <div>
          <span className="stat-panel-kicker">HOURLY DEMAND & PEAK DISTRIBUTION</span>
          <h2>Peak Hours & Hourly Traffic Load</h2>
          <p className="stat-panel-sub">
            Filter by Day of Week, Gate Direction, and Rush Windows to isolate congestion periods.
          </p>
        </div>
        <div className="stat-panel-actions">
          <button
            type="button"
            className={`stat-action-btn ${showPeakTable ? 'active' : ''}`}
            onClick={() => setShowPeakTable((v) => !v)}
          >
            <Table size={13} />
            {showPeakTable ? 'Hide Table' : 'Hourly Table'}
          </button>
        </div>
      </div>

      {/* Peak Hours Adjustable Controls */}
      <div className="stat-peak-controls-bar">
        <div className="stat-control-group">
          <span className="stat-control-label">Day of Week:</span>
          <select
            className="stat-select-compact"
            value={peakDayFilter}
            onChange={(e) => setPeakDayFilter(e.target.value as PeakDayFilter)}
          >
            <option value="all">All Days Combined</option>
            <option value="weekdays">Weekdays Only (Mon–Fri)</option>
            <option value="weekends">Weekends Only (Sat–Sun)</option>
            <option value="1">Mondays</option>
            <option value="2">Tuesdays</option>
            <option value="3">Wednesdays</option>
            <option value="4">Thursdays</option>
            <option value="5">Fridays</option>
            <option value="6">Saturdays</option>
            <option value="0">Sundays</option>
          </select>
        </div>

        <div className="stat-control-group">
          <span className="stat-control-label">Gate Direction:</span>
          <div className="stat-toggle-group">
            <button
              type="button"
              className={`stat-toggle-btn ${peakGateFilter === 'both' ? 'active' : ''}`}
              onClick={() => setPeakGateFilter('both')}
            >
              Total Activity
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${peakGateFilter === 'entry' ? 'active' : ''}`}
              onClick={() => setPeakGateFilter('entry')}
            >
              Inflow (Entries)
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${peakGateFilter === 'exit' ? 'active' : ''}`}
              onClick={() => setPeakGateFilter('exit')}
            >
              Outflow (Exits)
            </button>
          </div>
        </div>

        <div className="stat-control-group">
          <span className="stat-control-label">Focus Window:</span>
          <select
            className="stat-select-compact"
            value={peakWindowFilter}
            onChange={(e) => setPeakWindowFilter(e.target.value as PeakWindowFilter)}
          >
            <option value="24h">Full 24 Hours</option>
            <option value="operating">Operating (6AM–10PM)</option>
            <option value="morning">Morning Rush (6AM–12PM)</option>
            <option value="evening">Evening Rush (3PM–9PM)</option>
          </select>
        </div>
      </div>

      {/* Peak Window Highlights */}
      <div className="stat-peak-highlights-grid">
        <div className="stat-peak-highlight-box">
          <span className="stat-peak-tag morning">Morning Peak (6AM–12PM)</span>
          <strong>{peakMorningHour.hourLabel}</strong>
          <small>{numberFmt.format(peakMorningHour.total)} gate events</small>
        </div>
        <div className="stat-peak-highlight-box">
          <span className="stat-peak-tag evening">Evening Peak (3PM–9PM)</span>
          <strong>{peakEveningHour.hourLabel}</strong>
          <small>{numberFmt.format(peakEveningHour.total)} gate events</small>
        </div>
      </div>

      {/* Bar Chart Visualization */}
      {loading ? (
        <div className="stat-chart-loading" />
      ) : peakHoursDetailed.some((h) => h.total > 0) ? (
        <>
          <BarChartSimple
            data={peakHoursDetailed.map((h) => ({
              label: h.hourLabel,
              value: peakGateFilter === 'entry' ? h.entries : peakGateFilter === 'exit' ? h.exits : h.total,
            }))}
            barColor={peakGateFilter === 'exit' ? '#f59e0b' : '#3b82f6'}
            secondaryData={
              peakGateFilter === 'both'
                ? peakHoursDetailed.map((h) => ({ label: h.hourLabel, value: h.exits }))
                : undefined
            }
            secondaryColor="#f59e0b"
            height={200}
            selectedIndex={selectedPeakHour}
            onSelectIndex={(idx) => setSelectedPeakHour(idx)}
            formatTooltip={(_, i) => {
              const h = peakHoursDetailed[i];
              return `${h.hourLabel}\nTotal: ${h.total} events (${(h.shareOfTotal * 100).toFixed(1)}%)\nEntries: ${h.entries} | Exits: ${h.exits}\nFlow: ${h.flowType}`;
            }}
          />

          <div className="stat-chart-footnote">
            <div className="stat-panel-meta">
              {peakGateFilter !== 'exit' && (
                <span className="stat-legend-item">
                  <span className="stat-legend-dot" style={{ background: '#3b82f6' }} />
                  {peakGateFilter === 'both' ? 'Entries' : 'Inflow Volume'}
                </span>
              )}
              {peakGateFilter !== 'entry' && (
                <span className="stat-legend-item">
                  <span className="stat-legend-dot" style={{ background: '#f59e0b' }} />
                  {peakGateFilter === 'both' ? 'Exits' : 'Outflow Volume'}
                </span>
              )}
            </div>
            <span className="stat-chart-hint">Click bar to inspect hourly dynamics</span>
          </div>
        </>
      ) : (
        <div className="stat-empty-chart">No hourly activity recorded matching the chosen day/gate filters</div>
      )}

      {/* Expandable Hourly Table */}
      {showPeakTable && (
        <div className="stat-rt-table-section">
          <div className="stat-rt-table-head">
            <h3>Hourly Demand Audit Table</h3>
            <span>{peakHoursDetailed.length} hours analyzed</span>
          </div>
          <div className="stat-rt-table-wrap">
            <table className="stat-rt-table">
              <thead>
                <tr>
                  <th>Hour</th>
                  <th>Entries</th>
                  <th>Exits</th>
                  <th>Total Activity</th>
                  <th>Share (%)</th>
                  <th>Flow Dynamics</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {peakHoursDetailed.map((row, idx) => (
                  <tr
                    key={row.hourLabel}
                    className={selectedPeakHour === idx ? 'highlighted' : ''}
                    onClick={() => setSelectedPeakHour(idx)}
                  >
                    <td className="stat-font-medium">{row.hourLabel}</td>
                    <td className="mono">{numberFmt.format(row.entries)}</td>
                    <td className="mono">{numberFmt.format(row.exits)}</td>
                    <td className="mono font-semibold">{numberFmt.format(row.total)}</td>
                    <td className="mono">{percentFmt.format(row.shareOfTotal)}</td>
                    <td>
                      <span className={`stat-flow-tag ${row.flowType.includes('Inflow') ? 'inflow' : row.flowType.includes('Outflow') ? 'outflow' : 'balanced'}`}>
                        {row.flowType}
                      </span>
                    </td>
                    <td>{row.isPeak ? <strong className="stat-peak-badge">PEAK</strong> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </article>
  );

  const renderDurationSection = (
    <article className="stat-panel stat-panel-wide">
      <div className="stat-panel-head">
        <div>
          <span className="stat-panel-kicker">DURATION ANALYSIS</span>
          <h2>Dwell Time Breakdown & Turnaround Dynamics</h2>
          <p className="stat-panel-sub">Configure interval step and dwell thresholds across completed sessions.</p>
        </div>
        <Timer size={18} className="stat-head-icon" />
      </div>

      {/* Granularity & Time Controls */}
      <div className="stat-duration-controls">
        <div className="stat-duration-control-row">
          <span className="stat-control-label">Interval Step:</span>
          <div className="stat-toggle-group">
            <button
              type="button"
              className={`stat-toggle-btn ${durationGranularity === '15m' ? 'active' : ''}`}
              onClick={() => setDurationGranularity('15m')}
            >
              15 Mins
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${durationGranularity === '30m' ? 'active' : ''}`}
              onClick={() => setDurationGranularity('30m')}
            >
              30 Mins
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${durationGranularity === '1h' ? 'active' : ''}`}
              onClick={() => setDurationGranularity('1h')}
            >
              1 Hour
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${durationGranularity === 'standard' ? 'active' : ''}`}
              onClick={() => setDurationGranularity('standard')}
            >
              Standard
            </button>
          </div>

          <span className="stat-control-label ml-2">Entry Time:</span>
          <select
            className="stat-select-compact"
            value={durationTimeOfDay}
            onChange={(e) => setDurationTimeOfDay(e.target.value as TimeOfDayFilter)}
          >
            <option value="all">All Day</option>
            <option value="morning">Morning (6AM – 12PM)</option>
            <option value="afternoon">Afternoon (12PM – 6PM)</option>
            <option value="evening">Evening (6PM – 12AM)</option>
            <option value="night">Night (12AM – 6AM)</option>
          </select>

          <span className="stat-control-label ml-2">Min Dwell:</span>
          <select
            className="stat-select-compact"
            value={durationMinMins}
            onChange={(e) => setDurationMinMins(Number(e.target.value))}
          >
            <option value={0}>0 mins (All)</option>
            <option value={15}>&gt; 15 mins</option>
            <option value={30}>&gt; 30 mins</option>
            <option value={60}>&gt; 1 hour</option>
            <option value={120}>&gt; 2 hours</option>
          </select>
        </div>
      </div>

      {/* Duration Metrics Overview */}
      <div className="stat-duration-overview">
        <div className="stat-duration-overview-item">
          <span>Analyzed Sessions</span>
          <strong>{numberFmt.format(durationBuckets.totalSessions)}</strong>
        </div>
        <div className="stat-duration-overview-item">
          <span>Average Dwell Time</span>
          <strong>{formatDuration(durationBuckets.avgMins)}</strong>
        </div>
      </div>

      {/* Duration Bar Chart */}
      {loading ? (
        <div className="stat-chart-loading" />
      ) : durationBuckets.buckets.some((b) => b.count > 0) ? (
        <>
          <BarChartSimple
            data={durationBuckets.buckets.map((b) => ({ label: b.label, value: b.count }))}
            barColor="#10b981"
            height={200}
            formatTooltip={(item, idx) => {
              const b = durationBuckets.buckets[idx];
              return `${b.label}: ${b.count} vehicles (${(b.percentage * 100).toFixed(1)}%)\nEst. Revenue: ${currencyFmt.format(b.revenueEst)}`;
            }}
          />

          {/* Bucket Breakdown List */}
          <div className="stat-duration-list">
            {durationBuckets.buckets.map((b) => (
              <div
                key={b.label}
                className={`stat-duration-list-item ${selectedDurationBucket === b.label ? 'active' : ''}`}
                onClick={() => setSelectedDurationBucket((prev) => (prev === b.label ? null : b.label))}
              >
                <div className="stat-duration-item-left">
                  <span className="stat-duration-dot" />
                  <span className="stat-duration-lbl">{b.label}</span>
                </div>
                <div className="stat-duration-item-right">
                  <strong>{numberFmt.format(b.count)} vehicles</strong>
                  <span className="stat-duration-pct">{percentFmt.format(b.percentage)}</span>
                  <span className="stat-duration-rev text-muted">{currencyFmt.format(b.revenueEst)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="stat-empty-chart">No completed parking sessions match the criteria</div>
      )}
    </article>
  );

  const renderAudienceSection = (
    <article className="stat-panel stat-panel-wide">
      <div className="stat-panel-head">
        <div>
          <span className="stat-panel-kicker">AUDIENCE & FLEET INTELLIGENCE</span>
          <h2>User & Vehicle Breakdown</h2>
          <p className="stat-panel-sub">
            Analyze customer mix by Volume, Revenue (₱), or Total Parked Duration.
          </p>
        </div>
        <div className="stat-panel-actions">
          <button
            type="button"
            className={`stat-action-btn ${showSegmentTable ? 'active' : ''}`}
            onClick={() => setShowSegmentTable((v) => !v)}
          >
            <Table size={13} />
            {showSegmentTable ? 'Hide Table' : 'Detailed Breakdown'}
          </button>
        </div>
      </div>

      {/* Adjustable Segment Controls */}
      <div className="stat-peak-controls-bar">
        <div className="stat-control-group">
          <span className="stat-control-label">Display Metric:</span>
          <div className="stat-toggle-group">
            <button
              type="button"
              className={`stat-toggle-btn ${segmentMetric === 'volume' ? 'active' : ''}`}
              onClick={() => setSegmentMetric('volume')}
            >
              <CarFront size={12} /> Volume
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${segmentMetric === 'revenue' ? 'active' : ''}`}
              onClick={() => setSegmentMetric('revenue')}
            >
              <DollarSign size={12} /> Revenue (₱)
            </button>
            <button
              type="button"
              className={`stat-toggle-btn ${segmentMetric === 'duration' ? 'active' : ''}`}
              onClick={() => setSegmentMetric('duration')}
            >
              <Timer size={12} /> Hours
            </button>
          </div>
        </div>

        <div className="stat-control-group">
          <span className="stat-control-label">Concept Filter:</span>
          <select
            className="stat-select-compact"
            value={segmentConceptFilter}
            onChange={(e) => setSegmentConceptFilter(e.target.value as SegmentConceptFilter)}
          >
            <option value="all">All Concepts (A & B)</option>
            <option value="A">Concept A Only (Public)</option>
            <option value="B">Concept B Only (Registered)</option>
          </select>
        </div>
      </div>

      {/* Donuts View */}
      {loading ? (
        <div className="stat-chart-loading" />
      ) : filteredSessions.length > 0 ? (
        <div className="stat-donuts-row">
          <DonutChart
            segments={dynamicAudienceSegments}
            size={145}
            label={segmentMetric === 'revenue' ? '₱ Audience' : segmentMetric === 'duration' ? 'Hours' : 'Audience'}
            valueFormatter={(val) =>
              segmentMetric === 'revenue' ? currencyFmt.format(val) : segmentMetric === 'duration' ? `${val}h` : numberFmt.format(val)
            }
          />
          <DonutChart
            segments={dynamicFleetSegments}
            size={145}
            label={segmentMetric === 'revenue' ? '₱ Fleet' : segmentMetric === 'duration' ? 'Hours' : 'Fleet'}
            valueFormatter={(val) =>
              segmentMetric === 'revenue' ? currencyFmt.format(val) : segmentMetric === 'duration' ? `${val}h` : numberFmt.format(val)
            }
          />
        </div>
      ) : (
        <div className="stat-empty-chart">No parking sessions in this period</div>
      )}

      {/* Expandable Segmentation Breakdown Table */}
      {showSegmentTable && (
        <div className="stat-rt-table-section">
          <div className="stat-rt-table-head">
            <h3>Audience & Fleet Cross-Matrix</h3>
            <span>Volume, Revenue & Duration</span>
          </div>
          <div className="stat-rt-table-wrap">
            <table className="stat-rt-table">
              <thead>
                <tr>
                  <th>Segment / Classification</th>
                  <th>Sessions</th>
                  <th>Volume %</th>
                  <th>Revenue (₱)</th>
                  <th>Revenue %</th>
                  <th>Avg Fee</th>
                  <th>Avg Dwell</th>
                </tr>
              </thead>
              <tbody>
                <tr className="stat-group-heading">
                  <td colSpan={7}><strong>AUDIENCE (CONCEPT TYPE)</strong></td>
                </tr>
                {audienceDetailed.map((row) => (
                  <tr key={row.concept}>
                    <td className="stat-font-medium">{row.concept}</td>
                    <td className="mono">{numberFmt.format(row.sessions)}</td>
                    <td className="mono">{percentFmt.format(row.volumeShare)}</td>
                    <td className="mono font-semibold">{currencyFmt.format(row.revenue)}</td>
                    <td className="mono">{percentFmt.format(row.revenueShare)}</td>
                    <td className="mono text-muted">{currencyFmt.format(row.avgFee)}</td>
                    <td className="mono">{formatDuration(row.avgDwell)}</td>
                  </tr>
                ))}
                <tr className="stat-group-heading">
                  <td colSpan={7}><strong>FLEET CLASSIFICATION</strong></td>
                </tr>
                {fleetDetailed.map((row) => (
                  <tr key={row.type}>
                    <td className="stat-font-medium">{row.type.toUpperCase()}</td>
                    <td className="mono">{numberFmt.format(row.sessions)}</td>
                    <td className="mono">{percentFmt.format(row.volumeShare)}</td>
                    <td className="mono font-semibold">{currencyFmt.format(row.revenue)}</td>
                    <td className="mono">{percentFmt.format(row.revenueShare)}</td>
                    <td className="mono text-muted">{currencyFmt.format(row.avgFee)}</td>
                    <td className="mono">{formatDuration(row.avgDwell)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </article>
  );

  return (
    <main className="stat-page">
      {/* ===== HEADER ===== */}
      <header className="stat-header">
        <div className="stat-header-left">
          <div className="stat-eyebrow">
            <Activity size={14} /> OPERATIONS INTELLIGENCE
          </div>
          <h1>Statistics & Analytics</h1>
          <p>Multi-dimensional operational telemetry, revenue dynamics, hourly load, and fleet metrics.</p>
        </div>
        <div className="stat-header-right">
          {lastUpdated && <span className="stat-updated">{lastUpdated}</span>}
          <button
            className="stat-action-btn"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            title="Refresh statistics directly from Supabase"
          >
            <RefreshCw size={14} className={loading ? 'stat-spin' : ''} />
            Refresh
          </button>
          <button
            className="stat-action-btn stat-action-export"
            onClick={() => setExportModalOpen(true)}
            disabled={loading}
            title="Export customized report to Excel"
          >
            <FileSpreadsheet size={15} />
            Export .xlsx
          </button>
        </div>
      </header>

      {/* ===== SINGLE UNIFIED TOP FILTER BAR FOR ALL ===== */}
      <section className="stat-clean-filter-card" aria-label="Filters and Range Selection">
        <div className="stat-filter-top-bar">
          {/* Preset Buttons */}
          <div className="stat-preset-pills">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`stat-pill-btn ${filters.preset === p.key ? 'active' : ''}`}
                onClick={() => updateFilter('preset', p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="stat-filter-vsep" />

          {/* Unified Date Range Selector */}
          <div className="stat-range-picker-box">
            <CalendarDays size={14} className="stat-picker-icon" />
            <div className="stat-range-fields">
              <input
                type="datetime-local"
                className="stat-range-input"
                value={filters.startDate}
                onChange={(e) => updateFilter('startDate', e.target.value)}
                aria-label="Start Date and Time"
              />
              <span className="stat-range-sep">→</span>
              <input
                type="datetime-local"
                className="stat-range-input"
                value={filters.endDate}
                onChange={(e) => updateFilter('endDate', e.target.value)}
                aria-label="End Date and Time"
              />
            </div>
          </div>

          {/* Aggregation Interval Selector */}
          <div className="stat-interval-box">
            <BarChart3 size={13} className="stat-picker-icon" />
            <select
              value={filters.interval}
              onChange={(e) => updateFilter('interval', e.target.value as AggInterval)}
              aria-label="Aggregation Interval"
            >
              <option value="hourly">Hourly Interval</option>
              <option value="daily">Daily Interval</option>
              <option value="weekly">Weekly Interval</option>
              <option value="monthly">Monthly Interval</option>
            </select>
          </div>

          <div className="stat-filter-vsep" />

          {/* Advanced Filter Button */}
          <button
            type="button"
            className={`stat-filter-btn-advanced ${showFilters ? 'active' : ''} ${activeFilterList.length > 0 ? 'highlighted' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
          >
            <Filter size={13} />
            <span>Filters</span>
            {activeFilterList.length > 0 && <span className="stat-filter-badge">{activeFilterList.length}</span>}
          </button>

          {activeFilterList.length > 0 && (
            <button type="button" className="stat-reset-btn" onClick={resetFilters} title="Reset all active filters">
              <RotateCcw size={12} />
              Reset All
            </button>
          )}
        </div>

        {/* Active Filter Chips */}
        {activeFilterList.length > 0 && (
          <div className="stat-active-chips-row">
            <span className="stat-chips-label">Applied Criteria:</span>
            {activeFilterList.map((f) => (
              <span key={f.key} className="stat-active-chip">
                <strong>{f.label}:</strong> {f.display}
                <button
                  type="button"
                  onClick={() => updateFilter(f.key, f.key === 'plateSearch' ? '' : 'all' as any)}
                  aria-label={`Remove filter for ${f.label}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Expanded Filters Drawer */}
        {showFilters && (
          <div className="stat-filters-drawer">
            <div className="stat-drawer-grid">
              <label className="stat-drawer-field">
                <span>Concept Type</span>
                <select value={filters.concept} onChange={(e) => updateFilter('concept', e.target.value as ConceptFilter)}>
                  <option value="all">All Concepts</option>
                  <option value="A">Public (Concept A)</option>
                  <option value="B">Registered (Concept B)</option>
                </select>
              </label>

              <label className="stat-drawer-field">
                <span>Vehicle Classification</span>
                <select value={filters.vehicleType} onChange={(e) => updateFilter('vehicleType', e.target.value as VehicleFilter)}>
                  <option value="all">All Vehicle Types</option>
                  <option value="car">Car</option>
                  <option value="motorcycle">Motorcycle</option>
                  <option value="bus">Bus</option>
                  <option value="truck">Truck</option>
                  <option value="van">Van</option>
                </select>
              </label>

              <label className="stat-drawer-field">
                <span>Payment Method</span>
                <select value={filters.payMethod} onChange={(e) => updateFilter('payMethod', e.target.value as PayMethodFilter)}>
                  <option value="all">All Payment Methods</option>
                  <option value="cash">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="card">Credit / Debit Card</option>
                  <option value="wallet">Driver In-App Wallet</option>
                </select>
              </label>

              <label className="stat-drawer-field">
                <span>Payment Status</span>
                <select value={filters.payStatus} onChange={(e) => updateFilter('payStatus', e.target.value as PayStatusFilter)}>
                  <option value="all">All Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                  <option value="refunded">Refunded</option>
                </select>
              </label>

              <label className="stat-drawer-field">
                <span>Gate Direction</span>
                <select value={filters.gate} onChange={(e) => updateFilter('gate', e.target.value as GateFilter)}>
                  <option value="all">All Gates (Entry & Exit)</option>
                  <option value="entrance">Entrance Gate</option>
                  <option value="exit">Exit Gate</option>
                </select>
              </label>

              <div className="stat-drawer-field stat-drawer-search">
                <span>Search Plate Number</span>
                <div className="stat-drawer-search-wrap">
                  <Search size={13} className="stat-field-icon" />
                  <input
                    type="text"
                    placeholder="e.g. ABC 1234…"
                    value={filters.plateSearch}
                    onChange={(e) => updateFilter('plateSearch', e.target.value)}
                  />
                  {filters.plateSearch && (
                    <button type="button" className="stat-search-clear" onClick={() => updateFilter('plateSearch', '')}>
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ===== ERROR STATE ===== */}
      {error ? (
        <section className="stat-error" role="alert">
          <div>
            <strong>Unable to load statistics data</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={() => setRefreshKey((k) => k + 1)}>Retry Connection</button>
        </section>
      ) : (
        <>
          {/* ===== 4 KPI SUMMARY CARDS ===== */}
          <section className="stat-kpis" aria-label="Key Performance Indicators">
            <article className="stat-kpi stat-kpi-revenue">
              <div className="stat-kpi-top">
                <span>Total Revenue</span>
                <span className="stat-kpi-icon revenue"><TrendingUp size={16} /></span>
              </div>
              <strong>{loading ? '—' : currencyFmt.format(kpis.totalRevenue)}</strong>
              {kpis.revenueChange != null && !loading ? (
                <small className={`stat-kpi-change ${kpis.revenueChange >= 0 ? 'positive' : 'negative'}`}>
                  {kpis.revenueChange >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {kpis.revenueChange >= 0 ? '+' : ''}{(kpis.revenueChange * 100).toFixed(1)}% vs previous period
                </small>
              ) : (
                <small>Completed parking payments</small>
              )}
            </article>

            <article className="stat-kpi">
              <div className="stat-kpi-top">
                <span>Vehicle Volume</span>
                <span className="stat-kpi-icon volume"><CarFront size={16} /></span>
              </div>
              <strong>{loading ? '—' : numberFmt.format(kpis.totalVolume)}</strong>
              <small>Total parking sessions in period</small>
            </article>

            <article className="stat-kpi">
              <div className="stat-kpi-top">
                <span>Avg. Dwell Time</span>
                <span className="stat-kpi-icon dwell"><Timer size={16} /></span>
              </div>
              <strong>{loading ? '—' : formatDuration(kpis.avgDwellMinutes)}</strong>
              <small>Average turnaround per vehicle</small>
            </article>

            <article className="stat-kpi">
              <div className="stat-kpi-top">
                <span>Peak Occupancy</span>
                <span className="stat-kpi-icon occupancy"><Gauge size={16} /></span>
              </div>
              <strong>{loading ? '—' : `${(kpis.peakOccupancy * 100).toFixed(1)}%`}</strong>
              <small>{totalCapacity} total facility slots</small>
            </article>
          </section>

          {/* ===== CARDS IN TAB VIEW ===== */}
          <nav className="stat-tabs-nav" aria-label="Statistics Sections Navigation">
            <button
              type="button"
              className={`stat-tab-item ${activeTab === 'revenue' ? 'active' : ''}`}
              onClick={() => setActiveTab('revenue')}
            >
              <TrendingUp size={15} />
              <span>Revenue & Traffic</span>
            </button>
            <button
              type="button"
              className={`stat-tab-item ${activeTab === 'peak' ? 'active' : ''}`}
              onClick={() => setActiveTab('peak')}
            >
              <Clock3 size={15} />
              <span>Peak Hours & Demand</span>
            </button>
            <button
              type="button"
              className={`stat-tab-item ${activeTab === 'duration' ? 'active' : ''}`}
              onClick={() => setActiveTab('duration')}
            >
              <Timer size={15} />
              <span>Duration & Turnaround</span>
            </button>
            <button
              type="button"
              className={`stat-tab-item ${activeTab === 'audience' ? 'active' : ''}`}
              onClick={() => setActiveTab('audience')}
            >
              <Users size={15} />
              <span>Audience & Fleet</span>
            </button>
            <button
              type="button"
              className={`stat-tab-item ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              <Layers size={15} />
              <span>All Views</span>
            </button>
          </nav>

          {/* Tab Content Display */}
          <div className="stat-tab-content-area">
            {activeTab === 'revenue' && renderRevenueSection}
            {activeTab === 'peak' && renderPeakSection}
            {activeTab === 'duration' && renderDurationSection}
            {activeTab === 'audience' && renderAudienceSection}
            {activeTab === 'all' && (
              <div className="stat-charts-grid">
                {renderRevenueSection}
                {renderPeakSection}
                {renderDurationSection}
                {renderAudienceSection}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== EXPORT SELECTION MODAL ===== */}
      {exportModalOpen && (
        <div className="stat-modal-backdrop" onClick={() => setExportModalOpen(false)}>
          <div className="stat-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="stat-modal-head">
              <div className="stat-modal-title">
                <FileSpreadsheet size={22} className="stat-modal-icon" />
                <div>
                  <h2>Export Analytics Workbook (.xlsx)</h2>
                  <p>Select which data sheets to include. The exported file features clean headings, formatted tables, and auto-adjusted widths.</p>
                </div>
              </div>
              <button
                type="button"
                className="stat-modal-close"
                onClick={() => setExportModalOpen(false)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="stat-modal-body">
              {/* Range Confirmation Card */}
              <div className="stat-modal-range-card">
                <div className="stat-modal-range-header">
                  <CalendarDays size={14} />
                  <span>Confirmed Date & Time Range for Export</span>
                </div>
                <div className="stat-modal-range-dates">
                  <strong>{formatReadableDateTime(filters.startDate)}</strong>
                  <span>to</span>
                  <strong>{formatReadableDateTime(filters.endDate)}</strong>
                </div>
                <div className="stat-modal-range-meta">
                  <span>Interval: <strong>{filters.interval.toUpperCase()}</strong></span>
                  <span>Concept: <strong>{filters.concept === 'all' ? 'All' : filters.concept}</strong></span>
                  <span>Vehicles: <strong>{filters.vehicleType.toUpperCase()}</strong></span>
                </div>
              </div>

              {/* Table Selection Checkboxes */}
              <div className="stat-modal-select-controls">
                <span>Select Data Sheets to Generate:</span>
                <div className="stat-modal-quick-select">
                  <button
                    type="button"
                    onClick={() =>
                      setExportOptions({
                        executiveSummary: true,
                        revenueTraffic: true,
                        peakHours: true,
                        dwellTime: true,
                        segmentation: true,
                        sessionRecords: true,
                      })
                    }
                  >
                    Select All
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() =>
                      setExportOptions({
                        executiveSummary: true,
                        revenueTraffic: true,
                        peakHours: true,
                        dwellTime: true,
                        segmentation: true,
                        sessionRecords: false,
                      })
                    }
                  >
                    Analytics Sheets Only
                  </button>
                </div>
              </div>

              <div className="stat-modal-options-list">
                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.executiveSummary}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, executiveSummary: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>1. Executive Summary Sheet</strong>
                    <span>High-level operational scorecard, total revenue, volume, dwell times, and applied filter metadata.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.revenueTraffic}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, revenueTraffic: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>2. Revenue & Traffic Time-Series</strong>
                    <span>Detailed interval table with revenue, cumulative totals, sessions, gate entries/exits, and summary rows.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.peakHours}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, peakHours: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>3. 24-Hour Peak Hours Distribution</strong>
                    <span>Hourly gate activity, traffic share percentages, rush hour flags, and inflow/outflow dynamics.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.dwellTime}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, dwellTime: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>4. Duration & Dwell Turnaround Breakdown</strong>
                    <span>Turnaround brackets, session volume, duration percentages, total hours, and revenue collected.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.segmentation}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, segmentation: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>5. Audience & Fleet Intelligence</strong>
                    <span>Concept A vs B comparison, vehicle classification breakdown with revenue shares and avg tickets.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.sessionRecords}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, sessionRecords: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>6. Filtered Sessions Audit Log</strong>
                    <span>Complete itemized session rows with plate numbers, timestamps, fees, and payment methods.</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="stat-modal-foot">
              <button
                type="button"
                className="stat-btn-secondary"
                onClick={() => setExportModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="stat-btn-primary"
                onClick={handleExecuteExport}
                disabled={!Object.values(exportOptions).some(Boolean)}
              >
                <Download size={15} />
                Generate & Download .xlsx
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
