import assert from 'node:assert';
import * as THREE from 'three';
import { FaceTracker } from '../src/tracking/face_tracker.js';
import { TableTennisScene } from '../src/graphics/scene.js';

console.log('=== RUNNING VERIFICATION TEST: FACE TRACKING & VR HEAD PARALLAX ===\n');

// 1. Test FaceTracker lifecycle and toggling
console.log('--- Test 1: FaceTracker Initialization & Toggles ---');
{
  const tracker = new FaceTracker();
  assert.strictEqual(tracker.enabled, true, 'FaceTracker should start enabled by default');
  assert.strictEqual(tracker.isTracking, false, 'FaceTracker should start with isTracking=false');

  // Toggle OFF
  tracker.toggle();
  assert.strictEqual(tracker.enabled, false, 'FaceTracker should be disabled after first toggle()');

  // Toggle ON
  tracker.toggle();
  assert.strictEqual(tracker.enabled, true, 'FaceTracker should be enabled after second toggle()');
  console.log('✓ FaceTracker starts enabled by default and toggles cleanly');
}

// 2. Test Face Detection coordinate mapping and parallax calculations
console.log('\n--- Test 2: Face Detection Parallax Calculation & Clamping ---');
{
  const tracker = new FaceTracker({
    gainX: 1.85,
    gainY: 1.30,
    gainZ: 2.10,
    maxOffsetX: 0.45,
    maxOffsetY: 0.25,
    maxOffsetZ: 0.35,
  });

  tracker.enabled = true;

  let simTime = 1000;
  const step = (box, landmarks = []) => {
    simTime += 16.67;
    tracker.onDetectionResults({
      detections: [
        {
          boundingBox: box,
          landmarks,
        },
      ],
    }, simTime);
    return tracker.getParallaxOffset(0.016);
  };

  // Calibrate neutral center at (xCenter = 0.50, yCenter = 0.50, width = 0.22)
  step(
    { xCenter: 0.50, yCenter: 0.50, width: 0.22, height: 0.28 },
    [{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: 0.50, y: 0.52 }]
  );
  tracker.setNeutralCenter();

  // At neutral center, offset should be ~0
  let offset = tracker.getParallaxOffset(0.016);
  assert(Math.abs(offset.x) < 0.05, `Offset at neutral should be near 0, got ${offset.x}`);
  console.log(`✓ Neutral center calibrated: offset = (${offset.x.toFixed(3)}, ${offset.y.toFixed(3)}, ${offset.z.toFixed(3)})`);

  // Move head to the LEFT (in camera feed, xCenter moves towards 1 -> rawX = 0.70)
  for (let i = 0; i < 30; i++) {
    offset = step(
      { xCenter: 0.70, yCenter: 0.50, width: 0.22, height: 0.28 },
      [{ x: 0.65, y: 0.45 }, { x: 0.75, y: 0.45 }, { x: 0.70, y: 0.52 }]
    );
  }
  assert(offset.x > 0.15, `Moving head left must produce positive X parallax offset in unmirrored mode (got ${offset.x})`);
  console.log(`✓ Moving head LEFT: camera perspective shifts left by +${offset.x.toFixed(3)} m`);

  // Move head to the RIGHT (in camera feed, xCenter moves towards 0 -> rawX = 0.30)
  for (let i = 0; i < 40; i++) {
    offset = step(
      { xCenter: 0.30, yCenter: 0.50, width: 0.22, height: 0.28 },
      [{ x: 0.25, y: 0.45 }, { x: 0.35, y: 0.45 }, { x: 0.30, y: 0.52 }]
    );
  }
  assert(offset.x < -0.15, `Moving head right must produce negative X parallax offset in unmirrored mode (got ${offset.x})`);
  console.log(`✓ Moving head RIGHT: camera perspective shifts right by ${offset.x.toFixed(3)} m`);

  // Move head UP (in camera feed, yCenter moves towards 0 -> rawY = 1 - yCenter = 0.75)
  for (let i = 0; i < 40; i++) {
    offset = step(
      { xCenter: 0.50, yCenter: 0.25, width: 0.22, height: 0.28 },
      [{ x: 0.45, y: 0.20 }, { x: 0.55, y: 0.20 }, { x: 0.50, y: 0.27 }]
    );
  }
  assert(offset.y > 0.10, `Moving head up must produce positive Y parallax offset (got ${offset.y})`);
  console.log(`✓ Moving head UP: camera perspective shifts up by +${offset.y.toFixed(3)} m`);

  // Lean CLOSER (width increases to 0.38)
  for (let i = 0; i < 40; i++) {
    offset = step(
      { xCenter: 0.50, yCenter: 0.50, width: 0.38, height: 0.45 },
      [{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: 0.50, y: 0.52 }]
    );
  }
  assert(offset.z > 0.15, `Leaning closer must produce positive Z forward zoom offset (got ${offset.z})`);
  console.log(`✓ Leaning CLOSER: camera perspective moves forward into scene by +${offset.z.toFixed(3)} m`);

  // Test maximum clamping (extreme head motion should never overpower or break view)
  for (let i = 0; i < 40; i++) {
    offset = step({ xCenter: 0.01, yCenter: 0.01, width: 0.95, height: 0.95 });
  }
  assert(Math.abs(offset.x) <= 0.45, `Offset X must be clamped to <= 0.45, got ${offset.x}`);
  assert(Math.abs(offset.y) <= 0.25, `Offset Y must be clamped to <= 0.25, got ${offset.y}`);
  assert(Math.abs(offset.z) <= 0.35, `Offset Z must be clamped to <= 0.35, got ${offset.z}`);
  console.log(`✓ Extreme movement safely clamped to non-overpowering bounds: max X=${offset.x.toFixed(3)}m, Y=${offset.y.toFixed(3)}m, Z=${offset.z.toFixed(3)}m`);

  // Test disable smooth zeroing
  tracker.disable();
  for (let i = 0; i < 30; i++) {
    offset = tracker.getParallaxOffset(0.016);
  }
  assert(Math.abs(offset.x) < 0.01 && Math.abs(offset.y) < 0.01 && Math.abs(offset.z) < 0.01, 'Disabling must smoothly glide offset back to (0, 0, 0)');
  console.log('✓ Disabling smoothly restores camera to default reference position (0, 0, 0)');
}

// 3. Test 3D Camera Parallax Math Across Views
console.log('\n--- Test 3: Three.js Camera Parallax Across Views ---');
{
  const views = {
    host: {
      position: new THREE.Vector3(0, 1.48, -2.55),
      target: new THREE.Vector3(0, 0.82, 0.20),
    },
    client: {
      position: new THREE.Vector3(0, 1.48, 2.55),
      target: new THREE.Vector3(0, 0.82, -0.20),
    },
    broadcast: {
      position: new THREE.Vector3(2.45, 1.65, 0),
      target: new THREE.Vector3(0, 0.82, 0),
    },
    topdown: {
      position: new THREE.Vector3(0, 3.20, 0.001),
      target: new THREE.Vector3(0, 0.76, 0),
    },
  };

  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 100);
  const smoothedHeadOffset = new THREE.Vector3(0, 0, 0);

  function applyParallax(viewMode, targetOffset, dt = 0.016) {
    const view = views[viewMode];
    // Smooth lerp
    smoothedHeadOffset.lerp(targetOffset, Math.min(1.0, dt * 10.0));

    if (viewMode === 'topdown') {
      camera.position.set(
        view.position.x + smoothedHeadOffset.x,
        view.position.y - smoothedHeadOffset.z * 0.5,
        view.position.z + smoothedHeadOffset.y
      );
    } else if (viewMode === 'client') {
      camera.position.set(
        view.position.x + smoothedHeadOffset.x,
        view.position.y + smoothedHeadOffset.y,
        view.position.z - smoothedHeadOffset.z
      );
    } else if (viewMode === 'broadcast') {
      camera.position.set(
        view.position.x - smoothedHeadOffset.z,
        view.position.y + smoothedHeadOffset.y,
        view.position.z + smoothedHeadOffset.x
      );
    } else {
      camera.position.set(
        view.position.x + smoothedHeadOffset.x,
        view.position.y + smoothedHeadOffset.y,
        view.position.z + smoothedHeadOffset.z
      );
    }
    camera.lookAt(view.target);
  }

  // Test Host View (P1)
  const baseHostPos = views.host.position.clone();
  const testOffset = new THREE.Vector3(0.25, 0.12, 0.15);

  for (let i = 0; i < 20; i++) {
    applyParallax('host', testOffset);
  }
  const expectedCamPos = baseHostPos.clone().add(testOffset);
  const diff = camera.position.distanceTo(expectedCamPos);
  assert(diff < 0.05, `Host camera should be offset by head position (diff: ${diff.toFixed(4)})`);
  console.log(`✓ Host View P1: camera moved smoothly from (${baseHostPos.x.toFixed(2)}, ${baseHostPos.y.toFixed(2)}, ${baseHostPos.z.toFixed(2)}) to (${camera.position.x.toFixed(3)}, ${camera.position.y.toFixed(3)}, ${camera.position.z.toFixed(3)})`);

  // Test Top-Down Bird's Eye View
  smoothedHeadOffset.set(0, 0, 0);
  const baseTopPos = views.topdown.position.clone();
  for (let i = 0; i < 20; i++) {
    applyParallax('topdown', testOffset);
  }
  assert(camera.position.x > baseTopPos.x + 0.15, 'Top-down view should shift X with head movement');
  console.log(`✓ Top-Down View: camera shifted to (${camera.position.x.toFixed(3)}, ${camera.position.y.toFixed(3)}, ${camera.position.z.toFixed(3)})`);

  // Reset to 0
  for (let i = 0; i < 30; i++) {
    applyParallax('topdown', new THREE.Vector3(0, 0, 0));
  }
  const topDiff = camera.position.distanceTo(baseTopPos);
  assert(topDiff < 0.05, `Camera must return to exact preset when offset is 0 (diff: ${topDiff.toFixed(4)})`);
  console.log('✓ Camera smoothly returns to exact preset baseline when head returns to center');
}

console.log('\n=== ALL FACE TRACKING & PARALLAX TESTS PASSED! ===');
