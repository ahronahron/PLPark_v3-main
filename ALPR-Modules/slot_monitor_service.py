"""Real-time YOLO slot occupancy service for IP Cameras.

Provides threaded grabbing, YOLO detection, slot overlap calculation,
temporal smoothing, and MJPEG streaming for debugging.
"""
import base64
import json
import os
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote
from typing import Any

import cv2
import numpy as np
import requests
from shapely.geometry import Polygon, box
import torch
from ultralytics import YOLO

MODEL_PATH = os.environ.get('YOLO_MODEL', 'yolov8n.pt')
PORT = int(os.environ.get('YOLO_SERVICE_PORT', '8766'))
IMG_SIZE = int(os.environ.get('YOLO_IMGSZ', '960'))
CONF_THRESH = float(os.environ.get('YOLO_CONF', '0.30'))
OVERLAP_THRESH = float(os.environ.get('YOLO_OVERLAP', '0.30'))
# Confirmation & Release time thresholds
SLOT_CONFIRM_SECONDS = float(os.environ.get('SLOT_CONFIRM_SECONDS', '2.0'))
SLOT_RELEASE_SECONDS = float(os.environ.get('SLOT_RELEASE_SECONDS', '4.0'))

# Device setup
DEVICE = 'cuda:0' if torch.cuda.is_available() else 'cpu'
USE_HALF = (DEVICE != 'cpu')
DEVICE_NAME = torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'

print(f"[SlotMonitor] Startup device: {DEVICE} ({DEVICE_NAME}) | half={USE_HALF}")

# Color threshold config
V_HIGHLIGHT = int(os.environ.get('COLOR_V_HIGHLIGHT', '240'))
S_HIGHLIGHT = int(os.environ.get('COLOR_S_HIGHLIGHT', '25'))
V_BLACK = int(os.environ.get('COLOR_V_BLACK', '80'))
S_HUE_MIN = int(os.environ.get('COLOR_S_HUE_MIN', '60'))
V_WHITE = int(os.environ.get('COLOR_V_WHITE', '185'))
H_RED_LOW = int(os.environ.get('COLOR_H_RED_LOW', '10'))
H_RED_HIGH = int(os.environ.get('COLOR_H_RED_HIGH', '170'))
H_BROWN_MAX = int(os.environ.get('COLOR_H_BROWN_MAX', '25'))
V_BROWN_MAX = int(os.environ.get('COLOR_V_BROWN_MAX', '150'))
H_YELLOW_MAX = int(os.environ.get('COLOR_H_YELLOW_MAX', '35'))
H_GREEN_MAX = int(os.environ.get('COLOR_H_GREEN_MAX', '85'))
H_BLUE_MAX = int(os.environ.get('COLOR_H_BLUE_MAX', '130'))

# Empty reference config
REF_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'empty_reference.jpg')
DIFF_THRESH = int(os.environ.get('EMPTY_REF_DIFF_THRESH', '35'))
MIN_DIFF_PIXELS = int(os.environ.get('EMPTY_REF_MIN_PIXELS', '200'))

empty_ref_lock = threading.Lock()
empty_reference_frame = None

if os.path.exists(REF_FILE_PATH):
    try:
        loaded_ref = cv2.imread(REF_FILE_PATH)
        if loaded_ref is not None:
            empty_reference_frame = loaded_ref
            print(f"[SlotMonitor] Loaded empty reference from {REF_FILE_PATH}")
    except Exception as e:
        print(f"[SlotMonitor] Warning loading empty reference: {e}")

MODEL = YOLO(MODEL_PATH)
try:
    MODEL.to(DEVICE)
except Exception as e:
    print(f"[SlotMonitor] Warning moving model to {DEVICE}: {e}")

config_lock = threading.Lock()
camera_config = {"url": "", "mode": ""}
slots_config = []

frame_lock = threading.Lock()
latest_frame = None
latest_frame_annotated = None
last_frame_time = 0

state_lock = threading.Lock()
slots_state = []
latest_detections = []
history_by_slot = {}
stable_state_by_slot = {}
mismatch_state_by_slot = {}
running = True

# Crop storage for GET /slot/<slotId>.jpg
crop_lock = threading.Lock()
slot_crops = {}

# Health and inference metrics
metrics_lock = threading.Lock()
infer_durations = deque(maxlen=30)
detection_cycle_times = deque(maxlen=30)

def record_detection_metrics(duration_sec: float):
    now = time.time()
    with metrics_lock:
        infer_durations.append(duration_sec)
        detection_cycle_times.append(now)

def get_health_metrics():
    with metrics_lock:
        avg_ms = (sum(infer_durations) / len(infer_durations) * 1000.0) if infer_durations else 0.0
        if len(detection_cycle_times) >= 2:
            span = detection_cycle_times[-1] - detection_cycle_times[0]
            fps = ((len(detection_cycle_times) - 1) / span) if span > 0 else 0.0
        else:
            fps = 0.0
    with empty_ref_lock:
        calibrated = (empty_reference_frame is not None)
    return {
        'device': DEVICE,
        'deviceName': DEVICE_NAME,
        'avgInferenceMs': round(avg_ms, 2),
        'detectionFps': round(fps, 2),
        'calibrated': calibrated
    }

VEHICLE_MAP = {
    'car': 'car', 'truck': 'car', 'bus': 'car', 'van': 'car',
    'motorcycle': 'motorcycle'
}

def classify_color(image: np.ndarray) -> str:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    
    # Filter out glares/highlights
    valid = ~((V > V_HIGHLIGHT) & (S < S_HIGHLIGHT))
    H, S, V = H[valid], S[valid], V[valid]
    
    if len(H) == 0:
        return 'Gray'
        
    colors = []
    for h, s, v in zip(H, S, V):
        # 1. Any pixel with V < 80 is Black regardless of hue and saturation
        if v < V_BLACK:
            colors.append('Black')
        # 2. For other pixels, require S >= 60 to use hue rules; otherwise Black/Gray/White by brightness
        elif s < S_HUE_MIN:
            if v < V_BLACK:
                colors.append('Black')
            elif v > V_WHITE:
                colors.append('White')
            else:
                colors.append('Gray')
        else:
            if h < H_RED_LOW or h > H_RED_HIGH:
                colors.append('Red')
            elif h < H_BROWN_MAX:
                if v < V_BROWN_MAX:
                    colors.append('Brown')
                else:
                    colors.append('Yellow')
            elif h < H_YELLOW_MAX:
                if v >= V_BROWN_MAX:
                    colors.append('Yellow')
                else:
                    colors.append('Brown')
            elif h < H_GREEN_MAX:
                colors.append('Green')
            elif h < H_BLUE_MAX:
                colors.append('Blue')
            else:
                colors.append('Red') # fallback wrap
    
    if not colors:
        return 'Gray'
    return max(set(colors), key=colors.count)

def get_center_crop(frame: np.ndarray, bbox: list[float]) -> np.ndarray:
    x1, y1, x2, y2 = map(int, bbox)
    h, w = y2 - y1, x2 - x1
    # Center 60%
    cx1 = x1 + int(w * 0.20)
    cx2 = x2 - int(w * 0.20)
    cy1 = y1 + int(h * 0.20)
    cy2 = y2 - int(h * 0.20)
    
    if cx1 >= cx2 or cy1 >= cy2:
        cx1, cx2 = x1, x2
        cy1, cy2 = y1, y2
        
    return frame[max(0, cy1):min(frame.shape[0], cy2), 
                 max(0, cx1):min(frame.shape[1], cx2)]

def get_color_for_bbox(frame: np.ndarray, bbox: list[float]) -> str:
    with empty_ref_lock:
        ref_frame = empty_reference_frame.copy() if empty_reference_frame is not None else None

    # Check if empty reference is available and matches frame shape
    if ref_frame is not None and ref_frame.shape == frame.shape:
        x1, y1, x2, y2 = map(int, bbox)
        bx1 = max(0, x1)
        by1 = max(0, y1)
        bx2 = min(frame.shape[1], x2)
        by2 = min(frame.shape[0], y2)
        
        if bx2 > bx1 and by2 > by1:
            frame_box = frame[by1:by2, bx1:bx2]
            ref_box = ref_frame[by1:by2, bx1:bx2]
            
            # Blurred absolute difference from the reference
            blur_frame = cv2.GaussianBlur(frame_box, (5, 5), 0)
            blur_ref = cv2.GaussianBlur(ref_box, (5, 5), 0)
            diff = cv2.absdiff(blur_frame, blur_ref)
            diff_gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
            
            qualifying_mask = diff_gray > DIFF_THRESH
            qualifying_pixels = frame_box[qualifying_mask]
            
            if len(qualifying_pixels) >= MIN_DIFF_PIXELS:
                # Classify from qualifying pixels (reshaped into an image of shape (N, 1, 3))
                pixel_img = qualifying_pixels.reshape(-1, 1, 3)
                return classify_color(pixel_img)

    # Fallback to center 60% crop
    crop = get_center_crop(frame, bbox)
    if crop.size == 0:
        return 'Gray'
        
    return classify_color(crop)

def normalize_vehicle_type(vtype: Any) -> str:
    """Normalize vehicle type strings: trim, lowercase, map synonyms, or 'unknown'."""
    if not vtype:
        return 'unknown'
    val = str(vtype).strip().lower()
    CAR_SYNONYMS = {'car', 'truck', 'bus', 'van', 'suv', 'sedan'}
    MOTO_SYNONYMS = {'motorcycle', 'motorbike', 'bike', 'scooter'}
    if val in CAR_SYNONYMS:
        return 'car'
    if val in MOTO_SYNONYMS:
        return 'motorcycle'
    return 'unknown'

def format_url(url: str) -> str:
    if not url.startswith('http'):
        return f"http://{url}"
    return url

def camera_thread():
    global latest_frame, last_frame_time
    cap = None
    active_base_url = None
    
    while running:
        with config_lock:
            mode = camera_config.get('mode')
            url = camera_config.get('url')
            
        if not url:
            if cap:
                cap.release()
                cap = None
            active_base_url = None
            time.sleep(1)
            continue
            
        base_url = format_url(url)
        if base_url != active_base_url:
            if cap:
                cap.release()
                cap = None
            active_base_url = base_url
        
        try:
            if mode == 'snapshot':
                resp = requests.get(f"{base_url}/shot.jpg", verify=False, timeout=3)
                if resp.status_code == 200:
                    arr = np.frombuffer(resp.content, np.uint8)
                    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if frame is not None:
                        with frame_lock:
                            latest_frame = frame
                            last_frame_time = time.time()
                time.sleep(0.3) # ~3fps
                
            elif mode == 'mjpeg':
                if cap is None or not cap.isOpened():
                    cap = cv2.VideoCapture(f"{base_url}/video")
                ret, frame = cap.read()
                if ret and frame is not None:
                    with frame_lock:
                        latest_frame = frame
                        last_frame_time = time.time()
                else:
                    if cap: cap.release()
                    cap = None
                    time.sleep(1)
            else:
                time.sleep(1)
        except Exception:
            if cap:
                cap.release()
                cap = None
            time.sleep(2)
            
    if cap:
        cap.release()

def process_thread():
    global slots_state, latest_frame_annotated
    
    while running:
        time.sleep(0.5) # ~2fps
        if not running:
            break
        
        with frame_lock:
            frame = latest_frame.copy() if latest_frame is not None else None
            
        if frame is None:
            continue
            
        with config_lock:
            slots = list(slots_config)
            
        h, w = frame.shape[:2]
        
        t0 = time.time()
        try:
            if USE_HALF:
                results = MODEL(frame, imgsz=IMG_SIZE, conf=CONF_THRESH, device=DEVICE, half=True, verbose=False)
            else:
                results = MODEL(frame, imgsz=IMG_SIZE, conf=CONF_THRESH, device=DEVICE, verbose=False)
        except Exception as e:
            # Fallback in case of device issue
            print(f"[SlotMonitor] Model inference error: {e}")
            results = MODEL(frame, imgsz=IMG_SIZE, conf=CONF_THRESH, verbose=False)
        t_infer = time.time() - t0
        record_detection_metrics(t_infer)
        
        # Parse detections (footprint = the whole detection box in normalized coords)
        vehicles = []
        for r in results:
            for b in r.boxes:
                cls_name = MODEL.names[int(b.cls[0])]
                if cls_name in VEHICLE_MAP:
                    x1, y1, x2, y2 = b.xyxy[0].tolist()
                    cx = (x1 + x2) / 2.0 / w
                    cy = (y1 + y2) / 2.0 / h
                    vehicles.append({
                        'bbox': [x1, y1, x2, y2],
                        'footprint': box(x1/w, y1/h, x2/w, y2/h),
                        'center': (cx, cy),
                        'type': VEHICLE_MAP[cls_name],
                        'conf': float(b.conf[0])
                    })

        # Slot Assignment
        slot_polys = {}
        for s in slots:
            pts = s.get('polygon', [])
            if len(pts) >= 3:
                slot_polys[s['slotId']] = Polygon(pts)
        
        # Assign each vehicle to the ONE slot with the highest ratio:
        # ratio = intersection area / vehicle footprint area
        # require >= OVERLAP_THRESH (default 0.5), break ties using whether box center is inside polygon
        assigned = {v_idx: (None, 0.0) for v_idx in range(len(vehicles))}
        
        for v_idx, v in enumerate(vehicles):
            best_slot = None
            best_ratio = 0.0
            best_center_inside = False
            v_fp = v['footprint']
            v_area = v_fp.area
            
            if v_area > 0:
                from shapely.geometry import Point
                center_pt = Point(v['center'])
                
                for sid, spoly in slot_polys.items():
                    if not spoly.is_valid:
                        spoly = spoly.buffer(0)
                    if spoly.intersects(v_fp):
                        intersection_area = spoly.intersection(v_fp).area
                        ratio = intersection_area / v_area
                        is_center_inside = spoly.contains(center_pt)
                        
                        if ratio >= OVERLAP_THRESH or is_center_inside:
                            # Higher ratio wins; break ties with center_inside
                            if (ratio > best_ratio + 1e-5) or (abs(ratio - best_ratio) <= 1e-5 and is_center_inside and not best_center_inside):
                                best_ratio = max(ratio, 0.30 if is_center_inside else ratio)
                                best_slot = sid
                                best_center_inside = is_center_inside

            if best_slot:
                assigned[v_idx] = (best_slot, best_ratio)
                
        # Aggregate detections and draw on preview frame
        current_occupancy = {}
        all_detections_state = []
        annotated = frame.copy()
        
        for v_idx, v in enumerate(vehicles):
            sid, overlap_ratio = assigned.get(v_idx, (None, 0.0))
            color = get_color_for_bbox(frame, v['bbox'])
            
            x1, y1, x2, y2 = map(int, v['bbox'])
            conf_pct = int(round(v['conf'] * 100))
            
            all_detections_state.append({
                'type': v['type'],
                'color': color,
                'confidence': round(float(v['conf']), 3),
                'bbox': v['bbox'],
                'assignedSlot': sid,
                'overlap': round(float(overlap_ratio * 100), 1)
            })
            
            if sid:
                # If slot already had a candidate, keep the one with higher ratio
                if sid not in current_occupancy or overlap_ratio > current_occupancy[sid]['overlap']:
                    cx1, cy1 = max(0, x1), max(0, y1)
                    cx2, cy2 = min(w, x2), min(h, y2)
                    crop_jpeg = None
                    if cx2 > cx1 and cy2 > cy1:
                        crop_img = frame[cy1:cy2, cx1:cx2]
                        ret, buf = cv2.imencode('.jpg', crop_img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                        if ret:
                            crop_jpeg = buf.tobytes()

                    current_occupancy[sid] = {
                        'occupied': True,
                        'type': v['type'],
                        'color': color,
                        'conf': float(v['conf']),
                        'overlap': overlap_ratio,
                        'bbox': v['bbox'],
                        'crop_jpeg': crop_jpeg
                    }
                    
                # Draw vehicle assigned to a slot in GREEN
                ov_pct = int(round(overlap_ratio * 100))
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
                label_text = f"[{sid}] {v['type'].upper()} {color} {conf_pct}% (ov:{ov_pct}%)"
                cv2.putText(annotated, label_text, (x1, max(18, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            else:
                # Vehicle detected in frame, not assigned to a slot -> Draw in CYAN
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 215, 255), 2)
                label_text = f"{v['type'].upper()} {color} {conf_pct}%"
                cv2.putText(annotated, label_text, (x1, max(18, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 215, 255), 2)
        
        # Temporal Smoothing & Update State (Time-based confirmation)
        now_ts = time.time()
        new_state = []
        with state_lock:
            for s in slots:
                sid = s['slotId']
                curr = current_occupancy.get(sid)
                
                # Live fields updated on every detection cycle with no smoothing
                if curr:
                    live_vtype = curr['type']
                    live_color = curr['color']
                    live_conf = round(float(curr['conf']), 3)
                    live_overlap = round(float(curr['overlap'] * 100.0), 1)
                    is_live_occupied = True
                else:
                    live_vtype = None
                    live_color = None
                    live_conf = 0.0
                    live_overlap = 0.0
                    is_live_occupied = False

                if sid not in history_by_slot:
                    history_by_slot[sid] = deque(maxlen=60)
                
                history_by_slot[sid].append({
                    'time': now_ts,
                    'occupied': is_live_occupied,
                    'type': live_vtype,
                    'color': live_color,
                    'conf': live_conf,
                    'bbox': curr['bbox'] if curr else None
                })
                hist = list(history_by_slot[sid])
                
                # Time-based confirmation logic:
                # Slot becomes stableOccupied after vehicle assigned for at least SLOT_CONFIRM_SECONDS continuously.
                # Releases after SLOT_RELEASE_SECONDS with no vehicle.
                # Tolerate one missed cycle.
                was_stable = stable_state_by_slot.get(sid, False)
                stable_occ = was_stable

                if not was_stable:
                    # Check if occupied continuously for at least SLOT_CONFIRM_SECONDS, tolerating at most 1 missed cycle
                    occ_window = []
                    misses = 0
                    for x in reversed(hist):
                        if x['occupied']:
                            occ_window.append(x)
                        else:
                            misses += 1
                            if misses > 1:
                                break
                            occ_window.append(x)
                    
                    if occ_window:
                        first_seen = occ_window[-1]['time']
                        duration = now_ts - first_seen
                        # Require at least 2 readings and duration >= SLOT_CONFIRM_SECONDS
                        if duration >= SLOT_CONFIRM_SECONDS and any(x['occupied'] for x in occ_window):
                            stable_occ = True
                else:
                    # Check if empty continuously for at least SLOT_RELEASE_SECONDS, tolerating at most 1 missed detection cycle
                    empty_window = []
                    accidental_detects = 0
                    for x in reversed(hist):
                        if not x['occupied']:
                            empty_window.append(x)
                        else:
                            accidental_detects += 1
                            if accidental_detects > 1:
                                break
                            empty_window.append(x)
                    
                    if empty_window:
                        first_empty = empty_window[-1]['time']
                        empty_duration = now_ts - first_empty
                        if empty_duration >= SLOT_RELEASE_SECONDS and any(not x['occupied'] for x in empty_window):
                            stable_occ = False

                # Terminal log when slot changes state
                if stable_occ != was_stable:
                    state_str = "OCCUPIED" if stable_occ else "AVAILABLE"
                    print(f"[SlotMonitor] Slot '{sid}' state changed: { 'OCCUPIED' if was_stable else 'AVAILABLE' } -> {state_str}")
                    stable_state_by_slot[sid] = stable_occ
                else:
                    stable_state_by_slot[sid] = stable_occ
                
                vtype = 'unknown'
                vcolor = 'unknown'
                t_conf = 0.0
                c_conf = 0.0
                bbox = None
                
                if stable_occ:
                    # Find all occupied entries in hist
                    occ_entries = [x for x in hist if x['occupied'] and x.get('type') and x.get('type') != 'unknown']
                    # Use entries from confirmation window (or all recent occ_entries)
                    recent_occ = [x for x in occ_entries if (now_ts - x['time']) <= max(SLOT_CONFIRM_SECONDS * 2.5, 4.0)]
                    target_entries = recent_occ if recent_occ else occ_entries

                    if target_entries:
                        types = [x['type'] for x in target_entries if x.get('type')]
                        colors = [x['color'] for x in target_entries if x.get('color')]
                        
                        if types:
                            vtype = max(set(types), key=types.count)
                            t_conf = round(types.count(vtype) / len(types), 2)
                        elif live_vtype:
                            vtype = live_vtype
                            t_conf = live_conf
                        
                        if colors:
                            vcolor = max(set(colors), key=colors.count)
                            c_conf = round(colors.count(vcolor) / len(colors), 2)
                        elif live_color:
                            vcolor = live_color
                            c_conf = 0.8
                            
                        # find latest bbox
                        for x in reversed(target_entries):
                            if x.get('bbox'):
                                bbox = x['bbox']
                                break
                    else:
                        # Fallback to current live detection if present to avoid 'unknown'
                        if live_vtype:
                            vtype = live_vtype
                            t_conf = live_conf
                        if live_color:
                            vcolor = live_color
                            c_conf = 0.8
                        if curr and curr.get('bbox'):
                            bbox = curr['bbox']
                
                raw_slot_type = s.get('vehicleType')
                norm_slot = normalize_vehicle_type(raw_slot_type)
                norm_detected = normalize_vehicle_type(vtype) if stable_occ else 'unknown'

                mismatch = False
                if stable_occ and norm_detected != 'unknown' and norm_slot != 'unknown' and norm_detected != norm_slot:
                    mismatch = True

                # Terminal log whenever the flag changes
                was_mismatch = mismatch_state_by_slot.get(sid, False)
                if mismatch != was_mismatch:
                    mismatch_state_by_slot[sid] = mismatch
                    m_str = "yes" if mismatch else "no"
                    print(f"[SlotMonitor] Slot '{sid}' mismatch changed: Slot: {norm_slot} | Detected: {norm_detected} | Mismatch: {m_str}")
                else:
                    mismatch_state_by_slot[sid] = mismatch
                
                # Update vehicle crop cache
                with crop_lock:
                    db_id = s.get('dbId')
                    if curr and curr.get('crop_jpeg'):
                        slot_crops[sid] = curr['crop_jpeg']
                        if db_id:
                            slot_crops[db_id] = curr['crop_jpeg']
                    elif not stable_occ:
                        # Slot is cleared/released
                        slot_crops.pop(sid, None)
                        if db_id:
                            slot_crops.pop(db_id, None)

                new_state.append({
                    'slotId': sid,
                    'dbId': s.get('dbId'),
                    'occupied': is_live_occupied,
                    'stableOccupied': stable_occ,
                    'vehicleType': vtype,
                    'color': vcolor,
                    'typeConfidence': t_conf,
                    'colorConfidence': c_conf,
                    'slotTypeMismatch': mismatch,
                    'bbox': bbox,
                    'liveVehicleType': live_vtype,
                    'liveColor': live_color,
                    'liveConfidence': live_conf,
                    'liveOverlap': live_overlap,
                    'expectedType': norm_slot,
                    'detectedType': norm_detected,
                    'rawSlotType': raw_slot_type
                })
                
                # Draw polygon
                pts = s.get('polygon', [])
                if len(pts) >= 3:
                    pixel_pts = np.array([[int(p[0]*w), int(p[1]*h)] for p in pts], np.int32)
                    col = (0,0,255) if stable_occ else (0,255,0)
                    cv2.polylines(annotated, [pixel_pts], True, col, 2)
                    cx = int(np.mean(pixel_pts[:, 0]))
                    cy = int(np.mean(pixel_pts[:, 1]))
                    slot_txt = f"{sid} ({'OCCUPIED' if stable_occ else 'AVAILABLE'})"
                    cv2.putText(annotated, slot_txt, (max(10, cx - 40), cy), cv2.FONT_HERSHEY_SIMPLEX, 0.45, col, 2)
                    
            slots_state = new_state
            latest_detections = all_detections_state
            
        with frame_lock:
            latest_frame_annotated = annotated
            
class SlotMonitorHandler(BaseHTTPRequestHandler):
    daemon_threads = True
    def send_error(self, code, message=None, explain=None):
        self.send_response(code, message)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'text/html;charset=utf-8')
        self.end_headers()
        
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        parsed_path = urlparse(self.path).path
        if parsed_path == '/health':
            with config_lock:
                c_mode = camera_config.get('mode')
                c_url = camera_config.get('url', '')
            with frame_lock:
                age = time.time() - last_frame_time if last_frame_time > 0 else 999.0
            
            is_connected = (age < 5.0) and bool(c_url) and (last_frame_time > 0)
            metrics = get_health_metrics()
            payload = json.dumps({
                'status': 'ok',
                'cameraConnected': is_connected,
                'cameraUrl': c_url,
                'frameAge': round(age, 2),
                'device': metrics['device'],
                'deviceName': metrics['deviceName'],
                'averageInferenceMs': metrics['avgInferenceMs'],
                'detectionFps': metrics['detectionFps'],
                'calibrated': metrics['calibrated']
            }).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(payload)
            
        elif parsed_path == '/state':
            with config_lock:
                c_url = camera_config.get('url', '')
            with frame_lock:
                age = time.time() - last_frame_time if last_frame_time > 0 else 999.0
            with state_lock:
                state_copy = list(slots_state)
                detections_copy = list(latest_detections)
            is_connected = (age < 5.0) and bool(c_url) and (last_frame_time > 0)
            metrics = get_health_metrics()
            payload = json.dumps({
                'cameraConnected': is_connected,
                'cameraUrl': c_url,
                'frameAge': round(age, 2),
                'fps': metrics['detectionFps'],
                'slots': state_copy,
                'detections': detections_copy
            }).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(payload)
            
        elif parsed_path.startswith('/slot/') and parsed_path.endswith('.jpg'):
            raw_slot_id = parsed_path[len('/slot/'):-len('.jpg')]
            slot_id = unquote(raw_slot_id).strip()
            
            crop_data = None
            with crop_lock:
                crop_data = slot_crops.get(slot_id)
                
            if crop_data:
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(crop_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.end_headers()
                self.wfile.write(crop_data)
            else:
                self.send_error(404, 'Slot vehicle crop not found')

        elif parsed_path in ('/raw.mjpg', '/preview.mjpg'):
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            annotated = parsed_path == '/preview.mjpg'
            
            try:
                while running:
                    with frame_lock:
                        frame = latest_frame_annotated if annotated else latest_frame
                    if frame is not None:
                        ret, buf = cv2.imencode('.jpg', frame)
                        if ret:
                            self.wfile.write(b'--frame\r\n')
                            self.send_header('Content-Type', 'image/jpeg')
                            self.send_header('Content-Length', str(len(buf)))
                            self.end_headers()
                            self.wfile.write(buf.tobytes())
                            self.wfile.write(b'\r\n')
                    time.sleep(0.1)
            except Exception:
                pass
                
        elif parsed_path == '/snapshot.jpg':
            with frame_lock:
                frame = latest_frame_annotated
            if frame is not None:
                ret, buf = cv2.imencode('.jpg', frame)
                if ret:
                    self.send_response(200)
                    self.send_header('Content-Type', 'image/jpeg')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(buf.tobytes())
                    return
            self.send_error(404)
        elif parsed_path == '/detect':
            # keep alive for legacy
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{"detections":[]}')
        else:
            self.send_error(404)

    def do_POST(self):
        global empty_reference_frame
        try:
            content_length = int(self.headers.get('Content-Length', '0'))
            body = self.rfile.read(content_length)
            payload = json.loads(body.decode('utf-8') or '{}') if body else {}
            parsed_path = urlparse(self.path).path

            if parsed_path == '/calibrate-empty':
                with frame_lock:
                    current_raw = latest_frame.copy() if latest_frame is not None else None
                
                if current_raw is None:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(b'{"status":"error","message":"No camera frame available"}')
                    return
                
                with empty_ref_lock:
                    empty_reference_frame = current_raw
                    try:
                        cv2.imwrite(REF_FILE_PATH, current_raw)
                        print(f"[SlotMonitor] Saved empty reference to {REF_FILE_PATH}")
                    except Exception as err:
                        print(f"[SlotMonitor] Error saving empty reference: {err}")
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"status":"ok","calibrated":true}')

            elif parsed_path == '/config':
                new_slots = payload.get('slots')
                replace_all = payload.get('replaceAll', False)
                cam_data = payload.get('camera')

                num_incoming = len(new_slots) if isinstance(new_slots, list) else 0
                print(f"[SlotMonitor] POST /config received with {num_incoming} slots (replaceAll={replace_all})")
                if isinstance(new_slots, list):
                    for s in new_slots:
                        print(f"[SlotMonitor] Slot '{s.get('slotId')}' configured with vehicleType: '{s.get('vehicleType')}'")

                with config_lock:
                    if cam_data:
                        old_url = camera_config.get('url', '')
                        new_url = cam_data.get('url', '')
                        camera_config.update(cam_data)
                        if new_url != old_url:
                            with frame_lock:
                                last_frame_time = 0
                                latest_frame = None

                    # Ignore a config with an empty slots list unless it includes "replaceAll": true
                    if isinstance(new_slots, list):
                        if len(new_slots) == 0 and not replace_all:
                            print("[SlotMonitor] Ignoring empty slots list in /config (replaceAll is false)")
                        else:
                            # Merge by slotId: keep history for slots whose slotId and polygon are unchanged
                            old_slots_by_id = {s.get('slotId'): s for s in slots_config if s.get('slotId')}
                            slots_config.clear()
                            slots_config.extend(new_slots)

                            with state_lock:
                                incoming_ids = set()
                                for s in new_slots:
                                    sid = s.get('slotId')
                                    if not sid:
                                        continue
                                    incoming_ids.add(sid)
                                    old_s = old_slots_by_id.get(sid)
                                    # Reset only if polygon changed or previously not present
                                    poly_changed = (old_s is None) or (s.get('polygon') != old_s.get('polygon'))
                                    if poly_changed:
                                        history_by_slot.pop(sid, None)
                                        stable_state_by_slot.pop(sid, None)
                                        mismatch_state_by_slot.pop(sid, None)

                                # Remove slots that are no longer configured
                                for sid in list(history_by_slot.keys()):
                                    if sid not in incoming_ids:
                                        history_by_slot.pop(sid, None)
                                        stable_state_by_slot.pop(sid, None)
                                        mismatch_state_by_slot.pop(sid, None)

                            with crop_lock:
                                for sid in list(slot_crops.keys()):
                                    if sid not in incoming_ids:
                                        slot_crops.pop(sid, None)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
            elif parsed_path == '/detect':
                # legacy
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"detections":[]}')
            else:
                self.send_error(404)
        except Exception as exc:
            self.send_error(500)

if __name__ == '__main__':
    camera_t = threading.Thread(target=camera_thread, daemon=True)
    process_t = threading.Thread(target=process_thread, daemon=True)
    camera_t.start()
    process_t.start()

    server = ThreadingHTTPServer(('0.0.0.0', PORT), SlotMonitorHandler)
    server.daemon_threads = True
    print(f'YOLO slot monitor listening on http://127.0.0.1:{PORT}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        running = False
        camera_t.join(timeout=1.0)
        process_t.join(timeout=1.0)
        server.shutdown()
        server.server_close()
        print("[SlotMonitor] Stopped")
        sys.exit(0)
