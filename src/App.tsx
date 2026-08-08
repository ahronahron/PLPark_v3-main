/**
 * App.tsx — Root Application Component
 *
 * This is the top-level component that controls the entire
 * application layout and routing. It manages:
 *
 * 1. **View Switching** — Toggles between the Admin Dashboard
 *    and the Mobile (Public) App using a top toggle bar.
 *
 * 2. **Page Routing** — Uses client-side state (no URL router)
 *    to switch between admin pages: Dashboard, Payments,
 *    User Management, Statistics, Slot Management, and Settings.
 *
 * 3. **Notification System** — Fetches and manages system
 *    notifications passed to the Topbar component.
 */
import { useState, useEffect } from 'react';
import { Sidebar, Topbar, PageContainer } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Statistics } from '@/pages/Statistics';
import { SlotManagement } from '@/pages/SlotManagement';
import { Logs } from '@/pages/Logs';
import { Settings } from '@/pages/Settings';
import { MobileApp } from '@/pages/MobileApp';
import { useNotifications } from '@/lib/hooks';

/**
 * pageTitles — Maps internal page IDs to human-readable titles
 * displayed in the Topbar header. Keys correspond to the values
 * stored in the `page` state variable.
 */
const pageTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  slots: 'Slot Management',
  statistics: 'Parking Statistics',
  logs: 'Logs & Management',
};

/**
 * App — Root component for PLPark.
 *
 * State:
 * - `page`: Currently active admin page ID (defaults to 'dashboard').
 * - `view`: Whether showing 'admin' dashboard or 'mobile' public app.
 * - `sidebarCollapsed`: Whether the left sidebar navigation is collapsed.
 * - `isSettingsOpen`: Whether the floating settings modal overlay is open.
 *
 * @returns The complete application UI.
 */
function App() {
  /** Tracks which admin page is currently active */
  const [page, setPage] = useState('dashboard');

  /** Tracks whether the admin dashboard or mobile app is displayed */
  const [view, setView] = useState<'admin' | 'mobile'>('admin');

  /** Tracks if the sidebar navigation is collapsed */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  /** Tracks if the settings floating modal overlay is open */
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  /** Custom hook that fetches notifications from Supabase and provides a markAllRead function */
  const { notifications, markAllRead } = useNotifications();

  /**
   * Check User-Agent on mount to auto-route mobile browsers to the Mobile App view.
   */
  useEffect(() => {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    if (isMobile) {
      setView('mobile');
    }
  }, []);

  /**
   * handleSignOut — Simulates logging out of the admin panel.
   *
   * Asks for confirmation, then refreshes the application.
   */
  const handleSignOut = () => {
    if (confirm('Are you sure you want to sign out?')) {
      window.location.reload();
    }
  };

  /*
   * MOBILE VIEW
   * When the user switches to mobile mode via the toggle bar,
   * render the MobileApp component directly without the admin shell.
   */
  if (view === 'mobile') {
    return (
      <div style={{ minHeight: '100vh' }}>
        {/* Toggle bar allowing the user to switch back to Admin mode */}
        <div className="app-toggle-bar">
          <button className="app-toggle-btn" onClick={() => setView('admin')}>Admin Dashboard</button>
          <button className="app-toggle-btn active">Mobile App</button>
        </div>
        {/* Self-contained mobile/public web app component */}
        <MobileApp />
      </div>
    );
  }

  /*
   * ADMIN VIEW
   * Renders the full admin dashboard with:
   * - Toggle bar at the top for switching between Admin and Mobile views
   * - Sidebar navigation on the left
   * - Topbar with search, notifications, and user profile dropdown
   * - Main content area that conditionally renders the active page
   * - Floating Settings Modal overlay
   */
  return (
    <>
      {/* Toggle bar for Admin <-> Mobile switching */}
      <div className="app-toggle-bar">
        <button className="app-toggle-btn active">Admin Dashboard</button>
        <button className="app-toggle-btn" onClick={() => setView('mobile')}>Mobile App</button>
      </div>

      {/* Main application shell: sidebar + content area */}
      <div className="app-shell">
        {/* Left sidebar navigation — highlights current page, calls setPage on click */}
        <Sidebar
          currentPage={page}
          onNavigate={setPage}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        <div className="main-area">
          {/* Top header bar with page title, search, notifications, user profile and sign out handler */}
          <Topbar
            title={pageTitles[page] || ''}
            notifications={notifications}
            onMarkAllRead={markAllRead}
            onSignOut={handleSignOut}
          />

          {/* Page content area — renders the component matching the active page ID */}
          <PageContainer>
            {page === 'dashboard' && <Dashboard />}
            {page === 'slots' && <SlotManagement />}
            {page === 'statistics' && <Statistics />}
            {page === 'logs' && <Logs />}
          </PageContainer>
        </div>
      </div>

      {/* Floating settings modal overlay */}
      {isSettingsOpen && (
        <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="settings-container" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h2>System Settings</h2>
              <button className="close-btn" onClick={() => setIsSettingsOpen(false)} title="Close Settings">×</button>
            </div>
            <Settings />
          </div>
        </div>
      )}
    </>
  );
}

export default App;
