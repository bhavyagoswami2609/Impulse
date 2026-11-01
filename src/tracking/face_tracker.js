import * as THREE from 'three';
import { OneEuroFilter } from './hand_tracker.js';

/**
 * Dynamically loads MediaPipe FaceDetection onto the main window after Hands is initialized.
 * Ensures zero Emscripten collisions and seamless native WebGL GPU hardware acceleration.
 */
export async function ensureFaceDetectionLibrary() {
  if (typeof window === 'undefined') return false;
  if (typeof window.FaceDetection !== 'undefined') return true;

  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-face-detect]');
    if (existing) {
      if (window.FaceDetection) return resolve(true);
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.setAttribute('data-face-detect', 'true');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/face_detection.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

/**
 * Legacy loader alias
 */
export async function getIsolatedFaceDetectionClass() {
  const ready = await ensureFaceDetectionLibrary();
  return (ready && typeof window !== 'undefined') ? window.FaceDetection : null;
}

/**
 * FaceTracker - Lightweight, 60fps head-tracking parallax engine for 3D holographic VR perspective.
 *
 * Uses MediaPipe FaceDetection (BlazeFace short-range, ~200KB model) to track head position in real time.
 * When the user moves their head left/right, up/down, or leans forward/back, calculates a silky-smooth
 * 3D camera parallax offset that gives the feeling of looking through a real physical window into the arena.
 */
export class FaceTracker {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.canvasElement = options.canvasElement || null;
    this.onStatusChange = options.onStatusChange || null;

    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.invertX = options.invertX !== undefined ? options.invertX : false; // Default unmirrored as requested
    this.isTracking = false;
    this.isStarting = false;
    this.lastDetectedTime = 0;

    // Adaptive OneEuroFilters for zero-jitter, low-latency head tracking
    this.filterX = new OneEuroFilter(1.2, 0.05, 1.0);
    this.filterY = new OneEuroFilter(1.2, 0.05, 1.0);
    this.filterZ = new OneEuroFilter(1.0, 0.03, 1.0);

    // 3D Parallax Offsets (Three.js world units)
    this.targetOffset = new THREE.Vector3(0, 0, 0);
    this.currentOffset = new THREE.Vector3(0, 0, 0);

    // Calibrated neutral center { x, y, size }
    this.neutralCenter = null;
    this.autoCalibrateCount = 0;

    // Parallax Sensitivity Gains & Clamps
    this.gainX = options.gainX ?? 1.85; // Lateral parallax gain
    this.gainY = options.gainY ?? 1.30; // Vertical elevation gain
    this.gainZ = options.gainZ ?? 2.10; // Lean forward/back zoom gain

    this.maxOffsetX = options.maxOffsetX ?? 0.45; // Max lateral shift (m)
    this.maxOffsetY = options.maxOffsetY ?? 0.25; // Max elevation shift (m)
    this.maxOffsetZ = options.maxOffsetZ ?? 0.35; // Max depth shift (m)

    // MediaPipe FaceDetection instance
    this.faceDetection = null;
    this.isProcessing = false;
    this.lastFrameTime = 0;
    this.frameIntervalMs = 30; // ~30 FPS detection is optimal, zero lag, minimal CPU

    // Video frame callback handle
    this.frameCallbackId = null;
    this.frameAnimId = null;

    // Raw detected face for PIP HUD visualization
    this.latestFaceBox = null;
    this.latestLandmarks = null;
    this.faceDetected = false;

    // Mouse fallback parallax when webcam is off
    this.mouseNormalized = { x: 0, y: 0 };
    this.useMouseFallback = false;
    this.bindMouseFallback();
  }

  bindMouseFallback() {
    if (typeof window === 'undefined') return;
    window.addEventListener('mousemove', (e) => {
      // Normalized from -1 to +1 relative to screen center
      this.mouseNormalized.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNormalized.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
  }

  /**
   * Toggle Face Tracking ON / OFF.
   * @returns {Promise<boolean>} New enabled state
   */
  async toggle() {
    if (this.enabled) {
      this.disable();
      return false;
    } else {
      return await this.enable();
    }
  }

  /**
   * Enable Face Tracking.
   */
  async enable() {
    this.enabled = true;
    this.neutralCenter = null;
    this.autoCalibrateCount = 0;

    if (this.onStatusChange) {
      this.onStatusChange({ enabled: true, tracking: this.isTracking });
    }

    if (this.videoElement && this.videoElement.srcObject) {
      await this.startTracking();
    } else {
      this.useMouseFallback = true;
    }

    return true;
  }

  /**
   * Disable Face Tracking.
   */
  disable() {
    this.enabled = false;
    this.stopTracking();
    this.targetOffset.set(0, 0, 0);
    this.latestFaceBox = null;
    this.latestLandmarks = null;
    this.faceDetected = false;

    if (this.onStatusChange) {
      this.onStatusChange({ enabled: false, tracking: false });
    }
  }

  /**
   * Start MediaPipe FaceDetection inference loop.
   */
  async startTracking() {
    if (!this.enabled || this.isTracking || this.isStarting) return;
    this.isStarting = true;

    try {
      const ready = await ensureFaceDetectionLibrary();
      if (!ready || typeof window.FaceDetection === 'undefined') {
        console.warn('MediaPipe FaceDetection library could not be loaded, using mouse fallback');
        this.useMouseFallback = true;
        this.isStarting = false;
        return;
      }

      if (!this.faceDetection) {
        this.faceDetection = new window.FaceDetection({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
        });

        await this.faceDetection.setOptions({
          model: 'short', // 0-2m desktop distance
          minDetectionConfidence: 0.5,
        });

        this.faceDetection.onResults(this.onDetectionResults.bind(this));
      }

      this.isTracking = true;
      this.isStarting = false;
      this.useMouseFallback = false;
      this.startProcessingLoop();

      if (this.onStatusChange) {
        this.onStatusChange({ enabled: true, tracking: true });
      }
    } catch (err) {
      console.warn('FaceTracker startTracking error:', err);
      this.isStarting = false;
      this.useMouseFallback = true;
    }
  }

  /**
   * Stop MediaPipe FaceDetection inference loop.
   */
  stopTracking() {
    this.isTracking = false;
    this.isStarting = false;
    this.stopProcessingLoop();
  }

  startProcessingLoop() {
    this.stopProcessingLoop();

    let isProcessing = false;
    const processFrame = async () => {
      if (!this.enabled || !this.isTracking) return;

      const now = performance.now();
      if (
        this.videoElement &&
        this.videoElement.readyState >= 2 &&
        this.videoElement.videoWidth > 0 &&
        now - this.lastFrameTime >= this.frameIntervalMs
      ) {
        if (!isProcessing && this.faceDetection) {
          isProcessing = true;
          this.lastFrameTime = now;
          try {
            await this.faceDetection.send({ image: this.videoElement });
          } catch (err) {
            console.warn('Face tracking frame send error:', err);
          } finally {
            isProcessing = false;
          }
        }
      }

      if (this.enabled && this.isTracking && this.videoElement) {
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

  /**
   * Process MediaPipe FaceDetection results.
   */
  onDetectionResults(results, timestamp = null) {
    if (!this.enabled) return;

    const now = typeof timestamp === 'number' ? timestamp : performance.now();
    if (results.detections && results.detections.length > 0) {
      // Pick the primary face (detection with largest bounding box or highest confidence)
      const det = results.detections[0];
      const box = det.boundingBox; // { xCenter, yCenter, width, height }
      const landmarks = det.landmarks || []; // 6 keypoints: right eye, left eye, nose, mouth...

      this.latestFaceBox = box;
      this.latestLandmarks = landmarks;
      this.faceDetected = true;
      this.lastDetectedTime = now;
      this.useMouseFallback = false;

      // Horizontal head position (unmirrored by default so moving head left shifts perspective left)
      const rawX = this.invertX ? (1.0 - box.xCenter) : box.xCenter;
      // In camera feed, Y=0 is top, Y=1 is bottom; moving head UP should be positive
      const rawY = 1.0 - box.yCenter;
      // Box width / eye distance represents depth (closer = larger box)
      const rawSize = box.width;

      // Filter signals
      const filteredX = this.filterX.filter(rawX, now);
      const filteredY = this.filterY.filter(rawY, now);
      const filteredSize = this.filterZ.filter(rawSize, now);

      // Auto-calibrate neutral center on first few stable frames
      if (!this.neutralCenter || this.autoCalibrateCount < 5) {
        if (!this.neutralCenter) {
          this.neutralCenter = { x: filteredX, y: filteredY, size: filteredSize };
        } else {
          this.neutralCenter.x = this.neutralCenter.x * 0.7 + filteredX * 0.3;
          this.neutralCenter.y = this.neutralCenter.y * 0.7 + filteredY * 0.3;
          this.neutralCenter.size = this.neutralCenter.size * 0.7 + filteredSize * 0.3;
        }
        this.autoCalibrateCount++;
      }

      // Delta relative to neutral center
      const dx = filteredX - this.neutralCenter.x;
      const dy = filteredY - this.neutralCenter.y;
      const dSize = filteredSize - this.neutralCenter.size;

      // Map to 3D world parallax offsets with sensible clamps
      const offsetX = THREE.MathUtils.clamp(dx * this.gainX, -this.maxOffsetX, this.maxOffsetX);
      const offsetY = THREE.MathUtils.clamp(dy * this.gainY, -this.maxOffsetY, this.maxOffsetY);
      const offsetZ = THREE.MathUtils.clamp(dSize * this.gainZ, -this.maxOffsetZ, this.maxOffsetZ);

      this.targetOffset.set(offsetX, offsetY, offsetZ);
    } else {
      // If no face detected for > 600ms, gently return to neutral
      if (now - this.lastDetectedTime > 600) {
        this.faceDetected = false;
        this.targetOffset.set(0, 0, 0);
      }
    }
  }

  /**
   * Locks the user's current head position as the neutral center (calibration).
   */
  setNeutralCenter() {
    this.filterX = new OneEuroFilter(1.2, 0.05, 1.0);
    this.filterY = new OneEuroFilter(1.2, 0.05, 1.0);
    this.filterZ = new OneEuroFilter(1.0, 0.03, 1.0);

    if (this.latestFaceBox) {
      const rawX = this.invertX ? (1.0 - this.latestFaceBox.xCenter) : this.latestFaceBox.xCenter;
      const rawY = 1.0 - this.latestFaceBox.yCenter;
      const rawSize = this.latestFaceBox.width;

      this.neutralCenter = {
        x: rawX,
        y: rawY,
        size: rawSize,
      };
      this.autoCalibrateCount = 10; // Lock calibration
      this.targetOffset.set(0, 0, 0);
      this.currentOffset.set(0, 0, 0);
      return true;
    } else {
      // Pending calibration: zero offsets and lock the next detected frame
      this.neutralCenter = null;
      this.autoCalibrateCount = 0;
      this.targetOffset.set(0, 0, 0);
      this.currentOffset.set(0, 0, 0);
      this.mouseNormalized = { x: 0, y: 0 };
      return true;
    }
  }

  /**
   * Returns the current smoothed 3D parallax offset vector.
   * Smoothly interpolates to (0, 0, 0) when disabled.
   *
   * @param {number} deltaTime Frame delta in seconds
   * @returns {THREE.Vector3} Parallax offset in world units
   */
  getParallaxOffset(deltaTime) {
    const dt = Math.max(0.001, Math.min(deltaTime, 0.05));

    if (!this.enabled) {
      // Smoothly return to center
      this.currentOffset.lerp(new THREE.Vector3(0, 0, 0), Math.min(1.0, dt * 10.0));
      return this.currentOffset;
    }

    if (this.useMouseFallback && (!this.isTracking || !this.faceDetected)) {
      // Subtle mouse fallback preview when webcam is not tracking (unmirrored to match head tracking)
      const mouseFactor = this.invertX ? 0.28 : -0.28;
      const mouseX = THREE.MathUtils.clamp(this.mouseNormalized.x * mouseFactor, -this.maxOffsetX, this.maxOffsetX);
      const mouseY = THREE.MathUtils.clamp(this.mouseNormalized.y * 0.16, -this.maxOffsetY, this.maxOffsetY);
      this.targetOffset.set(mouseX, mouseY, 0);
    }

    // Butter-smooth exponential damping (lerp)
    this.currentOffset.x += (this.targetOffset.x - this.currentOffset.x) * Math.min(1.0, dt * 11.0);
    this.currentOffset.y += (this.targetOffset.y - this.currentOffset.y) * Math.min(1.0, dt * 11.0);
    this.currentOffset.z += (this.targetOffset.z - this.currentOffset.z) * Math.min(1.0, dt * 11.0);

    return this.currentOffset;
  }

  /**
   * Renders the Xbox 360-themed holographic face tracker HUD onto the PIP canvas.
   *
   * @param {CanvasRenderingContext2D} ctx PIP canvas 2D context
   * @param {number} width Canvas width
   * @param {number} height Canvas height
   */
  drawPIPOverlay(ctx, width, height) {
    if (!this.enabled || !this.faceDetected || !this.latestFaceBox) return;

    const box = this.latestFaceBox;
    // Bounding box matching PIP canvas coordinates
    const x = (box.xCenter - box.width / 2) * width;
    const y = (box.yCenter - box.height / 2) * height;
    const w = box.width * width;
    const h = box.height * height;

    ctx.save();

    // 1. Futuristic corner brackets
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.0;
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur = 6;

    const cornerLen = Math.min(w, h) * 0.22;

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(x, y + cornerLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cornerLen, y);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + cornerLen);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(x, y + h - cornerLen);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + cornerLen, y + h);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - cornerLen);
    ctx.stroke();

    // 2. Center Crosshairs on Nose / Eyes
    if (this.latestLandmarks && this.latestLandmarks.length >= 3) {
      const nose = this.latestLandmarks[2];
      const nx = nose.x * width;
      const ny = nose.y * height;

      ctx.strokeStyle = 'rgba(0, 229, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(nx, ny, 3.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(nx - 7, ny);
      ctx.lineTo(nx + 7, ny);
      ctx.moveTo(nx, ny - 7);
      ctx.lineTo(nx, ny + 7);
      ctx.stroke();
    }

    // 3. Holographic Label
    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 9px "Segoe UI", Arial, sans-serif';
    ctx.shadowBlur = 4;
    ctx.fillText('VR HEAD TRACKED', x + 4, y - 6);

    ctx.restore();
  }
}
