import assert from 'assert';
import * as THREE from 'three';

// Provide browser globals for Node test
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1920,
  innerHeight: 1080,
  location: { hostname: 'localhost', protocol: 'http:' },
  AudioContext: class {
    createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
  }
};
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    configurable: true,
  });
} catch (e) {}

import { HandTracker } from '../src/tracking/hand_tracker.js';
import { TableTennisGame, GAME_STATES } from '../src/game/table_tennis_game.js';
import { PhysicsWorld } from '../src/physics/physics_world.js';
import { TABLE_WIDTH, TABLE_LENGTH, TABLE_HEIGHT } from '../src/graphics/procedural_models.js';

console.log('=== VERIFICATION TEST: WIDE SHOT REACH & BALL HIT DETECTION ===\n');

// -------------------------------------------------------------
// Test 1: HandTracker Reach Beyond Right Table Edge
// -------------------------------------------------------------
console.log('--- Test 1: Paddle Reaches Farther Than Right Table Edge ---');
const mockCanvas = {
  width: 420,
  height: 236,
  getContext: () => ({
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    drawImage: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    setLineDash: () => {},
    fillText: () => {},
  }),
};

const tracker = new HandTracker({
  canvasElement: mockCanvas,
  onStatusChange: () => {},
  onCalibrationUpdate: () => {},
});

const tableHalfW = TABLE_WIDTH / 2; // 0.7625m
console.log(`  Table right edge (X): -${tableHalfW.toFixed(4)} m`);
console.log(`  courtLimits.p1.minX:  ${tracker.courtLimits.p1.minX.toFixed(4)} m`);
console.log(`  courtLimits.p1.maxX:  ${tracker.courtLimits.p1.maxX.toFixed(4)} m`);

assert(
  Math.abs(tracker.courtLimits.p1.minX) > tableHalfW + 0.30,
  'Court limits must provide at least 30cm of clearance beyond the table edge'
);

// Neutral hand calibrated at center (0.50)
tracker.neutralHand = { x: 0.50, y: 0.50, depth: 0.15, yaw: 0 };
tracker.isCalibrated = true;
tracker.handDetected = true;
tracker.lastDetectedTime = performance.now();

// Simulate reaching to the right in webcam view:
// Moving physically right increases userX (from 0.50 to 0.72)
const normalReachX = 0.72; // normal reach delta = +0.22
const mockLandmarks = Array.from({ length: 21 }, () => ({ x: 1.0 - normalReachX, y: 0.50, z: 0 }));
mockLandmarks[0] = { x: 1.0 - normalReachX, y: 0.50, z: 0 }; // wrist
mockLandmarks[5] = { x: 1.0 - normalReachX, y: 0.45, z: 0 }; // index knuckle
mockLandmarks[9] = { x: 1.0 - normalReachX, y: 0.44, z: 0 }; // middle knuckle
mockLandmarks[17] = { x: 1.0 - normalReachX, y: 0.46, z: 0 }; // pinky knuckle

// Frame 1: Reaching normal speed (dt = 0.033s)
tracker.prevRawX = normalReachX - 0.02; // slow movement
tracker.onMediaPipeResults({ multiHandLandmarks: [mockLandmarks], image: {} });
const normalPos = tracker.getTransform(0.016).position;
console.log(`  Normal reach paddle X: ${normalPos.x.toFixed(3)} m (vs table edge -${tableHalfW.toFixed(3)}m)`);
assert(
  normalPos.x <= -tableHalfW,
  `Paddle must reach at or beyond the table right edge (-${tableHalfW.toFixed(3)}m), got ${normalPos.x.toFixed(3)}m`
);

// Frame 2: Reaching FAST to the right (swift lunge/swipe)
tracker.prevRawX = 0.52; // moved from 0.52 to 0.72 in 0.033s = speed 6.0 units/s!
tracker.onMediaPipeResults({ multiHandLandmarks: [mockLandmarks], image: {} });
const fastPos = tracker.getTransform(0.016).position;
console.log(`  Fast reach paddle X:   ${fastPos.x.toFixed(3)} m`);
assert(
  fastPos.x < -tableHalfW - 0.08,
  `Fast reach must extend a bit farther than the right end of the table (<-0.84m), got ${fastPos.x.toFixed(3)}m`
);
console.log('✓ PASS: Reaching right fast successfully extends paddle farther than the right table edge!');

// -------------------------------------------------------------
// Test 2: Low Dipping Wide Ball Height Reachability
// -------------------------------------------------------------
console.log('\n--- Test 2: Low Wide Ball Height Reachability ---');
console.log(`  courtLimits.p1.minY: ${tracker.courtLimits.p1.minY.toFixed(3)} m (table top: ${TABLE_HEIGHT} m)`);
assert(
  tracker.courtLimits.p1.minY < TABLE_HEIGHT - 0.20,
  'minY must allow paddle to scoop up balls below table top level'
);

// Active ball height set to low dipping wide ball (0.62m)
tracker.activeBallHeight = 0.62;
let lowPaddleTransform;
for (let f = 0; f < 15; f++) {
  tracker.onMediaPipeResults({ multiHandLandmarks: [mockLandmarks], image: {} });
  lowPaddleTransform = tracker.getTransform(0.016);
}
const bladeY = lowPaddleTransform.position.y + 0.082;
console.log(`  Low paddle blade Y: ${bladeY.toFixed(3)} m (target ball Y: 0.620 m)`);
assert(
  Math.abs(bladeY - 0.62) < 0.12,
  `Paddle blade must align closely with low dipping ball height, got ${bladeY.toFixed(3)}m`
);
console.log('✓ PASS: Paddle cleanly reaches down to low dropping wide balls!');

// -------------------------------------------------------------
// Test 3: isBallOffTable Allows Wide Shots in Flight
// -------------------------------------------------------------
console.log('\n--- Test 3: isBallOffTable Wide Shot Rules ---');
const physics = new PhysicsWorld();
const scene = {
  paddle1: new THREE.Mesh(),
  paddle2: new THREE.Mesh(),
  ball: new THREE.Mesh(),
  triggerImpact: () => {},
};
const game = new TableTennisGame({
  scene,
  physics,
  multiplayer: { isConnected: false, role: 'host' },
  onStateChange: () => {},
  onScoreUpdate: () => {},
  onActionToast: () => {},
  onMatchOver: () => {},
});

game.state = GAME_STATES.RALLY;
game.lastHitter = 2; // CPU struck the ball
game.bouncesP1 = 1;  // Ball successfully bounced on Player 1's court!

// The ball bounced and is angling wide to the right outside table sideline (-0.88m),
// and has dipped below table top (y = 0.68m) while still in the air:
const wideBallPos = new THREE.Vector3(-0.88, 0.68, -1.35);
const isOff = game.isBallOffTable(wideBallPos);
console.log(`  Wide ball outside table (x=-0.88, y=0.68) after bouncing on P1 court: isOff = ${isOff}`);
assert.strictEqual(
  isOff,
  false,
  'Ball must NOT be called off table while in the air after a valid table bounce!'
);

// If ball reaches the floor (y <= 0.08):
const floorBallPos = new THREE.Vector3(-0.88, 0.07, -1.35);
assert.strictEqual(
  game.isBallOffTable(floorBallPos),
  true,
  'Ball hitting the floor must be called off table'
);

// Contrast: If CPU hit the ball wide OUT without bouncing on P1's court (bouncesP1 = 0):
game.bouncesP1 = 0;
assert.strictEqual(
  game.isBallOffTable(wideBallPos),
  true,
  'Ball flying outside table without bouncing on receiver court must be called OUT'
);
console.log('✓ PASS: isBallOffTable keeps wide shots alive after bouncing, and accurately calls unbounced balls OUT!');

// -------------------------------------------------------------
// Test 4: Physical Strike Detection & Return on Wide Far Shot
// -------------------------------------------------------------
console.log('\n--- Test 4: Strike Detection & Return on Wide Far Shot ---');
physics.isInRally = true;
physics.lastPaddleHitTime = -1000;

let p1HitFired = false;
physics.callbacks.onBallHitPaddle = (player) => {
  if (player === 1) p1HitFired = true;
};

// Wide ball approaching Player 1 at screen right (x = -0.88m, y = 0.72m, z = -1.38m)
physics.ballBody.position.set(-0.88, 0.72, -1.38);
physics.ballBody.velocity.set(-0.35, -0.40, -2.60);

// Player reaches wide to the right:
// p1Pos.x = -0.88m (farther than table edge -0.7625m!)
// p1Pos.y = 0.64m (blade at y = 0.64 + 0.082 = 0.722m)
// p1Pos.z = -1.42m (ball is in front of racket: dz = -1.38 - (-1.42) = +0.04m)
// p1Vel.x = -1.2 m/s (fast lateral reaching motion)
const wideP1Pos = new THREE.Vector3(-0.88, 0.64, -1.42);
const wideP1Vel = new THREE.Vector3(-1.20, 0.10, 0.15); // reaching right with forward drive
const wideP1Yaw = 0.10; // slight cross-court face angle

physics.step(
  0.016,
  wideP1Pos,
  wideP1Vel,
  wideP1Yaw,
  new THREE.Vector3(0, 0.95, 1.35),
  new THREE.Vector3(),
  0,
  0
);

assert.strictEqual(p1HitFired, true, 'Strike detector must cleanly detect wide shot hit');
console.log(`  Hit detected! Ball exit velocity: (${physics.ballBody.velocity.x.toFixed(2)}, ${physics.ballBody.velocity.y.toFixed(2)}, ${physics.ballBody.velocity.z.toFixed(2)})`);

// Verify ball is returned towards opponent (+Z) and steered back into the court (+X direction)
assert(
  physics.ballBody.velocity.z > 2.5,
  `Ball must launch forward into opponent court (+Z), got vz=${physics.ballBody.velocity.z}`
);
assert(
  physics.ballBody.velocity.x > 0.20,
  `Ball struck at X=-0.88m must be returned inward towards center (+X), got vx=${physics.ballBody.velocity.x}`
);
console.log('✓ PASS: Wide shot hit connected cleanly and returned ball diagonally back across court into play!');

console.log('\n=== ALL WIDE SHOT REACH & HIT TESTS PASSED PERFECTLY! ===');
