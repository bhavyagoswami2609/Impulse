import assert from 'node:assert';
import * as THREE from 'three';
import { AirHockeyPhysics, CORNER_BOUNCER_SIZE } from '../src/physics/air_hockey_physics.js';
import { PhysicsWorld } from '../src/physics/physics_world.js';

console.log('=== RUNNING VERIFICATION TEST: CORNERS & SMASH TRAJECTORY ===\n');

// ==========================================
// TEST SUITE 1: AIR HOCKEY 45° CORNER BOUNCERS
// ==========================================
console.log('--- Test Suite 1: Air Hockey 45° Corner Deflection ---');
{
  const hits = [];
  const physics = new AirHockeyPhysics({
    onPuckHitWall: (pt, normal, speed) => {
      hits.push({ pt, normal, speed });
    },
  });

  const corners = [
    { name: 'North-East (+X, +Z)', qx: 1, qz: 1, targetX: 0.50, targetZ: 1.02, vx: 2.5, vz: 2.5 },
    { name: 'North-West (-X, +Z)', qx: -1, qz: 1, targetX: -0.50, targetZ: 1.02, vx: -2.5, vz: 2.5 },
    { name: 'South-East (+X, -Z)', qx: 1, qz: -1, targetX: 0.50, targetZ: -1.02, vx: 2.5, vz: -2.5 },
    { name: 'South-West (-X, -Z)', qx: -1, qz: -1, targetX: -0.50, targetZ: -1.02, vx: -2.5, vz: -2.5 },
  ];

  for (const c of corners) {
    physics.setPuckPosition(c.qx * 0.20, c.qz * 0.60);
    physics.setPuckVelocity(c.vx, c.vz);
    hits.length = 0;

    let redirected = false;
    for (let step = 0; step < 120; step++) {
      physics.step(1 / 60, { x: 0, z: -0.7 }, { x: 0, z: 0 }, { x: 0, z: 0.7 }, { x: 0, z: 0 });
      const state = physics.getPuckState();

      // Check if velocity reflected back toward center (opposite of incoming sign)
      if (c.qx * state.velocity.x < 0 && c.qz * state.velocity.z < 0) {
        redirected = true;
      }
    }

    assert(redirected, `Puck should be redirected from corner ${c.name}`);
    assert(hits.length > 0, `Puck should trigger wall collision in ${c.name}`);
    console.log(`✓ Corner ${c.name}: cleanly deflected puck into open table! Hit speed: ${hits[0]?.speed.toFixed(2)} m/s`);
  }

  // Test Striker Clamping against 45° Corner Bouncers
  console.log('\n--- Testing Striker 45° Corner Clamping ---');
  for (const c of corners) {
    const rawPos = { x: c.qx * 0.54, z: c.qz * 1.06 };
    const strikerId = c.qz < 0 ? 1 : 2;
    const clamped = physics.clampStrikerPosition(strikerId, rawPos);

    // Sum in that corner: qx * x + qz * z must be <= 1.3993
    const sum = c.qx * clamped.x + c.qz * clamped.z;
    assert(sum <= 1.3995, `Striker must not cross 45° corner bouncer (got ${sum})`);
    console.log(`✓ Striker clamped at corner ${c.name}: raw=(${rawPos.x.toFixed(2)}, ${rawPos.z.toFixed(2)}) -> clamped=(${clamped.x.toFixed(3)}, ${clamped.z.toFixed(3)}) sum=${sum.toFixed(3)} m`);
  }
}

// ==========================================
// TEST SUITE 2: TABLE TENNIS RALLIES & MEGA SMASHES
// ==========================================
console.log('\n--- Test Suite 2: Table Tennis Rally & Smash Trajectory ---');
{
  let fakeTime = 1000;
  globalThis.performance.now = () => fakeTime;

  const paddleHits = [];
  const bounces = [];
  let letCount = 0;

  const ttPhysics = new PhysicsWorld({
    onBallBounceTable: (pos, side) => {
      bounces.push({ pos: pos.clone(), side });
    },
    onBallHitPaddle: (player, speed) => {
      paddleHits.push({ player, speed });
    },
    onBallHitNet: () => {
      letCount++;
    },
    onBallHitFloor: () => {},
  });

  // Serve from P1
  ttPhysics.serveBall(1, { startX: 0, targetVx: 0, paceVz: 2.75, vy: -0.66 });

  let maxHeightObserved = 0;
  let totalPaddleHits = 0;
  let lastHitter = 1;
  const p1Pos = new THREE.Vector3(0, 0.95, -1.35);
  const p1Vel = new THREE.Vector3(0, 0, 1.2);
  const p2Pos = new THREE.Vector3(0, 0.95, 1.35);
  const p2Vel = new THREE.Vector3(0, 0, -1.2);

  for (let step = 0; step < 2400; step++) {
    fakeTime += 16.667;
    const dt = 1 / 60;
    const bPos = ttPhysics.ballBody.position;
    const bVel = ttPhysics.ballBody.velocity;

    if (bPos.y > maxHeightObserved) {
      maxHeightObserved = bPos.y;
    }

    // AI positioning (tracks ball X, Y, Z to intercept)
    if (bVel.z > 0 && bPos.z > 0.4) {
      p2Pos.x = bPos.x;
      p2Pos.y = THREE.MathUtils.clamp(bPos.y - 0.082, 0.76 + 0.05, 0.76 + 0.40);
      p2Pos.z = Math.min(1.42, bPos.z + 0.02);
      p2Vel.set(0, 0, -1.8);
    } else {
      p2Pos.set(0, 0.95 - 0.082, 1.40);
      p2Vel.set(0, 0, 0);
    }

    // P1 positioning (tracks ball X, Y, Z to intercept)
    if (bVel.z < 0 && bPos.z < -0.4) {
      p1Pos.x = bPos.x;
      p1Pos.y = THREE.MathUtils.clamp(bPos.y - 0.082, 0.76 + 0.05, 0.76 + 0.40);
      p1Pos.z = Math.max(-1.42, bPos.z - 0.02);
      p1Vel.set(0, 0, 1.8);
    } else {
      p1Pos.set(0, 0.95 - 0.082, -1.40);
      p1Vel.set(0, 0, 0);
    }

    ttPhysics.step(dt, p1Pos, p1Vel, 0, p2Pos, p2Vel, 0, 0);

    // Periodically trigger smash on paddle contact
    if (paddleHits.length > totalPaddleHits) {
      totalPaddleHits = paddleHits.length;
      const hit = paddleHits[paddleHits.length - 1];
      if (totalPaddleHits % 3 === 0) {
        ttPhysics.smashBall(hit.player);
        console.log(`[Rally ${totalPaddleHits}] MEGA SMASH by Player ${hit.player}! Ball vel: (${ttPhysics.ballBody.velocity.x.toFixed(2)}, ${ttPhysics.ballBody.velocity.y.toFixed(2)}, ${ttPhysics.ballBody.velocity.z.toFixed(2)}) pos.y: ${ttPhysics.ballBody.position.y.toFixed(3)} m`);
      }
    }
  }

  console.log(`\nRally Simulation Summary:`);
  console.log(`- Total paddle exchanges: ${totalPaddleHits}`);
  console.log(`- Total table bounces: ${bounces.length}`);
  console.log(`- Net collisions / faults: ${letCount}`);
  console.log(`- Max ball height observed: ${maxHeightObserved.toFixed(3)} m (Net: 0.9125 m, Ceiling Limit: 1.15 m)`);

  assert(totalPaddleHits >= 10, 'Should complete at least 10 rallies in 40s');
  assert(maxHeightObserved < 1.10, `Ball height must remain low (< 1.10m), observed ${maxHeightObserved}m`);
  assert(letCount === 0, `Ball should never hit the net on proper strokes, observed ${letCount} net hits`);
  console.log('✓ Table Tennis rally & smash height constraints PASSED with flying colors!');
}

console.log('\n=== ALL VERIFICATION TESTS PASSED! ===');
