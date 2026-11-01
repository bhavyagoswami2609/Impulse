import * as THREE from 'three';
import { TABLE_WIDTH, TABLE_HEIGHT, TABLE_LENGTH } from '../graphics/procedural_models.js';

/**
 * LowPassFilter component for OneEuroFilter
 */
class LowPassFilter {
  constructor(alpha = 0.5) {
    this.alpha = alpha;
    this.s = null;
  }
  filter(val, alpha = this.alpha) {
    if (this.s === null) {
      this.s = val;
    } else {
      this.s = alpha * val + (1.0 - alpha) * this.s;
    }
    return this.s;
  }
  reset() {
    this.s = null;
  }
}

/**
 * 1D One Euro Filter (Casiez et al., CHI 2012)
 * Adaptive low-pass filter: cutoff frequency fc = minCutoff + beta * |dx/dt|
 * Eliminates jitter at low velocities while minimizing lag during fast strokes.
 */
export class OneEuroFilter {
  constructor(minCutoff = 1.2, beta = 0.04, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.prevX = null;
    this.prevTime = null;
  }

  alpha(rate, cutoff) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  filter(x, timestampOrDt) {
    if (this.prevX === null) {
      this.prevX = x;
      this.prevTime = typeof timestampOrDt === 'number' && timestampOrDt > 1.0 ? timestampOrDt : performance.now();
      return this.xFilter.filter(x, 1.0);
    }

    let dt = 0.016;
    if (typeof timestampOrDt === 'number') {
      if (timestampOrDt < 1.0) {
        dt = Math.max(0.001, timestampOrDt);
      } else {
        dt = Math.max(0.001, (timestampOrDt - this.prevTime) / 1000.0);
        this.prevTime = timestampOrDt;
      }
    }

    const rate = 1.0 / dt;
    const dx = (x - this.prevX) / dt;
    this.prevX = x;

    const aD = this.alpha(rate, this.dCutoff);
    const edx = this.dxFilter.filter(dx, aD);

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const a = this.alpha(rate, cutoff);
    return this.xFilter.filter(x, a);
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.prevX = null;
    this.prevTime = null;
  }
}

/**
 * Ensures MediaPipe Hands library is loaded in the window.
 * Checks existing global window.Hands, polls, and falls back to dynamic CDN script injection if needed.
 */
export async function ensureHandsLibrary() {
  if (typeof window.Hands !== 'undefined') return true;

  // Poll for up to 6 seconds in case script tag in index.html is still downloading
  const start = performance.now();
  while (typeof window.Hands === 'undefined' && performance.now() - start < 6000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (typeof window.Hands !== 'undefined') return true;

  // Fallback: inject script from unpkg
  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-mp-hands-fallback]');
    if (existing) {
      existing.addEventListener('load', () => resolve(typeof window.Hands !== 'undefined'));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.setAttribute('data-mp-hands-fallback', 'true');
    script.src = 'https://unpkg.com/@mediapipe/hands/hands.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(typeof window.Hands !== 'undefined');
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

/**
 * HandTracker manages MediaPipe Hands tracking, webcam video feed,
 * relative position calibration, 1D One Euro filtering for (x, y, z, yaw),
 * Y-axis wrist angling, and open/closed hand gesture detection.
 */
export class HandTracker {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.canvasElement = options.canvasElement || null;
    this.canvasCtx = this.canvasElement ? this.canvasElement.getContext('2d') : null;

    this.onStatusChange = options.onStatusChange || (() => {});
    this.onCalibrationUpdate = options.onCalibrationUpdate || (() => {});
    this.onGestureCalibrate = options.onGestureCalibrate || (() => {});

    // Spider-Man (🤟) gesture calibration states
    this.spidermanGestureTimer = 0;
    this.spidermanGestureCooldown = 0;
    this.spidermanGestureProgress = 0;
    this.gestureCalibratedFlashTimer = 0;
    this.lastResultsTimestamp = 0;

    this.isTracking = false;
    this.isStarting = false;
    this.startPromise = null;
    this.mediaStream = null;
    this.frameCallbackId = null;
    this.frameAnimId = null;
    this.lastError = null;

    this.handDetected = false;
    this.lastDetectedTime = 0;
    this.cameraInstance = null;
    this.handsInstance = null;

    // Control mode: starts as 'webcam' by default, falls back to 'mouse' if camera unavailable or toggled off
    this.controlMode = 'webcam';
    this.playerRole = 'host'; // 'host' (P1, South) or 'client' (P2, North)

    // Neutral baseline for relative tracking
    this.neutralHand = {
      x: 0.5,
      y: 0.5,
      depth: 0.22,
      yaw: 0,
    };
    this.isCalibrated = false;
    this.autoCalibrateTimer = 0;

    // Direct mapping by default: physical hand moves right -> screen paddle/striker moves right
    this.invertX = false;
    this.settings = {
      sensitivityX: 2.4,
      sensitivityY: 2.0,
      sensitivityZ: 2.0,
      smoothSpeed: 28.0,
    };

    // 1D One Euro Filters for x, y, z, and Y-axis yaw
    this.xFilter = new OneEuroFilter(1.2, 0.04, 1.0);
    this.yFilter = new OneEuroFilter(1.2, 0.04, 1.0);
    this.zFilter = new OneEuroFilter(1.2, 0.04, 1.0);
    this.yawFilter = new OneEuroFilter(1.2, 0.04, 1.0);

    // Dynamic rotation & gesture states
    this.currentYaw = 0;
    this.isHandOpen = false;
    this.wasHandOpen = false;
    this.justOpenedHand = false;
    this.activeBallHeight = null;

    // Court limits
    this.courtLimits = {
      p1: {
        minX: -TABLE_WIDTH * 0.70,
        maxX: TABLE_WIDTH * 0.70,
        minY: TABLE_HEIGHT + 0.04,
        maxY: TABLE_HEIGHT + 0.65,
        minZ: -TABLE_LENGTH * 0.75,
        maxZ: -0.35,
      },
      p2: {
        minX: -TABLE_WIDTH * 0.70,
        maxX: TABLE_WIDTH * 0.70,
        minY: TABLE_HEIGHT + 0.04,
        maxY: TABLE_HEIGHT + 0.65,
        minZ: 0.35,
        maxZ: TABLE_LENGTH * 0.75,
      },
    };

    // Position & Velocity State
    this.basePosition = new THREE.Vector3(0, 0.95, -1.45);
    this.targetPosition = this.basePosition.clone();
    this.currentPosition = this.basePosition.clone();
    this.previousPosition = this.basePosition.clone();
    this.velocity = new THREE.Vector3();

    // Orientation State
    this.targetQuaternion = new THREE.Quaternion();
    this.currentQuaternion = new THREE.Quaternion();

    // Mouse fallback tracking state
    this.mouseTarget = new THREE.Vector3(0, 0.95, -1.45);
    this.isMouseDown = false;
    this.swingBoostTimer = 0;

    // Relative readouts
    this.relativeReadout = { dx: 0, dy: 0, dz: 0, yaw: '0°', direction: 'CENTER', hand: 'CLOSED' };

    this.setupMouseEvents();
  }

  setPlayerRole(role) {
    this.playerRole = role;
    if (role === 'client') {
      this.basePosition.set(0, 0.95, 1.45);
      this.mouseTarget.set(0, 0.95, 1.45);
    } else {
      this.basePosition.set(0, 0.95, -1.45);
      this.mouseTarget.set(0, 0.95, -1.45);
    }
    this.targetPosition.copy(this.basePosition);
    this.currentPosition.copy(this.basePosition);
    this.previousPosition.copy(this.basePosition);
    this.velocity.set(0, 0, 0);

    this.xFilter.reset();
    this.yFilter.reset();
    this.zFilter.reset();
    this.yawFilter.reset();
  }

  /**
   * Recalibrate neutral center from current hand position
   */
  setNeutralCenter(handData = null) {
    const src = handData || this.lastRawHand;
    if (src) {
      this.neutralHand.x = src.x;
      this.neutralHand.y = src.y;
      this.neutralHand.depth = src.depth || 0.22;
      this.neutralHand.yaw = src.yaw || 0;
    }
    this.isCalibrated = true;

    this.xFilter.reset();
    this.yFilter.reset();
    this.zFilter.reset();
    this.yawFilter.reset();

    this.onCalibrationUpdate({
      status: 'calibrated',
      neutral: this.neutralHand,
      message: 'Center Position Locked',
    });
  }

  /**
   * Mouse events with 2D mapping (normX -> X, normY -> Z forward/back)
   */
  setupMouseEvents() {
    window.addEventListener('mousemove', (e) => {
      const isHandActive = this.controlMode === 'webcam' && (performance.now() - this.lastDetectedTime < 800);
      if (isHandActive) return;

      const normX = (e.clientX / window.innerWidth) * 2 - 1;
      const normY = -(e.clientY / window.innerHeight) * 2 + 1; // Top = +1, Bottom = -1

      const limits = this.playerRole === 'host' ? this.courtLimits.p1 : this.courtLimits.p2;

      // In Three.js:
      // Host camera is at -Z looking towards +Z:
      // Mouse moving right (normX > 0) maps to screen right (world negative X: -courtX)
      // Mouse moving left (normX < 0) maps to screen left (world positive X: -courtX)
      const courtX = normX * (TABLE_WIDTH * 0.70);
      const targetX = THREE.MathUtils.clamp(
        this.playerRole === 'client' ? courtX : -courtX,
        limits.minX,
        limits.maxX
      );

      // Map mouse vertical movement (normY) to forward/back (Z-axis):
      // Moving mouse UP on screen (normY > 0) pushes FORWARD (+Z for host, -Z for client)
      // Moving mouse DOWN on screen (normY < 0) pulls BACKWARD (-Z for host, +Z for client)
      let targetZ;
      if (this.playerRole === 'host') {
        targetZ = THREE.MathUtils.clamp(-1.15 + normY * 0.65, limits.minZ, limits.maxZ);
      } else {
        targetZ = THREE.MathUtils.clamp(1.15 - normY * 0.65, limits.minZ, limits.maxZ);
      }

      const targetY = THREE.MathUtils.clamp(
        TABLE_HEIGHT + 0.16 + normY * 0.14,
        limits.minY,
        limits.maxY
      );

      this.mouseTarget.set(targetX, targetY, targetZ);
      this.targetPosition.copy(this.mouseTarget);
    });

    window.addEventListener('wheel', (e) => {
      const isHandActive = this.controlMode === 'webcam' && (performance.now() - this.lastDetectedTime < 800);
      if (isHandActive) return;

      const limits = this.playerRole === 'host' ? this.courtLimits.p1 : this.courtLimits.p2;
      const step = e.deltaY * 0.002;

      if (this.playerRole === 'host') {
        this.mouseTarget.z = THREE.MathUtils.clamp(this.mouseTarget.z + step, limits.minZ, limits.maxZ);
      } else {
        this.mouseTarget.z = THREE.MathUtils.clamp(this.mouseTarget.z - step, limits.minZ, limits.maxZ);
      }
      this.targetPosition.z = this.mouseTarget.z;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        this.swingBoostTimer = 0.22;
        // Mouse click also simulates gesture trigger
        this.justOpenedHand = true;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
      this.justOpenedHand = false;
    });
  }

  async startWebcamTracking() {
    if (this.isTracking) return true;
    if (this.startPromise) return this.startPromise;

    this.isStarting = true;
    this.lastError = null;
    this.onStatusChange({ status: 'initializing', message: 'Starting webcam...' });

    this.startPromise = (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          const isHttps = window.location.protocol === 'https:';
          const err = new Error(
            !isLocalhost && !isHttps
              ? 'Webcam requires HTTPS or localhost.'
              : 'Webcam API not supported in this browser.'
          );
          err.name = 'InsecureContextError';
          throw err;
        }

        // 1. Request webcam access directly via native Web API.
        // This triggers the browser's native camera permission dialog immediately.
        const constraints = {
          audio: false,
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.mediaStream = stream;

        if (this.videoElement) {
          this.videoElement.srcObject = stream;
          this.videoElement.muted = true;
          this.videoElement.setAttribute('playsinline', '');
          this.videoElement.setAttribute('autoplay', '');

          await new Promise((resolve) => {
            if (this.videoElement.readyState >= 2) {
              resolve();
            } else {
              let resolved = false;
              const onReady = () => {
                if (!resolved) {
                  resolved = true;
                  resolve();
                }
              };
              this.videoElement.onloadedmetadata = onReady;
              this.videoElement.onloadeddata = onReady;
              setTimeout(onReady, 1200);
            }
          });

          try {
            await this.videoElement.play();
          } catch (e) {
            console.warn('Video play warning:', e);
          }
        }

        // 2. Ensure MediaPipe Hands library is ready
        this.onStatusChange({ status: 'initializing', message: 'Loading Vision AI...' });
        const hasHands = await ensureHandsLibrary();
        if (!hasHands || typeof window.Hands === 'undefined') {
          const err = new Error('Failed to load MediaPipe Hands model.');
          err.name = 'ModelLoadError';
          throw err;
        }

        if (!this.handsInstance) {
          this.handsInstance = new window.Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
          });

          this.handsInstance.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.55,
          });

          this.handsInstance.onResults(this.onMediaPipeResults.bind(this));
        }

        this.isTracking = true;
        this.isStarting = false;
        this.controlMode = 'webcam';
        this.isCalibrated = false;
        this.autoCalibrateTimer = 0;

        // 3. Start high-performance frame processing loop
        this.startProcessingLoop();

        this.onStatusChange({ status: 'active', message: 'Hand Tracking Active' });
        return true;
      } catch (err) {
        console.warn('Webcam initialization failed:', err);
        this.isTracking = false;
        this.isStarting = false;
        this.controlMode = 'mouse';

        let errType = 'unknown';
        let userMessage = 'Webcam unavailable. Mouse controls active.';

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errType = 'not_allowed';
          userMessage = 'Camera permission denied. Mouse controls active.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errType = 'not_found';
          userMessage = 'No webcam detected. Mouse controls active.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errType = 'not_readable';
          userMessage = 'Webcam in use by another app. Mouse controls active.';
        } else if (err.name === 'InsecureContextError') {
          errType = 'insecure';
          userMessage = 'Webcam requires HTTPS or localhost.';
        } else if (err.name === 'ModelLoadError') {
          errType = 'model_failed';
          userMessage = 'Vision model failed to load. Mouse controls active.';
        }

        this.lastError = { type: errType, message: userMessage, original: err };
        this.onStatusChange({
          status: 'error',
          errorType: errType,
          message: userMessage,
        });

        this.stopWebcamTracking();
        return false;
      } finally {
        this.isStarting = false;
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  startProcessingLoop() {
    this.stopProcessingLoop();

    let isProcessing = false;
    const processFrame = async () => {
      if (!this.isTracking) return;

      if (this.videoElement && this.videoElement.readyState >= 2) {
        // Live camera preview: if not processing or no hand detected yet, keep canvas updated
        if (this.canvasCtx && this.canvasElement && (!this.handDetected || performance.now() - this.lastDetectedTime > 600)) {
          try {
            this.canvasCtx.save();
            this.canvasCtx.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);
            this.canvasCtx.restore();
          } catch (e) {}
        }

        if (!isProcessing && this.handsInstance) {
          isProcessing = true;
          try {
            await this.handsInstance.send({ image: this.videoElement });
          } catch (err) {
            console.warn('MediaPipe send frame error:', err);
          } finally {
            isProcessing = false;
          }
        }
      }

      if (this.isTracking) {
        if ('requestVideoFrameCallback' in this.videoElement) {
          this.frameCallbackId = this.videoElement.requestVideoFrameCallback(processFrame);
        } else {
          this.frameAnimId = requestAnimationFrame(processFrame);
        }
      }
    };

    if (this.videoElement) {
      if ('requestVideoFrameCallback' in this.videoElement) {
        this.frameCallbackId = this.videoElement.requestVideoFrameCallback(processFrame);
      } else {
        this.frameAnimId = requestAnimationFrame(processFrame);
      }
    }
  }

  stopProcessingLoop() {
    if (this.frameCallbackId && this.videoElement && 'cancelVideoFrameCallback' in this.videoElement) {
      try {
        this.videoElement.cancelVideoFrameCallback(this.frameCallbackId);
      } catch (e) {}
      this.frameCallbackId = null;
    }
    if (this.frameAnimId) {
      cancelAnimationFrame(this.frameAnimId);
      this.frameAnimId = null;
    }
  }

  stopWebcamTracking() {
    this.isTracking = false;
    this.isStarting = false;
    this.startPromise = null;

    this.stopProcessingLoop();

    if (this.cameraInstance) {
      try {
        this.cameraInstance.stop();
      } catch (e) {}
      this.cameraInstance = null;
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch (e) {}
      this.mediaStream = null;
    }

    if (this.videoElement && this.videoElement.srcObject) {
      try {
        const stream = this.videoElement.srcObject;
        if (stream && stream.getTracks) {
          stream.getTracks().forEach((track) => track.stop());
        }
        this.videoElement.srcObject = null;
      } catch (e) {}
    }

    if (this.canvasCtx && this.canvasElement) {
      this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }

    this.controlMode = 'mouse';
    this.handDetected = false;
    this.onStatusChange({ status: 'stopped', message: 'Mouse Controls Active' });
  }

  /**
   * Detects the Spider-Man web-shooting / ILY hand sign (🤟):
   * - Index finger: EXTENDED
   * - Pinky finger: EXTENDED
   * - Middle finger: CURLED / FOLDED into palm
   * - Ring finger: CURLED / FOLDED into palm
   * - Thumb: EXTENDED outward from palm
   */
  isSpidermanSign(landmarks) {
    if (!landmarks || landmarks.length < 21) return false;

    const dist = (i, j) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      return Math.hypot(p1.x - p2.x, p1.y - p2.y, (p1.z || 0) - (p2.z || 0));
    };

    const wrist = 0;
    const thumbMCP = 2, thumbTip = 4;
    const indexMCP = 5, indexPIP = 6, indexTip = 8;
    const middleMCP = 9, middlePIP = 10, middleTip = 12;
    const ringMCP = 13, ringPIP = 14, ringTip = 16;
    const pinkyMCP = 17, pinkyPIP = 18, pinkyTip = 20;

    // Palm scale reference: wrist to middle knuckle
    const palmScale = Math.max(0.04, dist(wrist, middleMCP));

    // 1. Index Finger: EXTENDED
    const indexDistToWrist = dist(indexTip, wrist);
    const indexPipToWrist = dist(indexPIP, wrist);
    const indexExtended = (indexDistToWrist > indexPipToWrist * 1.08) &&
                          (dist(indexTip, indexMCP) > dist(indexPIP, indexMCP) * 1.12) &&
                          (indexDistToWrist > palmScale * 1.10);

    // 2. Pinky Finger: EXTENDED
    const pinkyDistToWrist = dist(pinkyTip, wrist);
    const pinkyPipToWrist = dist(pinkyPIP, wrist);
    const pinkyExtended = (pinkyDistToWrist > pinkyPipToWrist * 1.08) &&
                          (dist(pinkyTip, pinkyMCP) > dist(pinkyPIP, pinkyMCP) * 1.12) &&
                          (pinkyDistToWrist > palmScale * 0.90);

    // 3. Middle Finger: CURLED / FOLDED
    const middleDistToWrist = dist(middleTip, wrist);
    const middlePipToWrist = dist(middlePIP, wrist);
    const middleCurled = (middleDistToWrist < middlePipToWrist * 1.05) ||
                         (dist(middleTip, middleMCP) < palmScale * 0.78) ||
                         (middleDistToWrist < indexDistToWrist * 0.75);

    // 4. Ring Finger: CURLED / FOLDED
    const ringDistToWrist = dist(ringTip, wrist);
    const ringPipToWrist = dist(ringPIP, wrist);
    const ringCurled = (ringDistToWrist < ringPipToWrist * 1.05) ||
                       (dist(ringTip, ringMCP) < palmScale * 0.78) ||
                       (ringDistToWrist < pinkyDistToWrist * 0.75);

    // 5. Thumb: EXTENDED OUT
    const thumbDistToMiddleKnuckle = dist(thumbTip, middleMCP);
    const thumbDistToIndexKnuckle = dist(thumbTip, indexMCP);
    const thumbExtended = (thumbDistToMiddleKnuckle > palmScale * 0.45) &&
                          (thumbDistToIndexKnuckle > palmScale * 0.32) &&
                          (dist(thumbTip, wrist) > dist(thumbMCP, wrist));

    // 6. Contrast test:
    const extendedSum = indexDistToWrist + pinkyDistToWrist;
    const curledSum = middleDistToWrist + ringDistToWrist;
    const hasContrast = extendedSum > curledSum * 1.18;

    return indexExtended && pinkyExtended && middleCurled && ringCurled && thumbExtended && hasContrast;
  }

  onMediaPipeResults(results) {
    if (!this.canvasCtx || !this.canvasElement) return;

    const ctx = this.canvasCtx;
    const w = this.canvasElement.width;
    const h = this.canvasElement.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (results.image && (results.image.width || results.image.videoWidth)) {
      try {
        ctx.drawImage(results.image, 0, 0, w, h);
      } catch (e) {}
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      this.handDetected = true;
      const now = performance.now();
      const dt = this.lastResultsTimestamp ? Math.min(0.1, (now - this.lastResultsTimestamp) / 1000) : 0.033;
      this.lastResultsTimestamp = now;
      this.lastDetectedTime = now;
      const landmarks = results.multiHandLandmarks[0];

      // Spider-Man (🤟) Gesture Detection & Calibration
      const isSpiderman = this.isSpidermanSign(landmarks);

      if (this.gestureCalibratedFlashTimer > 0) {
        this.gestureCalibratedFlashTimer = Math.max(0, this.gestureCalibratedFlashTimer - dt);
      }

      if (this.spidermanGestureCooldown > 0) {
        this.spidermanGestureCooldown = Math.max(0, this.spidermanGestureCooldown - dt);
      }

      if (isSpiderman && this.spidermanGestureCooldown <= 0) {
        this.spidermanGestureTimer += dt;
        this.spidermanGestureProgress = Math.min(1.0, this.spidermanGestureTimer / 0.20);

        if (this.spidermanGestureProgress >= 1.0) {
          this.spidermanGestureTimer = 0;
          this.spidermanGestureProgress = 0;
          this.spidermanGestureCooldown = 2.0;
          this.gestureCalibratedFlashTimer = 1.4;

          this.setNeutralCenter(this.lastRawHand);

          if (this.onGestureCalibrate) {
            this.onGestureCalibrate();
          }
        }
      } else if (!isSpiderman) {
        this.spidermanGestureTimer = Math.max(0, this.spidermanGestureTimer - dt * 2.0);
        this.spidermanGestureProgress = 0;
      }

      this.drawHandSkeleton(ctx, landmarks, w, h, isSpiderman);

      const wrist = landmarks[0];
      const indexKnuckle = landmarks[5];
      const middleKnuckle = landmarks[9];
      const pinkyKnuckle = landmarks[17];

      // True geometric center of the hand/palm (centered across the palm and between knuckles and wrist)
      const knucklesCenterX = (indexKnuckle.x + middleKnuckle.x + pinkyKnuckle.x) / 3;
      const knucklesCenterY = (indexKnuckle.y + middleKnuckle.y + pinkyKnuckle.y) / 3;
      const palmX = knucklesCenterX * 0.75 + wrist.x * 0.25;
      const palmY = knucklesCenterY * 0.75 + wrist.y * 0.25;

      // Inverted selfie camera X so physical movement to the right increases userX
      const userX = 1.0 - palmX;
      // Inverted Y (moving physical hand up increases userY)
      const userY = 1.0 - palmY;

      // Hand scale in pixels (depth)
      const dx = wrist.x - middleKnuckle.x;
      const dy = wrist.y - middleKnuckle.y;
      const userDepth = Math.sqrt(dx * dx + dy * dy);

      // Y-Axis Yaw Angle: compare Z-depth between index knuckle (5) and pinky knuckle (17)
      // combined with horizontal palm orientation
      const indexZ = indexKnuckle.z || 0;
      const pinkyZ = pinkyKnuckle.z || 0;
      const rawYaw = THREE.MathUtils.clamp(
        (indexZ - pinkyZ) * 4.5 - (middleKnuckle.x - wrist.x) * 1.8,
        -Math.PI / 3,
        Math.PI / 3
      );

      this.lastRawHand = { x: userX, y: userY, depth: userDepth, yaw: rawYaw };

      if (!this.isCalibrated) {
        this.autoCalibrateTimer += 0.033;
        if (this.autoCalibrateTimer >= 0.7) {
          this.setNeutralCenter(this.lastRawHand);
        }
      }

      // Calculate relative displacement from neutral reference
      let deltaX = (userX - this.neutralHand.x) * this.settings.sensitivityX;
      if (this.invertX) {
        deltaX = -deltaX;
      }
      const deltaY = (userY - this.neutralHand.y) * this.settings.sensitivityY;
      const deltaDepth = ((userDepth - this.neutralHand.depth) / Math.max(0.04, this.neutralHand.depth)) * (this.settings.sensitivityZ || 2.0);

      // Forward/Back movement (natural physical depth + forward reach):
      // Moving physical hand FORWARD toward camera (deltaDepth > 0) OR forward/up (deltaY > 0) moves forward (+Z for P1)
      // Pulling hand BACKWARD away from camera (deltaDepth < 0) OR backward/down (deltaY < 0) pulls backward (-Z for P1)
      const forwardMotion = deltaDepth * 1.45 + deltaY * 0.85;

      const limits = this.playerRole === 'host' ? this.courtLimits.p1 : this.courtLimits.p2;

      // Horizontal court coordinate: moving physical hand right maps to screen right (-deltaX)
      const courtX = (this.playerRole === 'client' ? deltaX : -deltaX) * (TABLE_WIDTH * 0.70);
      const targetX = THREE.MathUtils.clamp(courtX, limits.minX, limits.maxX);

      // Map Forward/Backward movement to Z-Axis:
      let targetZ;
      if (this.playerRole === 'host') {
        targetZ = THREE.MathUtils.clamp(-1.15 + forwardMotion * 0.95, limits.minZ, limits.maxZ);
      } else {
        targetZ = THREE.MathUtils.clamp(1.15 - forwardMotion * 0.95, limits.minZ, limits.maxZ);
      }

      // Table Tennis vertical paddle height: auto-track ball height or comfortable height
      const baseH = this.activeBallHeight ?? (TABLE_HEIGHT + 0.12);
      const targetY = THREE.MathUtils.clamp(baseH + deltaY * 0.25, limits.minY, limits.maxY);

      this.targetPosition.set(targetX, targetY, targetZ);

      // Filter relative yaw angle around Y-axis using OneEuroFilter
      const deltaYaw = this.yawFilter.filter(rawYaw - this.neutralHand.yaw, 0.016);
      this.currentYaw = -deltaYaw;

      // Wrist pitch (tilt forward/back)
      const pitchAngle = (wrist.y - middleKnuckle.y) * 0.45;

      // Apply Y-axis yaw rotation to paddle/striker
      const targetEuler = new THREE.Euler(
        pitchAngle * 0.2,
        (this.playerRole === 'client' ? Math.PI : 0) - deltaYaw,
        0
      );
      this.targetQuaternion.setFromEuler(targetEuler);

      // Open-Hand vs. Closed-Hand Gesture Detection:
      // Measure average distance from fingertips (8, 12, 16, 20) to wrist (0), normalized by userDepth
      const tipIndices = [8, 12, 16, 20];
      let totalTipDist = 0;
      for (const idx of tipIndices) {
        const tip = landmarks[idx];
        const d = Math.hypot(tip.x - wrist.x, tip.y - wrist.y, (tip.z || 0) - (wrist.z || 0));
        totalTipDist += d;
      }
      const avgFingerTipDist = totalTipDist / tipIndices.length;
      this.isHandOpen = !isSpiderman && ((avgFingerTipDist / Math.max(0.04, userDepth)) > 1.65);
      this.justOpenedHand = !isSpiderman && (this.isHandOpen && !this.wasHandOpen);
      this.wasHandOpen = this.isHandOpen;

      let dirStr = '';
      if (Math.abs(deltaX) > 0.08) dirStr += deltaX > 0 ? 'RIGHT ' : 'LEFT ';
      if (Math.abs(forwardMotion) > 0.08) dirStr += forwardMotion > 0 ? 'FORWARD ' : 'BACKWARD ';
      if (!dirStr) dirStr = 'CENTER';

      this.relativeReadout = {
        dx: deltaX.toFixed(2),
        dy: deltaY.toFixed(2),
        dz: targetZ.toFixed(2),
        yaw: `${Math.round((-deltaYaw * 180) / Math.PI)}°`,
        direction: dirStr.trim(),
        hand: isSpiderman ? '🤟 SPIDER-MAN' : (this.isHandOpen ? 'OPEN' : 'GRIP'),
      };
      this.onCalibrationUpdate({ status: 'tracking', readout: this.relativeReadout });
    }

    ctx.restore();
  }

  drawHandSkeleton(ctx, landmarks, w, h, isSpiderman = false) {
    const refX = (1.0 - this.neutralHand.x) * w;
    const refY = (1.0 - this.neutralHand.y) * h;

    ctx.strokeStyle = 'rgba(0, 221, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(refX, 0);
    ctx.lineTo(refX, h);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, refY);
    ctx.lineTo(w, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = this.isCalibrated ? '#00ddff' : '#ffaa00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(refX, refY, 20, 0, Math.PI * 2);
    ctx.stroke();

    // Spider-Man color theme when gesture is charging or active
    if (isSpiderman || this.spidermanGestureProgress > 0) {
      ctx.strokeStyle = '#ff0055';
      ctx.fillStyle = '#ff2a6d';
    } else {
      ctx.strokeStyle = this.isHandOpen ? '#ffea00' : '#00ff88';
      ctx.fillStyle = '#00ddff';
    }
    ctx.lineWidth = (isSpiderman || this.spidermanGestureProgress > 0) ? 3.0 : 2.5;

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17],
    ];

    connections.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      ctx.beginPath();
      ctx.moveTo(p1.x * w, p1.y * h);
      ctx.lineTo(p2.x * w, p2.y * h);
      ctx.stroke();
    });

    landmarks.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Visual HUD Badge & Charging Ring centered squarely in the true center of the hand
    const knucklesCenterX = (landmarks[5].x + landmarks[9].x + landmarks[17].x) / 3;
    const knucklesCenterY = (landmarks[5].y + landmarks[9].y + landmarks[17].y) / 3;
    const cx = (knucklesCenterX * 0.75 + landmarks[0].x * 0.25) * w;
    const cy = (knucklesCenterY * 0.75 + landmarks[0].y * 0.25) * h;

    if (this.gestureCalibratedFlashTimer > 0) {
      ctx.save();
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 255, 136, 0.25)';
      ctx.fill();

      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = '#00ff88';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 255, 136, 0.9)';
      ctx.shadowBlur = 8;
      ctx.fillText('🤟 CALIBRATED ✓', cx, cy - 32);
      ctx.restore();
    } else if (this.spidermanGestureProgress > 0) {
      const radius = 26;
      ctx.save();
      // Background arc track
      ctx.strokeStyle = 'rgba(255, 0, 80, 0.35)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Progress arc
      ctx.strokeStyle = '#ff0055';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.spidermanGestureProgress);
      ctx.stroke();

      // Text badge
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillStyle = '#ff2a6d';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255, 42, 109, 0.9)';
      ctx.shadowBlur = 8;
      ctx.fillText(`🤟 CALIBRATING ${Math.round(this.spidermanGestureProgress * 100)}%`, cx, cy - 32);
      ctx.restore();
    }
  }

  getTransform(dt = 0.016) {
    const isHandActive = this.controlMode === 'webcam' && (performance.now() - this.lastDetectedTime < 800);

    if (!isHandActive) {
      const mousePos = this.mouseTarget.clone();
      if (this.swingBoostTimer > 0) {
        this.swingBoostTimer -= dt;
        const forwardDir = this.playerRole === 'host' ? 0.38 : -0.38;
        mousePos.z += forwardDir * Math.sin((this.swingBoostTimer / 0.22) * Math.PI);
      }
      this.targetPosition.copy(mousePos);

      // In mouse mode, subtle Y-axis tilt based on court X position
      const tiltX = (this.currentPosition.x / (TABLE_WIDTH * 0.70)) * 0.35;
      this.currentYaw = this.playerRole === 'client' ? -tiltX : tiltX;
      const mouseEuler = new THREE.Euler(
        0,
        (this.playerRole === 'client' ? Math.PI : 0) + this.currentYaw,
        0
      );
      this.targetQuaternion.setFromEuler(mouseEuler);
    }

    this.previousPosition.copy(this.currentPosition);

    // Apply 1D One Euro Filters to position (x, y, z)
    const filteredX = this.xFilter.filter(this.targetPosition.x, dt);
    const filteredY = this.yFilter.filter(this.targetPosition.y, dt);
    const filteredZ = this.zFilter.filter(this.targetPosition.z, dt);

    this.currentPosition.set(filteredX, filteredY, filteredZ);

    if (dt > 0.0001) {
      this.velocity.subVectors(this.currentPosition, this.previousPosition).divideScalar(dt);
    }

    this.currentQuaternion.slerp(this.targetQuaternion, Math.min(1.0, 22.0 * dt));

    return {
      position: this.currentPosition,
      quaternion: this.currentQuaternion,
      velocity: this.velocity,
      yaw: this.currentYaw,
      isHandOpen: this.isHandOpen,
      justOpenedHand: this.justOpenedHand,
    };
  }
}
