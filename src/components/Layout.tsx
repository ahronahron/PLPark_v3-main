/**
 * Layout.tsx — Application Shell Components
 *
 * This module exports three layout components that form the
 * structural skeleton of the admin dashboard:
 *
 * 1. **Sidebar** — Left navigation panel with branding, nav items, settings, and collapse toggle
 * 2. **Topbar** — Top header with page title, search, notifications, and user profile dropdown
 * 3. **PageContainer** — Content wrapper that applies consistent padding and scrolling
 *
 * These components are composed in App.tsx to create the admin layout.
 */
import { useState, useEffect, type ReactNode } from 'react';
import { IconDashboard, IconChart, IconGrid, IconSettings, IconBell, IconSearch, IconLogs, IconArrowLeft, IconArrowRight } from '@/components/Icons';

/**
 * SidebarProps — Props interface for the Sidebar component.
 * @property currentPage — The currently active page ID for highlighting
 * @property onNavigate — Callback fired when a nav item is clicked
 * @property collapsed — Whether the sidebar is currently collapsed
 * @property onToggleCollapse — Callback to toggle collapsed state
 * @property onOpenSettings — Callback to open the settings modal
 */
interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
}

/**
 * navItems — Configuration array defining all sidebar navigation items.
 * Each item has:
 * - `id`: Internal page identifier (matches pageTitles keys in App.tsx)
 * - `label`: Display text shown in the sidebar
 * - `Icon`: SVG icon component rendered next to the label
 */
const navItems = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'slots', label: 'Slot Management', Icon: IconGrid },
  { id: 'statistics', label: 'Statistics', Icon: IconChart },
  { id: 'logs', label: 'Logs', Icon: IconLogs },
];

/**
 * Sidebar — Left-side navigation panel for the admin dashboard.
 *
 * Renders the application branding, a vertical list of navigation buttons,
 * and bottom controls for settings and sidebar collapse.
 *
 * @param currentPage — ID of the currently active page
 * @param onNavigate — Callback to switch to a different page
 * @param collapsed — Boolean showing if the sidebar is collapsed
 * @param onToggleCollapse — Callback to collapse/expand
 * @param onOpenSettings — Callback to open settings floating modal
 */
export function Sidebar({ currentPage, onNavigate, collapsed, onToggleCollapse, onOpenSettings }: SidebarProps) {
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
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
            title={collapsed ? item.label : undefined}
          >
            {/* Icon component with consistent 18px size */}
            <item.Icon size={18} className="nav-icon" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer section with Settings and Collapse buttons */}
      <div className="sidebar-bottom">
        <button
          className="sidebar-footer-btn"
          onClick={onOpenSettings}
          title="Settings"
        >
          <IconSettings size={18} className="nav-icon" />
          <span className="sidebar-footer-btn-label">Settings</span>
        </button>

        <button
          className="sidebar-footer-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {collapsed ? <IconArrowRight size={18} className="nav-icon" /> : <IconArrowLeft size={18} className="nav-icon" />}
          <span className="sidebar-footer-btn-label">Collapse</span>
        </button>
      </div>
    </aside>
  );
}

/**
 * TopbarProps — Props interface for the Topbar component.
 * @property title — Page title displayed on the left side
 * @property notifications — Array of notification objects for the bell dropdown
 * @property onMarkAllRead — Callback to mark all notifications as read
 * @property onSignOut — Callback fired when the user signs out
 */
interface TopbarProps {
  title: string;
  notifications: { id: string; type: string; title: string; message: string | null; created_at: string; is_read: boolean }[];
  onMarkAllRead: () => void;
  onSignOut: () => void;
}

/**
 * Topbar — Top header bar for the admin dashboard.
 *
 * Contains page title, search, notification bell, and user profile dropdown.
 *
 * @param title — The title of the currently active page
 * @param notifications — Array of notification objects from useNotifications hook
 * @param onMarkAllRead — Function to mark all notifications as read
 * @param onSignOut — Function to handle user sign out
 */
export function Topbar({ title, notifications, onMarkAllRead, onSignOut }: TopbarProps) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    setIsProfileOpen(false);
  }, [title]);

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

        {/* User profile trigger and dropdown */}
        <div className="profile-container">
          <div className="profile-trigger" onClick={() => setIsProfileOpen(!isProfileOpen)}>
            <div className="user-avatar">A</div>
            <div className="user-info">
              <div className="user-name">Admin</div>
              <div className="user-role">Administrator</div>
            </div>
          </div>
          {isProfileOpen && (
            <div className="profile-dropdown">
              <button className="dropdown-item" onClick={() => { setIsProfileOpen(false); onSignOut(); }}>
                Sign Out
              </button>
            </div>
          )}
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
