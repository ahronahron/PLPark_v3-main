/**
 * Layout.tsx — Application Shell Components
 *
 * This module exports layout components that form the
 * structural skeleton of the admin dashboard:
 *
 * 1. **Sidebar** — Left navigation panel with branding, collapsible mode, nav items, and settings
 * 2. **Topbar** — Top header with page title, notifications, and user profile dropdown
 * 3. **PageContainer** — Content wrapper that applies consistent padding
 */
import { useState, useEffect, type ReactNode } from 'react';
import {
  IconDashboard,
  IconChart,
  IconGrid,
  IconSettings,
  IconBell,
  IconLogs,
  IconChevronLeft,
  IconChevronRight
} from '@/components/Icons';

/**
 * SidebarProps — Props interface for the Sidebar component.
 */
interface SidebarProps {
  currentPage: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: (page: string) => void;
  onOpenSettings: () => void;
}

/**
 * navItems — Configuration array defining all sidebar navigation items.
 */
const navItems = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'slots', label: 'Slot Management', Icon: IconGrid },
  { id: 'statistics', label: 'Statistics', Icon: IconChart },
  { id: 'logs', label: 'Logs', Icon: IconLogs },
];

/**
 * Sidebar — Collapsible left-side navigation panel for the admin dashboard.
 */
export function Sidebar({
  currentPage,
  isCollapsed,
  onToggleCollapse,
  onNavigate,
  onOpenSettings
}: SidebarProps) {
  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Branding section — logo and toggle button */}
      <div className="sidebar-brand">
        <img src="/plp.png" alt="Logo" className="sidebar-logo" />
        {!isCollapsed && (
          <div className="sidebar-brand-text">
            <div className="sidebar-title">PLPark</div>
            <div className="sidebar-subtitle">Admin Console</div>
          </div>
        )}
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
        </button>
      </div>

      {/* Navigation items */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={isCollapsed ? item.label : undefined}
          >
            <item.Icon size={18} className="nav-icon" />
            {!isCollapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Footer section with Settings access */}
      <div className="sidebar-bottom">
        <button
          className="sidebar-footer-btn"
          onClick={onOpenSettings}
          title="Settings"
        >
          <IconSettings size={18} className="nav-icon" />
          {!isCollapsed && <span className="sidebar-footer-btn-label">Settings</span>}
        </button>
      </div>
    </aside>
  );
}

/**
 * TopbarProps — Props interface for the Topbar component.
 */
interface TopbarProps {
  title: string;
  notifications: { id: string; type: string; title: string; message: string | null; created_at: string; is_read: boolean }[];
  onMarkAllRead: () => void;
  onSignOut: () => void;
}

/**
 * Topbar — Top header bar for the admin dashboard (Clean layout without search bar).
 */
export function Topbar({ title, notifications, onMarkAllRead, onSignOut }: TopbarProps) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    setIsProfileOpen(false);
  }, [title]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <header className="topbar">
      {/* Dynamic page title */}
      <div className="topbar-title">{title}</div>

      <div className="topbar-right">
        {/* Notification bell with unread count and dropdown */}
        <div className="topbar-notifications">
          <button className="icon-btn notif-btn" title="Notifications">
            {unreadCount > 0 && (
              <span className="notif-count">{unreadCount}</span>
            )}
            <IconBell size={18} />
          </button>

          {/* Notification dropdown panel */}
          <div className="notif-dropdown">
            <div className="notif-header">
              <span>Notifications</span>
              <button onClick={onMarkAllRead}>Mark all read</button>
            </div>
            <div className="notif-list">
              {notifications.length === 0 && <div className="notif-empty">No notifications</div>}
              {notifications.slice(0, 8).map(n => (
                <div key={n.id} className={`notif-item ${n.is_read ? 'read' : 'unread'}`}>
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
 */
export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`page-container ${className}`}>{children}</div>;
}
