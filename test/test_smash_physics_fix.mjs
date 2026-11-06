import assert from 'assert';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/physics_world.js';
import { TABLE_HEIGHT, NET_HEIGHT, TABLE_WIDTH, TABLE_LENGTH } from '../src/graphics/procedural_models.js';

console.log('=== VERIFICATION TEST: SMASH PHYSICS & NET CLEARANCE ===\n');

const testCases = [
  { name: 'Deep Center (z=-1.45m, y=0.88m - below net)', x: 0, y: 0.88, z: -1.45 },
  { name: 'Standard Baseline (z=-1.35m, y=0.92m)', x: 0.1, y: 0.92, z: -1.35 },
  { name: 'High Loop Ball (z=-1.20m, y=1.04m)', x: -0.15, y: 1.04, z: -1.20 },
  { name: 'Wide Left Smash (x=-0.55m, z=-1.40m, y=0.86m)', x: -0.55, y: 0.86, z: -1.40 },
  { name: 'Wide Right Smash (x=0.55m, z=-1.40m, y=0.90m)', x: 0.55, y: 0.90, z: -1.40 },
];

const netTopY = TABLE_HEIGHT + NET_HEIGHT; // 0.9125m

testCases.forEach((tc, idx) => {
  console.log(`--- Test ${idx + 1}: ${tc.name} ---`);
  let netHits = 0;
  let tableBounces = [];

  const physics = new PhysicsWorld({
    onBallBounceTable: (pos, side) => {
      tableBounces.push({ pos: pos.clone(), side });
    },
    onBallHitNet: () => {
      netHits++;
    },
    onBallHitPaddle: () => {},
    onBallHitFloor: () => {},
  });

  physics.isInRally = true;
  physics.ballBody.position.set(tc.x, tc.y, tc.z);
  physics.ballBody.velocity.set(0, 0, -2.5);

  // Trigger Smash by Player 1
  physics.smashBall(1);

  const initialVel = physics.ballBody.velocity.clone();
  console.log(`  Initial Smash Velocity: (${initialVel.x.toFixed(2)}, ${initialVel.y.toFixed(2)}, ${initialVel.z.toFixed(2)}) m/s`);

  let crossedNet = false;
  let netCrossingY = 0;
  const p1Pos = new THREE.Vector3(0, 0.95, -1.45);
  const p1Vel = new THREE.Vector3(0, 0, 0);
  const p2Pos = new THREE.Vector3(0, 0.95, 1.45);
  const p2Vel = new THREE.Vector3(0, 0, 0);

  // Simulate trajectory step-by-step
  for (let s = 0; s < 120; s++) {
    const prevZ = physics.ballBody.position.z;
    physics.step(1 / 60, p1Pos, p1Vel, 0, p2Pos, p2Vel, 0, 0);
    const currZ = physics.ballBody.position.z;

    if (!crossedNet && prevZ <= 0 && currZ >= 0) {
      crossedNet = true;
      netCrossingY = physics.ballBody.position.y;
    }

    if (tableBounces.length > 0) break;
  }

  console.log(`  Net Crossing Height: ${netCrossingY.toFixed(3)} m (Net Top: ${netTopY.toFixed(3)} m) -> Margin: +${((netCrossingY - netTopY) * 100).toFixed(1)} cm`);
  assert(crossedNet, 'Ball must cross the net into the opponent half');
  assert(netCrossingY > netTopY + 0.035, `Ball must clear net tape with margin, got height ${netCrossingY.toFixed(3)}m vs net ${netTopY}m`);
  assert.strictEqual(netHits, 0, `Ball must NEVER hit the net on a smash! Observed ${netHits} net hits`);

  assert(tableBounces.length > 0, 'Smash must land on opponent table');
  const land = tableBounces[0];
  assert.strictEqual(land.side, 2, 'Smash must land on opponent side (side 2)');
  assert(land.pos.z > 0 && land.pos.z < TABLE_LENGTH / 2, `Smash must land inside opponent half [0, 1.37], got Z=${land.pos.z.toFixed(2)}m`);
  assert(Math.abs(land.pos.x) < TABLE_WIDTH / 2, `Smash must land inside table width [-0.76, 0.76], got X=${land.pos.x.toFixed(2)}m`);

  console.log(`  ✓ Landed in opponent court at (${land.pos.x.toFixed(2)}, ${land.pos.z.toFixed(2)}) m with 0 net hits!\n`);
});

console.log('=== ALL SMASH PHYSICS & NET CLEARANCE TESTS PASSED PERFECTLY! ===');
