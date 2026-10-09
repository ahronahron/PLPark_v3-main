"""Real-time YOLO slot occupancy service.

This service replaces the browser-side ONNX inference with a Python YOLO model
running locally. The frontend still opens the camera in the browser, but every
frame is sent here for object detection. If a detected vehicle intersects a slot
polygon, the slot is marked as occupied.
"""

from __future__ import annotations

import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO

MODEL_PATH = os.environ.get('YOLO_MODEL', 'yolov8n.pt')
PORT = int(os.environ.get('YOLO_SERVICE_PORT', '8766'))

MODEL = YOLO(MODEL_PATH)

VEHICLE_CLASSES = {
    'car', 'truck', 'bus', 'motorcycle', 'van', 'bicycle', 'person', 'train', 'boat'
}


def is_vehicle(class_name: str) -> bool:
    return class_name.lower() in VEHICLE_CLASSES


def polygon_contains_point(point: tuple[float, float], polygon: list[list[float]]) -> bool:
    x, y = point
    inside = False
    for i, j in zip(range(len(polygon)), [len(polygon) - 1] + list(range(len(polygon) - 1))):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        intersect = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi
        )
        if intersect:
            inside = not inside
    return inside


def bbox_overlaps_polygon(bbox: list[float], polygon: list[list[float]], width: int, height: int) -> bool:
    if len(polygon) < 3:
        return False

    x1, y1, x2, y2 = bbox
    x1 = max(0, min(width, x1))
    y1 = max(0, min(height, y1))
    x2 = max(0, min(width, x2))
    y2 = max(0, min(height, y2))

    norm_poly = [[p[0] / width, p[1] / height] for p in polygon]
    norm_bbox = [x1 / width, y1 / height, x2 / width, y2 / height]

    points = [
        ((norm_bbox[0] + norm_bbox[2]) / 2, (norm_bbox[1] + norm_bbox[3]) / 2),
        ((norm_bbox[0] + norm_bbox[2]) / 2, norm_bbox[3]),
        (norm_bbox[0], norm_bbox[1]),
        (norm_bbox[2], norm_bbox[1]),
        (norm_bbox[2], norm_bbox[3]),
        (norm_bbox[0], norm_bbox[3]),
    ]

    for point in points:
        if polygon_contains_point(point, norm_poly):
            return True

    for i in range(len(norm_poly)):
        p1 = norm_poly[i]
        p2 = norm_poly[(i + 1) % len(norm_poly)]
        for j in range(4):
            q1 = points[j]
            q2 = points[(j + 1) % len(points)]
            a = p1
            b = p2
            c = q1
            d = q2

            def orient(p: tuple[float, float], q: tuple[float, float], r: tuple[float, float]) -> float:
                return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

            o1 = orient(a, b, c)
            o2 = orient(a, b, d)
            o3 = orient(c, d, a)
            o4 = orient(c, d, b)
            if (o1 > 0 and o2 < 0 or o1 < 0 and o2 > 0) and (o3 > 0 and o4 < 0 or o3 < 0 and o4 > 0):
                return True

    return False


def decode_image(image_data: str) -> np.ndarray | None:
    if not image_data:
        return None

    if image_data.startswith('data:'):
        image_data = image_data.split(',', 1)[1]

    try:
        image_bytes = base64.b64decode(image_data)
    except Exception:
        return None

    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    return image


def detect_objects(frame: np.ndarray, conf: float = 0.25, iou: float = 0.45) -> list[dict[str, Any]]:
    if frame is None or frame.size == 0:
        return []

    results = MODEL(frame, conf=conf, iou=iou, verbose=False)
    detections: list[dict[str, Any]] = []

    for result in results:
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            continue

        for box in boxes:
            x1, y1, x2, y2 = map(float, box.xyxy[0].tolist())
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])
            class_name = MODEL.names.get(class_id, str(class_id))
            detections.append({
                'class_id': class_id,
                'class_name': class_name,
                'confidence': confidence,
                'bbox': [x1, y1, x2, y2],
            })

    return detections


def resolve_slot_status(frame: np.ndarray, slots: list[dict[str, Any]], conf: float = 0.25) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    detections = detect_objects(frame, conf=conf)
    occupancy: list[dict[str, Any]] = []

    height, width = frame.shape[:2]
    for slot in slots or []:
        polygon = slot.get('polygon') or []
        if len(polygon) < 3:
            continue

        occupied = False
        for det in detections:
            if not is_vehicle(det['class_name']):
                continue
            bbox = det['bbox']
            if bbox_overlaps_polygon(bbox, polygon, width, height):
                occupied = True
                break

        occupancy.append({
            'slotId': slot.get('slotId') or slot.get('id'),
            'dbId': slot.get('dbId'),
            'occupied': occupied,
        })

    return detections, occupancy


class SlotMonitorHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def do_GET(self):
        if self.path == '/health':
            payload = json.dumps({'status': 'ok', 'model': MODEL_PATH}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(payload)
            return

        self.send_error(404)

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', '0'))
            body = self.rfile.read(content_length)
            payload = json.loads(body.decode('utf-8') or '{}')

            if self.path == '/detect':
                frame = decode_image(payload.get('image', ''))
                detections = detect_objects(frame, conf=float(payload.get('conf', 0.25)), iou=float(payload.get('iou', 0.45))) if frame is not None else []
                response = json.dumps({'detections': detections}).encode()
            elif self.path == '/status':
                frame = decode_image(payload.get('image', ''))
                if frame is None:
                    response = json.dumps({'detections': [], 'slots': []}).encode()
                else:
                    detections, occupancy = resolve_slot_status(frame, payload.get('slots', []), conf=float(payload.get('conf', 0.25)))
                    response = json.dumps({'detections': detections, 'slots': occupancy}).encode()
            else:
                self.send_error(404)
                return

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response)
        except Exception as exc:  # pragma: no cover - server safety
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(exc)}).encode())


if __name__ == '__main__':
    print(f'YOLO slot monitor listening on http://127.0.0.1:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), SlotMonitorHandler).serve_forever()
