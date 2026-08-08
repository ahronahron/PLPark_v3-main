import { type ReactNode } from 'react';
import { IconDashboard, IconPayment, IconUsers, IconChart, IconGrid, IconSettings, IconBell, IconSearch } from '@/components/Icons';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'payments', label: 'Payments', Icon: IconPayment },
  { id: 'users', label: 'User Management', Icon: IconUsers },
  { id: 'statistics', label: 'Statistics', Icon: IconChart },
  { id: 'slots', label: 'Slot Management', Icon: IconGrid },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/plp.png" alt="Logo" className="sidebar-logo" />
        <div>
          <div className="sidebar-title">SmartPark</div>
          <div className="sidebar-subtitle">Admin Console</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <item.Icon size={18} className="nav-icon" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-label">System Status</div>
        <div className="sidebar-status-row">
          <span className="status-dot status-online" />
          <span>Online</span>
        </div>
      </div>
    </aside>
  );
}

interface TopbarProps {
  title: string;
  notifications: { id: string; type: string; title: string; message: string | null; created_at: string; is_read: boolean }[];
  onMarkAllRead: () => void;
}

export function Topbar({ title, notifications, onMarkAllRead }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-right">
        <div className="topbar-search">
          <IconSearch size={15} className="search-icon" />
          <input placeholder="Search..." />
          <span className="search-kbd">Ctrl K</span>
        </div>
        <div className="topbar-notifications">
          <button className="icon-btn notif-btn" title="Notifications">
            {notifications.filter(n => !n.is_read).length > 0 && (
              <span className="notif-count">{notifications.filter(n => !n.is_read).length}</span>
            )}
            <IconBell size={18} />
          </button>
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

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="page-container">{children}</div>;
}
