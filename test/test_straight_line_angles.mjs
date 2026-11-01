import assert from 'node:assert';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/physics_world.js';
import { TABLE_WIDTH, TABLE_LENGTH, TABLE_HEIGHT } from '../src/graphics/procedural_models.js';

console.log('=== VERIFICATION TEST: STRAIGHT LINE TRAJECTORY & REALISTIC ANGLES ===\n');

function createTestPhysics() {
  const bounces = [];
  const hits = [];
  const physics = new PhysicsWorld({
    onBallBounceTable: (pos, side) => bounces.push({ pos: pos.clone(), side }),
    onBallHitPaddle: (player, speed) => hits.push({ player, speed }),
  });
  physics.lastPaddleHitTime = -1000;
  physics.lastTableBounceTime = -1000;
  return { physics, bounces, hits };
}

// =========================================================================
// TEST 1: Horizontal Trajectory is a Pure Straight Line (Zero Curvature)
// =========================================================================
console.log('--- Test 1: Verification of Pure Straight Line Flight (dx/dz = const) ---');
{
  const { physics } = createTestPhysics();
  physics.isInRally = true;
  physics.isServeFlight = false;

  // Ball moving towards P1 at initial angle
  physics.ballBody.position.set(0.0, 0.88, -1.10);
  physics.ballBody.velocity.set(0.0, -0.4, -2.5);

  const p1Pos = new THREE.Vector3(0.0, 0.80, -1.15);
  const p1Vel = new THREE.Vector3(0.0, 0.0, 1.2);
  const p1Yaw = 0.25; // Angled right (~14.3 degrees)

  // Step to trigger strike
  physics.step(0.016, p1Pos, p1Vel, p1Yaw, new THREE.Vector3(0, 0.8, 1.5), new THREE.Vector3(), 0, 0);

  const initialVx = physics.ballBody.velocity.x;
  const initialVz = physics.ballBody.velocity.z;

  assert(initialVz > 2.0, `Ball must be traveling forward towards +Z, got vz=${initialVz}`);
  assert(initialVx > 0.4, `Positive yaw must produce positive Vx (angled right), got vx=${initialVx}`);

  const expectedSlope = initialVx / initialVz;
  const startX = physics.ballBody.position.x;
  const startZ = physics.ballBody.position.z;

  // Track flight trajectory over 30 physics steps
  let maxCurvatureDev = 0;
  for (let i = 0; i < 30; i++) {
    physics.step(0.016, p1Pos, new THREE.Vector3(), p1Yaw, new THREE.Vector3(0, 0.8, 1.5), new THREE.Vector3(), 0, 0);
    const currX = physics.ballBody.position.x;
    const currZ = physics.ballBody.position.z;
    const dz = currZ - startZ;
    if (dz > 0.05) {
      const actualSlope = (currX - startX) / dz;
      const dev = Math.abs(actualSlope - expectedSlope);
      if (dev > maxCurvatureDev) maxCurvatureDev = dev;
    }
  }

  assert(maxCurvatureDev < 0.001, `Ball must not curve mid-air! Max slope deviation was ${maxCurvatureDev}`);
  console.log(`✓ Straight-line trajectory verified: Slope (dx/dz) remained perfectly constant ${expectedSlope.toFixed(4)} (dev: ${maxCurvatureDev.toFixed(6)})`);
}

// =========================================================================
// TEST 2: Angle Realism - Paddle Yaw & Swing Angles Map Faithfully
// =========================================================================
console.log('\n--- Test 2: Angle Realism Across Yaw & Swipe Orientations ---');
{
  const testAngles = [
    { name: 'Straight Ahead (0° Yaw)', yaw: 0.0, velX: 0.0, expectedVxSign: 0 },
    { name: 'Angled Right (+15° Yaw)', yaw: 0.26, velX: 0.0, expectedVxSign: 1 },
    { name: 'Angled Left (-15° Yaw)', yaw: -0.26, velX: 0.0, expectedVxSign: -1 },
    { name: 'Right Swipe (+X Swing)', yaw: 0.0, velX: 1.5, expectedVxSign: 1 },
    { name: 'Left Swipe (-X Swing)', yaw: 0.0, velX: -1.5, expectedVxSign: -1 },
  ];

  for (const t of testAngles) {
    const { physics } = createTestPhysics();
    physics.isInRally = true;
    physics.isServeFlight = false;

    physics.ballBody.position.set(0.0, 0.88, -1.10);
    physics.ballBody.velocity.set(0.0, -0.4, -2.5);

    const p1Pos = new THREE.Vector3(0.0, 0.80, -1.15);
    const p1Vel = new THREE.Vector3(t.velX, 0.0, 1.0);
    const p1Yaw = t.yaw;

    physics.step(0.016, p1Pos, p1Vel, p1Yaw, new THREE.Vector3(0, 0.8, 1.5), new THREE.Vector3(), 0, 0);

    const vx = physics.ballBody.velocity.x;
    const vz = physics.ballBody.velocity.z;
    const angleDeg = (Math.atan2(vx, vz) * 180) / Math.PI;

    if (t.expectedVxSign === 0) {
      assert(Math.abs(vx) < 0.05, `${t.name}: Vx should be ~0, got ${vx}`);
    } else if (t.expectedVxSign > 0) {
      assert(vx > 0.15, `${t.name}: Vx should be positive, got ${vx}`);
    } else {
      assert(vx < -0.15, `${t.name}: Vx should be negative, got ${vx}`);
    }

    // Verify projected landing spot is strictly inside the table boundaries [-0.70, +0.70]
    const zLand = 0.75;
    const flightTime = (zLand - physics.ballBody.position.z) / vz;
    const landingX = physics.ballBody.position.x + vx * flightTime;
    assert(Math.abs(landingX) <= 0.70, `Landing X must be within table boundary 0.70m, got ${landingX.toFixed(3)}m`);

    console.log(`✓ ${t.name.padEnd(25)} -> Launch Angle: ${angleDeg.toFixed(1)}°, Vx: ${vx.toFixed(2)} m/s, Lands at X: ${landingX.toFixed(3)} m`);
  }
}

// =========================================================================
// TEST 3: Smash Straight Line & In-Bounds Trajectory
// =========================================================================
console.log('\n--- Test 3: Smash Trajectory is Straight & Contained ---');
{
  const { physics } = createTestPhysics();
  physics.isInRally = true;
  physics.ballBody.position.set(0.2, 0.95, -1.0);
  physics.ballBody.velocity.set(0.4, 0.0, -2.0);

  physics.smashBall(1);

  assert.strictEqual(physics.ballBody.angularVelocity.y, 0, 'Smash should have zero sidespin curve');
  assert(Math.abs(physics.ballBody.velocity.z) > 4.0, `Smash should drive aggressively forward, got vz=${physics.ballBody.velocity.z}`);
  assert(Math.abs(physics.ballBody.velocity.x) <= 0.5, `Smash horizontal velocity clamped, got vx=${physics.ballBody.velocity.x}`);
  console.log(`✓ Smash: Velocity = (${physics.ballBody.velocity.x.toFixed(2)}, ${physics.ballBody.velocity.y.toFixed(2)}, ${physics.ballBody.velocity.z.toFixed(2)}), AngularVel = (0, 0, 0)`);
}

console.log('\n=== ALL STRAIGHT LINE & ANGLE TESTS PASSED PERFECTLY! ===');
