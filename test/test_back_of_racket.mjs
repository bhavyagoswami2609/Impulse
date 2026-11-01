import assert from 'node:assert';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/physics_world.js';
import { TableTennisGame, GAME_STATES } from '../src/game/table_tennis_game.js';
import { TABLE_WIDTH, TABLE_LENGTH, TABLE_HEIGHT } from '../src/graphics/procedural_models.js';

console.log('=== VERIFICATION TEST: PREVENT BACK OF RACKET HITS & SERVE RETREAT ===\n');

// Mock browser AudioContext
globalThis.window = {
  AudioContext: class {
    createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
  }
};

// =========================================================================
// TEST 1: Retreating from in front of the ball in SERVE_WAIT does NOT hit ball
// =========================================================================
console.log('--- Test 1: Moving Backward Past Ball in SERVE_WAIT Never Hits Ball ---');
{
  const scene = {
    paddle1: { position: new THREE.Vector3(0, 0.95, -0.75), quaternion: new THREE.Quaternion() },
    paddle2: { position: new THREE.Vector3(0, 0.95, 1.25), quaternion: new THREE.Quaternion() },
    ball: { position: new THREE.Vector3(0, TABLE_HEIGHT + 0.22, -1.05), quaternion: new THREE.Quaternion() },
    triggerImpact: () => {},
  };

  const physics = new PhysicsWorld();
  const multiplayer = { role: 'host', isConnected: false };

  let serveFired = false;
  const game = new TableTennisGame({
    scene,
    physics,
    multiplayer,
    onStateChange: () => {},
    onScoreUpdate: () => {},
    onActionToast: (t) => {
      if (t.includes('SERVE:')) serveFired = true;
    },
  });

  game.state = GAME_STATES.SERVE_WAIT;
  game.server = 1;
  physics.holdBallForServe(1, scene.paddle1.position);

  // Player starts forward at z = -0.75 (in front of ball at z = -1.05)
  // Simulate moving backward from z = -0.75 past -1.05 down to -1.30 over 20 frames
  for (let step = 0; step < 20; step++) {
    const currZ = -0.75 - (step / 20) * 0.55; // from -0.75 down to -1.30
    scene.paddle1.position.z = currZ;

    const transform = {
      position: scene.paddle1.position,
      quaternion: scene.paddle1.quaternion,
      velocity: new THREE.Vector3(0, 0, -1.2), // moving backward away from table
      yaw: 0,
      isHandOpen: false,
      justOpenedHand: false,
    };

    game.update(0.016, transform);

    // Ball must remain stationary waiting to serve
    assert.strictEqual(game.state, GAME_STATES.SERVE_WAIT, `State must stay SERVE_WAIT at z=${currZ.toFixed(2)}`);
    assert.strictEqual(physics.ballBody.velocity.z, 0, `Ball vz must stay 0, got ${physics.ballBody.velocity.z}`);
    assert.strictEqual(serveFired, false, `Serve must NOT trigger while moving backward past ball!`);
  }

  console.log('✓ PASS: Retreating past the ball from in front did NOT trigger hit or accidental serve!');
}

// =========================================================================
// TEST 2: Swinging Forward from BEHIND Ball Executes Serve Cleanly
// =========================================================================
console.log('\n--- Test 2: Forward Swing from Behind Ball Executes Serve ---');
{
  const scene = {
    paddle1: { position: new THREE.Vector3(0, 0.95, -1.25), quaternion: new THREE.Quaternion() },
    paddle2: { position: new THREE.Vector3(0, 0.95, 1.25), quaternion: new THREE.Quaternion() },
    ball: { position: new THREE.Vector3(0, TABLE_HEIGHT + 0.22, -1.05), quaternion: new THREE.Quaternion() },
    triggerImpact: () => {},
  };

  const physics = new PhysicsWorld();
  const multiplayer = { role: 'host', isConnected: false };

  let serveFired = false;
  const game = new TableTennisGame({
    scene,
    physics,
    multiplayer,
    onStateChange: () => {},
    onScoreUpdate: () => {},
    onActionToast: (t) => {
      if (t.includes('SERVE:')) serveFired = true;
    },
  });

  game.state = GAME_STATES.SERVE_WAIT;
  game.server = 1;
  physics.holdBallForServe(1, scene.paddle1.position);

  // Paddle starts behind ball at z = -1.20, swinging forward (+Z) at 1.5 m/s
  scene.paddle1.position.set(0, TABLE_HEIGHT + 0.22, -1.18);
  const forwardTransform = {
    position: scene.paddle1.position,
    quaternion: scene.paddle1.quaternion,
    velocity: new THREE.Vector3(0, 0, 1.6),
    yaw: 0,
    isHandOpen: false,
    justOpenedHand: false,
  };

  // Step into ball
  game.update(0.016, forwardTransform);

  assert.strictEqual(game.state, GAME_STATES.RALLY, 'State must transition to RALLY on forward strike serve');
  assert.strictEqual(serveFired, true, 'Serve action must be executed');
  assert(physics.ballBody.velocity.z > 2.0, `Ball must launch forward (+Z), got vz=${physics.ballBody.velocity.z}`);
  console.log(`✓ PASS: Forward swing from behind ball executed clean serve (vz = ${physics.ballBody.velocity.z.toFixed(2)} m/s)!`);
}

// =========================================================================
// TEST 3: Back of Racket Contact During Rally is Completely Blocked
// =========================================================================
console.log('\n--- Test 3: Back of Racket Hit During Rally is Blocked ---');
{
  let hitCount = 0;
  const physics = new PhysicsWorld({
    onBallHitPaddle: () => { hitCount++; },
    onBallBounceTable: () => {},
  });
  physics.lastPaddleHitTime = -1000;
  physics.isInRally = true;

  // 1. Ball at z = -1.25, Player 1 paddle in front at z = -1.15 (ball is BEHIND paddle)
  physics.ballBody.position.set(0.0, 0.88, -1.25);
  physics.ballBody.velocity.set(0.0, 0.0, -2.5); // ball approaching

  const p1PosFront = new THREE.Vector3(0.0, 0.80, -1.15); // p1Pos.z > bPos.z -> back of racket!
  const p1VelRetreat = new THREE.Vector3(0.0, 0.0, -0.8); // pulling backward

  physics.step(0.016, p1PosFront, p1VelRetreat, 0, new THREE.Vector3(0, 0.8, 1.5), new THREE.Vector3(), 0, 0);

  assert.strictEqual(hitCount, 0, 'Back of racket must NOT hit the ball when paddle is in front of ball');
  assert(physics.ballBody.velocity.z < -2.4, 'Ball velocity must NOT be altered by back of racket (continues approaching)');
  console.log('✓ PASS: Contact when paddle is in front of ball (dz < -0.02) was cleanly rejected!');

  // 2. Now test valid FRONT of racket contact: ball at z = -1.10, paddle behind at z = -1.15
  physics.ballBody.position.set(0.0, 0.88, -1.10); // ball in front of paddle (+Z)
  physics.ballBody.velocity.set(0.0, 0.0, -2.5);
  const p1PosBehind = new THREE.Vector3(0.0, 0.80, -1.15);
  const p1VelForward = new THREE.Vector3(0.0, 0.0, 1.2); // forward swing

  physics.step(0.016, p1PosBehind, p1VelForward, 0, new THREE.Vector3(0, 0.8, 1.5), new THREE.Vector3(), 0, 0);

  assert.strictEqual(hitCount, 1, 'Valid front-face hit must trigger paddle hit callback');
  assert(physics.ballBody.velocity.z > 2.5, `Ball must be returned forward, got vz=${physics.ballBody.velocity.z}`);
  console.log(`✓ PASS: Valid front-face hit executed cleanly (vz = ${physics.ballBody.velocity.z.toFixed(2)} m/s)!`);
}

console.log('\n=== ALL BACK OF RACKET & SERVE TESTS PASSED PERFECTLY! ===');
