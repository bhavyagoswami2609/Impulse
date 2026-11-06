import assert from 'node:assert';
import * as THREE from 'three';
import { FaceTracker } from '../src/tracking/face_tracker.js';
import { TableTennisScene } from '../src/graphics/scene.js';

console.log('=== TEST SUITE: HEAD TRACKING SMOOTHNESS & INVERSION CORRECTION ===\n');

// 1. Inversion Check: Turning head RIGHT must rotate view RIGHT, shifting central targets to the LEFT
console.log('--- Test 1: Inversion Correction (Looking Right Turns Camera Right) ---');
{
  const tracker = new FaceTracker({
    gainYaw: 0.50,
    maxYaw: 0.20,
    yawDeadband: 0.02,
  });
  tracker.enabled = true;

  const neutralBox = { xCenter: 0.50, yCenter: 0.50, width: 0.22, height: 0.28 };
  const neutralLandmarks = [
    { x: 0.45, y: 0.45 }, // Right eye
    { x: 0.55, y: 0.45 }, // Left eye
    { x: 0.50, y: 0.52 }, // Nose
  ];

  let simTime = 1000;
  for (let i = 0; i < 15; i++) {
    simTime += 60;
    tracker.onDetectionResults({
      detections: [{ boundingBox: neutralBox, landmarks: neutralLandmarks }],
    }, simTime);
    tracker.getYaw(0.016);
  }
  tracker.setNeutralCenter();

  // User physically turns head to look RIGHT:
  // In unmirrored camera view, nose shifts towards camera left (e.g. from 0.50 to 0.47)
  const lookRightLandmarks = [
    { x: 0.45, y: 0.45 },
    { x: 0.55, y: 0.45 },
    { x: 0.47, y: 0.52 },
  ];

  let yaw = 0;
  for (let i = 0; i < 30; i++) {
    simTime += 60;
    tracker.onDetectionResults({
      detections: [{ boundingBox: neutralBox, landmarks: lookRightLandmarks }],
    }, simTime);
    yaw = tracker.getYaw(0.016);
  }

  assert(yaw > 0.05, `Head yaw when looking right must be positive (got ${yaw})`);

  // Verify Three.js camera rotation in Table Tennis host view
  const scene = new TableTennisScene();
  scene.isOrbiting = false;
  scene.setViewMode('host');
  scene.setHeadParallaxOffset(new THREE.Vector3(0, 0, 0), yaw);

  // Update scene over 25 frames (60fps)
  for (let f = 0; f < 25; f++) {
    scene.update(0.016);
  }

  // With view turned to the player's right, the center of the table (0, 0.82, 0)
  // must project to the LEFT side of the screen (negative NDC X)
  const centerTableNDC = new THREE.Vector3(0, 0.82, 0).project(scene.camera);
  assert(centerTableNDC.x < -0.05, `When looking right, center of table must shift to screen left (got ${centerTableNDC.x})`);
  console.log(`✓ Looking right correctly turns camera right: table NDC X = ${centerTableNDC.x.toFixed(3)} (Screen Left)`);

  // Check PIP overlay indicator text
  let drawnText = '';
  const mockCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    arc: () => {},
    fillText: (text) => { drawnText += text + ' '; },
  };
  tracker.drawPIPOverlay(mockCtx, 320, 240);
  assert(drawnText.includes('LOOKING RIGHT'), `PIP HUD must indicate LOOKING RIGHT (got "${drawnText}")`);
  console.log(`✓ PIP overlay accurately displays direction: "${drawnText.trim()}"`);
}

// 2. Lateral Movement Inversion Check: Moving head RIGHT must shift camera to SCREEN RIGHT (world -X)
console.log('\n--- Test 2: Lateral Head Movement Inversion Check (Moving Right Shifts Camera Right) ---');
{
  const tracker = new FaceTracker({
    gainX: 0.50,
    maxOffsetX: 0.16,
    parallaxDeadband: 0.01,
  });
  tracker.enabled = true;

  let simTime = 2000;
  const neutralBox = { xCenter: 0.50, yCenter: 0.50, width: 0.22, height: 0.28 };
  const landmarks = [{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: 0.50, y: 0.52 }];

  for (let i = 0; i < 15; i++) {
    simTime += 60;
    tracker.onDetectionResults({
      detections: [{ boundingBox: neutralBox, landmarks }],
    }, simTime);
    tracker.getParallaxOffset(0.016);
  }
  tracker.setNeutralCenter();

  // User physically moves head to the RIGHT:
  // In unmirrored camera view, xCenter decreases towards camera left (e.g. 0.38)
  const moveRightBox = { xCenter: 0.38, yCenter: 0.50, width: 0.22, height: 0.28 };
  let offset = new THREE.Vector3();
  for (let i = 0; i < 30; i++) {
    simTime += 60;
    tracker.onDetectionResults({
      detections: [{ boundingBox: moveRightBox, landmarks }],
    }, simTime);
    offset = tracker.getParallaxOffset(0.016);
  }

  // offset.x must be negative (world -X) so camera moves right
  assert(offset.x < -0.04, `Moving head right must produce negative world X offset for host view (got ${offset.x})`);

  const scene = new TableTennisScene();
  scene.isOrbiting = false;
  scene.setViewMode('host');
  scene.setHeadParallaxOffset(offset, 0);

  for (let f = 0; f < 25; f++) {
    scene.update(0.016);
  }

  // Camera must be shifted to world -X (which is screen right in Host view)
  assert(scene.camera.position.x < -0.03, `Host camera must shift to world -X (got ${scene.camera.position.x})`);
  console.log(`✓ Moving head right shifts camera right: camera.position.x = ${scene.camera.position.x.toFixed(3)} (World -X / Screen Right)`);
}

// 3. Jitter Suppression & Resting Steadiness
console.log('\n--- Test 3: High-Frequency Sensor Jitter Suppression (Rock-Solid Stationary Hold) ---');
{
  const tracker = new FaceTracker({
    yawDeadband: 0.02,
    parallaxDeadband: 0.012,
  });
  tracker.enabled = true;

  let simTime = 3000;
  const neutralBox = { xCenter: 0.50, yCenter: 0.50, width: 0.22, height: 0.28 };
  const landmarks = [{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: 0.50, y: 0.52 }];

  for (let i = 0; i < 15; i++) {
    simTime += 60;
    tracker.onDetectionResults({
      detections: [{ boundingBox: neutralBox, landmarks }],
    }, simTime);
    tracker.getYaw(0.016);
  }
  tracker.setNeutralCenter();

  // Inject artificial high-frequency sensor noise (jittering by ±0.015 in landmarks and ±0.01 in box)
  const yawOutputs = [];
  const offsetOutputs = [];

  for (let i = 0; i < 40; i++) {
    simTime += 60;
    const noise = (Math.sin(i * 2.3) * 0.012);
    const noisyBox = {
      xCenter: 0.50 + noise,
      yCenter: 0.50 + (Math.cos(i * 1.9) * 0.01),
      width: 0.22 + (Math.sin(i * 3.1) * 0.008),
      height: 0.28,
    };
    const noisyLandmarks = [
      { x: 0.45 + noise * 0.5, y: 0.45 },
      { x: 0.55 + noise * 0.5, y: 0.45 },
      { x: 0.50 + noise, y: 0.52 },
    ];

    tracker.onDetectionResults({
      detections: [{ boundingBox: noisyBox, landmarks: noisyLandmarks }],
    }, simTime);

    // Sample at 60 FPS
    for (let f = 0; f < 4; f++) {
      yawOutputs.push(tracker.getYaw(0.016));
      offsetOutputs.push(tracker.getParallaxOffset(0.016).clone());
    }
  }

  // Calculate max peak-to-peak variation under noisy input
  const maxYaw = Math.max(...yawOutputs);
  const minYaw = Math.min(...yawOutputs);
  const yawSpread = maxYaw - minYaw;

  const maxOffsetX = Math.max(...offsetOutputs.map(o => o.x));
  const minOffsetX = Math.min(...offsetOutputs.map(o => o.x));
  const offsetSpread = maxOffsetX - minOffsetX;

  console.log(`Stationary noise test: raw landmark jitter ±0.012 -> filtered yaw spread: ${yawSpread.toFixed(4)} rad`);
  console.log(`Stationary noise test: raw position jitter ±0.010 -> filtered offset spread: ${offsetSpread.toFixed(4)} m`);

  assert(yawSpread < 0.005, `Yaw spread under resting noise must be < 0.005 rad, got ${yawSpread}`);
  assert(offsetSpread < 0.005, `Offset spread under resting noise must be < 0.005 m, got ${offsetSpread}`);
  console.log('✓ High-frequency webcam landmark jitter completely suppressed (rock-solid resting stability)');
}

// 4. Smooth Organic Velocity & Acceleration (Natural Gaze Physics)
console.log('\n--- Test 4: Smooth Organic Head Rotation (Continuous Velocity, No Snapping) ---');
{
  const tracker = new FaceTracker({
    gainYaw: 0.48,
    maxYaw: 0.18,
    yawDeadband: 0.02,
  });
  tracker.enabled = true;

  let simTime = 4000;
  const neutralBox = { xCenter: 0.50, yCenter: 0.50, width: 0.22, height: 0.28 };
  const baseLandmarks = [{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: 0.50, y: 0.52 }];

  for (let i = 0; i < 15; i++) {
    simTime += 60;
    tracker.onDetectionResults({
      detections: [{ boundingBox: neutralBox, landmarks: baseLandmarks }],
    }, simTime);
    tracker.getYaw(0.016);
  }
  tracker.setNeutralCenter();

  // User smoothly turns head over 300ms from 0 to 12 degrees
  const velocities = [];
  let prevYaw = 0;

  for (let frame = 0; frame < 30; frame++) {
    simTime += 16.67;
    // Step detection every ~60ms (4 frames)
    if (frame % 4 === 0) {
      const progress = Math.min(1.0, (frame / 20));
      const noseX = 0.50 - progress * 0.035; // Turn head right
      tracker.onDetectionResults({
        detections: [{
          boundingBox: neutralBox,
          landmarks: [{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: noseX, y: 0.52 }],
        }],
      }, simTime);
    }

    const currentYaw = tracker.getYaw(0.016);
    const vel = (currentYaw - prevYaw) / 0.016;
    velocities.push(vel);
    prevYaw = currentYaw;
  }

  // Ensure velocity changes smoothly without sharp spikes
  for (let i = 1; i < velocities.length; i++) {
    const dVel = Math.abs(velocities[i] - velocities[i - 1]);
    assert(dVel < 0.25, `Yaw velocity jump between frames must be smooth (< 0.25 rad/s²), got ${dVel} at frame ${i}`);
  }
  console.log('✓ Angular acceleration is continuous and fluid (natural human head inertia verified)');
}

// 5. Cross-Discipline Check: Head Tracking In Air Hockey
console.log('\n--- Test 5: Head Tracking In Air Hockey Discipline ---');
{
  const scene = new TableTennisScene();
  scene.isOrbiting = false;
  scene.setViewMode('host');
  scene.setGameMode('hockey');

  // Check that air hockey table and visual assets are active
  assert(scene.hockeyTable !== null && scene.hockeyTable.visible === true, 'Air hockey table must be visible');

  // Apply head tracking yaw to air hockey view
  scene.setHeadParallaxOffset(new THREE.Vector3(-0.08, 0.04, 0.05), 0.12);
  for (let f = 0; f < 30; f++) {
    scene.update(0.016);
  }

  // Center of hockey table (0, 0.82, 0) should project to screen left
  const hockeyCenterNDC = new THREE.Vector3(0, 0.82, 0).project(scene.camera);
  assert(hockeyCenterNDC.x < -0.05, `Air Hockey center must shift left when looking right (got ${hockeyCenterNDC.x})`);
  console.log(`✓ Air hockey camera perspective seamlessly responds to head tracking: table NDC X = ${hockeyCenterNDC.x.toFixed(3)}`);
}

console.log('\n=== ALL HEAD TRACKING SMOOTHNESS & INVERSION TESTS PASSED! ===');
