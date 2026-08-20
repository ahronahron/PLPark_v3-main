/**
 * App.tsx — Root Application Component
 *
 * This is the top-level component that controls the entire
 * application layout and routing.
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
 * displayed in the Topbar header.
 */
const pageTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  slots: 'Slot Management',
  statistics: 'Parking Statistics',
  logs: 'Logs & Management',
};

/**
 * App — Root component for PLPark.
 */
function App() {
  /** Tracks which admin page is currently active */
  const [page, setPage] = useState('dashboard');

  /** Tracks whether the admin dashboard or mobile app is displayed */
  const [view, setView] = useState<'admin' | 'mobile'>('admin');

  /** Tracks if the sidebar is collapsed */
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('plp_sidebar_collapsed') === 'true';
  });

  /** Tracks if the settings floating modal overlay is open */
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  /** Custom hook that fetches notifications from Supabase and provides a markAllRead function */
  const { notifications, markAllRead } = useNotifications();

  /** Toggle sidebar collapse */
  const handleToggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('plp_sidebar_collapsed', String(next));
      return next;
    });
  };

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
   */
  const handleSignOut = () => {
    if (confirm('Are you sure you want to sign out?')) {
      window.location.reload();
    }
  };

  /*
   * MOBILE VIEW
   */
  if (view === 'mobile') {
    return (
      <div style={{ minHeight: '100vh' }}>
        <div className="app-toggle-bar">
          <button className="app-toggle-btn" onClick={() => setView('admin')}>Admin Dashboard</button>
          <button className="app-toggle-btn active">Mobile App</button>
        </div>
        <MobileApp />
      </div>
    );
  }

  /*
   * ADMIN VIEW
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
        {/* Left sidebar navigation — collapsible */}
        <Sidebar
          currentPage={page}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onNavigate={setPage}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        <div className="main-area">
          {/* Top header bar */}
          <Topbar
            title={pageTitles[page] || ''}
            notifications={notifications}
            onMarkAllRead={markAllRead}
            onSignOut={handleSignOut}
          />

          {/* Page content area */}
          <PageContainer className={page === 'dashboard' ? 'dashboard-page-container' : ''}>
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
