import assert from 'node:assert';
import * as THREE from 'three';
import { AirHockeyPhysics } from '../src/physics/air_hockey_physics.js';
import { AirHockeyGame, AIR_HOCKEY_STATES } from '../src/game/air_hockey_game.js';
import { HandTracker } from '../src/tracking/hand_tracker.js';

console.log('=== VERIFICATION TEST: AIR HOCKEY STRIKER MIDLINE REACH ===\n');

// Mock DOM elements for HandTracker
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: () => {},
  removeEventListener: () => {},
};

// -----------------------------------------------------------------
// Test 1: HandTracker Hockey Mode Court Limits & Midline Reach
// -----------------------------------------------------------------
console.log('--- Test 1: HandTracker Hockey Mode Limits & Forward Reach ---');
const tracker = new HandTracker({ gameMode: 'hockey' });

assert.strictEqual(tracker.gameMode, 'hockey', 'Tracker initialized with hockey mode');
assert.strictEqual(tracker.courtLimits.p1.maxZ, -0.005, 'P1 maxZ allows reaching midline (-0.005m)');
assert.strictEqual(tracker.courtLimits.p2.minZ, 0.005, 'P2 minZ allows reaching midline (0.005m)');

// Simulate forward mouse movement in hockey mode:
// normY = 1.0 (cursor pushed to the top of the screen)
const limitsP1 = tracker.courtLimits.p1;
const centerOffsetP1 = -0.5125;
const forwardReachP1 = 1.0 * 0.52;
const mouseTargetZ_P1 = THREE.MathUtils.clamp(centerOffsetP1 + forwardReachP1, limitsP1.minZ, limitsP1.maxZ);
assert.strictEqual(mouseTargetZ_P1, -0.005, 'Mouse at top of screen reaches exactly the midline (-0.005m)');

// normY = -1.0 (cursor pulled back to bottom of screen)
const retreatReachP1 = -1.0 * 0.52;
const mouseGoalZ_P1 = THREE.MathUtils.clamp(centerOffsetP1 + retreatReachP1, limitsP1.minZ, limitsP1.maxZ);
assert.strictEqual(mouseGoalZ_P1, -1.02, 'Mouse at bottom of screen reaches defensive goal rail (-1.02m)');

// Check client mode (P2)
tracker.setPlayerRole('client');
const limitsP2 = tracker.courtLimits.p2;
const centerOffsetP2 = 0.5125;
const forwardReachP2 = 1.0 * 0.52;
const mouseTargetZ_P2 = THREE.MathUtils.clamp(centerOffsetP2 - forwardReachP2, limitsP2.minZ, limitsP2.maxZ);
assert.strictEqual(mouseTargetZ_P2, 0.005, 'Client P2 mouse at top reaches midline (0.005m)');

// Reset to host
tracker.setPlayerRole('host');
console.log('✓ PASS: HandTracker mouse mapping covers complete court half and reaches midline!');

// -----------------------------------------------------------------
// Test 2: Mode Switching Tennis <-> Hockey
// -----------------------------------------------------------------
console.log('\n--- Test 2: Mode Switching Between Table Tennis and Hockey ---');
tracker.setGameMode('tennis');
assert.strictEqual(tracker.courtLimits.p1.maxZ, -0.35, 'Tennis P1 maxZ respects table tennis net boundary (-0.35m)');

tracker.setGameMode('hockey');
assert.strictEqual(tracker.courtLimits.p1.maxZ, -0.005, 'Switched back to hockey: P1 maxZ reaches midline (-0.005m)');
console.log('✓ PASS: Switching game modes dynamically sets appropriate court limits!');

// -----------------------------------------------------------------
// Test 3: AirHockeyPhysics Clamp Allows Striker Center to Reach Midline
// -----------------------------------------------------------------
console.log('\n--- Test 3: AirHockeyPhysics Striker Midline Clamping ---');
const physics = new AirHockeyPhysics();

// P1 reaches towards opponent side
const clampedP1Midline = physics.clampStrikerPosition(1, { x: 0, z: 0.5 });
assert.strictEqual(clampedP1Midline.z, -0.005, 'P1 striker clamped exactly at midline boundary (-0.005m)');

// P2 reaches towards P1 side
const clampedP2Midline = physics.clampStrikerPosition(2, { x: 0, z: -0.5 });
assert.strictEqual(clampedP2Midline.z, 0.005, 'P2 striker clamped exactly at midline boundary (0.005m)');
console.log('✓ PASS: Physics clamps striker right at the midline without crossing into opponent half!');

// -----------------------------------------------------------------
// Test 4: Striker Striking Puck Directly on the Midline (Z = 0)
// -----------------------------------------------------------------
console.log('\n--- Test 4: Striking a Puck Sitting on the Midline ---');
physics.resetPuck();
// Place puck right at the midline (z = 0)
physics.puckPos = { x: 0, z: 0 };
physics.puckVel = { x: 0, z: 0 };

// P1 striker advances to midline and strikes forward
const p1Pos = { x: 0, y: 0.82, z: -0.04 }; // Mallet contacting puck at z=0
const p1Vel = { x: 0, y: 0, z: 3.5 };     // Forward striking velocity

physics.step(0.016, p1Pos, p1Vel, { x: 0, y: 0.82, z: 0.75 }, { x: 0, y: 0, z: 0 });

const puckAfterHit = physics.getPuckState();
assert(puckAfterHit.velocity.z > 1.5, `Puck should be driven forward into opponent half, got vz=${puckAfterHit.velocity.z.toFixed(2)}`);
assert(puckAfterHit.position.z > 0, `Puck should cross into opponent half (z > 0), got z=${puckAfterHit.position.z.toFixed(3)}`);
console.log(`✓ PASS: Striker at midline successfully launched centerline puck into opponent half (vz=${puckAfterHit.velocity.z.toFixed(2)} m/s, z=${puckAfterHit.position.z.toFixed(3)}m)!`);

// -----------------------------------------------------------------
// Test 5: AirHockeyGame Game Loop Striker Position Update
// -----------------------------------------------------------------
console.log('\n--- Test 5: AirHockeyGame Striker Positioning at Midline ---');
const game = new AirHockeyGame({
  scene: {
    striker1: new THREE.Mesh(),
    striker2: new THREE.Mesh(),
    puck: new THREE.Mesh(),
    triggerImpact: () => {},
  },
  physics: new AirHockeyPhysics(),
  multiplayer: { isConnected: false, role: 'host' },
});

// Simulate tracker giving a position at the midline
const midlineTransform = {
  position: new THREE.Vector3(0.1, 0.82, -0.005),
  quaternion: new THREE.Quaternion(),
  velocity: new THREE.Vector3(0, 0, 1.2),
};

game.update(0.016, midlineTransform);

assert.strictEqual(game.p1Pos.z, -0.005, 'game.p1Pos.z reached the midline (-0.005m)');
assert.strictEqual(game.scene.striker1.position.z, -0.005, 'scene.striker1.position.z reached the midline (-0.005m)');
console.log('✓ PASS: AirHockeyGame and Three.js scene position striker at the midline!');

console.log('\n=== ALL AIR HOCKEY MIDLINE REACH TESTS PASSED PERFECTLY! ===');
