/**
 * supabase.ts — Supabase Client & Type Definitions
 *
 * This module initializes the Supabase client and exports all
 * TypeScript type definitions and interfaces used throughout
 * the PLPark application. It serves as the single source of
 * truth for:
 *
 * 1. **Database Connection** — Creates and exports the Supabase
 *    client using environment variables.
 *
 * 2. **Type Unions** — Defines string literal unions for statuses,
 *    vehicle types, payment methods, camera types, and roles.
 *
 * 3. **Data Interfaces** — Mirrors the database table schemas as
 *    TypeScript interfaces for type-safe data access.
 */
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase project URL — loaded from the VITE_SUPABASE_URL
 * environment variable defined in .env.local.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

/**
 * Supabase anonymous (public) API key — loaded from the
 * VITE_SUPABASE_ANON_KEY environment variable. This key is
 * safe for client-side use because access is controlled by
 * Row Level Security (RLS) policies on each table.
 */
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * supabase — The initialized Supabase client instance.
 * Used throughout the app for all database queries, inserts,
 * updates, and deletes. Import this in any file that needs
 * to interact with the database.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ============================================================
// TYPE DEFINITIONS — String literal unions for database enums
// ============================================================

/** Vehicle classification types supported by the system */
export type VehicleType = 'car' | 'motorcycle';

/** Possible states for a parking slot */
export type SlotStatus = 'available' | 'occupied' | 'reserved' | 'disabled';

/** Parking session lifecycle states */
export type SessionStatus = 'active' | 'completed';

/** Supported payment methods */
export type PaymentMethod = 'cash' | 'gcash' | 'card';

/** Payment transaction states */
export type PaymentStatus = 'completed' | 'pending' | 'refunded' | 'failed';

/** Camera functional role assignments */
export type CameraType = 'entrance' | 'exit' | 'slot';

/** Vehicle movement direction for plate recognition events */
export type Direction = 'entry' | 'exit';

/** Parking operational concepts (A=Public, B=Private, C=SlotMonitor) */
export type ConceptType = 'A' | 'B' | 'C';

/** Admin dashboard user role levels */
export type UserRole = 'admin' | 'operator' | 'viewer';

// ============================================================
// DATA INTERFACES — Mirror the Supabase database table schemas
// ============================================================

/**
 * User — Admin/management user for the web dashboard.
 * Maps to the `users` table in Supabase.
 * These are staff accounts, not public parking customers.
 */
export interface User {
  id: string;
  full_name: string;
  username: string;
  role: UserRole;
  status: 'active' | 'inactive';
  email: string;
  last_login: string | null;
  created_at: string;
}

/**
 * AppUser — Mobile app / public user (Concept B).
 * Maps to the `app_users` table in Supabase.
 * These are customers who register for wallet payments
 * and vehicle tracking.
 */
export interface AppUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  wallet_balance: number;
  status: 'active' | 'inactive';
  created_at: string;
}

/**
 * Vehicle — A registered vehicle linked to an AppUser.
 * Maps to the `vehicles` table in Supabase.
 * Used in Concept B for automatic session matching
 * when a registered plate is detected at entrance.
 */
export interface Vehicle {
  id: string;
  app_user_id: string | null;
  plate_number: string;
  vehicle_type: VehicleType;
  color: string | null;
  image_url: string | null;
  created_at: string;
}

/**
 * ParkingSlot — A physical parking space in the facility.
 * Maps to the `parking_slots` table in Supabase.
 * Each slot has a human-readable ID (e.g., "A1"),
 * a floor assignment, vehicle type constraint, and
 * a status that changes as vehicles park/leave.
 */
export interface ParkingSlot {
  id: string;
  slot_id: string;
  floor: string;
  vehicle_type: VehicleType;
  status: SlotStatus;
  current_session_id: string | null;
  created_at: string;
  aoi_polygon: number[][] | null;
  camera_id: string | null;
  aoi_color: string | null;
}

/**
 * ParkingSession — A single parking visit from entry to exit.
 * Maps to the `parking_sessions` table in Supabase.
 * Created when a vehicle enters, completed when it exits
 * and payment is processed. Links to cameras, slots,
 * and optionally to a registered AppUser.
 */
export interface ParkingSession {
  id: string;
  plate_number: string;
  vehicle_type: VehicleType;
  color: string | null;
  image_url: string | null;
  plate_image_url: string | null;
  concept: ConceptType;
  entry_camera: string | null;
  exit_camera: string | null;
  slot_id: string | null;
  status: SessionStatus;
  entry_time: string;
  exit_time: string | null;
  app_user_id: string | null;
  created_at: string;
}

/**
 * Camera — A camera source configured in the system.
 * Maps to the `cameras` table in Supabase.
 * Each camera is assigned a type (entrance/exit/slot)
 * and optionally covers a range of parking slots.
 */
export interface Camera {
  id: string;
  name: string;
  type: CameraType;
  location: string | null;
  is_online: boolean;
  slot_range: string | null;
  created_at: string;
}

/**
 * PlateRecognition — A single OCR/ALPR detection event.
 * Maps to the `plate_recognitions` table in Supabase.
 * Logged every time the vision system reads a plate,
 * including the confidence score and source camera.
 */
export interface PlateRecognition {
  id: string;
  plate_number: string;
  vehicle_type: VehicleType | null;
  direction: Direction;
  confidence: number;
  camera_id: string | null;
  camera_name: string | null;
  image_url: string | null;
  created_at: string;
}

/**
 * Payment — A financial transaction for parking services.
 * Maps to the `payments` table in Supabase.
 * Each payment has a unique receipt number and records
 * the duration, rate, total, method, and processing info.
 */
export interface Payment {
  id: string;
  receipt_number: string;
  plate_number: string;
  session_id: string | null;
  duration_hours: number;
  hourly_rate: number;
  total_amount: number;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  processed_by: string | null;
  created_at: string;
}

/**
 * Notification — A system alert displayed in the admin topbar bell.
 * Maps to the `notifications` table in Supabase.
 * Types include success, info, warning, and error.
 */
export interface Notification {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
}

/**
 * ActivityLog — An audit trail entry for tracking user actions.
 * Maps to the `activity_logs` table in Supabase.
 * Records who did what, in which module, with optional details.
 */
export interface ActivityLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  module: string;
  details: string | null;
  created_at: string;
}

/**
 * Settings — Flexible key-value configuration store.
 * Maps to the `settings` table in Supabase.
 * Uses a generic Record type because values are stored
 * as JSONB and can hold any data type.
 */
export interface Settings {
  [key: string]: any;
}
