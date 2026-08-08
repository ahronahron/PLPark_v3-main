import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type VehicleType = 'car' | 'motorcycle';
export type SlotStatus = 'available' | 'occupied' | 'reserved' | 'disabled';
export type SessionStatus = 'active' | 'completed';
export type PaymentMethod = 'cash' | 'gcash' | 'card';
export type PaymentStatus = 'completed' | 'pending' | 'refunded' | 'failed';
export type CameraType = 'entrance' | 'exit' | 'slot';
export type Direction = 'entry' | 'exit';
export type ConceptType = 'A' | 'B' | 'C';
export type UserRole = 'admin' | 'operator' | 'viewer';

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

export interface AppUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  wallet_balance: number;
  status: 'active' | 'inactive';
  created_at: string;
}

export interface Vehicle {
  id: string;
  app_user_id: string | null;
  plate_number: string;
  vehicle_type: VehicleType;
  color: string | null;
  image_url: string | null;
  created_at: string;
}

export interface ParkingSlot {
  id: string;
  slot_id: string;
  floor: string;
  vehicle_type: VehicleType;
  status: SlotStatus;
  current_session_id: string | null;
  created_at: string;
}

export interface ParkingSession {
  id: string;
  plate_number: string;
  vehicle_type: VehicleType;
  color: string | null;
  image_url: string | null;
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

export interface Camera {
  id: string;
  name: string;
  type: CameraType;
  location: string | null;
  is_online: boolean;
  slot_range: string | null;
  created_at: string;
}

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

export interface Notification {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  module: string;
  details: string | null;
  created_at: string;
}

export interface Settings {
  [key: string]: any;
}
