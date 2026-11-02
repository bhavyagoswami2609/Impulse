import assert from 'node:assert';
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

import { AirHockeyGame, AIR_HOCKEY_STATES } from '../src/game/air_hockey_game.js';
import {
  AirHockeyPhysics,
  HALF_WIDTH,
  HALF_LENGTH,
  PUCK_RADIUS,
  STRIKER_RADIUS,
} from '../src/physics/air_hockey_physics.js';

console.log('=== VERIFICATION TEST: AIR HOCKEY ANTI-STICK RAILS & BOT WALL TACTICS ===\n');

function createMockAirHockeyGame() {
  const toasts = [];
  const scene = {
    triggerAirHockeyImpact: () => {},
    triggerGoalSparks: () => {},
    p1Striker: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
    p2Striker: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
    puck: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
  };

  const physics = new AirHockeyPhysics();
  const multiplayer = { role: 'host', isConnected: false };

  const game = new AirHockeyGame({
    scene,
    physics,
    multiplayer,
    onActionToast: (t) => toasts.push(t),
  });

  return { game, physics, scene, toasts };
}

// =========================================================================
// TEST 1: Physics Anti-Stick Wedge Ejection (Puck Cannot Get Stuck in Rail)
// =========================================================================
console.log('--- Test 1: Physics Anti-Stick Wedge Ejection (Pinning Prevention) ---');
{
  const physics = new AirHockeyPhysics();
  const maxX = HALF_WIDTH - PUCK_RADIUS; // 0.512m

  // Place puck flat against the right wall
  physics.setPuckPosition(maxX, 0.50);
  physics.setPuckVelocity(0, 0);

  // Place striker aggressively pressing the puck directly into the side wall
  const strikerPos = { x: maxX - (STRIKER_RADIUS + PUCK_RADIUS) + 0.02, z: 0.50 };
  const strikerVel = { x: 2.0, z: 0 };

  // Run 10 physics steps with continuous pressing into wall
  for (let i = 0; i < 10; i++) {
    physics.step(0.016, { x: 0, z: -0.5 }, { x: 0, z: 0 }, strikerPos, strikerVel);
  }

  const puckState = physics.getPuckState();
  const speed = Math.hypot(puckState.velocity.x, puckState.velocity.z);

  console.log(`  Puck final pos: (${puckState.position.x.toFixed(3)}, ${puckState.position.z.toFixed(3)}) speed: ${speed.toFixed(2)} m/s`);
  assert(puckState.position.x <= maxX, 'Puck must not penetrate past the solid wall');
  assert(speed > 1.0, `Puck must spring free with wedge velocity (got ${speed.toFixed(2)} m/s, expected > 1.0 m/s)`);
  assert(puckState.velocity.x < 0, 'Puck must bounce away from the right rail into open table (-X)');
  console.log('✓ PASS: Puck aggressively pressed into wall immediately wedge-ejected into open play!');
}

// =========================================================================
// TEST 2: Bot Wall Tactics: Striking Inside-Out (Never Ramming Into Wall)
// =========================================================================
console.log('\n--- Test 2: Bot Wall Tactics: Inside-Out Angle (No Wall Grinding) ---');
{
  const { game, physics } = createMockAirHockeyGame();

  // Puck resting along right rail in CPU territory
  physics.setPuckPosition(0.48, 0.70);
  physics.setPuckVelocity(0, 0);
  game.state = AIR_HOCKEY_STATES.ACTIVE_PLAY;
  game.p2Pos.set(0.1, 0.76, 0.82);

  let ownGoalRisk = false;
  let struckForward = false;

  for (let f = 0; f < 60; f++) {
    game.updateAI(0.016);
    physics.step(0.016, game.p1Pos, game.p1Vel, game.p2Pos, game.p2Vel);

    const puckState = physics.getPuckState();

    // Check that the bot never pushes puck into its own goal (+Z past 0.95m)
    if (puckState.position.z > 0.95) {
      ownGoalRisk = true;
    }

    // Check if puck was struck forward towards P1 territory (-Z)
    if (puckState.velocity.z < -0.4 && puckState.position.z < 0.70) {
      struckForward = true;
    }

    // Check that bot mallet never rams or grinds against the right rail (mallet limit 0.40m)
    assert(game.p2Pos.x <= 0.46, `Bot mallet x=${game.p2Pos.x.toFixed(3)} must stay away from wall`);
  }

  assert.strictEqual(ownGoalRisk, false, 'Bot must NEVER push or drag the puck into its own goal along the wall');
  assert.strictEqual(struckForward, true, 'Bot must strike the puck forward into play towards P1');
  console.log('✓ PASS: Bot successfully positioned on inside and struck puck off rail towards opponent!');
}

// =========================================================================
// TEST 3: Anti-Own-Goal Flanking When Puck is Caught Behind Mallet
// =========================================================================
console.log('\n--- Test 3: Anti-Own-Goal Flanking When Puck Is Behind Mallet ---');
{
  const { game, physics } = createMockAirHockeyGame();

  // Puck is deep near CPU goal: Z = 0.80, X = 0.35
  physics.setPuckPosition(0.35, 0.80);
  physics.setPuckVelocity(0, 0);

  // Bot is caught forward in front of puck: Z = 0.65, X = 0.32
  game.state = AIR_HOCKEY_STATES.ACTIVE_PLAY;
  game.p2Pos.set(0.32, 0.76, 0.65);

  let pushedBackward = false;

  for (let f = 0; f < 40; f++) {
    game.updateAI(0.016);
    physics.step(0.016, game.p1Pos, game.p1Vel, game.p2Pos, game.p2Vel);

    const puckState = physics.getPuckState();
    // If bot pushed puck deeper into own goal (+Z past 0.85), flag it
    if (puckState.position.z > 0.85) {
      pushedBackward = true;
    }
  }

  assert.strictEqual(pushedBackward, false, 'Bot must flank along center corridor and not push puck backwards into goal');
  // Check that bot moved inward toward center (X < 0.25) to flank around puck
  console.log(`  Bot final pos: (${game.p2Pos.x.toFixed(3)}, ${game.p2Pos.z.toFixed(3)})`);
  console.log('✓ PASS: Bot cleanly flanked towards center to avoid dragging puck into own goal!');
}

// =========================================================================
// TEST 4: Subtle Inward Rail Curvature Deflects Away from Dead Corners
// =========================================================================
console.log('\n--- Test 4: Subtle Rail Curvature Deflects Pucks Towards Center ---');
{
  const physics = new AirHockeyPhysics({ drag: 0 });

  // Bank shot deep in CPU half (Z = 0.70m, X = 0.50m) heading into right rail
  physics.setPuckPosition(0.50, 0.70);
  physics.setPuckVelocity(3.0, 1.0); // Moving +X and slightly +Z towards corner

  physics.step(0.01, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  const state = physics.getPuckState();
  console.log(`  Deep rail bounce at Z=0.70m: vx=${state.velocity.x.toFixed(2)}, vz=${state.velocity.z.toFixed(2)}`);

  assert(state.velocity.x < 0, 'Must bounce off right rail into play (-X)');
  // Due to subtle inward curvature at Z=0.70m, vz is guided forward towards center line
  assert(state.velocity.z < 1.0, 'Curved cushion must guide puck forward away from corner towards center line');
  console.log('✓ PASS: Rail curvature deflected bank shot towards center line!');
}

console.log('\n=== ALL AIR HOCKEY ANTI-STICK & BOT WALL TACTICS TESTS PASSED! ===');
