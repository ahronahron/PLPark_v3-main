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
interface PlateDetection {
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
 * center-x, center-y, width, height, confidence. The model is intentionally
 * separate from the COCO vehicle model because vehicle boxes are not plate boxes.
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

  async detect(imageData: ImageData, threshold = 0.35): Promise<PlateDetection[]> {
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
    const boxes: PlateDetection[] = [];
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
      boxes.push({
        confidence,
        bbox: [
          Math.max(0, (modelX1 - padX) / scale),
          Math.max(0, (modelY1 - padY) / scale),
          Math.min(imageData.width, (modelX2 - padX) / scale),
          Math.min(imageData.height, (modelY2 - padY) / scale),
        ],
      });
    }
    return boxes.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  dispose(): void {
    this.session = null;
    this._isLoaded = false;
  }
}

/** Crop and normalize an exact plate detector box for OCR. */
function cropDetectedPlate(sourceCanvas: HTMLCanvasElement, bbox: [number, number, number, number]): HTMLCanvasElement | null {
  const [rawX1, rawY1, rawX2, rawY2] = bbox.map(Math.round);
  const paddingX = Math.round((rawX2 - rawX1) * 0.06);
  const paddingY = Math.round((rawY2 - rawY1) * 0.12);
  const x1 = Math.max(0, rawX1 - paddingX);
  const y1 = Math.max(0, rawY1 - paddingY);
  const x2 = Math.min(sourceCanvas.width, rawX2 + paddingX);
  const y2 = Math.min(sourceCanvas.height, rawY2 + paddingY);
  const width = x2 - x1;
  const height = y2 - y1;
  if (width < 30 || height < 10) return null;
  const canvas = document.createElement('canvas');
  const scale = 3;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.drawImage(sourceCanvas, x1, y1, width, height, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const gray = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
    const enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.7 + 128));
    image.data[i] = enhanced;
    image.data[i + 1] = enhanced;
    image.data[i + 2] = enhanced;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

// ============================================================
// 4. PLATE READER (OCR)
// ============================================================

/**
 * PlateReader — Reads license plates using Tesseract.js OCR.
 *
 * Performs one OCR pass per focused candidate image. Repeating the same
 * recognition three times made the live pipeline unnecessarily slow and did
 * not add information because the input image was unchanged.
 */
export class PlateReader {
  private worker: Tesseract.Worker | null = null;
  private _isReady = false;

  /** Whether the Tesseract worker is initialized */
  get isReady(): boolean {
    return this._isReady;
  }

  /**
   * initialize — Creates and configures the Tesseract.js OCR worker.
   */
  async initialize(): Promise<void> {
    try {
      this.worker = await Tesseract.createWorker('eng', 1, {
        logger: () => {},  // suppress logs
      });

      // Configure for license plate reading
      await this.worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        user_defined_dpi: '300',
        preserve_interword_spaces: '0',
      });

      this._isReady = true;
      console.log('[PlateReader] Tesseract worker ready');
    } catch (err) {
      console.error('[PlateReader] Failed to initialize:', err);
      throw err;
    }
  }

  /**
   * readPlate — Single OCR pass on an image region.
   *
   * @param imageSource — Canvas or base64 string containing the plate
   * @returns The recognized text, cleaned and uppercased
   */
  async readPlate(imageSource: HTMLCanvasElement | string): Promise<string> {
    if (!this.worker) return '';

    const result = await this.worker.recognize(imageSource);
    return this.cleanPlateText(result.data.text);
  }

  /**
  * confirmPlate — Fast single-pass plate recognition.
   *
   * @param imageSource — The plate region to read
   * @returns Confirmed plate string and confidence, or null if no majority
   */
  async confirmPlate(imageSource: HTMLCanvasElement | string): Promise<{ plate: string; confidence: number } | null> {
    if (!this.worker) return null;

    const result = await this.worker.recognize(imageSource);
    const plate = this.cleanPlateText(result.data.text);
    const confidence = Number(result.data.confidence || 0);
    if (plate.length < 3 || plate.length > 8 || confidence < 35) return null;
    return { plate, confidence: Math.round(confidence) };
  }

  /**
   * cleanPlateText — Strips invalid characters and normalizes plate text.
   */
  private cleanPlateText(text: string): string {
    const normalized = text
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .trim();

    // Philippine plates commonly use ABC1234. Older formats such as
    // LLDDLLL also occur, so choose the correction pattern from the raw text.
    if (normalized.length === 7) {
      const letters: Record<string, string> = { '0': 'O', '1': 'I', '3': 'J', '4': 'A', '5': 'S', '6': 'G' };
      const digits: Record<string, string> = { O: '0', I: '1', J: '3', A: '4', G: '6', S: '5' };
      const prefix = normalized.slice(0, 3);
      const modernPhilippinePlate = (prefix.match(/[A-Z]/g) || []).length >= 2;
      return normalized.split('').map((character, index) => {
        const digitPosition = modernPhilippinePlate ? index >= 3 : index === 2 || index === 3;
        return digitPosition ? (digits[character] || character) : (letters[character] || character);
      }).join('');
    }

    return normalized;
  }

  /** Cleanup Tesseract worker */
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
 * EntranceProcessor — Orchestrates the full entrance detection workflow.
 *
 * Combines CameraManager, YOLODetector, PlateReader, and ImageUploader to:
 * 1. Continuously scan video frames for vehicles
 * 2. On detection, crop and OCR the plate region
 * 3. Confirm plate via 3-pass majority vote
 * 4. Upload snapshots to Supabase Storage
 * 5. Create parking session and plate recognition records
 * 6. Prevent duplicate scans until vehicle clears frame
 */
export class EntranceProcessor {
  private cameraManager: CameraManager;
  private detector: YOLODetector;
  private plateDetector: PlateDetector;
  private plateReader: PlateReader;
  private uploader: ImageUploader;
  private intervalId: number | null = null;
  private ocrIntervalId: number | null = null;
  private lockedPlates: Set<string> = new Set();
  private _status: PipelineStatus = 'idle';
  private _lastResult: EntranceResult | null = null;
  private _detections: Detection[] = [];
  private statusCallbacks: ((status: PipelineStatus) => void)[] = [];
  private detectionCallbacks: ((detections: Detection[]) => void)[] = [];
  private resultCallbacks: ((result: EntranceResult) => void)[] = [];
  private frameCallbacks: (() => void)[] = [];
  private _isProcessingPlate = false;

  constructor() {
    this.cameraManager = new CameraManager();
    this.detector = new YOLODetector();
    this.plateDetector = new PlateDetector();
    this.plateReader = new PlateReader();
    this.uploader = new ImageUploader();
  }

  /** Current pipeline status */
  get status(): PipelineStatus { return this._status; }
  /** Latest detection results */
  get detections(): Detection[] { return this._detections; }
  /** Latest entrance processing result */
  get lastResult(): EntranceResult | null { return this._lastResult; }
  /** Access to underlying camera manager */
  get camera(): CameraManager { return this.cameraManager; }
  /** Check if YOLO model is loaded */
  get isModelLoaded(): boolean { return this.detector.isLoaded; }
  /** Check if OCR is ready */
  get isOcrReady(): boolean { return this.plateReader.isReady; }

  /** Register a status change listener */
  onStatusChange(cb: (status: PipelineStatus) => void): void { this.statusCallbacks.push(cb); }
  /** Register a detection update listener */
  onDetections(cb: (detections: Detection[]) => void): void { this.detectionCallbacks.push(cb); }
  /** Register a result listener (new session created) */
  onResult(cb: (result: EntranceResult) => void): void { this.resultCallbacks.push(cb); }
  /** Register a frame processed listener (for overlay redraw) */
  onFrame(cb: () => void): void { this.frameCallbacks.push(cb); }

  private setStatus(status: PipelineStatus): void {
    this._status = status;
    this.statusCallbacks.forEach(cb => cb(status));
  }

  /**
   * initialize — Loads YOLO model and Tesseract worker.
   * Call once before starting the pipeline.
   */
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
        console.warn('[EntranceProcessor] Dedicated plate model missing; using vehicle-box fallback');
      }
      this.setStatus('idle');
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  /**
   * startCamera — Opens the specified camera device.
   */
  async startCamera(deviceId: string, videoEl: HTMLVideoElement): Promise<void> {
    await this.cameraManager.startStream(deviceId, videoEl);
  }

  /**
   * startProcessing — Begins two parallel loops:
   * 1. YOLO detection at ~3 FPS (for bounding boxes + vehicle info)
   * 2. OCR plate scanning every ~2s (independent of YOLO)
   */
  startProcessing(): void {
    if (this.intervalId) return;
    this.setStatus('scanning');

    // Keep vehicle detection responsive without competing with OCR on every frame.
    this.intervalId = window.setInterval(async () => {
      await this.runYoloFrame();
    }, 500);

    // One focused OCR pass roughly once per second; calls are serialized.
    this.ocrIntervalId = window.setInterval(async () => {
      await this.runOcrScan();
    }, 1200);
  }

  /** stopProcessing — Stops both loops. */
  stopProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.ocrIntervalId) {
      clearInterval(this.ocrIntervalId);
      this.ocrIntervalId = null;
    }
    this.setStatus('idle');
  }

  /** stop — Full cleanup: stop processing, camera, and release resources. */
  async stop(): Promise<void> {
    this.stopProcessing();
    this.cameraManager.stopStream();
    await this.plateReader.dispose();
    this.detector.dispose();
    this.plateDetector.dispose();
    this.lockedPlates.clear();
    this._detections = [];
  }

  /**
   * runYoloFrame — YOLO-only frame processing for visual bounding boxes.
   * Runs frequently for smooth UI overlay but does NOT gate plate reading.
   */
  private async runYoloFrame(): Promise<void> {
    const frame = this.cameraManager.captureFrame();
    if (!frame) return;

    try {
      // Run YOLO detection with a lower threshold for better sensitivity
      const detections = await this.detector.detect(frame.imageData, 0.25);
      this._detections = detections;
      this.detectionCallbacks.forEach(cb => cb(detections));
      this.frameCallbacks.forEach(cb => cb());

      if (detections.length > 0 && this._status === 'scanning') {
        this.setStatus('detected');
      }
    } catch (err) {
      console.error('[EntranceProcessor] YOLO error:', err);
    }
  }

  /**
   * runOcrScan — Independent OCR scan that reads plates from the frame.
   *
   * Runs every ~2 seconds regardless of YOLO detections.
   * Tries multiple regions of the frame to find plates:
   * 1. If YOLO detected a vehicle, crop the bottom of its bbox
   * 2. Always also scan the center-bottom of the full frame
   * 3. Always also scan the center of the full frame
   */
  private async runOcrScan(): Promise<void> {
    if (this._isProcessingPlate) return;

    const frame = this.cameraManager.captureFrame();
    if (!frame) return;

    this._isProcessingPlate = true;
    const prevStatus = this._status;
    this.setStatus('reading_plate');

    try {
      // Collect candidate plate regions to scan
      const regions: HTMLCanvasElement[] = [];

      if (this.plateDetector.isLoaded) {
        const plateDetections = await this.plateDetector.detect(frame.imageData);
        const plateCrop = plateDetections[0] && cropDetectedPlate(frame.canvas, plateDetections[0].bbox);
        if (plateCrop) regions.push(plateCrop);
      }

      // Region 1: If YOLO detected a vehicle, crop its bottom portion
      if (regions.length === 0 && this._detections.length > 0) {
        const best = this._detections.reduce((a, b) => a.confidence > b.confidence ? a : b);
        const bboxCrop = this.cropPlateRegion(frame.canvas, best.bbox);
        if (bboxCrop) regions.push(bboxCrop);
      }

      // Only use two fallback regions when no vehicle box is available. OCR on
      // broad overlapping regions increases latency and false positives.
      if (regions.length === 0) {
        const centerBottom = this.cropFrameRegion(frame.canvas, 0.15, 0.55, 0.70, 0.40);
        const center = this.cropFrameRegion(frame.canvas, 0.20, 0.30, 0.60, 0.40);
        if (centerBottom) regions.push(centerBottom);
        if (center) regions.push(center);
      }

      // Try each region until we get a confirmed plate
      let plateResult: { plate: string; confidence: number } | null = null;
      let successRegion: HTMLCanvasElement | null = null;

      for (const region of regions) {
        plateResult = await this.plateReader.confirmPlate(region);
        if (plateResult && !this.lockedPlates.has(plateResult.plate)) {
          successRegion = region;
          break;
        }
        plateResult = null;
      }

      if (plateResult && successRegion) {
        // Plate confirmed! Auto-register the session
        this.setStatus('confirmed');
        console.log(`[EntranceProcessor] Plate confirmed: ${plateResult.plate} (${plateResult.confidence}%)`);

        // Determine vehicle info from YOLO if available
        let vehicleType: 'car' | 'motorcycle' = 'car';
        let color = 'Unknown';
        if (this._detections.length > 0) {
          const best = this._detections.reduce((a, b) => a.confidence > b.confidence ? a : b);
          vehicleType = best.vehicleType || 'car';
          color = best.color || 'Unknown';
        }

        // Upload snapshots to Supabase Storage
        const [snapshotUrl, plateSnapshotUrl] = await Promise.all([
          this.uploader.uploadSnapshot(frame.canvas, 'entrance', plateResult.plate),
          this.uploader.uploadSnapshot(successRegion, 'plates', plateResult.plate),
        ]);

        // Check if plate belongs to a registered vehicle
        const { isPrivate, appUserId } = await this.lookupVehicle(plateResult.plate);

        const result: EntranceResult = {
          plateNumber: plateResult.plate,
          vehicleType,
          color,
          confidence: plateResult.confidence,
          snapshotUrl: snapshotUrl || '',
          plateSnapshotUrl: plateSnapshotUrl || '',
          isPrivate,
          appUserId,
        };

        // Save to database — auto-register
        await this.createSession(result);

        // Lock this plate to prevent duplicate scans
        this.lockedPlates.add(plateResult.plate);
        this._lastResult = result;
        this.resultCallbacks.forEach(cb => cb(result));

        // Auto-unlock after 30 seconds
        setTimeout(() => {
          this.lockedPlates.delete(plateResult!.plate);
        }, 30000);

        // Hold confirmed status for 3 seconds so user can see it
        setTimeout(() => {
          if (this._status === 'confirmed') {
            this.setStatus('scanning');
          }
        }, 3000);
      } else {
        this.setStatus(prevStatus === 'detected' ? 'detected' : 'scanning');
      }
    } catch (err) {
      console.error('[EntranceProcessor] OCR scan error:', err);
      this.setStatus('scanning');
    }

    this._isProcessingPlate = false;
  }

  /**
   * cropPlateRegion — Extracts the license plate region from a vehicle detection.
   *
   * Takes the bottom 40% of the bounding box and preprocesses for OCR
   * (grayscale + contrast enhancement).
   */
  private cropPlateRegion(
    sourceCanvas: HTMLCanvasElement,
    bbox: [number, number, number, number]
  ): HTMLCanvasElement | null {
    const [x1, y1, x2, y2] = bbox.map(Math.round);
    const bboxW = x2 - x1;
    const bboxH = y2 - y1;

    if (bboxW < 30 || bboxH < 20) return null;

    // Take the bottom 40% of the bbox for plate region
    const plateY = y1 + Math.round(bboxH * 0.60);
    const plateH = y2 - plateY;
    const plateW = bboxW;

    if (plateW < 40 || plateH < 15) return null;

    const plateCanvas = document.createElement('canvas');
    const scale = 3; // Give Tesseract enough character detail without scanning a full frame
    plateCanvas.width = plateW * scale;
    plateCanvas.height = plateH * scale;
    const ctx = plateCanvas.getContext('2d')!;

    ctx.drawImage(sourceCanvas, x1, plateY, plateW, plateH, 0, 0, plateW * scale, plateH * scale);

    // Preprocess: grayscale + contrast boost
    const imgData = ctx.getImageData(0, 0, plateCanvas.width, plateCanvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
      d[i] = d[i + 1] = d[i + 2] = enhanced;
    }
    ctx.putImageData(imgData, 0, 0);

    return plateCanvas;
  }

  /**
   * cropFrameRegion — Crops a region of the full video frame based on fractional coordinates.
   */
  private cropFrameRegion(
    sourceCanvas: HTMLCanvasElement,
    xRatio: number,
    yRatio: number,
    wRatio: number,
    hRatio: number
  ): HTMLCanvasElement | null {
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const x = Math.round(sw * xRatio);
    const y = Math.round(sh * yRatio);
    const w = Math.round(sw * wRatio);
    const h = Math.round(sh * hRatio);

    if (w < 40 || h < 15) return null;

    const cropCanvas = document.createElement('canvas');
    const scale = 3;
    cropCanvas.width = w * scale;
    cropCanvas.height = h * scale;
    const ctx = cropCanvas.getContext('2d')!;

    ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w * scale, h * scale);

    const imgData = ctx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
      d[i] = d[i + 1] = d[i + 2] = enhanced;
    }
    ctx.putImageData(imgData, 0, 0);

    return cropCanvas;
  }

  /**
   * lookupVehicle — Checks if plate belongs to a registered app user.
   */
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

  /**
   * createSession — Saves the entrance event to the database.
   *
   * Creates a parking_session, plate_recognition, and notification.
   */
  private async createSession(result: EntranceResult): Promise<void> {
    try {
      // 1. Create parking session
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

      // 2. Log plate recognition event
      await supabase.from('plate_recognitions').insert({
        plate_number: result.plateNumber,
        vehicle_type: result.vehicleType,
        direction: 'entry',
        confidence: result.confidence,
        camera_name: 'Webcam Entrance',
        image_url: result.plateSnapshotUrl,
      });

      // 3. Create notification
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
 * ExitProcessor — Handles vehicle exit detection and payment triggering.
 *
 * At the exit camera, only plate number recognition is needed.
 * When a plate is confirmed:
 * 1. Finds the active parking session for that plate
 * 2. Calculates duration and total amount
 * 3. Completes the session with exit timestamp
 * 4. Creates a pending payment record
 * 5. Notifies the system
 */
export class ExitProcessor {
  private cameraManager: CameraManager;
  private plateReader: PlateReader;
  // Added YOLO detector and detections to mirror EntranceProcessor logic
  private detector: YOLODetector | null = null;
  private plateDetector: PlateDetector;
  private _detections: Detection[] = [];
  private intervalId: number | null = null;
  private lockedPlates: Set<string> = new Set();
  private _status: PipelineStatus = 'idle';
  private _lastResult: ExitResult | null = null;
  private statusCallbacks: ((status: PipelineStatus) => void)[] = [];
  private resultCallbacks: ((result: ExitResult) => void)[] = [];
  private detectionCallbacks: ((detections: Detection[]) => void)[] = [];
  private frameCallbacks: (() => void)[] = [];
  private _isProcessing = false;

  constructor() {
    this.cameraManager = new CameraManager();
    this.plateReader = new PlateReader();
    this.plateDetector = new PlateDetector();
  }

  /** Current pipeline status */
  get status(): PipelineStatus { return this._status; }
  /** Latest exit processing result */
  get lastResult(): ExitResult | null { return this._lastResult; }
  /** Access to underlying camera manager */
  get camera(): CameraManager { return this.cameraManager; }

  /** Register a status change listener */
  onStatusChange(cb: (status: PipelineStatus) => void): void { this.statusCallbacks.push(cb); }
  /** Register a result listener (session completed) */
  onResult(cb: (result: ExitResult) => void): void { this.resultCallbacks.push(cb); }

  /** Register detection updates (YOLO) */
  onDetections(cb: (detections: Detection[]) => void): void { this.detectionCallbacks.push(cb); }
  /** Register a frame processed listener (for overlay redraw) */
  onFrame(cb: () => void): void { this.frameCallbacks.push(cb); }

  private setStatus(status: PipelineStatus): void {
    this._status = status;
    this.statusCallbacks.forEach(cb => cb(status));
  }

  /**
   * initialize — Loads Tesseract worker for OCR.
   * YOLO is not needed for exit (plate-only).
   */
  async initialize(): Promise<void> {
    this.setStatus('loading');
    try {
      // Exit is plate-only; loading YOLO here added startup time and CPU load
      // without locating license plates.
      await this.plateReader.initialize();
      try {
        await this.plateDetector.loadModel();
        console.log('[ExitProcessor] Dedicated plate detector loaded');
      } catch {
        console.warn('[ExitProcessor] Dedicated plate model missing; using fixed-region fallback');
      }
      this.setStatus('idle');
    } catch (err) {
      this.setStatus('error');
      throw err;
    }
  }

  /**
   * startCamera — Opens the specified camera device for exit monitoring.
   */
  async startCamera(deviceId: string, videoEl: HTMLVideoElement): Promise<void> {
    await this.cameraManager.startStream(deviceId, videoEl);
  }

  /**
   * startProcessing — Begins the exit scan loop at ~2 FPS.
   *
   * Scans the entire frame for plate text (no YOLO needed,
   * the exit camera is focused on the plate area).
   */
  startProcessing(): void {
    if (this.intervalId) return;
    this.setStatus('scanning');

    // OCR-only loop; exit does not need the generic vehicle detector.
    const ocrLoop = () => window.setInterval(async () => {
      await this.processFrame();
    }, 700);

    this.intervalId = ocrLoop();
  }

  /** stopProcessing — Stops the scan loop. */
  stopProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._detections = [];
    this.setStatus('idle');
  }

  /** stop — Full cleanup. */
  async stop(): Promise<void> {
    this.stopProcessing();
    this.cameraManager.stopStream();
    await this.plateReader.dispose();
    this.lockedPlates.clear();
    if (this.detector) {
      this.detector.dispose();
      this.detector = null;
    }
    this.plateDetector.dispose();
  }

  /**
   * processFrame — Scans the frame for a license plate.
   *
   * Uses the center portion of the frame (where plates are typically
   * positioned at exit gates) for OCR.
   */
  private async processFrame(): Promise<void> {
    if (this._isProcessing) return;

    const frame = this.cameraManager.captureFrame();
    if (!frame) return;

    try {
      this._isProcessing = true;
      // Use the same multi-region OCR strategy as EntranceProcessor for better accuracy
      this.setStatus('reading_plate');

      const regions: HTMLCanvasElement[] = [];

      if (this.plateDetector.isLoaded) {
        const plateDetections = await this.plateDetector.detect(frame.imageData);
        const plateCrop = plateDetections[0] && cropDetectedPlate(frame.canvas, plateDetections[0].bbox);
        if (plateCrop) regions.push(plateCrop);
      }

      // Region 1: If YOLO detected a vehicle, crop the bottom of its bbox
      if (regions.length === 0 && this._detections && this._detections.length > 0) {
        const best = this._detections.reduce((a, b) => a.confidence > b.confidence ? a : b);
        const bboxCrop = this.cropPlateRegion(frame.canvas, best.bbox);
        if (bboxCrop) regions.push(bboxCrop);
      }

      // Keep only two focused regions to avoid serial OCR backlog.
      if (regions.length === 0) {
        const centerBottom = this.cropFrameRegion(frame.canvas, 0.15, 0.55, 0.70, 0.40);
        const center = this.cropFrameRegion(frame.canvas, 0.20, 0.30, 0.60, 0.40);
        if (centerBottom) regions.push(centerBottom);
        if (center) regions.push(center);
      }

      let plateResult: { plate: string; confidence: number } | null = null;
      let successRegion: HTMLCanvasElement | null = null;

      for (const region of regions) {
        plateResult = await this.plateReader.confirmPlate(region);
        if (plateResult && !this.lockedPlates.has(plateResult.plate)) {
          successRegion = region;
          break;
        }
        plateResult = null;
      }

      if (plateResult && successRegion) {
        this.setStatus('processing_exit');
        const exitResult = await this.processExit(plateResult.plate, plateResult.confidence);

        if (exitResult) {
          this.lockedPlates.add(plateResult.plate);
          this._lastResult = exitResult;
          this.setStatus('exit_complete');
          this.resultCallbacks.forEach(cb => cb(exitResult));

          setTimeout(() => {
            this.lockedPlates.delete(plateResult!.plate);
          }, 30000);
        } else {
          this.setStatus('scanning');
        }
      } else {
        this.setStatus(this._status === 'exit_complete' ? 'exit_complete' : 'scanning');
      }

      this._isProcessing = false;
    } catch (err) {
      console.error('[ExitProcessor] Frame processing error:', err);
      this._isProcessing = false;
      this.setStatus('scanning');
    }
  }

  /**
   * runYoloFrame — optional YOLO run to provide detections for exit guidance
   */
  private async runYoloFrame(): Promise<void> {
    if (!this.detector) return;
    const frame = this.cameraManager.captureFrame();
    if (!frame) return;

    try {
      const detections = await this.detector.detect(frame.imageData, 0.25);
      this._detections = detections;
      this.detectionCallbacks.forEach(cb => cb(detections));
      this.frameCallbacks.forEach(cb => cb());
      if (detections.length > 0 && this._status === 'scanning') {
        this.setStatus('detected');
      }
    } catch (err) {
      console.error('[ExitProcessor] YOLO error:', err);
    }
  }

  /**
   * cropPlateRegion — Extracts bottom portion of bbox (copied from EntranceProcessor)
   */
  private cropPlateRegion(
    sourceCanvas: HTMLCanvasElement,
    bbox: [number, number, number, number]
  ): HTMLCanvasElement | null {
    const [x1, y1, x2, y2] = bbox.map(Math.round);
    const bboxW = x2 - x1;
    const bboxH = y2 - y1;

    if (bboxW < 30 || bboxH < 20) return null;

    const plateY = y1 + Math.round(bboxH * 0.60);
    const plateH = y2 - plateY;
    const plateW = bboxW;

    if (plateW < 40 || plateH < 15) return null;

    const plateCanvas = document.createElement('canvas');
    const scale = 3;
    plateCanvas.width = plateW * scale;
    plateCanvas.height = plateH * scale;
    const ctx = plateCanvas.getContext('2d')!;

    ctx.drawImage(sourceCanvas, x1, plateY, plateW, plateH, 0, 0, plateW * scale, plateH * scale);

    const imgData = ctx.getImageData(0, 0, plateCanvas.width, plateCanvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
      d[i] = d[i + 1] = d[i + 2] = enhanced;
    }
    ctx.putImageData(imgData, 0, 0);

    return plateCanvas;
  }

  /**
   * cropFrameRegion — Crops a fractional region (copied from EntranceProcessor)
   */
  private cropFrameRegion(
    sourceCanvas: HTMLCanvasElement,
    xRatio: number,
    yRatio: number,
    wRatio: number,
    hRatio: number
  ): HTMLCanvasElement | null {
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const x = Math.round(sw * xRatio);
    const y = Math.round(sh * yRatio);
    const w = Math.round(sw * wRatio);
    const h = Math.round(sh * hRatio);

    if (w < 40 || h < 15) return null;

    const cropCanvas = document.createElement('canvas');
    const scale = 3;
    cropCanvas.width = w * scale;
    cropCanvas.height = h * scale;
    const ctx = cropCanvas.getContext('2d')!;

    ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w * scale, h * scale);

    const imgData = ctx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
      d[i] = d[i + 1] = d[i + 2] = enhanced;
    }
    ctx.putImageData(imgData, 0, 0);

    return cropCanvas;
  }

  /**
   * cropCenterRegion — Extracts the center portion of the frame for OCR.
   *
   * Takes the center 60% width × 30% height of the frame,
   * with grayscale + contrast preprocessing.
   */
  private cropCenterRegion(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement | null {
    const { width, height } = sourceCanvas;
    if (width < 100 || height < 80) return null;

    const cropW = Math.round(width * 0.6);
    const cropH = Math.round(height * 0.3);
    const cropX = Math.round((width - cropW) / 2);
    const cropY = Math.round((height - cropH) / 2);

    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = cropW * scale;
    canvas.height = cropH * scale;
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW * scale, cropH * scale);

    // Preprocess: grayscale + contrast
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
      d[i] = d[i + 1] = d[i + 2] = enhanced;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas;
  }

  /**
   * processExit — Finds the active session, calculates payment, and completes the session.
   *
   * @param plateNumber — The confirmed plate number from OCR
   * @param confidence — OCR confidence score
   * @returns ExitResult with session details and payment amount, or null if no active session
   */
  private async processExit(plateNumber: string, confidence: number): Promise<ExitResult | null> {
    try {
      // 1. Find active session for this plate
      const { data: sessions } = await supabase
        .from('parking_sessions')
        .select('*')
        .eq('plate_number', plateNumber)
        .eq('status', 'active')
        .order('entry_time', { ascending: false })
        .limit(1);

      if (!sessions || sessions.length === 0) {
        console.log(`[ExitProcessor] No active session found for ${plateNumber}`);
        return null;
      }

      const session = sessions[0];
      const exitTime = new Date();
      const entryTime = new Date(session.entry_time);
      const durationMs = exitTime.getTime() - entryTime.getTime();
      const durationHours = Math.max(0.5, Math.ceil((durationMs / (1000 * 60 * 60)) * 2) / 2); // Round up to nearest 0.5hr

      // 2. Get hourly rate from settings
      const rateKey = session.vehicle_type === 'motorcycle' ? 'hourly_rate_motorcycle' : 'hourly_rate_car';
      const { data: settingsData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', rateKey)
        .limit(1);

      const hourlyRate = settingsData && settingsData.length > 0 ? Number(settingsData[0].value) : (session.vehicle_type === 'motorcycle' ? 25 : 50);
      const totalAmount = durationHours * hourlyRate;

      // 3. Complete the session
      await supabase
        .from('parking_sessions')
        .update({
          status: 'completed',
          exit_time: exitTime.toISOString(),
          exit_camera: 'Webcam Exit',
        })
        .eq('id', session.id);

      // 4. Create payment record
      const { data: countData } = await supabase.from('payments').select('id');
      const receiptNum = `RCP-${exitTime.getFullYear()}-${String((countData?.length || 0) + 1).padStart(4, '0')}`;

      await supabase.from('payments').insert({
        receipt_number: receiptNum,
        plate_number: plateNumber,
        session_id: session.id,
        duration_hours: durationHours,
        hourly_rate: hourlyRate,
        total_amount: totalAmount,
        payment_method: session.concept === 'B' ? 'gcash' : 'cash', // Private users → wallet, Public → cash
        status: 'pending',
        processed_by: 'Vision System',
      });

      // 5. Log plate recognition for exit
      await supabase.from('plate_recognitions').insert({
        plate_number: plateNumber,
        vehicle_type: session.vehicle_type,
        direction: 'exit',
        confidence,
        camera_name: 'Webcam Exit',
      });

      // 6. Release the parking slot if assigned
      if (session.slot_id) {
        await supabase
          .from('parking_slots')
          .update({ status: 'available', current_session_id: null })
          .eq('slot_id', session.slot_id);
      }

      // 7. Create notification
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
