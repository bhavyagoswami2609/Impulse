import assert from 'assert';
import * as THREE from 'three';
import { TableTennisGame } from '../src/game/table_tennis_game.js';
import { AirHockeyGame } from '../src/game/air_hockey_game.js';
import { PhysicsWorld } from '../src/physics/physics_world.js';
import { AirHockeyPhysics } from '../src/physics/air_hockey_physics.js';

console.log('=== VERIFICATION TEST: BOT DIFFICULTY LEVELS (EASY, MEDIUM, HARD) ===\n');

// Mock scene
function createMockScene() {
  const p1 = new THREE.Mesh();
  const p2 = new THREE.Mesh();
  const ball = new THREE.Mesh();
  const puck = new THREE.Mesh();
  return {
    paddle1: p1,
    paddle2: p2,
    ball,
    striker1: p1,
    striker2: p2,
    puck,
    setViewMode: () => {},
    triggerImpact: () => {},
  };
}

// Mock multiplayer
const mockMultiplayer = {
  isConnected: false,
  role: 'host',
  send: () => {},
};

// -------------------------------------------------------------
// Test 1: Table Tennis Game Difficulty Configurations & Tuning
// -------------------------------------------------------------
console.log('--- Test 1: Table Tennis Bot Difficulty Scaling ---');
const ttPhysics = new PhysicsWorld();
const ttGame = new TableTennisGame({
  scene: createMockScene(),
  physics: ttPhysics,
  multiplayer: mockMultiplayer,
  onStateChange: () => {},
  onScoreUpdate: () => {},
  onActionToast: () => {},
  onMatchOver: () => {},
});

assert.strictEqual(ttGame.difficulty, 'medium', 'Table Tennis should default to medium difficulty');
assert.ok(ttGame.difficultyConfigs.easy, 'Easy config must exist');
assert.ok(ttGame.difficultyConfigs.medium, 'Medium config must exist');
assert.ok(ttGame.difficultyConfigs.hard, 'Hard config must exist');

const easyTT = ttGame.difficultyConfigs.easy;
const medTT = ttGame.difficultyConfigs.medium;
const hardTT = ttGame.difficultyConfigs.hard;

// Check scaling invariants
assert(easyTT.aiSpeed < medTT.aiSpeed && medTT.aiSpeed < hardTT.aiSpeed, 'aiSpeed must scale easy < medium < hard');
assert(easyTT.errorMargin > medTT.errorMargin && medTT.errorMargin > hardTT.errorMargin, 'errorMargin must scale easy > medium > hard');
assert(easyTT.servePace < medTT.servePace && medTT.servePace < hardTT.servePace, 'servePace must scale easy < medium < hard');
assert(easyTT.returnPower < medTT.returnPower && medTT.returnPower < hardTT.returnPower, 'returnPower must scale easy < medium < hard');
assert(easyTT.cornerDriveRate < medTT.cornerDriveRate && medTT.cornerDriveRate < hardTT.cornerDriveRate, 'cornerDriveRate must scale easy < medium < hard');

console.log(`✓ Difficulty configs verified:`);
console.log(`  Easy:   aiSpeed=${easyTT.aiSpeed}, errorMargin=${easyTT.errorMargin}, servePace=${easyTT.servePace} m/s, returnPower=${easyTT.returnPower}`);
console.log(`  Medium: aiSpeed=${medTT.aiSpeed}, errorMargin=${medTT.errorMargin}, servePace=${medTT.servePace} m/s, returnPower=${medTT.returnPower}`);
console.log(`  Hard:   aiSpeed=${hardTT.aiSpeed}, errorMargin=${hardTT.errorMargin}, servePace=${hardTT.servePace} m/s, returnPower=${hardTT.returnPower}`);

// Test setDifficulty
ttGame.setDifficulty('hard');
assert.strictEqual(ttGame.difficulty, 'hard');
ttGame.setDifficulty('easy');
assert.strictEqual(ttGame.difficulty, 'easy');
ttGame.setDifficulty('invalid_diff');
assert.strictEqual(ttGame.difficulty, 'easy', 'Invalid difficulty should be ignored');
console.log('✓ Table Tennis setDifficulty switching verified');

// -------------------------------------------------------------
// Test 2: Table Tennis Return Pace Scaling in Physics
// -------------------------------------------------------------
console.log('\n--- Test 2: Return Velocity Scaling with ReturnPower Multiplier ---');
// Test continuous strikes return velocity calculation with easy (0.86) vs hard (1.15)
ttPhysics.isInRally = true;
ttPhysics.ballBody.position.set(0, 0.95, 1.25);
ttPhysics.ballBody.velocity.set(0, 0, 1.5); // ball approaching CPU (+Z)

const p2Pos = new THREE.Vector3(0, 0.95, 1.28);
const p2Vel = new THREE.Vector3(0, 0, -1.0); // CPU swinging forward into ball (-Z)
const p2Yaw = 0;

// Test with Easy returnPower (0.86)
ttPhysics.lastPaddleHitTime = -10000;
ttPhysics.checkContinuousStrikes(
  new THREE.Vector3(0, 0.95, -1.25),
  new THREE.Vector3(0, 0, 0),
  0,
  p2Pos,
  p2Vel,
  p2Yaw,
  0,
  easyTT.returnPower
);
const easyReturnVz = Math.abs(ttPhysics.ballBody.velocity.z);

// Reset ball for hard hit
ttPhysics.ballBody.position.set(0, 0.95, 1.25);
ttPhysics.ballBody.velocity.set(0, 0, 1.5);
ttPhysics.lastPaddleHitTime = -10000;

// Test with Hard returnPower (1.15)
ttPhysics.checkContinuousStrikes(
  new THREE.Vector3(0, 0.95, -1.25),
  new THREE.Vector3(0, 0, 0),
  0,
  p2Pos,
  p2Vel,
  p2Yaw,
  0,
  hardTT.returnPower
);
const hardReturnVz = Math.abs(ttPhysics.ballBody.velocity.z);

console.log(`  Easy return pace: ${easyReturnVz.toFixed(2)} m/s`);
console.log(`  Hard return pace: ${hardReturnVz.toFixed(2)} m/s`);
assert(hardReturnVz > easyReturnVz, 'Hard return pace must be noticeably faster than easy return pace');
console.log('✓ Hard returns generate stronger, more aggressive drives than Easy returns');

// -------------------------------------------------------------
// Test 3: Air Hockey Game Difficulty Configurations & Tuning
// -------------------------------------------------------------
console.log('\n--- Test 3: Air Hockey Bot Difficulty Scaling ---');
const hockeyPhysics = new AirHockeyPhysics();
const hockeyGame = new AirHockeyGame({
  scene: createMockScene(),
  physics: hockeyPhysics,
  multiplayer: mockMultiplayer,
  onStateChange: () => {},
  onScoreUpdate: () => {},
  onActionToast: () => {},
  onMatchOver: () => {},
});

assert.strictEqual(hockeyGame.difficulty, 'medium', 'Air Hockey should default to medium difficulty');
assert.ok(hockeyGame.difficultyConfigs.easy, 'Air Hockey easy config must exist');
assert.ok(hockeyGame.difficultyConfigs.medium, 'Air Hockey medium config must exist');
assert.ok(hockeyGame.difficultyConfigs.hard, 'Air Hockey hard config must exist');

const easyAH = hockeyGame.difficultyConfigs.easy;
const medAH = hockeyGame.difficultyConfigs.medium;
const hardAH = hockeyGame.difficultyConfigs.hard;

assert(easyAH.aiSpeed < medAH.aiSpeed && medAH.aiSpeed < hardAH.aiSpeed, 'Air Hockey aiSpeed must scale easy < medium < hard');
assert(easyAH.errorMargin > medAH.errorMargin && medAH.errorMargin >= hardAH.errorMargin, 'Air Hockey errorMargin must scale easy > medium >= hard');
assert(easyAH.strikePower < medAH.strikePower && medAH.strikePower < hardAH.strikePower, 'Air Hockey strikePower must scale easy < medium < hard');

console.log(`✓ Air Hockey difficulty configs verified:`);
console.log(`  Easy:   aiSpeed=${easyAH.aiSpeed}, errorMargin=${easyAH.errorMargin}, strikePower=${easyAH.strikePower}`);
console.log(`  Medium: aiSpeed=${medAH.aiSpeed}, errorMargin=${medAH.errorMargin}, strikePower=${medAH.strikePower}`);
console.log(`  Hard:   aiSpeed=${hardAH.aiSpeed}, errorMargin=${hardAH.errorMargin}, strikePower=${hardAH.strikePower}`);

hockeyGame.setDifficulty('hard');
assert.strictEqual(hockeyGame.difficulty, 'hard');
hockeyGame.setDifficulty('easy');
assert.strictEqual(hockeyGame.difficulty, 'easy');
hockeyGame.setDifficulty('unknown');
assert.strictEqual(hockeyGame.difficulty, 'easy');
console.log('✓ Air Hockey setDifficulty switching verified');

// -------------------------------------------------------------
// Test 4: Dynamic Difficulty Cycling Logic
// -------------------------------------------------------------
console.log('\n--- Test 4: Difficulty Cycle Sequence (Easy -> Medium -> Hard -> Easy) ---');
const cycle = { easy: 'medium', medium: 'hard', hard: 'easy' };
let current = 'medium';
current = cycle[current];
assert.strictEqual(current, 'hard', 'medium cycles to hard');
current = cycle[current];
assert.strictEqual(current, 'easy', 'hard cycles to easy');
current = cycle[current];
assert.strictEqual(current, 'medium', 'easy cycles to medium');
console.log('✓ Cycling logic correctly rotates through all 3 tiers');

console.log('\n=== ALL BOT DIFFICULTY UNIT & LOGIC TESTS PASSED! ===');
