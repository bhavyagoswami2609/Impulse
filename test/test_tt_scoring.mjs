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
    createBuffer() { return { getChannelData: () => new Float32Array(100) }; }
    createBufferSource() { return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
    get state() { return 'running'; }
    resume() {}
  }
};

import { TableTennisGame, GAME_STATES } from '../src/game/table_tennis_game.js';
import { TABLE_WIDTH, TABLE_LENGTH, TABLE_HEIGHT } from '../src/graphics/procedural_models.js';

console.log('=== RUNNING TABLE TENNIS POINT SCORING VERIFICATION ===\n');

function createMockGame() {
  const toasts = [];
  const scoreUpdates = [];
  let state = GAME_STATES.SERVE_WAIT;

  const scene = {
    triggerImpact: () => {},
    paddle1: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
    paddle2: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
    ball: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
  };

  const physics = {
    ballBody: {
      position: new THREE.Vector3(0, TABLE_HEIGHT + 0.1, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      angularVelocity: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
    },
    holdBallForServe: () => {},
    serveBall: () => {},
    smashBall: () => {},
    updatePaddle1: () => {},
    updatePaddle2: () => {},
    step: () => {},
    isServeFlight: false,
    callbacks: {},
  };

  const multiplayer = { role: 'host', isConnected: false };

  const game = new TableTennisGame({
    scene,
    physics,
    multiplayer,
    onStateChange: (s) => { state = s; },
    onScoreUpdate: (s) => { scoreUpdates.push([...s]); },
    onActionToast: (t) => { toasts.push(t); },
  });

  return { game, scene, physics, toasts, scoreUpdates, getState: () => state };
}

// =========================================================================
// TEST 1: Point is awarded ONLY when ball leaves table OR > 2 bounces on same side
// =========================================================================
console.log('--- Test 1: Bounces on Table: Play Continues up to 2, Point on > 2 ---');
{
  const { game, physics, toasts } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;
  game.lastHitter = 1;

  // Ball is on the table (y = TABLE_HEIGHT, within bounds)
  physics.ballBody.position.set(0.1, TABLE_HEIGHT, 0.5);

  // 1st bounce on P2 side: no point yet
  game.handleTableBounce({ x: 0.1, y: TABLE_HEIGHT, z: 0.5 }, 2);
  assert.strictEqual(game.scores[0], 0, 'P1 score must still be 0 after 1st bounce');
  assert.strictEqual(game.scores[1], 0, 'P2 score must still be 0 after 1st bounce');
  assert.strictEqual(game.bouncesP2, 1, 'bouncesP2 should be 1');

  // 2nd bounce on P2 side: no point yet
  game.handleTableBounce({ x: 0.1, y: TABLE_HEIGHT, z: 0.5 }, 2);
  assert.strictEqual(game.scores[0], 0, 'P1 score must still be 0 after 2nd bounce');
  assert.strictEqual(game.scores[1], 0, 'P2 score must still be 0 after 2nd bounce');
  assert.strictEqual(game.bouncesP2, 2, 'bouncesP2 should be 2');

  // 3rd bounce on P2 side (> 2 bounces on same side): P1 awarded point!
  game.handleTableBounce({ x: 0.1, y: TABLE_HEIGHT, z: 0.5 }, 2);
  assert.strictEqual(game.scores[0], 1, 'P1 score must be 1 after > 2 bounces on P2 side');
  assert.strictEqual(game.scores[1], 0, 'P2 score must be 0');
  console.log('✓ PASS: Exactly 1 or 2 bounces allow rally to continue; 3rd bounce awards point!');
}

// =========================================================================
// TEST 2: Ball Leaving Table After Bouncing on Opponent Court Awards Point to Hitter
// =========================================================================
console.log('\n--- Test 2: Ball Leaving Table Awards WINNER Point to Hitter ---');
{
  const { game, physics, toasts } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;
  game.lastHitter = 1;

  // Ball bounces on P2 side
  game.handleTableBounce({ x: 0.2, y: TABLE_HEIGHT, z: 0.8 }, 2);
  assert.strictEqual(game.bouncesP2, 1);
  assert.strictEqual(game.scores[0], 0, 'No points yet while on table');

  // Ball flies past edge of table and drops below table height
  physics.ballBody.position.set(0.2, TABLE_HEIGHT - 0.05, TABLE_LENGTH / 2 + 0.10);
  assert.strictEqual(game.isBallOffTable(physics.ballBody.position), true, 'Ball has left table bounds');

  game.handleBallLeftTable();
  assert.strictEqual(game.scores[0], 1, 'P1 should be awarded 1 point');
  assert.strictEqual(game.scores[1], 0, 'P2 score remains 0');
  assert.strictEqual(game.server, 1, 'Scorer P1 serves next');
  assert(toasts.some(t => t.includes('P1 WINNER')), 'Toast shows P1 WINNER');
  console.log('✓ PASS: Ball leaving table after opponent bounce awarded WINNER point to P1!');
}

// =========================================================================
// TEST 3: Ball Leaving Table Without Bouncing on Opponent Court Awards Point to Opponent ('OUT')
// =========================================================================
console.log('\n--- Test 3: Ball Leaving Table Without Opponent Bounce Awards OUT Point ---');
{
  const { game, physics, toasts } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;
  game.lastHitter = 1; // P1 hit ball out of bounds without landing on P2 side

  // Ball flies long and drops below table
  physics.ballBody.position.set(0, TABLE_HEIGHT - 0.05, TABLE_LENGTH / 2 + 0.25);
  assert.strictEqual(game.isBallOffTable(physics.ballBody.position), true);

  game.handleBallLeftTable();
  assert.strictEqual(game.scores[0], 0, 'P1 score remains 0');
  assert.strictEqual(game.scores[1], 1, 'P2 awarded point for P1 hitting OUT');
  assert.strictEqual(game.server, 2, 'Scorer P2 serves next');
  assert(toasts.some(t => t.includes('CPU OUT')), 'Toast shows CPU OUT');
  console.log('✓ PASS: Ball leaving table without landing on opponent court awarded OUT to opponent!');
}

// =========================================================================
// TEST 4: Successful Service then Ball Leaving Table
// =========================================================================
console.log('\n--- Test 4: Legal Service Followed by Ball Leaving Table ---');
{
  const { game, physics, toasts } = createMockGame();
  game.server = 1;
  game.serve();
  assert.strictEqual(game.isServiceInProgress, true);

  // Bounce on P1 side (server table)
  game.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.6 }, 1);
  assert.strictEqual(game.scores[0], 0);
  assert.strictEqual(game.isServiceInProgress, true);

  // Bounce on P2 side (receiver table)
  game.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: 0.6 }, 2);
  assert.strictEqual(game.scores[0], 0, 'Still no point awarded while on table');
  assert.strictEqual(game.isServiceInProgress, false, 'Service completed into rally');

  // Ball rolls or flies off table
  physics.ballBody.position.set(0, TABLE_HEIGHT - 0.05, TABLE_LENGTH / 2 + 0.15);
  game.handleBallLeftTable();
  assert.strictEqual(game.scores[0], 1, 'Server P1 awarded point because receiver missed');
  console.log('✓ PASS: Legal service into receiver table awarded point once ball left table!');
}

// =========================================================================
// TEST 5: Service Fault (Misses Receiver Court and Leaves Table)
// =========================================================================
console.log('\n--- Test 5: Service Fault (Misses Receiver Court) ---');
{
  const { game, physics, toasts } = createMockGame();
  game.server = 1;
  game.serve();

  // Bounces on server side only
  game.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.6 }, 1);
  assert.strictEqual(game.scores[1], 0, 'No point yet');

  // Drops off table without bouncing on P2 side
  physics.ballBody.position.set(0, TABLE_HEIGHT - 0.05, 0.2);
  physics.ballBody.position.x = TABLE_WIDTH / 2 + 0.15; // wide out
  assert.strictEqual(game.isBallOffTable(physics.ballBody.position), true);

  game.handleBallLeftTable();
  assert.strictEqual(game.scores[0], 0);
  assert.strictEqual(game.scores[1], 1, 'Receiver P2 awarded FAULT point');
  assert(toasts.some(t => t.includes('CPU FAULT')), 'Toast displays FAULT');
  console.log('✓ PASS: Service fault correctly awarded point to receiver!');
}

// =========================================================================
// TEST 6: Service Net Clip ('LET - RE-SERVE')
// =========================================================================
console.log('\n--- Test 6: Service Net Clip (LET - RE-SERVE) ---');
{
  const { game, physics, toasts } = createMockGame();
  game.server = 1;
  game.serve();

  // Bounces on server side
  game.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.6 }, 1);
  // Clips net
  game.handleNetHit();
  // Bounces on receiver side
  game.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: 0.6 }, 2);

  // Ball leaves table
  physics.ballBody.position.set(0, TABLE_HEIGHT - 0.05, TABLE_LENGTH / 2 + 0.1);
  game.handleBallLeftTable();

  assert.strictEqual(game.scores[0], 0, 'No score changed on let');
  assert.strictEqual(game.scores[1], 0, 'No score changed on let');
  assert.strictEqual(game.server, 1, 'Same server reserves');
  assert(toasts.some(t => t.includes('LET - RE-SERVE')), 'Toast displays LET - RE-SERVE');
  console.log('✓ PASS: Net clip during serve triggered LET re-serve without point alteration!');
}

// =========================================================================
// TEST 7: Dead Ball Safety on Table
// =========================================================================
console.log('\n--- Test 7: Dead Ball Safety on Table ---');
{
  const { game, physics } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;
  game.lastHitter = 1;
  game.bouncesP2 = 1;

  // Ball is resting still on table
  physics.ballBody.position.set(0, TABLE_HEIGHT + 0.02, 0.5);
  physics.ballBody.velocity.set(0.01, 0, 0);

  // Stepping 0.5s: not off table yet
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(game.isBallOffTable(physics.ballBody.position, 0.1), false);
  }

  // Stepping past 1.2s
  let timedOut = false;
  for (let i = 0; i < 10; i++) {
    if (game.isBallOffTable(physics.ballBody.position, 0.1)) {
      timedOut = true;
      break;
    }
  }

  assert.strictEqual(timedOut, true, 'Dead ball safely detected after resting on table');
  game.handleBallLeftTable();
  assert.strictEqual(game.scores[0], 1, 'Hitter awarded point for unreturnable dead ball');
  console.log('✓ PASS: Dead ball safety correctly awarded point!');
}

console.log('\n=== ALL TABLE TENNIS POINT SCORING TESTS PASSED PERFECTLY! ===');
