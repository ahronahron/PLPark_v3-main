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
 * AdminShell — Dashboard chrome + pages.
 */
function AdminShell({ onSwitchToMobile }: { onSwitchToMobile: () => void }) {
  const [page, setPage] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('plp_sidebar_collapsed') === 'true';
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { notifications, markAllRead } = useNotifications();

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('plp_sidebar_collapsed', String(next));
      return next;
    });
  };

  return (
    <>
      <div className="app-toggle-bar">
        <button className="app-toggle-btn active">Admin Dashboard</button>
        <button className="app-toggle-btn" onClick={onSwitchToMobile}>Mobile App</button>
      </div>

      <div className="app-shell">
        <Sidebar
          currentPage={page}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onNavigate={setPage}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        <div className="main-area">
          <Topbar
            title={pageTitles[page] || ''}
            notifications={notifications}
            onMarkAllRead={markAllRead}
          />

          <PageContainer className={page === 'dashboard' ? 'dashboard-page-container' : ''}>
            {page === 'dashboard' && <Dashboard />}
            {page === 'slots' && <SlotManagement />}
            {page === 'statistics' && <Statistics />}
            {page === 'logs' && <Logs />}
          </PageContainer>
        </div>
      </div>

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

/**
 * App — Root component for PLPark.
 */
function App() {
  const [view, setView] = useState<'admin' | 'mobile'>('admin');

  useEffect(() => {
    const userAgent = navigator.userAgent || navigator.vendor || (window as unknown as { opera?: string }).opera || '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    if (isMobile) {
      setView('mobile');
    }
  }, []);

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

  return <AdminShell onSwitchToMobile={() => setView('mobile')} />;
}

export default App;
