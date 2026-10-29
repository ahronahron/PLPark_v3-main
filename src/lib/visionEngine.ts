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
import { logActivity, supabase } from '@/lib/supabase';
import { settleRegisteredSessionWallet } from '@/lib/wallet';
import { calculateBillableHours, calculateParkingFee } from '@/lib/parkingFees';

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

// ============================================================
// SNAPSHOT & TRIGGER CONFIGURATION (Single place for tunable values)
// ============================================================
export const SNAPSHOT_CONFIG = {
  /** When true, prints per-tick and detailed debug logs. When false, only logs event summary. (default: false) */
  DEBUG: false,
  /** Minimum plate detector confidence to trigger capture immediately (default: 0.5) */
  CAPTURE_MIN_DET_CONF: 0.5,
  /** Minimum detected plate box width in source pixels to trigger capture (default: 80) */
  CAPTURE_MIN_PLATE_WIDTH_PX: 80,
  /** Hard limit timeout for individual OCR HTTP request (default: 3000ms) */
  READ_TIMEOUT_MS: 3000,
  /** OCR confidence threshold to accept immediately (default: 70) */
  ACCEPT_CONF: 70,
  /** Maximum automatic retake attempts with progressive crop widening (default: 3) */
  MAX_RETRIES: 3,
  /** Duration in milliseconds to show result on frozen image and in Dashboard card (default: 2500ms) */
  RESULT_DISPLAY_MS: 2500,
  /** Silence duration with no plate in sight required to re-arm capture (default: 1500ms) */
  REARM_NO_PLATE_MS: 1500,
  /** Lockout duration to ignore repeat triggers for the same plate (default: 15000ms) */
  LOCKOUT_MS: 15000,
  /** Maximum width in pixels of plate crop sent to OCR (default: 480) */
  OCR_IMAGE_MAX_WIDTH_PX: 480,
  /** EasyOCR health check timeout in milliseconds (default: 1000) */
  EASYOCR_HEALTH_TIMEOUT_MS: 1000,
  /** EasyOCR health check cache TTL in milliseconds (default: 10000ms) */
  EASYOCR_CACHE_TTL_MS: 10000,
  /** Timeout for ONNX Runtime session creation (default: 5000ms) */
  ORT_INIT_TIMEOUT_MS: 5000,
  /** Aliases and legacy helper compatibility values */
  MIN_PLATE_WIDTH_PX: 80,
  OCR_TIMEOUT_MS: 3000,
  DISPLAY_DURATION_MS: 2500,
  SCORE_IMAGE_WIDTH_PX: 480,
  MIN_BRIGHTNESS: 30,
  MIN_CONTRAST: 20,
  TOP_CROPS_COUNT: 3,
  TRIGGER_TICKS: 3,
  FAST_TRIGGER_MIN_SHARPNESS: 100,
  STEADY_MOVE_PCT: 0.04,
  STEADY_MIN_TIME_MS: 300,
  BURST_FRAMES: 6,
  BURST_TIMEOUT_MS: 1500,
  BURST_INTERVAL_MS: 70,
} as const;

/** Crop padding stages for progressive retries (horizontal: 18% -> 28% -> 38%, vertical: 25% -> 30% -> 35%) */
export const CROP_PADDING_STAGES = [
  { padX: 0.18, padY: 0.25 },
  { padX: 0.28, padY: 0.30 },
  { padX: 0.38, padY: 0.35 },
] as const;

/**
 * formatPlateForDisplay — Formats a raw plate string (e.g. "ABC1234", "DDD100")
 * with a space after the letters for UI presentation ("ABC 1234", "DDD 100").
 * Preserves the raw stored value unchanged.
 */
export function formatPlateForDisplay(plate: string): string {
  if (!plate) return '';
  const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // 3 letters followed by 3 or 4 digits: "ABC1234" -> "ABC 1234", "DDD100" -> "DDD 100"
  const m3 = clean.match(/^([A-Z]{3})([0-9]{3,4})$/);
  if (m3) return `${m3[1]} ${m3[2]}`;
  // 2 letters followed by 4 or 5 digits: "AB1234" -> "AB 1234"
  const m2 = clean.match(/^([A-Z]{2})([0-9]{4,5})$/);
  if (m2) return `${m2[1]} ${m2[2]}`;
  // General: any leading letters followed by digits: "A1234" -> "A 1234"
  const mGen = clean.match(/^([A-Z]+)([0-9]+)$/);
  if (mGen) return `${mGen[1]} ${mGen[2]}`;
  return plate;
}

/** Detailed OCR result returned from EasyOCR and Tesseract readers */
export interface OcrReadResult {
  plate: string;
  confidence: number;
  complete: boolean;
  reason: 'ok' | 'letters_only' | 'too_short' | 'no_pattern_match' | 'touches_edge' | string;
  parts?: string[];
}

/** YOLO input dimensions */
const MODEL_WIDTH = 640;
const MODEL_HEIGHT = 640;

/** Supabase Storage bucket name for snapshots */
const STORAGE_BUCKET = 'vehicle-snapshots';
const EASY_OCR_URL = import.meta.env.VITE_EASYOCR_URL || 'http://127.0.0.1:8765';

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

/** Data emitted when a frame is frozen for capture/reading */
export interface CapturedFrameData {
  fullFrameDataUrl: string;
  cropDataUrl: string;
  plateBbox: [number, number, number, number];
  frameWidth: number;
  frameHeight: number;
  attempt: number;
  isRetake?: boolean;
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
  /** Chosen captured image as data URL for instant dashboard display */
  capturedImage?: string;
  /** Full frame data URL */
  fullSnapshotImage?: string;
  /** Retake attempt count (1..MAX_RETRIES) */
  attempts?: number;
  /** Total time taken from trigger to OCR confirmation in milliseconds */
  timeTakenMs?: number;
  /** Whether the plate was unreadable after retakes */
  unreadable?: boolean;
  /** Whether the plate was incomplete (e.g. cut off, letters only, etc.) */
  incomplete?: boolean;
  /** Specific reason for incompleteness */
  reason?: string;
}

/** Result of the exit processing pipeline */
export interface ExitResult {
  plateNumber: string;
  confidence: number;
  sessionId: string;
  entryTime: string;
  durationHours: number;
  totalAmount: number;
  snapshotUrl?: string;
  plateSnapshotUrl?: string;
  /** Chosen captured image as data URL for instant dashboard display */
  capturedImage?: string;
  /** Full frame data URL */
  fullSnapshotImage?: string;
  /** Retake attempt count (1..MAX_RETRIES) */
  attempts?: number;
  /** Total time taken from trigger to OCR confirmation in milliseconds */
  timeTakenMs?: number;
  /** Whether the plate was unreadable after retakes */
  unreadable?: boolean;
  /** Whether the plate was incomplete (e.g. cut off, letters only, etc.) */
  incomplete?: boolean;
  /** Specific reason for incompleteness */
  reason?: string;
}

/** Camera device info */
export interface CameraDevice {
  deviceId: string;
  label: string;
}

/** Pipeline status for UI feedback representing the state machine */
export type PipelineStatus =
  | 'idle'
  | 'loading'
  | 'scanning'
  | 'detected'
  | 'captured'
  | 'reading'
  | 'reading_plate'
  | 'result'
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
        ? { deviceId: { exact: deviceId }, facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = this.stream;
    videoEl.muted = true;
    await videoEl.play();
    this.videoElement = videoEl;
    const track = this.stream.getVideoTracks()[0];
    const capabilities = track?.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; exposureMode?: string[] };
    const advanced: MediaTrackConstraintSet & { focusMode?: string; exposureMode?: string } = {};
    if (capabilities?.focusMode?.includes('continuous')) advanced.focusMode = 'continuous';
    if (capabilities?.exposureMode?.includes('continuous')) advanced.exposureMode = 'continuous';
    if (Object.keys(advanced).length > 0) await track.applyConstraints({ advanced: [advanced] });
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
/**
 * Creates an ONNX Runtime InferenceSession configurable via VITE_ORT_PROVIDER (default "wasm").
 * Tries "webgpu" only when set to "webgpu", wraps session creation in a 5-second timeout (Promise.race),
 * and falls back to "wasm" on timeout or error.
 */
async function createInferenceSessionWithFallback(
  modelBuffer: ArrayBuffer,
  modelName: string
): Promise<{ session: ort.InferenceSession; provider: string }> {
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
  const configuredProvider = (import.meta.env.VITE_ORT_PROVIDER || 'wasm').toLowerCase().trim();

  const createWithTimeout = async (
    provider: 'webgpu' | 'wasm',
    timeoutMs = SNAPSHOT_CONFIG.ORT_INIT_TIMEOUT_MS
  ): Promise<ort.InferenceSession> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${provider} session creation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const sessionPromise = ort.InferenceSession.create(modelBuffer, {
      executionProviders: [provider],
      graphOptimizationLevel: 'all',
    });

    try {
      const session = await Promise.race([sessionPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);
      return session;
    } catch (err) {
      if (timer) clearTimeout(timer);
      throw err;
    }
  };

  // Only try webgpu if explicitly configured to 'webgpu'
  if (configuredProvider === 'webgpu') {
    if (typeof navigator !== 'undefined' && (navigator as any).gpu) {
      try {
        const session = await createWithTimeout('webgpu', SNAPSHOT_CONFIG.ORT_INIT_TIMEOUT_MS);
        console.log(`[Snapshot] ${modelName}: using execution provider 'webgpu'`);
        return { session, provider: 'webgpu' };
      } catch (gpuErr) {
        console.warn(`[Snapshot] ${modelName}: WebGPU provider failed or timed out (${SNAPSHOT_CONFIG.ORT_INIT_TIMEOUT_MS}ms), falling back to 'wasm':`, gpuErr);
      }
    } else {
      console.log(`[Snapshot] ${modelName}: WebGPU not available in browser, falling back to 'wasm'`);
    }
  }

  // Fallback or default to 'wasm'
  try {
    const session = await createWithTimeout('wasm', SNAPSHOT_CONFIG.ORT_INIT_TIMEOUT_MS);
    console.log(`[Snapshot] ${modelName}: using execution provider 'wasm'`);
    return { session, provider: 'wasm' };
  } catch (wasmTimeoutErr) {
    console.warn(`[Snapshot] ${modelName}: wasm create timed out or errored, attempting standard create:`, wasmTimeoutErr);
    const session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    console.log(`[Snapshot] ${modelName}: using execution provider 'wasm'`);
    return { session, provider: 'wasm' };
  }
}

export class YOLODetector {
  private session: ort.InferenceSession | null = null;
  private _isLoaded = false;
  private provider = 'wasm';

  /** Whether the model has been loaded successfully */
  get isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * loadModel — Uses the Python YOLO service when configured, otherwise falls
   * back to the browser ONNX detector trying 'webgpu' first, then 'wasm'.
   */
  async loadModel(modelPath = '/models/yolov8n.onnx'): Promise<void> {
    const pythonUrl = import.meta.env.VITE_SLOT_MONITOR_URL || '';

    if (pythonUrl) {
      this._isLoaded = true;
      console.log('[YOLODetector] Using Python YOLO service at', pythonUrl);
      return;
    }

    try {
      const response = await fetch(modelPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
      }
      const modelBuffer = await response.arrayBuffer();

      const { session, provider } = await createInferenceSessionWithFallback(modelBuffer, 'YOLODetector');
      this.session = session;
      this.provider = provider;
      this._isLoaded = true;
      console.log(`[YOLODetector] Model loaded successfully (${provider})`);
    } catch (err) {
      console.error('[YOLODetector] Failed to load model:', err);
      throw err;
    }
  }

  /**
   * detect — Runs YOLO inference on an image frame.
   *
   * Prefer the real-time Python YOLO service when configured because it gives
   * more reliable object detection than the browser-side ONNX model.
   */
  async detect(
    imageData: ImageData,
    confThreshold = 0.45,
    iouThreshold = 0.5
  ): Promise<Detection[]> {
    const pythonUrl = import.meta.env.VITE_SLOT_MONITOR_URL || '';
    if (pythonUrl) {
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      ctx.putImageData(imageData, 0, 0);
      const encoded = canvas.toDataURL('image/jpeg', 0.85);

      const response = await fetch(`${pythonUrl}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: encoded, conf: Math.max(0.1, confThreshold), iou: iouThreshold }),
      });

      if (!response.ok) {
        console.error('[YOLODetector] Python YOLO service failed:', response.status, response.statusText);
        return [];
      }

      const json = await response.json();
      const detections = (json.detections || []) as Array<{
        class_id: number;
        class_name: string;
        confidence: number;
        bbox: [number, number, number, number];
      }>;

      return detections
        .filter(det => {
          const name = det.class_name?.toLowerCase?.() ?? '';
          return ['car', 'truck', 'bus', 'motorcycle', 'van', 'bicycle', 'person', 'train', 'boat'].includes(name);
        })
        .map(det => ({
          classId: det.class_id,
          className: det.class_name,
          confidence: det.confidence,
          bbox: det.bbox,
          vehicleType: ['car', 'truck', 'bus', 'motorcycle', 'van'].includes(det.class_name.toLowerCase())
            ? (det.class_name.toLowerCase() === 'motorcycle' ? 'motorcycle' : 'car')
            : null,
          color: null,
        }));
    }

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
  private provider = 'wasm';
  public lastInferenceMs = 0;

  get isLoaded(): boolean { return this._isLoaded; }
  get executionProvider(): string { return this.provider; }

  async loadModel(modelPath = '/models/license_plate_detector.onnx'): Promise<void> {
    const response = await fetch(modelPath);
    if (!response.ok) throw new Error(`Plate detector unavailable: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const { session, provider } = await createInferenceSessionWithFallback(buffer, 'PlateDetector');
    this.session = session;
    this.provider = provider;
    this._isLoaded = true;
  }

  async detect(imageData: ImageData, threshold = 0.30): Promise<PlateDetection[]> {
    if (!this.session) return [];
    const t0 = performance.now();
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
    this.lastInferenceMs = Math.round(performance.now() - t0);
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

/** Crop and normalize an exact plate detector box for OCR. Supports configurable padding percentages. */
function cropDetectedPlate(
  sourceCanvas: HTMLCanvasElement,
  bbox: [number, number, number, number],
  padXPct: number = 0.18,
  padYPct: number = 0.25
): HTMLCanvasElement | null {
  const [rawX1, rawY1, rawX2, rawY2] = bbox.map(Math.round);
  const paddingX = Math.round((rawX2 - rawX1) * padXPct);
  const paddingY = Math.round((rawY2 - rawY1) * padYPct);
  const x1 = Math.max(0, rawX1 - paddingX);
  const y1 = Math.max(0, rawY1 - paddingY);
  const x2 = Math.min(sourceCanvas.width, rawX2 + paddingX);
  const y2 = Math.min(sourceCanvas.height, rawY2 + paddingY);
  const width = x2 - x1;
  const height = y2 - y1;
  if (width < 25 || height < 10) return null;
  const canvas = document.createElement('canvas');
  const scale = 4;
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
    const enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.8 + 128));
    image.data[i] = enhanced;
    image.data[i + 1] = enhanced;
    image.data[i + 2] = enhanced;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function createOcrVariants(source: HTMLCanvasElement): HTMLCanvasElement[] {
  const variants = [source];
  const thresholdCanvas = document.createElement('canvas');
  thresholdCanvas.width = source.width;
  thresholdCanvas.height = source.height;
  const context = thresholdCanvas.getContext('2d');
  if (!context) return variants;
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, thresholdCanvas.width, thresholdCanvas.height);
  let total = 0;
  for (let i = 0; i < image.data.length; i += 4) total += image.data[i];
  const threshold = total / (image.data.length / 4);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = image.data[i] >= threshold ? 255 : 0;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
  variants.push(thresholdCanvas);
  return variants;
}

// ============================================================
// IMAGE QUALITY METRICS & TRIGGER TRACKING
// ============================================================

/**
 * Calculates sharpness (variance of the discrete Laplacian), brightness (mean intensity),
 * and contrast (standard deviation of intensity) for an image crop.
 */
export function computeImageMetrics(canvas: HTMLCanvasElement): { sharpness: number; brightness: number; contrast: number } {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { sharpness: 0, brightness: 0, contrast: 0 };
  const width = canvas.width;
  const height = canvas.height;
  if (width < 3 || height < 3) return { sharpness: 0, brightness: 0, contrast: 0 };

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const totalPixels = width * height;
  const gray = new Float32Array(totalPixels);
  let sumIntensity = 0;
  let sumSqIntensity = 0;

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const val = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[j] = val;
    sumIntensity += val;
    sumSqIntensity += val * val;
  }

  const brightness = sumIntensity / totalPixels;
  const varianceContrast = Math.max(0, (sumSqIntensity / totalPixels) - (brightness * brightness));
  const contrast = Math.sqrt(varianceContrast);

  // Discrete Laplacian kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
  let lapSum = 0;
  let lapSqSum = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const rowAbove = (y - 1) * width;
    const rowBelow = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const center = gray[rowOffset + x];
      const lap = gray[rowOffset + x + 1] +
                  gray[rowOffset + x - 1] +
                  gray[rowBelow + x] +
                  gray[rowAbove + x] -
                  4 * center;
      lapSum += lap;
      lapSqSum += lap * lap;
      count++;
    }
  }

  const meanLap = count > 0 ? lapSum / count : 0;
  const sharpness = count > 0 ? Math.max(0, (lapSqSum / count) - (meanLap * meanLap)) : 0;

  return { sharpness, brightness, contrast };
}

/**
 * Downscales an image canvas to ~320px width for cheap metric scoring.
 * Sharpness and brightness are NEVER computed on the full-resolution crop.
 */
export function downscaleForScoring(
  canvas: HTMLCanvasElement,
  targetWidth = SNAPSHOT_CONFIG.SCORE_IMAGE_WIDTH_PX
): HTMLCanvasElement {
  if (canvas.width <= targetWidth) return canvas;
  const scale = targetWidth / canvas.width;
  const small = document.createElement('canvas');
  small.width = targetWidth;
  small.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = small.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return small;
}

/**
 * Resizes a crop canvas so its width is at most maxWidth (default: 480px) before sending to OCR.
 */
export function resizeForOcr(
  canvas: HTMLCanvasElement,
  maxWidth = SNAPSHOT_CONFIG.OCR_IMAGE_MAX_WIDTH_PX
): HTMLCanvasElement {
  if (canvas.width <= maxWidth) return canvas;
  const scale = maxWidth / canvas.width;
  const resized = document.createElement('canvas');
  resized.width = maxWidth;
  resized.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = resized.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(canvas, 0, 0, resized.width, resized.height);
  return resized;
}

export interface ScoredCropCandidate {
  fullCanvas: HTMLCanvasElement;
  cropCanvas: HTMLCanvasElement;
  sharpness: number;
  brightness: number;
  contrast: number;
}

/**
 * Rates each crop by sharpness (variance of Laplacian) and discards any with
 * very low brightness or contrast. Returns the top candidates sorted by sharpness.
 * Sharpness and brightness are computed ONLY on a downscaled ~320px copy.
 */
export function scoreAndFilterCrops(
  candidates: { fullCanvas: HTMLCanvasElement; cropCanvas: HTMLCanvasElement }[]
): ScoredCropCandidate[] {
  const scored: ScoredCropCandidate[] = candidates.map(c => {
    // CHEAP SCORING: compute metrics on downscaled 320px copy
    const downscaled = downscaleForScoring(c.cropCanvas);
    const metrics = computeImageMetrics(downscaled);
    return {
      fullCanvas: c.fullCanvas,
      cropCanvas: c.cropCanvas,
      sharpness: metrics.sharpness,
      brightness: metrics.brightness,
      contrast: metrics.contrast,
    };
  });

  const scoresReport = scored
    .map((c, i) => `#${i + 1}: sharp=${c.sharpness.toFixed(1)}, bright=${c.brightness.toFixed(0)}, cont=${c.contrast.toFixed(0)}`)
    .join(' | ');
  if (SNAPSHOT_CONFIG.DEBUG) {
    console.log(`[Snapshot] SCORES (sharpness per crop): ${scoresReport}`);
  }

  // Discard crops with low brightness or low contrast
  const valid = scored.filter(c =>
    c.brightness >= SNAPSHOT_CONFIG.MIN_BRIGHTNESS &&
    c.contrast >= SNAPSHOT_CONFIG.MIN_CONTRAST
  );

  // If all were discarded, fallback to all scored crops so we don't drop everything
  const pool = valid.length > 0 ? valid : scored;
  pool.sort((a, b) => b.sharpness - a.sharpness);

  return pool.slice(0, SNAPSHOT_CONFIG.TOP_CROPS_COUNT);
}

/**
 * EasyOcrHealthManager — Checks reachability of EasyOCR service with a 1s timeout.
 * If unreachable, logs a warning once, notifies UI subscribers to show badge,
 * and causes executeTriggeredSnapshot to use single-crop Tesseract fallback.
 */
class EasyOcrHealthManager {
  private _isOnline: boolean | null = null;
  private _checkPromise: Promise<boolean> | null = null;
  private _warned = false;
  private _lastCheckedTimestamp = 0;
  private listeners: ((online: boolean) => void)[] = [];

  subscribe(cb: (online: boolean) => void): () => void {
    this.listeners.push(cb);
    if (this._isOnline !== null) {
      cb(this._isOnline);
    }
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  get isOnline(): boolean {
    return this._isOnline ?? true;
  }

  async checkReachability(force = false): Promise<boolean> {
    const now = Date.now();
    // Cache for 10 seconds: reuse cached state unless forced or TTL expired
    if (!force && this._isOnline !== null && (now - this._lastCheckedTimestamp < SNAPSHOT_CONFIG.EASYOCR_CACHE_TTL_MS)) {
      return this._isOnline;
    }

    if (this._checkPromise) return this._checkPromise;

    this._checkPromise = (async () => {
      const url = import.meta.env.VITE_EASYOCR_URL || 'http://127.0.0.1:8765';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SNAPSHOT_CONFIG.EASYOCR_HEALTH_TIMEOUT_MS);
      try {
        const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timer);
        const online = res.ok;
        this._lastCheckedTimestamp = Date.now();
        this.setOnline(online);
        return online;
      } catch {
        clearTimeout(timer);
        this._lastCheckedTimestamp = Date.now();
        this.setOnline(false);
        return false;
      } finally {
        this._checkPromise = null;
      }
    })();

    return this._checkPromise;
  }

  private setOnline(online: boolean): void {
    const changed = this._isOnline !== online;
    this._isOnline = online;
    if (!online && !this._warned) {
      console.warn('[Snapshot] EasyOCR service unreachable (1s timeout). Using slower Tesseract fallback without retries.');
      this._warned = true;
    }
    if (changed) {
      this.listeners.forEach(cb => cb(online));
    }
  }
}

export const easyOcrHealth = new EasyOcrHealthManager();

interface PlateHistoryEntry {
  bbox: [number, number, number, number];
  timestamp: number;
  width: number;
  cx: number;
  cy: number;
}

/**
 * Tracks detected plate box across ticks using elapsed time (TRIGGER_TICKS = 2, elapsed >= 200ms).
 * Includes fast trigger (width >= 2x MIN_PLATE_WIDTH_PX and sharp enough fires on 1st tick).
 */
export class PlateTriggerTracker {
  private history: PlateHistoryEntry[] = [];

  reset(): void {
    this.history = [];
  }

  get steadyCount(): number {
    return this.history.length;
  }

  update(
    plateBbox: [number, number, number, number] | null,
    frameCanvas: HTMLCanvasElement
  ): boolean {
    const now = performance.now();

    if (!plateBbox) {
      if (this.history.length > 0 && SNAPSHOT_CONFIG.DEBUG) {
        console.log(`[Snapshot] Tick: plate found=false, width=none, steady count=0/${SNAPSHOT_CONFIG.TRIGGER_TICKS}`);
      }
      this.history = [];
      return false;
    }

    const [x1, y1, x2, y2] = plateBbox;
    const width = x2 - x1;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    // Minimum plate box width requirement
    if (width < SNAPSHOT_CONFIG.MIN_PLATE_WIDTH_PX) {
      if (SNAPSHOT_CONFIG.DEBUG) {
        console.log(`[Snapshot] Tick: plate found=true, width=${Math.round(width)}px (<${SNAPSHOT_CONFIG.MIN_PLATE_WIDTH_PX}px), steady count=0/${SNAPSHOT_CONFIG.TRIGGER_TICKS}`);
      }
      this.history = [];
      return false;
    }

    // 1. FAST TRIGGER: if plate box is wider than 2x MIN_PLATE_WIDTH_PX (160px) and sharp enough, trigger on first tick!
    if (width >= 2 * SNAPSHOT_CONFIG.MIN_PLATE_WIDTH_PX) {
      const crop = cropDetectedPlate(frameCanvas, plateBbox);
      if (crop) {
        const smallCrop = downscaleForScoring(crop);
        const { sharpness } = computeImageMetrics(smallCrop);
        if (sharpness >= SNAPSHOT_CONFIG.FAST_TRIGGER_MIN_SHARPNESS) {
          if (SNAPSHOT_CONFIG.DEBUG) {
            console.log(`[Snapshot] Tick: plate found=true, width=${Math.round(width)}px, steady count=1/${SNAPSHOT_CONFIG.TRIGGER_TICKS}`);
          }
          console.log(`[Snapshot] TRIGGER fired (FAST TRIGGER): width=${Math.round(width)}px >= ${2 * SNAPSHOT_CONFIG.MIN_PLATE_WIDTH_PX}px, sharpness=${sharpness.toFixed(1)} >= ${SNAPSHOT_CONFIG.FAST_TRIGGER_MIN_SHARPNESS}`);
          this.history = [{ bbox: plateBbox, timestamp: now, width, cx, cy }];
          return true;
        }
      }
    }

    // 2. STEADY TRIGGER: check elapsed time and movement across consecutive ticks
    const maxMovePx = SNAPSHOT_CONFIG.STEADY_MOVE_PCT * frameCanvas.width;

    if (this.history.length > 0) {
      const prev = this.history[this.history.length - 1];
      const dist = Math.hypot(cx - prev.cx, cy - prev.cy);
      if (dist >= maxMovePx) {
        this.history = [{ bbox: plateBbox, timestamp: now, width, cx, cy }];
        if (SNAPSHOT_CONFIG.DEBUG) {
          console.log(`[Snapshot] Tick: plate found=true, width=${Math.round(width)}px, steady count=1/${SNAPSHOT_CONFIG.TRIGGER_TICKS} (moved ${dist.toFixed(1)}px >= ${maxMovePx.toFixed(1)}px)`);
        }
        return false;
      }
    }

    this.history.push({ bbox: plateBbox, timestamp: now, width, cx, cy });
    if (this.history.length > SNAPSHOT_CONFIG.TRIGGER_TICKS) {
      this.history.shift();
    }

    const count = this.history.length;
    if (SNAPSHOT_CONFIG.DEBUG) {
      console.log(`[Snapshot] Tick: plate found=true, width=${Math.round(width)}px, steady count=${count}/${SNAPSHOT_CONFIG.TRIGGER_TICKS}`);
    }

    if (count >= SNAPSHOT_CONFIG.TRIGGER_TICKS) {
      const elapsedMs = now - this.history[0].timestamp;
      if (elapsedMs >= SNAPSHOT_CONFIG.STEADY_MIN_TIME_MS) {
        console.log(`[Snapshot] TRIGGER fired: steady for ${Math.round(elapsedMs)}ms across ${count} ticks (width=${Math.round(width)}px)`);
        return true;
      }
    }

    return false;
  }

  getTriggerBox(): [number, number, number, number] | null {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1].bbox;
  }
}

export interface SnapshotReadResult {
  chosenCandidate: ScoredCropCandidate;
  plate: string;
  confidence: number;
  accepted: boolean;
  attempts: number;
  timeTakenMs: number;
  ocrRequestsCount: number;
}

/**
 * Executes trigger-based burst capture, Laplacian scoring, and OCR recognition.
 * Burst captured first, scored after on ~320px copy.
 * Crops sent to OCR resized to <= 480px.
 * If EasyOCR unreachable, uses single best crop on Tesseract with no retries.
 */
export async function executeTriggeredSnapshot(
  cameraManager: CameraManager,
  plateReader: PlateReader,
  triggerBox: [number, number, number, number],
  registeredPlatesCache: string[]
): Promise<SnapshotReadResult | null> {
  const pipelineStartTime = performance.now();
  let totalOcrRequests = 0;

  // 0. Check EasyOCR reachability with 1s timeout before reading
  const isEasyOcrOnline = await easyOcrHealth.checkReachability();

  let attempt = 0;
  let bestFallback: {
    candidate: ScoredCropCandidate;
    plate: string;
    confidence: number;
    attempts: number;
  } | null = null;

  const maxAttempts = isEasyOcrOnline ? SNAPSHOT_CONFIG.MAX_RETRIES : 1;

  while (attempt < maxAttempts) {
    attempt++;

    // 1. BURST: capture BURST_FRAMES full-resolution frames ~70ms apart
    const t0Capture = performance.now();
    const burstCandidates: { fullCanvas: HTMLCanvasElement; cropCanvas: HTMLCanvasElement }[] = [];

    for (let i = 0; i < SNAPSHOT_CONFIG.BURST_FRAMES; i++) {
      if (performance.now() - t0Capture > SNAPSHOT_CONFIG.BURST_TIMEOUT_MS) {
        if (SNAPSHOT_CONFIG.DEBUG) {
          console.warn(`[Snapshot] Burst capture hit ${SNAPSHOT_CONFIG.BURST_TIMEOUT_MS}ms timeout (${burstCandidates.length} frames)`);
        }
        break;
      }
      const cap = cameraManager.captureFrame();
      if (cap) {
        const crop = cropDetectedPlate(cap.canvas, triggerBox);
        if (crop) {
          burstCandidates.push({ fullCanvas: cap.canvas, cropCanvas: crop });
        }
      }
      if (i < SNAPSHOT_CONFIG.BURST_FRAMES - 1) {
        if (performance.now() - t0Capture + SNAPSHOT_CONFIG.BURST_INTERVAL_MS > SNAPSHOT_CONFIG.BURST_TIMEOUT_MS) {
          break;
        }
        await new Promise(r => setTimeout(r, SNAPSHOT_CONFIG.BURST_INTERVAL_MS));
      }
    }
    const burstMs = Math.round(performance.now() - t0Capture);
    console.log(`[Snapshot] BURST captured (${burstCandidates.length} frames, ${burstMs}ms)`);

    if (burstCandidates.length === 0) {
      console.warn('[Snapshot] No valid burst frames captured on attempt', attempt);
      continue;
    }

    // 2. SCORE: rate each crop by variance of the Laplacian (sharpness) on downscaled ~320px copy
    const topCrops = scoreAndFilterCrops(burstCandidates);
    if (topCrops.length === 0) {
      console.warn('[Snapshot] No scored crops passed quality filtering on attempt', attempt);
      continue;
    }

    // 3. READ:
    // If EasyOCR offline: use Tesseract on single best crop only (no retries)
    if (!isEasyOcrOnline) {
      const top1 = topCrops[0];
      const ocrCrop1 = resizeForOcr(top1.cropCanvas);
      totalOcrRequests++;
      console.log(`[Snapshot] OCR request sent: crop #1 (${ocrCrop1.width}x${ocrCrop1.height}) via Tesseract`);

      const t0Ocr = performance.now();
      const res1 = await plateReader.readWithTesseract(ocrCrop1, registeredPlatesCache);
      const ocrMs = Math.round(performance.now() - t0Ocr);
      console.log(`[Snapshot] OCR result: text="${res1?.plate || ''}", confidence=${res1?.confidence || 0}%, ms=${ocrMs}ms`);

      const totalElapsed = Math.round(performance.now() - pipelineStartTime);
      if (res1 && res1.confidence >= SNAPSHOT_CONFIG.ACCEPT_CONF) {
        console.log(`[Snapshot] ACCEPT: "${res1.plate}" (confidence: ${res1.confidence}%) on attempt 1`);
        return {
          chosenCandidate: top1,
          plate: res1.plate,
          confidence: res1.confidence,
          accepted: true,
          attempts: 1,
          timeTakenMs: totalElapsed,
          ocrRequestsCount: totalOcrRequests,
        };
      }

      console.log(`[Snapshot] MANUAL REVIEW: plate unconfirmed via Tesseract fallback: "${res1?.plate || 'none'}" (${res1?.confidence || 0}%)`);
      return {
        chosenCandidate: top1,
        plate: res1?.plate || '',
        confidence: res1?.confidence || 0,
        accepted: false,
        attempts: 1,
        timeTakenMs: totalElapsed,
        ocrRequestsCount: totalOcrRequests,
      };
    }

    // EasyOCR is ONLINE: send crop resized to <= 480px
    const top1 = topCrops[0];
    const ocrCrop1 = resizeForOcr(top1.cropCanvas);
    totalOcrRequests++;
    console.log(`[Snapshot] OCR request sent: crop #1 (${ocrCrop1.width}x${ocrCrop1.height}) via EasyOCR`);

    const t0Ocr1 = performance.now();
    const res1 = await plateReader.confirmWithEasyOcr(ocrCrop1, registeredPlatesCache);
    const ocrMs1 = Math.round(performance.now() - t0Ocr1);
    console.log(`[Snapshot] OCR result: text="${res1?.plate || ''}", confidence=${res1?.confidence || 0}%, ms=${ocrMs1}ms`);

    if (res1 && res1.confidence >= SNAPSHOT_CONFIG.ACCEPT_CONF) {
      const totalElapsed = Math.round(performance.now() - pipelineStartTime);
      console.log(`[Snapshot] ACCEPT: "${res1.plate}" (confidence: ${res1.confidence}%) on attempt ${attempt}`);
      return {
        chosenCandidate: top1,
        plate: res1.plate,
        confidence: res1.confidence,
        accepted: true,
        attempts: attempt,
        timeTakenMs: totalElapsed,
        ocrRequestsCount: totalOcrRequests,
      };
    }

    if (res1 && (!bestFallback || res1.confidence > bestFallback.confidence)) {
      bestFallback = { candidate: top1, plate: res1.plate, confidence: res1.confidence, attempts: attempt };
    }

    // If top 1 wasn't accepted, try top 2 crop if available
    if (topCrops.length >= 2) {
      const top2 = topCrops[1];
      const ocrCrop2 = resizeForOcr(top2.cropCanvas);
      totalOcrRequests++;
      console.log(`[Snapshot] OCR request sent: crop #2 (${ocrCrop2.width}x${ocrCrop2.height}) via EasyOCR`);

      const t0Ocr2 = performance.now();
      const res2 = await plateReader.confirmWithEasyOcr(ocrCrop2, registeredPlatesCache);
      const ocrMs2 = Math.round(performance.now() - t0Ocr2);
      console.log(`[Snapshot] OCR result: text="${res2?.plate || ''}", confidence=${res2?.confidence || 0}%, ms=${ocrMs2}ms`);

      if (res2 && (!bestFallback || res2.confidence > bestFallback.confidence)) {
        bestFallback = { candidate: top2, plate: res2.plate, confidence: res2.confidence, attempts: attempt };
      }

      if (res1 && res2) {
        const norm1 = cleanAndFormatPlate(res1.plate, registeredPlatesCache).plate;
        const norm2 = cleanAndFormatPlate(res2.plate, registeredPlatesCache).plate;
        if (norm1 && norm2 && norm1 === norm2) {
          const totalElapsed = Math.round(performance.now() - pipelineStartTime);
          const chosenConf = Math.max(res1.confidence, res2.confidence);
          console.log(`[Snapshot] ACCEPT: "${norm1}" (matching top-1 & top-2 confidence: ${chosenConf}%) on attempt ${attempt}`);
          return {
            chosenCandidate: top1,
            plate: norm1,
            confidence: chosenConf,
            accepted: true,
            attempts: attempt,
            timeTakenMs: totalElapsed,
            ocrRequestsCount: totalOcrRequests,
          };
        }
      }
    }

    if (attempt < maxAttempts) {
      console.log(`[Snapshot] RETRY: low confidence (${res1?.confidence || 0}%), retrying burst (attempt ${attempt}/${maxAttempts})`);
    }
  }

  // All attempts exhausted
  const totalElapsed = Math.round(performance.now() - pipelineStartTime);
  console.log(`[Snapshot] MANUAL REVIEW: plate unconfirmed after ${attempt} attempt(s) (best candidate: "${bestFallback?.plate || 'none'}", ${bestFallback?.confidence || 0}%)`);

  if (bestFallback) {
    return {
      chosenCandidate: bestFallback.candidate,
      plate: bestFallback.plate,
      confidence: bestFallback.confidence,
      accepted: false,
      attempts: attempt,
      timeTakenMs: totalElapsed,
      ocrRequestsCount: totalOcrRequests,
    };
  }

  return null;
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

    if (EASY_OCR_URL && typeof imageSource !== 'string') {
      try {
        const easyResult = await this.confirmWithEasyOcr(imageSource, registeredPlates);
        if (easyResult) return easyResult;
      } catch (error) {
        console.warn('[PlateReader] EasyOCR service unavailable; using browser OCR fallback.', error);
      }
    }

    const variants = typeof imageSource === 'string' ? [imageSource] : createOcrVariants(imageSource);
    const firstResult = await this.worker.recognize(variants[0]);
    const first = cleanAndFormatPlate(firstResult.data.text, registeredPlates);
    const firstConfidence = Number(firstResult.data.confidence || 0) + first.confidenceBoost;
    let selected = first;
    let confidence = firstConfidence;

    // Only run the thresholded fallback for uncertain frames to keep normal reads fast.
    if (firstConfidence < 78 && variants[1]) {
      await this.worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD });
      const secondResult = await this.worker.recognize(variants[1]);
      await this.worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE });
      const second = cleanAndFormatPlate(secondResult.data.text, registeredPlates);
      const secondConfidence = Number(secondResult.data.confidence || 0) + second.confidenceBoost;
      selected = secondConfidence > firstConfidence ? second : first;
      confidence = Math.max(firstConfidence, secondConfidence);
    }
    confidence = Math.min(99, Math.round(confidence));
    const plate = selected.plate;

    if (plate.length < 3 || plate.length > 9) return null;
    return { plate, confidence: Math.max(40, confidence) };
  }

  /**
   * Reads a single plate crop using Tesseract.js (single pass, fast, no variants).
   */
  async readWithTesseract(
    imageSource: HTMLCanvasElement,
    registeredPlates: string[] = []
  ): Promise<OcrReadResult | null> {
    if (!this.worker) return null;
    try {
      const result = await this.worker.recognize(imageSource);
      const cleaned = cleanAndFormatPlate(result.data.text, registeredPlates);
      const rawConf = Number(result.data.confidence || 0);
      const confidence = Math.min(99, Math.max(40, Math.round(rawConf + cleaned.confidenceBoost)));
      const plate = cleaned.plate;
      if (plate.length < 3 || plate.length > 9) return null;
      const complete = plate.length >= 5 && /[A-Z]/.test(plate) && /[0-9]/.test(plate);
      let reason: OcrReadResult['reason'] = 'ok';
      if (plate.length < 5) reason = 'too_short';
      else if (!/[0-9]/.test(plate)) reason = 'letters_only';
      else if (!/[A-Z]/.test(plate)) reason = 'no_pattern_match';
      return { plate, confidence, complete, reason, parts: [plate] };
    } catch (err) {
      console.warn('[PlateReader] Tesseract read failed:', err);
      return null;
    }
  }

  async confirmWithEasyOcr(
    imageSource: HTMLCanvasElement,
    registeredPlates: string[]
  ): Promise<OcrReadResult | null> {
    const url = import.meta.env.VITE_EASYOCR_URL || 'http://127.0.0.1:8765';
    const image = imageSource.toDataURL('image/jpeg', 0.85);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SNAPSHOT_CONFIG.OCR_TIMEOUT_MS);
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/read-plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, registered_plates: registeredPlates }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return null;
      const result = await response.json() as {
        plate?: string;
        confidence?: number;
        complete?: boolean;
        reason?: string;
        parts?: string[];
      };
      if (!result.plate || result.plate.length < 3) return null;
      const plate = result.plate;
      const confidence = Math.max(40, Math.min(99, Math.round(result.confidence || 0)));
      const complete = result.complete ?? (plate.length >= 5 && /[A-Z]/.test(plate) && /[0-9]/.test(plate));
      const reason = result.reason ?? (complete ? 'ok' : (plate.length < 5 ? 'too_short' : (!/[0-9]/.test(plate) ? 'letters_only' : 'no_pattern_match')));
      const parts = result.parts ?? [plate];
      return { plate, confidence, complete, reason, parts };
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  /**
   * @deprecated Removed from live loops. Plate reads now occur exclusively via executeTriggeredSnapshot.
   */
  async confirmPlateAcrossFrames(
    getImage: () => HTMLCanvasElement | null,
    registeredPlates: string[] = [],
    sampleCount = SNAPSHOT_CONFIG.BURST_FRAMES
  ): Promise<{ plate: string; confidence: number } | null> {
    console.warn('[PlateReader] confirmPlateAcrossFrames is deprecated; live reads must not call this.');
    return null;
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

  private captureCallbacks: ((data: CapturedFrameData) => void)[] = [];
  private resumeCallbacks: (() => void)[] = [];

  private _isProcessing = false;
  private _isFrozen = false;
  private isArmed = true;
  private lastPlateSeenTime = 0;

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
  onCapture(cb: (data: CapturedFrameData) => void): () => void {
    this.captureCallbacks.push(cb);
    return () => { this.captureCallbacks = this.captureCallbacks.filter(c => c !== cb); };
  }
  onResume(cb: () => void): () => void {
    this.resumeCallbacks.push(cb);
    return () => { this.resumeCallbacks = this.resumeCallbacks.filter(c => c !== cb); };
  }
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
    this._isFrozen = false;
    this._isProcessing = false;
    this.isArmed = true;
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
   * runStreamFrame — Executes fast live video detection loop (~300ms).
   * 1. scanning: the live feed runs and only detection runs.
   * As soon as plate detector finds a plate with confidence >= CAPTURE_MIN_DET_CONF (0.5)
   * and width >= CAPTURE_MIN_PLATE_WIDTH_PX (80), captures ONE full-resolution frame immediately.
   */
  private async runStreamFrame(): Promise<void> {
    if (this._isFrozen || this._isProcessing) return;

    const frame = this.cameraManager.captureFrame();
    if (!frame) return;

    try {
      // 1. Plate detector runs first
      let plateDetections: PlateDetection[] = [];
      if (this.plateDetector.isLoaded) {
        plateDetections = await this.plateDetector.detect(frame.imageData, 0.25);
      }
      this._plateDetections = plateDetections;

      // 2. While waiting for a trigger, run vehicle detector only if no plate found
      let vehicleDetections: Detection[] = [];
      if (plateDetections.length === 0 && this.detector.isLoaded) {
        vehicleDetections = await this.detector.detect(frame.imageData, 0.25);
        this._detections = vehicleDetections;
      } else {
        vehicleDetections = this._detections;
      }

      // Notify UI for live detection overlay drawing
      this.detectionCallbacks.forEach(cb => cb(vehicleDetections));
      this.plateDetectionsCallbacks.forEach(cb => cb(plateDetections));
      this.frameCallbacks.forEach(cb => cb());

      const now = performance.now();
      const topPlate = plateDetections[0] || null;

      if (topPlate) {
        this.lastPlateSeenTime = now;
      } else {
        // Rearm when no plate has been seen for REARM_NO_PLATE_MS (1500ms)
        if (!this.isArmed && (now - this.lastPlateSeenTime >= SNAPSHOT_CONFIG.REARM_NO_PLATE_MS)) {
          this.isArmed = true;
          if (SNAPSHOT_CONFIG.DEBUG) {
            console.log(`[Snapshot] Entrance re-armed: no plate seen for ${SNAPSHOT_CONFIG.REARM_NO_PLATE_MS}ms`);
          }
        }
      }

      if (this._status === 'scanning' && (vehicleDetections.length > 0 || plateDetections.length > 0)) {
        this.setStatus('detected');
      } else if (this._status === 'detected' && vehicleDetections.length === 0 && plateDetections.length === 0) {
        this.setStatus('scanning');
      }

      // Check if re-armed and plate meets capture threshold
      if (!this.isArmed || !topPlate) {
        return;
      }

      const plateWidth = topPlate.bbox[2] - topPlate.bbox[0];
      if (
        topPlate.confidence >= SNAPSHOT_CONFIG.CAPTURE_MIN_DET_CONF &&
        plateWidth >= SNAPSHOT_CONFIG.CAPTURE_MIN_PLATE_WIDTH_PX
      ) {
        // Trigger capture immediately!
        await this.executeFreezeCaptureFlow(frame, topPlate.bbox, vehicleDetections);
      }
    } catch (err) {
      console.error('[EntranceProcessor] Stream error:', err);
    }
  }

  /**
   * executeFreezeCaptureFlow — Full "capture, freeze, read, show, resume" flow.
   * - 2. captured: freeze. Pause all detection. Show captured frame in camera panel with plate highlighted.
   * - 3. reading: run OCR once (resize <= 480px). If conf < 70 or text empty, retake once or twice.
   * - 4. result: show plate characters, confidence, and registered/guest for 2500ms. Save 1 image & 1 session.
   * - 5. resume: return to live feed and detection. Re-arm after 1500ms no plate seen.
   */
  private async executeFreezeCaptureFlow(
    initialFrame: { canvas: HTMLCanvasElement; imageData: ImageData },
    initialPlateBbox: [number, number, number, number],
    vehicleDetections: Detection[]
  ): Promise<void> {
    this._isFrozen = true;
    this._isProcessing = true;
    const pipelineStartTime = performance.now();
    let totalCaptureMs = 0;
    let totalOcrMs = 0;

    try {
      let currentFrame = initialFrame;
      let currentBbox = initialPlateBbox;
      const initialPadding = CROP_PADDING_STAGES[0];
      let currentCrop = cropDetectedPlate(currentFrame.canvas, currentBbox, initialPadding.padX, initialPadding.padY);
      let attempt = 0;
      let ocrResult: OcrReadResult | null = null;
      let isAccepted = false;

      const isEasyOcrOnline = await easyOcrHealth.checkReachability();

      while (attempt < SNAPSHOT_CONFIG.MAX_RETRIES) {
        attempt++;
        const paddingStage = CROP_PADDING_STAGES[Math.min(attempt - 1, CROP_PADDING_STAGES.length - 1)];
        const t0Capture = performance.now();

        if (attempt > 1) {
          // Status back to captured with a "Retaking..." label, using a new frame with widening crop padding
          this.setStatus('captured');
          const freshFrame = this.cameraManager.captureFrame();
          if (freshFrame) {
            currentFrame = freshFrame;
            if (this.plateDetector.isLoaded) {
              const freshDets = await this.plateDetector.detect(freshFrame.imageData, 0.25);
              if (freshDets.length > 0) {
                currentBbox = freshDets[0].bbox;
              }
            }
            const freshCrop = cropDetectedPlate(currentFrame.canvas, currentBbox, paddingStage.padX, paddingStage.padY);
            if (freshCrop) currentCrop = freshCrop;
          }
        }

        const captureMs = Math.round(performance.now() - t0Capture);
        totalCaptureMs += captureMs;

        // 2. captured: freeze. Pause all detection. Show captured frame in camera panel
        this.setStatus('captured');
        const fullFrameDataUrl = currentFrame.canvas.toDataURL('image/jpeg', 0.85);
        const cropDataUrl = (currentCrop || currentFrame.canvas).toDataURL('image/jpeg', 0.85);

        this.captureCallbacks.forEach(cb => cb({
          fullFrameDataUrl,
          cropDataUrl,
          plateBbox: currentBbox,
          frameWidth: currentFrame.canvas.width,
          frameHeight: currentFrame.canvas.height,
          attempt,
          isRetake: attempt > 1,
        }));

        // Allow UI to render shutter flash / captured freeze state
        await new Promise(r => setTimeout(r, attempt > 1 ? 250 : 180));

        // 3. reading: run OCR once on plate crop (resize to at most 480 px wide)
        this.setStatus('reading');
        const t0Ocr = performance.now();
        const ocrCrop = resizeForOcr(currentCrop || currentFrame.canvas);

        if (isEasyOcrOnline) {
          ocrResult = await this.plateReader.confirmWithEasyOcr(ocrCrop, this.registeredPlatesCache);
        } else {
          ocrResult = await this.plateReader.readWithTesseract(ocrCrop, this.registeredPlatesCache);
        }
        const ocrMs = Math.round(performance.now() - t0Ocr);
        totalOcrMs += ocrMs;

        // Log one line per read with: merged text, complete, reason, attempts
        console.log(`[Snapshot] read: text="${ocrResult?.plate || ''}", complete=${ocrResult?.complete ?? false}, reason="${ocrResult?.reason || 'none'}", attempts=${attempt}`);

        // Treat complete=false as a failed read: do not accept, do not create a session
        if (
          ocrResult &&
          ocrResult.plate &&
          ocrResult.plate.length >= 3 &&
          ocrResult.complete === true &&
          ocrResult.confidence >= SNAPSHOT_CONFIG.ACCEPT_CONF
        ) {
          isAccepted = true;
          break;
        }

        if (SNAPSHOT_CONFIG.DEBUG && attempt < SNAPSHOT_CONFIG.MAX_RETRIES) {
          console.log(`[Snapshot] Retrying entrance OCR (attempt ${attempt}/${SNAPSHOT_CONFIG.MAX_RETRIES}, reason=${ocrResult?.reason || 'failed'}, conf=${ocrResult?.confidence || 0}%)`);
        }
      }

      // 2. Short-form check: if accepted result is valid 3 letters + 3 digits plate with confidence below 90, do verification read from wider crop
      if (isAccepted && ocrResult) {
        const isShortForm = /^[A-Z]{3}[0-9]{3}$/.test(ocrResult.plate);
        if (isShortForm && ocrResult.confidence < 90) {
          if (SNAPSHOT_CONFIG.DEBUG) {
            console.log(`[Snapshot] Short-form plate "${ocrResult.plate}" (conf=${ocrResult.confidence}% < 90). Running wider verification read...`);
          }
          const wideCrop = cropDetectedPlate(currentFrame.canvas, currentBbox, 0.38, 0.35);
          if (wideCrop) {
            const wideOcrCrop = resizeForOcr(wideCrop);
            const verifyResult = isEasyOcrOnline
              ? await this.plateReader.confirmWithEasyOcr(wideOcrCrop, this.registeredPlatesCache)
              : await this.plateReader.readWithTesseract(wideOcrCrop, this.registeredPlatesCache);
            console.log(`[Snapshot] read: text="${verifyResult?.plate || ''}", complete=${verifyResult?.complete ?? false}, reason="${verifyResult?.reason || 'none'}", attempts=${attempt} (verify)`);
            if (
              verifyResult &&
              verifyResult.complete &&
              verifyResult.plate.length > ocrResult.plate.length &&
              verifyResult.plate.startsWith(ocrResult.plate.slice(0, 3))
            ) {
              if (SNAPSHOT_CONFIG.DEBUG) {
                console.log(`[Snapshot] Wider read upgraded short-form plate "${ocrResult.plate}" -> "${verifyResult.plate}" (conf=${verifyResult.confidence}%)`);
              }
              ocrResult = verifyResult;
              currentCrop = wideCrop;
            }
          }
        }
      }

      const totalPipelineMs = Math.round(performance.now() - pipelineStartTime);
      const plateNumber = ocrResult?.plate || '';
      const confidence = ocrResult?.confidence || 0;

      // Print single summary line per event
      console.log(`[Snapshot] summary: plate="${plateNumber || 'unreadable'}", confidence=${confidence}%, attempts=${attempt}, ms per stage (capture: ${totalCaptureMs}ms, OCR: ${totalOcrMs}ms, total: ${totalPipelineMs}ms)`);

      // Check lockout window
      if (isAccepted && this.lockedPlates.has(plateNumber)) {
        if (SNAPSHOT_CONFIG.DEBUG) {
          console.log(`[Snapshot] Plate "${plateNumber}" triggered within lockout window (${SNAPSHOT_CONFIG.LOCKOUT_MS}ms); ignoring.`);
        }
        return;
      }

      const topVehicle = vehicleDetections.find(d => d.vehicleType !== null) || null;
      const vehicleType: 'car' | 'motorcycle' = topVehicle?.vehicleType || 'car';
      const color = topVehicle?.color || 'White';

      const cropDataUrl = (currentCrop || currentFrame.canvas).toDataURL('image/jpeg', 0.85);
      const fullFrameDataUrl = currentFrame.canvas.toDataURL('image/jpeg', 0.85);

      if (isAccepted) {
        this.lockedPlates.add(plateNumber);
        setTimeout(() => {
          this.lockedPlates.delete(plateNumber);
        }, SNAPSHOT_CONFIG.LOCKOUT_MS);

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
          capturedImage: cropDataUrl,
          fullSnapshotImage: fullFrameDataUrl,
          attempts: attempt,
          timeTakenMs: totalPipelineMs,
        };

        // 4. result: show plate characters, confidence, registered/guest on frozen image
        this.setStatus('result');
        this._lastResult = result;
        this.resultCallbacks.forEach(cb => cb(result));

        // Keep a scan event even when an active session prevents another entry.
        const recognitionId = await this.recordPlateRecognition(result);
        if (await this.hasActiveSession(plateNumber)) {
          console.info(`[EntranceProcessor] Ignoring repeat entry scan for active vehicle ${plateNumber}`);
        } else {
          await this.saveEntranceRecord(currentFrame.canvas, currentCrop || currentFrame.canvas, result, recognitionId);
        }

        // Show for RESULT_DISPLAY_MS (2500ms)
        await new Promise(r => setTimeout(r, SNAPSHOT_CONFIG.RESULT_DISPLAY_MS));
      } else {
        // Fall back to manual-review flow with partial text prefilled and flagged "incomplete"
        const isIncomplete = ocrResult ? !ocrResult.complete : true;
        const partialPlate = ocrResult?.plate || '';
        const fallbackResult: EntranceResult = {
          plateNumber: partialPlate || 'UNREADABLE',
          vehicleType,
          color,
          confidence,
          snapshotUrl: '',
          plateSnapshotUrl: '',
          isPrivate: false,
          appUserId: null,
          capturedImage: cropDataUrl,
          fullSnapshotImage: fullFrameDataUrl,
          attempts: attempt,
          timeTakenMs: totalPipelineMs,
          unreadable: !partialPlate,
          incomplete: isIncomplete,
          reason: ocrResult?.reason || (partialPlate ? 'incomplete' : 'unreadable'),
        };

        this.setStatus('result');
        this._lastResult = fallbackResult;
        this.resultCallbacks.forEach(cb => cb(fallbackResult));

        await this.createManualReviewAlert(fallbackResult);

        // Show for RESULT_DISPLAY_MS (2500ms)
        await new Promise(r => setTimeout(r, SNAPSHOT_CONFIG.RESULT_DISPLAY_MS));
      }
    } catch (err) {
      console.error('[Snapshot] ERROR in entrance snapshot flow:', err);
    } finally {
      // 5. resume: return to live feed and detection
      this.setStatus('scanning');
      this._isFrozen = false;
      this._isProcessing = false;
      this.isArmed = false;
      this.lastPlateSeenTime = performance.now();
      this.resumeCallbacks.forEach(cb => cb());
    }
  }

  private async getVisitorEntryMode(): Promise<boolean> {
    try {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'visitor_entry_mode')
        .maybeSingle();

      const value = data?.value;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value.toLowerCase() === 'true';
      return false;
    } catch (err) {
      console.warn('[EntranceProcessor] Could not read visitor entry mode:', err);
      return false;
    }
  }

  private async createGuestReviewAlert(result: EntranceResult): Promise<void> {
    try {
      const imageUrl = result.plateSnapshotUrl || result.snapshotUrl || null;
      await supabase.from('notifications').insert({
        type: 'warning',
        title: `Guest Vehicle Requires Approval: ${result.plateNumber}`,
        message: `Vehicle ${result.plateNumber} is not registered in the system and Automatic Entry mode is currently off. The driver must register first or request approval from an admin before entering. Vehicle type: ${result.vehicleType}; Color: ${result.color}; Confidence: ${result.confidence}%.`,
        image_url: imageUrl,
      });
      await logActivity('Blocked guest entry', 'Vehicle Access', {
        plate_number: result.plateNumber,
        vehicle_type: result.vehicleType,
        color: result.color,
        confidence: result.confidence,
        visitor_entry_mode: false,
      });
    } catch (err) {
      console.error('[EntranceProcessor] Guest review alert failed:', err);
    }
  }

  private async createManualReviewAlert(result: EntranceResult): Promise<void> {
    try {
      const imageUrl = result.plateSnapshotUrl || result.capturedImage || null;
      const isInc = result.incomplete;
      const title = isInc
        ? `Manual Review Required (Incomplete): ${result.plateNumber}`
        : `Manual Review Required: ${result.plateNumber}`;
      const reasonStr = result.reason ? ` Reason: ${result.reason}.` : '';
      const message = isInc
        ? `Plate read appears incomplete (${result.plateNumber}, ${result.confidence}% conf).${reasonStr} Retried ${result.attempts || 1} time(s) with widening crop. Please verify and complete manually. Vehicle type: ${result.vehicleType}; Color: ${result.color}.`
        : `Plate read confidence (${result.confidence}%) is below acceptance threshold (${SNAPSHOT_CONFIG.ACCEPT_CONF}%) after ${result.attempts || 1} attempt(s). Please verify manually. Vehicle type: ${result.vehicleType}; Color: ${result.color}.`;

      await supabase.from('notifications').insert({
        type: 'warning',
        title,
        message,
        image_url: imageUrl,
      });
      await logActivity(isInc ? 'Incomplete entrance plate read' : 'Unconfirmed entrance plate read', 'Vehicle Access', {
        plate_number: result.plateNumber,
        vehicle_type: result.vehicleType,
        color: result.color,
        confidence: result.confidence,
        attempts: result.attempts,
        incomplete: isInc,
        reason: result.reason,
      });
    } catch (err) {
      console.error('[EntranceProcessor] Manual review alert failed:', err);
    }
  }

  private async saveEntranceRecord(
    fullCanvas: HTMLCanvasElement,
    _winningCrop: HTMLCanvasElement,
    result: EntranceResult,
    recognitionId: string | null
  ): Promise<string | null> {
    try {
      // Phase 3 requirement: Upload exactly one image to Storage per accepted plate
      const snapshotUrl = await this.uploader.uploadSnapshot(fullCanvas, 'entrance', result.plateNumber);

      result.snapshotUrl = snapshotUrl || '';
      result.plateSnapshotUrl = snapshotUrl || '';

      if (recognitionId && snapshotUrl) {
        const { error } = await supabase.from('plate_recognitions')
          .update({ image_url: snapshotUrl })
          .eq('id', recognitionId);
        if (error) {
          console.error('[EntranceProcessor] Could not attach snapshot to recognition:', error);
        }
      }

      const sessionId = await this.createSession(result);
      return sessionId;
    } catch (err) {
      console.error('[EntranceProcessor] Background save error:', err);
      return null;
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
      const normalizedPlate = plate.toUpperCase().replace(/[\s-]+/g, '');
      const { data } = await supabase
        .from('vehicles')
        .select('app_user_id')
        .eq('normalized_plate_number', normalizedPlate)
        .limit(1);

      if (data && data.length > 0 && data[0].app_user_id) {
        return { isPrivate: true, appUserId: data[0].app_user_id };
      }
    } catch (err) {
      console.error('[EntranceProcessor] Vehicle lookup error:', err);
    }
    return { isPrivate: false, appUserId: null };
  }

  private async hasActiveSession(plate: string): Promise<boolean> {
    const { data, error } = await supabase.from('parking_sessions').select('plate_number').eq('status', 'active');
    if (error) {
      console.error('[EntranceProcessor] Could not verify active session; blocking entry:', error);
      return true;
    }
    const normalizedPlate = plate.toUpperCase().replace(/[\s-]+/g, '');
    return Boolean(data?.some(session => session.plate_number.toUpperCase().replace(/[\s-]+/g, '') === normalizedPlate));
  }

  private async recordPlateRecognition(result: EntranceResult): Promise<string | null> {
    const { data, error } = await supabase.from('plate_recognitions').insert({
      plate_number: result.plateNumber,
      vehicle_type: result.vehicleType,
      direction: 'entry',
      confidence: result.confidence,
      camera_name: 'Webcam Entrance',
    }).select('id').maybeSingle();

    if (error) {
      console.error('[EntranceProcessor] Could not log plate recognition:', error);
      return null;
    }

    return data?.id || null;
  }

  private async createSession(result: EntranceResult): Promise<string | null> {
    try {
      if (await this.hasActiveSession(result.plateNumber)) {
        console.info(`[EntranceProcessor] Skipping duplicate active session for ${result.plateNumber}`);
        return null;
      }

      const visitorModeEnabled = await this.getVisitorEntryMode();

      if (!result.isPrivate && !visitorModeEnabled) {
        await this.createGuestReviewAlert(result);
        console.log(`[EntranceProcessor] Guest entry blocked for ${result.plateNumber} because visitor mode is off.`);
        return null;
      }

      const { data: sessionData, error: sessionInsertError } = await supabase.from('parking_sessions').insert({
        plate_number: result.plateNumber,
        vehicle_type: result.vehicleType,
        color: result.color,
        image_url: result.snapshotUrl,
        concept: result.isPrivate ? 'B' : 'A',
        entry_camera: 'Webcam Entrance',
        status: 'active',
        entry_time: new Date().toISOString(),
        app_user_id: result.appUserId,
      }).select('id').maybeSingle();

      if (sessionInsertError) {
        if (sessionInsertError.code === '23505') {
          console.info(`[EntranceProcessor] Database rejected duplicate active session for ${result.plateNumber}`);
          return null;
        }
        throw sessionInsertError;
      }

      await supabase.from('notifications').insert({
        type: result.isPrivate ? 'info' : 'success',
        title: `Vehicle Entered: ${result.plateNumber}`,
        message: `${result.vehicleType.charAt(0).toUpperCase() + result.vehicleType.slice(1)} (${result.color}) — ${result.isPrivate ? 'Private (Registered)' : 'Public (Guest)'}`,
        image_url: result.plateSnapshotUrl || result.snapshotUrl || null,
      });

      await logActivity('Vehicle Entry', 'Vehicle Access', {
        plate_number: result.plateNumber,
        vehicle_type: result.vehicleType,
        color: result.color,
        session_id: sessionData?.id || null,
        confidence: result.confidence,
      });

      console.log(`[EntranceProcessor] Session created for ${result.plateNumber} (id: ${sessionData?.id || 'none'})`);
      return sessionData?.id || null;
    } catch (err) {
      console.error('[EntranceProcessor] Database error:', err);
      return null;
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
  private uploader: ImageUploader;
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

  private captureCallbacks: ((data: CapturedFrameData) => void)[] = [];
  private resumeCallbacks: (() => void)[] = [];

  private _isProcessing = false;
  private _isFrozen = false;
  private isArmed = true;
  private lastPlateSeenTime = 0;

  constructor() {
    this.cameraManager = new CameraManager();
    this.plateReader = new PlateReader();
    this.plateDetector = new PlateDetector();
    this.detector = new YOLODetector();
    this.uploader = new ImageUploader();
  }

  get status(): PipelineStatus { return this._status; }
  get lastResult(): ExitResult | null { return this._lastResult; }
  get camera(): CameraManager { return this.cameraManager; }
  get detections(): Detection[] { return this._detections; }
  get plateDetections(): PlateDetection[] { return this._plateDetections; }
  get isModelLoaded(): boolean { return this.detector.isLoaded; }
  get isOcrReady(): boolean { return this.plateReader.isReady; }

  onStatusChange(cb: (status: PipelineStatus) => void): void { this.statusCallbacks.push(cb); }
  onCapture(cb: (data: CapturedFrameData) => void): () => void {
    this.captureCallbacks.push(cb);
    return () => { this.captureCallbacks = this.captureCallbacks.filter(c => c !== cb); };
  }
  onResume(cb: () => void): () => void {
    this.resumeCallbacks.push(cb);
    return () => { this.resumeCallbacks = this.resumeCallbacks.filter(c => c !== cb); };
  }
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
        await this.detector.loadModel();
      } catch (err) {
        console.warn('[ExitProcessor] Vehicle classifier unavailable; using plate detector only:', err);
      }
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
    this._isFrozen = false;
    this._isProcessing = false;
    this.isArmed = true;
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
    if (this._isFrozen || this._isProcessing) return;

    const frame = this.cameraManager.captureFrame();
    if (!frame) return;

    try {
      // 1. Plate detector runs first
      let plateDetections: PlateDetection[] = [];
      if (this.plateDetector.isLoaded) {
        plateDetections = await this.plateDetector.detect(frame.imageData, 0.25);
      }
      this._plateDetections = plateDetections;

      // 2. While waiting for a trigger, run vehicle detector only if no plate found
      let vehicleDetections: Detection[] = [];
      if (plateDetections.length === 0 && this.detector.isLoaded) {
        vehicleDetections = await this.detector.detect(frame.imageData, 0.25);
        this._detections = vehicleDetections;
      } else {
        vehicleDetections = this._detections;
      }

      this.detectionCallbacks.forEach(cb => cb(vehicleDetections));
      this.plateDetectionsCallbacks.forEach(cb => cb(plateDetections));
      this.frameCallbacks.forEach(cb => cb());

      const now = performance.now();
      const topPlate = plateDetections[0] || null;

      if (topPlate) {
        this.lastPlateSeenTime = now;
      } else {
        // Rearm when no plate has been seen for REARM_NO_PLATE_MS (1500ms)
        if (!this.isArmed && (now - this.lastPlateSeenTime >= SNAPSHOT_CONFIG.REARM_NO_PLATE_MS)) {
          this.isArmed = true;
          if (SNAPSHOT_CONFIG.DEBUG) {
            console.log(`[Snapshot] Exit re-armed: no plate seen for ${SNAPSHOT_CONFIG.REARM_NO_PLATE_MS}ms`);
          }
        }
      }

      if (this._status === 'scanning' && plateDetections.length > 0) {
        this.setStatus('detected');
      } else if (this._status === 'detected' && plateDetections.length === 0) {
        this.setStatus('scanning');
      }

      if (!this.isArmed || !topPlate) {
        return;
      }

      const plateWidth = topPlate.bbox[2] - topPlate.bbox[0];
      if (
        topPlate.confidence >= SNAPSHOT_CONFIG.CAPTURE_MIN_DET_CONF &&
        plateWidth >= SNAPSHOT_CONFIG.CAPTURE_MIN_PLATE_WIDTH_PX
      ) {
        await this.executeFreezeCaptureFlow(frame, topPlate.bbox);
      }
    } catch (err) {
      console.error('[ExitProcessor] Stream error:', err);
    }
  }

  private async executeFreezeCaptureFlow(
    initialFrame: { canvas: HTMLCanvasElement; imageData: ImageData },
    initialPlateBbox: [number, number, number, number]
  ): Promise<void> {
    this._isFrozen = true;
    this._isProcessing = true;
    const pipelineStartTime = performance.now();
    let totalCaptureMs = 0;
    let totalOcrMs = 0;

    try {
      let currentFrame = initialFrame;
      let currentBbox = initialPlateBbox;
      const initialPadding = CROP_PADDING_STAGES[0];
      let currentCrop = cropDetectedPlate(currentFrame.canvas, currentBbox, initialPadding.padX, initialPadding.padY);
      let attempt = 0;
      let ocrResult: OcrReadResult | null = null;
      let isAccepted = false;

      const isEasyOcrOnline = await easyOcrHealth.checkReachability();

      while (attempt < SNAPSHOT_CONFIG.MAX_RETRIES) {
        attempt++;
        const paddingStage = CROP_PADDING_STAGES[Math.min(attempt - 1, CROP_PADDING_STAGES.length - 1)];
        const t0Capture = performance.now();

        if (attempt > 1) {
          this.setStatus('captured');
          const freshFrame = this.cameraManager.captureFrame();
          if (freshFrame) {
            currentFrame = freshFrame;
            if (this.plateDetector.isLoaded) {
              const freshDets = await this.plateDetector.detect(freshFrame.imageData, 0.25);
              if (freshDets.length > 0) {
                currentBbox = freshDets[0].bbox;
              }
            }
            const freshCrop = cropDetectedPlate(currentFrame.canvas, currentBbox, paddingStage.padX, paddingStage.padY);
            if (freshCrop) currentCrop = freshCrop;
          }
        }

        const captureMs = Math.round(performance.now() - t0Capture);
        totalCaptureMs += captureMs;

        // 2. captured: freeze. Pause all detection.
        this.setStatus('captured');
        const fullFrameDataUrl = currentFrame.canvas.toDataURL('image/jpeg', 0.85);
        const cropDataUrl = (currentCrop || currentFrame.canvas).toDataURL('image/jpeg', 0.85);

        this.captureCallbacks.forEach(cb => cb({
          fullFrameDataUrl,
          cropDataUrl,
          plateBbox: currentBbox,
          frameWidth: currentFrame.canvas.width,
          frameHeight: currentFrame.canvas.height,
          attempt,
          isRetake: attempt > 1,
        }));

        await new Promise(r => setTimeout(r, attempt > 1 ? 250 : 180));

        // 3. reading: run OCR once (resize <= 480px)
        this.setStatus('reading');
        const t0Ocr = performance.now();
        const ocrCrop = resizeForOcr(currentCrop || currentFrame.canvas);

        if (isEasyOcrOnline) {
          ocrResult = await this.plateReader.confirmWithEasyOcr(ocrCrop, this.registeredPlatesCache);
        } else {
          ocrResult = await this.plateReader.readWithTesseract(ocrCrop, this.registeredPlatesCache);
        }
        const ocrMs = Math.round(performance.now() - t0Ocr);
        totalOcrMs += ocrMs;

        // Log one line per read with: merged text, complete, reason, attempts
        console.log(`[Snapshot] read: text="${ocrResult?.plate || ''}", complete=${ocrResult?.complete ?? false}, reason="${ocrResult?.reason || 'none'}", attempts=${attempt}`);

        // Treat complete=false as a failed read: do not accept, do not create a session
        if (
          ocrResult &&
          ocrResult.plate &&
          ocrResult.plate.length >= 3 &&
          ocrResult.complete === true &&
          ocrResult.confidence >= SNAPSHOT_CONFIG.ACCEPT_CONF
        ) {
          isAccepted = true;
          break;
        }

        if (SNAPSHOT_CONFIG.DEBUG && attempt < SNAPSHOT_CONFIG.MAX_RETRIES) {
          console.log(`[Snapshot] Retrying exit OCR (attempt ${attempt}/${SNAPSHOT_CONFIG.MAX_RETRIES}, reason=${ocrResult?.reason || 'failed'}, conf=${ocrResult?.confidence || 0}%)`);
        }
      }

      // 2. Short-form check: if accepted result is valid 3 letters + 3 digits plate with confidence below 90, do verification read from wider crop
      if (isAccepted && ocrResult) {
        const isShortForm = /^[A-Z]{3}[0-9]{3}$/.test(ocrResult.plate);
        if (isShortForm && ocrResult.confidence < 90) {
          if (SNAPSHOT_CONFIG.DEBUG) {
            console.log(`[Snapshot] Exit short-form plate "${ocrResult.plate}" (conf=${ocrResult.confidence}% < 90). Running wider verification read...`);
          }
          const wideCrop = cropDetectedPlate(currentFrame.canvas, currentBbox, 0.38, 0.35);
          if (wideCrop) {
            const wideOcrCrop = resizeForOcr(wideCrop);
            const verifyResult = isEasyOcrOnline
              ? await this.plateReader.confirmWithEasyOcr(wideOcrCrop, this.registeredPlatesCache)
              : await this.plateReader.readWithTesseract(wideOcrCrop, this.registeredPlatesCache);
            console.log(`[Snapshot] read: text="${verifyResult?.plate || ''}", complete=${verifyResult?.complete ?? false}, reason="${verifyResult?.reason || 'none'}", attempts=${attempt} (verify)`);
            if (
              verifyResult &&
              verifyResult.complete &&
              verifyResult.plate.length > ocrResult.plate.length &&
              verifyResult.plate.startsWith(ocrResult.plate.slice(0, 3))
            ) {
              if (SNAPSHOT_CONFIG.DEBUG) {
                console.log(`[Snapshot] Wider read upgraded exit short-form plate "${ocrResult.plate}" -> "${verifyResult.plate}" (conf=${verifyResult.confidence}%)`);
              }
              ocrResult = verifyResult;
              currentCrop = wideCrop;
            }
          }
        }
      }

      const totalPipelineMs = Math.round(performance.now() - pipelineStartTime);
      const plateNumber = ocrResult?.plate || '';
      const confidence = ocrResult?.confidence || 0;

      // Single summary log line
      console.log(`[Snapshot] summary: plate="${plateNumber || 'unreadable'}", confidence=${confidence}%, attempts=${attempt}, ms per stage (capture: ${totalCaptureMs}ms, OCR: ${totalOcrMs}ms, total: ${totalPipelineMs}ms)`);

      // Check lockout window
      if (isAccepted && this.lockedPlates.has(plateNumber)) {
        if (SNAPSHOT_CONFIG.DEBUG) {
          console.log(`[Snapshot] Exit plate "${plateNumber}" triggered within lockout window (${SNAPSHOT_CONFIG.LOCKOUT_MS}ms); ignoring.`);
        }
        return;
      }

      const cropDataUrl = (currentCrop || currentFrame.canvas).toDataURL('image/jpeg', 0.85);
      const fullFrameDataUrl = currentFrame.canvas.toDataURL('image/jpeg', 0.85);

      if (isAccepted) {
        this.lockedPlates.add(plateNumber);
        setTimeout(() => {
          this.lockedPlates.delete(plateNumber);
        }, SNAPSHOT_CONFIG.LOCKOUT_MS);

        const exitResult = await this.processExit(plateNumber, confidence, currentFrame.canvas);

        if (exitResult) {
          exitResult.capturedImage = cropDataUrl;
          exitResult.fullSnapshotImage = fullFrameDataUrl;
          exitResult.attempts = attempt;
          exitResult.timeTakenMs = totalPipelineMs;

          // 4. result: show plate characters, confidence, and status on frozen image
          this.setStatus('result');
          this._lastResult = exitResult;
          this.resultCallbacks.forEach(cb => cb(exitResult));
          await new Promise(r => setTimeout(r, SNAPSHOT_CONFIG.RESULT_DISPLAY_MS));
        } else {
          // No active session found or payment required
          const noSessionResult: ExitResult = {
            plateNumber,
            confidence,
            sessionId: '',
            entryTime: new Date().toISOString(),
            durationHours: 0,
            totalAmount: 0,
            capturedImage: cropDataUrl,
            fullSnapshotImage: fullFrameDataUrl,
            attempts: attempt,
            timeTakenMs: totalPipelineMs,
          };
          this.setStatus('result');
          this._lastResult = noSessionResult;
          this.resultCallbacks.forEach(cb => cb(noSessionResult));
          await new Promise(r => setTimeout(r, SNAPSHOT_CONFIG.RESULT_DISPLAY_MS));
        }
      } else {
        // Fall back to manual review flow with partial text prefilled and flagged "incomplete"
        const isIncomplete = ocrResult ? !ocrResult.complete : true;
        const partialPlate = ocrResult?.plate || '';
        const fallbackResult: ExitResult = {
          plateNumber: partialPlate || 'UNREADABLE',
          confidence,
          sessionId: '',
          entryTime: new Date().toISOString(),
          durationHours: 0,
          totalAmount: 0,
          capturedImage: cropDataUrl,
          fullSnapshotImage: fullFrameDataUrl,
          attempts: attempt,
          timeTakenMs: totalPipelineMs,
          unreadable: !partialPlate,
          incomplete: isIncomplete,
          reason: ocrResult?.reason || (partialPlate ? 'incomplete' : 'unreadable'),
        };

        this.setStatus('result');
        this._lastResult = fallbackResult;
        this.resultCallbacks.forEach(cb => cb(fallbackResult));

        await this.createManualReviewAlert(
          fallbackResult.plateNumber,
          confidence,
          attempt,
          cropDataUrl,
          isIncomplete,
          fallbackResult.reason
        );
        await new Promise(r => setTimeout(r, SNAPSHOT_CONFIG.RESULT_DISPLAY_MS));
      }
    } catch (err) {
      console.error('[Snapshot] ERROR in exit snapshot flow:', err);
    } finally {
      // 5. resume: return to live feed and detection
      this.setStatus('scanning');
      this._isFrozen = false;
      this._isProcessing = false;
      this.isArmed = false;
      this.lastPlateSeenTime = performance.now();
      this.resumeCallbacks.forEach(cb => cb());
    }
  }

  private async createManualReviewAlert(
    plateNumber: string,
    confidence: number,
    attempts: number,
    cropDataUrl: string,
    incomplete = false,
    reason = ''
  ): Promise<void> {
    try {
      const title = incomplete
        ? `Manual Review Required (Exit - Incomplete): ${plateNumber || 'Unreadable'}`
        : `Manual Review Required (Exit): ${plateNumber || 'Unreadable'}`;
      const reasonStr = reason ? ` Reason: ${reason}.` : '';
      const message = incomplete
        ? `Exit plate read appears incomplete (${plateNumber}, ${confidence}% conf).${reasonStr} Retried ${attempts} time(s) with widening crop. Please verify and complete manually.`
        : `Exit plate read confidence (${confidence}%) is below acceptance threshold (${SNAPSHOT_CONFIG.ACCEPT_CONF}%) after ${attempts} attempt(s). Please verify manually.`;

      await supabase.from('notifications').insert({
        type: 'warning',
        title,
        message,
        image_url: cropDataUrl || null,
      });
      await logActivity(incomplete ? 'Incomplete exit plate read' : 'Unconfirmed exit plate read', 'Vehicle Access', {
        plate_number: plateNumber || 'UNREADABLE',
        confidence,
        attempts,
        incomplete,
        reason,
      });
    } catch (err) {
      console.error('[ExitProcessor] Manual review alert failed:', err);
    }
  }

  private async processExit(plateNumber: string, confidence: number, fullCanvas?: HTMLCanvasElement): Promise<ExitResult | null> {
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
      const rateKey = session.vehicle_type === 'motorcycle' ? 'hourly_rate_motorcycle' : 'hourly_rate_car';
      const { data: settingsData } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', [rateKey, 'grace_period_minutes']);
      const settings = Object.fromEntries((settingsData || []).map(row => [row.key, row.value]));
      const hourlyRate = Number(settings[rateKey]) || (session.vehicle_type === 'motorcycle' ? 25 : 50);
      const gracePeriodMinutes = Math.max(0, Number(settings.grace_period_minutes) || 0);
      const durationHours = calculateBillableHours(session.entry_time, exitTime, gracePeriodMinutes);
      const totalAmount = calculateParkingFee(durationHours, hourlyRate);

      const { data: countData } = await supabase.from('payments').select('id');
      const receiptNum = `RCP-${exitTime.getFullYear()}-${String((countData?.length || 0) + 1).padStart(4, '0')}`;
      let exitWasAllowed = true;
      if (session.app_user_id) {
        if (totalAmount > 0) await settleRegisteredSessionWallet(session, durationHours, hourlyRate, 'Vision System');
      } else {
        const { data: completedPayment } = await supabase.from('payments').select('id')
          .eq('session_id', session.id).eq('status', 'completed').maybeSingle();
        if (!completedPayment && totalAmount > 0) {
          exitWasAllowed = false;
          const { data: pendingPayment } = await supabase.from('payments').select('id')
            .eq('session_id', session.id).eq('status', 'pending').maybeSingle();
          if (!pendingPayment) {
            await supabase.from('payments').insert({
              receipt_number: receiptNum,
              plate_number: plateNumber,
              session_id: session.id,
              duration_hours: durationHours,
              hourly_rate: hourlyRate,
              total_amount: totalAmount,
              payment_method: 'cash',
              status: 'pending',
              processed_by: 'Vision System',
            });
          }
        }
      }

      let snapshotUrl: string | null = null;
      if (fullCanvas) {
        try {
          snapshotUrl = await this.uploader.uploadSnapshot(fullCanvas, 'exit', plateNumber);
        } catch (uploadErr) {
          console.warn('[ExitProcessor] Exit snapshot upload error:', uploadErr);
        }
      }

      await supabase.from('plate_recognitions').insert({
        plate_number: plateNumber,
        vehicle_type: session.vehicle_type,
        direction: 'exit',
        confidence,
        camera_name: 'Webcam Exit',
        image_url: snapshotUrl || undefined,
      });

      if (!exitWasAllowed) {
        await supabase.from('notifications').insert({
          type: 'warning',
          title: `Payment Required: ${plateNumber}`,
          message: `Exit scan detected for ${plateNumber}. Complete payment before leaving. Amount due: ₱${totalAmount.toFixed(2)}.`,
        });
        return null;
      }

      await supabase.from('parking_sessions').update({
        status: 'completed',
        exit_time: exitTime.toISOString(),
        exit_camera: 'Webcam Exit',
      }).eq('id', session.id);

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

      await logActivity('Vehicle Exit', 'Vehicle Access', {
        plate_number: plateNumber,
        session_id: session.id,
        duration_hours: durationHours,
        total_amount: totalAmount,
      });

      console.log(`[ExitProcessor] Session completed for ${plateNumber}, ₱${totalAmount.toFixed(2)}`);

      return {
        plateNumber,
        confidence,
        sessionId: session.id,
        entryTime: session.entry_time,
        durationHours,
        totalAmount,
        snapshotUrl: snapshotUrl || '',
        plateSnapshotUrl: snapshotUrl || '',
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
  /** Allowed vehicle type from parking_slots, e.g. "car" or "motorcycle" */
  vehicleType?: string;
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
function segmentsIntersect(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number]
): boolean {
  const orientation = (p: [number, number], q: [number, number], r: [number, number]) => {
    const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
    if (Math.abs(val) < 1e-9) return 0;
    return val > 0 ? 1 : 2;
  };

  const onSegment = (p: [number, number], q: [number, number], r: [number, number]) => {
    if (
      Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) &&
      Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1])
    ) {
      return true;
    }
    return false;
  };

  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function doesBboxOverlapPolygon(
  bbox: [number, number, number, number],
  polygon: [number, number][],
  frameWidth: number,
  frameHeight: number
): boolean {
  if (!polygon || polygon.length < 3) return false;

  // Convert bbox from pixel coords to normalized 0-1
  const nx1 = bbox[0] / frameWidth;
  const ny1 = bbox[1] / frameHeight;
  const nx2 = bbox[2] / frameWidth;
  const ny2 = bbox[3] / frameHeight;

  const rectPoints: [number, number][] = [
    [nx1, ny1],
    [nx2, ny1],
    [nx2, ny2],
    [nx1, ny2],
  ];

  // Check whether any rectangle corner or center lies inside the slot polygon.
  const testPoints: [number, number][] = [
    [(nx1 + nx2) / 2, (ny1 + ny2) / 2],
    [(nx1 + nx2) / 2, ny2],
    ...rectPoints
  ];
  for (const point of testPoints) {
    if (isPointInPolygon(point, polygon)) return true;
  }

  // Handle cases where the box crosses the polygon boundary but the center is just outside.
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    for (let j = 0; j < rectPoints.length; j++) {
      const r1 = rectPoints[j];
      const r2 = rectPoints[(j + 1) % rectPoints.length];
      if (segmentsIntersect(p1, p2, r1, r2)) return true;
    }
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
  private slotStateCallbacks: ((slots: any[]) => void)[] = [];
  private frameCallbacks: (() => void)[] = [];

  // IP Camera overrides
  private ipMode = false;
  private ipConfigSent = 0;
  private lastSentConfigJson = '';
  private isPollingIp = false;
  private slotMonitorUrl = import.meta.env.VITE_SLOT_MONITOR_URL || 'http://127.0.0.1:8766';
  private cameraConfig: any = null;

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
  onSlotState(cb: (slots: any[]) => void): void { this.slotStateCallbacks.push(cb); }
  onFrame(cb: () => void): void { this.frameCallbacks.push(cb); }

  private setStatus(status: PipelineStatus): void {
    this._status = status;
    this.statusCallbacks.forEach(cb => cb(status));
  }

  /**
   * initialize — Loads the YOLO model for vehicle detection.
   */
  async initialize(): Promise<void> {
    if (this.ipMode) {
      this.setStatus('idle');
      return;
    }
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
  async startCamera(deviceId: string, videoEl: HTMLVideoElement, cameraConfig?: any): Promise<void> {
    if (cameraConfig?.connection_method === 'ip') {
      this.ipMode = true;
      this.cameraConfig = cameraConfig;
      this.ipConfigSent = 0;
      return;
    }
    this.ipMode = false;
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
    this.ipConfigSent = 0; // force resend to IP backend

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
    if (this.ipMode) {
      await this.processIpBackend();
      return;
    }
    
    if (!this.detector.isLoaded || !this.cameraManager.isActive) return;

    try {
      // Capture frame
      const frame = this.cameraManager.captureFrame();
      if (!frame) return;

      // Run YOLO detection with a lower threshold for slot occupancy. The AOI
      // logic is used to confirm whether a vehicle is actually inside a slot,
      // so a slightly more permissive detector reduces false negatives.
      const detections = await this.detector.detect(frame.imageData, 0.18, 0.55);
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

  private ipErrorCallbacks: ((err: string) => void)[] = [];

  onIpError(cb: (err: string) => void): void { this.ipErrorCallbacks.push(cb); }

  private async processIpBackend() {
    if (this.isPollingIp) return;
    this.isPollingIp = true;
    try {
      const now = Date.now();
      let url = this.cameraConfig?.ip_address || '';
      if (url && !url.startsWith('http')) url = 'http://' + url;

      // Extract comparable slot configuration (ids, polygons, and vehicleType)
      const comparableSlots = this.slots.map(s => ({
        slotId: s.slotId,
        dbId: s.dbId,
        polygon: s.polygon,
        vehicleType: s.vehicleType
      }));
      const configObj = {
        camera: { url, mode: 'mjpeg' },
        slots: comparableSlots
      };
      const currentConfigJson = JSON.stringify(configObj);
      const configChanged = currentConfigJson !== this.lastSentConfigJson;
      const keepAliveDue = (now - this.ipConfigSent) > 30000;

      // Only POST /config when url or slots actually change or keep-alive is due (every 30s)
      // Never send an empty slots list if we have active slots
      if ((configChanged || keepAliveDue) && url) {
        console.log(`[SlotMonitor IP] POSTing /config (${comparableSlots.length} slots sent, changed=${configChanged}, keepAlive=${keepAliveDue})`);
        comparableSlots.forEach(s => {
          console.log(`[SlotMonitor IP] Slot "${s.slotId}" (dbId: ${s.dbId}) sent with vehicleType: "${s.vehicleType}"`);
        });
        this.ipConfigSent = now;
        this.lastSentConfigJson = currentConfigJson;
        await fetch(`${this.slotMonitorUrl}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configObj)
        }).then(res => console.log('[SlotMonitor IP] /config response:', res.status))
          .catch(e => {
            console.warn('[SlotMonitor IP] Config error', e);
            this.ipErrorCallbacks.forEach(cb => cb(`IP camera config error: ${e.message || e}`));
          });
      }
      
      const res = await fetch(`${this.slotMonitorUrl}/state`);
      if (!res.ok) {
        throw new Error(`Failed to fetch /state: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      
      // Notify listeners of live slot states
      const slotsData: any[] = data.slots || [];
      this.slotStateCallbacks.forEach(cb => cb(slotsData));

      // Map live vehicle detections to our Detection interface
      const rawDetections: any[] = data.detections || [];
      const mappedDetections: Detection[] = rawDetections.map((d: any) => ({
        classId: d.type === 'motorcycle' ? 3 : 2,
        className: d.type || 'car',
        confidence: d.confidence || 0.8,
        bbox: d.bbox || [0, 0, 0, 0],
        vehicleType: d.type || 'car',
        color: d.color || null,
      }));
      this._detections = mappedDetections;
      this.detectionCallbacks.forEach(cb => cb(mappedDetections));

      // Match each slot in this.slots to an entry in /state
      // Match by slotId, dbId, or slot number/name (try each in order, case-insensitive)
      const matchedMap = new Map<string, any>(); // key: configured slot dbId -> state entry
      const stateMatchedSet = new Set<any>();

      for (const slot of this.slots) {
        const slotIdStr = String(slot.slotId || '').trim().toLowerCase();
        const dbIdStr = String(slot.dbId || '').trim().toLowerCase();

        const match = slotsData.find(s => {
          const sSlotId = String(s.slotId ?? '').trim().toLowerCase();
          const sDbId = String(s.dbId ?? '').trim().toLowerCase();
          const sName = String(s.name ?? s.slot_number ?? '').trim().toLowerCase();

          // 1. Match by slotId
          if (sSlotId && (sSlotId === slotIdStr || sSlotId === dbIdStr)) return true;
          // 2. Match by dbId
          if (sDbId && (sDbId === dbIdStr || sDbId === slotIdStr)) return true;
          // 3. Match by name or slot_number (case-insensitive)
          if (sName && (sName === slotIdStr || sName === dbIdStr)) return true;

          return false;
        });

        if (match) {
          matchedMap.set(slot.dbId, match);
          stateMatchedSet.add(match);
        } else {
          // Log a warning in the console when a slot in the page has no match in /state, listing both sets of ids
          const pageSlotIds = this.slots.map(s => ({ slotId: s.slotId, dbId: s.dbId }));
          const stateSlotIds = slotsData.map(s => ({ slotId: s.slotId, dbId: s.dbId, name: s.name }));
          console.warn(`[SlotMonitor IP] No /state match for slot "${slot.slotId}" (dbId: ${slot.dbId}):`, {
            unmatchedSlot: slot,
            pageSlots: pageSlotIds,
            stateSlots: stateSlotIds
          });
        }
      }

      const changes: SlotDetectionResult[] = [];

      for (const slot of this.slots) {
        const s = matchedMap.get(slot.dbId);
        if (!s) continue;

        let state = this.occupancyState.get(slot.dbId);
        if (!state) {
          state = { occupied: false, count: 0 };
          this.occupancyState.set(slot.dbId, state);
        }

        // Expose type/color and live info to SlotManagement DOM
        const targetIds = [slot.dbId, slot.slotId, s.dbId, s.slotId].filter(Boolean);
        for (const tid of targetIds) {
          const slotEl = document.getElementById(`slot-card-${tid}`);
          if (slotEl) {
            slotEl.setAttribute('data-vehicle-type', s.vehicleType || '');
            slotEl.setAttribute('data-color', s.color || '');
            slotEl.setAttribute('data-type-conf', (s.typeConfidence || 0).toString());
            slotEl.setAttribute('data-mismatch', s.slotTypeMismatch ? 'true' : 'false');
            slotEl.setAttribute('data-live-type', s.liveVehicleType || '');
            slotEl.setAttribute('data-live-color', s.liveColor || '');
            slotEl.setAttribute('data-live-conf', (s.liveConfidence || 0).toString());
            slotEl.setAttribute('data-live-overlap', (s.liveOverlap || 0).toString());
            slotEl.setAttribute('data-stable-occupied', s.stableOccupied ? 'true' : 'false');
            slotEl.setAttribute('data-expected-type', s.expectedType || '');
            slotEl.setAttribute('data-detected-type', s.detectedType || '');
          }
        }

        // Check if occupancy differs from the state currently stored
        // Note: whenever stableOccupied differs from the status currently stored in the tracker/DB, update!
        const isOccupied = Boolean(s.stableOccupied);
        if (state.occupied !== isOccupied) {
          state.occupied = isOccupied;
          changes.push({ slotId: slot.slotId, dbId: slot.dbId, occupied: isOccupied });
        }
      }

      if (changes.length > 0) {
        await this.updateSlotStatuses(changes);
        this.slotChangeCallbacks.forEach(cb => cb(changes));
      }
      this.frameCallbacks.forEach(cb => cb());
    } catch (err: any) {
      console.error('[SlotMonitor IP] Error polling state:', err);
    } finally {
      this.isPollingIp = false;
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
        const response = await supabase
          .from('parking_slots')
          .update({ status: newStatus })
          .eq('id', change.dbId)
          .select();

        console.log(`[SlotMonitor] Supabase update response for ${change.slotId} (${change.dbId}):`, response);

        if (response.error) {
          const errMsg = `Failed to update slot ${change.slotId} to ${newStatus}: ${response.error.message}`;
          console.error(`[SlotMonitor] ${errMsg}`);
          this.ipErrorCallbacks.forEach(cb => cb(errMsg));
        } else {
          console.log(`[SlotMonitor] Successfully saved: ${change.slotId} → ${newStatus}`);
          // Notify hooks to refetch parking_slots immediately
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('slot-status-updated', { detail: { slotId: change.slotId, status: newStatus } }));
          }
        }
      } catch (err: any) {
        const errMsg = `Exception updating slot ${change.slotId}: ${err?.message || err}`;
        console.error(`[SlotMonitor] ${errMsg}`);
        this.ipErrorCallbacks.forEach(cb => cb(errMsg));
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
