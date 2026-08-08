# PLPark — Smart Parking Management System

> **PLPark (SmartPark)** is a full-stack, AI-vision-ready parking management platform built with **React + TypeScript + Vite** on the frontend and **Supabase (PostgreSQL)** on the backend. It provides a real-time admin dashboard for managing parking operations and a public-facing mobile web app for drivers to search, pay, and manage their parking sessions.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Database Schema](#database-schema)
5. [System Architecture & Vision Pipeline](#system-architecture--vision-pipeline)
6. [Core Workflows & Logic](#core-workflows--logic)
7. [Admin Dashboard Pages](#admin-dashboard-pages)
8. [Mobile / Public Web App](#mobile--public-web-app)
9. [Settings Architecture](#settings-architecture)
10. [Getting Started — How to Run](#getting-started--how-to-run)
11. [Environment Variables](#environment-variables)
12. [Supabase Setup](#supabase-setup)
13. [Default Credentials](#default-credentials)
14. [Deployment](#deployment)
15. [Troubleshooting](#troubleshooting)

---

## System Overview

PLPark manages the complete lifecycle of a parking facility:

| Feature | Description |
|---------|-------------|
| **Vehicle Detection** | YOLO-based detection of vehicle presence, type (Car, Motorcycle, Truck), and color |
| **License Plate Recognition** | OCR module (ALPR) for automatic plate reading across all camera feeds |
| **Multi-Camera Support** | Webcam, Iriun Webcam, and RTSP IP streams mapped to Entrance / Exit / Slot roles |
| **Session Management** | Automatic session creation on entry, slot assignment, and exit clearance |
| **Payment Processing** | Cash, GCash, and Card payments with digital receipt generation |
| **Mobile Web App** | Public plate search and registered user accounts with wallet system |
| **Admin Dashboard** | Real-time monitoring, manual entry, statistics, slot management, and system settings |

### Parking Concepts

The system supports **three operational concepts**:

| Concept | Description |
|---------|-------------|
| **A — Public** | Full vehicle data captured at entrance (plate + type + color), plate scanned at exit, payment via mobile app |
| **B — Private** | Plate scanned at entrance and matched to a registered user account, payment via virtual wallet |
| **C — Slot Monitor** | Camera-only slot occupancy monitoring with per-slot vehicle detection, no barriers |

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend Framework** | React | 19.x |
| **Language** | TypeScript | 6.x |
| **Build Tool** | Vite | 8.x |
| **CSS** | Tailwind CSS | 4.x + custom CSS variables |
| **Backend / Database** | Supabase (PostgreSQL) | Cloud-hosted |
| **Auth** | Supabase Auth (Admin) + Custom app_users table (Mobile) |
| **Icons** | Custom inline SVG components (no external icon library) |
| **Fonts** | Inter (UI) + JetBrains Mono (monospace/code) via Google Fonts |

---

## Project Structure

```
PLPark_v3-main/
├── public/                          # Static assets
│   ├── plp.png                      # Application logo
│   └── plppp.jpeg                   # Background / branding image
├── src/
│   ├── main.tsx                     # App entry point — mounts React root
│   ├── App.tsx                      # Root component — routing & view switching
│   ├── index.css                    # Global styles — design system, all components
│   ├── components/
│   │   ├── Layout.tsx               # Sidebar, Topbar, PageContainer shell
│   │   └── Icons.tsx                # 25+ reusable SVG icon components
│   ├── lib/
│   │   ├── supabase.ts              # Supabase client + all TypeScript interfaces
│   │   └── hooks.ts                 # Custom React hooks for data fetching
│   └── pages/
│       ├── Dashboard.tsx            # Main dashboard — capacity, cameras, plate recognition, manual entry
│       ├── Payments.tsx             # Payment processing & history table
│       ├── UserManagement.tsx       # Admin user CRUD with search
│       ├── Statistics.tsx           # Charts — daily entries, hourly occupancy, vehicle distribution, revenue
│       ├── SlotManagement.tsx       # Parking slot grid with status management
│       ├── Settings.tsx             # System configuration — cameras, rates, receipts, notifications, logs
│       └── MobileApp.tsx            # Full public/registered-user mobile experience
├── supabase/
│   └── migrations/
│       ├── 20260807101219_parking_management_schema.sql  # Complete database schema (11 tables)
│       └── 20260807101415_seed_parking_data.sql          # Seed data — admin user + default settings
├── index.html                       # HTML shell
├── vite.config.ts                   # Vite config — React plugin, Tailwind, path aliases
├── tsconfig.app.json                # TypeScript config with @/* path alias
├── package.json                     # Dependencies & scripts
├── .env.local                       # Supabase connection keys (DO NOT commit)
└── .gitignore                       # Standard ignores
```

---

## Database Schema

The system uses **11 tables** in Supabase (PostgreSQL). All tables have RLS (Row Level Security) enabled with open policies for the admin dashboard pattern.

### Entity Relationship Diagram

```
┌──────────────────┐       ┌──────────────────────┐
│     users        │       │     app_users         │
│  (Admin panel)   │       │  (Mobile app users)   │
│                  │       │                       │
│  id (uuid PK)    │       │  id (uuid PK)         │
│  full_name       │       │  full_name             │
│  username (UQ)   │       │  email (UQ)            │
│  role            │       │  phone                 │
│  status          │       │  wallet_balance        │
│  email (UQ)      │       │  status                │
│  last_login      │       │  created_at            │
│  created_at      │       └──────────┬─────────────┘
└──────────────────┘                  │ 1:N
                                      ▼
                           ┌──────────────────────┐
                           │     vehicles          │
                           │  (Registered plates)  │
                           │                       │
                           │  id (uuid PK)         │
                           │  app_user_id (FK)     │
                           │  plate_number         │
                           │  vehicle_type         │
                           │  color                │
                           │  image_url            │
                           └──────────────────────┘

┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│   parking_sessions   │   │   parking_slots       │   │     cameras          │
│                      │   │                       │   │                      │
│  id (uuid PK)        │   │  id (uuid PK)         │   │  id (uuid PK)        │
│  plate_number        │   │  slot_id (e.g. "A1")  │   │  name                │
│  vehicle_type        │   │  floor                │   │  type (entrance/     │
│  color               │   │  vehicle_type         │   │        exit/slot)    │
│  concept (A/B/C)     │   │  status (available/   │   │  location            │
│  entry_camera        │   │    occupied/reserved/ │   │  is_online           │
│  exit_camera         │   │    disabled)          │   │  slot_range          │
│  slot_id             │   │  current_session_id   │   │  created_at          │
│  status (active/     │   │  created_at           │   └──────────────────────┘
│          completed)  │   └──────────────────────┘
│  entry_time          │
│  exit_time           │   ┌──────────────────────┐   ┌──────────────────────┐
│  app_user_id (FK)    │   │ plate_recognitions   │   │     payments         │
│  created_at          │   │                       │   │                      │
└──────────────────────┘   │  id (uuid PK)         │   │  id (uuid PK)        │
                           │  plate_number         │   │  receipt_number (UQ) │
                           │  vehicle_type         │   │  plate_number        │
                           │  direction            │   │  session_id (FK)     │
                           │  confidence           │   │  duration_hours      │
                           │  camera_id (FK)       │   │  hourly_rate         │
                           │  camera_name          │   │  total_amount        │
                           │  image_url            │   │  payment_method      │
                           │  created_at           │   │  status              │
                           └──────────────────────┘   │  processed_by        │
                                                      │  created_at          │
┌──────────────────────┐   ┌──────────────────────┐   └──────────────────────┘
│   notifications      │   │    settings           │
│                      │   │                       │   ┌──────────────────────┐
│  id (uuid PK)        │   │  key (text PK)        │   │   activity_logs      │
│  type (success/      │   │  value (jsonb)         │   │                      │
│   info/warning/      │   │  updated_at            │   │  id (uuid PK)        │
│   error)             │   └──────────────────────┘   │  user_id             │
│  title               │                              │  user_name           │
│  message             │                              │  action              │
│  is_read             │                              │  module              │
│  created_at          │                              │  details             │
└──────────────────────┘                              │  created_at          │
                                                      └──────────────────────┘
```

### Key Relationships

| Parent Table | Child Table | Relationship | On Delete |
|-------------|-------------|-------------|-----------|
| `app_users` | `vehicles` | 1:N | CASCADE |
| `app_users` | `parking_sessions` | 1:N | SET NULL |
| `cameras` | `plate_recognitions` | 1:N | SET NULL |
| `parking_sessions` | `payments` | 1:N | SET NULL |

### Settings Keys (Key-Value Store)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `max_capacity_cars` | number | 0 | Maximum car parking capacity |
| `max_capacity_motorcycles` | number | 0 | Maximum motorcycle parking capacity |
| `hourly_rate_car` | number | 0 | Hourly rate for cars (₱) |
| `hourly_rate_motorcycle` | number | 0 | Hourly rate for motorcycles (₱) |
| `currency` | string | "₱" | Currency symbol (hardcoded Philippine Peso) |
| `plate_recognition_confidence_threshold` | number | 85 | Min confidence % for plate readings |
| `camera_fps` | number | 30 | Camera capture frame rate |
| `receipt_template` | object | `{header, address, footer}` | Receipt customization |
| `payment_methods` | array | `["cash","gcash","card"]` | Enabled payment methods |
| `notification_settings` | object | `{...}` | Per-event notification toggles |

---

## System Architecture & Vision Pipeline

### High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CAMERA FEEDS                      │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Webcam   │  │ Iriun Webcam │  │  RTSP/IP Cam │  │
│  └─────┬────┘  └──────┬───────┘  └──────┬───────┘  │
│        └───────────────┼─────────────────┘          │
│                        ▼                             │
│              ┌─────────────────┐                     │
│              │  Camera Router  │  ← Dynamic role     │
│              │  (Entrance /    │    assignment        │
│              │   Exit / Slot)  │                      │
│              └────────┬────────┘                     │
└───────────────────────┼─────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   ┌────────────┐ ┌──────────┐ ┌──────────────┐
   │ YOLO Model │ │ OCR/ALPR │ │ Slot Monitor │
   │            │ │          │ │  (Concept C) │
   │ • Vehicle  │ │ • Plate  │ │              │
   │   Presence │ │   Number │ │ • ROI-based  │
   │ • Type     │ │ • 3-pass │ │   occupancy  │
   │ • Color    │ │   voting │ │ • Per-slot   │
   └──────┬─────┘ └────┬─────┘ │   detection  │
          │             │       └──────┬───────┘
          └─────────────┼──────────────┘
                        ▼
              ┌─────────────────┐
              │   Supabase DB   │
              │  (PostgreSQL)   │
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          ▼                         ▼
   ┌────────────────┐      ┌──────────────┐
   │ Admin Dashboard │      │  Mobile App   │
   │ (React SPA)     │      │  (Public Web) │
   └────────────────┘      └──────────────┘
```

### Vision Pipeline Components

| Component | Purpose | Details |
|-----------|---------|---------|
| **YOLO Vision Model** | Vehicle detection & classification | Detects vehicle presence in frame, classifies Type (Car, Motorcycle, Truck), extracts Color attribute |
| **OCR / ALPR Module** | License plate recognition | Runs on vehicle snapshots from all camera endpoints. Uses 3-pass majority-vote (min 2/3 identical reads) for confirmed plates |
| **Camera Streams** | Video input sources | Supports local (Webcam, Iriun) and external RTSP IP streams. Each stream is dynamically assigned a functional role: Entrance, Exit, or Slot |

---

## Core Workflows & Logic

### 1. Entrance Processing & Session Initialization

```
Vehicle Detected at Entrance Camera
          │
          ├──► OCR Pass 1 ──┐
          ├──► OCR Pass 2 ──┼──► Majority Vote (2/3 match required)
          ├──► OCR Pass 3 ──┘           │
          │                             ▼
          ├──► YOLO ──► Vehicle Type + Color
          │                             │
          └─────────────────────────────┼──► Session Created
                                        │    [Plate, Type, Color,
                                        │     Timestamp, Snapshots]
                                        ▼
                              ┌─────────────────┐
                              │ Account Lookup   │
                              │ by Plate Number  │
                              └────────┬────────┘
                                ┌──────┴──────┐
                                ▼             ▼
                          ┌─────────┐   ┌─────────┐
                          │ MATCH   │   │ NO MATCH│
                          │ Private │   │ Public  │
                          │ Session │   │ Session │
                          └─────────┘   └─────────┘
```

**Duplicate Prevention:** Once a vehicle is scanned, re-scanning is locked until the vehicle fully clears the entrance camera frame.

### 2. Slot Management & Real-Time Monitoring

- **Interactive ROI Tool:** On the Slot Management page, admin can click coordinates on the live feed to draw custom polygon regions. Each polygon is assigned a unique Slot ID (e.g., Slot A).
- **Occupancy Detection:** When a vehicle enters an ROI polygon → status changes to **Occupied** → YOLO re-verifies vehicle type.
- **Cross-Referencing:** OCR runs on the parked vehicle's plate → snapshot saved to session → If the plate matches an existing entrance session, the Slot ID is appended. If no match, a new standalone Public Session is created.

### 3. Exit & Departure Workflow

```
Vehicle Leaves Slot ROI ──► Slot Status → "Available"
          │
Vehicle at Exit Camera
          │
          ├──► OCR ──► Plate Number
          │              │
          ▼              ▼
   ┌─────────────────────────────┐
   │ Cross-reference Session     │
   │ Verify Payment Status       │
   │ Open Barrier                │
   │ Mark Session "Completed"    │
   │ Commit to History Logs      │
   └─────────────────────────────┘
```

---

## Admin Dashboard Pages

### Navigation Structure

```
┌──────────────────────────────────────────────────┐
│  SIDEBAR (Collapsible)        │  MAIN CONTENT    │
│                               │                  │
│  🏠 Dashboard                 │  ┌────────────┐  │
│  🅿️ Slot Management           │  │  Topbar     │  │
│  📊 Statistics                │  │  (Search +  │  │
│  📝 Logs                      │  │  Notifs +   │  │
│                               │  │  Profile    │  │
│                               │  │  Dropdown)  │  │
│  ⚙️ Settings (bottom overlay)  │  └────────────┘  │
└───────────────────────────────┴──────────────────┘
```

* **Sidebar Collapse**: Can be toggled to a compact icon-only view using the Chevron button at the bottom of the sidebar.
* **Profile Dropdown**: Click the Admin profile avatar in the Topbar to access "Sign Out".
* **Floating Settings Modal**: Open Settings triggers a floating modal overlay instead of navigating to a full new page.

### Dashboard (`Dashboard.tsx`)

* **Compact Metric Cards**: Size-optimized summary cards for available Car and Motorcycle capacities.
* **Quick Actions Card**: Positioned in the upper-right of the dashboard grid, providing instant access to:
  * **Manual Entry**: Triggers a floating entry form modal. Enforces UPPERCASE formatting and strict 3-8 character bounds on plate number inputs. Supported with manually editable timestamps.
  * **Manual Payment**: Triggers a floating payment processing form modal. Automatically calculates totals and registers cash, card, or GCash payments.
* **Global Draft Persistence**: Input forms for Manual Entry and Payments automatically cache progress in `localStorage` system-wide, preserving drafts if the user accidentally closes modals or switches pages.
* **Camera Feed & Recognition**: Live preview pane alongside real-time license plate detection events.

### Slot Management (`SlotManagement.tsx`)

* **Floor & Status Filters**: Filter spots dynamically by floor, vehicle compatibility, or status (Available, Occupied, Reserved, Disabled).
* **Slot Cards**: Quick toggle options to edit slot ROIs, disable/enable, or reserve individual parking bays.

### Statistics (`Statistics.tsx`)

* Daily vehicle traffic, hourly parking occupancy levels, distribution of vehicle types, peak load hours, and weekly revenues visualized in custom styled chart containers.

### Logs (`Logs.tsx`)

A consolidated management center containing three tabbed lists:
1. **User Management**: Add, delete, or view registered admin console staff accounts.
2. **Payment Logs**: A purely read-only audit log of payment transactions (receipt numbers, plate details, durations, payment methods, totals, and statuses).
3. **Vehicle Logs**: Active and historical session list showing entrance snapshots, slot assignments, and exit details.

### Settings (`Settings.tsx`)

* **Cameras & Vision Tab**: Merges camera configurations table with plate recognition parameters (sensitivity, confidence threshold, and camera FPS).
* **Parking Handling Tab**: Consolidates parking rates, payment gateways, and print receipt templates into side-by-side structures.
  * Hardcoded Default Currency (₱).
  * Removed User Permission / RBAC configurations.


---

## Mobile / Public Web App

The mobile app (`MobileApp.tsx`) is a self-contained React component that renders inside a phone-frame mockup. It supports two access modes:

### Concept A — Public (Guest) Access

1. User enters their **Plate Number** on the home screen
2. System searches for an **active parking session** matching that plate
3. If found: displays session details (vehicle type, entry time, duration, estimated cost, slot) and offers payment options (Cash, GCash, Card)
4. Also shows recent **Payment History** for that plate

### Concept B — Registered User Access

1. **Login** with email → looks up `app_users` table
2. **Register** with name + email + phone → creates new `app_users` record
3. **Dashboard** shows:
   - Wallet balance card (tap to top up)
   - Active parking session (if any) with pay-with-wallet button
   - Quick action grid: Vehicles, Sessions, Payments, Wallet
   - Registered vehicles preview
4. **My Vehicles** — Add/view registered vehicles (plate, type, color)
5. **Sessions** — Full parking session history
6. **Payments** — Payment history with total paid summary
7. **Wallet** — Top-up with preset amounts (₱100, ₱200, ₱500, ₱1000) or custom amount

### Bottom Navigation (Logged-in Users)

`Home` → `Vehicles` → `Sessions` → `Wallet`

---

## Getting Started — How to Run

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 18+ (LTS recommended) | JavaScript runtime |
| **npm** | 9+ (comes with Node.js) | Package manager |
| **Git** | Any | Version control |
| **Supabase Account** | Free tier works | Cloud PostgreSQL database |

### Step-by-Step Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/ahronahron/PLPark_v3-main.git
cd PLPark_v3-main
```

#### 2. Install Dependencies

```bash
npm install
```

This installs all packages defined in `package.json`:
- **Runtime:** `react`, `react-dom`, `@supabase/supabase-js`, `@supabase/ssr`, `lucide-react`
- **Dev:** `vite`, `typescript`, `tailwindcss`, `@tailwindcss/vite`, `@vitejs/plugin-react`

#### 3. Configure Environment Variables

Create a `.env.local` file in the project root (or update the existing one):

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

> **Where to find these:**
> 1. Go to [supabase.com](https://supabase.com) → your project
> 2. Navigate to **Settings → API**
> 3. Copy the **Project URL** and **anon (public) key**

#### 4. Set Up the Database

In your Supabase project:

1. Go to **SQL Editor**
2. Run the **schema migration** first:
   - Copy the contents of `supabase/migrations/20260807101219_parking_management_schema.sql`
   - Paste into the SQL Editor and click **Run**
   - This creates all 11 tables, RLS policies, and indexes
3. Run the **seed migration**:
   - Copy the contents of `supabase/migrations/20260807101415_seed_parking_data.sql`
   - Paste into the SQL Editor and click **Run**
   - This creates the admin user and default settings

#### 5. Create the Admin Auth User (Optional)

If using Supabase Auth for admin login:

1. Go to **Authentication → Users → Add User**
2. Enter:
   - Email: `admin@parking.local`
   - Password: `StrongP@ssw0rd!`
3. Click **Create User**

#### 6. Start the Development Server

```bash
npm run dev
```

The app will start at **http://localhost:5173** (default Vite port).

#### 7. Open in Browser

- **Admin Dashboard:** Open `http://localhost:5173` — you'll see the admin toggle active by default
- **Mobile App:** Click the "Mobile App" toggle button at the top of the page

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL (e.g., `https://xjqfzllvskndhpxwukhp.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Your Supabase anon/public API key |

> ⚠️ **Security Note:** The `.env.local` file is listed in `.gitignore` and should **never** be committed. The anon key is safe to use client-side as it is scoped by RLS policies.

---

## Supabase Setup

### Running Migrations

**Option A — Via Supabase Dashboard (Recommended for first-time setup):**

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Run the two migration files in order:
   1. `20260807101219_parking_management_schema.sql` — Creates all tables
   2. `20260807101415_seed_parking_data.sql` — Seeds admin user & default settings

**Option B — Via Supabase CLI:**

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

### Verifying the Database

After running migrations, verify in **Table Editor** that these 11 tables exist:

- `users` — Should have 1 row (admin)
- `app_users` — Empty
- `vehicles` — Empty
- `parking_slots` — Empty
- `parking_sessions` — Empty
- `cameras` — Empty
- `plate_recognitions` — Empty
- `payments` — Empty
- `notifications` — Empty
- `settings` — Should have 5 rows (capacity, rates, currency)
- `activity_logs` — Empty

---

## Default Credentials

| Credential | Value |
|------------|-------|
| **Admin Email** | `admin@parking.local` |
| **Admin Password** | `StrongP@ssw0rd!` |
| **Database Password** | `QI3GoA17TEFmwtpL` |
| **Admin Username** (app table) | `admin` |
| **Admin Role** | `admin` |

> ⚠️ **Change these in production!** These are development defaults.

---

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| **Dev Server** | `npm run dev` | Starts Vite dev server with HMR at `localhost:5173` |
| **Build** | `npm run build` | TypeScript check + production build to `dist/` |
| **Preview** | `npm run preview` | Preview the production build locally |

---

## Deployment

### Build for Production

```bash
npm run build
```

This outputs optimized static files to the `dist/` directory.

### Deploy Options

| Platform | Steps |
|----------|-------|
| **Vercel** | Connect GitHub repo → auto-detects Vite → set env vars → deploy |
| **Netlify** | Connect repo → build command: `npm run build` → publish dir: `dist` → set env vars |
| **Supabase Hosting** | Upload `dist/` contents to Supabase Storage or use their hosting beta |
| **Any Static Host** | Upload the `dist/` folder; it's a pure SPA with no server-side requirements |

> **Important:** Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in your hosting platform.

---

## Troubleshooting

### Common Issues

| Problem | Solution |
|---------|----------|
| **Blank page on load** | Check browser console for errors. Verify `.env.local` has correct Supabase URL and key. |
| **"relation does not exist" errors** | Run the schema migration SQL in Supabase SQL Editor first. |
| **No data showing in dashboard** | Run the seed migration. Check that `settings` table has rows. |
| **`npm install` fails** | Make sure you're using Node.js 18+. Try deleting `node_modules` and `package-lock.json`, then run `npm install` again. |
| **TypeScript errors on build** | Run `npm run dev` first (dev mode is more lenient). Check `tsconfig.app.json` for path alias configuration. |
| **Mobile app not showing** | Click the "Mobile App" toggle button at the very top of the page. |
| **Supabase connection timeout** | Check your internet connection. Verify the Supabase project is active (free-tier projects pause after inactivity). |
| **Port 5173 already in use** | Kill the existing process or run `npm run dev -- --port 3000` to use a different port. |

### Getting Help

1. Check the browser **Developer Console** (F12) for JavaScript errors
2. Check the **Network tab** for failed Supabase API calls
3. Verify your Supabase project is running at [app.supabase.com](https://app.supabase.com)
4. Ensure all 11 database tables exist in **Table Editor**

---

## License

This project is developed for educational purposes as part of a college course (4th Year, 1st Semester).

---

*Built with ❤️ using React, TypeScript, Vite, and Supabase*
