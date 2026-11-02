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

console.log('=== RUNNING OFFICIAL ITTF TABLE TENNIS POINT SCORING VERIFICATION ===\n');

function createMockGame(initialServer = 1) {
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

  game.initialServer = initialServer;
  game.server = initialServer;

  return { game, scene, physics, toasts, scoreUpdates, getState: () => state };
}

// =========================================================================
// TEST 1: Double Bounce Rule (ITTF 2.10.1.1): 1 bounce allowed; 2nd bounce is point!
// =========================================================================
console.log('--- Test 1: Bounces on Table: 1st Bounce Play Continues, 2nd Bounce Awards Point ---');
{
  const { game, physics, toasts } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;
  game.lastHitter = 1;

  // Ball is on the table (y = TABLE_HEIGHT, within bounds)
  physics.ballBody.position.set(0.1, TABLE_HEIGHT, 0.5);

  // 1st bounce on P2 side: legal return window, no point yet
  game.handleTableBounce({ x: 0.1, y: TABLE_HEIGHT, z: 0.5 }, 2);
  assert.strictEqual(game.scores[0], 0, 'P1 score must still be 0 after 1st bounce');
  assert.strictEqual(game.scores[1], 0, 'P2 score must still be 0 after 1st bounce');
  assert.strictEqual(game.bouncesP2, 1, 'bouncesP2 should be 1');

  // 2nd bounce on P2 side: receiver failed to return after 1st bounce! Immediate DOUBLE BOUNCE point to P1!
  game.handleTableBounce({ x: 0.1, y: TABLE_HEIGHT, z: 0.5 }, 2);
  assert.strictEqual(game.scores[0], 1, 'P1 score must be 1 after 2nd bounce on P2 side');
  assert.strictEqual(game.scores[1], 0, 'P2 score must be 0');
  assert(toasts.some(t => t.includes('DOUBLE BOUNCE')), 'Toast announced DOUBLE BOUNCE');
  console.log('✓ PASS: Double bounce (2 bounces on receiver court) immediately awarded point to hitter!');
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
  // At 1-0 (total 1 point), it is still server 1's turn (serve alternates every 2 points before deuce)
  assert.strictEqual(game.server, 1, 'P1 serves 2nd point in service block');
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
  // Score is 0-1 (total 1 point). Server is still 1!
  assert.strictEqual(game.server, 1, 'Server remains 1 for 2nd point of 2-point block');
  assert(toasts.some(t => t.includes('CPU OUT')), 'Toast shows CPU OUT');
  console.log('✓ PASS: Ball leaving table without landing on opponent court awarded OUT to opponent!');
}

// =========================================================================
// TEST 4: Successful Service then Ball Leaving Table
// =========================================================================
console.log('\n--- Test 4: Legal Service Followed by Ball Leaving Table ---');
{
  const { game, physics } = createMockGame();
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
  assert(toasts.some(t => t.includes('FAULT')), 'Toast displays FAULT');
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

// =========================================================================
// TEST 8: ITTF 2-Serve Rotation Before Deuce
// =========================================================================
console.log('\n--- Test 8: ITTF 2-Serve Rotation Verification ---');
{
  const { game } = createMockGame(1);

  // Point sequence simulation:
  // Points: [0, 0] -> Server 1
  // 1-0 -> Server 1
  // 1-1 -> Server 2 (after 2 total points, serve changes to CPU)
  // 2-1 -> Server 2
  // 2-2 -> Server 1 (after 4 total points, serve returns to P1)
  // 3-2 -> Server 1
  // 3-3 -> Server 2
  // 4-3 -> Server 2
  // 5-3 -> Server 1
  const expectedServers = [
    { p1: 1, p2: 0, server: 1 },
    { p1: 1, p2: 1, server: 2 },
    { p1: 2, p2: 1, server: 2 },
    { p1: 2, p2: 2, server: 1 },
    { p1: 3, p2: 2, server: 1 },
    { p1: 3, p2: 3, server: 2 },
    { p1: 4, p2: 3, server: 2 },
    { p1: 5, p2: 3, server: 1 },
  ];

  for (const step of expectedServers) {
    const s = game.computeNextServer([step.p1, step.p2]);
    assert.strictEqual(s, step.server, `At ${step.p1}-${step.p2}, expected server ${step.server} but got ${s}`);
  }
  console.log('✓ PASS: ITTF 2-serve rotation strictly follows 2-point blocks!');
}

// =========================================================================
// TEST 9: ITTF Deuce, 1-Serve Alternation & Advantage Flow
// =========================================================================
console.log('\n--- Test 9: Deuce & Advantage Rule Compliance (ITTF 2.11, 2.13.4) ---');
{
  const { game, toasts } = createMockGame(1);
  game.scores = [9, 9];

  // Point to P1 -> 10-9 (Total 19 points: Math.floor(19/2)=9, odd -> server 2)
  game.awardPoint(1, 'WINNER');
  assert.strictEqual(game.scores[0], 10);
  assert.strictEqual(game.scores[1], 9);
  assert.strictEqual(game.isDeuce, false, 'Not deuce at 10-9');
  assert.strictEqual(game.server, 2);

  // Point to CPU -> 10-10 -> DEUCE! Total points 20 (even) -> server 1
  game.awardPoint(2, 'WINNER');
  assert.strictEqual(game.scores[0], 10);
  assert.strictEqual(game.scores[1], 10);
  assert.strictEqual(game.isDeuce, true, 'Deuce reached at 10-10');
  assert.strictEqual(game.server, 1, 'Server alternates to P1 at 10-10');
  assert(toasts.some(t => t.includes('DEUCE (10-10)')), 'Toast announced DEUCE (10-10)');

  // Point to P1 -> 11-10 -> ADVANTAGE P1! Total points 21 (odd) -> server 2 (alternates every 1 point!)
  game.awardPoint(1, 'WINNER');
  assert.strictEqual(game.scores[0], 11);
  assert.strictEqual(game.scores[1], 10);
  assert.strictEqual(game.isDeuce, true);
  assert.strictEqual(game.server, 2, 'Service alternated after 1 point at deuce!');
  assert(toasts.some(t => t.includes('ADVANTAGE P1 (11-10)')), 'Toast announced ADVANTAGE P1 (11-10)');
  assert(!toasts.slice(-1)[0].startsWith('DEUCE'), 'Last toast must NOT be DEUCE when player has advantage!');

  // Point to CPU -> 11-11 -> DEUCE! Total points 22 (even) -> server 1
  game.awardPoint(2, 'WINNER');
  assert.strictEqual(game.scores[0], 11);
  assert.strictEqual(game.scores[1], 11);
  assert.strictEqual(game.isDeuce, true);
  assert.strictEqual(game.server, 1);
  assert(toasts.some(t => t.includes('DEUCE (11-11)')), 'Toast announced DEUCE (11-11)');

  // Point to CPU -> 11-12 -> ADVANTAGE CPU! Total points 23 (odd) -> server 2
  game.awardPoint(2, 'WINNER');
  assert.strictEqual(game.scores[0], 11);
  assert.strictEqual(game.scores[1], 12);
  assert.strictEqual(game.server, 2);
  assert(toasts.some(t => t.includes('ADVANTAGE CPU (11-12)')), 'Toast announced ADVANTAGE CPU (11-12)');

  // Point to CPU -> 11-13 -> Match Over! (Lead of 2 points achieved at >= 11)
  game.awardPoint(2, 'WINNER');
  assert.strictEqual(game.state, GAME_STATES.MATCH_OVER, 'Match concluded with 2-point lead at deuce');
  assert(toasts.some(t => t.includes('MATCH OVER: CPU WINS (11-13)')), 'Toast announced match over');
  console.log('✓ PASS: Deuce, 1-serve rotation, and Advantage accurately announced and resolved!');
}

// =========================================================================
// TEST 10: Fault on Own Table Bounce (ITTF 2.10.1.3)
// =========================================================================
console.log('\n--- Test 10: Fault on Own Table Bounce ---');
{
  const { game, toasts } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;
  game.lastHitter = 1; // P1 struck the ball

  // Ball bounces on P1's own table side (side 1) instead of going over to P2's side!
  game.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.5 }, 1);
  assert.strictEqual(game.scores[0], 0, 'P1 should not score for bouncing on own table');
  assert.strictEqual(game.scores[1], 1, 'P2 awarded point for P1 bouncing on own table');
  assert(toasts.some(t => t.includes('FAULT - OWN TABLE')), 'Toast announced FAULT - OWN TABLE');
  console.log('✓ PASS: Bouncing ball on own table immediately awarded point to opponent!');
}

// =========================================================================
// TEST 11: Consecutive Double Hit by Same Player (ITTF 2.10.1.6)
// =========================================================================
console.log('\n--- Test 11: Consecutive Double Hit Penalty ---');
{
  const { game, toasts } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;

  // P1 strikes ball legally
  game.handlePaddleHit(1, 2.0);
  assert.strictEqual(game.lastHitter, 1);
  assert.strictEqual(game.scores[0], 0);
  assert.strictEqual(game.scores[1], 0);

  // P1 hits ball AGAIN without P2 touching it
  game.handlePaddleHit(1, 2.0);
  assert.strictEqual(game.scores[0], 0, 'P1 should not score on double hit');
  assert.strictEqual(game.scores[1], 1, 'P2 awarded point for P1 consecutive double hit');
  assert(toasts.some(t => t.includes('DOUBLE HIT')), 'Toast announced DOUBLE HIT');
  console.log('✓ PASS: Consecutive double hit penalty immediately awarded point to opponent!');
}

// =========================================================================
// TEST 12: Illegal Serve Faults (Double Bounce on Server Table / Direct Hit)
// =========================================================================
console.log('\n--- Test 12: Illegal Serve Faults ---');
{
  // A. Double bounce on server's table during serve
  const { game: gameA, toasts: toastsA } = createMockGame();
  gameA.server = 1;
  gameA.serve();
  gameA.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.6 }, 1); // 1st bounce on own table (ok)
  assert.strictEqual(gameA.scores[1], 0);
  gameA.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.5 }, 1); // 2nd bounce on own table (fault!)
  assert.strictEqual(gameA.scores[1], 1, 'P2 awarded point for P1 bouncing twice on own table');
  assert(toastsA.some(t => t.includes('FAULT - DOUBLE BOUNCE')));

  // B. Direct hit to receiver's court without bouncing on server's court first
  const { game: gameB, toasts: toastsB } = createMockGame();
  gameB.server = 1;
  gameB.serve();
  gameB.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: 0.6 }, 2); // Landed on P2 court without bouncing on P1 court
  assert.strictEqual(gameB.scores[1], 1, 'P2 awarded point for P1 direct serve into receiver table');
  assert(toastsB.some(t => t.includes('FAULT - DIRECT HIT')));

  console.log('✓ PASS: Illegal serve rules strictly enforced!');
}

console.log('\n=== ALL TABLE TENNIS POINT SCORING TESTS PASSED PERFECTLY! ===');
