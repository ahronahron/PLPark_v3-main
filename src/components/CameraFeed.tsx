/**
 * CameraFeed.tsx — Live Camera Feed Component with Vision Pipeline
 *
 * This component renders a live camera feed with:
 * 1. Video stream from webcam/Iriun via getUserMedia
 * 2. Canvas overlay showing YOLO bounding boxes with labels
 * 3. Camera device selector dropdown
 * 4. Pipeline status indicators (scanning, detected, confirmed)
 * 5. Last confirmed plate display
 * 6. Start/Stop controls for the vision pipeline
 * 7. Mode switching between Entrance and Exit processing
 *
 * Integrates with EntranceProcessor and ExitProcessor from visionEngine.ts.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import {
  CameraManager,
  EntranceProcessor,
  ExitProcessor,
  SNAPSHOT_CONFIG,
  easyOcrHealth,
  formatPlateForDisplay,
  type CameraDevice,
  type Detection,
  type PlateDetection,
  type PipelineStatus,
  type EntranceResult,
  type ExitResult,
  type CapturedFrameData,
} from '@/lib/visionEngine';

/** Props for the CameraFeed component */
interface CameraFeedProps {
  /** Camera mode: 'entrance' processes YOLO+OCR, 'exit' processes OCR only */
  mode: 'entrance' | 'exit';
  /** Callback when a new entrance session is created */
  onEntranceResult?: (result: EntranceResult) => void;
  /** Callback when an exit session is completed */
  onExitResult?: (result: ExitResult) => void;
  /** Optional device assigned to this configured camera in Settings. */
  deviceId?: string | null;
}

/**
 * CameraFeed — Renders live camera with YOLO overlay and detection controls.
 */
export function CameraFeed({ mode, onEntranceResult, onExitResult, deviceId }: CameraFeedProps) {
  // ============================================================
  // REFS
  // ============================================================
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const entranceProcessorRef = useRef<EntranceProcessor | null>(null);
  const exitProcessorRef = useRef<ExitProcessor | null>(null);
  const captureUnsubRef = useRef<(() => void) | null>(null);
  const resumeUnsubRef = useRef<(() => void) | null>(null);

  // ============================================================
  // STATE
  // ============================================================
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [status, setStatus] = useState<PipelineStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initProgress, setInitProgress] = useState('');
  const [detections, setDetections] = useState<Detection[]>([]);
  const [plateDetections, setPlateDetections] = useState<PlateDetection[]>([]);
  const [lastPlate, setLastPlate] = useState<string>('');
  const [lastColor, setLastColor] = useState<string>('');
  const [lastType, setLastType] = useState<string>('');
  const [lastAccessState, setLastAccessState] = useState<string>('');
  const [lastExitInfo, setLastExitInfo] = useState<{ plate: string; amount: number; duration: number } | null>(null);
  const [error, setError] = useState<string>('');
  const [capturedSnapshot, setCapturedSnapshot] = useState<{
    text: string;
    confidence: number;
    attempts: number;
    timeTakenMs: number;
    image: string;
  } | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  const [isOcrOnline, setIsOcrOnline] = useState<boolean>(() => easyOcrHealth.isOnline);

  // Freeze capture state
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrameData | null>(null);
  const [isShutterFlashing, setIsShutterFlashing] = useState(false);
  const [readingStartTime, setReadingStartTime] = useState<number | null>(null);
  const [readingElapsedSec, setReadingElapsedSec] = useState<string>('0.0');
  const [lastResultData, setLastResultData] = useState<EntranceResult | ExitResult | null>(null);
  const [showResumeToast, setShowResumeToast] = useState(false);
  const [isFadingOutFreeze, setIsFadingOutFreeze] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    if (status === 'reading') {
      const start = readingStartTime || performance.now();
      timer = window.setInterval(() => {
        setReadingElapsedSec(((performance.now() - start) / 1000).toFixed(1));
      }, 50);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [status, readingStartTime]);

  useEffect(() => {
    const unsub = easyOcrHealth.subscribe(online => setIsOcrOnline(online));
    return unsub;
  }, []);

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /** Enumerate available cameras on mount */
  useEffect(() => {
    const cam = new CameraManager();
    cam.enumerateDevices().then(devs => {
      setDevices(devs);
      if (devs.length > 0) {
        setSelectedDevice(deviceId && devs.some(device => device.deviceId === deviceId) ? deviceId : devs[0].deviceId);
      }
    });
  }, [deviceId]);

  /**
   * drawOverlay — Draws YOLO bounding boxes on the canvas overlay.
   * Called on every processed frame.
   */
  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    // Match canvas size to video display size
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Scale factors from video natural size to display size
    const scaleX = rect.width / (video.videoWidth || 1);
    const scaleY = rect.height / (video.videoHeight || 1);

    // 1. Draw Vehicle Bounding Boxes
    for (const det of detections) {
      const [x1, y1, x2, y2] = det.bbox;
      const dx = x1 * scaleX;
      const dy = y1 * scaleY;
      const dw = (x2 - x1) * scaleX;
      const dh = (y2 - y1) * scaleY;

      // Bounding box
      ctx.strokeStyle = det.vehicleType === 'motorcycle' ? '#f59e0b' : '#22d3ee';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(dx, dy, dw, dh);

      // Corner accents
      const cornerLen = Math.min(15, dw * 0.15, dh * 0.15);
      ctx.lineWidth = 3;
      ctx.strokeStyle = det.vehicleType === 'motorcycle' ? '#f59e0b' : '#22d3ee';

      // Top-left corner
      ctx.beginPath();
      ctx.moveTo(dx, dy + cornerLen);
      ctx.lineTo(dx, dy);
      ctx.lineTo(dx + cornerLen, dy);
      ctx.stroke();

      // Top-right corner
      ctx.beginPath();
      ctx.moveTo(dx + dw - cornerLen, dy);
      ctx.lineTo(dx + dw, dy);
      ctx.lineTo(dx + dw, dy + cornerLen);
      ctx.stroke();

      // Bottom-left corner
      ctx.beginPath();
      ctx.moveTo(dx, dy + dh - cornerLen);
      ctx.lineTo(dx, dy + dh);
      ctx.lineTo(dx + cornerLen, dy + dh);
      ctx.stroke();

      // Bottom-right corner
      ctx.beginPath();
      ctx.moveTo(dx + dw - cornerLen, dy + dh);
      ctx.lineTo(dx + dw, dy + dh);
      ctx.lineTo(dx + dw, dy + dh - cornerLen);
      ctx.stroke();

      // Label background
      const label = `${det.className} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = '12px Inter, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const labelH = 20;

      ctx.fillStyle = det.vehicleType === 'motorcycle' ? 'rgba(245, 158, 11, 0.85)' : 'rgba(34, 211, 238, 0.85)';
      ctx.fillRect(dx, dy - labelH, textWidth + 10, labelH);

      ctx.fillStyle = '#000';
      ctx.fillText(label, dx + 5, dy - 6);

      // Color badge
      if (det.color) {
        const colorLabel = det.color;
        const cw = ctx.measureText(colorLabel).width;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(dx, dy + dh + 2, cw + 10, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(colorLabel, dx + 5, dy + dh + 14);
      }
    }

    // 2. Draw License Plate Bounding Boxes (Neon Green)
    for (const pDet of plateDetections) {
      const [px1, py1, px2, py2] = pDet.bbox;
      const pdx = px1 * scaleX;
      const pdy = py1 * scaleY;
      const pdw = (px2 - px1) * scaleX;
      const pdh = (py2 - py1) * scaleY;

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(pdx, pdy, pdw, pdh);

      const pLabel = `PLATE ${(pDet.confidence * 100).toFixed(0)}%`;
      ctx.font = 'bold 11px Inter, sans-serif';
      const pTextW = ctx.measureText(pLabel).width;
      ctx.fillStyle = 'rgba(34, 197, 94, 0.9)';
      ctx.fillRect(pdx, pdy - 18, pTextW + 8, 18);
      ctx.fillStyle = '#000000';
      ctx.fillText(pLabel, pdx + 4, pdy - 5);
    }
  }, [detections, plateDetections]);

  /** Redraw overlay whenever detections change */
  useEffect(() => {
    drawOverlay();
  }, [detections, plateDetections, drawOverlay]);

  // ============================================================
  // PIPELINE CONTROLS
  // ============================================================

  /**
   * handleStart — Initializes the vision pipeline and starts processing.
   */
  const handleStart = async () => {
    if (!videoRef.current) return;
    setError('');

    try {
      if (mode === 'entrance') {
        setInitProgress('Loading models...');
        const processor = new EntranceProcessor();

        processor.onStatusChange((s) => setStatus(s));
        processor.onDetections((d) => setDetections(d));
        processor.onPlateDetections((pd) => setPlateDetections(pd));

        const unsubCap = processor.onCapture((data) => {
          setCapturedFrame(data);
          setReadingStartTime(performance.now());
          setReadingElapsedSec('0.0');
          setIsShutterFlashing(true);
          setTimeout(() => setIsShutterFlashing(false), 150);
        });
        captureUnsubRef.current = unsubCap;

        const unsubRes = processor.onResume(() => {
          setIsFadingOutFreeze(true);
          setShowResumeToast(true);
          setTimeout(() => {
            setCapturedFrame(null);
            setIsFadingOutFreeze(false);
          }, 300);
          setTimeout(() => {
            setShowResumeToast(false);
          }, 1500);
        });
        resumeUnsubRef.current = unsubRes;

        processor.onResult((result) => {
          setLastResultData(result);
          setLastPlate(result.plateNumber);
          setLastColor(result.color);
          setLastType(result.vehicleType);
          setLastAccessState(result.isPrivate ? 'Registered' : 'Guest');

          if (result.capturedImage) {
            if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
            setCapturedSnapshot({
              text: result.plateNumber,
              confidence: result.confidence,
              attempts: result.attempts || 1,
              timeTakenMs: result.timeTakenMs || 0,
              image: result.capturedImage,
            });
            snapshotTimerRef.current = window.setTimeout(() => {
              setCapturedSnapshot(null);
            }, SNAPSHOT_CONFIG.DISPLAY_DURATION_MS);
          }

          onEntranceResult?.(result);
        });
        processor.onFrame(() => drawOverlay());

        await processor.initialize();
        setInitProgress('Starting camera...');
        await processor.startCamera(selectedDevice, videoRef.current);
        processor.startProcessing();

        entranceProcessorRef.current = processor;
      } else {
        // Exit mode
        setInitProgress('Loading models...');
        const processor = new ExitProcessor();

        processor.onStatusChange((s) => setStatus(s));
        processor.onDetections((d) => setDetections(d));
        processor.onPlateDetections((pd) => setPlateDetections(pd));

        const unsubCap = processor.onCapture((data) => {
          setCapturedFrame(data);
          setReadingStartTime(performance.now());
          setReadingElapsedSec('0.0');
          setIsShutterFlashing(true);
          setTimeout(() => setIsShutterFlashing(false), 150);
        });
        captureUnsubRef.current = unsubCap;

        const unsubRes = processor.onResume(() => {
          setIsFadingOutFreeze(true);
          setShowResumeToast(true);
          setTimeout(() => {
            setCapturedFrame(null);
            setIsFadingOutFreeze(false);
          }, 300);
          setTimeout(() => {
            setShowResumeToast(false);
          }, 1500);
        });
        resumeUnsubRef.current = unsubRes;

        processor.onFrame(() => drawOverlay());
        processor.onResult((result) => {
          setLastResultData(result);
          setLastExitInfo({
            plate: result.plateNumber,
            amount: result.totalAmount,
            duration: result.durationHours,
          });

          if (result.capturedImage) {
            if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
            setCapturedSnapshot({
              text: result.plateNumber,
              confidence: result.confidence,
              attempts: result.attempts || 1,
              timeTakenMs: result.timeTakenMs || 0,
              image: result.capturedImage,
            });
            snapshotTimerRef.current = window.setTimeout(() => {
              setCapturedSnapshot(null);
            }, SNAPSHOT_CONFIG.DISPLAY_DURATION_MS);
          }

          onExitResult?.(result);
        });

        await processor.initialize();
        setInitProgress('Starting camera...');
        await processor.startCamera(selectedDevice, videoRef.current);
        processor.startProcessing();

        exitProcessorRef.current = processor;
      }

      setIsInitialized(true);
      setIsRunning(true);
      setInitProgress('');
    } catch (err: any) {
      setError(err.message || 'Failed to start vision pipeline');
      setInitProgress('');
    }
  };

  /**
   * handleStop — Stops processing and releases camera.
   */
  const handleStop = async () => {
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    setCapturedSnapshot(null);

    if (captureUnsubRef.current) {
      captureUnsubRef.current();
      captureUnsubRef.current = null;
    }
    if (resumeUnsubRef.current) {
      resumeUnsubRef.current();
      resumeUnsubRef.current = null;
    }
    setCapturedFrame(null);
    setIsShutterFlashing(false);
    setShowResumeToast(false);
    setIsFadingOutFreeze(false);
    setLastResultData(null);

    if (entranceProcessorRef.current) {
      await entranceProcessorRef.current.stop();
      entranceProcessorRef.current = null;
    }
    if (exitProcessorRef.current) {
      await exitProcessorRef.current.stop();
      exitProcessorRef.current = null;
    }

    setIsRunning(false);
    setIsInitialized(false);
    setDetections([]);
    setPlateDetections([]);
    setStatus('idle');

    // Clear canvas
    const canvas = overlayRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  /** Cleanup on unmount */
  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (captureUnsubRef.current) captureUnsubRef.current();
      if (resumeUnsubRef.current) resumeUnsubRef.current();
      entranceProcessorRef.current?.stop();
      exitProcessorRef.current?.stop();
    };
  }, []);

  // ============================================================
  // STATUS DISPLAY HELPERS
  // ============================================================

  const statusConfig: Record<PipelineStatus, { label: string; className: string }> = {
    idle: { label: 'Idle', className: 'status-idle' },
    loading: { label: 'Loading...', className: 'status-loading' },
    scanning: { label: 'Scanning', className: 'status-scanning' },
    detected: { label: 'Vehicle Detected', className: 'status-detected' },
    reading_plate: { label: 'Reading Plate...', className: 'status-reading' },
    captured: { label: 'Plate Captured', className: 'status-captured' },
    reading: { label: 'Reading Plate...', className: 'status-reading' },
    result: { label: 'Plate Confirmed!', className: 'status-confirmed' },
    confirmed: { label: 'Plate Confirmed!', className: 'status-confirmed' },
    processing_exit: { label: 'Processing Exit...', className: 'status-reading' },
    exit_complete: { label: 'Exit Complete!', className: 'status-confirmed' },
    error: { label: 'Error', className: 'status-error' },
  };

  const currentStatus = statusConfig[status];

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="camera-feed-live">
      {/* Video + Overlay Container */}
      <div className="camera-video-container">
        <video
          ref={videoRef}
          className="camera-video-element"
          playsInline
          muted
        />
        <canvas
          ref={overlayRef}
          className="camera-overlay-canvas"
        />

        {/* 150ms White Shutter Flash Effect */}
        {isShutterFlashing && <div className="camera-shutter-flash" />}

        {/* Frozen Frame View (Pauses detection overlay, swaps displayed view, keeps camera tracks alive underneath) */}
        {capturedFrame && (status === 'captured' || status === 'reading' || status === 'result' || isFadingOutFreeze) && (
          <div className={`camera-freeze-container ${isFadingOutFreeze ? 'freeze-frame-fade-out' : ''}`}>
            <img
              src={capturedFrame.fullFrameDataUrl}
              alt="Captured freeze frame"
              className="camera-freeze-image"
            />

            {/* Plate Highlight Box */}
            {capturedFrame.plateBbox && capturedFrame.frameWidth > 0 && (
              <div
                className={`plate-highlight-box ${status === 'reading' ? 'plate-box-pulsing' : ''}`}
                style={{
                  left: `${(capturedFrame.plateBbox[0] / capturedFrame.frameWidth) * 100}%`,
                  top: `${(capturedFrame.plateBbox[1] / capturedFrame.frameHeight) * 100}%`,
                  width: `${((capturedFrame.plateBbox[2] - capturedFrame.plateBbox[0]) / capturedFrame.frameWidth) * 100}%`,
                  height: `${((capturedFrame.plateBbox[3] - capturedFrame.plateBbox[1]) / capturedFrame.frameHeight) * 100}%`,
                }}
              >
                {/* Sweeping scan line during OCR reading */}
                {status === 'reading' && <div className="plate-scan-line" />}

                {/* Badge during captured stage */}
                {status === 'captured' && (
                  <span className={`plate-highlight-badge ${capturedFrame.isRetake ? 'retaking' : ''}`}>
                    {capturedFrame.isRetake ? 'Retaking...' : 'PLATE CAPTURED'}
                  </span>
                )}
              </div>
            )}

            {/* Reading stage overlay text & elapsed timer */}
            {status === 'reading' && (
              <div className="camera-reading-banner">
                <span className="camera-reading-spinner" />
                <span>Please hold still — reading plate...</span>
                <span className="reading-elapsed-time">{readingElapsedSec}s</span>
              </div>
            )}

            {/* Result stage: characters typewriter reveal, confidence bar, badges */}
            {status === 'result' && lastResultData && (
              <div className="camera-result-card">
                {lastResultData.unreadable || !lastResultData.plateNumber || lastResultData.plateNumber === 'UNREADABLE' ? (
                  <div className="plate-unreadable-badge">
                    <span>⚠</span>
                    <span>Could not read — manual entry</span>
                  </div>
                ) : lastResultData.incomplete ? (
                  <div className="plate-unreadable-badge" style={{ background: 'rgba(217, 119, 6, 0.95)', borderColor: '#f59e0b' }}>
                    <span>⚠</span>
                    <span>Incomplete ({lastResultData.reason || 'partial'}) — manual entry</span>
                  </div>
                ) : (
                  <>
                    <div className="plate-styled-box">
                      <span className="plate-check-icon">✓</span>
                      {formatPlateForDisplay(lastResultData.plateNumber).split('').map((char, idx) => (
                        <span
                          key={idx}
                          className="typewriter-char"
                          style={{
                            animationDelay: `${idx * 40}ms`,
                            marginRight: char === ' ' ? '8px' : undefined,
                            display: char === ' ' ? 'inline-block' : undefined,
                            width: char === ' ' ? '10px' : undefined,
                          }}
                        >
                          {char === ' ' ? '\u00A0' : char}
                        </span>
                      ))}
                    </div>

                    <div className="plate-conf-wrapper">
                      <span>Conf: {lastResultData.confidence}%</span>
                      <div className="plate-conf-bar-bg">
                        <div
                          className="plate-conf-bar-fill"
                          style={{ width: `${Math.min(100, Math.max(0, lastResultData.confidence))}%` }}
                        />
                      </div>
                      {'isPrivate' in lastResultData ? (
                        <span className={lastResultData.isPrivate ? 'badge-registered' : 'badge-guest'}>
                          {lastResultData.isPrivate ? 'Registered' : 'Guest'}
                        </span>
                      ) : (
                        <span className="badge-registered">Exit Validated</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Resume: Ready for next vehicle indicator */}
        {showResumeToast && (
          <div className="resume-ready-indicator">
            ✓ Ready for next vehicle
          </div>
        )}

        {/* Status Badge (top-left overlay) */}
        {isRunning && (
          <div className={`camera-status-badge ${currentStatus.className}`}>
            <span className="camera-status-dot" />
            {currentStatus.label}
          </div>
        )}

        {/* OCR Offline Badge */}
        {!isOcrOnline && (
          <div className="camera-ocr-offline-badge animate-fade-in" role="alert">
            ⚠ OCR service offline - using slower fallback
          </div>
        )}

        {/* Mode Badge (top-right overlay) */}
        <div className={`camera-mode-badge ${mode}`}>
          {mode === 'entrance' ? '🚗 ENTRANCE' : '🚪 EXIT'}
        </div>

        {/* Confirmed Plate (bottom overlay) */}
        {lastPlate && (
          <div className="camera-plate-result">
            <div className="camera-plate-number">{formatPlateForDisplay(lastPlate)}</div>
            <div className="camera-plate-details">
              {lastAccessState && <span className="camera-plate-type">{lastAccessState}</span>}
              {!lastAccessState && lastType && <span className="camera-plate-type">{lastType}</span>}
              {lastColor && <span className="camera-plate-color">{lastColor}</span>}
            </div>
          </div>
        )}

        {/* Exit Result (bottom overlay) */}
        {lastExitInfo && mode === 'exit' && (
          <div className="camera-exit-result">
            <div className="camera-plate-number">{formatPlateForDisplay(lastExitInfo.plate)}</div>
            <div className="camera-exit-details">
              <span>Duration: {lastExitInfo.duration}h</span>
              <span className="camera-exit-amount">₱{lastExitInfo.amount.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Loading Progress */}
        {initProgress && (
          <div className="camera-init-overlay">
            <div className="camera-init-spinner" />
            <span>{initProgress}</span>
          </div>
        )}

        {/* Error Overlay (shown if model loading or camera start fails) */}
        {error && !isRunning && (
          <div className="camera-error-overlay" style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.9)',
            color: '#ef4444',
            padding: '24px',
            textAlign: 'center',
            zIndex: 20
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginBottom: '12px' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '6px', color: '#f87171' }}>Failed to initialize camera or models</div>
            <div style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '360px', marginBottom: '16px' }}>{error}</div>
            <button
              type="button"
              onClick={() => { setError(''); handleStart(); }}
              style={{
                padding: '8px 18px',
                background: '#2563eb',
                color: '#fff',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px'
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Idle State (no camera started) */}
        {!isRunning && !initProgress && !error && (
          <div className="camera-idle-overlay">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Select a camera and click Start</span>
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="camera-controls-bar">
        {/* Device Selector */}
        <div className="camera-device-select">
          <select
            value={selectedDevice}
            onChange={e => setSelectedDevice(e.target.value)}
            disabled={isRunning}
          >
            {devices.length === 0 && <option value="">No cameras found</option>}
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {/* Start / Stop Buttons */}
        <div className="camera-action-btns">
          {!isRunning ? (
            <button
              className="camera-start-btn"
              onClick={handleStart}
              disabled={devices.length === 0 || !!initProgress}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              Start {mode === 'entrance' ? 'Detection' : 'Exit Scan'}
            </button>
          ) : (
            <button className="camera-stop-btn" onClick={handleStop}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop
            </button>
          )}
        </div>

        {/* Detection Count */}
        {isRunning && mode === 'entrance' && (
          <div className="camera-detection-count">
            <span className="camera-det-num">{detections.length}</span>
            <span className="camera-det-label">vehicle{detections.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="camera-error-bar">
          <span>⚠ {error}</span>
          <button onClick={() => setError('')}>✕</button>
        </div>
      )}
    </div>
  );
}
