# PLPark Project Dossier

> Source-grounded technical reference for thesis research and AI-assisted writing. This document describes the implementation found in this repository, not only the original README's intended design. Verify deployment-specific settings and results before using claims in a thesis.

## 1. Project Summary

PLPark (also named SmartPark in the README) is a web-based parking operations system. It combines an administrative React application, a driver-facing mobile web interface, a Supabase/PostgreSQL data store, and computer-vision modules for vehicle detection, plate localization, OCR, and parking-space occupancy monitoring.

The repository contains several related but distinct processing modes:

1. The main application is a Vite/React single-page app. It talks directly to Supabase from the browser.
2. The entrance and exit vision pipelines are implemented in `src/lib/visionEngine.ts`; cameras are opened by the browser and frames are analyzed in browser-side ONNX Runtime Web by default.
3. A local Python YOLO service can be configured as the vehicle detector for the browser pipeline. A separate local Python EasyOCR service can be configured as an OCR provider.
4. Slot occupancy in the current management UI is implemented by the browser `SlotMonitorProcessor`. It uses the same detector abstraction and writes confirmed slot status changes to Supabase. When the Python YOLO URL is configured, vehicle inference for this processor can be served by `/detect`; the Python `/status` polygon endpoint is not directly called by this UI.
5. `ALPR-Modules/main.py`, `add_missing_data.py`, and `visualize.py` form a separate offline/sample-video ALPR workflow. It is not the runtime pipeline used by the React app.

The system is best understood as a working prototype with integrated database-backed parking workflows and vision capabilities, rather than a fully deployed barrier-control or payment-gateway system.

## 2. Goals and Operating Concepts

The database and documentation use three parking concepts:

| Concept | Intended meaning | Implemented behavior |
|---|---|---|
| A: Public/guest | Plate is recognized without a registered account; the driver finds the active session and pays through the public web view. | Entrance creates a session only when visitor-entry mode allows it. Otherwise it logs the recognition and creates an approval notification. Public exit detection makes a pending payment and does not complete the session until payment is recorded. |
| B: Registered/private | A registered vehicle is associated with a mobile account and its wallet. | Plate lookup links the session to `app_users`; exit processing records a wallet payment and calls a database RPC to deduct funds. |
| C: Slot monitor | A camera observes physical parking spaces without an entry/exit barrier. | The slot processor detects vehicles intersecting manually drawn slot polygons and updates slot states. It does not itself assign a detected plate to a session or create a Concept C session. |

“Barrier control,” “automatic slot-to-session assignment,” and an end-to-end Concept C workflow are not present in the current source. The app records payment methods but does not call GCash, card networks, or another payment processor.

## 3. Technology Stack

### Main web application

| Area | Technology in repository |
|---|---|
| UI | React 19, TypeScript 6, Vite 8 |
| Styling/build integration | Tailwind CSS 4 Vite plugin plus custom CSS in `src/index.css` |
| Database client | `@supabase/supabase-js` 2.x |
| Admin/user authentication | Supabase Auth is used in the mobile user flow; admin creation is routed through a Supabase Edge Function. The root app itself does not show an admin login gate. |
| Browser vision | `onnxruntime-web` for ONNX models; `tesseract.js` for browser OCR |
| Icons | Project-owned inline SVG components in `src/components/Icons.tsx`, plus `lucide-react` dependency |
| Python vision | Ultralytics YOLO, OpenCV, NumPy, EasyOCR, PyTorch; local HTTP servers use Python's standard `http.server` |
| Database/storage | Supabase PostgreSQL, Supabase Auth, Supabase Storage, Realtime, Edge Functions, and a wallet RPC |

### Main scripts

`package.json` defines `npm run dev`, `npm run build`, and `npm run preview`. There is no dedicated test script in the package configuration.

## 4. Repository Map

| Path | Responsibility |
|---|---|
| `src/main.tsx` | React entry point. |
| `src/App.tsx` | Switches between admin shell and mobile app; `?view=mobile` selects mobile mode and mobile user agents are switched to mobile on mount. |
| `src/components/Layout.tsx` | Admin sidebar, top bar, and page shell. |
| `src/components/CameraFeed.tsx` | Camera selection, video display, pipeline controls, overlays, and entrance/exit result callbacks. |
| `src/components/SessionModal.tsx` | Manual session lookup, exit completion, and manual payment UI. |
| `src/lib/visionEngine.ts` | Camera manager, ONNX/Python detector adapter, plate detector, OCR, image upload, entrance, exit, and slot processors. |
| `src/lib/parkingFees.ts` | Shared billable-time and fee calculation. |
| `src/lib/wallet.ts` | Registered-session wallet settlement helper. |
| `src/lib/supabase.ts` | Supabase client, data interfaces, and activity-log helper. |
| `src/lib/hooks.ts` | Small query hooks for slots, cameras, recognition events, sessions, and notifications. |
| `src/pages/Dashboard.tsx` | Live operations, capacity figures, camera selection, recognition details, guest approval, and manual entry/exit workflows. |
| `src/pages/SlotManagement.tsx` | Slot CRUD, camera assignment/filtering, AOI polygon drawing, and live occupancy monitoring. |
| `src/pages/Logs.tsx` | Vehicle/session, payment, staff, and mobile client history/management. |
| `src/pages/Settings.tsx` | Camera metadata, operational settings, rates, notifications, backup/export UI, and activity logs. |
| `src/pages/Statistics.tsx` | Client-side aggregates and charts from recognition/payment records. |
| `src/pages/MobileApp.tsx` | Public plate search and registered-driver account, vehicles, sessions, payment history, and wallet screens. |
| `src/pages/Payments.tsx`, `UserManagement.tsx` | Additional payment and staff management page implementations; some are not currently selected in the root page switcher. |
| `supabase/migrations/` | Initial schema, seed data, vision storage, AOI/camera fields, auth/RLS changes, mobile account fields, duplicate-session constraint, and wallet history/RPC. |
| `ALPR-Modules/` | Python YOLO/EasyOCR utilities, optional HTTP services, and offline video-processing scripts. |
| `public/models/` | Browser ONNX models and notes on model output format. |

## 5. Architecture and Data Flow

```text
Browser camera (getUserMedia)
          |
          +--> Entrance/exit/slot processor in visionEngine.ts
          |       |-- vehicle YOLO: ONNX in browser OR Python /detect adapter
          |       |-- plate YOLO: browser ONNX model (entrance/exit)
          |       |-- OCR: Tesseract.js OR optional EasyOCR /read-plate service
          |       |-- entrance/session/payment/slot writes via Supabase client
          |
          +--> React admin or mobile UI
                  |-- Supabase Auth (mobile accounts)
                  |-- direct table queries and mutations
                  |-- Supabase Realtime subscriptions
                  v
            Supabase PostgreSQL + Storage + Auth + RPC + Edge Function
```

There is no general-purpose custom REST backend between the web client and Supabase. The browser sends table requests through the Supabase JavaScript client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Local Python services are separate HTTP processes used only when their URLs are configured.

Supabase Realtime is used for selected tables, including dashboard records, slot state, and mobile account/session/availability refreshes. Other page data is initially fetched on mount or when a tab changes.

## 6. Camera Capture and Vision Algorithms

### 6.1 Camera management

`CameraManager` requests camera permission to populate device labels, enumerates `videoinput` devices, and opens a selected camera using `navigator.mediaDevices.getUserMedia`. It requests ideal 1920x1080 resolution and an environment-facing camera when supported. It attempts continuous focus and exposure where the browser/device exposes those capabilities. Captures are copied from the video element into a canvas and returned as `ImageData` plus the canvas.

This browser path requires a secure context (HTTPS, or localhost) and a camera accessible to the browser. The camera configuration table stores fields such as `ip_address` and `connection_method`, but `CameraManager` consumes browser `deviceId` values; those metadata fields do not implement RTSP decoding. Use a browser-visible capture device/virtual camera or build a separate stream bridge for RTSP cameras.

### 6.2 Vehicle detection

The default browser detector loads `public/models/yolov8n.onnx` through ONNX Runtime Web's WASM provider. It resizes the frame directly to 640x640, changes RGBA pixels to RGB planar CHW float values normalized to `[0,1]`, and feeds a tensor of shape `[1,3,640,640]` to the model. The parser expects YOLOv8 output `[1,84,8400]` (4 box values plus 80 class scores). It selects the highest class score per candidate, applies a confidence threshold, converts center/width/height boxes to original-frame pixel coordinates, then applies non-maximum suppression (NMS) using intersection-over-union (IoU).

In the browser model's COCO mapping, class 2 is car, 3 motorcycle, 5 bus mapped to car, and 7 truck mapped to car. The Python service adapter returns common object labels and maps motorcycle to motorcycle and most other listed vehicle labels to car for the app. The service's whitelist also includes bicycle, person, train, and boat as detection results, although only detections with a non-null app `vehicleType` count as vehicles in downstream occupancy checks.

When `VITE_SLOT_MONITOR_URL` is present, `YOLODetector` skips browser ONNX loading and POSTs JPEG frames to `${VITE_SLOT_MONITOR_URL}/detect`, passing confidence and IoU values. The Python service loads its YOLO model once on startup. Network transfer and local server availability become part of the frame-processing path.

The browser detector also estimates vehicle color by sampling every third pixel in the central 40% of a detected box, averaging RGB values, and selecting the nearest Euclidean RGB reference among a fixed set of named colors. This is a heuristic, not a trained color classifier. Python detector results set color to `null`, so the entrance path may use its fallback color value.

### 6.3 Dedicated license-plate detection

The plate detector loads `public/models/license_plate_detector.onnx`; its documented output is a single-class YOLO tensor `[1,5,N]` containing center coordinates, width/height, and confidence. Before inference it letterboxes the input into 640x640 with gray padding while maintaining aspect ratio, normalizes RGB planes, and later reverses the scale/padding to restore original-frame boxes. It filters by confidence, applies NMS at IoU 0.4, and retains at most the three highest detections. Entrance and exit initialize this detector if available; if loading fails, the source contains a fallback crop inferred from the vehicle bounding box for entrance, and plate-only inference may not be available at exit.

Plate boxes are expanded by approximately 18% horizontally and 25% vertically, clipped to the frame, and enlarged 4x. The crop is converted to grayscale and contrast-adjusted. Very small crops are rejected. If the dedicated plate detector is unavailable, entrance can crop a lower portion of a vehicle box and enlarge/contrast it; this is a less specific fallback.

### 6.4 OCR, normalization, and confidence strategy

The browser OCR worker is Tesseract.js in English, configured with an uppercase alphanumeric whitelist, single-line page segmentation by default, and disabled language dictionaries to reduce language-model substitutions. OCR output is uppercased and punctuation/whitespace is removed. Only strings 3-9 characters long are retained.

For 6- or 7-character strings, `cleanAndFormatPlate` uses position-aware letter/digit substitutions when the first three characters resemble a letter prefix. Confusion maps include common OCR lookalikes, for example O/0, I/1, S/5, B/8, and similar characters. If a normalized read exactly matches a registered plate, or is one Levenshtein edit away for reads of length at least 5, the registered plate spelling is returned with a confidence boost of 30. This is database-assisted correction, not independent evidence that the OCR read is correct.

The first Tesseract OCR pass reads the contrast-adjusted grayscale crop. If confidence is below 78, a second variant is made using the crop's mean grayscale value as a global threshold; Tesseract switches to single-word segmentation for that pass and then returns to single-line mode. The stronger of the two results is retained, confidence is rounded and capped at 99, and returned confidence has a floor of 40 after a valid plate string is found.

Across frames, browser OCR normally samples three frames, 40 ms apart. The winning exact string must appear at least twice when there is more than one valid sample; ties use summed confidence. With EasyOCR configured, the sample count is two, and the implementation can return immediately on the first read if confidence is at least 85. Thus the runtime is a bounded confidence/quorum strategy, not always a strict three-read majority.

### 6.5 Optional Python EasyOCR service

`ALPR-Modules/easyocr_service.py` is a local HTTP server, defaulting to `127.0.0.1:8765`. It accepts `POST /read-plate` with a base64/data-URL crop and optional registered plate list. It initializes EasyOCR once, uses GPU when `torch.cuda.is_available()`, extracts uppercase alphanumeric candidates of length 3-9, and runs a grayscale pass. If the best first-pass result is below 70 confidence, it adds a Gaussian adaptive-threshold pass (block size 31, constant 9). Candidate resolution prefers exact registered-plate matches, then same-length fuzzy matches allowing at most one non-confusion mismatch, then the highest-confidence OCR candidate. It returns a plate/confidence JSON object or an empty object. It writes recent crops to `ALPR-Modules/debug_crops` and keeps at most 50 JPEGs.

The browser calls this service only when `VITE_EASYOCR_URL` is set and the OCR input is a canvas. Network/service errors fall back to Tesseract.js. CORS is permissive (`*`), while the service binds to loopback by default; do not expose it to an untrusted network without hardening.

## 7. Operational Workflows

### 7.1 Entrance

1. The admin selects an entrance camera and starts the `CameraFeed`.
2. The processor initializes vehicle YOLO and Tesseract in parallel and attempts to load the plate model. It caches registered vehicle plates for OCR correction.
3. It captures/analyzes a frame about every 300 ms. A processing guard prevents overlapping OCR snapshot work.
4. It runs vehicle detection and plate detection, updates on-screen boxes, and selects the highest-ranked plate detection; if unavailable it may use the vehicle-crop fallback.
5. OCR reads multiple nearby frames and applies normalization/registered-plate correction.
6. A recognized plate is guarded with an 8-second trigger cooldown and a 15-second plate lock. Before emitting a result, the processor checks active sessions; a database-query failure is treated as “already active” to fail closed.
7. It looks up the normalized plate in `vehicles`, emits an entrance result to the dashboard, then asynchronously uploads full-frame and crop snapshots and writes database records.
8. The processor inserts a `plate_recognitions` entry. If visitor mode is disabled and the plate is not registered, it records a warning notification/activity log and does not create a session. Otherwise it inserts an active `parking_sessions` row with concept B for registered vehicles and A for guests.
9. A partial unique index on normalized active plates provides a database-level second defense against duplicate active sessions.

Images use the Supabase Storage bucket `vehicle-snapshots`, under paths like `entrance/YYYY-MM-DD/PLATE_timestamp.jpg` and `plates/YYYY-MM-DD/PLATE_timestamp.jpg`. The upload helper requests a public URL. If upload fails, it returns an inline JPEG data URL instead; that fallback can make database records much larger and is not durable object storage.

### 7.2 Guest approval

With visitor-entry mode off, a non-registered plate is recognized and surfaced as a review request in the dashboard. Admin approval inserts a Concept A active session; denial writes a notification and activity log. The recognition and warning notification are distinct from session creation.

### 7.3 Exit and fee settlement

1. Exit processing scans approximately every 300 ms, checks for a vehicle (person-only frames are ignored), locates a plate, and applies the same cross-frame OCR logic.
2. It searches the newest active session for an exact plate. If none is found, it scans active sessions and accepts the first normalized plate with Levenshtein distance at most one.
3. It reads vehicle rates and grace minutes from `settings`; fallback rates in vision code are ₱50/hour for cars and ₱25/hour for motorcycles.
4. It computes billable duration and total fee (rules below), then branches by linked account.
5. For linked `app_user_id`, `settleRegisteredSessionWallet` creates a completed wallet payment, then calls `apply_wallet_transaction` with a negative amount. If the RPC fails, it deletes the just-created payment and reports an error. The SQL function updates balance and inserts a transaction record atomically within the RPC call, but it does not itself reject a negative resulting wallet balance.
6. For a public session, a completed payment allows exit. If no completed payment exists and the fee is positive, the processor creates a pending cash payment if needed, sends a payment-required notification, and leaves the session active.
7. When allowed, it logs an exit recognition, marks the session completed with exit time/camera, makes a linked slot available if `slot_id` is set, writes an exit notification, and emits the result to the UI.

The mobile public search displays an active session and offers cash/GCash/card choices. Those choices create a `payments` row in the database; this repository has no external gateway/settlement confirmation integration, so a completed row represents an application-level record, not verified transfer of funds.

### 7.4 Fee calculation

`calculateBillableHours(entry, end, graceMinutes)` subtracts nonnegative grace minutes from elapsed milliseconds. If billable time is zero or negative, the result is zero. Otherwise it rounds upward to the next half-hour and enforces a 0.5-hour minimum:

```text
billable_ms = max(0, end_ms - entry_ms - max(0, grace_minutes) * 60,000)
hours = 0                                      if billable_ms == 0
hours = max(0.5, ceil((billable_ms / 3,600,000) * 2) / 2) otherwise
fee = round(hours * hourly_rate, 2)
```

Some manual payment components permit direct duration entry and use hardcoded rates, so they do not all share the settings-driven calculation behavior of vision-driven exits and the mobile session flow.

### 7.5 Slot occupancy

1. Admin configures slots and chooses a slot camera. Slot selection is by explicit `camera_id` assignment first, then the configured `slot_range`; absent a range, all slots are shown.
2. Admin draws a polygon over the live preview. Vertices are normalized to 0-1 coordinates relative to the SVG viewport and are persisted as `parking_slots.aoi_polygon`, with `camera_id` and optional overlay color.
3. The browser `SlotMonitorProcessor` captures frames every 500 ms and calls the vehicle detector with confidence threshold 0.18 and NMS IoU threshold 0.55.
4. For each slot polygon, it tests whether a recognized vehicle bounding box overlaps the polygon. It checks the bounding-box center, bottom center, corners, and edge intersection, using a ray-casting point-in-polygon test.
5. A slot changes only after three consecutive analyzed frames disagree with its confirmed state. The processor writes `occupied` or `available` to Supabase and adds a notification. Other slot states (`reserved`, `disabled`) are managed manually and can be overwritten by live detection if monitoring is running.
6. Realtime subscriptions refresh the slot grid across clients.

The Python `slot_monitor_service.py` offers `GET /health`, `POST /detect`, and `POST /status`. `/status` runs vehicle detection and pixel-polygon intersection for a supplied list of slots. In contrast, the current React slot processor sends only `/detect` requests through `YOLODetector` when configured, performs polygon matching in TypeScript, and updates Supabase itself.

### 7.6 Manual operations

The dashboard supports manual entries after normalized active-plate duplicate checks and registered-vehicle lookup. Manual exits and payments can be performed from operations/log flows, with configuration checks for manual exit and enabled methods in some UI paths. Different manual entry/payment screens do not all centralize through a single service, so their settings/rate/receipt behavior is not perfectly uniform.

## 8. Driver-Facing Mobile Web Flows

### Public/guest use

The home screen validates a plate string (2-12 characters from letters, digits, spaces, and hyphens), normalizes it by uppercasing and removing whitespace/hyphens, and searches for an active session. It also looks up a recent recognition image and registered vehicle image as fallbacks. If a session is found it shows vehicle type, entry time, elapsed duration, slot, estimated fee, and payment actions. The search is not a public historical-session browser.

### Registered accounts

Mobile authentication uses Supabase Auth email/password signup and sign-in. Signup requires first/last name, email, valid phone, and a password of at least eight characters. `ensureAppUser` links the Auth UUID to `app_users.auth_user_id`, can attach an older profile by email, or creates a new app-user row. Password reset and recovery use Supabase Auth.

Registered drivers can register/edit/delete vehicles, browse current sessions and payment history, see wallet balance and wallet transaction history, and top up via the wallet RPC. Vehicle plates are normalized; the latest vehicle migration adds a generated normalized-plate column and unique index. Account/session/slot data refreshes through Realtime plus an 8-second active-session refresh while the dashboard screen is open.

An active session is associated by `app_user_id` first. If not directly linked, the mobile loader attempts matching against the account's registered normalized plates and backfills `app_user_id` and concept B.

Wallet “top-up” is an administrative/demo ledger credit initiated by the app. No payment provider is integrated to collect the top-up amount.

## 9. Administrative Pages

| Page/area | Functions in source |
|---|---|
| Dashboard | Occupancy/capacity figures, active sessions, camera feed and entrance/exit mode, recent recognition events and quick-look details, manual entry and exit, guest approval. Dashboard reads and subscribes to recognitions, sessions, slots, and payments. |
| Slot Management | Add/delete slots, set type/status, assign cameras/ranges, draw/edit/clear AOIs, start/stop occupancy processing, display slot states. |
| Statistics | Client-side aggregation of up to the latest 100 recognition rows and 50 payment rows into weekday entries/revenue, observed hour counts, vehicle-type distribution, and peak observed hours. It is not a full time-series analytics engine. |
| Logs & Management | Vehicle sessions, payment records, admin users, app-user clients, filters/search, detail modals, selected delete/payment/exit operations. |
| Settings | Camera metadata and device IDs, detector/OCR display settings, visitor entry/manual-exit toggles, rates/grace, payment-method choices, receipt/notification preferences, backup/export controls and activity logs. |
| Notifications | Top-bar notification list/count and mark-all-read behavior. |

The root `App.tsx` page switcher currently renders Dashboard, Slot Management, Statistics, and Logs. Settings is displayed as an overlay. Although `Payments.tsx` and `UserManagement.tsx` exist as page modules, those components are not included as standalone cases in this root switcher; related payment and user functions are also embedded in Logs/Settings.

## 10. Database Model

The initial schema creates 11 tables. Later migrations add `wallet_transactions`, so the current intended schema has 12 application tables. UUID primary keys generally use `gen_random_uuid()` and records use `timestamptz` creation times.

| Table | Purpose and notable data |
|---|---|
| `users` | Admin/staff profile: name, username, role, status, email, last login; later linked to `auth.users` with `user_id`. |
| `app_users` | Driver profile: name, unique email, phone, wallet balance/status; later linked to Auth via `auth_user_id`. |
| `vehicles` | Registered plate, app-user owner, type, make/color/image; later gets generated `normalized_plate_number` and a unique normalized-plate index. Owner delete cascades. |
| `parking_slots` | Human slot ID, floor, vehicle type, status, current session pointer; later AOI polygon/color and camera reference. |
| `parking_sessions` | Plate, vehicle type/color/images, concept, entry/exit camera labels, slot ID, status, entry/exit times, optional app-user link; later generated normalized plate and unique active-plate index. App-user deletion sets the link null. |
| `cameras` | Name, role (`entrance`, `exit`, `slot`), location, online flag, slot range; later browser device ID, IP address, and connection-method metadata. |
| `plate_recognitions` | Recognition event, plate/type/direction/confidence, optional camera reference/name and image URL. Camera deletion sets camera link null. |
| `payments` | Unique receipt, plate/session, duration/rate/amount, method/status/processor. Session deletion sets session link null. |
| `notifications` | Type/title/message/image/read flag/time for operational alerts. |
| `settings` | Primary-key string setting name to JSONB value; used for rates, capacity, visitor mode, grace period, and UI options. |
| `activity_logs` | User/action/module/details/time audit entries. |
| `wallet_transactions` | Driver wallet top-up/deduction, signed amount, balance after, optional session/payment, description/time. |

Important relationships: `app_users` 1:N `vehicles`; `app_users` 1:N `parking_sessions`; `cameras` 1:N `plate_recognitions`; `parking_sessions` 1:N `payments`; wallet transactions reference app users and optionally sessions/payments. Slot-to-session association is stored as text `slot_id` plus a current session UUID field on the slot; the initial schema does not declare a foreign key for these two fields.

Indexes include session plate/status, recognition/payment creation time, slot status, user Auth IDs, vehicle normalized plate uniqueness, one active session per normalized plate, and wallet history by user/time and session.

### Migration sequence (chronological intent)

1. `20260807101219_parking_management_schema.sql`: initial 11-table schema, indexes, and initial broad RLS policies.
2. `20260807101415_seed_parking_data.sql`: clears demo tables with `TRUNCATE ... RESTART IDENTITY CASCADE`, inserts an admin profile and minimal settings. This is destructive to existing data and should not be rerun against live data without review.
3. `20260809020000_vision_pipeline_storage.sql`: `plate_image_url`, public `vehicle-snapshots` bucket, and storage policies.
4. `20260819072802_add_aoi_polygon_to_parking_slots.sql`: AOI JSONB, camera reference, and AOI color.
5. `20260819090000_add_camera_device_id.sql`: browser camera `device_id`.
6. `20260825090000_camera_connection_details.sql`: camera IP and connection-method metadata.
7. `20260922090000_admin_auth_rls.sql`: Auth-linked admin field and authenticated-oriented table policies.
8. `20261007090000_allow_anonymous_app_access.sql`: grants anon privileges and creates full-access anon policies on all listed operational tables, superseding the earlier intended anonymous lock-down in effective access.
9. `20261009090000_mobile_account_vehicle_fields.sql`: Auth linkage for app users, vehicle make, generated normalized plates, and unique vehicle plate index.
10. `20261009110000_prevent_duplicate_active_sessions.sql`: generated normalized session plate and a partial unique index allowing at most one active session per normalized plate.
11. `20261009120000_wallet_transaction_history.sql`: wallet ledger and `apply_wallet_transaction` SECURITY DEFINER function.

The wallet migration as currently checked into the repository contains an apparent malformed table identifier in its `DROP POLICY IF EXISTS` statement (`wallet_transa ctions`). Validate/correct that SQL before applying this migration in a new Supabase project. Apply and test migrations in a disposable database before production.

## 11. Persistence, Authentication, and Security

Supabase client configuration is in `src/lib/supabase.ts`; required browser environment values are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is intentionally client-visible, but that is safe only when database policies enforce the intended authorization. In this migration history, the final anonymous-access migration explicitly gives the anon role broad CRUD access to sensitive application tables, including profiles, vehicles, sessions, payments, settings, and activity logs. Treat this as a prototype/demo configuration, not production access control.

The earlier admin-RLS migration is followed by a migration that grants anon full access, so the earlier “authenticated only” policy intent should not be assumed to be effective. The wallet RPC is also granted to anon and authenticated roles, accepts an app-user ID supplied as a parameter, and does not enforce ownership or nonnegative balances. Storage is public-read and has broad anon upload/update/delete rules. These require redesign (owner-scoped RLS, server-side authorization, restricted RPC grants/validation, and private storage or signed URLs) before handling real user, vehicle, or payment data.

`VITE_SUPABASE_ANON_KEY` must never be confused with a service-role secret. A service-role key must not be added to a Vite `VITE_*` variable because those values are bundled into the browser.

## 12. Standalone Python ALPR Demonstration

`ALPR-Modules/main.py` reads `./sample.mp4`, runs Ultralytics YOLOv8n for COCO vehicle classes (car, motorcycle, bus, truck), tracks vehicle bounding boxes with SORT, runs a separate license-plate YOLO model, and assigns a plate to a tracked vehicle only when the plate box lies fully inside that vehicle box. The plate crop is converted to grayscale and binary-inverted at threshold 64 before EasyOCR.

`util.py` checks a fixed 7-character plate shape and corrects common letter/digit confusions by character position. Results are written to `test.csv` with frame number, track ID, vehicle and plate boxes, plate detector confidence, OCR text, and OCR score. `add_missing_data.py` interpolates missing plate boxes across frames for a tracked car using SciPy linear interpolation. `visualize.py` reads the CSV/video, chooses the highest OCR-confidence plate sample per tracked vehicle, overlays boxes/labels, and writes a visualization.

This batch pipeline depends on an external SORT package (`sort.sort`) which is not listed among the repository files, and the sample video referenced by the script is not part of the provided project structure. It is therefore a separate reproducibility/demo path that needs those assets. The top-level `ALPR-Modules/README.md` attributes the base workflow/models to an external YOLOv8 ALPR tutorial/repository; treat it as a distinct research component and verify model provenance/licensing for thesis publication.

## 13. Configuration and Local Setup

### Web app

1. Install Node.js/npm compatible with the package versions.
2. Run `npm install` in the project root.
3. Create `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the intended Supabase project.
4. Apply reviewed migrations in order. Do not blindly rerun the seed migration because it truncates tables.
5. Start with `npm run dev`; use `npm run build` for production compilation and `npm run preview` to serve the generated build locally.
6. Browser camera access requires localhost or HTTPS and user permission.

### Optional Python services

Install `ALPR-Modules/requirements.txt` in a compatible Python environment. For EasyOCR, run `python easyocr_service.py` from the project root or an appropriately configured working directory; it listens on `127.0.0.1:8765`. Set `VITE_EASYOCR_URL=http://127.0.0.1:8765` before starting/rebuilding Vite.

For YOLO, run `python slot_monitor_service.py` from a working directory where the model path resolves, by default `yolov8n.pt`; the service defaults to port 8766. Configure `YOLO_MODEL` and/or `YOLO_SERVICE_PORT` as needed, and set `VITE_SLOT_MONITOR_URL=http://127.0.0.1:8766` for the browser vehicle-detection adapter. Vite environment variables are read at build/dev-server start, so restart the app after changing them.

The Python requirements pin Ultralytics 8.0.114 and also include setuptools, pandas, OpenCV, NumPy, SciPy, EasyOCR, and FilterPy. `torch` is imported by the EasyOCR service and may need an appropriate platform-specific installation if dependency resolution does not provide it.

### Model assets

The repository includes browser model files under `public/models/` (`yolov8n.onnx`, `license_plate_detector.onnx`), Python `.pt` weights under `ALPR-Modules/`, and a root `yolov8n.pt` asset in the provided workspace. The browser plate model expects the documented `[1,5,N]` output. The Python detector's model path is relative by default, so run it from a directory where the requested weight file exists or set `YOLO_MODEL` explicitly.

## 14. Limitations and Thesis Reporting Guidance

Describe the project as a prototype and separate implemented functionality from intended future scope. In particular:

- No external payment gateway integration or real card/GCash settlement is present; payment methods are stored as application records.
- No physical barrier/relay/controller interface is present.
- Camera IP/RTSP fields are metadata; current capture uses browser device IDs and `getUserMedia`.
- Concept C currently changes slot availability but does not automatically link a plate, create a session, or assign a slot to the session.
- The root page switcher does not expose every page component as a standalone route; some functions are duplicated across operational screens.
- Some page-level payment paths use hardcoded rates, manual durations, or receipt generation independent of centralized settings. Receipt IDs based on row counts/timestamps are not a robust concurrent sequence.
- The browser OCR confidence is a library score adjusted by heuristics and registered-plate matching; it should not be reported as calibrated recognition accuracy without a measured evaluation.
- The color label is a simple RGB nearest-reference heuristic. Occupancy is box/polygon geometry plus temporal debounce, not object tracking.
- The browser vision loop and local HTTP inference need performance, camera-variation, and concurrency testing on the target hardware.
- A confidence threshold displayed in Settings and camera FPS setting are not consistently wired into every processor; several pipeline thresholds/intervals are constants in source.
- Public image URLs and inline base64 fallbacks have privacy, persistence, and storage-size implications.
- The default/effective anonymous RLS policies and wallet RPC permissions are unsafe for real production data until replaced with owner-scoped authorization.
- No automated test suite is defined in `package.json`; model accuracy, fee rules, security policies, and camera workflows need explicit validation.

For a thesis evaluation, report measured datasets and metrics separately from implementation description. Useful evaluation dimensions include plate localization precision/recall, exact full-plate recognition rate, character error rate, end-to-end latency, occupancy precision/recall by slot, false transition rate under the three-frame debounce, and results under lighting, angle, blur, occlusion, and camera-distance variations. The source code alone does not establish these experimental results.

## 15. Suggested Thesis Structure

This dossier can support (but does not replace) a thesis organized around:

1. Problem statement and operational context.
2. Requirements and the three parking concepts.
3. System architecture and data model.
4. Vehicle/plate detection and OCR pipeline, including normalization and temporal voting.
5. Slot AOI design and occupancy debounce algorithm.
6. Session, fee, payment-record, and wallet workflows.
7. Implementation technologies and deployment topology.
8. Test methodology, dataset description, metrics, measured results, and error analysis.
9. Security/privacy analysis and prototype limitations.
10. Future work: secure authorization, payment gateway integration, RTSP bridging, robust session-to-slot association, calibrated OCR confidence, and automated tests.

## 16. Source Files to Consult

- `src/lib/visionEngine.ts`
- `src/lib/parkingFees.ts`
- `src/lib/wallet.ts`
- `src/components/CameraFeed.tsx`
- `src/pages/SlotManagement.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/MobileApp.tsx`
- `src/lib/supabase.ts`
- `supabase/migrations/`
- `ALPR-Modules/easyocr_service.py`
- `ALPR-Modules/slot_monitor_service.py`
- `ALPR-Modules/main.py`, `util.py`, `add_missing_data.py`, and `visualize.py`
