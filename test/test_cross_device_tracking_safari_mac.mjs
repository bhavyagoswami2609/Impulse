import assert from 'node:assert';

// Mock browser environment for Node test runner
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 2.0,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { hostname: 'localhost', protocol: 'http:' },
};

class MockCanvas {
  constructor(w = 320, h = 240) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      drawImage: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      setLineDash: () => {},
    };
  }
}

class MockVideo {
  constructor() {
    this.readyState = 4;
    this.videoWidth = 640;
    this.videoHeight = 480;
    this.paused = true;
    this.muted = false;
    this.defaultMuted = false;
    this.playsInline = false;
    this.attributes = {};
    this.srcObject = null;
    this.listeners = {};
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(ev, fn) {
    if (!this.listeners[ev]) this.listeners[ev] = [];
    this.listeners[ev].push(fn);
  }
  async play() {
    this.paused = false;
  }
}

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return new MockCanvas();
    if (tag === 'video') return new MockVideo();
    return { setAttribute: () => {}, addEventListener: () => {} };
  },
  querySelector() { return null; },
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
};

const mockMediaDevices = {
  enumerateDevices: async () => [
    { kind: 'videoinput', label: 'FaceTime HD Camera (Built-in)', deviceId: 'built-in-facetime-id' },
  ],
  getUserMedia: async (constraints) => {
    return {
      getTracks: () => [{ stop: () => {} }],
    };
  },
};

try {
  globalThis.navigator.mediaDevices = mockMediaDevices;
} catch (e) {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: mockMediaDevices,
    configurable: true,
    writable: true,
  });
}

globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

import { HandTracker } from '../src/tracking/hand_tracker.js';
import { FaceTracker } from '../src/tracking/face_tracker.js';

console.log('=== VERIFYING CROSS-DEVICE & SAFARI MAC TRACKING FIXES ===\n');

// --------------------------------------------------------------------------
// TEST 1: Safari / Mac Autoplay & Muted Attribute Configuration
// --------------------------------------------------------------------------
console.log('--- Test 1: Video Element Safari Autoplay Initialization ---');
{
  const mockVideo = new MockVideo();
  const tracker = new HandTracker({
    videoElement: mockVideo,
    canvasElement: new MockCanvas(),
  });

  // Mock MediaPipe global Hands
  let sendCallCount = 0;
  let receivedImage = null;
  globalThis.window.Hands = class {
    constructor(cfg) {
      this.cfg = cfg;
    }
    setOptions() {}
    onResults(fn) { this.resultsCallback = fn; }
    async send(payload) {
      sendCallCount++;
      receivedImage = payload.image;
    }
  };

  await tracker.startWebcamTracking();

  assert.strictEqual(mockVideo.muted, true, 'video.muted must be true before play for Safari autoplay');
  assert.strictEqual(mockVideo.defaultMuted, true, 'video.defaultMuted must be true for WebKit');
  assert.strictEqual(mockVideo.playsInline, true, 'video.playsInline must be true');
  assert.strictEqual(mockVideo.getAttribute('playsinline'), '', 'playsinline attribute must be set');
  assert.strictEqual(mockVideo.getAttribute('webkit-playsinline'), '', 'webkit-playsinline attribute must be set');
  assert.strictEqual(mockVideo.paused, false, 'video.play() must be actively running');
  console.log('✓ PASS: Video element is properly configured for zero-block Safari macOS autoplay');

  tracker.stopWebcamTracking();
}

// --------------------------------------------------------------------------
// TEST 2: Genuine HTMLCanvasElement Used (Not OffscreenCanvas) & Direct Fallback
// --------------------------------------------------------------------------
console.log('\n--- Test 2: In-Memory Canvas Compatibility & Resilient Video Fallback ---');
{
  const mockVideo = new MockVideo();
  const tracker = new HandTracker({
    videoElement: mockVideo,
    canvasElement: new MockCanvas(),
  });

  let receivedImages = [];
  let shouldCanvasThrow = true;

  globalThis.window.Hands = class {
    constructor() {}
    setOptions() {}
    onResults(fn) { this.resultsCallback = fn; }
    async send(payload) {
      receivedImages.push(payload.image);
      // Simulate Safari WebGL rejecting OffscreenCanvas/invalid canvas texture
      if (shouldCanvasThrow && payload.image instanceof MockCanvas) {
        throw new TypeError("Argument 6 to WebGLRenderingContext.texImage2D must be an HTMLVideoElement");
      }
    }
  };

  await tracker.startWebcamTracking();

  // Trigger processing tick with canvas failure simulated
  tracker.lastInferenceTime = 0;
  await new Promise(r => setTimeout(r, 60));

  // The tracker must have automatically caught the canvas error and retried with direct videoElement!
  assert(tracker.disableInferenceCanvas === true, 'Tracker must flag disableInferenceCanvas on canvas texture failure');
  const hasVideoElementFallback = receivedImages.some(img => img === mockVideo);
  assert(hasVideoElementFallback, 'Tracker must cleanly fall back to direct videoElement input');
  console.log('✓ PASS: Tracker detects platform canvas WebGL error and automatically recovers with direct videoElement');

  tracker.stopWebcamTracking();
}

// --------------------------------------------------------------------------
// TEST 3: Hand Landmarks Processed Even if PIP Canvas is Null / Detached
// --------------------------------------------------------------------------
console.log('\n--- Test 3: Tracking Landmark Processing Decoupled from Canvas Context ---');
{
  const mockVideo = new MockVideo();
  // Tracker with null canvas (e.g. headless or canvas context lost)
  const tracker = new HandTracker({
    videoElement: mockVideo,
    canvasElement: null,
  });

  const mockLandmarks = Array(21).fill(null).map((_, i) => ({
    x: 0.5 + (i * 0.01),
    y: 0.5 - (i * 0.01),
    z: 0.0,
  }));

  tracker.onMediaPipeResults({
    multiHandLandmarks: [mockLandmarks],
  });

  assert.strictEqual(tracker.handDetected, true, 'Hand must be flagged as detected even if canvasCtx is null');
  assert(tracker.lastRawHand !== undefined && tracker.lastRawHand !== null, 'lastRawHand must be computed');
  console.log('✓ PASS: Landmark calculation and court positioning execute even without DOM canvas rendering');
}

// --------------------------------------------------------------------------
// TEST 4: FaceTracker Resilience and Detached Canvas Compatibility
// --------------------------------------------------------------------------
console.log('\n--- Test 4: FaceTracker Safari & WebGL Canvas Fallback ---');
{
  const mockVideo = new MockVideo();
  const faceTracker = new FaceTracker({
    videoElement: mockVideo,
    canvasElement: new MockCanvas(),
  });

  let faceReceivedImages = [];
  globalThis.window.FaceDetection = class {
    constructor() {}
    setOptions() {}
    onResults(fn) { this.resultsCallback = fn; }
    async send(payload) {
      faceReceivedImages.push(payload.image);
      if (payload.image instanceof MockCanvas) {
        throw new TypeError("WebGL texImage2D canvas error");
      }
    }
  };

  await faceTracker.startTracking();
  faceTracker.lastFrameTime = 0;
  await new Promise(r => setTimeout(r, 80));

  assert(faceTracker.disableInferenceCanvas === true, 'FaceTracker must disable failing canvas and switch to direct videoElement');
  const hasDirectVideo = faceReceivedImages.some(img => img === mockVideo);
  assert(hasDirectVideo, 'FaceTracker successfully fell back to direct videoElement');
  console.log('✓ PASS: FaceTracker handles Safari canvas error gracefully and switches to video element');

  faceTracker.stopTracking();
}

console.log('\n============================================================');
console.log('ALL CROSS-DEVICE SAFARI / MAC TRACKING TESTS PASSED PERFECTLY');
console.log('============================================================');
