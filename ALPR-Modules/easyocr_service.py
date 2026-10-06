"""Small local EasyOCR service for the browser plate-recognition pipeline."""

import base64
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import time
import os
from datetime import datetime

import cv2
import easyocr
import numpy as np


import torch

reader = easyocr.Reader(['en'], gpu=torch.cuda.is_available(), verbose=False)

OCR_CONFUSIONS = {
    '0': 'O', 'O': '0',
    '1': 'I', 'I': '1',
    '5': 'S', 'S': '5',
    '8': 'B', 'B': '8',
    '2': 'Z', 'Z': '2',
}


def clean_plate(text: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', text.upper())


def extract_candidates(variant: np.ndarray, pass_name: str) -> list[tuple[str, float]]:
    candidates: list[tuple[str, float]] = []
    print(f"\n--- {pass_name} Candidates ---")
    raw_results = reader.readtext(
        variant, detail=1, paragraph=False, allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    )
    print("Raw (before length/clean filtering):")
    for _, text, confidence in raw_results:
        print(f"  '{text}' (conf: {float(confidence)*100:.1f}%)")
        plate = clean_plate(text)
        if 3 <= len(plate) <= 9:
            candidates.append((plate, float(confidence) * 100))
    
    print("Filtered (after cleaning/length):")
    for text, conf in candidates:
        print(f"  '{text}' (conf: {conf:.1f}%)")
    return candidates


def find_fuzzy_match(cand: str, registered: dict[str, str]) -> str | None:
    best_match = None
    best_diff = 2
    for reg_clean in registered:
        if len(cand) != len(reg_clean):
            continue
        diffs = 0
        for c1, c2 in zip(cand, reg_clean):
            if c1 == c2 or OCR_CONFUSIONS.get(c1) == c2:
                continue
            diffs += 1
            if diffs > 1:
                break
        if diffs <= 1 and diffs < best_diff:
            best_diff = diffs
            best_match = reg_clean
            if diffs == 0:
                break
    return best_match


def resolve_plate(candidates: list[tuple[str, float]], registered_plates: list[str]) -> tuple[str, float] | None:
    if not candidates:
        return None

    registered = {clean_plate(value): value for value in registered_plates}
    sorted_candidates = sorted(candidates, key=lambda item: item[1], reverse=True)

    # 1. Exact match check
    for plate, confidence in sorted_candidates:
        if plate in registered:
            return clean_plate(registered[plate]), min(99, confidence + 15)

    # 2. Fuzzy match check (allowing <= 1 non-confusion diff with free OCR substitutions)
    if registered:
        for plate, confidence in sorted_candidates:
            matched_reg = find_fuzzy_match(plate, registered)
            if matched_reg:
                return clean_plate(registered[matched_reg]), min(99, confidence + 8)

    # 3. Fallback to candidate with highest confidence
    return sorted_candidates[0]


def read_plate(image: np.ndarray, registered_plates: list[str]) -> tuple[str, float] | None:
    if image is None or image.size == 0:
        return None

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    w = gray.shape[1]
    if w < 150:
        base = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    elif w > 300:
        scale = 300 / w
        base = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    else:
        base = gray

    # Pass 1: standard grayscale variant
    candidates = extract_candidates(base, "Pass 1")
    best_first = resolve_plate(candidates, registered_plates)

    # Quality gate: return early if the first pass is already confident (>= 70)
    if best_first is not None and best_first[1] >= 70:
        return best_first

    # Pass 2: adaptive threshold binary variant (only run if first pass was below 70)
    binary = cv2.adaptiveThreshold(base, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9)
    candidates.extend(extract_candidates(binary, "Pass 2"))

    return resolve_plate(candidates, registered_plates)


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path != '/read-plate':
            self.send_error(404)
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
            encoded = body['image'].split(',', 1)[-1]
            image = cv2.imdecode(np.frombuffer(base64.b64decode(encoded), np.uint8), cv2.IMREAD_COLOR)
            
            if image is not None:
                crops_dir = 'ALPR-Modules/debug_crops'
                os.makedirs(crops_dir, exist_ok=True)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]
                filepath = os.path.join(crops_dir, f'crop_{timestamp}.jpg')
                cv2.imwrite(filepath, image)
                
                files = sorted([os.path.join(crops_dir, f) for f in os.listdir(crops_dir) if f.endswith('.jpg')], key=os.path.getctime)
                while len(files) > 50:
                    os.remove(files.pop(0))
            
            start_t = time.perf_counter()
            result = read_plate(image, body.get('registered_plates', [])) if image is not None else None
            end_t = time.perf_counter()
            print(f"[Timing] easyocr read_plate took: {end_t - start_t:.4f}s")
            
            payload = {'plate': result[0], 'confidence': result[1]} if result else {}
            response = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response)
        except Exception as error:
            self.send_error(500, str(error))


if __name__ == '__main__':
    print('EasyOCR service listening on http://127.0.0.1:8765')
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()