import { useEffect, useState } from 'react';
import { supabase, type ParkingSlot, type Camera, type PlateRecognition, type ParkingSession, type Notification } from '@/lib/supabase';

export function useSlots() {
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => {
      setSlots(data || []);
      setLoading(false);
    });
  }, []);

  return { slots, setSlots, loading };
}

export function useCameras() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('cameras').select('*').order('name').then(({ data }) => {
      setCameras(data || []);
      setLoading(false);
    });
  }, []);

  return { cameras, setCameras, loading };
}

export function usePlateRecognitions(limit = 20) {
  const [recognitions, setRecognitions] = useState<PlateRecognition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(limit).then(({ data }) => {
      setRecognitions(data || []);
      setLoading(false);
    });
  }, [limit]);

  return { recognitions, setRecognitions, loading };
}

export function useSessions() {
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('parking_sessions').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      setSessions(data || []);
      setLoading(false);
    });
  }, []);

  return { sessions, setSessions, loading };
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      setNotifications(data || []);
    });
  }, []);

  const markAllRead = async () => {
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  return { notifications, markAllRead };
}
