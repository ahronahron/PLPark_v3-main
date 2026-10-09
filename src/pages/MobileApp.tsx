import { useEffect, useState, useCallback } from 'react';
import { supabase, type ParkingSession, type Payment, type VehicleType } from '@/lib/supabase';

/* ============================================================
 * PLPark Mobile App — User Side
 * Self-contained single-file React component.
 *
 * Supports Concept A (public, search plate to find & pay session)
 * and Concept B (registered user, login, wallet, registered vehicles).
 *
 * Drop this file into any React + Tailwind project that has the
 * supabase client at @/lib/supabase.  Render <MobileApp /> anywhere.
 * ============================================================ */

/** Screen view state keys in mobile flow */
type Screen = 'home' | 'login' | 'register' | 'forgotPassword' | 'resetPassword' | 'dashboard' | 'sessions' | 'payments' | 'vehicles' | 'wallet' | 'searchResult';

/** Custom app user structure */
interface AppUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  wallet_balance: number;
  status: string;
  created_at: string;
}

/** Registered plate structure linked to app users */
interface Vehicle {
  id: string;
  app_user_id: string | null;
  plate_number: string;
  vehicle_type: VehicleType;
  make: string | null;
  color: string | null;
  image_url: string | null;
}

interface AvailableSlot {
  id: string;
  slot_id: string;
  vehicle_type: VehicleType;
  status: string;
}

/** Settings structure parsed from Supabase settings table */
interface Settings {
  hourly_rate_car: number;
  hourly_rate_motorcycle: number;
  max_capacity_cars: number;
  max_capacity_motorcycles: number;
  currency: string;
  payment_methods: string[];
}

/**
 * formatTime — Helper to convert ISO date strings into clean visual date/time strings.
 *
 * @param {string} iso — ISO 8601 Timestamp
 * @returns {string} Human-friendly formatted time
 */
const formatTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatHour = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString('en-US', { hour: 'numeric' });

/**
 * formatDuration — Helper to format active duration intervals (milliseconds) into hours/minutes text.
 *
 * @param {number} ms — Interval in milliseconds
 * @returns {string} Formatted duration string
 */
const formatDuration = (ms: number) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * MIcon — Generic inline SVG wrapper that splits path descriptions by pipes (|).
 *
 * @param props — Icon specification parameters (path list string d, dimension, fill state)
 * @returns SVG element
 */
const MIcon = ({ d, size = 22, fill = false }: { d: string; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((pathData, i) => {
      const path = pathData.trim();
      return <path key={i} d={/^[Mm]/.test(path) ? path : `M${path}`} />;
    })}
  </svg>
);

/** Icon components for the mobile user view flows */
const ICar = (s: number) => <MIcon d="M5 13L7 8h10l2 5|3 13h18v6h-3v-2H6v2H3z|7 16h2M15 16h2" size={s} />;
const IBike = (s: number) => <MIcon d="M5 18a3 3 0 1 0 0-0.1|19 18a3 3 0 1 0 0-0.1|5 18l4-6h6l2 3|15 9h3l1 3" size={s} />;
const ISearch = (s: number) => <MIcon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16|21 21l-4.35-4.35" size={s} />;
const IUser = (s: number) => <MIcon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8|4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" size={s} />;
const IWallet = (s: number) => <MIcon d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2|16 13h2" size={s} />;
const IClock = (s: number) => <MIcon d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20|12 7v5l3 2" size={s} />;
const IReceipt = (s: number) => <MIcon d="M6 2h12v20l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 22z|9 7h6M9 11h6M9 15h4" size={s} />;
const ICheck = (s: number) => <MIcon d="M20 6L9 17l-5-5" size={s} />;
const IArrow = (s: number) => <MIcon d="M19 12H5M12 19l-7-7 7-7" size={s} />;
const IPlus = (s: number) => <MIcon d="M12 5v14M5 12h14" size={s} />;
const IEdit = (s: number) => <MIcon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7|18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" size={s} />;
const ITrash = (s: number) => <MIcon d="M3 6h18|8 6V4h8v2|19 6v14H5V6|10 11v6M14 11v6" size={s} />;
const ILogout = (s: number) => <MIcon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|16 17l5-5-5-5M21 12H9" size={s} />;
const IBell = (s: number) => <MIcon d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9|13.7 21a2 2 0 0 1-3.4 0" size={s} />;
const IParking = (s: number) => <MIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10|9 8h4a2 2 0 0 1 0 4H9z" size={s} fill />;

/** Brand Logo rendering */
const Logo = ({ size = 40 }: { size?: number }) => (
  <img src="/plp.png" alt="PLPark" style={{ width: size, height: size, borderRadius: 8, objectFit: 'contain' }} />
);

/**
 * MobileApp — Complete Mobile / Driver Web App interface.
 *
 * Toggles search screens, authentication panels, wallet setups, and history logs.
 *
 * @returns Mobile view component.
 */
export function MobileApp() {
  const [screen, setScreen] = useState<Screen>('home');
  const [user, setUser] = useState<AppUser | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [parkingSlots, setParkingSlots] = useState<AvailableSlot[]>([]);
  const [peakHours, setPeakHours] = useState<number[]>([]);
  const [currentHour, setCurrentHour] = useState(new Date().getHours());
  const [activeSession, setActiveSession] = useState<ParkingSession | null>(null);
  const [searchPlate, setSearchPlate] = useState('');
  const [searchedSession, setSearchedSession] = useState<ParkingSession | null>(null);
  const [searchedPlateImage, setSearchedPlateImage] = useState<string | null>(null);
  const [searchedPayments, setSearchedPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<Settings>({ hourly_rate_car: 50, hourly_rate_motorcycle: 25, max_capacity_cars: 30, max_capacity_motorcycles: 20, currency: '₱', payment_methods: ['cash', 'gcash', 'card'] });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * showToast — Triggers transient onscreen feedback banners on the phone layout.
   *
   * @param msg — Banner feedback message text
   * @param type — Banner color/status category (success/error/info)
   */
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  /** Load system settings on mount */
  useEffect(() => {
    supabase.from('settings').select('key, value').then(({ data }) => {
      if (data) {
        const m = Object.fromEntries(data.map((r: any) => [r.key, r.value]));
        setSettings(prev => ({ ...prev, ...m }));
      }
    });
  }, []);

  /**
   * loadUserData — Queries registered vehicles and active parking sessions for an authenticated user.
   *
   * @param userId — Account owner AppUser ID
   */
  const loadUserData = useCallback(async (userId: string) => {
    const [{ data: v }, { data: s }] = await Promise.all([
      supabase.from('vehicles').select('*').eq('app_user_id', userId),
      supabase.from('parking_sessions').select('*').eq('app_user_id', userId).eq('status', 'active').maybeSingle(),
    ]);
    setVehicles(v || []);
    setActiveSession(s as ParkingSession | null);
  }, []);

  /**
   * searchPlateNumber — Performs plate queries for public search (Concept A).
   *
   * Validates: plate formatting.
   * Fetches: active parking session matching query plus last 5 payment records.
   */
  const searchPlateNumber = async () => {
    if (!searchPlate.trim()) { showToast('Enter your plate number', 'error'); return; }
    if (!/^[A-Za-z0-9 -]{2,12}$/.test(searchPlate.trim())) { showToast('Enter a valid plate number', 'error'); return; }
    setLoading(true);
    const plate = searchPlate.toUpperCase().trim();
    const [{ data: session }, { data: pays }, { data: recognitions }, { data: vehicle }] = await Promise.all([
      supabase.from('parking_sessions').select('*').eq('plate_number', plate).eq('status', 'active').maybeSingle(),
      supabase.from('payments').select('*').eq('plate_number', plate).order('created_at', { ascending: false }).limit(5),
      supabase.from('plate_recognitions').select('image_url').eq('plate_number', plate).not('image_url', 'is', null).order('created_at', { ascending: false }).limit(1),
      supabase.from('vehicles').select('image_url').eq('plate_number', plate).maybeSingle(),
    ]);
    setSearchedSession(session as ParkingSession | null);
    setSearchedPayments((pays as Payment[]) || []);
    setSearchedPlateImage(session?.image_url || recognitions?.[0]?.image_url || vehicle?.image_url || null);
    setScreen('searchResult');
    setLoading(false);
  };

  /** Form states for Login and Signup */
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '' });
  const [passwordForm, setPasswordForm] = useState({ password: '', confirmPassword: '' });
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);

  const loadParkingAvailability = useCallback(async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: slots }, { data: sessions }] = await Promise.all([
      supabase.from('parking_slots').select('id, slot_id, vehicle_type, status').order('slot_id'),
      supabase.from('parking_sessions').select('entry_time').gte('entry_time', weekAgo),
    ]);
    setParkingSlots((slots as AvailableSlot[]) || []);

    const counts = new Map<number, number>();
    (sessions || []).forEach((session: { entry_time: string }) => {
      const hour = new Date(session.entry_time).getHours();
      counts.set(hour, (counts.get(hour) || 0) + 1);
    });
    const highestCount = Math.max(0, ...counts.values());
    setPeakHours(highestCount ? [...counts.entries()].filter(([, count]) => count === highestCount).map(([hour]) => hour).sort((a, b) => a - b) : []);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setScreen('resetPassword');
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentHour(new Date().getHours()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadParkingAvailability();
    const channel = supabase
      .channel('mobile-slot-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, payload => {
        if (payload.eventType === 'INSERT') setParkingSlots(prev => [...prev, payload.new as AvailableSlot].sort((a, b) => a.slot_id.localeCompare(b.slot_id)));
        if (payload.eventType === 'UPDATE') setParkingSlots(prev => prev.map(slot => slot.id === payload.new.id ? { ...slot, ...payload.new } as AvailableSlot : slot));
        if (payload.eventType === 'DELETE') setParkingSlots(prev => prev.filter(slot => slot.id !== payload.old.id));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_sessions' }, () => { void loadParkingAvailability(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user, loadParkingAvailability]);

  const ensureAppUser = async (authUser: { id: string; email?: string; user_metadata: Record<string, any> }) => {
    const metadata = authUser.user_metadata || {};
    const fullName = [metadata.first_name, metadata.last_name].filter(Boolean).join(' ').trim() || metadata.full_name || authUser.email?.split('@')[0] || 'Driver';
    const phone = typeof metadata.phone === 'string' ? metadata.phone : null;
    const { data: linkedProfile, error: linkedError } = await supabase.from('app_users').select('*').eq('auth_user_id', authUser.id).maybeSingle();
    if (linkedError) throw new Error('Could not load your profile. Apply the latest Supabase migration and try again.');
    if (linkedProfile) return linkedProfile as AppUser;

    const { data: legacyProfile, error: legacyError } = await supabase.from('app_users').select('*').eq('email', authUser.email || '').maybeSingle();
    if (legacyError) throw legacyError;
    if (legacyProfile) {
      const { data, error } = await supabase.from('app_users')
        .update({ auth_user_id: authUser.id, phone: legacyProfile.phone || phone })
        .eq('id', legacyProfile.id).select().single();
      if (error) throw error;
      return data as AppUser;
    }

    const { data, error } = await supabase.from('app_users').insert({
      auth_user_id: authUser.id,
      full_name: fullName,
      email: authUser.email,
      phone,
      wallet_balance: 0,
      status: 'active',
    }).select().single();
    if (error) throw error;
    return data as AppUser;
  };

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hashParams.get('type') === 'recovery') return;
    let mounted = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted || error || !data.session) return;
      try {
        const profile = await ensureAppUser(data.session.user);
        if (!mounted) return;
        setUser(profile);
        setScreen('dashboard');
        await loadUserData(profile.id);
      } catch (profileError) {
        if (mounted) showToast(profileError instanceof Error ? profileError.message : 'Could not restore your profile.', 'error');
      }
    });
    return () => { mounted = false; };
  }, []);

  const handleLogin = async () => {
    if (!loginForm.email.trim() || !loginForm.password) { showToast('Enter your email and password', 'error'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginForm.email.trim(), password: loginForm.password });
    if (error || !data.user) {
      setLoading(false);
      showToast(error?.message || 'Unable to log in. Check your credentials.', 'error');
      return;
    }
    try {
      const profile = await ensureAppUser(data.user);
      setUser(profile);
      await loadUserData(profile.id);
      setScreen('dashboard');
      showToast(`Welcome back, ${profile.full_name.split(' ')[0]}!`, 'success');
    } catch (profileError) {
      showToast(profileError instanceof Error ? profileError.message : 'Could not load your profile.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!registerForm.first_name.trim() || !registerForm.last_name.trim() || !registerForm.email.trim() || !registerForm.phone.trim() || !registerForm.password) {
      showToast('Complete all required fields', 'error');
      return;
    }
    if (!/^[0-9+()\s-]{7,20}$/.test(registerForm.phone.trim())) { showToast('Enter a valid phone number', 'error'); return; }
    if (registerForm.password.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: registerForm.email.trim(),
      password: registerForm.password,
      options: { data: {
        first_name: registerForm.first_name.trim(),
        last_name: registerForm.last_name.trim(),
        phone: registerForm.phone.trim(),
      } },
    });
    if (error || !data.user) {
      setLoading(false);
      showToast(error?.message || 'Account creation failed.', 'error');
      return;
    }
    setLoginForm(prev => ({ ...prev, email: registerForm.email.trim() }));
    setRegisterForm({ first_name: '', last_name: '', email: '', phone: '', password: '' });
    if (!data.session) {
      setLoading(false);
      setScreen('login');
      showToast('Account created. Check your email to verify it, then log in.', 'info');
      return;
    }
    try {
      const profile = await ensureAppUser(data.user);
      setUser(profile);
      await loadUserData(profile.id);
      setScreen('dashboard');
      showToast('Account created! Welcome to PLPark.', 'success');
    } catch (profileError) {
      showToast(profileError instanceof Error ? profileError.message : 'Account created, but profile setup failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordReset = async () => {
    if (!loginForm.email.trim()) { showToast('Enter your email address first', 'error'); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(loginForm.email.trim(), { redirectTo: `${window.location.origin}/?view=mobile` });
    setLoading(false);
    if (error) { showToast(error.message, 'error'); return; }
    setScreen('login');
    showToast('Password reset link sent. Check your email.', 'success');
  };

  const saveNewPassword = async () => {
    if (passwordForm.password.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
    if (passwordForm.password !== passwordForm.confirmPassword) { showToast('Passwords do not match', 'error'); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: passwordForm.password });
    if (!error) await supabase.auth.signOut();
    setLoading(false);
    if (error) { showToast(error.message, 'error'); return; }
    setPasswordForm({ password: '', confirmPassword: '' });
    setScreen('login');
    showToast('Password updated. Log in with your new password.', 'success');
  };

  /**
   * logout — Clears current session states and resets view back to home screen.
   */
  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setVehicles([]);
    setParkingSlots([]);
    setPeakHours([]);
    setActiveSession(null);
    setScreen('home');
    showToast('Logged out', 'info');
  };

  const [vehicleForm, setVehicleForm] = useState({ plate: '', type: 'car' as VehicleType, make: '', color: '' });

  const resetVehicleForm = () => {
    setVehicleForm({ plate: '', type: 'car', make: '', color: '' });
    setEditingVehicleId(null);
  };

  const beginVehicleEdit = (vehicle: Vehicle) => {
    setVehicleForm({ plate: vehicle.plate_number, type: vehicle.vehicle_type, make: vehicle.make || '', color: vehicle.color || '' });
    setEditingVehicleId(vehicle.id);
  };

  const saveVehicle = async () => {
    if (!user || !vehicleForm.plate.trim() || !vehicleForm.make.trim() || !vehicleForm.color.trim()) {
      showToast('Plate, make, and color are required', 'error');
      return;
    }
    const payload = {
      plate_number: vehicleForm.plate.toUpperCase().trim(),
      vehicle_type: vehicleForm.type,
      make: vehicleForm.make.trim(),
      color: vehicleForm.color.trim(),
    };
    const result = editingVehicleId
      ? await supabase.from('vehicles').update(payload).eq('id', editingVehicleId).eq('app_user_id', user.id).select().single()
      : await supabase.from('vehicles').insert({ ...payload, app_user_id: user.id }).select().single();
    if (result.error) { showToast(result.error.message.includes('make') ? 'Apply the vehicle make migration, then try again.' : 'Could not save vehicle', 'error'); return; }
    if (editingVehicleId) setVehicles(prev => prev.map(vehicle => vehicle.id === editingVehicleId ? result.data as Vehicle : vehicle));
    else setVehicles(prev => [...prev, result.data as Vehicle]);
    resetVehicleForm();
    showToast(editingVehicleId ? 'Vehicle updated' : 'Vehicle registered', 'success');
  };

  const deleteVehicle = async (vehicle: Vehicle) => {
    if (!user || !confirm(`Delete vehicle ${vehicle.plate_number}?`)) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicle.id).eq('app_user_id', user.id);
    if (error) { showToast('Could not delete vehicle', 'error'); return; }
    setVehicles(prev => prev.filter(item => item.id !== vehicle.id));
    if (editingVehicleId === vehicle.id) resetVehicleForm();
    showToast('Vehicle deleted', 'success');
  };

  /**
   * paySession — Submits payment calculations for active sessions and logs departure.
   *
   * @param session — Target active parking session record
   * @param method — Chosen payment gateway (cash, card, gcash, or wallet balance)
   */
  const paySession = async (session: ParkingSession, method: string) => {
    if (!session) return;
    const rate = session.vehicle_type === 'car' ? settings.hourly_rate_car : settings.hourly_rate_motorcycle;
    const durationMs = Date.now() - new Date(session.entry_time).getTime();
    const hours = Math.max(0.5, durationMs / 3600000);
    const total = Math.round(hours * rate * 100) / 100;
    
    // Deduct from wallet first if using Concept B registered balance
    if (user && method === 'wallet') {
      if (user.wallet_balance < total) {
        showToast('Insufficient wallet balance. Please top up.', 'error');
        return;
      }
      const newBal = Math.max(0, user.wallet_balance - total);
      const { error: balErr } = await supabase.from('app_users').update({ wallet_balance: newBal }).eq('id', user.id);
      if (balErr) { showToast('Wallet deduction failed', 'error'); return; }
      setUser({ ...user, wallet_balance: newBal });
    }

    const receipt = `RCP-${Date.now().toString().slice(-6)}`;
    const { error: payErr } = await supabase.from('payments').insert({
      receipt_number: receipt,
      plate_number: session.plate_number,
      session_id: session.id,
      duration_hours: Math.round(hours * 100) / 100,
      hourly_rate: rate,
      total_amount: total,
      payment_method: method,
      status: 'completed',
      processed_by: 'mobile-app',
    });

    if (payErr) { showToast('Payment failed', 'error'); return; }
    await supabase.from('parking_sessions').update({ status: 'completed', exit_time: new Date().toISOString() }).eq('id', session.id);

    setActiveSession(null);
    setSearchedSession(null);
    showToast(`Payment of ${settings.currency}${total.toFixed(2)} successful!`, 'success');
    setScreen(user ? 'dashboard' : 'home');
  };

  /** Form states for top-ups */
  const [topUpAmount, setTopUpAmount] = useState('');

  /**
   * topUpWallet — Updates registered account wallet_balance columns.
   */
  const topUpWallet = async () => {
    const amt = parseFloat(topUpAmount);
    if (!amt || amt <= 0 || !user) { showToast('Enter a valid amount', 'error'); return; }
    const newBal = user.wallet_balance + amt;
    const { error } = await supabase.from('app_users').update({ wallet_balance: newBal }).eq('id', user.id);
    if (error) { showToast('Top-up failed', 'error'); return; }
    setUser({ ...user, wallet_balance: newBal });
    setTopUpAmount('');
    showToast(`Wallet topped up by ${settings.currency}${amt.toFixed(2)}`, 'success');
  };

  const currency = settings.currency || '₱';
  const peakHourNow = peakHours.includes(currentHour);

  return (
    <div className="mobile-shell">
      <div className="mobile-phone">
        {/* Status bar */}
        <div className="m-statusbar">
          <span>9:41</span>
          <div className="m-statusbar-right">
            <span className="m-signal" />
            <span className="m-wifi" />
            <span className="m-battery" />
          </div>
        </div>

        {/* Content viewport */}
        <div className="m-content">
          {toast && <div className={`m-toast m-toast-${toast.type}`}>{toast.msg}</div>}

          {/* ---------- HOME ---------- */}
          {screen === 'home' && (
            <div className="m-screen m-home">
              <div className="m-home-hero">
                <Logo size={56} />
                <h1 className="m-home-title">PLPark</h1>
                <p className="m-home-tagline">Smart parking, effortless payment</p>
              </div>

              <form className="m-home-search" onSubmit={event => { event.preventDefault(); void searchPlateNumber(); }}>
                <h2 className="m-section-title">Find Your Vehicle</h2>
                <p className="m-section-sub">Enter your plate number to check status and pay</p>
                <div className="m-search-box">
                  {ISearch(18)}
                  <input
                    value={searchPlate}
                    onChange={e => setSearchPlate(e.target.value)}
                    placeholder="ABC 1234"
                    className="m-search-input"
                    title="Enter a valid plate number"
                    maxLength={12}
                    required
                  />
                </div>
                <button className="m-btn m-btn-primary" type="submit" disabled={loading}>
                  {loading ? 'Searching...' : 'Search Plate'}
                </button>
              </form>

              <div className="m-home-divider">
                <span>or</span>
              </div>

              <div className="m-home-auth">
                <p className="m-section-sub">Registered user? Access your wallet and vehicles</p>
                <button className="m-btn m-btn-secondary" onClick={() => setScreen('login')}>
                  {IUser(18)} <span>Log In</span>
                </button>
                <button className="m-btn m-btn-ghost" onClick={() => setScreen('register')}>
                  Create Account
                </button>
              </div>

            </div>
          )}

          {/* ---------- LOGIN ---------- */}
          {screen === 'login' && (
            <div className="m-screen m-auth">
              <button className="m-back" onClick={() => setScreen('home')}>{IArrow(18)} <span>Back</span></button>
              <Logo size={48} />
              <h1 className="m-auth-title">Welcome Back</h1>
              <p className="m-auth-sub">Log in to manage your vehicles and wallet</p>
              <form className="m-form" onSubmit={event => { event.preventDefault(); void handleLogin(); }}>
                <div className="m-field">
                  <label>Email</label>
                  <input value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="you@email.com" type="email" autoComplete="email" required />
                </div>
                <div className="m-field">
                  <label>Password</label>
                  <input value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} type="password" autoComplete="current-password" minLength={8} required />
                </div>
                <button className="m-btn m-btn-primary" type="submit" disabled={loading}>
                  {loading ? 'Logging in...' : 'Log In'}
                </button>
                <button className="m-inline-link" type="button" onClick={() => setScreen('forgotPassword')}>Forgot password?</button>
                <button className="m-btn m-btn-ghost" type="button" onClick={() => setScreen('register')}>
                  Don't have an account? Register
                </button>
              </form>
            </div>
          )}

          {/* ---------- REGISTER ---------- */}
          {screen === 'register' && (
            <div className="m-screen m-auth">
              <button className="m-back" onClick={() => setScreen('home')}>{IArrow(18)} <span>Back</span></button>
              <Logo size={48} />
              <h1 className="m-auth-title">Create Account</h1>
              <p className="m-auth-sub">Register to use wallet payments and save your vehicles</p>
              <form className="m-form" onSubmit={event => { event.preventDefault(); void handleRegister(); }}>
                <div className="m-name-fields">
                  <div className="m-field">
                    <label>First Name</label>
                    <input value={registerForm.first_name} onChange={e => setRegisterForm({ ...registerForm, first_name: e.target.value })} autoComplete="given-name" required />
                  </div>
                  <div className="m-field">
                    <label>Last Name</label>
                    <input value={registerForm.last_name} onChange={e => setRegisterForm({ ...registerForm, last_name: e.target.value })} autoComplete="family-name" required />
                  </div>
                </div>
                <div className="m-field">
                  <label>Email</label>
                  <input value={registerForm.email} onChange={e => setRegisterForm({ ...registerForm, email: e.target.value })} placeholder="you@email.com" type="email" autoComplete="email" required />
                </div>
                <div className="m-field">
                  <label>Phone Number</label>
                  <input value={registerForm.phone} onChange={e => setRegisterForm({ ...registerForm, phone: e.target.value })} placeholder="0912 345 6789" type="tel" autoComplete="tel" maxLength={20} required />
                </div>
                <div className="m-field">
                  <label>Password</label>
                  <input value={registerForm.password} onChange={e => setRegisterForm({ ...registerForm, password: e.target.value })} type="password" autoComplete="new-password" minLength={8} required />
                </div>
                <button className="m-btn m-btn-primary" type="submit" disabled={loading}>
                  {loading ? 'Creating...' : 'Register'}
                </button>
                <button className="m-btn m-btn-ghost" type="button" onClick={() => setScreen('login')}>
                  Already have an account? Log In
                </button>
              </form>
            </div>
          )}

          {screen === 'forgotPassword' && (
            <div className="m-screen m-auth">
              <button className="m-back" onClick={() => setScreen('login')}>{IArrow(18)} <span>Back to login</span></button>
              <Logo size={48} />
              <h1 className="m-auth-title">Reset Password</h1>
              <p className="m-auth-sub">We’ll email you a secure link to choose a new password.</p>
              <form className="m-form" onSubmit={event => { event.preventDefault(); void sendPasswordReset(); }}>
                <div className="m-field">
                  <label>Email</label>
                  <input value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="you@email.com" type="email" autoComplete="email" required />
                </div>
                <button className="m-btn m-btn-primary" type="submit" disabled={loading}>{loading ? 'Sending...' : 'Send Reset Link'}</button>
              </form>
            </div>
          )}

          {screen === 'resetPassword' && (
            <div className="m-screen m-auth">
              <Logo size={48} />
              <h1 className="m-auth-title">Choose a New Password</h1>
              <form className="m-form" onSubmit={event => { event.preventDefault(); void saveNewPassword(); }}>
                <div className="m-field">
                  <label>New Password</label>
                  <input value={passwordForm.password} onChange={e => setPasswordForm({ ...passwordForm, password: e.target.value })} type="password" autoComplete="new-password" minLength={8} required />
                </div>
                <div className="m-field">
                  <label>Confirm Password</label>
                  <input value={passwordForm.confirmPassword} onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} type="password" autoComplete="new-password" minLength={8} required />
                </div>
                <button className="m-btn m-btn-primary" type="submit" disabled={loading}>{loading ? 'Updating...' : 'Update Password'}</button>
              </form>
            </div>
          )}

          {/* ---------- SEARCH RESULT (Concept A) ---------- */}
          {screen === 'searchResult' && (
            <div className="m-screen">
              <button className="m-back" onClick={() => setScreen('home')}>{IArrow(18)} <span>Back</span></button>
              <h1 className="m-page-title">Plate: {searchPlate.toUpperCase()}</h1>
              <div className="m-plate-photo">
                {searchedPlateImage
                  ? <img src={searchedPlateImage} alt={`Plate snapshot for ${searchPlate.toUpperCase()}`} />
                  : <span>{ICar(24)} Plate image unavailable</span>}
              </div>

              {searchedSession ? (
                <>
                  <div className="m-active-session-card">
                    <div className="m-session-header">
                      <span className={`m-vehicle-badge m-vehicle-${searchedSession.vehicle_type}`}>
                        {searchedSession.vehicle_type === 'car' ? ICar(18) : IBike(18)}
                      </span>
                      <span className="m-session-status">Active Parking</span>
                    </div>
                    <div className="m-session-row">
                      <span className="m-session-label">Entry Time</span>
                      <span className="m-session-value">{formatTime(searchedSession.entry_time)}</span>
                    </div>
                    <div className="m-session-row">
                      <span className="m-session-label">Duration</span>
                      <span className="m-session-value">{formatDuration(Date.now() - new Date(searchedSession.entry_time).getTime())}</span>
                    </div>
                    {searchedSession.slot_id && (
                      <div className="m-session-row">
                        <span className="m-session-label">Slot</span>
                        <span className="m-session-value">{searchedSession.slot_id}</span>
                      </div>
                    )}
                    <div className="m-session-row">
                      <span className="m-session-label">Estimated Cost</span>
                      <span className="m-session-value m-session-cost">
                        {currency}{(Math.max(0.5, (Date.now() - new Date(searchedSession.entry_time).getTime()) / 3600000) * (searchedSession.vehicle_type === 'car' ? settings.hourly_rate_car : settings.hourly_rate_motorcycle)).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="m-pay-section">
                    <h2 className="m-section-title">Pay Now</h2>
                    <div className="m-pay-methods">
                      {settings.payment_methods.map(method => (
                        <button key={method} className="m-pay-method" onClick={() => paySession(searchedSession, method)}>
                          <span className="m-pay-method-label">{method === 'gcash' ? 'GCash' : method === 'card' ? 'Card' : 'Cash'}</span>
                          <span className="m-pay-method-arrow">{IArrow(16)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="m-empty-state">
                  <span className="m-empty-icon">{ICar(36)}</span>
                  <h2>No Active Session</h2>
                  <p>No active parking found for plate {searchPlate.toUpperCase()}.</p>
                  <p className="m-empty-sub">Your vehicle may have already exited, or the plate hasn't been detected yet.</p>
                </div>
              )}

              {searchedPayments.length > 0 && (
                <div className="m-history-section">
                  <h2 className="m-section-title">Payment History</h2>
                  {searchedPayments.map(p => (
                    <div key={p.id} className="m-history-item">
                      <div className="m-history-left">
                        <span className="m-history-receipt">{IReceipt(16)}</span>
                        <div>
                          <div className="m-history-amount">{currency}{p.total_amount.toFixed(2)}</div>
                          <div className="m-history-meta">{p.receipt_number} · {formatTime(p.created_at)}</div>
                        </div>
                      </div>
                      <span className={`m-history-status m-status-${p.status}`}>{p.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---------- DASHBOARD (Concept B) ---------- */}
          {screen === 'dashboard' && user && (
            <div className="m-screen m-dashboard">
              <div className="m-dash-header">
                <div className="m-dash-greeting">
                  <span className="m-dash-avatar">{user.full_name.charAt(0)}</span>
                  <div>
                    <div className="m-dash-hello">Hello,</div>
                    <div className="m-dash-name">{user.full_name.split(' ')[0]}</div>
                  </div>
                </div>
                <button className="m-dash-logout" onClick={logout}>{ILogout(18)}</button>
              </div>

              {/* Wallet balance */}
              <div className="m-wallet-card" onClick={() => setScreen('wallet')}>
                <div className="m-wallet-top">
                  <span className="m-wallet-label">{IWallet(18)} Wallet Balance</span>
                </div>
                <div className="m-wallet-amount">{currency}{user.wallet_balance.toFixed(2)}</div>
                <div className="m-wallet-action">Tap to top up {IArrow(14)}</div>
              </div>

              {/* Active driver session */}
              {activeSession ? (
                <div className="m-active-session-card">
                  <div className="m-session-header">
                    <span className={`m-vehicle-badge m-vehicle-${activeSession.vehicle_type}`}>
                      {activeSession.vehicle_type === 'car' ? ICar(18) : IBike(18)}
                    </span>
                    <span className="m-session-status">Parked Now</span>
                  </div>
                  {activeSession.image_url && <img className="m-session-image" src={activeSession.image_url} alt={`Entry photo for ${activeSession.plate_number}`} />}
                  <div className="m-session-row">
                    <span className="m-session-label">Plate</span>
                    <span className="m-session-value m-plate">{activeSession.plate_number}</span>
                  </div>
                  <div className="m-session-row">
                    <span className="m-session-label">Duration</span>
                    <span className="m-session-value">{formatDuration(Date.now() - new Date(activeSession.entry_time).getTime())}</span>
                  </div>
                  {activeSession.slot_id && (
                    <div className="m-session-row">
                      <span className="m-session-label">Slot</span>
                      <span className="m-session-value">{activeSession.slot_id}</span>
                    </div>
                  )}
                  <div className="m-session-row">
                    <span className="m-session-label">Cost So Far</span>
                    <span className="m-session-value m-session-cost">
                      {currency}{(Math.max(0.5, (Date.now() - new Date(activeSession.entry_time).getTime()) / 3600000) * (activeSession.vehicle_type === 'car' ? settings.hourly_rate_car : settings.hourly_rate_motorcycle)).toFixed(2)}
                    </span>
                  </div>
                  <button className="m-btn m-btn-primary m-btn-full" onClick={() => paySession(activeSession, 'wallet')}>
                    Pay with Wallet ({currency}{user.wallet_balance.toFixed(2)})
                  </button>
                </div>
              ) : (
                <div className="m-no-session">
                  <span className="m-no-session-icon">{IParking(28)}</span>
                  <p>No active parking session</p>
                  <span className="m-no-session-sub">Drive in and your session appears here automatically</span>
                </div>
              )}

              <section className="m-slot-section">
                <div className="m-preview-header">
                  <h2 className="m-section-title">Parking Availability</h2>
                  <span className="m-live-indicator"><span />LIVE</span>
                </div>
                <div className="m-peak-hours">
                  <span className="m-peak-label">Peak hours</span>
                  {peakHours.length > 0
                    ? peakHours.map(hour => <span key={hour} className={`m-peak-chip ${peakHourNow ? 'is-current' : ''}`}>{formatHour(hour)}</span>)
                    : <span className="m-peak-empty">No peak data yet</span>}
                  {peakHourNow && <span className="m-peak-now">PEAK NOW</span>}
                </div>
                {parkingSlots.length > 0 ? (
                  <div className="m-slot-grid">
                    {parkingSlots.map(slot => (
                      <div key={slot.id} className={`m-slot-card m-slot-${slot.status}`}>
                        <strong>{slot.slot_id}</strong>
                        <span className="m-slot-type">{slot.vehicle_type}</span>
                        <span className="m-slot-status">{slot.status}</span>
                        {peakHourNow && <span className="m-slot-peak-mark">Peak period</span>}
                      </div>
                    ))}
                  </div>
                ) : <div className="m-empty-mini"><p>No parking slots are published yet.</p></div>}
              </section>

              {/* Quick actions panel */}
              <div className="m-quick-actions">
                <button className="m-quick-action" onClick={() => setScreen('vehicles')}>
                  <span className="m-qa-icon m-qa-blue">{ICar(22)}</span>
                  <span>My Vehicles</span>
                  {vehicles.length > 0 && <span className="m-qa-badge">{vehicles.length}</span>}
                </button>
                <button className="m-quick-action" onClick={() => setScreen('sessions')}>
                  <span className="m-qa-icon m-qa-green">{IClock(22)}</span>
                  <span>Sessions</span>
                </button>
                <button className="m-quick-action" onClick={() => setScreen('payments')}>
                  <span className="m-qa-icon m-qa-orange">{IReceipt(22)}</span>
                  <span>Payments</span>
                </button>
                <button className="m-quick-action" onClick={() => setScreen('wallet')}>
                  <span className="m-qa-icon m-qa-purple">{IWallet(22)}</span>
                  <span>Wallet</span>
                </button>
              </div>

              {/* Vehicles summary list */}
              <div className="m-preview-section">
                <div className="m-preview-header">
                  <h2 className="m-section-title">Registered Vehicles</h2>
                  <button className="m-preview-link" onClick={() => setScreen('vehicles')}>Manage</button>
                </div>
                {vehicles.length > 0 ? (
                  vehicles.map(v => (
                    <div key={v.id} className="m-vehicle-card">
                      <span className={`m-vehicle-badge m-vehicle-${v.vehicle_type}`}>
                        {v.vehicle_type === 'car' ? ICar(18) : IBike(18)}
                      </span>
                      <div className="m-vehicle-info">
                        <div className="m-vehicle-plate">{v.plate_number}</div>
                        <div className="m-vehicle-meta">{v.vehicle_type}{v.color ? ` · ${v.color}` : ''}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="m-empty-mini">
                    <p>No vehicles registered yet</p>
                    <button className="m-btn m-btn-small" onClick={() => setScreen('vehicles')}>Add Vehicle</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------- VEHICLES ---------- */}
          {screen === 'vehicles' && user && (
            <div className="m-screen">
              <button className="m-back" onClick={() => setScreen('dashboard')}>{IArrow(18)} <span>Back</span></button>
              <h1 className="m-page-title">My Vehicles</h1>
              <form className="m-add-vehicle" onSubmit={event => { event.preventDefault(); void saveVehicle(); }}>
                <div className="m-field">
                  <label>Plate Number</label>
                  <input value={vehicleForm.plate} onChange={e => setVehicleForm({ ...vehicleForm, plate: e.target.value })} placeholder="ABC 1234" required />
                </div>
                <div className="m-field">
                  <label>Vehicle Type</label>
                  <div className="m-type-toggle">
                    <button type="button" className={vehicleForm.type === 'car' ? 'active' : ''} onClick={() => setVehicleForm({ ...vehicleForm, type: 'car' })}>
                      {ICar(18)} <span>Car</span>
                    </button>
                    <button type="button" className={vehicleForm.type === 'motorcycle' ? 'active' : ''} onClick={() => setVehicleForm({ ...vehicleForm, type: 'motorcycle' })}>
                      {IBike(18)} <span>Motorcycle</span>
                    </button>
                  </div>
                </div>
                <div className="m-field">
                  <label>Vehicle Make</label>
                  <input value={vehicleForm.make} onChange={e => setVehicleForm({ ...vehicleForm, make: e.target.value })} placeholder="Toyota" required />
                </div>
                <div className="m-field">
                  <label>Vehicle Color</label>
                  <input value={vehicleForm.color} onChange={e => setVehicleForm({ ...vehicleForm, color: e.target.value })} placeholder="Red" required />
                </div>
                <button className="m-btn m-btn-primary m-btn-full" type="submit">
                  {editingVehicleId ? ICheck(16) : IPlus(16)} <span>{editingVehicleId ? 'Save Vehicle' : 'Add Vehicle'}</span>
                </button>
                {editingVehicleId && <button className="m-btn m-btn-ghost" type="button" onClick={resetVehicleForm}>Cancel Edit</button>}
              </form>

              <div className="m-list">
                {vehicles.map(v => (
                  <div key={v.id} className="m-vehicle-card">
                    <span className={`m-vehicle-badge m-vehicle-${v.vehicle_type}`}>
                      {v.vehicle_type === 'car' ? ICar(18) : IBike(18)}
                    </span>
                    <div className="m-vehicle-info">
                      <div className="m-vehicle-plate">{v.plate_number}</div>
                      <div className="m-vehicle-meta">{[v.make, v.vehicle_type, v.color].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="m-vehicle-actions">
                      <button type="button" aria-label={`Edit ${v.plate_number}`} onClick={() => beginVehicleEdit(v)}>{IEdit(16)}</button>
                      <button type="button" aria-label={`Delete ${v.plate_number}`} onClick={() => void deleteVehicle(v)}>{ITrash(16)}</button>
                    </div>
                  </div>
                ))}
                {vehicles.length === 0 && <div className="m-empty-mini"><p>No vehicles registered yet.</p></div>}
              </div>
            </div>
          )}

          {/* ---------- SESSIONS ---------- */}
          {screen === 'sessions' && user && <SessionsScreen userId={user.id} onBack={() => setScreen('dashboard')} currency={currency} />}

          {/* ---------- PAYMENTS ---------- */}
          {screen === 'payments' && user && <PaymentsScreen userId={user.id} onBack={() => setScreen('dashboard')} currency={currency} />}

          {/* ---------- WALLET ---------- */}
          {screen === 'wallet' && user && (
            <div className="m-screen">
              <button className="m-back" onClick={() => setScreen('dashboard')}>{IArrow(18)} <span>Back</span></button>
              <h1 className="m-page-title">My Wallet</h1>
              <div className="m-wallet-card m-wallet-large">
                <div className="m-wallet-top">
                  <span className="m-wallet-label">{IWallet(18)} Balance</span>
                </div>
                <div className="m-wallet-amount m-wallet-amount-lg">{currency}{user.wallet_balance.toFixed(2)}</div>
              </div>
              <form className="m-topup" onSubmit={event => { event.preventDefault(); void topUpWallet(); }}>
                <h2 className="m-section-title">Top Up Wallet</h2>
                <div className="m-topup-amounts">
                  {[100, 200, 500, 1000].map(amt => (
                    <button key={amt} type="button" className="m-topup-chip" onClick={() => setTopUpAmount(String(amt))}>
                      {currency}{amt}
                    </button>
                  ))}
                </div>
                <div className="m-field">
                  <label>Custom Amount</label>
                  <input value={topUpAmount} onChange={e => setTopUpAmount(e.target.value)} placeholder="0.00" type="number" min="0.01" step="0.01" required />
                </div>
                <button className="m-btn m-btn-primary m-btn-full" type="submit">
                  Top Up {topUpAmount ? `${currency}${parseFloat(topUpAmount).toFixed(2)}` : ''}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Bottom navigation panel */}
        {user && ['dashboard', 'vehicles', 'sessions', 'payments', 'wallet'].includes(screen) && (
          <div className="m-bottomnav">
            <button className={screen === 'dashboard' ? 'active' : ''} onClick={() => setScreen('dashboard')}>
              {IUser(20)} <span>Home</span>
            </button>
            <button className={screen === 'vehicles' ? 'active' : ''} onClick={() => setScreen('vehicles')}>
              {ICar(20)} <span>Vehicles</span>
            </button>
            <button className={screen === 'sessions' ? 'active' : ''} onClick={() => setScreen('sessions')}>
              {IClock(20)} <span>Sessions</span>
            </button>
            <button className={screen === 'wallet' ? 'active' : ''} onClick={() => setScreen('wallet')}>
              {IWallet(20)} <span>Wallet</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * Sub-screens (kept in same file for portability)
 * ============================================================ */

/**
 * SessionsScreen — Renders the historical active and completed parking logs associated with a driver account.
 *
 * @param props — Target AppUser metadata and return navigation callback
 * @returns Driver sessions list UI
 */
function SessionsScreen({ userId, onBack, currency }: { userId: string; onBack: () => void; currency: string }) {
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('parking_sessions').select('*').eq('app_user_id', userId).order('created_at', { ascending: false }).then(({ data }) => {
      setSessions((data as ParkingSession[]) || []);
      setLoading(false);
    });
  }, [userId]);

  return (
    <div className="m-screen">
      <button className="m-back" onClick={onBack}>{IArrow(18)} <span>Back</span></button>
      <h1 className="m-page-title">Parking Sessions</h1>
      {loading ? (
        <div className="m-loading">Loading...</div>
      ) : sessions.length > 0 ? (
        <div className="m-list">
          {sessions.map(s => {
            const duration = s.exit_time ? new Date(s.exit_time).getTime() - new Date(s.entry_time).getTime() : Date.now() - new Date(s.entry_time).getTime();
            return (
              <div key={s.id} className="m-session-list-item">
                {s.image_url
                  ? <img className="m-history-session-image" src={s.image_url} alt={`Entry photo for ${s.plate_number}`} />
                  : <span className={`m-vehicle-badge m-vehicle-${s.vehicle_type}`}>{s.vehicle_type === 'car' ? ICar(16) : IBike(16)}</span>}
                <div className="m-session-list-info">
                  <div className="m-session-list-plate">{s.plate_number}</div>
                  <div className="m-session-list-meta">
                    {formatTime(s.entry_time)} · {formatDuration(duration)}
                  </div>
                </div>
                <span className={`m-session-list-status m-status-${s.status}`}>{s.status}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="m-empty-state">
          <span className="m-empty-icon">{IClock(36)}</span>
          <h2>No Sessions Yet</h2>
          <p>Your parking history will appear here</p>
        </div>
      )}
    </div>
  );
}

/**
 * PaymentsScreen — Renders all digital financial transactions processed for a driver account.
 *
 * @param props — Target AppUser metadata and return navigation callback
 * @returns Driver payments history UI
 */
function PaymentsScreen({ userId, onBack, currency }: { userId: string; onBack: () => void; currency: string }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('parking_sessions').select('plate_number').eq('app_user_id', userId).then(({ data: sessions }) => {
      const plates = (sessions || []).map((s: any) => s.plate_number);
      if (plates.length === 0) { setPayments([]); setLoading(false); return; }
      supabase.from('payments').select('*').in('plate_number', plates).order('created_at', { ascending: false }).then(({ data }) => {
        setPayments((data as Payment[]) || []);
        setLoading(false);
      });
    });
  }, [userId]);

  const totalPaid = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.total_amount, 0);

  return (
    <div className="m-screen">
      <button className="m-back" onClick={onBack}>{IArrow(18)} <span>Back</span></button>
      <h1 className="m-page-title">Payment History</h1>

      {payments.length > 0 && (
        <div className="m-pay-summary">
          <div className="m-pay-summary-label">Total Paid</div>
          <div className="m-pay-summary-amount">{currency}{totalPaid.toFixed(2)}</div>
        </div>
      )}

      {loading ? (
        <div className="m-loading">Loading...</div>
      ) : payments.length > 0 ? (
        <div className="m-list">
          {payments.map(p => (
            <div key={p.id} className="m-history-item">
              <div className="m-history-left">
                <span className="m-history-receipt">{IReceipt(16)}</span>
                <div>
                  <div className="m-history-amount">{currency}{p.total_amount.toFixed(2)}</div>
                  <div className="m-history-meta">{p.receipt_number} · {formatTime(p.created_at)}</div>
                  <div className="m-history-method">{p.payment_method} · {p.duration_hours}h</div>
                </div>
              </div>
              <span className={`m-history-status m-status-${p.status}`}>{p.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="m-empty-state">
          <span className="m-empty-icon">{IReceipt(36)}</span>
          <h2>No Payments Yet</h2>
          <p>Your payment history will appear here</p>
        </div>
      )}
    </div>
  );
}
