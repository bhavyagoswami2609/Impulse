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
    this.filterX = new OneEuroFilter(0.8, 0.03, 1.0);
    this.filterY = new OneEuroFilter(0.8, 0.03, 1.0);
    this.filterZ = new OneEuroFilter(0.8, 0.03, 1.0);
    this.filterYaw = new OneEuroFilter(0.8, 0.03, 1.0); // Head Yaw rotation filter

    // 3D Parallax Offsets & Head Yaw (Three.js world units & radians)
    this.targetOffset = new THREE.Vector3(0, 0, 0);
    this.currentOffset = new THREE.Vector3(0, 0, 0);
    this.targetYaw = 0;
    this.currentYaw = 0;

    // Calibrated neutral center { x, y, size } and neutral yaw
    this.neutralCenter = null;
    this.neutralYaw = 0;
    this.autoCalibrateCount = 0;

    // Parallax Sensitivity Gains & Clamps (Tuned for realistic, subtle, playable game perspective)
    this.gainX = options.gainX ?? 0.55;    // Subtle lateral parallax shift
    this.gainY = options.gainY ?? 0.35;    // Subtle vertical parallax elevation
    this.gainZ = options.gainZ ?? 0.45;    // Subtle depth zoom
    this.gainYaw = options.gainYaw ?? 0.22; // Gentle, realistic head yaw rotation (down from 0.85)

    this.maxOffsetX = options.maxOffsetX ?? 0.16; // Max 16cm lateral shift (down from 45cm)
    this.maxOffsetY = options.maxOffsetY ?? 0.08; // Max 8cm vertical shift (down from 25cm)
    this.maxOffsetZ = options.maxOffsetZ ?? 0.10; // Max 10cm depth shift (down from 35cm)
    this.maxYaw = options.maxYaw ?? 0.14;         // Max ~8.0 degrees rotation (down from 26 degrees)
    this.yawDeadband = options.yawDeadband ?? 0.035; // Deadband around neutral center to absorb natural tremors
    this.parallaxDeadband = options.parallaxDeadband ?? 0.02; // Deadband for position shifts

    // MediaPipe FaceDetection instance
    this.faceDetection = null;
    this.isProcessing = false;
    this.lastFrameTime = 0;
    this.frameIntervalMs = 60; // ~16 FPS detection for silky head tracking without contending with hand tracker

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
    this.neutralYaw = 0;
    this.filterX = new OneEuroFilter(1.2, 0.05, 1.0);
    this.filterY = new OneEuroFilter(1.2, 0.05, 1.0);
    this.filterZ = new OneEuroFilter(0.8, 0.02, 1.0);
    this.filterYaw = new OneEuroFilter(1.0, 0.05, 1.0);

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
    this.targetYaw = 0;
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
          locateFile: (file) => {
            if (file.includes('hands')) {
              return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`;
          },
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
            // Downscale camera input to 320x240 for fast face detection
            if (!this.inferenceCanvas) {
              this.inferenceCanvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(320, 240)
                : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
              if (this.inferenceCanvas) {
                this.inferenceCanvas.width = 320;
                this.inferenceCanvas.height = 240;
                this.inferenceCtx = this.inferenceCanvas.getContext('2d', { willReadFrequently: true });
              }
            }

            if (this.inferenceCtx && this.inferenceCanvas) {
              this.inferenceCtx.drawImage(this.videoElement, 0, 0, 320, 240);
              await this.faceDetection.send({ image: this.inferenceCanvas });
            } else {
              await this.faceDetection.send({ image: this.videoElement });
            }
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

      // Delta relative to neutral center with gentle deadband
      const rawDx = filteredX - this.neutralCenter.x;
      const rawDy = filteredY - this.neutralCenter.y;
      const rawDsize = filteredSize - this.neutralCenter.size;

      const cleanDx = Math.abs(rawDx) > this.parallaxDeadband ? (rawDx - Math.sign(rawDx) * this.parallaxDeadband) : 0;
      const cleanDy = Math.abs(rawDy) > this.parallaxDeadband ? (rawDy - Math.sign(rawDy) * this.parallaxDeadband) : 0;
      const cleanDsize = Math.abs(rawDsize) > this.parallaxDeadband ? (rawDsize - Math.sign(rawDsize) * this.parallaxDeadband) : 0;

      // Map to 3D world parallax offsets with sensible clamps
      const offsetX = THREE.MathUtils.clamp(cleanDx * this.gainX, -this.maxOffsetX, this.maxOffsetX);
      const offsetY = THREE.MathUtils.clamp(cleanDy * this.gainY, -this.maxOffsetY, this.maxOffsetY);
      const offsetZ = THREE.MathUtils.clamp(cleanDsize * this.gainZ, -this.maxOffsetZ, this.maxOffsetZ);

      this.targetOffset.set(offsetX, offsetY, offsetZ);

      // Head Yaw Rotation (Looking Left vs Looking Right around vertical Y-axis)
      // Robust to head roll / sideways tilt by projecting nose offset onto the face eye axis:
      if (landmarks && landmarks.length >= 3) {
        const rightEye = landmarks[0];
        const leftEye = landmarks[1];
        const nose = landmarks[2];

        // Eye vector and distance
        const eyeVecX = leftEye.x - rightEye.x;
        const eyeVecY = leftEye.y - rightEye.y;
        const eyeDist = Math.max(0.02, Math.hypot(eyeVecX, eyeVecY));

        // Unit vector along the face's own eye axis
        const uX = eyeVecX / eyeDist;
        const uY = eyeVecY / eyeDist;

        // Nose displacement relative to midpoint between eyes
        const midEyeX = (rightEye.x + leftEye.x) / 2;
        const midEyeY = (rightEye.y + leftEye.y) / 2;
        const noseVecX = nose.x - midEyeX;
        const noseVecY = nose.y - midEyeY;

        // Project nose displacement onto eye axis (completely invariant to sideways head roll tilt)
        const projectedDisplacement = -(noseVecX * uX + noseVecY * uY);
        let rawYaw = projectedDisplacement / (eyeDist * 0.55);

        // If ears are present, blend ear distance disparity for extra rotational stability
        if (landmarks.length >= 6 && landmarks[4] && landmarks[5]) {
          const rightEar = landmarks[4];
          const leftEar = landmarks[5];
          const earSpan = Math.hypot(leftEar.x - rightEar.x, leftEar.y - rightEar.y);
          if (earSpan > eyeDist * 1.05) {
            const dRightEar = Math.hypot(nose.x - rightEar.x, nose.y - rightEar.y);
            const dLeftEar = Math.hypot(nose.x - leftEar.x, nose.y - leftEar.y);
            const earYaw = (dLeftEar - dRightEar) / (earSpan * 0.65);
            rawYaw = rawYaw * 0.70 + earYaw * 0.30;
          }
        }

        if (this.invertX) {
          rawYaw = -rawYaw;
        }

        const filteredYaw = this.filterYaw.filter(rawYaw, now);

        if (!this.neutralCenter || this.autoCalibrateCount < 5) {
          this.neutralYaw = this.neutralYaw * 0.7 + filteredYaw * 0.3;
        }

        const deltaYaw = filteredYaw - this.neutralYaw;

        // Apply deadband around neutral center to absorb micro-tremors and natural gaze shifts
        const absDelta = Math.abs(deltaYaw);
        if (absDelta <= this.yawDeadband) {
          this.targetYaw = 0;
        } else {
          // Smooth progressive ramp above deadband
          const excess = absDelta - this.yawDeadband;
          const scaled = excess * this.gainYaw;
          this.targetYaw = Math.sign(deltaYaw) * THREE.MathUtils.clamp(scaled, 0, this.maxYaw);
        }
      }
    } else {
      // If no face detected for > 600ms, gently return to neutral
      if (now - this.lastDetectedTime > 600) {
        this.faceDetected = false;
        this.targetOffset.set(0, 0, 0);
        this.targetYaw = 0;
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
    this.filterYaw = new OneEuroFilter(1.2, 0.05, 1.0);

    if (this.latestFaceBox) {
      const rawX = this.invertX ? (1.0 - this.latestFaceBox.xCenter) : this.latestFaceBox.xCenter;
      const rawY = 1.0 - this.latestFaceBox.yCenter;
      const rawSize = this.latestFaceBox.width;

      this.neutralCenter = {
        x: rawX,
        y: rawY,
        size: rawSize,
      };

      if (this.latestLandmarks && this.latestLandmarks.length >= 3) {
        const rightEye = this.latestLandmarks[0];
        const leftEye = this.latestLandmarks[1];
        const nose = this.latestLandmarks[2];
        const eyeVecX = leftEye.x - rightEye.x;
        const eyeVecY = leftEye.y - rightEye.y;
        const eyeDist = Math.max(0.02, Math.hypot(eyeVecX, eyeVecY));
        const uX = eyeVecX / eyeDist;
        const uY = eyeVecY / eyeDist;
        const midEyeX = (rightEye.x + leftEye.x) / 2;
        const midEyeY = (rightEye.y + leftEye.y) / 2;
        const noseVecX = nose.x - midEyeX;
        const noseVecY = nose.y - midEyeY;
        let rawYaw = -(noseVecX * uX + noseVecY * uY) / (eyeDist * 0.55);
        if (this.invertX) rawYaw = -rawYaw;
        this.neutralYaw = rawYaw;
      } else {
        this.neutralYaw = 0;
      }

      this.autoCalibrateCount = 10; // Lock calibration
      this.targetOffset.set(0, 0, 0);
      this.currentOffset.set(0, 0, 0);
      this.targetYaw = 0;
      this.currentYaw = 0;
      return true;
    } else {
      // Pending calibration: zero offsets and lock the next detected frame
      this.neutralCenter = null;
      this.neutralYaw = 0;
      this.autoCalibrateCount = 0;
      this.targetOffset.set(0, 0, 0);
      this.currentOffset.set(0, 0, 0);
      this.targetYaw = 0;
      this.currentYaw = 0;
      this.mouseNormalized = { x: 0, y: 0 };
      return true;
    }
  }

  /**
   * Returns the current smoothed Head Yaw angle in radians around the Y-axis.
   * Positive = Looking Right (Unmirrored, screen moves right)
   * Negative = Looking Left (Unmirrored, screen moves left)
   * Smoothly returns to 0 when disabled.
   *
   * @param {number} deltaTime Frame delta in seconds
   * @returns {number} Head yaw angle in radians
   */
  getYaw(deltaTime) {
    const dt = Math.max(0.001, Math.min(deltaTime, 0.05));

    if (!this.enabled) {
      this.currentYaw += (0 - this.currentYaw) * Math.min(1.0, dt * 10.0);
      return this.currentYaw;
    }

    if (this.useMouseFallback && (!this.isTracking || !this.faceDetected)) {
      // Mouse fallback: moving mouse right rotates view right (positive yaw)
      const mouseFactor = this.invertX ? -0.32 : 0.32;
      this.targetYaw = THREE.MathUtils.clamp(this.mouseNormalized.x * mouseFactor, -this.maxYaw, this.maxYaw);
    }

    this.currentYaw += (this.targetYaw - this.currentYaw) * Math.min(1.0, dt * 11.0);
    return this.currentYaw;
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
   * Renders the holographic face tracker HUD onto the PIP canvas.
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
    ctx.fillText('HEAD TRACKED', x + 4, y - 6);

    // 4. Subtle Real-Time Head Rotation (Yaw) Indicator
    if (Math.abs(this.currentYaw) > 0.05) {
      const deg = Math.round(THREE.MathUtils.radToDeg(this.currentYaw));
      const dirText = deg > 0 ? 'LOOKING RIGHT ▶' : '◀ LOOKING LEFT';
      ctx.fillStyle = 'rgba(0, 229, 255, 0.9)';
      ctx.font = 'bold 8.5px "Segoe UI", Arial, sans-serif';
      ctx.fillText(`${dirText} (${Math.abs(deg)}°)`, x + 4, y + h + 13);
    }

    ctx.restore();
  }
}
