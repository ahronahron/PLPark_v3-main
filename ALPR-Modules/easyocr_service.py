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

# ============================================================
# PLATE PATTERNS & CONFUSIONS
# ============================================================
# Editable list of plate regex patterns (evaluated in order)
PLATE_PATTERNS = [
    r'^[A-Z]{3}[0-9]{4}$',                     # Current standard: 3 letters, 4 digits (e.g. ABC1234)
    r'^[A-Z]{3}[0-9]{3}$',                     # Older format: 3 letters, 3 digits (e.g. DDD100)
    r'^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{5,8}$',  # Lenient fallback: 5-8 chars with >= 1 letter and >= 1 digit
]

COMPILED_PATTERNS = [re.compile(p) for p in PLATE_PATTERNS]

OCR_CONFUSIONS = {
    '0': 'O', 'O': '0',
    '1': 'I', 'I': '1',
    '5': 'S', 'S': '5',
    '8': 'B', 'B': '8',
    '2': 'Z', 'Z': '2',
}

LETTER_CONFUSIONS = {'0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z'}
DIGIT_CONFUSIONS = {'O': '0', 'I': '1', 'S': '5', 'B': '8', 'Z': '2'}

reader = easyocr.Reader(['en'], gpu=torch.cuda.is_available(), verbose=False)


def clean_plate(text: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', text.upper())


def positional_correction(text: str) -> str:
    """For candidates where the first 3 characters should be letters and the rest digits,
    converts confusable characters by position."""
    if len(text) < 5:
        return text
    chars = list(text)
    for i in range(min(3, len(chars))):
        if chars[i] in LETTER_CONFUSIONS:
            chars[i] = LETTER_CONFUSIONS[chars[i]]
    for i in range(3, len(chars)):
        if chars[i] in DIGIT_CONFUSIONS:
            chars[i] = DIGIT_CONFUSIONS[chars[i]]
    return "".join(chars)


def get_pattern_score(text: str) -> int:
    """Returns pattern matching rank: 3 for current 3+4 format, 2 for 3+3, 1 for lenient, 0 otherwise."""
    if re.match(r'^[A-Z]{3}[0-9]{4}$', text):
        return 3
    if re.match(r'^[A-Z]{3}[0-9]{3}$', text):
        return 2
    if re.match(r'^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{5,8}$', text):
        return 1
    return 0


def evaluate_candidate(text: str, touches_edge: bool) -> tuple[bool, str]:
    """Evaluates candidate completeness and reason."""
    if touches_edge:
        return False, "touches_edge"
    if len(text) < 5:
        return False, "too_short"
    if text.isalpha():
        return False, "letters_only"
    if text.isdigit():
        return False, "no_pattern_match"
    if get_pattern_score(text) > 0:
        return True, "ok"
    return False, "no_pattern_match"


def extract_raw_boxes(variant: np.ndarray, pass_name: str) -> list[dict]:
    raw_results = reader.readtext(
        variant, detail=1, paragraph=False, allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    )
    img_w = variant.shape[1] if variant is not None and len(variant.shape) > 1 else 300
    boxes = []
    print(f"\n--- {pass_name} Raw Detections ---")
    for bbox, text, confidence in raw_results:
        clean = clean_plate(text)
        if not clean:
            continue
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        center_y = (min_y + max_y) / 2.0
        height = max(1.0, max_y - min_y)
        # Edge check: touches within 3% of left or right edge of image
        touches_edge = (min_x <= 0.03 * img_w) or (max_x >= 0.97 * img_w)
        conf_pct = float(confidence) * 100.0
        print(f"  '{clean}' (conf: {conf_pct:.1f}%, x:[{min_x:.0f}..{max_x:.0f}], edge={touches_edge})")
        boxes.append({
            'text': clean,
            'conf': conf_pct,
            'min_x': min_x,
            'max_x': max_x,
            'center_y': center_y,
            'height': height,
            'touches_edge': touches_edge,
        })
    return boxes


def build_candidates_from_boxes(boxes: list[dict]) -> list[dict]:
    if not boxes:
        return []

    # 1. Group boxes on the same line (center-y within 0.6x the box height)
    lines: list[list[dict]] = []
    sorted_by_y = sorted(boxes, key=lambda b: b['center_y'])
    for b in sorted_by_y:
        placed = False
        for line in lines:
            ref_h = max(line[0]['height'], b['height'])
            if abs(b['center_y'] - line[0]['center_y']) <= 0.6 * ref_h:
                line.append(b)
                placed = True
                break
        if not placed:
            lines.append([b])

    candidates: list[dict] = []
    seen_texts = set()

    def add_cand(text: str, conf: float, parts: list[str], touches_edge: bool):
        clean = clean_plate(text)
        if not clean or len(clean) < 3 or len(clean) > 12:
            return
        score = get_pattern_score(clean)
        complete, reason = evaluate_candidate(clean, touches_edge)
        key = (clean, complete, touches_edge)
        if key not in seen_texts:
            seen_texts.add(key)
            candidates.append({
                'text': clean,
                'conf': conf,
                'complete': complete,
                'reason': reason,
                'parts': parts,
                'touches_edge': touches_edge,
                'pattern_score': score,
            })

        # Positional correction: if candidate matches pattern after positional correction, keep it
        corrected = positional_correction(clean)
        if corrected != clean and get_pattern_score(corrected) > 0:
            c_score = get_pattern_score(corrected)
            c_complete, c_reason = evaluate_candidate(corrected, touches_edge)
            c_key = (corrected, c_complete, touches_edge)
            if c_key not in seen_texts:
                seen_texts.add(c_key)
                candidates.append({
                    'text': corrected,
                    'conf': conf,
                    'complete': c_complete,
                    'reason': c_reason,
                    'parts': parts,
                    'touches_edge': touches_edge,
                    'pattern_score': c_score,
                })

    for line in lines:
        line.sort(key=lambda b: b['min_x'])
        # Single box candidate
        for b in line:
            add_cand(b['text'], b['conf'], [b['text']], b['touches_edge'])

        # Left-to-right adjacent pairs
        for i in range(len(line) - 1):
            b1 = line[i]
            b2 = line[i + 1]
            pair_text = b1['text'] + b2['text']
            pair_conf = (b1['conf'] * len(b1['text']) + b2['conf'] * len(b2['text'])) / max(1, len(pair_text))
            pair_edge = b1['touches_edge'] or b2['touches_edge']
            add_cand(pair_text, pair_conf, [b1['text'], b2['text']], pair_edge)

        # All boxes in line joined
        if len(line) > 2:
            all_text = "".join(b['text'] for b in line)
            all_conf = sum(b['conf'] * len(b['text']) for b in line) / max(1, len(all_text))
            all_edge = any(b['touches_edge'] for b in line)
            add_cand(all_text, all_conf, [b['text'] for b in line], all_edge)

    # Also build joined candidate across all boxes sorted by min_x if 2 or 3 boxes exist
    all_sorted = sorted(boxes, key=lambda b: b['min_x'])
    if len(all_sorted) in (2, 3) and len(lines) > 1:
        merged_text = "".join(b['text'] for b in all_sorted)
        merged_conf = sum(b['conf'] * len(b['text']) for b in all_sorted) / max(1, len(merged_text))
        merged_edge = any(b['touches_edge'] for b in all_sorted)
        add_cand(merged_text, merged_conf, [b['text'] for b in all_sorted], merged_edge)

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


def resolve_plate(candidates: list[dict], registered_plates: list[str]) -> dict | None:
    if not candidates:
        return None

    registered = {clean_plate(value): value for value in registered_plates}

    # 1. Exact match check against registered plates
    for cand in candidates:
        if cand['text'] in registered:
            reg_clean = clean_plate(registered[cand['text']])
            cand['text'] = reg_clean
            cand['conf'] = min(99.0, cand['conf'] + 15.0)
            cand['complete'] = True
            cand['reason'] = 'ok'
            cand['pattern_score'] = max(cand['pattern_score'], 3)
            return cand

    # 2. Fuzzy match check
    if registered:
        for cand in candidates:
            matched_reg = find_fuzzy_match(cand['text'], registered)
            if matched_reg:
                cand['text'] = clean_plate(registered[matched_reg])
                cand['conf'] = min(99.0, cand['conf'] + 8.0)
                cand['complete'] = True
                cand['reason'] = 'ok'
                cand['pattern_score'] = max(cand['pattern_score'], 3)
                return cand

    # 3. Rank candidates:
    # Pattern match first, then length (prefer longer complete plates), then confidence
    sorted_candidates = sorted(
        candidates,
        key=lambda c: (
            1 if c['complete'] else 0,
            c['pattern_score'],
            len(c['text']),
            c['conf']
        ),
        reverse=True
    )

    return sorted_candidates[0]


def read_plate(image: np.ndarray, registered_plates: list[str]) -> dict:
    if image is None or image.size == 0:
        return {'plate': '', 'confidence': 0.0, 'complete': False, 'reason': 'too_short', 'parts': []}

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
    boxes1 = extract_raw_boxes(base, "Pass 1")
    candidates1 = build_candidates_from_boxes(boxes1)
    best1 = resolve_plate(candidates1, registered_plates)

    # Return early only if first pass produced a complete plate with confidence >= 70
    if best1 is not None and best1['complete'] and best1['conf'] >= 70:
        return {
            'plate': best1['text'],
            'confidence': round(best1['conf'], 1),
            'complete': best1['complete'],
            'reason': best1['reason'],
            'parts': best1['parts'],
        }

    # Pass 2: adaptive threshold binary variant
    binary = cv2.adaptiveThreshold(base, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9)
    boxes2 = extract_raw_boxes(binary, "Pass 2")
    all_boxes = boxes1 + boxes2
    all_candidates = build_candidates_from_boxes(all_boxes)
    best_all = resolve_plate(all_candidates, registered_plates)

    if best_all is not None:
        return {
            'plate': best_all['text'],
            'confidence': round(best_all['conf'], 1),
            'complete': best_all['complete'],
            'reason': best_all['reason'],
            'parts': best_all['parts'],
        }

    return {'plate': '', 'confidence': 0.0, 'complete': False, 'reason': 'too_short', 'parts': []}


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path in ('/health', '/'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        self.send_error(404)

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
            result = read_plate(image, body.get('registered_plates', [])) if image is not None else {
                'plate': '', 'confidence': 0.0, 'complete': False, 'reason': 'too_short', 'parts': []
            }
            end_t = time.perf_counter()
            proc_ms = (end_t - start_t) * 1000
            print(f"[EasyOCR] Request processed in {proc_ms:.1f}ms: plate='{result.get('plate','')}' conf={result.get('confidence',0):.1f}% complete={result.get('complete',False)} reason={result.get('reason','')}")

            payload = {
                'plate': result.get('plate', ''),
                'confidence': result.get('confidence', 0.0),
                'complete': result.get('complete', False),
                'reason': result.get('reason', 'no_pattern_match'),
                'parts': result.get('parts', []),
            }
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