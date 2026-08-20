/**
 * visionEngine.ts — Vision Pipeline for PLPark
 *
 * This module provides the complete computer vision pipeline for
 * vehicle detection and license plate recognition. It runs entirely
 * in the browser using:
 *
 * - navigator.mediaDevices.getUserMedia() for camera access
 * - ONNX Runtime Web for YOLO vehicle detection
 * - Tesseract.js for OCR plate reading
 *
 * Classes:
 * 1. CameraManager — Enumerates devices, starts/stops streams, captures frames
 * 2. YOLODetector — Loads ONNX model, runs inference, extracts vehicle attributes
 * 3. PlateReader — Fast, preprocessed OCR plate reading
 * 4. ImageUploader — Uploads snapshots to Supabase Storage
 * 5. EntranceProcessor — Orchestrates entrance detection, session creation, duplicate prevention
 * 6. ExitProcessor — Plate-only OCR at exit, session completion, payment trigger
 */

import * as ort from 'onnxruntime-web';
import Tesseract from 'tesseract.js';
import { supabase } from '@/lib/supabase';

// ============================================================
// CONSTANTS
// ============================================================

/** COCO class IDs for vehicle types we care about */
const VEHICLE_CLASS_IDS: Record<number, string> = {
  2: 'car',        // car
  3: 'motorcycle', // motorcycle
  5: 'car',        // bus → mapped to car
  7: 'car',        // truck → mapped to car
};

/** All COCO class names for labeling */
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush'
];

/** YOLO input dimensions */
const MODEL_WIDTH = 640;
const MODEL_HEIGHT = 640;

/** Supabase Storage bucket name for snapshots */
const STORAGE_BUCKET = 'vehicle-snapshots';

// ============================================================
// TYPES
// ============================================================

/** A single YOLO detection result */
export interface Detection {
  classId: number;
  className: string;
  confidence: number;
  /** Bounding box in original image coordinates [x1, y1, x2, y2] */
  bbox: [number, number, number, number];
  /** Mapped vehicle type for our system */
  vehicleType: 'car' | 'motorcycle' | null;
  /** Extracted dominant color name */
  color: string | null;
}

/** A license-plate bounding box returned by the dedicated plate detector. */
export interface PlateDetection {
  bbox: [number, number, number, number];
  confidence: number;
}

/** Result of the entrance processing pipeline */
export interface EntranceResult {
  plateNumber: string;
  vehicleType: 'car' | 'motorcycle';
  color: string;
  confidence: number;
  snapshotUrl: string;      // Supabase Storage URL for full frame
  plateSnapshotUrl: string;  // Supabase Storage URL for plate crop
  isPrivate: boolean;        // matched registered vehicle
  appUserId: string | null;
}

/** Result of the exit processing pipeline */
export interface ExitResult {
  plateNumber: string;
  confidence: number;
  sessionId: string;
  entryTime: string;
  durationHours: number;
  totalAmount: number;
}

/** Camera device info */
export interface CameraDevice {
  deviceId: string;
  label: string;
}

/** Pipeline status for UI feedback */
export type PipelineStatus =
  | 'idle'
  | 'loading'
  | 'scanning'
  | 'detected'
  | 'reading_plate'
  | 'captured'
  | 'confirmed'
  | 'processing_exit'
  | 'exit_complete'
  | 'error';

// ============================================================
// 1. CAMERA MANAGER
// ============================================================

/**
 * CameraManager — Manages webcam/Iriun camera access via getUserMedia.
 *
 * Handles device enumeration, stream lifecycle, and frame capture.
 */
export class CameraManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  /**
   * enumerateDevices — Lists all available video input devices.
   * Returns an array of { deviceId, label } for camera selection dropdowns.
   */
  async enumerateDevices(): Promise<CameraDevice[]> {
    // First request permission so labels are populated
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());
    } catch {
      // Permission denied — return empty
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'videoinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      }));
  }

  /**
   * startStream — Opens a camera stream and attaches it to a video element.
   *
   * @param deviceId — The camera device ID to use (empty string = default)
   * @param videoEl — The HTMLVideoElement to display the stream
   */
  async startStream(deviceId: string, videoEl: HTMLVideoElement): Promise<void> {
    this.stopStream();

    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = this.stream;
    videoEl.muted = true;
    await videoEl.play();
    this.videoElement = videoEl;
  }

  /**
   * stopStream — Stops all tracks and cleans up the camera stream.
   */
  stopStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
  }

  /**
   * captureFrame — Grabs the current video frame as ImageData.
   *
   * @returns ImageData of the current frame, or null if no stream
   */
  captureFrame(): { imageData: ImageData; canvas: HTMLCanvasElement } | null {
    if (!this.videoElement || this.videoElement.readyState < 2) return null;

    const canvas = document.createElement('canvas');
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(this.videoElement, 0, 0);

    return {
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      canvas,
    };
  }

  /** Whether the camera stream is currently active */
  get isActive(): boolean {
    return this.stream !== null && this.stream.active;
  }
}

// ============================================================
// 2. IMAGE UPLOADER (Supabase Storage)
// ============================================================

/**
 * ImageUploader — Uploads snapshot images to Supabase Storage.
 *
 * Converts canvas/base64 images to blobs and uploads them to the
 * 'vehicle-snapshots' bucket with organized paths by date.
 */
export class ImageUploader {
  /**
   * uploadSnapshot — Uploads a canvas snapshot to Supabase Storage.
   *
   * @param canvas — The canvas containing the image to upload
   * @param prefix — Path prefix (e.g., 'entrance', 'plates')
   * @param plateNumber — Used in filename for easy lookup
   * @returns The public URL of the uploaded image, or null on failure
   */
  async uploadSnapshot(
    canvas: HTMLCanvasElement,
    prefix: string,
    plateNumber: string
  ): Promise<string | null> {
    try {
      // Convert canvas to blob
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.85);
      });

      if (!blob) return null;

      // Build organized path: prefix/YYYY-MM-DD/PLATE_timestamp.jpg
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timestamp = now.getTime();
      const safePlate = plateNumber.replace(/[^A-Z0-9]/g, '');
      const filePath = `${prefix}/${dateStr}/${safePlate}_${timestamp}.jpg`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, blob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        console.error('[ImageUploader] Upload error:', uploadError);
        // Fall back to base64 if storage upload fails
        return canvas.toDataURL('image/jpeg', 0.85);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);

      return urlData.publicUrl;
    } catch (err) {
      console.error('[ImageUploader] Error:', err);
      // Fall back to base64
      return canvas.toDataURL('image/jpeg', 0.85);
    }
  }
}

// ============================================================
// 3. YOLO DETECTOR
// ============================================================

/**
 * YOLODetector — Runs YOLOv8 inference in the browser via ONNX Runtime Web.
 *
 * Detects vehicles (car, motorcycle, bus, truck) and provides
 * bounding boxes, class labels, and confidence scores.
 * Bus and truck are mapped to 'car' per user requirement.
 */
export class YOLODetector {
  private session: ort.InferenceSession | null = null;
  private _isLoaded = false;

  /** Whether the model has been loaded successfully */
  get isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * loadModel — Downloads and initializes the ONNX model.
   *
   * @param modelPath — Path to the .onnx file (default: /models/yolov8n.onnx)
   */
  async loadModel(modelPath = '/models/yolov8n.onnx'): Promise<void> {
    try {
      // Configure ONNX Runtime WASM paths to match installed version (1.27.0)
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';

      // Fetch model as ArrayBuffer to avoid Vite dev server interference
      const response = await fetch(modelPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
      }
      const modelBuffer = await response.arrayBuffer();

      this.session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      this._isLoaded = true;
      console.log('[YOLODetector] Model loaded successfully');
    } catch (err) {
      console.error('[YOLODetector] Failed to load model:', err);
      throw err;
    }
  }

  /**
   * detect — Runs YOLO inference on an image frame.
   *
   * Preprocesses the image (resize, normalize), runs the model,
   * and post-processes results with NMS. Only returns vehicle detections.
   *
   * @param imageData — Raw pixel data from the video frame
   * @param confThreshold — Minimum confidence score (default: 0.45)
   * @param iouThreshold — IoU threshold for NMS (default: 0.5)
   * @returns Array of vehicle Detection objects
   */
  async detect(
    imageData: ImageData,
    confThreshold = 0.45,
    iouThreshold = 0.5
  ): Promise<Detection[]> {
    if (!this.session) return [];

    const { width: origW, height: origH } = imageData;

    // Preprocess: resize to MODEL_WIDTH x MODEL_HEIGHT and normalize to [0, 1]
    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = MODEL_WIDTH;
    resizedCanvas.height = MODEL_HEIGHT;
    const resizedCtx = resizedCanvas.getContext('2d')!;

    // Create a temp canvas from imageData
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = origW;
    tempCanvas.height = origH;
    tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

    resizedCtx.drawImage(tempCanvas, 0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const resizedData = resizedCtx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);

    // Convert to CHW float32 tensor [1, 3, 640, 640]
    const input = new Float32Array(3 * MODEL_WIDTH * MODEL_HEIGHT);
    for (let i = 0; i < MODEL_WIDTH * MODEL_HEIGHT; i++) {
      input[i] = resizedData.data[i * 4] / 255.0;                                    // R
      input[MODEL_WIDTH * MODEL_HEIGHT + i] = resizedData.data[i * 4 + 1] / 255.0;   // G
      input[2 * MODEL_WIDTH * MODEL_HEIGHT + i] = resizedData.data[i * 4 + 2] / 255.0; // B
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_HEIGHT, MODEL_WIDTH]);

    // Run inference
    const inputName = this.session.inputNames[0];
    const results = await this.session.run({ [inputName]: tensor });
    const output = results[this.session.outputNames[0]];

    // Parse YOLOv8 output: shape [1, 84, 8400]
    // 84 = 4 bbox coords + 80 class scores
    const data = output.data as Float32Array;
    const numClasses = 80;
    const numDetections = 8400;

    const rawDetections: Detection[] = [];

    for (let i = 0; i < numDetections; i++) {
      // Find the class with highest score
      let maxScore = 0;
      let maxClassId = 0;
      for (let c = 0; c < numClasses; c++) {
        const score = data[(4 + c) * numDetections + i];
        if (score > maxScore) {
          maxScore = score;
          maxClassId = c;
        }
      }

      if (maxScore < confThreshold) continue;

      // Only keep vehicle classes
      if (!(maxClassId in VEHICLE_CLASS_IDS)) continue;

      // Extract bbox (center_x, center_y, width, height) in model coords
      const cx = data[0 * numDetections + i];
      const cy = data[1 * numDetections + i];
      const w = data[2 * numDetections + i];
      const h = data[3 * numDetections + i];

      // Convert to original image coordinates
      const scaleX = origW / MODEL_WIDTH;
      const scaleY = origH / MODEL_HEIGHT;

      const x1 = Math.max(0, (cx - w / 2) * scaleX);
      const y1 = Math.max(0, (cy - h / 2) * scaleY);
      const x2 = Math.min(origW, (cx + w / 2) * scaleX);
      const y2 = Math.min(origH, (cy + h / 2) * scaleY);

      rawDetections.push({
        classId: maxClassId,
        className: COCO_CLASSES[maxClassId] || 'unknown',
        confidence: maxScore,
        bbox: [x1, y1, x2, y2],
        vehicleType: VEHICLE_CLASS_IDS[maxClassId] as 'car' | 'motorcycle' | null,
        color: null,
      });
    }

    // Apply NMS
    const nmsDetections = this.nms(rawDetections, iouThreshold);

    // Extract color for each detection
    for (const det of nmsDetections) {
      det.color = this.extractColor(imageData, det.bbox);
    }

    return nmsDetections;
  }

  /**
   * nms — Non-Maximum Suppression to remove overlapping detections.
   */
  private nms(detections: Detection[], iouThreshold: number): Detection[] {
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
    const selected: Detection[] = [];
    const suppressed = new Set<number>();

    for (let i = 0; i < sorted.length; i++) {
      if (suppressed.has(i)) continue;
      selected.push(sorted[i]);

      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed.has(j)) continue;
        if (this.iou(sorted[i].bbox, sorted[j].bbox) > iouThreshold) {
          suppressed.add(j);
        }
      }
    }

    return selected;
  }

  /**
   * iou — Computes Intersection over Union between two bounding boxes.
   */
  private iou(a: [number, number, number, number], b: [number, number, number, number]): number {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (a[2] - a[0]) * (a[3] - a[1]);
    const areaB = (b[2] - b[0]) * (b[3] - b[1]);

    return intersection / (areaA + areaB - intersection);
  }

  /**
   * extractColor — Samples the dominant color from a bounding box region.
   *
   * Averages the center 40% of pixels and maps to nearest named color.
   */
  extractColor(imageData: ImageData, bbox: [number, number, number, number]): string {
    const [x1, y1, x2, y2] = bbox.map(Math.round);
    const { data, width } = imageData;

    // Sample from the center 40% of the bounding box
    const centerX1 = Math.round(x1 + (x2 - x1) * 0.3);
    const centerY1 = Math.round(y1 + (y2 - y1) * 0.3);
    const centerX2 = Math.round(x1 + (x2 - x1) * 0.7);
    const centerY2 = Math.round(y1 + (y2 - y1) * 0.7);

    let totalR = 0, totalG = 0, totalB = 0, count = 0;

    for (let y = centerY1; y < centerY2; y += 3) {
      for (let x = centerX1; x < centerX2; x += 3) {
        const idx = (y * width + x) * 4;
        if (idx >= 0 && idx < data.length - 3) {
          totalR += data[idx];
          totalG += data[idx + 1];
          totalB += data[idx + 2];
          count++;
        }
      }
    }

    if (count === 0) return 'Unknown';

    const avgR = totalR / count;
    const avgG = totalG / count;
    const avgB = totalB / count;

    return this.rgbToColorName(avgR, avgG, avgB);
  }

  /**
   * rgbToColorName — Maps RGB values to the nearest human-readable color name.
   */
  private rgbToColorName(r: number, g: number, b: number): string {
    const colors: [string, number, number, number][] = [
      ['White', 255, 255, 255],
      ['Black', 0, 0, 0],
      ['Silver', 192, 192, 192],
      ['Gray', 128, 128, 128],
      ['Red', 200, 30, 30],
      ['Blue', 30, 60, 200],
      ['Green', 30, 150, 30],
      ['Yellow', 240, 220, 30],
      ['Orange', 240, 150, 30],
      ['Brown', 139, 90, 43],
      ['Beige', 210, 190, 160],
      ['Maroon', 128, 0, 0],
      ['Navy', 0, 0, 128],
    ];

    let minDist = Infinity;
    let closestColor = 'Unknown';

    for (const [name, cr, cg, cb] of colors) {
      const dist = Math.sqrt((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestColor = name;
      }
    }

    return closestColor;
  }

  /** Cleanup ONNX session */
  dispose(): void {
    this.session = null;
    this._isLoaded = false;
  }
}

/**
 * PlateDetector — YOLO ONNX detector trained specifically for license plates.
 *
 * Expected output is the standard YOLO single-class tensor [1, 5, N]:
 * center-x, center-y, width, height, confidence.
 */
class PlateDetector {
  private session: ort.InferenceSession | null = null;
  private _isLoaded = false;

  get isLoaded(): boolean { return this._isLoaded; }

  async loadModel(modelPath = '/models/license_plate_detector.onnx'): Promise<void> {
    const response = await fetch(modelPath);
    if (!response.ok) throw new Error(`Plate detector unavailable: ${response.status}`);
    const buffer = await response.arrayBuffer();
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
    this.session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    this._isLoaded = true;
  }

  async detect(imageData: ImageData, threshold = 0.30): Promise<PlateDetection[]> {
    if (!this.session) return [];
    const canvas = document.createElement('canvas');
    canvas.width = MODEL_WIDTH;
    canvas.height = MODEL_HEIGHT;
    const source = document.createElement('canvas');
    source.width = imageData.width;
    source.height = imageData.height;
    source.getContext('2d')!.putImageData(imageData, 0, 0);
    const scale = Math.min(MODEL_WIDTH / imageData.width, MODEL_HEIGHT / imageData.height);
    const resizedWidth = Math.round(imageData.width * scale);
    const resizedHeight = Math.round(imageData.height * scale);
    const padX = Math.round((MODEL_WIDTH - resizedWidth) / 2);
    const padY = Math.round((MODEL_HEIGHT - resizedHeight) / 2);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#808080';
    context.fillRect(0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    context.drawImage(source, 0, 0, imageData.width, imageData.height, padX, padY, resizedWidth, resizedHeight);
    const pixels = context.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT).data;
    const plane = MODEL_WIDTH * MODEL_HEIGHT;
    const input = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i++) {
      input[i] = pixels[i * 4] / 255;
      input[plane + i] = pixels[i * 4 + 1] / 255;
      input[plane * 2 + i] = pixels[i * 4 + 2] / 255;
    }
    const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_HEIGHT, MODEL_WIDTH]);
    const result = await this.session.run({ [this.session.inputNames[0]]: tensor });
    const output = result[this.session.outputNames[0]];
    const data = output.data as Float32Array;
    const count = Math.floor(data.length / 5);
    const rawBoxes: PlateDetection[] = [];
    for (let i = 0; i < count; i++) {
      const confidence = data[4 * count + i];
      if (confidence < threshold) continue;
      const cx = data[i];
      const cy = data[count + i];
      const width = data[count * 2 + i];
      const height = data[count * 3 + i];
      const modelX1 = cx - width / 2;
      const modelY1 = cy - height / 2;
      const modelX2 = cx + width / 2;
      const modelY2 = cy + height / 2;
      rawBoxes.push({
        confidence,
        bbox: [
          Math.max(0, (modelX1 - padX) / scale),
          Math.max(0, (modelY1 - padY) / scale),
          Math.min(imageData.width, (modelX2 - padX) / scale),
          Math.min(imageData.height, (modelY2 - padY) / scale),
        ],
      });
    }

    return this.nms(rawBoxes, 0.4).slice(0, 3);
  }

  private nms(boxes: PlateDetection[], iouThreshold: number): PlateDetection[] {
    const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
    const selected: PlateDetection[] = [];
    const suppressed = new Set<number>();

    for (let i = 0; i < sorted.length; i++) {
      if (suppressed.has(i)) continue;
      selected.push(sorted[i]);

      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed.has(j)) continue;
        if (this.iou(sorted[i].bbox, sorted[j].bbox) > iouThreshold) {
          suppressed.add(j);
        }
      }
    }
    return selected;
  }

  private iou(a: [number, number, number, number], b: [number, number, number, number]): number {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (a[2] - a[0]) * (a[3] - a[1]);
    const areaB = (b[2] - b[0]) * (b[3] - b[1]);

    return intersection / (areaA + areaB - intersection);
  }

  dispose(): void {
    this.session = null;
    this._isLoaded = false;
  }
}

/** Crop and normalize an exact plate detector box for OCR. */
function cropDetectedPlate(sourceCanvas: HTMLCanvasElement, bbox: [number, number, number, number]): HTMLCanvasElement | null {
  const [rawX1, rawY1, rawX2, rawY2] = bbox.map(Math.round);
  const paddingX = Math.round((rawX2 - rawX1) * 0.08);
  const paddingY = Math.round((rawY2 - rawY1) * 0.15);
  const x1 = Math.max(0, rawX1 - paddingX);
  const y1 = Math.max(0, rawY1 - paddingY);
  const x2 = Math.min(sourceCanvas.width, rawX2 + paddingX);
  const y2 = Math.min(sourceCanvas.height, rawY2 + paddingY);
  const width = x2 - x1;
  const height = y2 - y1;
  if (width < 25 || height < 10) return null;
  const canvas = document.createElement('canvas');
  const scale = 2.5;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(sourceCanvas, x1, y1, width, height, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const gray = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
    const enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.6 + 128));
    image.data[i] = enhanced;
    image.data[i + 1] = enhanced;
    image.data[i + 2] = enhanced;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}



/** Compute Levenshtein distance between two strings */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/** Match OCR plate output against registered database plates using fuzzy Levenshtein distance */
function matchRegisteredPlate(ocrPlate: string, registeredPlates: string[]): string | null {
  for (const reg of registeredPlates) {
    const cleanReg = reg.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanReg === ocrPlate) return reg;
    const dist = levenshteinDistance(ocrPlate, cleanReg);
    if (dist === 1 && ocrPlate.length >= 5) {
      return reg;
    }
  }
  return null;
}

/** Formats raw OCR plate text with Philippine pattern rules & DB fuzzy matching */
function cleanAndFormatPlate(
  rawText: string,
  registeredPlates: string[] = []
): { plate: string; confidenceBoost: number } {
  let normalized = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  if (normalized.length < 3 || normalized.length > 9) {
    return { plate: '', confidenceBoost: 0 };
  }

  const letters: Record<string, string> = { '0': 'O', '1': 'I', '3': 'J', '4': 'A', '5': 'S', '6': 'G', '8': 'B', '2': 'Z' };
  const digits: Record<string, string> = { O: '0', I: '1', J: '3', A: '4', G: '6', S: '5', B: '8', Z: '2', Q: '0' };

  if (normalized.length === 7) {
    const prefix = normalized.slice(0, 3);
    const hasLetterPrefix = (prefix.match(/[A-Z]/g) || []).length >= 2;
    if (hasLetterPrefix) {
      normalized = normalized
        .split('')
        .map((char, i) => (i < 3 ? letters[char] || char : digits[char] || char))
        .join('');
    }
  } else if (normalized.length === 6) {
    const prefix = normalized.slice(0, 3);
    const letterCount = (prefix.match(/[A-Z]/g) || []).length;
    if (letterCount >= 2) {
      normalized = normalized
        .split('')
        .map((char, i) => (i < 3 ? letters[char] || char : digits[char] || char))
        .join('');
    } else {
      normalized = normalized
        .split('')
        .map((char, i) => (i < 3 ? digits[char] || char : letters[char] || char))
        .join('');
    }
  }

  if (registeredPlates.length > 0) {
    const dbMatch = matchRegisteredPlate(normalized, registeredPlates);
    if (dbMatch) {
      return { plate: dbMatch, confidenceBoost: 30 };
    }
  }

  return { plate: normalized, confidenceBoost: 0 };
}

// ============================================================
// 4. PLATE READER (OCR)
// ============================================================

/**
 * PlateReader — Reads license plates using Tesseract.js OCR.
 */
export class PlateReader {
  private worker: Tesseract.Worker | null = null;
  private _isReady = false;

  get isReady(): boolean {
    return this._isReady;
  }

  async initialize(): Promise<void> {
    try {
      this.worker = await Tesseract.createWorker('eng', 1, {
        logger: () => {},
      });

      await this.worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        load_system_dawg: '0',
        load_freq_dawg: '0',
        load_punc_dawg: '0',
        load_number_dawg: '0',
        load_unambig_dawg: '0',
        load_bigram_dawg: '0',
        tessedit_do_invert: '0',
        user_defined_dpi: '300',
        preserve_interword_spaces: '0',
      });

      this._isReady = true;
      console.log('[PlateReader] Ultra-fast Tesseract OCR worker ready');
    } catch (err) {
      console.error('[PlateReader] Failed to initialize:', err);
      throw err;
    }
  }

  async readPlate(imageSource: HTMLCanvasElement | string): Promise<string> {
    if (!this.worker) return '';
    const result = await this.worker.recognize(imageSource);
    return cleanAndFormatPlate(result.data.text).plate;
  }

  async confirmPlate(
    imageSource: HTMLCanvasElement | string,
    registeredPlates: string[] = []
  ): Promise<{ plate: string; confidence: number } | null> {
    if (!this.worker) return null;

    const result = await this.worker.recognize(imageSource);
    const { plate, confidenceBoost } = cleanAndFormatPlate(result.data.text, registeredPlates);
    const rawConf = Number(result.data.confidence || 0);
    const confidence = Math.min(99, Math.round(rawConf + confidenceBoost));

    if (plate.length < 3 || plate.length > 9) return null;
    return { plate, confidence: Math.max(40, confidence) };
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this._isReady = false;
    }
  }
}

// ============================================================
// 5. ENTRANCE PROCESSOR
// ============================================================

/**
 * EntranceProcessor — Fast stream loop + Instant Snapshot Capture + Multi-Variant Background OCR.
 */
export class EntranceProcessor {
  private cameraManager: CameraManager;
  private detector: YOLODetector;
  private plateDetector: PlateDetector;
  private plateReader: PlateReader;
  private uploader: ImageUploader;
  private intervalId: number | null = null;
  private lockedPlates: Set<string> = new Set();
  private registeredPlatesCache: string[] = [];
  private _status: PipelineStatus = 'idle';
  private _lastResult: EntranceResult | null = null;
  private _detections: Detection[] = [];
  private _plateDetections: PlateDetection[] = [];

  private statusCallbacks: ((status: PipelineStatus) => void)[] = [];
  private detectionCallbacks: ((detections: Detection[]) => void)[] = [];
  private plateDetectionsCallbacks: ((plateDetections: PlateDetection[]) => void)[] = [];
  private resultCallbacks: ((result: EntranceResult) => void)[] = [];
  private frameCallbacks: (() => void)[] = [];

  private _isProcessingSnapshot = false;
  private triggerCooldown = false;

  constructor() {
    this.cameraManager = new CameraManager();
    this.detector = new YOLODetector();
    this.plateDetector = new PlateDetector();
    this.plateReader = new PlateReader();
    this.uploader = new ImageUploader();
  }

  get status(): PipelineStatus { return this._status; }
  get detections(): Detection[] { return this._detections; }
  get plateDetections(): PlateDetection[] { return this._plateDetections; }
  get lastResult(): EntranceResult | null { return this._lastResult; }
  get camera(): CameraManager { return this.cameraManager; }
  get isModelLoaded(): boolean { return this.detector.isLoaded; }
  get isOcrReady(): boolean { return this.plateReader.isReady; }

  onStatusChange(cb: (status: PipelineStatus) => void): void { this.statusCallbacks.push(cb); }
  onDetections(cb: (detections: Detection[]) => void): void { this.detectionCallbacks.push(cb); }
  onPlateDetections(cb: (plateDetections: PlateDetection[]) => void): void { this.plateDetectionsCallbacks.push(cb); }
  onResult(cb: (result: EntranceResult) => void): void { this.resultCallbacks.push(cb); }
  onFrame(cb: () => void): void { this.frameCallbacks.push(cb); }

  private setStatus(status: PipelineStatus): void {
    this._status = status;
    this.statusCallbacks.forEach(cb => cb(status));
  }

  async initialize(): Promise<void> {
    this.setStatus('loading');
    try {
      await Promise.all([
        this.detector.loadModel(),
        this.plateReader.initialize(),
      ]);

      try {
        await this.plateDetector.loadModel();
        console.log('[EntranceProcessor] Dedicated plate detector loaded');
      } catch {
        console.warn('[EntranceProcessor] Dedicated plate model missing; fallback active');
      }

      // Cache registered vehicles from database for fuzzy Levenshtein OCR matching
      try {
        const { data } = await supabase.from('vehicles').select('plate_number');
        if (data) {
          this.registeredPlatesCache = data.map(v => v.plate_number).filter(Boolean);
        }
      } catch (err) {
        console.warn('[EntranceProcessor] Could not fetch registered plates cache:', err);
      }

      this.setStatus('idle');
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  async startCamera(deviceId: string, videoEl: HTMLVideoElement): Promise<void> {
    await this.cameraManager.startStream(deviceId, videoEl);
  }

  /**
   * startProcessing — Runs fast video detection loop (~300ms).
   * Immediately triggers snapshot capture when a plate or vehicle is detected.
   */
  startProcessing(): void {
    if (this.intervalId) return;
    this.setStatus('scanning');

    this.intervalId = window.setInterval(async () => {
      await this.runStreamFrame();
    }, 300);
  }

  stopProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.setStatus('idle');
  }

  async stop(): Promise<void> {
    this.stopProcessing();
    this.cameraManager.stopStream();
    await this.plateReader.dispose();
    this.detector.dispose();
    this.plateDetector.dispose();
    this.lockedPlates.clear();
    this._detections = [];
    this._plateDetections = [];
  }

  /**
   * runStreamFrame — Real-time high-speed stream plate recognition (<200ms).
   * Immediately confirms & emits recognized plate text to UI in real-time.
   */
  private async runStreamFrame(): Promise<void> {
    const frame = this.cameraManager.captureFrame();
    if (!frame) return;

    try {
      // 1. Run YOLO Vehicle Detection
      const vehicleDetections = await this.detector.detect(frame.imageData, 0.25);
      this._detections = vehicleDetections;

      // 2. Run Dedicated Plate Detector
      let plateDetections: PlateDetection[] = [];
      if (this.plateDetector.isLoaded) {
        plateDetections = await this.plateDetector.detect(frame.imageData, 0.25);
      }
      this._plateDetections = plateDetections;

      // Notify UI for immediate overlay drawing
      this.detectionCallbacks.forEach(cb => cb(vehicleDetections));
      this.plateDetectionsCallbacks.forEach(cb => cb(plateDetections));
      this.frameCallbacks.forEach(cb => cb());

      if (this._status === 'scanning' && (vehicleDetections.length > 0 || plateDetections.length > 0)) {
        this.setStatus('detected');
      }

      // 3. REAL-TIME INSTANT STREAM SCANNING:
      if (!this.triggerCooldown && !this._isProcessingSnapshot && (plateDetections.length > 0 || vehicleDetections.length > 0)) {
        const topPlate = plateDetections[0];
        const topVehicle = vehicleDetections[0];

        let bestCrop: HTMLCanvasElement | null = null;
        if (topPlate) {
          bestCrop = cropDetectedPlate(frame.canvas, topPlate.bbox);
        } else if (topVehicle) {
          bestCrop = this.cropPlateRegion(frame.canvas, topVehicle.bbox);
        }

        if (bestCrop) {
          this._isProcessingSnapshot = true;
          this.setStatus('reading_plate');

          // Ultra-fast single pass OCR (~150ms)
          const ocrRes = await this.plateReader.confirmPlate(bestCrop, this.registeredPlatesCache);

          if (ocrRes && !this.lockedPlates.has(ocrRes.plate)) {
            const plateNumber = ocrRes.plate;
            const confidence = ocrRes.confidence;

            this.triggerCooldown = true;
            this.setStatus('confirmed');
            console.log(`[EntranceProcessor] ⚡ Real-time plate confirmed: ${plateNumber} (${confidence}%)`);

            let vehicleType: 'car' | 'motorcycle' = topVehicle?.vehicleType || 'car';
            let color = topVehicle?.color || 'White';

            const { isPrivate, appUserId } = await this.lookupVehicle(plateNumber);

            const result: EntranceResult = {
              plateNumber,
              vehicleType,
              color,
              confidence,
              snapshotUrl: '',
              plateSnapshotUrl: '',
              isPrivate,
              appUserId,
            };

            this.lockedPlates.add(plateNumber);
            this._lastResult = result;
            // INSTANTLY EMIT TO FRONT-END UI!
            this.resultCallbacks.forEach(cb => cb(result));

            // Offload database session & image uploads to background task
            this.saveEntranceRecord(frame.canvas, bestCrop, result);

            setTimeout(() => { this.triggerCooldown = false; }, 8000);
            setTimeout(() => { this.lockedPlates.delete(plateNumber); }, 15000);

            setTimeout(() => {
              if (this._status === 'confirmed') {
                this.setStatus('scanning');
              }
            }, 3000);
          } else {
            this.setStatus('scanning');
          }

          this._isProcessingSnapshot = false;
        }
      }
    } catch (err) {
      console.error('[EntranceProcessor] Stream error:', err);
      this._isProcessingSnapshot = false;
    }
  }

  private async saveEntranceRecord(
    fullCanvas: HTMLCanvasElement,
    winningCrop: HTMLCanvasElement,
    result: EntranceResult
  ): Promise<void> {
    try {
      const [snapshotUrl, plateSnapshotUrl] = await Promise.all([
        this.uploader.uploadSnapshot(fullCanvas, 'entrance', result.plateNumber),
        this.uploader.uploadSnapshot(winningCrop, 'plates', result.plateNumber),
      ]);

      result.snapshotUrl = snapshotUrl || '';
      result.plateSnapshotUrl = plateSnapshotUrl || '';

      await this.createSession(result);
    } catch (err) {
      console.error('[EntranceProcessor] Background save error:', err);
    }
  }

  private cropPlateRegion(
    sourceCanvas: HTMLCanvasElement,
    bbox: [number, number, number, number]
  ): HTMLCanvasElement | null {
    const [x1, y1, x2, y2] = bbox.map(Math.round);
    const bboxW = x2 - x1;
    const bboxH = y2 - y1;
    if (bboxW < 30 || bboxH < 20) return null;

    const plateY = y1 + Math.round(bboxH * 0.55);
    const plateH = y2 - plateY;
    const plateW = bboxW;

    if (plateW < 35 || plateH < 12) return null;

    const plateCanvas = document.createElement('canvas');
    const scale = 2.5;
    plateCanvas.width = Math.round(plateW * scale);
    plateCanvas.height = Math.round(plateH * scale);
    const ctx = plateCanvas.getContext('2d')!;

    ctx.drawImage(sourceCanvas, x1, plateY, plateW, plateH, 0, 0, plateCanvas.width, plateCanvas.height);
    const imgData = ctx.getImageData(0, 0, plateCanvas.width, plateCanvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.6 + 128));
      d[i] = d[i + 1] = d[i + 2] = enhanced;
    }
    ctx.putImageData(imgData, 0, 0);
    return plateCanvas;
  }

  private cropFrameRegion(
    sourceCanvas: HTMLCanvasElement,
    xRatio: number, yRatio: number, wRatio: number, hRatio: number
  ): HTMLCanvasElement | null {
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const x = Math.round(sw * xRatio);
    const y = Math.round(sh * yRatio);
    const w = Math.round(sw * wRatio);
    const h = Math.round(sh * hRatio);

    if (w < 40 || h < 15) return null;

    const cropCanvas = document.createElement('canvas');
    const scale = 2.5;
    cropCanvas.width = Math.round(w * scale);
    cropCanvas.height = Math.round(h * scale);
    const ctx = cropCanvas.getContext('2d')!;
    ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, cropCanvas.width, cropCanvas.height);
    return cropCanvas;
  }

  private async lookupVehicle(plate: string): Promise<{ isPrivate: boolean; appUserId: string | null }> {
    try {
      const { data } = await supabase
        .from('vehicles')
        .select('app_user_id')
        .eq('plate_number', plate)
        .limit(1);

      if (data && data.length > 0 && data[0].app_user_id) {
        return { isPrivate: true, appUserId: data[0].app_user_id };
      }
    } catch (err) {
      console.error('[EntranceProcessor] Vehicle lookup error:', err);
    }
    return { isPrivate: false, appUserId: null };
  }

  private async createSession(result: EntranceResult): Promise<void> {
    try {
      await supabase.from('parking_sessions').insert({
        plate_number: result.plateNumber,
        vehicle_type: result.vehicleType,
        color: result.color,
        image_url: result.snapshotUrl,
        concept: result.isPrivate ? 'B' : 'A',
        entry_camera: 'Webcam Entrance',
        status: 'active',
        entry_time: new Date().toISOString(),
        app_user_id: result.appUserId,
      });

      await supabase.from('plate_recognitions').insert({
        plate_number: result.plateNumber,
        vehicle_type: result.vehicleType,
        direction: 'entry',
        confidence: result.confidence,
        camera_name: 'Webcam Entrance',
        image_url: result.plateSnapshotUrl,
      });

      await supabase.from('notifications').insert({
        type: result.isPrivate ? 'info' : 'success',
        title: `Vehicle Entered: ${result.plateNumber}`,
        message: `${result.vehicleType.charAt(0).toUpperCase() + result.vehicleType.slice(1)} (${result.color}) — ${result.isPrivate ? 'Private (Registered)' : 'Public (Guest)'}`,
      });

      console.log(`[EntranceProcessor] Session created for ${result.plateNumber}`);
    } catch (err) {
      console.error('[EntranceProcessor] Database error:', err);
    }
  }
}

// ============================================================
// 6. EXIT PROCESSOR
// ============================================================

/**
 * ExitProcessor — Instant Snapshot Capture + Multi-Variant Background OCR for Exit.
 */
export class ExitProcessor {
  private cameraManager: CameraManager;
  private plateReader: PlateReader;
  private plateDetector: PlateDetector;
  private detector: YOLODetector;
  private intervalId: number | null = null;
  private lockedPlates: Set<string> = new Set();
  private registeredPlatesCache: string[] = [];
  private _status: PipelineStatus = 'idle';
  private _lastResult: ExitResult | null = null;
  private _detections: Detection[] = [];
  private _plateDetections: PlateDetection[] = [];

  private statusCallbacks: ((status: PipelineStatus) => void)[] = [];
  private resultCallbacks: ((result: ExitResult) => void)[] = [];
  private detectionCallbacks: ((detections: Detection[]) => void)[] = [];
  private plateDetectionsCallbacks: ((plateDetections: PlateDetection[]) => void)[] = [];
  private frameCallbacks: (() => void)[] = [];

  private _isProcessing = false;
  private triggerCooldown = false;

  constructor() {
    this.cameraManager = new CameraManager();
    this.plateReader = new PlateReader();
    this.plateDetector = new PlateDetector();
    this.detector = new YOLODetector();
  }

  get status(): PipelineStatus { return this._status; }
  get lastResult(): ExitResult | null { return this._lastResult; }
  get camera(): CameraManager { return this.cameraManager; }
  get detections(): Detection[] { return this._detections; }
  get plateDetections(): PlateDetection[] { return this._plateDetections; }

  onStatusChange(cb: (status: PipelineStatus) => void): void { this.statusCallbacks.push(cb); }
  onResult(cb: (result: ExitResult) => void): void { this.resultCallbacks.push(cb); }
  onDetections(cb: (detections: Detection[]) => void): void { this.detectionCallbacks.push(cb); }
  onPlateDetections(cb: (plateDetections: PlateDetection[]) => void): void { this.plateDetectionsCallbacks.push(cb); }
  onFrame(cb: () => void): void { this.frameCallbacks.push(cb); }

  private setStatus(status: PipelineStatus): void {
    this._status = status;
    this.statusCallbacks.forEach(cb => cb(status));
  }

  async initialize(): Promise<void> {
    this.setStatus('loading');
    try {
      await this.plateReader.initialize();
      try {
        await this.plateDetector.loadModel();
        console.log('[ExitProcessor] Dedicated plate detector loaded');
      } catch {
        console.warn('[ExitProcessor] Dedicated plate model missing');
      }

      try {
        const { data } = await supabase.from('parking_sessions').select('plate_number').eq('status', 'active');
        if (data) {
          this.registeredPlatesCache = data.map(s => s.plate_number).filter(Boolean);
        }
      } catch (err) {
        console.warn('[ExitProcessor] Could not cache active session plates:', err);
      }

      this.setStatus('idle');
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  async startCamera(deviceId: string, videoEl: HTMLVideoElement): Promise<void> {
    await this.cameraManager.startStream(deviceId, videoEl);
  }

  startProcessing(): void {
    if (this.intervalId) return;
    this.setStatus('scanning');

    this.intervalId = window.setInterval(async () => {
      await this.processStreamFrame();
    }, 300);
  }

  stopProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._detections = [];
    this._plateDetections = [];
    this.setStatus('idle');
  }

  async stop(): Promise<void> {
    this.stopProcessing();
    this.cameraManager.stopStream();
    await this.plateReader.dispose();
    this.lockedPlates.clear();
    this.plateDetector.dispose();
    this.detector.dispose();
  }

  private async processStreamFrame(): Promise<void> {
    const frame = this.cameraManager.captureFrame();
    if (!frame) return;

    try {
      let plateDetections: PlateDetection[] = [];
      if (this.plateDetector.isLoaded) {
        plateDetections = await this.plateDetector.detect(frame.imageData, 0.25);
      }
      this._plateDetections = plateDetections;
      this.plateDetectionsCallbacks.forEach(cb => cb(plateDetections));
      this.frameCallbacks.forEach(cb => cb());

      if (this._status === 'scanning' && plateDetections.length > 0) {
        this.setStatus('detected');
      }

      if (!this.triggerCooldown && !this._isProcessing && plateDetections.length > 0) {
        const topPlate = plateDetections[0];
        const bestCrop = cropDetectedPlate(frame.canvas, topPlate.bbox);

        if (bestCrop) {
          this._isProcessing = true;
          this.setStatus('reading_plate');

          // Ultra-fast single pass OCR (~150ms)
          const ocrRes = await this.plateReader.confirmPlate(bestCrop, this.registeredPlatesCache);

          if (ocrRes && !this.lockedPlates.has(ocrRes.plate)) {
            const exitResult = await this.processExit(ocrRes.plate, ocrRes.confidence);

            if (exitResult) {
              this.triggerCooldown = true;
              this.lockedPlates.add(ocrRes.plate);
              this._lastResult = exitResult;
              this.setStatus('exit_complete');
              // INSTANTLY EMIT TO FRONT-END UI!
              this.resultCallbacks.forEach(cb => cb(exitResult));

              setTimeout(() => { this.triggerCooldown = false; }, 8000);
              setTimeout(() => { this.lockedPlates.delete(ocrRes.plate); }, 15000);

              setTimeout(() => {
                if (this._status === 'exit_complete') {
                  this.setStatus('scanning');
                }
              }, 3000);
            } else {
              this.setStatus('scanning');
            }
          } else {
            this.setStatus('scanning');
          }

          this._isProcessing = false;
        }
      }
    } catch (err) {
      console.error('[ExitProcessor] Stream error:', err);
      this._isProcessing = false;
    }
  }

  private async processExit(plateNumber: string, confidence: number): Promise<ExitResult | null> {
    try {
      // 1. Find active session for this plate (exact match first)
      let { data: sessions } = await supabase
        .from('parking_sessions')
        .select('*')
        .eq('plate_number', plateNumber)
        .eq('status', 'active')
        .order('entry_time', { ascending: false })
        .limit(1);

      // If no exact active session, try fuzzy Levenshtein match against active sessions
      if (!sessions || sessions.length === 0) {
        const { data: activeSessions } = await supabase
          .from('parking_sessions')
          .select('*')
          .eq('status', 'active')
          .order('entry_time', { ascending: false });

        if (activeSessions && activeSessions.length > 0) {
          const matched = activeSessions.find(s => {
            const cleanActive = s.plate_number.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const cleanOcr = plateNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
            return levenshteinDistance(cleanOcr, cleanActive) <= 1;
          });
          if (matched) {
            sessions = [matched];
            plateNumber = matched.plate_number;
          }
        }
      }

      if (!sessions || sessions.length === 0) {
        console.log(`[ExitProcessor] No active session found for ${plateNumber}`);
        return null;
      }

      const session = sessions[0];
      const exitTime = new Date();
      const entryTime = new Date(session.entry_time);
      const durationMs = exitTime.getTime() - entryTime.getTime();
      const durationHours = Math.max(0.5, Math.ceil((durationMs / (1000 * 60 * 60)) * 2) / 2);

      const rateKey = session.vehicle_type === 'motorcycle' ? 'hourly_rate_motorcycle' : 'hourly_rate_car';
      const { data: settingsData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', rateKey)
        .limit(1);

      const hourlyRate = settingsData && settingsData.length > 0 ? Number(settingsData[0].value) : (session.vehicle_type === 'motorcycle' ? 25 : 50);
      const totalAmount = durationHours * hourlyRate;

      await supabase
        .from('parking_sessions')
        .update({
          status: 'completed',
          exit_time: exitTime.toISOString(),
          exit_camera: 'Webcam Exit',
        })
        .eq('id', session.id);

      const { data: countData } = await supabase.from('payments').select('id');
      const receiptNum = `RCP-${exitTime.getFullYear()}-${String((countData?.length || 0) + 1).padStart(4, '0')}`;

      await supabase.from('payments').insert({
        receipt_number: receiptNum,
        plate_number: plateNumber,
        session_id: session.id,
        duration_hours: durationHours,
        hourly_rate: hourlyRate,
        total_amount: totalAmount,
        payment_method: session.concept === 'B' ? 'gcash' : 'cash',
        status: 'pending',
        processed_by: 'Vision System',
      });

      await supabase.from('plate_recognitions').insert({
        plate_number: plateNumber,
        vehicle_type: session.vehicle_type,
        direction: 'exit',
        confidence,
        camera_name: 'Webcam Exit',
      });

      if (session.slot_id) {
        await supabase
          .from('parking_slots')
          .update({ status: 'available', current_session_id: null })
          .eq('slot_id', session.slot_id);
      }

      await supabase.from('notifications').insert({
        type: 'info',
        title: `Vehicle Exited: ${plateNumber}`,
        message: `Duration: ${durationHours}h — Amount: ₱${totalAmount.toFixed(2)} — Receipt: ${receiptNum}`,
      });

      console.log(`[ExitProcessor] Session completed for ${plateNumber}, ₱${totalAmount.toFixed(2)}`);

      return {
        plateNumber,
        confidence,
        sessionId: session.id,
        entryTime: session.entry_time,
        durationHours,
        totalAmount,
      };
    } catch (err) {
      console.error('[ExitProcessor] Process exit error:', err);
      return null;
    }
  }
}

// ============================================================
// 7. SLOT MONITOR PROCESSOR
// ============================================================

/**
 * SlotAOIConfig — Configuration for a single slot's AOI polygon.
 * Points are normalized 0-1 coordinates relative to the camera frame.
 */
export interface SlotAOIConfig {
  /** Human-readable slot identifier, e.g. "A1" */
  slotId: string;
  /** UUID primary key from the parking_slots table */
  dbId: string;
  /** Ordered polygon vertices as [x, y] pairs, normalized 0-1 */
  polygon: [number, number][];
}

/**
 * SlotDetectionResult — Result of occupancy analysis for a single slot.
 */
export interface SlotDetectionResult {
  slotId: string;
  dbId: string;
  occupied: boolean;
}

/**
 * isPointInPolygon — Ray casting algorithm to test if a 2D point
 * lies inside a polygon defined by an array of vertices.
 *
 * @param point — [x, y] coordinates of the test point
 * @param polygon — Array of [x, y] vertices defining the polygon
 * @returns true if the point is inside the polygon
 */
function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * doesBboxOverlapPolygon — Checks whether any part of a bounding box
 * overlaps with a polygon. Tests 5 points: center + 4 corners of the bbox.
 *
 * @param bbox — [x1, y1, x2, y2] in normalized 0-1 coordinates
 * @param polygon — polygon vertices in normalized 0-1 coordinates
 * @returns true if the bbox overlaps the polygon
 */
function doesBboxOverlapPolygon(
  bbox: [number, number, number, number],
  polygon: [number, number][],
  frameWidth: number,
  frameHeight: number
): boolean {
  // Convert bbox from pixel coords to normalized 0-1
  const nx1 = bbox[0] / frameWidth;
  const ny1 = bbox[1] / frameHeight;
  const nx2 = bbox[2] / frameWidth;
  const ny2 = bbox[3] / frameHeight;

  // Test centroid
  const cx: [number, number] = [(nx1 + nx2) / 2, (ny1 + ny2) / 2];
  if (isPointInPolygon(cx, polygon)) return true;

  // Test bottom-center (most reliable — wheels touch the ground)
  const bc: [number, number] = [(nx1 + nx2) / 2, ny2];
  if (isPointInPolygon(bc, polygon)) return true;

  // Test 4 corners
  const corners: [number, number][] = [
    [nx1, ny1], [nx2, ny1], [nx1, ny2], [nx2, ny2]
  ];
  for (const corner of corners) {
    if (isPointInPolygon(corner, polygon)) return true;
  }

  return false;
}

/**
 * SlotMonitorProcessor — Monitors parking slot occupancy using YOLO vehicle
 * detection and AOI polygon intersection.
 *
 * Workflow:
 * 1. Captures frames from a slot camera at a configurable interval
 * 2. Runs YOLO detection to find vehicles in the frame
 * 3. For each configured slot AOI polygon, checks if any vehicle bbox overlaps
 * 4. Debounces state changes to prevent flicker from momentary detection gaps
 * 5. Updates Supabase parking_slots status when occupancy changes are confirmed
 *
 * Uses the same CameraManager and YOLODetector infrastructure as the
 * EntranceProcessor and ExitProcessor.
 */
export class SlotMonitorProcessor {
  private cameraManager: CameraManager;
  private detector: YOLODetector;
  private slots: SlotAOIConfig[] = [];
  private intervalId: number | null = null;
  private _isProcessing = false;
  private _status: PipelineStatus = 'idle';
  private _detections: Detection[] = [];

  /**
   * Occupancy state tracker per slot.
   * `occupied` = current confirmed state.
   * `count` = consecutive frames confirming a pending change.
   */
  private occupancyState: Map<string, { occupied: boolean; count: number }> = new Map();

  /** Number of consecutive frames required to confirm a state change */
  private DEBOUNCE_FRAMES = 3;

  /** Interval between frame captures in milliseconds */
  private FRAME_INTERVAL_MS = 500;

  // Callbacks
  private statusCallbacks: ((status: PipelineStatus) => void)[] = [];
  private detectionCallbacks: ((detections: Detection[]) => void)[] = [];
  private slotChangeCallbacks: ((results: SlotDetectionResult[]) => void)[] = [];
  private frameCallbacks: (() => void)[] = [];

  constructor() {
    this.cameraManager = new CameraManager();
    this.detector = new YOLODetector();
  }

  // ---- Getters ----
  get status(): PipelineStatus { return this._status; }
  get detections(): Detection[] { return this._detections; }
  get isProcessing(): boolean { return this._isProcessing; }
  get camera(): CameraManager { return this.cameraManager; }

  // ---- Callback registration ----
  onStatusChange(cb: (status: PipelineStatus) => void): void { this.statusCallbacks.push(cb); }
  onDetections(cb: (detections: Detection[]) => void): void { this.detectionCallbacks.push(cb); }
  onSlotChange(cb: (results: SlotDetectionResult[]) => void): void { this.slotChangeCallbacks.push(cb); }
  onFrame(cb: () => void): void { this.frameCallbacks.push(cb); }

  private setStatus(status: PipelineStatus): void {
    this._status = status;
    this.statusCallbacks.forEach(cb => cb(status));
  }

  /**
   * initialize — Loads the YOLO model for vehicle detection.
   */
  async initialize(): Promise<void> {
    this.setStatus('loading');
    try {
      await this.detector.loadModel();
      this.setStatus('idle');
      console.log('[SlotMonitor] YOLO model loaded, ready to monitor');
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  /**
   * startCamera — Opens the camera stream and attaches to a video element.
   */
  async startCamera(deviceId: string, videoEl: HTMLVideoElement): Promise<void> {
    await this.cameraManager.startStream(deviceId, videoEl);
  }

  /**
   * setSlots — Updates the set of AOI polygons to monitor.
   * Can be called while processing is active.
   *
   * @param slots — Array of slot AOI configurations
   */
  setSlots(slots: SlotAOIConfig[]): void {
    this.slots = slots;

    // Initialize occupancy state for new slots, preserve existing state
    const existing = new Map(this.occupancyState);
    this.occupancyState.clear();
    for (const slot of slots) {
      const prev = existing.get(slot.dbId);
      this.occupancyState.set(slot.dbId, prev || { occupied: false, count: 0 });
    }
  }

  /**
   * startProcessing — Begins the periodic frame analysis loop.
   */
  startProcessing(): void {
    if (this.intervalId) return;
    this._isProcessing = true;
    this.setStatus('scanning');

    this.intervalId = window.setInterval(async () => {
      await this.processFrame();
    }, this.FRAME_INTERVAL_MS);
  }

  /**
   * stopProcessing — Stops the analysis loop but keeps camera alive.
   */
  stopProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isProcessing = false;
    this.setStatus('idle');
  }

  /**
   * stop — Full cleanup: stops processing, releases camera, disposes model.
   */
  async stop(): Promise<void> {
    this.stopProcessing();
    this.cameraManager.stopStream();
    this.detector.dispose();
    this._detections = [];
    this.occupancyState.clear();
  }

  /**
   * processFrame — Core frame analysis method.
   *
   * 1. Captures current video frame
   * 2. Runs YOLO vehicle detection
   * 3. Checks each slot polygon for vehicle overlap
   * 4. Debounces state changes
   * 5. Commits confirmed changes to Supabase
   */
  private async processFrame(): Promise<void> {
    if (!this.detector.isLoaded || !this.cameraManager.isActive) return;

    try {
      // Capture frame
      const frame = this.cameraManager.captureFrame();
      if (!frame) return;

      // Run YOLO detection
      const detections = await this.detector.detect(frame.imageData, 0.40, 0.45);
      this._detections = detections;
      this.detectionCallbacks.forEach(cb => cb(detections));

      // Get frame dimensions for coordinate normalization
      const frameWidth = frame.imageData.width;
      const frameHeight = frame.imageData.height;

      // Check slot occupancy for each configured AOI polygon
      const changes: SlotDetectionResult[] = [];

      for (const slot of this.slots) {
        if (slot.polygon.length < 3) continue;

        // Check if any vehicle detection overlaps this slot's polygon
        const vehicleDetections = detections.filter(d => d.vehicleType !== null);
        const isOccupiedNow = vehicleDetections.some(det =>
          doesBboxOverlapPolygon(det.bbox, slot.polygon, frameWidth, frameHeight)
        );

        // Debounce logic
        const state = this.occupancyState.get(slot.dbId);
        if (!state) continue;

        if (isOccupiedNow !== state.occupied) {
          // State is different from confirmed — increment counter
          state.count++;
          if (state.count >= this.DEBOUNCE_FRAMES) {
            // Confirmed state change!
            state.occupied = isOccupiedNow;
            state.count = 0;
            changes.push({
              slotId: slot.slotId,
              dbId: slot.dbId,
              occupied: isOccupiedNow,
            });
          }
        } else {
          // State matches confirmed — reset counter
          state.count = 0;
        }
      }

      // Commit confirmed changes to Supabase
      if (changes.length > 0) {
        await this.updateSlotStatuses(changes);
        this.slotChangeCallbacks.forEach(cb => cb(changes));
      }

      // Notify frame callbacks for overlay redraw
      this.frameCallbacks.forEach(cb => cb());
    } catch (err) {
      console.error('[SlotMonitor] Frame processing error:', err);
    }
  }

  /**
   * updateSlotStatuses — Persists occupancy changes to Supabase.
   *
   * @param changes — Array of slot state changes to commit
   */
  private async updateSlotStatuses(changes: SlotDetectionResult[]): Promise<void> {
    for (const change of changes) {
      const newStatus = change.occupied ? 'occupied' : 'available';
      try {
        const { error } = await supabase
          .from('parking_slots')
          .update({ status: newStatus })
          .eq('id', change.dbId);

        if (error) {
          console.error(`[SlotMonitor] Failed to update ${change.slotId}:`, error.message);
        } else {
          console.log(`[SlotMonitor] ${change.slotId} → ${newStatus}`);
        }
      } catch (err) {
        console.error(`[SlotMonitor] Error updating ${change.slotId}:`, err);
      }
    }

    // Fire notification for occupancy changes
    const occupiedChanges = changes.filter(c => c.occupied);
    const availableChanges = changes.filter(c => !c.occupied);

    if (occupiedChanges.length > 0) {
      await supabase.from('notifications').insert({
        type: 'info',
        title: `Vehicle detected in slot${occupiedChanges.length > 1 ? 's' : ''}: ${occupiedChanges.map(c => c.slotId).join(', ')}`,
        message: `Slot${occupiedChanges.length > 1 ? 's' : ''} marked as occupied by vision monitoring.`,
      }).then(() => {});
    }

    if (availableChanges.length > 0) {
      await supabase.from('notifications').insert({
        type: 'success',
        title: `Slot${availableChanges.length > 1 ? 's' : ''} freed: ${availableChanges.map(c => c.slotId).join(', ')}`,
        message: `Slot${availableChanges.length > 1 ? 's' : ''} marked as available by vision monitoring.`,
      }).then(() => {});
    }
  }
}
