import assert from 'node:assert';
import * as THREE from 'three';

// Provide browser globals for Node test
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1920,
  innerHeight: 1080,
  location: { hostname: 'localhost', protocol: 'http:' },
  AudioContext: class {
    createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
  }
};
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    configurable: true,
  });
} catch (e) {}

import { HandTracker } from '../src/tracking/hand_tracker.js';

console.log('=== RUNNING VERIFICATION TEST: SPIDER-MAN GESTURE CALIBRATION ===\n');

/**
 * Creates a synthetic 21-landmark hand model.
 * Base wrist at (0.5, 0.8, 0).
 * Hand points up towards negative Y (in screen coords, top is smaller Y).
 */
function createHandLandmarks({
  thumbExtended = false,
  indexExtended = false,
  middleExtended = false,
  ringExtended = false,
  pinkyExtended = false,
}) {
  const landmarks = [];
  const wrist = { x: 0.5, y: 0.8, z: 0 };
  landmarks[0] = wrist;

  // Thumb
  landmarks[1] = { x: 0.46, y: 0.74, z: -0.01 };
  landmarks[2] = { x: 0.43, y: 0.70, z: -0.015 };
  if (thumbExtended) {
    // Thumb spread wide out to the left
    landmarks[3] = { x: 0.38, y: 0.67, z: -0.02 };
    landmarks[4] = { x: 0.32, y: 0.65, z: -0.025 };
  } else {
    // Thumb folded over palm/fingers
    landmarks[3] = { x: 0.46, y: 0.68, z: -0.01 };
    landmarks[4] = { x: 0.48, y: 0.67, z: -0.005 };
  }

  // Fingers helper
  function addFinger(mcpIdx, rootX, rootY, isExtended) {
    landmarks[mcpIdx] = { x: rootX, y: rootY, z: 0 }; // MCP
    if (isExtended) {
      landmarks[mcpIdx + 1] = { x: rootX, y: rootY - 0.08, z: 0 }; // PIP
      landmarks[mcpIdx + 2] = { x: rootX, y: rootY - 0.14, z: 0 }; // DIP
      landmarks[mcpIdx + 3] = { x: rootX, y: rootY - 0.20, z: 0 }; // TIP (straight out)
    } else {
      // Curled into palm
      landmarks[mcpIdx + 1] = { x: rootX, y: rootY - 0.05, z: -0.02 }; // PIP
      landmarks[mcpIdx + 2] = { x: rootX, y: rootY - 0.02, z: -0.03 }; // DIP
      landmarks[mcpIdx + 3] = { x: rootX, y: rootY + 0.02, z: -0.02 }; // TIP (folded down into palm)
    }
  }

  // Index (MCP: 5)
  addFinger(5, 0.46, 0.65, indexExtended);
  // Middle (MCP: 9)
  addFinger(9, 0.50, 0.63, middleExtended);
  // Ring (MCP: 13)
  addFinger(13, 0.54, 0.65, ringExtended);
  // Pinky (MCP: 17)
  addFinger(17, 0.58, 0.68, pinkyExtended);

  return landmarks;
}

const tracker = new HandTracker({});

// =========================================================================
// TEST 1: Hand Sign Classification Accuracy
// =========================================================================
console.log('--- Test 1: Gesture Classification Accuracy ---');
{
  // 1. Spider-Man Sign (🤟): Thumb out, Index UP, Pinky UP, Middle curled, Ring curled
  const spidermanHand = createHandLandmarks({
    thumbExtended: true,
    indexExtended: true,
    middleExtended: false,
    ringExtended: false,
    pinkyExtended: true,
  });
  assert.strictEqual(tracker.isSpidermanSign(spidermanHand), true, 'Spider-Man sign must be recognized as TRUE');
  console.log('✓ Spider-Man sign (🤟) correctly recognized!');

  // 2. Open Palm (Serve): All extended
  const openHand = createHandLandmarks({
    thumbExtended: true,
    indexExtended: true,
    middleExtended: true,
    ringExtended: true,
    pinkyExtended: true,
  });
  assert.strictEqual(tracker.isSpidermanSign(openHand), false, 'Open hand must NOT trigger Spider-Man sign');
  console.log('✓ Open Palm correctly rejected (not Spider-Man)');

  // 3. Closed Fist (Grip): All curled
  const fistHand = createHandLandmarks({
    thumbExtended: false,
    indexExtended: false,
    middleExtended: false,
    ringExtended: false,
    pinkyExtended: false,
  });
  assert.strictEqual(tracker.isSpidermanSign(fistHand), false, 'Fist must NOT trigger Spider-Man sign');
  console.log('✓ Closed Fist correctly rejected (not Spider-Man)');

  // 4. Peace Sign (✌️): Index + Middle UP, others curled
  const peaceHand = createHandLandmarks({
    thumbExtended: false,
    indexExtended: true,
    middleExtended: true,
    ringExtended: false,
    pinkyExtended: false,
  });
  assert.strictEqual(tracker.isSpidermanSign(peaceHand), false, 'Peace sign must NOT trigger Spider-Man sign');
  console.log('✓ Peace Sign (✌️) correctly rejected');

  // 5. Pointing (👉): Only Index UP
  const pointHand = createHandLandmarks({
    thumbExtended: false,
    indexExtended: true,
    middleExtended: false,
    ringExtended: false,
    pinkyExtended: false,
  });
  assert.strictEqual(tracker.isSpidermanSign(pointHand), false, 'Pointing gesture must NOT trigger Spider-Man sign');
  console.log('✓ Pointing gesture correctly rejected');

  // 6. Thumbs Up (👍): Only Thumb extended
  const thumbsUpHand = createHandLandmarks({
    thumbExtended: true,
    indexExtended: false,
    middleExtended: false,
    ringExtended: false,
    pinkyExtended: false,
  });
  assert.strictEqual(tracker.isSpidermanSign(thumbsUpHand), false, 'Thumbs Up must NOT trigger Spider-Man sign');
  console.log('✓ Thumbs Up correctly rejected');
}

// =========================================================================
// TEST 2: Gesture Hold Duration & Calibration Triggering
// =========================================================================
console.log('\n--- Test 2: Gesture Hold & Calibration Trigger Lifecycle ---');
{
  let gestureCalibrateCount = 0;
  const mockCanvas = {
    width: 320,
    height: 240,
    getContext: () => ({
      save: () => {},
      restore: () => {},
      clearRect: () => {},
      drawImage: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      arc: () => {},
      fill: () => {},
      setLineDash: () => {},
      fillText: () => {},
    }),
  };

  const gestureTracker = new HandTracker({
    canvasElement: mockCanvas,
    onGestureCalibrate: () => {
      gestureCalibrateCount++;
    },
  });

  const spidermanHand = createHandLandmarks({
    thumbExtended: true,
    indexExtended: true,
    middleExtended: false,
    ringExtended: false,
    pinkyExtended: true,
  });

  // Frame 1: 33ms -> should charge progress, but NOT calibrate yet
  gestureTracker.lastResultsTimestamp = 1000;
  // Mock performance.now
  let mockNow = 1033;
  const origNow = performance.now;
  performance.now = () => mockNow;

  gestureTracker.onMediaPipeResults({ multiHandLandmarks: [spidermanHand], image: {} });
  assert.strictEqual(gestureCalibrateCount, 0, 'Must not calibrate on frame 1 (needs hold duration)');
  assert(gestureTracker.spidermanGestureProgress > 0, 'Progress should start accumulating');
  assert(gestureTracker.spidermanGestureProgress < 1.0, 'Progress not yet full');
  console.log(`✓ Frame 1 (33ms): Progress charging (${(gestureTracker.spidermanGestureProgress * 100).toFixed(1)}%), not prematurely triggered`);

  // Step 200ms forward with gesture held
  for (let f = 0; f < 8; f++) {
    mockNow += 30;
    gestureTracker.onMediaPipeResults({ multiHandLandmarks: [spidermanHand], image: {} });
  }

  assert.strictEqual(gestureCalibrateCount, 1, 'Gesture held for > 200ms should trigger onGestureCalibrate');
  assert.strictEqual(gestureTracker.isCalibrated, true, 'HandTracker neutral center should be calibrated');
  assert(gestureTracker.spidermanGestureCooldown > 1.0, 'Cooldown should be active to prevent repeating');
  assert(gestureTracker.gestureCalibratedFlashTimer > 1.0, 'Flash feedback badge should be active');
  console.log('✓ Successfully triggered calibration callback & locked neutral reference on sustained gesture!');

  // Frame while still holding during cooldown: should NOT trigger second calibration
  mockNow += 33;
  gestureTracker.onMediaPipeResults({ multiHandLandmarks: [spidermanHand], image: {} });
  assert.strictEqual(gestureCalibrateCount, 1, 'Cooldown must prevent machine-gun duplicate calibrations');
  console.log('✓ Cooldown safely prevents continuous duplicate calibrations while holding hand up');

  // Restore performance.now
  performance.now = origNow;
}

console.log('\n=== ALL SPIDER-MAN GESTURE TESTS PASSED PERFECTLY! ===');
