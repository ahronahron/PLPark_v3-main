/**
 * Statistics.tsx — Enterprise-Grade Statistics & Analytics Page for PLPark
 *
 * Operational intelligence dashboard featuring:
 * 1. Filter Bar with clean date/time pickers, presets, interval, and multi-dimensional filters.
 * 2. KPI Summary Cards: Total Revenue, Vehicle Volume, Average Dwell Time, Peak Occupancy (ALPR removed).
 * 3. Revenue & Traffic Analysis: Adjustable date/time & interval, specific amount & volume breakdown,
 *    view mode toggles, and expandable detailed interval table.
 * 4. Duration Analysis: Configurable time granularity (15m, 30m, 1h, standard), min/max dwell filters,
 *    and detailed dwell time metrics.
 * 5. Peak Hours & User/Vehicle Segmentation visualizations.
 * 6. Export Modal: Multi-table selection for clean, professional Excel (.xlsx) report export
 *    with formatted headers, auto-sized columns, and summary totals strictly within the selected range.
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  FileSpreadsheet,
  Filter,
  Gauge,
  Info,
  Layers,
  PieChart,
  RefreshCw,
  RotateCcw,
  Search,
  Sliders,
  Table,
  Timer,
  TrendingDown,
  TrendingUp,
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

type DurationGranularity = '15m' | '30m' | '1h' | 'standard';
type TimeOfDayFilter = 'all' | 'morning' | 'afternoon' | 'evening' | 'night';

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
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  label?: string;
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
          <strong className="stat-donut-total">{numberFmt.format(total)}</strong>
        </div>
      </div>
      <div className="stat-donut-legend">
        {segments.map((seg) => (
          <div key={seg.label} className="stat-donut-legend-item">
            <span className="stat-donut-dot" style={{ background: seg.color }} />
            <span className="stat-donut-legend-text">{seg.label}</span>
            <strong>{numberFmt.format(seg.value)}</strong>
            <small>{percentFmt.format(seg.value / total)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// ADVANCED MULTI-TABLE EXCEL EXPORT (Clean Headers & Auto-Widths)
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
  peakHoursData: { label: string; entries: number; exits: number }[],
  dwellData: { label: string; count: number; percentage: number; totalMinutes: number }[],
  conceptSegments: { label: string; value: number }[],
  vehicleSegments: { label: string; value: number }[],
  sessions: SessionRow[],
  payments: PaymentRow[],
  options: ExportOptions,
) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const formattedStart = formatReadableDateTime(filters.startDate);
  const formattedEnd = formatReadableDateTime(filters.endDate);
  const nowFormatted = formatReadableDateTime(new Date().toISOString());

  // Helper to calculate column widths based on content
  const autoColWidths = (rows: (string | number | null | undefined)[][]) => {
    const colMax: number[] = [];
    rows.forEach((row) => {
      row.forEach((val, idx) => {
        const len = val != null ? String(val).length : 0;
        colMax[idx] = Math.max(colMax[idx] || 10, len + 3);
      });
    });
    return colMax.map((w) => ({ wch: Math.min(60, Math.max(12, w)) }));
  };

  // 1. Executive Summary
  if (options.executiveSummary) {
    const sumRows: (string | number)[][] = [
      ['PLPARK OPERATIONS REPORT — EXECUTIVE SUMMARY'],
      [],
      ['Report Generated:', nowFormatted],
      ['Date Range Filter:', `${formattedStart} to ${formattedEnd}`],
      ['Aggregation Interval:', filters.interval.toUpperCase()],
      ['Concept Type:', filters.concept === 'all' ? 'All (Public & Registered)' : filters.concept === 'A' ? 'Public (Concept A)' : 'Registered (Concept B)'],
      ['Vehicle Type Filter:', filters.vehicleType === 'all' ? 'All Vehicles' : filters.vehicleType.toUpperCase()],
      ['Payment Method Filter:', filters.payMethod === 'all' ? 'All Methods' : filters.payMethod.toUpperCase()],
      ['Payment Status Filter:', filters.payStatus === 'all' ? 'All Statuses' : filters.payStatus.toUpperCase()],
      ['Plate Search:', filters.plateSearch || 'None'],
      [],
      ['KEY PERFORMANCE INDICATORS', ''],
      ['METRIC', 'VALUE'],
      ['Total Collected Revenue (₱)', kpis.totalRevenue],
      ['Total Parking Volume (Sessions)', kpis.totalVolume],
      ['Average Dwell Duration', formatDuration(kpis.avgDwellMinutes)],
      ['Peak Estimated Occupancy', `${(kpis.peakOccupancy * 100).toFixed(1)}%`],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sumRows);
    ws['!cols'] = autoColWidths(sumRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Executive Summary');
  }

  // 2. Revenue & Traffic
  if (options.revenueTraffic) {
    const totalRev = timeSeriesData.reduce((s, r) => s + r.revenue, 0);
    const totalSess = timeSeriesData.reduce((s, r) => s + r.sessions, 0);
    const totalEnt = timeSeriesData.reduce((s, r) => s + r.entries, 0);
    const totalEx = timeSeriesData.reduce((s, r) => s + r.exits, 0);

    const rtRows: (string | number)[][] = [
      ['PLPARK OPERATIONS REPORT — REVENUE & TRAFFIC TIME-SERIES'],
      ['Filtered Date Range:', `${formattedStart} to ${formattedEnd}`],
      [],
      ['PERIOD', 'REVENUE (PHP)', 'TOTAL SESSIONS', 'GATE ENTRIES', 'GATE EXITS', 'AVG PER SESSION (PHP)'],
      ...timeSeriesData.map((d) => [
        d.label,
        d.revenue,
        d.sessions,
        d.entries,
        d.exits,
        d.sessions > 0 ? +(d.revenue / d.sessions).toFixed(2) : 0,
      ]),
      [],
      ['TOTAL', totalRev, totalSess, totalEnt, totalEx, totalSess > 0 ? +(totalRev / totalSess).toFixed(2) : 0],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rtRows);
    ws['!cols'] = autoColWidths(rtRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Revenue & Traffic');
  }

  // 3. Peak Hours
  if (options.peakHours) {
    const maxHour = peakHoursData.reduce((p, h, i) => (h.entries + h.exits > peakHoursData[p].entries + peakHoursData[p].exits ? i : p), 0);
    const phRows: (string | number)[][] = [
      ['PLPARK OPERATIONS REPORT — 24-HOUR PEAK HOURS DISTRIBUTION'],
      ['Peak Hour Identified:', `${String(maxHour).padStart(2, '0')}:00 – ${String((maxHour + 1) % 24).padStart(2, '0')}:00`],
      [],
      ['HOUR (24H)', 'GATE ENTRIES', 'GATE EXITS', 'TOTAL GATE ACTIVITY', 'STATUS'],
      ...peakHoursData.map((h, i) => [
        `${h.label}:00`,
        h.entries,
        h.exits,
        h.entries + h.exits,
        i === maxHour ? 'PEAK HOUR' : '',
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(phRows);
    ws['!cols'] = autoColWidths(phRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Peak Hours');
  }

  // 4. Dwell Time & Duration
  if (options.dwellTime) {
    const dtRows: (string | number)[][] = [
      ['PLPARK OPERATIONS REPORT — DURATION & DWELL TIME BREAKDOWN'],
      ['Average Dwell Duration:', formatDuration(kpis.avgDwellMinutes)],
      [],
      ['DURATION BRACKET', 'SESSION COUNT', 'PERCENTAGE OF TOTAL', 'TOTAL DWELL HOURS (EST.)'],
      ...dwellData.map((b) => [
        b.label,
        b.count,
        `${(b.percentage * 100).toFixed(1)}%`,
        +(b.totalMinutes / 60).toFixed(1),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(dtRows);
    ws['!cols'] = autoColWidths(dtRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Duration Analysis');
  }

  // 5. Segmentation
  if (options.segmentation) {
    const totalUsers = conceptSegments.reduce((s, c) => s + c.value, 0);
    const totalVehicles = vehicleSegments.reduce((s, v) => s + v.value, 0);

    const segRows: (string | number)[][] = [
      ['PLPARK OPERATIONS REPORT — USER & VEHICLE SEGMENTATION'],
      [],
      ['CONCEPT / USER TYPE', 'SESSIONS', 'SHARE %'],
      ...conceptSegments.map((c) => [c.label, c.value, totalUsers > 0 ? `${((c.value / totalUsers) * 100).toFixed(1)}%` : '0%']),
      [],
      ['VEHICLE TYPE', 'SESSIONS', 'SHARE %'],
      ...vehicleSegments.map((v) => [v.label, v.value, totalVehicles > 0 ? `${((v.value / totalVehicles) * 100).toFixed(1)}%` : '0%']),
    ];
    const ws = XLSX.utils.aoa_to_sheet(segRows);
    ws['!cols'] = autoColWidths(segRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Segmentation');
  }

  // 6. Session Records (Filtered data if requested)
  if (options.sessionRecords) {
    const paymentMap = new Map<string, PaymentRow>();
    payments.forEach((p) => {
      if (p.session_id) paymentMap.set(p.session_id, p);
    });

    const sessRows: (string | number)[][] = [
      ['PLPARK OPERATIONS REPORT — SESSIONS DATA LOG (FILTERED)'],
      ['Range:', `${formattedStart} to ${formattedEnd}`],
      [],
      ['SESSION ID', 'PLATE NUMBER', 'USER CONCEPT', 'VEHICLE TYPE', 'ENTRY TIME', 'EXIT TIME', 'DURATION (MINS)', 'FEE (PHP)', 'PAYMENT METHOD', 'PAYMENT STATUS'],
      ...sessions.map((s) => {
        const p = paymentMap.get(s.id);
        const mins = s.exit_time ? Math.round((new Date(s.exit_time).getTime() - new Date(s.entry_time).getTime()) / 60_000) : '';
        return [
          s.id,
          s.plate_number,
          s.concept === 'B' || s.app_user_id ? 'Registered (Concept B)' : 'Public (Concept A)',
          s.vehicle_type,
          formatReadableDateTime(s.entry_time),
          s.exit_time ? formatReadableDateTime(s.exit_time) : 'Active',
          mins,
          p ? Number(p.total_amount) || 0 : 0,
          p?.payment_method || '—',
          p?.status || (s.status === 'active' ? 'active' : '—'),
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(sessRows);
    ws['!cols'] = autoColWidths(sessRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Sessions Log');
  }

  // Download cleanly
  const filename = `PLPark_Analytics_${toLocalISODate(new Date(filters.startDate))}_to_${toLocalISODate(new Date(filters.endDate))}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function Statistics() {
  // -------- Global Filter State --------
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
  const [rtCustomRangeActive, setRtCustomRangeActive] = useState(false);
  const [rtCardStart, setRtCardStart] = useState('');
  const [rtCardEnd, setRtCardEnd] = useState('');
  const [rtCardInterval, setRtCardInterval] = useState<AggInterval>('daily');

  // -------- Duration Analysis Card State --------
  const [durationGranularity, setDurationGranularity] = useState<DurationGranularity>('30m');
  const [durationMinMins, setDurationMinMins] = useState<number>(0);
  const [durationMaxMins, setDurationMaxMins] = useState<number>(1440); // 24 hours
  const [durationTimeOfDay, setDurationTimeOfDay] = useState<TimeOfDayFilter>('all');
  const [selectedDurationBucket, setSelectedDurationBucket] = useState<string | null>(null);

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

  // Initialize Card Range to match Global Filter
  useEffect(() => {
    if (!rtCustomRangeActive) {
      setRtCardStart(filters.startDate);
      setRtCardEnd(filters.endDate);
      setRtCardInterval(filters.interval);
    }
  }, [filters.startDate, filters.endDate, filters.interval, rtCustomRangeActive]);

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
    setRtCustomRangeActive(false);
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

        // Calculate previous comparison window
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

  // -------- KPI Calculations (ALPR Performance removed) --------
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
  // REVENUE & TRAFFIC TIME-SERIES (Adjustable Time & Range)
  // ============================================================

  const activeRtRange = useMemo(() => {
    return {
      start: rtCustomRangeActive && rtCardStart ? rtCardStart : filters.startDate,
      end: rtCustomRangeActive && rtCardEnd ? rtCardEnd : filters.endDate,
      interval: rtCustomRangeActive && rtCardInterval ? rtCardInterval : filters.interval,
    };
  }, [rtCustomRangeActive, rtCardStart, rtCardEnd, rtCardInterval, filters.startDate, filters.endDate, filters.interval]);

  const rtTimeSeriesData = useMemo(() => {
    const start = new Date(activeRtRange.start);
    const end = new Date(activeRtRange.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

    const buckets: { label: string; revenue: number; sessions: number; entries: number; exits: number }[] = [];
    const interval = activeRtRange.interval;
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
  }, [filteredSessions, filteredPayments, filteredRecognitions, activeRtRange]);

  // Aggregate stats specifically for the Revenue & Traffic card
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

  // Active inspected interval
  const activeRtInterval = useMemo(() => {
    if (rtSelectedIntervalIdx != null && rtTimeSeriesData[rtSelectedIntervalIdx]) {
      return rtTimeSeriesData[rtSelectedIntervalIdx];
    }
    return rtTimeSeriesData.length > 0 ? rtTimeSeriesData[rtTimeSeriesData.length - 1] : null;
  }, [rtSelectedIntervalIdx, rtTimeSeriesData]);

  // ============================================================
  // DURATION ANALYSIS (Adjustable Time Granularity & Filters)
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
      // standard
      rawBuckets = [
        { label: '<30m (Quick)', min: 0, max: 30 },
        { label: '30m–2h (Short)', min: 30, max: 120 },
        { label: '2h–5h (Medium)', min: 120, max: 300 },
        { label: '5h–12h (Extended)', min: 300, max: 720 },
        { label: '12h+ (Overnight)', min: 720, max: Infinity },
      ];
    }

    // Apply time-of-day and min/max duration filters
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
        if (durationTimeOfDay === 'night' && (hour >= 6)) return false;
      }
      return true;
    });

    const totalValid = validSessions.length;
    const bucketCounts = rawBuckets.map((b) => ({
      ...b,
      count: 0,
      totalMinutes: 0,
      percentage: 0,
    }));

    validSessions.forEach((s) => {
      const mins = (new Date(s.exit_time!).getTime() - new Date(s.entry_time).getTime()) / 60_000;
      for (const b of bucketCounts) {
        if (mins >= b.min && mins < b.max) {
          b.count++;
          b.totalMinutes += mins;
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
  }, [filteredSessions, durationGranularity, durationMinMins, durationMaxMins, durationTimeOfDay]);

  // ============================================================
  // PEAK HOURS & SEGMENTATION
  // ============================================================

  const peakHoursData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      label: `${String(i).padStart(2, '0')}`,
      entries: 0,
      exits: 0,
    }));
    filteredRecognitions.forEach((r) => {
      const h = new Date(r.created_at).getHours();
      if (r.direction === 'entry') hours[h].entries++;
      else hours[h].exits++;
    });
    return hours;
  }, [filteredRecognitions]);

  const peakHour = useMemo(() => {
    return peakHoursData.reduce((peak, h, i) => (h.entries + h.exits > peakHoursData[peak].entries + peakHoursData[peak].exits ? i : peak), 0);
  }, [peakHoursData]);

  const conceptSegments = useMemo(() => {
    const registered = filteredSessions.filter((s) => s.concept === 'B' || s.app_user_id).length;
    const guest = filteredSessions.length - registered;
    return [
      { label: 'Registered (Concept B)', value: registered, color: '#6366f1' },
      { label: 'Guest / Public (Concept A)', value: guest, color: '#f59e0b' },
    ];
  }, [filteredSessions]);

  const vehicleSegments = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredSessions.forEach((s) => {
      const t = s.vehicle_type || 'unknown';
      counts[t] = (counts[t] || 0) + 1;
    });
    const colors: Record<string, string> = {
      car: '#3b82f6',
      motorcycle: '#10b981',
      bus: '#f59e0b',
      truck: '#ef4444',
      van: '#8b5cf6',
      unknown: '#94a3b8',
    };
    return Object.entries(counts).map(([type, count]) => ({
      label: type.charAt(0).toUpperCase() + type.slice(1),
      value: count,
      color: colors[type] || '#94a3b8',
    }));
  }, [filteredSessions]);

  // ============================================================
  // EXPORT HANDLER
  // ============================================================

  const handleExecuteExport = useCallback(() => {
    void exportCustomExcel(
      filters,
      kpis,
      rtTimeSeriesData,
      peakHoursData,
      durationBuckets.buckets,
      conceptSegments,
      vehicleSegments,
      filteredSessions,
      filteredPayments,
      exportOptions,
    );
    setExportModalOpen(false);
  }, [filters, kpis, rtTimeSeriesData, peakHoursData, durationBuckets.buckets, conceptSegments, vehicleSegments, filteredSessions, filteredPayments, exportOptions]);

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

  const lastUpdated = updatedAt
    ? `Live Sync: ${updatedAt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`
    : '';

  const activeFilterCount = [
    filters.concept !== 'all',
    filters.vehicleType !== 'all',
    filters.payMethod !== 'all',
    filters.payStatus !== 'all',
    filters.gate !== 'all',
    !!filters.plateSearch,
  ].filter(Boolean).length;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <main className="stat-page">
      {/* ===== HEADER ===== */}
      <header className="stat-header">
        <div className="stat-header-left">
          <div className="stat-eyebrow">
            <Activity size={14} /> OPERATIONS INTELLIGENCE
          </div>
          <h1>Statistics & Analytics</h1>
          <p>Revenue, traffic volume, duration analysis, and operational performance metrics.</p>
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

      {/* ===== FILTER BAR ===== */}
      <section className="stat-filter-bar" aria-label="Filters and Range Selection">
        <div className="stat-filter-bar-row">
          {/* Preset Buttons */}
          <div className="stat-presets">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`stat-preset-btn ${filters.preset === p.key ? 'active' : ''}`}
                onClick={() => updateFilter('preset', p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="stat-filter-divider" />

          {/* Formatted Date Range Pickers */}
          <div className="stat-date-inputs">
            <div className="stat-date-input-group">
              <span className="stat-date-tag">From</span>
              <input
                type="datetime-local"
                className="stat-date-field"
                value={filters.startDate}
                onChange={(e) => updateFilter('startDate', e.target.value)}
                aria-label="Start Date and Time"
              />
            </div>
            <span className="stat-date-arrow">→</span>
            <div className="stat-date-input-group">
              <span className="stat-date-tag">To</span>
              <input
                type="datetime-local"
                className="stat-date-field"
                value={filters.endDate}
                onChange={(e) => updateFilter('endDate', e.target.value)}
                aria-label="End Date and Time"
              />
            </div>
          </div>

          <div className="stat-filter-divider" />

          {/* Aggregation Interval */}
          <div className="stat-select-inline">
            <BarChart3 size={14} className="stat-field-icon" />
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

          {/* More Filters Toggle */}
          <button
            type="button"
            className={`stat-filter-toggle ${showFilters ? 'active' : ''} ${activeFilterCount > 0 ? 'has-filters' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
          >
            <Filter size={14} />
            <span>Filters</span>
            {activeFilterCount > 0 && <span className="stat-filter-badge">{activeFilterCount}</span>}
          </button>

          {activeFilterCount > 0 && (
            <button type="button" className="stat-btn-ghost" onClick={resetFilters} title="Reset all filters">
              <RotateCcw size={13} />
              Reset
            </button>
          )}
        </div>

        {/* Expanded Filters Drawer */}
        {showFilters && (
          <div className="stat-filters-expanded">
            <label className="stat-field-block">
              <span>Concept Type</span>
              <select value={filters.concept} onChange={(e) => updateFilter('concept', e.target.value as ConceptFilter)}>
                <option value="all">All Concepts</option>
                <option value="A">Public (Concept A)</option>
                <option value="B">Registered (Concept B)</option>
              </select>
            </label>

            <label className="stat-field-block">
              <span>Vehicle Type</span>
              <select value={filters.vehicleType} onChange={(e) => updateFilter('vehicleType', e.target.value as VehicleFilter)}>
                <option value="all">All Vehicle Types</option>
                <option value="car">Car</option>
                <option value="motorcycle">Motorcycle</option>
                <option value="bus">Bus</option>
                <option value="truck">Truck</option>
                <option value="van">Van</option>
              </select>
            </label>

            <label className="stat-field-block">
              <span>Payment Method</span>
              <select value={filters.payMethod} onChange={(e) => updateFilter('payMethod', e.target.value as PayMethodFilter)}>
                <option value="all">All Payment Methods</option>
                <option value="cash">Cash</option>
                <option value="gcash">GCash</option>
                <option value="card">Credit / Debit Card</option>
                <option value="wallet">Driver In-App Wallet</option>
              </select>
            </label>

            <label className="stat-field-block">
              <span>Payment Status</span>
              <select value={filters.payStatus} onChange={(e) => updateFilter('payStatus', e.target.value as PayStatusFilter)}>
                <option value="all">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="refunded">Refunded</option>
              </select>
            </label>

            <label className="stat-field-block">
              <span>Gate / Direction</span>
              <select value={filters.gate} onChange={(e) => updateFilter('gate', e.target.value as GateFilter)}>
                <option value="all">All Gates (Entry & Exit)</option>
                <option value="entrance">Entrance Gate</option>
                <option value="exit">Exit Gate</option>
              </select>
            </label>

            <div className="stat-field-block stat-search-block">
              <span>Search Plate</span>
              <div className="stat-search-wrap">
                <Search size={14} className="stat-field-icon" />
                <input
                  type="text"
                  placeholder="e.g. ABC 1234…"
                  value={filters.plateSearch}
                  onChange={(e) => updateFilter('plateSearch', e.target.value)}
                />
                {filters.plateSearch && (
                  <button type="button" className="stat-search-clear" onClick={() => updateFilter('plateSearch', '')}>
                    <X size={12} />
                  </button>
                )}
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
          {/* ===== 4 KPI CARDS (ALPR REMOVED) ===== */}
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

          {/* ===== CHARTS & PANELS ===== */}
          <section className="stat-charts-grid">

            {/* ===== PANEL 1: REVENUE & TRAFFIC (ADVANCED WITH TIME/DATE ADJUSTMENT & SPECIFIC VOLUMES) ===== */}
            <article className="stat-panel stat-panel-wide">
              <div className="stat-panel-head">
                <div>
                  <span className="stat-panel-kicker">FINANCIAL & CAPACITY TRENDS</span>
                  <h2>Revenue & Vehicle Volume Analysis</h2>
                  <p className="stat-panel-sub">
                    View specific collected amounts, vehicle volume counts, and drill into custom date & time windows.
                  </p>
                </div>

                {/* View Mode Toggle */}
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
                    className={`stat-action-btn ${rtCustomRangeActive ? 'active' : ''}`}
                    onClick={() => setRtCustomRangeActive((v) => !v)}
                    title="Customize date and time range specifically for this chart"
                  >
                    <Sliders size={13} />
                    {rtCustomRangeActive ? 'Custom Time Active' : 'Adjust Time'}
                  </button>

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

              {/* Card-Level Custom Date/Time Adjuster */}
              {rtCustomRangeActive && (
                <div className="stat-rt-custom-range">
                  <div className="stat-rt-range-info">
                    <Clock3 size={14} />
                    <span>Card Specific Date & Time Window:</span>
                  </div>
                  <div className="stat-date-inputs">
                    <div className="stat-date-input-group">
                      <span className="stat-date-tag">From</span>
                      <input
                        type="datetime-local"
                        value={rtCardStart}
                        onChange={(e) => setRtCardStart(e.target.value)}
                      />
                    </div>
                    <span className="stat-date-arrow">→</span>
                    <div className="stat-date-input-group">
                      <span className="stat-date-tag">To</span>
                      <input
                        type="datetime-local"
                        value={rtCardEnd}
                        onChange={(e) => setRtCardEnd(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="stat-select-inline">
                    <select
                      value={rtCardInterval}
                      onChange={(e) => setRtCardInterval(e.target.value as AggInterval)}
                    >
                      <option value="hourly">Hourly</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="stat-btn-ghost"
                    onClick={() => {
                      setRtCardStart(filters.startDate);
                      setRtCardEnd(filters.endDate);
                      setRtCardInterval(filters.interval);
                    }}
                  >
                    Sync to Page Filter
                  </button>
                </div>
              )}

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
                  <span className="stat-rt-active-tag">Period: <strong>{activeRtInterval.label}</strong></span>
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
                    height={230}
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

              {/* Expandable Specific Amount & Volume Table */}
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

            {/* ===== PANEL 2: DURATION ANALYSIS (SPECIFIC & ADJUSTABLE TIME) ===== */}
            <article className="stat-panel">
              <div className="stat-panel-head">
                <div>
                  <span className="stat-panel-kicker">DURATION ANALYSIS</span>
                  <h2>Dwell Time Breakdown</h2>
                  <p className="stat-panel-sub">Adjust time intervals and filter session turnaround periods.</p>
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
                </div>

                <div className="stat-duration-control-row">
                  <span className="stat-control-label">Entry Time:</span>
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
                    height={180}
                    formatTooltip={(item, idx) => {
                      const b = durationBuckets.buckets[idx];
                      return `${b.label}: ${b.count} vehicles (${(b.percentage * 100).toFixed(1)}%)`;
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
                          <strong>{numberFmt.format(b.count)}</strong>
                          <span className="stat-duration-pct">{percentFmt.format(b.percentage)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="stat-empty-chart">No completed parking sessions match the criteria</div>
              )}
            </article>

            {/* ===== PANEL 3: PEAK HOURS ===== */}
            <article className="stat-panel">
              <div className="stat-panel-head">
                <div>
                  <span className="stat-panel-kicker">HOURLY DEMAND</span>
                  <h2>Peak Hours Distribution</h2>
                  <p className="stat-panel-sub">Gate volume across the 24 hours of the day.</p>
                </div>
                <Clock3 size={18} className="stat-head-icon" />
              </div>

              {loading ? (
                <div className="stat-chart-loading" />
              ) : peakHoursData.some((h) => h.entries + h.exits > 0) ? (
                <>
                  <div className="stat-peak-callout">
                    <span>Highest Activity Period</span>
                    <strong>
                      {String(peakHour).padStart(2, '0')}:00 – {String((peakHour + 1) % 24).padStart(2, '0')}:00
                    </strong>
                    <em>{numberFmt.format(peakHoursData[peakHour].entries + peakHoursData[peakHour].exits)} total gate events</em>
                  </div>

                  <BarChartSimple
                    data={peakHoursData.map((h) => ({ label: h.label, value: h.entries }))}
                    barColor="#3b82f6"
                    secondaryData={peakHoursData.map((h) => ({ label: h.label, value: h.exits }))}
                    secondaryColor="#f59e0b"
                    height={160}
                    formatTooltip={(_, i) => {
                      const h = peakHoursData[i];
                      return `${h.label}:00\nEntries: ${h.entries}\nExits: ${h.exits}`;
                    }}
                  />

                  <div className="stat-chart-footnote">
                    <div className="stat-panel-meta">
                      <span className="stat-legend-item">
                        <span className="stat-legend-dot" style={{ background: '#3b82f6' }} />
                        Entries
                      </span>
                      <span className="stat-legend-item">
                        <span className="stat-legend-dot" style={{ background: '#f59e0b' }} />
                        Exits
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="stat-empty-chart">No hourly activity records found</div>
              )}
            </article>

            {/* ===== PANEL 4: USER & VEHICLE SEGMENTATION ===== */}
            <article className="stat-panel">
              <div className="stat-panel-head">
                <div>
                  <span className="stat-panel-kicker">AUDIENCE & FLEET</span>
                  <h2>User & Vehicle Breakdown</h2>
                  <p className="stat-panel-sub">Concept A (Public) vs Concept B (Registered) and vehicle types.</p>
                </div>
                <PieChart size={18} className="stat-head-icon" />
              </div>

              {loading ? (
                <div className="stat-chart-loading" />
              ) : filteredSessions.length > 0 ? (
                <div className="stat-donuts-row">
                  <DonutChart segments={conceptSegments} size={135} label="Concept" />
                  <DonutChart segments={vehicleSegments} size={135} label="Fleet" />
                </div>
              ) : (
                <div className="stat-empty-chart">No parking sessions in this period</div>
              )}
            </article>

          </section>
        </>
      )}

      {/* ===== EXPORT SELECTION MODAL ===== */}
      {exportModalOpen && (
        <div className="stat-modal-backdrop" onClick={() => setExportModalOpen(false)}>
          <div className="stat-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="stat-modal-head">
              <div className="stat-modal-title">
                <FileSpreadsheet size={20} className="stat-modal-icon" />
                <div>
                  <h2>Export Excel Report</h2>
                  <p>Select which data tables to include in your customized workbook (.xlsx).</p>
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
              {/* Range Confirmation Box */}
              <div className="stat-modal-range-card">
                <div className="stat-modal-range-header">
                  <CalendarDays size={15} />
                  <span>Selected Date & Time Range to Export</span>
                </div>
                <div className="stat-modal-range-dates">
                  <strong>{formatReadableDateTime(filters.startDate)}</strong>
                  <span>to</span>
                  <strong>{formatReadableDateTime(filters.endDate)}</strong>
                </div>
                <div className="stat-modal-range-meta">
                  <span>Interval: <strong>{filters.interval.toUpperCase()}</strong></span>
                  <span>Concept: <strong>{filters.concept === 'all' ? 'All' : filters.concept}</strong></span>
                  <span>Vehicles: <strong>{filters.vehicleType}</strong></span>
                </div>
              </div>

              {/* Table Selection Checkboxes */}
              <div className="stat-modal-select-controls">
                <span>Select Data Sheets:</span>
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
                        revenueTraffic: false,
                        peakHours: false,
                        dwellTime: false,
                        segmentation: false,
                        sessionRecords: false,
                      })
                    }
                  >
                    Summary Only
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
                    <strong>Executive Summary</strong>
                    <span>Total Revenue, Vehicle Volume, Turnaround, Occupancy, and Active Filter Parameters.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.revenueTraffic}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, revenueTraffic: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>Revenue & Traffic Time-Series</strong>
                    <span>Specific interval amounts, vehicle volume counts, gate entries & exits, and summary totals.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.peakHours}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, peakHours: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>24-Hour Peak Hours Distribution</strong>
                    <span>Gate entries, exits, hourly demand, and peak period identifier.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.dwellTime}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, dwellTime: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>Duration & Dwell Time Breakdown</strong>
                    <span>Configured duration brackets, session counts, percentages, and accumulated hours.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.segmentation}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, segmentation: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>User & Vehicle Segmentation</strong>
                    <span>Concept A vs Concept B split and vehicle classification breakdown.</span>
                  </div>
                </label>

                <label className="stat-modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportOptions.sessionRecords}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, sessionRecords: e.target.checked }))}
                  />
                  <div className="stat-modal-option-text">
                    <strong>Raw Parking Sessions Data (Filtered)</strong>
                    <span>Detailed session rows with plate numbers, timestamps, fees, and payment status.</span>
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
