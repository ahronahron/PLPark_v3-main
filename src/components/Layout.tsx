/**
 * Layout.tsx — Application Shell Components
 *
 * This module exports three layout components that form the
 * structural skeleton of the admin dashboard:
 *
 * 1. **Sidebar** — Left navigation panel with branding, nav items, and system status
 * 2. **Topbar** — Top header with page title, search, notifications, and user profile
 * 3. **PageContainer** — Content wrapper that applies consistent padding and scrolling
 *
 * These components are composed in App.tsx to create the admin layout.
 */
import { type ReactNode } from 'react';
import { IconDashboard, IconPayment, IconUsers, IconChart, IconGrid, IconSettings, IconBell, IconSearch } from '@/components/Icons';

/**
 * SidebarProps — Props interface for the Sidebar component.
 * @property currentPage — The currently active page ID for highlighting
 * @property onNavigate — Callback fired when a nav item is clicked
 */
interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

/**
 * navItems — Configuration array defining all sidebar navigation items.
 * Each item has:
 * - `id`: Internal page identifier (matches pageTitles keys in App.tsx)
 * - `label`: Display text shown in the sidebar
 * - `Icon`: SVG icon component rendered next to the label
 *
 * The order here determines the visual order in the sidebar.
 */
const navItems = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'payments', label: 'Payments', Icon: IconPayment },
  { id: 'users', label: 'User Management', Icon: IconUsers },
  { id: 'statistics', label: 'Statistics', Icon: IconChart },
  { id: 'slots', label: 'Slot Management', Icon: IconGrid },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];

/**
 * Sidebar — Left-side navigation panel for the admin dashboard.
 *
 * Renders the application branding (logo + title), a vertical list
 * of navigation buttons, and a system status indicator at the bottom.
 *
 * The active page is highlighted with the 'active' CSS class.
 * Clicking a nav item calls `onNavigate` with the item's ID,
 * which updates the page state in App.tsx.
 *
 * @param currentPage — ID of the currently active page
 * @param onNavigate — Callback to switch to a different page
 */
export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* Branding section — logo image and app name */}
      <div className="sidebar-brand">
        <img src="/plp.png" alt="Logo" className="sidebar-logo" />
        <div>
          <div className="sidebar-title">SmartPark</div>
          <div className="sidebar-subtitle">Admin Console</div>
        </div>
      </div>

      {/* Navigation items — dynamically rendered from navItems config */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            /* Apply 'active' class when this item matches the current page */
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            {/* Icon component with consistent 18px size */}
            <item.Icon size={18} className="nav-icon" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer section — system online status indicator */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-label">System Status</div>
        <div className="sidebar-status-row">
          {/* Green dot indicating the system is operational */}
          <span className="status-dot status-online" />
          <span>Online</span>
        </div>
      </div>
    </aside>
  );
}

/**
 * TopbarProps — Props interface for the Topbar component.
 * @property title — Page title displayed on the left side
 * @property notifications — Array of notification objects for the bell dropdown
 * @property onMarkAllRead — Callback to mark all notifications as read
 */
interface TopbarProps {
  title: string;
  notifications: { id: string; type: string; title: string; message: string | null; created_at: string; is_read: boolean }[];
  onMarkAllRead: () => void;
}

/**
 * Topbar — Top header bar for the admin dashboard.
 *
 * Contains four sections from left to right:
 * 1. **Page Title** — Dynamic based on the current route
 * 2. **Search Bar** — Global search input with Ctrl+K shortcut hint
 * 3. **Notification Bell** — Shows unread count badge and dropdown with recent notifications
 * 4. **User Profile** — Displays admin avatar, name, and role
 *
 * The notification dropdown appears on hover/focus and shows the most
 * recent 8 notifications with read/unread styling.
 *
 * @param title — The title of the currently active page
 * @param notifications — Array of notification objects from useNotifications hook
 * @param onMarkAllRead — Function to mark all notifications as read
 */
export function Topbar({ title, notifications, onMarkAllRead }: TopbarProps) {
  return (
    <header className="topbar">
      {/* Dynamic page title */}
      <div className="topbar-title">{title}</div>

      <div className="topbar-right">
        {/* Global search input with icon and keyboard shortcut hint */}
        <div className="topbar-search">
          <IconSearch size={15} className="search-icon" />
          <input placeholder="Search..." />
          <span className="search-kbd">Ctrl K</span>
        </div>

        {/* Notification bell with unread count and dropdown */}
        <div className="topbar-notifications">
          <button className="icon-btn notif-btn" title="Notifications">
            {/* Unread count badge — only shown when there are unread notifications */}
            {notifications.filter(n => !n.is_read).length > 0 && (
              <span className="notif-count">{notifications.filter(n => !n.is_read).length}</span>
            )}
            <IconBell size={18} />
          </button>

          {/* Notification dropdown panel — appears on hover via CSS */}
          <div className="notif-dropdown">
            <div className="notif-header">
              <span>Notifications</span>
              {/* Button to mark all notifications as read */}
              <button onClick={onMarkAllRead}>Mark all read</button>
            </div>
            <div className="notif-list">
              {/* Empty state when no notifications exist */}
              {notifications.length === 0 && <div className="notif-empty">No notifications</div>}
              {/* Render up to 8 most recent notifications */}
              {notifications.slice(0, 8).map(n => (
                <div key={n.id} className={`notif-item ${n.is_read ? 'read' : 'unread'}`}>
                  {/* Colored dot indicating notification type (success/info/warning/error) */}
                  <span className={`notif-dot notif-${n.type}`} />
                  <div>
                    <div className="notif-item-title">{n.title}</div>
                    <div className="notif-item-msg">{n.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* User profile section — avatar initial, name, and role */}
        <div className="topbar-user">
          <div className="user-avatar">A</div>
          <div className="user-info">
            <div className="user-name">Admin</div>
            <div className="user-role">Administrator</div>
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * PageContainer — Wrapper component for page content.
 *
 * Applies consistent padding, scrolling behavior, and layout
 * constraints to whatever page component is rendered inside it.
 * Used in App.tsx to wrap the conditionally-rendered page components.
 *
 * @param children — The page component(s) to render inside the container
 */
export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="page-container">{children}</div>;
}
