/**
 * Icons.tsx — Custom SVG Icon Components
 *
 * This module provides 25+ reusable inline SVG icon components
 * used throughout the PLPark admin dashboard. All icons share
 * a common base configuration (stroke-based, 24×24 viewBox)
 * and accept consistent props for size and className.
 *
 * Using inline SVGs instead of an icon library like Font Awesome
 * or Lucide keeps the bundle size minimal and avoids external
 * dependencies for icons.
 *
 * Each icon is a functional component that renders an <svg>
 * element with pre-defined path data.
 */

/**
 * IconProps — Shared props interface for all icon components.
 * @property size — Width and height in pixels (default varies per icon)
 * @property className — Optional CSS class for styling
 */
interface IconProps {
  size?: number;
  className?: string;
}

/**
 * base — Creates the common SVG attributes shared by all icons.
 *
 * Returns an object of SVG props including:
 * - Fixed 24×24 viewBox for consistent coordinate space
 * - Stroke-based rendering (no fill by default)
 * - 1.8px stroke width for a clean, modern look
 * - Rounded line caps and joins for smooth corners
 *
 * @param size — The pixel dimensions for width and height
 * @returns SVG attribute object to spread onto <svg> elements
 */
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/** Dashboard icon — Four rectangles forming a grid layout */
export const IconDashboard = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
);

/** Payment icon — Credit card with horizontal line and detail */
export const IconPayment = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></svg>
);

/** Users icon — Two person silhouettes for user management */
export const IconUsers = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);

/** Chart icon — Line chart with upward trend */
export const IconChart = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-5" /></svg>
);

/** Grid icon — 2×2 grid for slot management */
export const IconGrid = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
);

/** Settings icon — Gear/cog wheel for configuration */
export const IconSettings = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
);

/** Bell icon — Notification bell for the topbar */
export const IconBell = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
);

/** Search icon — Magnifying glass for search inputs */
export const IconSearch = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
);

/** Car icon — Side view of a sedan for vehicle type indicators */
export const IconCar = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M5 13L7 8h10l2 5" /><rect x="3" y="13" width="18" height="6" rx="1" /><circle cx="7" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /><path d="M5 16h2M17 16h2" /></svg>
);

/** Motorcycle icon — Side view of a motorcycle for vehicle type indicators */
export const IconMotorcycle = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}><circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" /><path d="M5 18l4-6h6l2 3" /><path d="M15 9h3l1 3" /><path d="M9 12l1-3h4" /></svg>
);

/** Camera icon — Camera body with lens for camera views */
export const IconCamera = ({ size = 24, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
);

/** Check icon — Checkmark for confirmations and success states */
export const IconCheck = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M20 6L9 17l-5-5" /></svg>
);

/** View icon — Eye for "view details" actions */
export const IconView = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);

/** Edit icon — Pencil and paper for edit actions */
export const IconEdit = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" /></svg>
);

/** Trash icon — Trash can for delete actions */
export const IconTrash = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
);

/** Key icon — Key for password reset actions */
export const IconKey = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 8-8M16 6l2 2M19 3l2 2" /></svg>
);

/** Refund icon — Circular arrow for refund/undo actions */
export const IconRefund = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></svg>
);

/** Print icon — Printer for receipt printing */
export const IconPrint = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></svg>
);

/** Plus icon — Addition symbol for "add new" actions */
export const IconPlus = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
);

/** Download icon — Downward arrow with tray for export actions */
export const IconDownload = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></svg>
);

/** Lock icon — Closed padlock for reserved/locked states */
export const IconLock = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);

/** Unlock icon — Open padlock for unlocked states */
export const IconUnlock = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
);

/** Ban icon — Circle with diagonal line for disable/block actions */
export const IconBan = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></svg>
);

/** Arrow Left icon — Left-pointing arrow for navigation */
export const IconArrowLeft = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
);

/** Arrow Right icon — Right-pointing arrow for navigation */
export const IconArrowRight = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
);

/** Clock icon — Circle with clock hands for time-related displays */
export const IconClock = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
);

/** Activity icon — Heartbeat/ECG line for activity monitoring */
export const IconActivity = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
);

/** Camera Config icon — Camera with viewfinder for settings camera tab */
export const IconCameraConfig = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><rect x="2" y="6" width="20" height="14" rx="2" /><circle cx="12" cy="13" r="3" /><path d="M8 6V4h8v2" /></svg>
);

/** Scan icon — Corner brackets for plate scanning/recognition */
export const IconScan = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></svg>
);

/** Rates icon — Dollar/peso sign in a circle for pricing */
export const IconRates = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="10" /><path d="M12 6v12M9.5 9h5a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h5" /></svg>
);

/** Receipt icon — Zigzag-bottom paper for receipts */
export const IconReceipt = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M4 2v20l2-2 2 2 2-2 2 2 2-2 2 2V2l-2 2-2-2-2 2-2-2-2 2-2-2Z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>
);

/** Backup icon — Circular arrow for backup/restore operations */
export const IconBackup = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 6.3 2.6L21 8" /><path d="M21 3v5h-5" /></svg>
);

/** Shield icon — Shield shape for permissions/security settings */
export const IconShield = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>
);

/** Notifications icon — Bell for notification settings (duplicate of IconBell for semantic clarity) */
export const IconNotifications = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
);

/** Logs icon — Document with lines for activity log viewing */
export const IconLogs = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
);

/** Chevron Left icon */
export const IconChevronLeft = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="m15 18-6-6 6-6" /></svg>
);

/** Chevron Right icon */
export const IconChevronRight = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="m9 18 6-6-6-6" /></svg>
);

/** Sidebar Toggle icon */
export const IconSidebar = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></svg>
);

