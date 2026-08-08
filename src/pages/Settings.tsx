import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  IconCameraConfig, IconScan, IconRates, IconReceipt, IconPayment, IconBackup,
  IconShield, IconNotifications, IconLogs, IconCheck, IconSearch, IconDownload
} from '@/components/Icons';

const sectionIcons: Record<string, any> = {
  camera: IconCameraConfig,
  plate: IconScan,
  rates: IconRates,
  receipt: IconReceipt,
  payment: IconPayment,
  backup: IconBackup,
  permissions: IconShield,
  notifications: IconNotifications,
  logs: IconLogs,
};

export function Settings() {
  const [activeSection, setActiveSection] = useState('camera');
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [cameras, setCameras] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    supabase.from('settings').select('key, value').then(({ data }) => {
      if (data) setSettings(Object.fromEntries(data.map((r: any) => [r.key, r.value])));
    });
    supabase.from('cameras').select('*').order('name').then(({ data }) => setCameras(data || []));
    supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => setLogs(data || []));
  }, []);

  const saveSetting = async (key: string, value: any) => {
    await supabase.from('settings').upsert({ key, value });
    setSaveMsg(`${key} saved`);
    setTimeout(() => setSaveMsg(''), 2000);
  };

  const filteredLogs = logs.filter(l =>
    l.user_name?.toLowerCase().includes(logSearch.toLowerCase()) ||
    l.action.toLowerCase().includes(logSearch.toLowerCase()) ||
    l.module.toLowerCase().includes(logSearch.toLowerCase())
  );

  const sections = [
    { id: 'camera', label: 'Camera Configuration' },
    { id: 'plate', label: 'Plate Recognition' },
    { id: 'rates', label: 'Parking Rates' },
    { id: 'receipt', label: 'Receipt Template' },
    { id: 'payment', label: 'Payment Methods' },
    { id: 'backup', label: 'Backup & Restore' },
    { id: 'permissions', label: 'User Permissions' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'logs', label: 'Activity Logs' },
  ];

  return (
    <div className="settings-page">
      <div className="settings-sidebar">
        {sections.map(s => {
          const Icon = sectionIcons[s.id];
          return (
            <button key={s.id} className={`settings-nav-item ${activeSection === s.id ? 'active' : ''}`} onClick={() => setActiveSection(s.id)}>
              <Icon size={16} className="settings-nav-icon" />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="settings-content">
        {saveMsg && <div className="save-toast">{saveMsg}</div>}

        {activeSection === 'camera' && (
          <div className="settings-section">
            <h2>Camera Configuration</h2>
            <p className="settings-desc">Manage camera sources for entrance, exit, and slot monitoring.</p>
            <table className="data-table">
              <thead><tr><th>Camera Name</th><th>Type</th><th>Location</th><th>Slot Range</th><th>Status</th></tr></thead>
              <tbody>
                {cameras.map(c => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td><span className={`cam-type-badge ${c.type}`}>{c.type}</span></td>
                    <td>{c.location}</td>
                    <td>{c.slot_range || '—'}</td>
                    <td><span className={`status-badge ${c.is_online ? 'completed' : 'failed'}`}>{c.is_online ? 'online' : 'offline'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeSection === 'plate' && (
          <div className="settings-section">
            <h2>Plate Recognition Settings</h2>
            <p className="settings-desc">Configure plate detection sensitivity and confidence thresholds.</p>
            <div className="settings-form">
              <div className="form-group">
                <label>Confidence Threshold (%)</label>
                <input type="number" defaultValue={settings.plate_recognition_confidence_threshold || 85}
                  onBlur={e => saveSetting('plate_recognition_confidence_threshold', parseInt(e.target.value))} />
                <span className="form-hint">Plates below this confidence are flagged for review.</span>
              </div>
              <div className="form-group">
                <label>Camera FPS</label>
                <input type="number" defaultValue={settings.camera_fps || 30}
                  onBlur={e => saveSetting('camera_fps', parseInt(e.target.value))} />
              </div>
            </div>
          </div>
        )}

        {activeSection === 'rates' && (
          <div className="settings-section">
            <h2>Parking Rates</h2>
            <p className="settings-desc">Set hourly rates and maximum capacity for each vehicle type.</p>
            <div className="settings-form">
              <div className="form-group">
                <label>Car Hourly Rate (₱)</label>
                <input type="number" defaultValue={settings.hourly_rate_car || 50}
                  onBlur={e => saveSetting('hourly_rate_car', parseInt(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Motorcycle Hourly Rate (₱)</label>
                <input type="number" defaultValue={settings.hourly_rate_motorcycle || 25}
                  onBlur={e => saveSetting('hourly_rate_motorcycle', parseInt(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Max Capacity — Cars</label>
                <input type="number" defaultValue={settings.max_capacity_cars || 30}
                  onBlur={e => saveSetting('max_capacity_cars', parseInt(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Max Capacity — Motorcycles</label>
                <input type="number" defaultValue={settings.max_capacity_motorcycles || 20}
                  onBlur={e => saveSetting('max_capacity_motorcycles', parseInt(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Currency Symbol</label>
                <input defaultValue={settings.currency || '₱'}
                  onBlur={e => saveSetting('currency', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {activeSection === 'receipt' && (
          <div className="settings-section">
            <h2>Receipt Template</h2>
            <p className="settings-desc">Customize the header, address, and footer on printed receipts.</p>
            <div className="settings-form">
              <div className="form-group">
                <label>Header Text</label>
                <input defaultValue={settings.receipt_template?.header || 'SmartPark Parking System'}
                  onBlur={e => saveSetting('receipt_template', { ...settings.receipt_template, header: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input defaultValue={settings.receipt_template?.address || 'Pasig City, Philippines'}
                  onBlur={e => saveSetting('receipt_template', { ...settings.receipt_template, address: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Footer Text</label>
                <input defaultValue={settings.receipt_template?.footer || 'Thank you for parking with us!'}
                  onBlur={e => saveSetting('receipt_template', { ...settings.receipt_template, footer: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {activeSection === 'payment' && (
          <div className="settings-section">
            <h2>Payment Methods</h2>
            <p className="settings-desc">Enable or disable payment methods available to customers.</p>
            <div className="settings-form">
              {['cash', 'gcash', 'card'].map(method => (
                <div key={method} className="toggle-row">
                  <span className="toggle-label">{method === 'gcash' ? 'GCash' : method === 'card' ? 'Credit/Debit Card' : 'Cash'}</span>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked={(settings.payment_methods || []).includes(method)}
                      onChange={e => {
                        const current = settings.payment_methods || [];
                        const updated = e.target.checked ? [...current, method] : current.filter((m: string) => m !== method);
                        saveSetting('payment_methods', updated);
                      }} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSection === 'backup' && (
          <div className="settings-section">
            <h2>Backup & Restore</h2>
            <p className="settings-desc">Export or import system data and configuration.</p>
            <div className="backup-actions">
              <button className="btn-primary"><IconDownload size={15} /> Download Backup</button>
              <button className="btn-secondary">Restore from File</button>
              <button className="btn-secondary">Export Database</button>
            </div>
          </div>
        )}

        {activeSection === 'permissions' && (
          <div className="settings-section">
            <h2>User Permissions</h2>
            <p className="settings-desc">Define what each role can access within the system.</p>
            <table className="data-table">
              <thead><tr><th>Module</th><th>Admin</th><th>Operator</th><th>Viewer</th></tr></thead>
              <tbody>
                {['Dashboard', 'Payments', 'User Management', 'Statistics', 'Slot Management', 'Settings'].map(mod => (
                  <tr key={mod}>
                    <td>{mod}</td>
                    <td><span className="perm-check"><IconCheck size={14} /></span></td>
                    <td>{mod === 'Settings' || mod === 'User Management' ? <span className="perm-deny">—</span> : <span className="perm-check"><IconCheck size={14} /></span>}</td>
                    <td>{mod === 'Payments' || mod === 'Settings' || mod === 'User Management' ? <span className="perm-deny">—</span> : <span className="perm-check"><IconCheck size={14} /></span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeSection === 'notifications' && (
          <div className="settings-section">
            <h2>Notification Settings</h2>
            <p className="settings-desc">Choose which events trigger dashboard notifications.</p>
            <div className="settings-form">
              {[
                { key: 'new_vehicle', label: 'New vehicle entered' },
                { key: 'parking_full', label: 'Parking full' },
                { key: 'payment_completed', label: 'Payment completed' },
                { key: 'camera_offline', label: 'Camera offline' },
                { key: 'recognition_failed', label: 'Plate recognition failed' },
              ].map(item => (
                <div key={item.key} className="toggle-row">
                  <span className="toggle-label">{item.label}</span>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked={settings.notification_settings?.[item.key] !== false}
                      onChange={e => saveSetting('notification_settings', { ...settings.notification_settings, [item.key]: e.target.checked })} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSection === 'logs' && (
          <div className="settings-section">
            <h2>Activity Logs</h2>
            <p className="settings-desc">Audit trail of all user actions across the system.</p>
            <div className="search-wrapper" style={{ marginBottom: '16px' }}>
              <IconSearch size={16} className="search-prefix" />
              <input className="search-input" placeholder="Search logs..." value={logSearch} onChange={e => setLogSearch(e.target.value)} />
            </div>
            <table className="data-table">
              <thead><tr><th>User</th><th>Action</th><th>Module</th><th>Details</th><th>Timestamp</th></tr></thead>
              <tbody>
                {filteredLogs.map(l => (
                  <tr key={l.id}>
                    <td>{l.user_name}</td>
                    <td>{l.action}</td>
                    <td>{l.module}</td>
                    <td className="log-details">{l.details}</td>
                    <td>{new Date(l.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && <tr><td colSpan={5} className="empty-state">No logs found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
