/**
 * hooks.ts — Custom React Hooks for Data Fetching
 *
 * This module provides reusable React hooks that encapsulate
 * Supabase queries for the most commonly accessed data tables.
 * Each hook follows the same pattern:
 *
 * 1. Initialize state with an empty array (or default value)
 * 2. Fetch data from Supabase on component mount (useEffect)
 * 3. Return the data, a setter for local mutations, and a loading flag
 *
 * These hooks are used across multiple pages to avoid
 * duplicating data-fetching logic.
 */
import { useEffect, useState } from 'react';
import { supabase, type ParkingSlot, type Camera, type PlateRecognition, type ParkingSession, type Notification } from '@/lib/supabase';

/**
 * useSlots — Fetches all parking slots from the database.
 *
 * Queries the `parking_slots` table ordered by slot_id (e.g., A1, A2, B1...).
 * Returns the slots array, a setter function for optimistic local updates,
 * and a loading boolean that starts true until the query completes.
 *
 * @returns {{ slots: ParkingSlot[], setSlots: Function, loading: boolean }}
 */
export function useSlots() {
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all parking slots ordered alphabetically by slot_id
    supabase.from('parking_slots').select('*').order('slot_id').then(({ data }) => {
      setSlots(data || []);
      setLoading(false);
    });
  }, []);

  return { slots, setSlots, loading };
}

/**
 * useCameras — Fetches all camera configurations from the database.
 *
 * Queries the `cameras` table ordered by name. Each camera has a type
 * (entrance/exit/slot), online status, and optional slot range.
 *
 * @returns {{ cameras: Camera[], setCameras: Function, loading: boolean }}
 */
export function useCameras() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all cameras ordered alphabetically by name
    supabase.from('cameras').select('*').order('name').then(({ data }) => {
      setCameras(data || []);
      setLoading(false);
    });
  }, []);

  return { cameras, setCameras, loading };
}

/**
 * usePlateRecognitions — Fetches recent plate detection events.
 *
 * Queries the `plate_recognitions` table in reverse chronological order,
 * limited to the specified number of results (default: 20).
 * Each record represents a single OCR/ALPR detection event.
 *
 * @param limit — Maximum number of records to fetch (default: 20)
 * @returns {{ recognitions: PlateRecognition[], setRecognitions: Function, loading: boolean }}
 */
export function usePlateRecognitions(limit = 20) {
  const [recognitions, setRecognitions] = useState<PlateRecognition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch the most recent plate recognitions, newest first
    supabase.from('plate_recognitions').select('*').order('created_at', { ascending: false }).limit(limit).then(({ data }) => {
      setRecognitions(data || []);
      setLoading(false);
    });
  }, [limit]);

  return { recognitions, setRecognitions, loading };
}

/**
 * useSessions — Fetches all parking sessions from the database.
 *
 * Queries the `parking_sessions` table in reverse chronological order.
 * Includes both active and completed sessions. The returned setter
 * allows pages to optimistically update the local state after mutations.
 *
 * @returns {{ sessions: ParkingSession[], setSessions: Function, loading: boolean }}
 */
export function useSessions() {
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all sessions ordered by creation date (newest first)
    supabase.from('parking_sessions').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      setSessions(data || []);
      setLoading(false);
    });
  }, []);

  return { sessions, setSessions, loading };
}

/**
 * useNotifications — Fetches system notifications and provides a mark-all-read function.
 *
 * Queries the `notifications` table in reverse chronological order.
 * Used by the Topbar bell icon to display unread notification count
 * and the notification dropdown list.
 *
 * The `markAllRead` function:
 * 1. Sends an UPDATE query to Supabase setting is_read=true for all unread notifications
 * 2. Optimistically updates the local state to immediately reflect the change
 *
 * @returns {{ notifications: Notification[], markAllRead: () => Promise<void> }}
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    // Fetch all notifications ordered by creation date (newest first)
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      setNotifications(data || []);
    });
  }, []);

  /**
   * markAllRead — Marks all unread notifications as read.
   *
   * Performs a bulk UPDATE on the `notifications` table where is_read is false,
   * then optimistically updates the local notification state so the UI
   * reflects the change immediately without a refetch.
   */
  const markAllRead = async () => {
    // Update all unread notifications in the database
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);

    // Optimistically update local state — set all notifications to read
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  return { notifications, markAllRead };
}
