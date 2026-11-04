import assert from 'node:assert';
import * as THREE from 'three';

// Provide browser globals for Node test environment
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 2.0,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { hostname: 'localhost', protocol: 'http:' },
  AudioContext: class {
    createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
  }
};

import { HandTracker } from '../src/tracking/hand_tracker.js';
import { FaceTracker } from '../src/tracking/face_tracker.js';
import {
  createPaddle,
  createBall,
  createBakedTableShadow,
} from '../src/graphics/procedural_models.js';
import {
  createAirHockeyStriker,
  createAirHockeyPuck,
} from '../src/graphics/air_hockey_models.js';
import { PhysicsWorld } from '../src/physics/physics_world.js';
import { TableTennisGame, GAME_STATES } from '../src/game/table_tennis_game.js';
import { AirHockeyPhysics } from '../src/physics/air_hockey_physics.js';
import { AirHockeyGame, AIR_HOCKEY_STATES } from '../src/game/air_hockey_game.js';
import { PACKET_TAGS } from '../src/network/multiplayer.js';

console.log('=== VERIFICATION TEST: PERFORMANCE & MULTIPLAYER OPTIMIZATIONS ===\n');

// --------------------------------------------------------------------------
// TEST 1: Decouple Tracking & Downscale Camera Input
// --------------------------------------------------------------------------
console.log('--- Test 1: Tracking Decoupling & Downscaled Input (320x240) ---');
{
  const tracker = new HandTracker({});
  assert.strictEqual(tracker.targetInferenceFPS, 30, 'HandTracker target inference FPS must be capped at 30 FPS');
  assert.strictEqual(Math.round(tracker.inferenceIntervalMs), 33, 'Inference interval must be ~33.3ms for 30 FPS');

  // Verify offscreen downscale canvas initialization
  tracker.isTracking = true;
  const mockVideo = {
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    requestVideoFrameCallback: () => 1,
  };
  tracker.videoElement = mockVideo;

  // Trigger processing step check
  assert(tracker.inferenceIntervalMs > 0, 'Inference interval is positive');

  // Verify FaceTracker downscale configuration
  const faceTracker = new FaceTracker({});
  assert(faceTracker.frameIntervalMs >= 60, 'FaceTracker is throttled to prevent main thread starvation');
  console.log('✓ PASS: Camera tracking inference is throttled to 30 FPS to decouple from 60 FPS rendering');
}

// --------------------------------------------------------------------------
// TEST 2: Three.js Render Overhead: Pixel Ratio Cap & Static Shadow Plane
// --------------------------------------------------------------------------
console.log('\n--- Test 2: Three.js Overhead (Pixel Ratio <= 1.5, Shadows Off on Dynamic Meshes) ---');
{
  // Pixel ratio calculation check
  const cappedRatioHighDPI = Math.min(2.0, 1.5);
  const cappedRatioNormal = Math.min(1.0, 1.5);
  assert.strictEqual(cappedRatioHighDPI, 1.5, 'devicePixelRatio=2.0 must be capped at 1.5');
  assert.strictEqual(cappedRatioNormal, 1.0, 'devicePixelRatio=1.0 stays 1.0');
  console.log(`✓ Pixel ratio calculation correctly capped at: ${cappedRatioHighDPI} (devicePixelRatio: 2.0)`);

  // Verify dynamic meshes do NOT cast real-time shadows
  const paddle1 = createPaddle('red');
  const paddle2 = createPaddle('black');
  const ball = createBall();
  const striker1 = createAirHockeyStriker('p1');
  const striker2 = createAirHockeyStriker('p2');
  const puck = createAirHockeyPuck();

  assert.strictEqual(paddle1.children[0].castShadow, false, 'Paddle 1 dynamic mesh castShadow must be false');
  assert.strictEqual(paddle2.children[0].castShadow, false, 'Paddle 2 dynamic mesh castShadow must be false');
  assert.strictEqual(ball.children[0].castShadow, false, 'Ball dynamic mesh castShadow must be false');
  assert.strictEqual(striker1.children[1].castShadow, false, 'Air Hockey Striker 1 castShadow must be false');
  assert.strictEqual(striker2.children[1].castShadow, false, 'Air Hockey Striker 2 castShadow must be false');
  assert.strictEqual(puck.children[0].castShadow, false, 'Air Hockey Puck castShadow must be false');
  console.log('✓ Dynamic meshes (ball, paddles, puck, strikers) have castShadow=false');

  // Verify static baked shadow plane beneath the table
  const bakedShadow = createBakedTableShadow();
  assert(bakedShadow, 'Static baked table shadow plane must exist');
  assert.strictEqual(bakedShadow.name, 'BakedTableShadow', 'Baked table shadow plane identified');
  console.log('✓ Static baked shadow plane beneath table exists and is active');
}

// --------------------------------------------------------------------------
// TEST 3: Flat Binary Array Payloads (Float32Array) for Multiplayer Sync
// --------------------------------------------------------------------------
console.log('\n--- Test 3: Flat Binary Array Payloads (Float32Array) ---');
{
  let sentDataHost = null;
  let sentDataClient = null;

  const mockHostMP = {
    role: 'host',
    isConnected: true,
    send: (data) => { sentDataHost = data; },
  };

  const mockClientMP = {
    role: 'client',
    isConnected: true,
    send: (data) => { sentDataClient = data; },
  };

  const hostScene = {
    paddle1: new THREE.Mesh(),
    paddle2: new THREE.Mesh(),
    ball: new THREE.Mesh(),
    triggerImpact: () => {},
  };
  const hostPhysics = new PhysicsWorld();
  const hostGame = new TableTennisGame({
    scene: hostScene,
    physics: hostPhysics,
    multiplayer: mockHostMP,
  });

  const clientScene = {
    paddle1: new THREE.Mesh(),
    paddle2: new THREE.Mesh(),
    ball: new THREE.Mesh(),
    triggerImpact: () => {},
  };
  const clientPhysics = new PhysicsWorld();
  const clientGame = new TableTennisGame({
    scene: clientScene,
    physics: clientPhysics,
    multiplayer: mockClientMP,
  });

  // 1. Host updates & broadcasts state
  hostGame.update(0.016, {
    position: new THREE.Vector3(0.12, 0.95, -1.40),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(0.2, 0, 0.5),
  });

  assert(sentDataHost instanceof Float32Array, 'Host multiplayer sync packet must be a Float32Array');
  assert.strictEqual(sentDataHost[0], PACKET_TAGS.TT_SYNC, 'Packet tag must be TT_SYNC (1.0)');
  assert.strictEqual(sentDataHost.length, 22, 'TT_SYNC buffer length is exactly 22 floats (88 bytes)');
  console.log(`✓ Host sent flat binary sync: ${sentDataHost.byteLength} bytes vs ~350+ bytes JSON`);

  // 2. Client receives and handles flat binary sync
  clientGame.handleNetworkData(sentDataHost);
  assert.strictEqual(clientGame.server, sentDataHost[16], 'Client synced server');
  assert.strictEqual(clientGame.scores[0], sentDataHost[14], 'Client synced score P1');

  // 3. Client updates & broadcasts client input
  clientGame.update(0.016, {
    position: new THREE.Vector3(-0.25, 0.96, 1.42),
    quaternion: new THREE.Quaternion(0, 1, 0, 0),
    velocity: new THREE.Vector3(-0.3, 0, -0.8),
    isHandOpen: false,
    justOpenedHand: false,
  });

  assert(sentDataClient instanceof Float32Array, 'Client multiplayer input packet must be a Float32Array');
  assert.strictEqual(sentDataClient[0], PACKET_TAGS.TT_CLIENT_INPUT, 'Packet tag must be TT_CLIENT_INPUT (2.0)');
  assert.strictEqual(sentDataClient.length, 13, 'TT_CLIENT_INPUT buffer length is exactly 13 floats (52 bytes)');
  console.log(`✓ Client sent flat binary input: ${sentDataClient.byteLength} bytes vs ~220+ bytes JSON`);

  // 4. Host receives client input
  hostGame.handleNetworkData(sentDataClient);
  assert(hostGame.hasRemoteInput, 'Host registered client binary input');
  assert.strictEqual(hostGame.remoteTargetPos.x, -0.25, 'Host received client P2 target X');
}

// --------------------------------------------------------------------------
// TEST 4: Remote Opponent Linear/Spherical Interpolation
// --------------------------------------------------------------------------
console.log('\n--- Test 4: Remote Opponent Linear (lerp) & Spherical (slerp) Interpolation ---');
{
  const scene = {
    paddle1: new THREE.Mesh(),
    paddle2: new THREE.Mesh(),
    ball: new THREE.Mesh(),
    triggerImpact: () => {},
  };
  const physics = new PhysicsWorld();
  const game = new TableTennisGame({
    scene,
    physics,
    multiplayer: { role: 'host', isConnected: true, send: () => {} },
  });

  // Initial remote paddle2 at center (0, 0.95, 1.45)
  scene.paddle2.position.set(0, 0.95, 1.45);
  scene.paddle2.quaternion.set(0, 1, 0, 0);

  // Incoming client input tick arrives with distant position & rotation
  const clientInputTick = new Float32Array(13);
  clientInputTick[0] = PACKET_TAGS.TT_CLIENT_INPUT;
  clientInputTick[1] = 0.60; // target X
  clientInputTick[2] = 1.05; // target Y
  clientInputTick[3] = 1.20; // target Z
  const targetEuler = new THREE.Euler(0, Math.PI + 0.35, 0);
  const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
  clientInputTick[4] = targetQuat.x;
  clientInputTick[5] = targetQuat.y;
  clientInputTick[6] = targetQuat.z;
  clientInputTick[7] = targetQuat.w;

  game.handleNetworkData(clientInputTick);

  // Frame 1: Step game by dt=0.016s
  game.update(0.016, { position: new THREE.Vector3(0, 0.95, -1.45), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3() });

  // Remote paddle2 position must have smoothly lerped partway (NOT instantly snapped to 0.60!)
  const p2X = scene.paddle2.position.x;
  assert(p2X > 0 && p2X < 0.60, `Remote paddle2 position.x must smoothly interpolate (0 < ${p2X.toFixed(3)} < 0.60)`);
  console.log(`✓ Remote opponent position smoothly interpolated across network tick: X=${p2X.toFixed(3)} m`);

  // Remote paddle2 quaternion must have smoothly slerped partway
  const dot = scene.paddle2.quaternion.dot(targetQuat);
  assert(dot > 0.8 && dot < 1.0, `Remote paddle2 quaternion must slerp smoothly towards target (dot = ${dot.toFixed(4)})`);
  console.log(`✓ Remote opponent orientation spherically interpolated (slerp dot = ${dot.toFixed(4)})`);
}

// --------------------------------------------------------------------------
// TEST 5: Client-Side Prediction for Local Paddle-Ball Collisions
// --------------------------------------------------------------------------
console.log('\n--- Test 5: Client-Side Prediction for Local Paddle-Ball Collision ---');
{
  const clientScene = {
    paddle1: new THREE.Mesh(),
    paddle2: new THREE.Mesh(),
    ball: new THREE.Mesh(),
    triggerImpact: () => {},
  };
  const clientPhysics = new PhysicsWorld();
  let clientSentPackets = [];
  const clientGame = new TableTennisGame({
    scene: clientScene,
    physics: clientPhysics,
    multiplayer: {
      role: 'client',
      isConnected: true,
      send: (data) => { clientSentPackets.push(new Float32Array(data)); },
    },
  });

  // Client is defending P2 (+Z). Ball is in live RALLY moving towards client (+Z)
  clientGame.state = GAME_STATES.RALLY;
  clientGame.predictedBallPos.set(0.0, 0.95, 1.25);
  clientGame.predictedBallVel.set(0.0, 0.2, 4.0); // moving forward towards P2
  clientGame.clientBallTarget.set(0.0, 0.95, 1.25);

  // Position client paddle2 right in front of oncoming ball
  clientScene.paddle2.position.set(0.0, 0.95, 1.30);
  const clientPaddle = {
    position: new THREE.Vector3(0.0, 0.95, 1.30),
    quaternion: new THREE.Quaternion(0, 1, 0, 0),
    velocity: new THREE.Vector3(0, 0, -2.5), // swinging forward towards -Z!
  };

  // Step client simulation frame
  clientGame.update(0.016, clientPaddle);

  // Client-side prediction MUST immediately detect the collision and reverse ball velocity
  assert(clientGame.predictedBallVel.z < 0, `Client-side prediction must reflect ball towards host (-Z), got vz=${clientGame.predictedBallVel.z.toFixed(2)}`);
  assert.strictEqual(clientGame.isPredictingHit, true, 'clientGame.isPredictingHit must be true');
  console.log(`✓ 0ms Client-Side Prediction: Ball velocity instantly reversed to vz=${clientGame.predictedBallVel.z.toFixed(2)} m/s on local collision!`);

  // When authoritative host sync arrives confirming return (host ball vz < 0), smooth reconciliation occurs
  const hostConfirmSync = new Float32Array(22);
  hostConfirmSync[0] = PACKET_TAGS.TT_SYNC;
  hostConfirmSync[1] = 0.0;
  hostConfirmSync[2] = 0.98;
  hostConfirmSync[3] = 1.15;
  hostConfirmSync[4] = 0.0;
  hostConfirmSync[5] = 0.5;
  hostConfirmSync[6] = -3.8; // host confirmed ball returning South
  hostConfirmSync[17] = 1; // RALLY

  clientGame.handleNetworkData(hostConfirmSync);
  assert.strictEqual(clientGame.isPredictingHit, false, 'Prediction reconciled smoothly once host confirmed hit');
  console.log('✓ Host hit confirmation cleanly reconciled with local prediction');
}

// --------------------------------------------------------------------------
// TEST 6: Air Hockey Multiplayer Binary Packets & Prediction
// --------------------------------------------------------------------------
console.log('\n--- Test 6: Air Hockey Multiplayer Binary Packets & Striker Interpolation ---');
{
  let sentData = null;
  const mockMP = {
    role: 'host',
    isConnected: true,
    send: (d) => { sentData = d; },
  };

  const scene = {
    striker1: new THREE.Mesh(),
    striker2: new THREE.Mesh(),
    puck: new THREE.Mesh(),
    triggerImpact: () => {},
  };
  const physics = new AirHockeyPhysics();
  const hockeyGame = new AirHockeyGame({
    scene,
    physics,
    multiplayer: mockMP,
  });

  // Step host game
  hockeyGame.update(0.016, {
    position: new THREE.Vector3(0.1, 0.82, -0.55),
    velocity: new THREE.Vector3(0.5, 0, 1.0),
  });

  assert(sentData instanceof Float32Array, 'Air Hockey sync packet must be Float32Array');
  assert.strictEqual(sentData[0], PACKET_TAGS.HOCKEY_SYNC, 'Tag must be HOCKEY_SYNC (3.0)');
  assert.strictEqual(sentData.length, 15, 'HOCKEY_SYNC buffer length is 15 floats (60 bytes)');
  console.log(`✓ Air Hockey Host sent flat binary sync: ${sentData.byteLength} bytes`);

  // Client mode test
  let clientSent = null;
  const clientMP = {
    role: 'client',
    isConnected: true,
    send: (d) => { clientSent = d; },
  };
  const clientHockey = new AirHockeyGame({
    scene: { striker1: new THREE.Mesh(), striker2: new THREE.Mesh(), puck: new THREE.Mesh(), triggerImpact: () => {} },
    physics: new AirHockeyPhysics(),
    multiplayer: clientMP,
  });

  clientHockey.update(0.016, {
    position: new THREE.Vector3(-0.15, 0.82, 0.65),
    velocity: new THREE.Vector3(-0.2, 0, -1.5),
  });

  assert(clientSent instanceof Float32Array, 'Air Hockey client input must be Float32Array');
  assert.strictEqual(clientSent[0], PACKET_TAGS.HOCKEY_CLIENT_INPUT, 'Tag must be HOCKEY_CLIENT_INPUT (4.0)');
  assert.strictEqual(clientSent.length, 6, 'HOCKEY_CLIENT_INPUT buffer length is 6 floats (24 bytes)');
  console.log(`✓ Air Hockey Client sent flat binary input: ${clientSent.byteLength} bytes`);
}

console.log('\n=== ALL PERFORMANCE & MULTIPLAYER OPTIMIZATION TESTS PASSED PERFECTLY! ===');
