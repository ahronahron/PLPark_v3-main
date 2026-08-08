import { useState } from 'react';
import { Sidebar, Topbar, PageContainer } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Payments } from '@/pages/Payments';
import { UserManagement } from '@/pages/UserManagement';
import { Statistics } from '@/pages/Statistics';
import { SlotManagement } from '@/pages/SlotManagement';
import { Settings } from '@/pages/Settings';
import { MobileApp } from '@/pages/MobileApp';
import { useNotifications } from '@/lib/hooks';

const pageTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  payments: 'Payment & Receipt',
  users: 'User Management',
  statistics: 'Parking Statistics',
  slots: 'Slot Management',
  settings: 'System Settings',
};

function App() {
  const [page, setPage] = useState('dashboard');
  const [view, setView] = useState<'admin' | 'mobile'>('admin');
  const { notifications, markAllRead } = useNotifications();

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

  return (
    <>
      <div className="app-toggle-bar">
        <button className="app-toggle-btn active">Admin Dashboard</button>
        <button className="app-toggle-btn" onClick={() => setView('mobile')}>Mobile App</button>
      </div>
      <div className="app-shell">
        <Sidebar currentPage={page} onNavigate={setPage} />
        <div className="main-area">
          <Topbar title={pageTitles[page] || ''} notifications={notifications} onMarkAllRead={markAllRead} />
          <PageContainer>
            {page === 'dashboard' && <Dashboard />}
            {page === 'payments' && <Payments />}
            {page === 'users' && <UserManagement />}
            {page === 'statistics' && <Statistics />}
            {page === 'slots' && <SlotManagement />}
            {page === 'settings' && <Settings />}
          </PageContainer>
        </div>
      </div>
    </>
  );
}

export default App;
