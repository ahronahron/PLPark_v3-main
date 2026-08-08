/**
 * Settings.tsx — Floating System Settings Panel Component
 *
 * This component renders the tabbed interface for system configuration.
 * It connects to Supabase settings, camera, and activity logs.
 *
 * Integrated tabs:
 * 1. **Cameras & Vision** — Unified camera setup and plate recognition settings.
 * 2. **Parking Handling** — Consolidated rates, receipt templates, and payment gateways in a side-by-side layout.
 * 3. **Notifications** — Toggles for system alert events.
 * 4. **Backup & Restore** — Data export/import commands.
 * 5. **Activity Logs** — Searchable audit logs.
 *
 * Cleanups:
 * - Hardcoded currency symbol to ₱ (removed input).
 * - Removed User Permissions / RBAC selector.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  IconCameraConfig, IconRates, IconBackup,
  IconNotifications, IconLogs, IconSearch, IconDownload
} from '@/components/Icons';

/** Icon map for settings section tabs */
const sectionIcons: Record<string, any> = {
  camera_vision: IconCameraConfig,
  parking_handling: IconRates,
  notifications: IconNotifications,
  backup: IconBackup,
  logs: IconLogs,
};

/**
 * Settings — Panel component containing configuration forms.
 *
 * State:
 * - `activeSection`: Current settings tab ('camera_vision' | 'parking_handling' | ...)
 * - `settings`: Key-value configuration object loaded from settings table.
 * - `cameras`: Array of camera sources.
 * - `logs`: System activity audit logs.
 * - `logSearch`: Query for filtering logs.
 * - `saveMsg`: Transient success status message.
 *
 * @returns Settings layout.
 */
export function Settings() {
  const [activeSection, setActiveSection] = useState('camera_vision');
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [cameras, setCameras] = useState<any[]>([]);
  const [newCamera, setNewCamera] = useState({ name: '', location: '', type: 'entrance', slot_range: '' });
  const [cameraEdits, setCameraEdits] = useState<Record<string, any>>({});
  const [logs, setLogs] = useState<any[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  /** Fetch configuration and cameras from Supabase on mount */
  useEffect(() => {
    supabase.from('settings').select('key, value').then(({ data }) => {
      if (data) setSettings(Object.fromEntries(data.map((r: any) => [r.key, r.value])));
    });
    supabase.from('cameras').select('*').order('name').then(({ data }) => setCameras(data || []));
    supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => setLogs(data || []));
  }, []);

  /**
   * saveSetting — Persists key-value settings changes to Supabase settings table.
   * Displays a toast notification after saving.
   *
   * @param key — Settings record lookup key
   * @param value — Settings record payload value
   */
  const saveSetting = async (key: string, value: any) => {
    await supabase.from('settings').upsert({ key, value });
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaveMsg(`Setting saved successfully.`);
    setTimeout(() => setSaveMsg(''), 2000);
  };

  const updateCameraEdit = (id: string | number, field: string, value: any) => {
    setCameraEdits(prev => ({
      ...prev,
      [String(id)]: { ...prev[String(id)], [field]: value },
    }));
  };

  const handleCameraUpdate = async (camera: any) => {
    const changes = cameraEdits[String(camera.id)] || {};
    if (!changes.type && !changes.location && !changes.slot_range) {
      setSaveMsg('No changes to save.');
      return;
    }

    const { error } = await supabase.from('cameras').update(changes).eq('id', camera.id);
    if (error) {
      setSaveMsg('Error updating camera: ' + error.message);
      return;
    }

    setCameras(prev => prev.map((c: any) => c.id === camera.id ? { ...c, ...changes } : c));
    setCameraEdits(prev => ({ ...prev, [String(camera.id)]: {} }));
    setSaveMsg('Camera updated successfully.');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  const handleAddCamera = async () => {
    if (!newCamera.name || !newCamera.location) {
      setSaveMsg('Camera name and location are required.');
      return;
    }

    const { data, error } = await supabase.from('cameras').insert({
      ...newCamera,
      is_online: true,
    }).select();

    if (error) {
      setSaveMsg('Error adding camera: ' + error.message);
      return;
    }

    if (data && data.length > 0) {
      setCameras(prev => [...prev, data[0]]);
      setNewCamera({ name: '', location: '', type: 'entrance', slot_range: '' });
      setSaveMsg('Camera added successfully.');
      setTimeout(() => setSaveMsg(''), 2000);
    }
  };

  /** Filter logs by user name, action description, or active module */
  const filteredLogs = logs.filter(l =>
    l.user_name?.toLowerCase().includes(logSearch.toLowerCase()) ||
    l.action.toLowerCase().includes(logSearch.toLowerCase()) ||
    l.module.toLowerCase().includes(logSearch.toLowerCase())
  );

  /** Sections config (Permissions removed, Camera & plate unified, Rates, receipt, payment consolidated) */
  const sections = [
    { id: 'camera_vision', label: 'Cameras & Vision' },
    { id: 'parking_handling', label: 'Parking Handling' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'backup', label: 'Backup & Restore' },
    { id: 'logs', label: 'Activity Logs' },
  ];

  return (
    <div className="settings-page">
      {/* Sidebar navigation for settings overlay */}
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

      {/* Settings configuration form viewport */}
      <div className="settings-content">
        {saveMsg && <div className="save-toast">{saveMsg}</div>}

        {/* ===== TAB 1: CAMERAS & VISION ===== */}
        {activeSection === 'camera_vision' && (
          <div className="settings-section">
            <h2>Cameras & Vision</h2>
            <p className="settings-desc">Manage system video sources and plate recognition parameters.</p>
            
            <div className="camera-section-grid">
              <div className="camera-top-grid">
                <div className="camera-add-card">
                  <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Add Camera</h3>
                  <div className="settings-form full-width">
                    <div className="form-group">
                      <label>Camera Name</label>
                      <input value={newCamera.name} onChange={e => setNewCamera(prev => ({ ...prev, name: e.target.value }))} placeholder="Entrance Camera 01" />
                    </div>
                    <div className="form-group">
                      <label>Type</label>
                      <select value={newCamera.type} onChange={e => setNewCamera(prev => ({ ...prev, type: e.target.value }))}>
                        <option value="entrance">Entrance</option>
                        <option value="exit">Exit</option>
                        <option value="slot">Slot</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Location</label>
                      <input value={newCamera.location} onChange={e => setNewCamera(prev => ({ ...prev, location: e.target.value }))} placeholder="Main Gate" />
                    </div>
                    <div className="form-group">
                      <label>Slot Range</label>
                      <input value={newCamera.slot_range} onChange={e => setNewCamera(prev => ({ ...prev, slot_range: e.target.value }))} placeholder="A1-A4" />
                    </div>
                    <button className="btn-primary" style={{ width: 'fit-content' }} onClick={handleAddCamera}>Add Camera</button>
                  </div>
                </div>

                <div className="camera-params-card">
                  <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Plate Recognition Parameters</h3>
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
              </div>

              <div className="camera-management camera-management-full">
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Camera Setup</h3>
                  <table className="data-table">
                    <thead><tr><th>Name</th><th>Type</th><th>Location</th><th>Slot Range</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>
                      {cameras.map(c => {
                        const edit = cameraEdits[String(c.id)] || {};
                        return (
                          <tr key={c.id}>
                            <td>{c.name}</td>
                            <td>
                              <select value={edit.type ?? c.type} onChange={e => updateCameraEdit(c.id, 'type', e.target.value)}>
                                <option value="entrance">Entrance</option>
                                <option value="exit">Exit</option>
                                <option value="slot">Slot</option>
                              </select>
                            </td>
                            <td>
                              <input type="text" value={(edit.location ?? c.location) || ''} onChange={e => updateCameraEdit(c.id, 'location', e.target.value)} />
                            </td>
                            <td>
                              <input type="text" value={(edit.slot_range ?? c.slot_range) || ''} onChange={e => updateCameraEdit(c.id, 'slot_range', e.target.value)} placeholder="A1-A4" />
                            </td>
                            <td><span className={`status-badge ${c.is_online ? 'completed' : 'failed'}`}>{c.is_online ? 'online' : 'offline'}</span></td>
                            <td><button className="btn-secondary" style={{ padding: '6px 12px' }} onClick={() => handleCameraUpdate(c)}>Save</button></td>
                          </tr>
                        );
                      })}
                      {cameras.length === 0 && <tr><td colSpan={6} className="empty-state">No cameras configured</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== TAB 2: PARKING HANDLING ===== */}
        {activeSection === 'parking_handling' && (
          <div className="settings-section">
            <h2>Parking Handling</h2>
            <p className="settings-desc">Configure rates, customize receipts, and toggle payment options.</p>

            <div className="parking-handling-grid">
              {/* Column 1: Rates & Capacities */}
              <div className="parking-handling-col">
                <h3 style={{ fontSize: '13px', fontWeight: 600 }}>Rates & Capacity</h3>
                <div className="settings-form" style={{ maxWidth: '100%' }}>
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
                </div>
              </div>

              {/* Column 2: Receipt & Gateways */}
              <div className="parking-handling-col">
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '16px' }}>Receipt Customization</h3>
                  <div className="settings-form" style={{ maxWidth: '100%' }}>
                    <div className="form-group">
                      <label>Header Text</label>
                      <input defaultValue={settings.receipt_template?.header || 'PLPark Parking System'}
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

              </div>
            </div>
            <div className="payment-gateway-panel">
              <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Payment Gateways</h3>
              <div className="settings-form gateway-form" style={{ maxWidth: '480px', margin: '0 auto' }}>
                {['cash', 'gcash', 'card'].map(method => (
                  <div key={method} className="toggle-row">
                    <span className="toggle-label" style={{ textTransform: 'capitalize' }}>
                      {method === 'gcash' ? 'GCash' : method === 'card' ? 'Credit/Debit Card' : 'Cash'}
                    </span>
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
          </div>
        )}

        {/* ===== TAB 3: NOTIFICATIONS ===== */}
        {activeSection === 'notifications' && (
          <div className="settings-section">
            <h2>Notification Toggles</h2>
            <p className="settings-desc">Choose which events trigger real-time dashboard notifications.</p>
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

        {/* ===== TAB 4: BACKUP & RESTORE ===== */}
        {activeSection === 'backup' && (
          <div className="settings-section">
            <h2>Backup & Restore</h2>
            <p className="settings-desc">Export database files or download current configuration presets.</p>
            <div className="backup-actions">
              <button className="btn-primary" onClick={() => alert('Backup downloading')}><IconDownload size={15} /> Download Backup</button>
              <button className="btn-secondary" onClick={() => alert('Select a file to restore')}>Restore from File</button>
              <button className="btn-secondary" onClick={() => alert('Exporting PostgreSQL data')}>Export Database</button>
            </div>
          </div>
        )}

        {/* ===== TAB 5: ACTIVITY LOGS ===== */}
        {activeSection === 'logs' && (
          <div className="settings-section">
            <h2>Activity Logs</h2>
            <p className="settings-desc">Audit trail of operator and viewer sessions.</p>
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
                    <td className="log-details" title={l.details}>{l.details}</td>
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
