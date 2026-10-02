/**
 * App.tsx — Root Application Component
 *
 * This is the top-level component that controls the entire
 * application layout and routing. Admin views are gated by
 * a Supabase Auth session; the mobile app remains public.
 */
import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Sidebar, Topbar, PageContainer } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Statistics } from '@/pages/Statistics';
import { SlotManagement } from '@/pages/SlotManagement';
import { Logs } from '@/pages/Logs';
import { Settings } from '@/pages/Settings';
import { MobileApp } from '@/pages/MobileApp';
import { LoginPage } from '@/pages/LoginPage';
import { useNotifications } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

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
 * stampAdminLogin — Links the Auth user to the `users` profile row
 * by email / user_id and records last_login.
 */
async function stampAdminLogin(session: Session) {
  const authUser = session.user;
  const email = authUser.email;
  if (!email) return;

  const { data: existing } = await supabase
    .from('users')
    .select('id, user_id')
    .eq('email', email)
    .maybeSingle();

  if (!existing) return;

  await supabase
    .from('users')
    .update({
      user_id: existing.user_id || authUser.id,
      last_login: new Date().toISOString(),
    })
    .eq('id', existing.id);
}

/**
 * AdminShell — Dashboard chrome + pages. Mounted only when a
 * Supabase Auth session exists so data hooks run as `authenticated`.
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

  const handleSignOut = async () => {
    if (!confirm('Are you sure you want to sign out?')) return;
    await supabase.auth.signOut();
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
            onSignOut={handleSignOut}
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
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const userAgent = navigator.userAgent || navigator.vendor || (window as unknown as { opera?: string }).opera;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    if (isMobile) {
      setView('mobile');
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (!mounted) return;
      setSession(current);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'SIGNED_IN' && nextSession) {
        void stampAdminLogin(nextSession);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
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

  if (!authReady) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="sidebar-title">PLPark</div>
          <p className="login-copy">Loading session…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  return <AdminShell onSwitchToMobile={() => setView('mobile')} />;
}

export default App;
