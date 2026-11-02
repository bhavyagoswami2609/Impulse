import assert from 'node:assert';
import * as THREE from 'three';
import { TableTennisGame, GAME_STATES } from '../src/game/table_tennis_game.js';
import { TABLE_WIDTH, TABLE_LENGTH, TABLE_HEIGHT } from '../src/graphics/procedural_models.js';

// Mock Web Audio
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

console.log('=== VERIFICATION TEST: TABLE TENNIS CONTACT, BOUNCE & SERVING RULES ===\n');

function createMockGame(initialServer = 1, matchType = 'singles') {
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
    matchType,
    onStateChange: (s) => { state = s; },
    onScoreUpdate: (s) => { scoreUpdates.push([...s]); },
    onActionToast: (t) => { toasts.push(t); },
  });

  game.initialServer = initialServer;
  game.server = initialServer;

  return { game, scene, physics, toasts, scoreUpdates, getState: () => state };
}

// -------------------------------------------------------------------------
// Rule 1: One Bounce on Your Side & No Volleys
// -------------------------------------------------------------------------
console.log('--- Test 1: No Volleys (Hitting Ball in Mid-Air Before Bounce on Your Side) ---');
{
  // A. During normal rally: P1 attacks, P2 volleys before bounce
  const { game, toasts } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;
  game.lastHitter = 1; // P1 attacked towards P2
  game.bouncesP2 = 0;  // Ball has NOT bounced on P2's side yet!

  // P2 attempts to hit ball in mid-air
  game.handlePaddleHit(2, 2.5);

  assert.strictEqual(game.scores[0], 1, 'P1 immediately awarded point for P2 illegal volley');
  assert.strictEqual(game.scores[1], 0, 'P2 score unchanged');
  assert(toasts.some(t => t.includes('ILLEGAL VOLLEY')), 'Toast announced ILLEGAL VOLLEY');
  console.log('✓ PASS: Hitting ball in mid-air before bounce on your side immediately awarded point to opponent!');

  // B. During serve: P1 serves, P2 volleys before bounce on receiver court
  const { game: gameServe, toasts: toastsServe } = createMockGame();
  gameServe.server = 1;
  gameServe.serve();
  gameServe.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.6 }, 1); // 1st bounce on server court
  assert.strictEqual(gameServe.bouncesP2, 0, 'Ball has not reached receiver court yet');

  // P2 volleys serve in mid-air
  gameServe.handlePaddleHit(2, 2.0);
  assert.strictEqual(gameServe.scores[0], 1, 'Server P1 awarded point for receiver volley');
  assert.strictEqual(gameServe.scores[1], 0);
  assert(toastsServe.some(t => t.includes('ILLEGAL VOLLEY')), 'Toast announced ILLEGAL VOLLEY on serve');
  console.log('✓ PASS: Receiver volleying a serve before bounce immediately awarded point to server!');
}

// -------------------------------------------------------------------------
// Rule 2: One Bounce on Your Side (Legal Return)
// -------------------------------------------------------------------------
console.log('\n--- Test 2: Exactly One Bounce on Your Side (Legal Return) ---');
{
  const { game } = createMockGame();
  game.state = GAME_STATES.RALLY;
  game.isServiceInProgress = false;
  game.lastHitter = 1;

  // Ball bounces on P2's side
  game.handleTableBounce({ x: 0.2, y: TABLE_HEIGHT, z: 0.7 }, 2);
  assert.strictEqual(game.bouncesP2, 1, 'Ball has bounced exactly once on P2 side');
  assert.strictEqual(game.scores[0], 0);

  // P2 returns ball legally
  game.handlePaddleHit(2, 3.0);
  assert.strictEqual(game.scores[0], 0, 'No point awarded against legal return');
  assert.strictEqual(game.scores[1], 0, 'No point awarded against legal return');
  assert.strictEqual(game.lastHitter, 2, 'P2 is now the active hitter');
  assert.strictEqual(game.bouncesP1, 0, 'P1 bounces reset for defense');
  assert.strictEqual(game.bouncesP2, 0, 'P2 bounces reset');
  console.log('✓ PASS: Hitting ball after exactly one bounce on your side legally returns the ball!');
}

// -------------------------------------------------------------------------
// Rule 3: No Double Bounces (Twice on Either Side Loses Point)
// -------------------------------------------------------------------------
console.log('\n--- Test 3: No Double Bounces (Twice or More on Either Side Loses Point) ---');
{
  // A. Double bounce on receiver side: receiver loses point
  const { game: gameA, toasts: toastsA } = createMockGame();
  gameA.state = GAME_STATES.RALLY;
  gameA.isServiceInProgress = false;
  gameA.lastHitter = 1;

  gameA.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: 0.5 }, 2); // 1st bounce on P2
  assert.strictEqual(gameA.scores[0], 0);
  gameA.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: 0.6 }, 2); // 2nd bounce on P2!
  assert.strictEqual(gameA.scores[0], 1, 'P1 awarded point for P2 double bounce');
  assert.strictEqual(gameA.scores[1], 0);
  assert(toastsA.some(t => t.includes('DOUBLE BOUNCE')));
  console.log('✓ PASS: Two bounces on receiver side immediately awards point to hitter!');

  // B. Double bounce on hitter side: hitter loses point
  const { game: gameB, toasts: toastsB } = createMockGame();
  gameB.state = GAME_STATES.RALLY;
  gameB.isServiceInProgress = false;
  gameB.lastHitter = 1;

  gameB.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.5 }, 1); // 1st bounce on hitter side
  assert.strictEqual(gameB.scores[1], 0);
  gameB.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.4 }, 1); // 2nd bounce on hitter side!
  assert.strictEqual(gameB.scores[1], 1, 'Opponent P2 awarded point for hitter P1 double bounce');
  assert(toastsB.some(t => t.includes('DOUBLE BOUNCE')));
  console.log('✓ PASS: Two bounces on hitter side immediately awards point to opponent!');
}

// -------------------------------------------------------------------------
// Rule 4: Edge Balls are IN vs Vertical Leaf Side OUT
// -------------------------------------------------------------------------
console.log('\n--- Test 4: Edge Balls are IN vs Vertical Leaf Side OUT ---');
{
  // A. Edge Ball on top flat edge/corner: IN BOUNDS
  const { game: gameEdge } = createMockGame();
  gameEdge.state = GAME_STATES.RALLY;
  gameEdge.isServiceInProgress = false;
  gameEdge.lastHitter = 1;

  // Ball clips top flat corner edge at (X = halfWidth, Z = halfLength, Y = TABLE_HEIGHT)
  const topEdgePos = { x: TABLE_WIDTH / 2 - 0.002, y: TABLE_HEIGHT, z: TABLE_LENGTH / 2 - 0.005 };
  gameEdge.handleTableBounce(topEdgePos, 2);
  assert.strictEqual(gameEdge.bouncesP2, 1, 'Top edge ball counted as legal in-bounds bounce');
  assert.strictEqual(gameEdge.scores[0], 0, 'Rally continues');
  console.log('✓ PASS: Top flat edge/corner contact is counted IN bounds!');

  // B. Vertical Side of Table Leaf: OUT
  const { game: gameSide, toasts: toastsSide } = createMockGame();
  gameSide.state = GAME_STATES.RALLY;
  gameSide.isServiceInProgress = false;
  gameSide.lastHitter = 1; // P1 shot hit the vertical side of the table leaf

  const verticalSidePos = { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT - 0.025, z: 0.5 };
  gameSide.handleTableSideHit(verticalSidePos);
  assert.strictEqual(gameSide.scores[0], 0, 'Hitter does not score');
  assert.strictEqual(gameSide.scores[1], 1, 'Opponent P2 awarded point for hitter striking vertical table side');
  assert(toastsSide.some(t => t.includes('OUT - TABLE SIDE')), 'Toast announced OUT - TABLE SIDE');
  console.log('✓ PASS: Ball contacting the vertical side of the table leaf is called OUT!');

  // C. Vertical Side during Serve: FAULT
  const { game: gameSideServe, toasts: toastsSideServe } = createMockGame();
  gameSideServe.server = 1;
  gameSideServe.serve();
  gameSideServe.handleTableSideHit({ x: -TABLE_WIDTH / 2, y: TABLE_HEIGHT - 0.02, z: -0.5 });
  assert.strictEqual(gameSideServe.scores[1], 1, 'Receiver awarded point for server hitting vertical table side');
  assert(toastsSideServe.some(t => t.includes('FAULT - TABLE SIDE')), 'Toast announced FAULT - TABLE SIDE');
  console.log('✓ PASS: Serve hitting vertical side of table leaf is called FAULT!');
}

// -------------------------------------------------------------------------
// Rule 5: Serving Bounce Rules (The Double Bounce Serve)
// -------------------------------------------------------------------------
console.log('\n--- Test 5: The Double Bounce Serve (Server Side -> Clears Net -> Receiver Side) ---');
{
  const { game, physics } = createMockGame();
  game.server = 1;
  game.serve();

  // 1st bounce on server's side
  game.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.6 }, 1);
  assert.strictEqual(game.isServiceInProgress, true, 'Serve still in flight towards receiver');
  assert.strictEqual(game.bouncesP1, 1);

  // 2nd bounce on receiver's side
  game.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: 0.6 }, 2);
  assert.strictEqual(game.isServiceInProgress, false, 'Legal double-bounce serve completed into rally!');
  assert.strictEqual(game.bouncesP2, 1);

  // Receiver fails to return, ball leaves table
  physics.ballBody.position.set(0, TABLE_HEIGHT - 0.05, TABLE_LENGTH / 2 + 0.1);
  game.handleBallLeftTable();
  assert.strictEqual(game.scores[0], 1, 'Server awarded WINNER point for completed serve');
  console.log('✓ PASS: Double bounce serve strictly enforced (server court -> net -> receiver court)!');
}

// -------------------------------------------------------------------------
// Rule 6: Singles vs Doubles Placement
// -------------------------------------------------------------------------
console.log('\n--- Test 6: Singles vs Doubles Placement ---');
{
  // A. Singles: Serve can land ANYWHERE on the opponent side (wide left, center, wide right)
  const { game: gameSingles } = createMockGame(1, 'singles');
  gameSingles.serve();
  gameSingles.handleTableBounce({ x: 0.35, y: TABLE_HEIGHT, z: -0.6 }, 1); // Server side left
  gameSingles.handleTableBounce({ x: -0.65, y: TABLE_HEIGHT, z: 0.7 }, 2); // Receiver side wide right
  assert.strictEqual(gameSingles.scores[1], 0, 'Singles serve to wide angle is legal');
  assert.strictEqual(gameSingles.isServiceInProgress, false, 'Serve completed in singles');
  console.log('✓ PASS: In singles, the serve can land anywhere across the opponent side!');

  // B. Doubles: Serve must be diagonal from right-hand box to right-hand box
  // For P1 (looking +Z), right box is x <= 0. Receiver P2 (looking -Z) right box is x >= 0.
  const { game: gameDoubles, toasts: toastsDoubles } = createMockGame(1, 'doubles');
  assert.strictEqual(gameDoubles.matchType, 'doubles');
  gameDoubles.serve();

  // Legal diagonal doubles serve: Server right box (x = -0.25) -> Receiver right box (x = +0.25)
  gameDoubles.handleTableBounce({ x: -0.25, y: TABLE_HEIGHT, z: -0.6 }, 1);
  assert.strictEqual(gameDoubles.scores[1], 0, 'Server right box bounce is legal');
  gameDoubles.handleTableBounce({ x: 0.25, y: TABLE_HEIGHT, z: 0.6 }, 2);
  assert.strictEqual(gameDoubles.scores[1], 0, 'Receiver right box bounce is legal');
  assert.strictEqual(gameDoubles.isServiceInProgress, false, 'Doubles serve completed into rally');
  console.log('✓ PASS: In doubles, diagonal serve from right box to right box is legal!');

  // C. Doubles: Serve landing in WRONG box is a FAULT!
  const { game: gameDoublesFault, toasts: toastsDoublesFault } = createMockGame(1, 'doubles');
  gameDoublesFault.serve();
  gameDoublesFault.handleTableBounce({ x: -0.25, y: TABLE_HEIGHT, z: -0.6 }, 1); // Server right box (ok)
  // Landed in receiver's LEFT box (x = -0.25 for P2 is left box) -> FAULT!
  gameDoublesFault.handleTableBounce({ x: -0.25, y: TABLE_HEIGHT, z: 0.6 }, 2);
  assert.strictEqual(gameDoublesFault.scores[1], 1, 'Receiver awarded point for server landing in wrong doubles box');
  assert(toastsDoublesFault.some(t => t.includes('FAULT - WRONG SERVICE BOX')), 'Toast announced FAULT - WRONG SERVICE BOX');
  console.log('✓ PASS: In doubles, serve landing in wrong box is called FAULT!');
}

// -------------------------------------------------------------------------
// Rule 7: Net Contact During Live Rally vs Serve
// -------------------------------------------------------------------------
console.log('\n--- Test 7: Net Contact During Live Rally vs Serve ---');
{
  // A. Live Rally: Net clip allowed as long as it crosses and lands on opponent side
  const { game: gameRally } = createMockGame();
  gameRally.state = GAME_STATES.RALLY;
  gameRally.isServiceInProgress = false;
  gameRally.lastHitter = 1;

  // Ball clips net
  gameRally.handleNetHit();
  assert.strictEqual(gameRally.scores[0], 0, 'No point awarded simply for net clip');
  assert.strictEqual(gameRally.scores[1], 0);

  // Ball successfully crosses over and lands on opponent's side
  gameRally.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: 0.4 }, 2);
  assert.strictEqual(gameRally.bouncesP2, 1, 'Bounce registered on opponent side');
  assert.strictEqual(gameRally.scores[0], 0, 'Play continues normally');

  // Opponent returns it
  gameRally.handlePaddleHit(2, 2.8);
  assert.strictEqual(gameRally.lastHitter, 2, 'Rally continued after net clip!');
  console.log('✓ PASS: Net clip during live rally allows play to continue when crossing into opponent court!');

  // B. Serve: Net clip that lands on both sides triggers LET - RE-SERVE
  const { game: gameLet, toasts: toastsLet } = createMockGame();
  gameLet.server = 1;
  gameLet.serve();
  gameLet.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: -0.6 }, 1);
  gameLet.handleNetHit();
  gameLet.handleTableBounce({ x: 0, y: TABLE_HEIGHT, z: 0.6 }, 2);
  gameLet.physics.ballBody.position.set(0, TABLE_HEIGHT - 0.05, TABLE_LENGTH / 2 + 0.1);
  gameLet.handleBallLeftTable();

  assert.strictEqual(gameLet.scores[0], 0, 'No score changed on serve let');
  assert.strictEqual(gameLet.scores[1], 0);
  assert(toastsLet.some(t => t.includes('LET - RE-SERVE')));
  console.log('✓ PASS: Net clip during serve that lands on receiver court triggers LET - RE-SERVE!');
}

console.log('\n=== ALL TABLE TENNIS BOUNCE, CONTACT & SERVING RULES PASSED PERFECTLY! ===');
