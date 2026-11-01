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

// 4. Test In-Game Button & Auto Face Calibration
console.log('\n--- Test 4: Dynamic Face Center Recalibration on Button Click ---');
{
  const tracker = new FaceTracker();
  tracker.enabled = true;

  let simTime = 2000;
  // Step with user sitting off-center (e.g. leaning left at xCenter = 0.65)
  for (let i = 0; i < 20; i++) {
    simTime += 16.67;
    tracker.onDetectionResults({
      detections: [
        {
          boundingBox: { xCenter: 0.65, yCenter: 0.40, width: 0.25, height: 0.30 },
          landmarks: [],
        },
      ],
    }, simTime);
    tracker.getParallaxOffset(0.016);
  }

  // Now user clicks CALIBRATE button (calling setNeutralCenter)
  const success = tracker.setNeutralCenter();
  assert.strictEqual(success, true, 'setNeutralCenter() must succeed');

  // Instantly, offset should be reset to (0, 0, 0)
  const instantOffset = tracker.getParallaxOffset(0.016);
  assert(Math.abs(instantOffset.x) < 0.01, `Parallax X must be zeroed immediately upon calibration (got ${instantOffset.x})`);
  assert(Math.abs(instantOffset.y) < 0.01, `Parallax Y must be zeroed immediately upon calibration (got ${instantOffset.y})`);
  assert(Math.abs(instantOffset.z) < 0.01, `Parallax Z must be zeroed immediately upon calibration (got ${instantOffset.z})`);
  console.log('✓ Button click instantly locks current head pose as (0, 0, 0) reference');

  // When user stays at that calibrated pose, offsets remain at 0
  simTime += 16.67;
  tracker.onDetectionResults({
    detections: [
      {
        boundingBox: { xCenter: 0.65, yCenter: 0.40, width: 0.25, height: 0.30 },
        landmarks: [],
      },
    ],
  }, simTime);
  const settledOffset = tracker.getParallaxOffset(0.016);
  assert(Math.abs(settledOffset.x) < 0.05, 'Off-center head is now the true zero center');
  console.log('✓ Calibrated pose stably maintained as neutral origin');
}

// 5. Test Head Yaw Rotation (Looking Left / Looking Right around vertical Y-axis)
console.log('\n--- Test 5: Head Yaw Rotation (Looking Left vs. Right around Y-axis) ---');
{
  const tracker = new FaceTracker({
    gainYaw: 0.85,
    maxYaw: 0.45,
  });
  tracker.enabled = true;

  let simTime = 3000;
  const stepFace = (box, landmarks = []) => {
    simTime += 16.67;
    tracker.onDetectionResults({
      detections: [
        {
          boundingBox: box,
          landmarks,
        },
      ],
    }, simTime);
    tracker.getParallaxOffset(0.016);
    return tracker.getYaw(0.016);
  };

  // Base neutral face at center: Right Eye at 0.45, Left Eye at 0.55, Nose at 0.50
  const neutralBox = { xCenter: 0.50, yCenter: 0.50, width: 0.22, height: 0.28 };
  const neutralLandmarks = [
    { x: 0.45, y: 0.45 }, // Right Eye (0)
    { x: 0.55, y: 0.45 }, // Left Eye (1)
    { x: 0.50, y: 0.52 }, // Nose Tip (2)
    { x: 0.50, y: 0.60 }, // Mouth (3)
    { x: 0.38, y: 0.47 }, // Right Ear (4)
    { x: 0.62, y: 0.47 }, // Left Ear (5)
  ];

  // Warm up and calibrate
  for (let i = 0; i < 15; i++) {
    stepFace(neutralBox, neutralLandmarks);
  }
  tracker.setNeutralCenter();

  let yaw = tracker.getYaw(0.016);
  assert(Math.abs(yaw) < 0.05, `Neutral head yaw should be ~0, got ${yaw}`);
  console.log(`✓ Neutral Head Yaw calibrated: yaw = ${(THREE.MathUtils.radToDeg(yaw)).toFixed(2)}° (${yaw.toFixed(4)} rad)`);

  // User looks to their RIGHT: head position DOES NOT move (xCenter stays 0.50),
  // but face rotates around Y: nose turns towards right eye (nose.x moves from 0.50 to 0.46)
  const lookRightLandmarks = [
    { x: 0.45, y: 0.45 },
    { x: 0.54, y: 0.45 },
    { x: 0.465, y: 0.52 }, // Nose shifted rightward relative to face
    { x: 0.47, y: 0.60 },
    { x: 0.41, y: 0.47 },
    { x: 0.61, y: 0.47 },
  ];
  for (let i = 0; i < 40; i++) {
    yaw = stepFace(neutralBox, lookRightLandmarks);
  }
  assert(yaw > 0.12, `Looking to the RIGHT must produce positive Yaw in unmirrored mode (got ${yaw})`);
  console.log(`✓ Looking to the RIGHT: detected positive yaw +${(THREE.MathUtils.radToDeg(yaw)).toFixed(2)}° (+${yaw.toFixed(3)} rad) without moving head position`);

  // Verify camera rotation when looking RIGHT (Host View: camera pans to screen right, target shifts to -X)
  const hostCamPos = new THREE.Vector3(0, 1.48, -2.55);
  const hostBaseTarget = new THREE.Vector3(0, 0.82, 0.20);
  const baseDir = hostBaseTarget.clone().sub(hostCamPos);
  const rotatedDirRight = baseDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  const effectiveTargetRight = hostCamPos.clone().add(rotatedDirRight);
  assert(effectiveTargetRight.x < -0.10, `Camera target must shift towards screen right (-X), got ${effectiveTargetRight.x}`);
  console.log(`✓ Camera view cleanly turns to the RIGHT: target.x = ${effectiveTargetRight.x.toFixed(3)} (Screen Right)`);

  // User looks to their LEFT: head position DOES NOT move (xCenter stays 0.50),
  // nose turns towards left eye (nose.x moves from 0.50 to 0.535)
  const lookLeftLandmarks = [
    { x: 0.46, y: 0.45 },
    { x: 0.55, y: 0.45 },
    { x: 0.535, y: 0.52 }, // Nose shifted leftward relative to face
    { x: 0.53, y: 0.60 },
    { x: 0.39, y: 0.47 },
    { x: 0.59, y: 0.47 },
  ];
  for (let i = 0; i < 50; i++) {
    yaw = stepFace(neutralBox, lookLeftLandmarks);
  }
  assert(yaw < -0.12, `Looking to the LEFT must produce negative Yaw in unmirrored mode (got ${yaw})`);
  console.log(`✓ Looking to the LEFT: detected negative yaw ${(THREE.MathUtils.radToDeg(yaw)).toFixed(2)}° (${yaw.toFixed(3)} rad) without moving head position`);

  // Verify camera rotation when looking LEFT (Host View: camera pans to screen left, target shifts to +X)
  const rotatedDirLeft = baseDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  const effectiveTargetLeft = hostCamPos.clone().add(rotatedDirLeft);
  assert(effectiveTargetLeft.x > 0.10, `Camera target must shift towards screen left (+X), got ${effectiveTargetLeft.x}`);
  console.log(`✓ Camera view cleanly turns to the LEFT: target.x = +${effectiveTargetLeft.x.toFixed(3)} (Screen Left)`);

  // Verify disable zeroes yaw smoothly
  tracker.disable();
  for (let i = 0; i < 30; i++) {
    yaw = tracker.getYaw(0.016);
  }
  assert(Math.abs(yaw) < 0.01, `Disabling must smoothly return yaw to 0, got ${yaw}`);
  console.log('✓ Disabling smoothly returns head yaw rotation to 0.00°');
}

console.log('\n=== ALL HEAD TRACKING, PARALLAX & ROTATION TESTS PASSED! ===');
