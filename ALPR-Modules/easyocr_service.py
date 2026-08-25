"""Small local EasyOCR service for the browser plate-recognition pipeline."""

import base64
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import easyocr
import numpy as np


reader = easyocr.Reader(['en'], gpu=False, verbose=False)


def clean_plate(text: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', text.upper())


def read_plate(image: np.ndarray, registered_plates: list[str]) -> tuple[str, float] | None:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    enlarged = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    variants = [enlarged, cv2.adaptiveThreshold(enlarged, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9)]
    candidates: list[tuple[str, float]] = []
    for variant in variants:
        for _, text, confidence in reader.readtext(variant, detail=1, paragraph=False, allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'):
            plate = clean_plate(text)
            if 3 <= len(plate) <= 9:
                candidates.append((plate, float(confidence) * 100))
    if not candidates:
        return None
    registered = {clean_plate(value): value for value in registered_plates}
    for plate, confidence in sorted(candidates, key=lambda item: item[1], reverse=True):
        if plate in registered:
            return clean_plate(registered[plate]), min(99, confidence + 15)
    return max(candidates, key=lambda item: item[1])


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
            result = read_plate(image, body.get('registered_plates', [])) if image is not None else None
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