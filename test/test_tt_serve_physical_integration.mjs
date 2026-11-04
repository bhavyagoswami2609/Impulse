import assert from 'node:assert';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/physics_world.js';
import { TableTennisGame, GAME_STATES } from '../src/game/table_tennis_game.js';
import { TABLE_HEIGHT, TABLE_LENGTH, TABLE_WIDTH, NET_HEIGHT } from '../src/graphics/procedural_models.js';

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

console.log('=== VERIFICATION TEST: TABLE TENNIS SERVE PHYSICAL INTEGRATION ===\n');

function runPhysicalServeTest({ name, server = 1, p1Pos = null, p1Vel = null, difficulty = 'medium', interceptReturn = false }) {
  console.log(`--- Test: ${name} ---`);
  let simTime = 0;
  performance.now = () => simTime * 1000;

  const physics = new PhysicsWorld();
  const toasts = [];
  const scoreUpdates = [];
  let gameState = GAME_STATES.SERVE_WAIT;

  const scene = {
    triggerImpact: () => {},
    paddle1: { position: new THREE.Vector3(0, 0.95, -1.45), quaternion: new THREE.Quaternion() },
    paddle2: { position: new THREE.Vector3(0, 0.95, 1.45), quaternion: new THREE.Quaternion() },
    ball: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
  };

  const game = new TableTennisGame({
    scene,
    physics,
    multiplayer: { role: 'host', isConnected: false },
    onStateChange: (s) => { gameState = s; },
    onScoreUpdate: (s) => { scoreUpdates.push([...s]); },
    onActionToast: (t) => { toasts.push(t); },
  });

  game.setDifficulty(difficulty);
  game.server = server;
  game.state = GAME_STATES.SERVE_WAIT;

  // Execute serve
  game.serve(p1Pos, p1Vel);
  assert.strictEqual(game.state, GAME_STATES.RALLY, 'Game transitioned to RALLY');
  assert.strictEqual(game.isServiceInProgress, true, 'Service in progress initially');

  const dt = 1 / 60;
  let bounceServerCount = 0;
  let bounceReceiverCount = 0;
  let clearedNet = false;
  let completedIntoRally = false;

  const serverSide = server;
  const receiverSide = 3 - server;

  for (let i = 0; i < 180; i++) {
    simTime += dt;
    game.update(dt, {
      position: p1Pos || new THREE.Vector3(0, 0.95, -1.45),
      quaternion: new THREE.Quaternion(),
      velocity: p1Vel || new THREE.Vector3(0, 0, 0),
      yaw: 0,
      justOpenedHand: false,
    });

    const bPos = physics.ballBody.position;

    // Check net crossing
    if (server === 1 && bPos.z > -0.05 && bPos.z < 0.05) {
      if (bPos.y > TABLE_HEIGHT + NET_HEIGHT) {
        clearedNet = true;
      }
    } else if (server === 2 && bPos.z > -0.05 && bPos.z < 0.05) {
      if (bPos.y > TABLE_HEIGHT + NET_HEIGHT) {
        clearedNet = true;
      }
    }

    if (serverSide === 1) {
      if (game.bouncesP1 > bounceServerCount) bounceServerCount = game.bouncesP1;
      if (game.bouncesP2 > bounceReceiverCount) bounceReceiverCount = game.bouncesP2;
    } else {
      if (game.bouncesP2 > bounceServerCount) bounceServerCount = game.bouncesP2;
      if (game.bouncesP1 > bounceReceiverCount) bounceReceiverCount = game.bouncesP1;
    }

    if (!game.isServiceInProgress && bounceServerCount >= 1 && bounceReceiverCount >= 1) {
      completedIntoRally = true;
      if (!interceptReturn) {
        break;
      }
    }

    if (game.state !== GAME_STATES.RALLY) {
      break;
    }
  }

  assert.strictEqual(bounceServerCount >= 1, true, `Ball bounced at least once on server side (${bounceServerCount})`);
  assert.strictEqual(bounceReceiverCount >= 1, true, `Ball bounced on receiver side (${bounceReceiverCount})`);
  assert.strictEqual(clearedNet, true, 'Ball cleanly cleared over the net tape');
  assert.strictEqual(completedIntoRally, true, 'Serve completed into active rally without premature end or fault');
  console.log(`✓ PASS: ${name} (Server bounces: ${bounceServerCount}, Receiver bounces: ${bounceReceiverCount}, clearedNet: true, intoRally: true)\n`);
}

// 1. Player 1 Center Serve
runPhysicalServeTest({
  name: 'P1 Center Serve',
  server: 1,
  p1Pos: new THREE.Vector3(0, 0.95, -1.45),
  p1Vel: new THREE.Vector3(0, 0, 0.6),
});

// 2. Player 1 Wide Left Serve
runPhysicalServeTest({
  name: 'P1 Wide Left Serve',
  server: 1,
  p1Pos: new THREE.Vector3(-0.35, 0.95, -1.45),
  p1Vel: new THREE.Vector3(-0.3, 0, 0.8),
});

// 3. Player 1 Wide Right Serve
runPhysicalServeTest({
  name: 'P1 Wide Right Serve',
  server: 1,
  p1Pos: new THREE.Vector3(0.35, 0.95, -1.45),
  p1Vel: new THREE.Vector3(0.3, 0, 0.8),
});

// 4. CPU Easy Serve
runPhysicalServeTest({
  name: 'CPU Easy Serve',
  server: 2,
  difficulty: 'easy',
});

// 5. CPU Medium Serve
runPhysicalServeTest({
  name: 'CPU Medium Serve',
  server: 2,
  difficulty: 'medium',
});

// 6. CPU Hard Serve
runPhysicalServeTest({
  name: 'CPU Hard Serve',
  server: 2,
  difficulty: 'hard',
});

console.log('=== ALL TABLE TENNIS SERVE PHYSICAL INTEGRATION TESTS PASSED! ===');
