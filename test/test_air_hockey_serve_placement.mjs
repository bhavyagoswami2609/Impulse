import assert from 'assert';
import * as THREE from 'three';

// Provide browser globals for Node test
const createMockParam = () => ({
  setValueAtTime: () => {},
  linearRampToValueAtTime: () => {},
  exponentialRampToValueAtTime: () => {},
});

globalThis.window = {
  AudioContext: class {
    createGain() { return { gain: createMockParam(), connect: () => {} }; }
    createOscillator() { return { type: '', frequency: createMockParam(), connect: () => {}, start: () => {}, stop: () => {} }; }
    createBiquadFilter() { return { type: '', frequency: createMockParam(), Q: createMockParam(), connect: () => {} }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
    get state() { return 'running'; }
    resume() {}
  }
};

import { AirHockeyPhysics, STRIKER_RADIUS, PUCK_RADIUS } from '../src/physics/air_hockey_physics.js';
import { AirHockeyGame, AIR_HOCKEY_STATES } from '../src/game/air_hockey_game.js';
import { AIR_HOCKEY_TABLE_HEIGHT } from '../src/graphics/air_hockey_models.js';

console.log('=== VERIFICATION TEST: AIR HOCKEY SERVE PLACEMENT & ANTI-OWN-GOAL ===\n');

function createMockScene() {
  return {
    striker1: new THREE.Mesh(),
    striker2: new THREE.Mesh(),
    puck: new THREE.Mesh(),
    triggerImpact: () => {},
  };
}

// -----------------------------------------------------------------------------
// Test 1: P1 Serve: Puck starts in front of P1's striker with clear gap
// -----------------------------------------------------------------------------
console.log('--- Test 1: P1 Serve Placement (In Front of Striker with Gap) ---');
{
  const physics = new AirHockeyPhysics();
  const scene = createMockScene();
  const multiplayer = { role: 'host', isConnected: false };
  let toasts = [];

  const game = new AirHockeyGame({
    scene,
    physics,
    multiplayer,
    onActionToast: (t) => toasts.push(t),
  });

  game.restartMatch();

  const strikerZ = game.p1Pos.z;
  const puckState = physics.getPuckState();
  const puckZ = puckState.position.z;
  const puckX = puckState.position.x;
  const centerDist = puckZ - strikerZ; // Since +Z is towards opponent
  const edgeGap = centerDist - (STRIKER_RADIUS + PUCK_RADIUS);

  console.log(`  P1 Striker Pos: Z = ${strikerZ.toFixed(3)} m`);
  console.log(`  Puck Pos: (X = ${puckX.toFixed(3)}, Z = ${puckZ.toFixed(3)}) m`);
  console.log(`  Center-to-Center Distance: ${(centerDist * 100).toFixed(1)} cm`);
  console.log(`  Edge-to-Edge Clearance Gap: ${(edgeGap * 100).toFixed(1)} cm`);

  assert(puckZ > strikerZ, `Puck must be strictly IN FRONT of P1 striker (+Z direction), got puckZ=${puckZ} vs strikerZ=${strikerZ}`);
  assert(edgeGap >= 0.08, `Edge-to-edge gap must be at least 8cm, got ${(edgeGap * 100).toFixed(1)}cm`);
  assert(puckZ < 0, `Puck must be in P1 half of the table (Z < 0), got Z=${puckZ}`);
  assert.strictEqual(puckState.velocity.x, 0, 'Puck must be stationary before serve');
  assert.strictEqual(puckState.velocity.z, 0, 'Puck must be stationary before serve');
  assert.strictEqual(game.state, AIR_HOCKEY_STATES.SERVE_WAIT, 'Game must be in SERVE_WAIT');

  console.log('✓ PASS: Puck starts in front of P1 striker with a comfortable ~11cm gap and 0 initial velocity!\n');
}

// -----------------------------------------------------------------------------
// Test 2: Backward Hand Motion / Windup Does NOT Push Puck Into Own Goal
// -----------------------------------------------------------------------------
console.log('--- Test 2: Striker Moving Backwards Does NOT Touch Puck or Score Own Goal ---');
{
  const physics = new AirHockeyPhysics();
  const scene = createMockScene();
  const multiplayer = { role: 'host', isConnected: false };
  let scores = [0, 0];

  const game = new AirHockeyGame({
    scene,
    physics,
    multiplayer,
    onScoreUpdate: (sc) => { scores = sc; },
  });

  game.restartMatch();

  // Player pulls hand backwards towards their own goal (-Z) to prepare for hit
  for (let step = 0; step < 30; step++) {
    const handZ = -0.65 - (step * 0.01); // retreats from -0.65 to -0.95m
    game.update(1 / 60, { position: { x: 0, z: handZ }, velocity: { x: 0, z: -0.6 } });
  }

  const puckState = physics.getPuckState();
  console.log(`  After backward windup: Puck Pos: Z = ${puckState.position.z.toFixed(3)} m, Vel: (${puckState.velocity.x.toFixed(2)}, ${puckState.velocity.z.toFixed(2)}) m/s`);
  console.log(`  Score: P1 = ${scores[0]}, CPU = ${scores[1]}`);

  assert.strictEqual(scores[1], 0, 'CPU must NOT score an own goal when player pulls hand back');
  assert.strictEqual(puckState.velocity.z, 0, 'Puck must remain untouched and stationary');
  assert.strictEqual(game.state, AIR_HOCKEY_STATES.SERVE_WAIT, 'Game remains in SERVE_WAIT waiting for forward strike');

  console.log('✓ PASS: Backward hand movements do not disturb puck or trigger own goal!\n');
}

// -----------------------------------------------------------------------------
// Test 3: Forward Hand Thrust Cleanly Strikes Puck Into Opponent Half
// -----------------------------------------------------------------------------
console.log('--- Test 3: Forward Hand Strike Successfully Launches Puck Into Opponent Half ---');
{
  const physics = new AirHockeyPhysics();
  const scene = createMockScene();
  const multiplayer = { role: 'host', isConnected: false };
  let toasts = [];

  const game = new AirHockeyGame({
    scene,
    physics,
    multiplayer,
    onActionToast: (t) => toasts.push(t),
  });

  game.restartMatch();

  // Player thrusts hand forward towards opponent (+Z)
  let struck = false;
  for (let step = 0; step < 40; step++) {
    const handZ = -0.65 + (step * 0.015); // advances from -0.65 forward
    game.update(1 / 60, { position: { x: 0, z: handZ }, velocity: { x: 0, z: 2.5 } });

    if (game.state === AIR_HOCKEY_STATES.ACTIVE_PLAY) {
      struck = true;
      break;
    }
  }

  const puckState = physics.getPuckState();
  console.log(`  After forward strike: State = ${game.state}, Puck Vz = ${puckState.velocity.z.toFixed(2)} m/s, Pos Z = ${puckState.position.z.toFixed(3)} m`);

  assert(struck, 'Game must transition to ACTIVE_PLAY upon striking puck');
  assert(puckState.velocity.z > 0.8, `Puck must fly forward with solid velocity (+Z), got Vz=${puckState.velocity.z.toFixed(2)} m/s`);

  // Simulate flight until crossing midline
  let crossedMidline = false;
  for (let step = 0; step < 60; step++) {
    game.update(1 / 60, { position: { x: 0, z: -0.30 }, velocity: { x: 0, z: 0 } });
    if (physics.getPuckState().position.z > 0) {
      crossedMidline = true;
      break;
    }
  }

  assert(crossedMidline, 'Puck must cross midline (Z = 0) into opponent territory');
  console.log('✓ PASS: Forward strike launches puck across midline into active play!\n');
}

// -----------------------------------------------------------------------------
// Test 4: CPU / P2 Serve Placement & AI Strike
// -----------------------------------------------------------------------------
console.log('--- Test 4: CPU (P2) Serve Placement & Automatic Strike Execution ---');
{
  const physics = new AirHockeyPhysics();
  const scene = createMockScene();
  const multiplayer = { role: 'host', isConnected: false };

  const game = new AirHockeyGame({
    scene,
    physics,
    multiplayer,
  });

  // Reset serve for CPU (player 2)
  game.resetPuckForServe(2);

  const strikerZ = game.p2Pos.z;
  const puckState = physics.getPuckState();
  const puckZ = puckState.position.z;
  const centerDist = strikerZ - puckZ; // Since -Z is towards opponent
  const edgeGap = centerDist - (STRIKER_RADIUS + PUCK_RADIUS);

  console.log(`  P2 Striker Pos: Z = ${strikerZ.toFixed(3)} m`);
  console.log(`  Puck Pos: Z = ${puckZ.toFixed(3)} m`);
  console.log(`  Center-to-Center Distance: ${(centerDist * 100).toFixed(1)} cm`);
  console.log(`  Edge-to-Edge Clearance Gap: ${(edgeGap * 100).toFixed(1)} cm`);

  assert(puckZ < strikerZ, `Puck must be strictly IN FRONT of CPU striker (-Z direction), got puckZ=${puckZ} vs strikerZ=${strikerZ}`);
  assert(edgeGap >= 0.08, `Edge-to-edge gap must be at least 8cm, got ${(edgeGap * 100).toFixed(1)}cm`);
  assert(puckZ > 0, `Puck must be in CPU half of the table (Z > 0), got Z=${puckZ}`);

  // Simulate CPU stepping through serve timer and driving forward to strike
  let cpuStruck = false;
  for (let step = 0; step < 120; step++) {
    game.update(1 / 60, { position: { x: 0, z: -0.65 }, velocity: { x: 0, z: 0 } });
    if (game.state === AIR_HOCKEY_STATES.ACTIVE_PLAY) {
      cpuStruck = true;
      break;
    }
  }

  const postServePuck = physics.getPuckState();
  console.log(`  CPU Serve Result: State = ${game.state}, Puck Vz = ${postServePuck.velocity.z.toFixed(2)} m/s`);
  assert(cpuStruck, 'CPU must strike the puck forward into play');
  assert(postServePuck.velocity.z < -1.0, `CPU serve must launch puck towards P1 (-Z), got Vz=${postServePuck.velocity.z.toFixed(2)} m/s`);

  console.log('✓ PASS: CPU serve placement and physical strike execute flawlessly!\n');
}

// -----------------------------------------------------------------------------
// Test 5: Anti-Own-Goal Dead Serve Rule Compliance
// -----------------------------------------------------------------------------
console.log('--- Test 5: Dead Serve Protection During SERVE_WAIT ---');
{
  const physics = new AirHockeyPhysics();
  const scene = createMockScene();
  const multiplayer = { role: 'host', isConnected: false };
  let scores = [0, 0];

  const game = new AirHockeyGame({
    scene,
    physics,
    multiplayer,
    onScoreUpdate: (sc) => { scores = sc; },
  });

  game.restartMatch();
  assert.strictEqual(game.state, AIR_HOCKEY_STATES.SERVE_WAIT);

  // Directly simulate a dead ball entering goal cavity during SERVE_WAIT
  game.handleGoal(2); // CPU would have been awarded goal

  console.log(`  After dead ball in goal: Scores = [${scores[0]}, ${scores[1]}], State = ${game.state}`);
  assert.strictEqual(scores[0], 0, 'No point should be awarded');
  assert.strictEqual(scores[1], 0, 'CPU should NOT be awarded a point for dead ball during SERVE_WAIT');
  assert.strictEqual(game.state, AIR_HOCKEY_STATES.SERVE_WAIT, 'Game resets to SERVE_WAIT for re-serve');

  console.log('✓ PASS: Dead ball entering goal during SERVE_WAIT triggers re-serve without altering scores!\n');
}

console.log('=== ALL AIR HOCKEY SERVE PLACEMENT & ANTI-OWN-GOAL TESTS PASSED! ===');
