import assert from 'node:assert';
import * as THREE from 'three';

// Provide browser globals for Node test environment
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 2.0,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { hostname: 'localhost', protocol: 'http:', search: '' },
  scrollTo: () => {},
  navigator: {
    clipboard: {
      writeText: async () => {},
    },
  },
  AudioContext: class {
    createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
  }
};

class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...cls) { cls.forEach(c => this._classes.add(c)); }
  remove(...cls) { cls.forEach(c => this._classes.delete(c)); }
  toggle(c, force) {
    if (force !== undefined) {
      if (force) this._classes.add(c); else this._classes.delete(c);
      return force;
    }
    if (this._classes.has(c)) { this._classes.delete(c); return false; }
    this._classes.add(c); return true;
  }
  contains(c) { return this._classes.has(c); }
  has(c) { return this._classes.has(c); }
}

class MockElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this.style = {};
    this.classList = new MockClassList();
    this.textContent = '';
    this.value = '';
    this.attributes = {};
    this.listeners = {};
    this.disabled = false;
  }
  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  dispatch(event, ...args) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(fn => fn(...args));
    }
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  querySelector(sel) {
    return new MockElement('inner');
  }
}

// Add DOM mock to globalThis
globalThis.document = {
  elements: {},
  getElementById(id) {
    if (!this.elements[id]) {
      this.elements[id] = new MockElement(id);
    }
    return this.elements[id];
  },
  querySelector(sel) {
    return new MockElement(sel);
  },
  querySelectorAll() { return []; },
  body: {
    classList: new MockClassList(),
  },
};

import { MultiplayerManager, PACKET_TYPES, CONTROL_ACTIONS } from '../src/network/multiplayer.js';
import { StateController, APP_STATES } from '../src/ui/state_controller.js';
import { TableTennisGame, GAME_STATES } from '../src/game/table_tennis_game.js';
import { AirHockeyGame, AIR_HOCKEY_STATES } from '../src/game/air_hockey_game.js';
import { PhysicsWorld } from '../src/physics/physics_world.js';
import { AirHockeyPhysics } from '../src/physics/air_hockey_physics.js';

console.log('=== MULTIPLAYER PARTY LOBBY & SIMULTANEOUS SYNC VERIFICATION ===\n');

// --------------------------------------------------------------------------
// TEST 1: Binary Control Actions & Packet Encodings
// --------------------------------------------------------------------------
console.log('--- Test 1: Binary Control Actions & DataChannel Packet Encodings ---');
{
  assert.strictEqual(PACKET_TYPES.CONTROL, 9.0, 'PACKET_TYPES.CONTROL must equal 9.0');
  assert.strictEqual(CONTROL_ACTIONS.PARTY_JOINED, 1.0, 'PARTY_JOINED must equal 1.0');
  assert.strictEqual(CONTROL_ACTIONS.PARTY_ACK, 2.0, 'PARTY_ACK must equal 2.0');
  assert.strictEqual(CONTROL_ACTIONS.START_MATCH, 3.0, 'START_MATCH must equal 3.0');
  assert.strictEqual(CONTROL_ACTIONS.DISCIPLINE_SYNC, 4.0, 'DISCIPLINE_SYNC must equal 4.0');
  assert.strictEqual(CONTROL_ACTIONS.LEAVE_PARTY, 5.0, 'LEAVE_PARTY must equal 5.0');

  const mp = new MultiplayerManager({});
  assert.strictEqual(typeof MultiplayerManager.generateRoomId, 'function');
  const code = MultiplayerManager.generateRoomId();
  assert.strictEqual(code.length, 5, 'Room code must be exactly 5 letters');
  assert(/^[A-Z]{5}$/.test(code), 'Room code must consist of uppercase alphabetic letters');

  // Verify sendControl generates 32-byte Float32Array packet
  let sentBuffer = null;
  mp.connection = {
    open: true,
    send: (buf) => { sentBuffer = buf; },
  };
  mp.sendControl(CONTROL_ACTIONS.START_MATCH, 2.0); // 2.0 = Air Hockey
  assert(sentBuffer instanceof ArrayBuffer, 'Sent payload must be ArrayBuffer');
  const decoded = new Float32Array(sentBuffer);
  assert.strictEqual(decoded[0], 9.0, 'Packet tag must be 9.0 (CONTROL)');
  assert.strictEqual(decoded[1], 3.0, 'Action must be 3.0 (START_MATCH)');
  assert.strictEqual(decoded[2], 2.0, 'Param1 must be 2.0 (Hockey)');
  console.log('✓ PASS: Binary control packet encoded and transmitted correctly');
}

// --------------------------------------------------------------------------
// TEST 2: Host Room Creation -> Party Lobby UI -> Locked Start Button
// --------------------------------------------------------------------------
console.log('\n--- Test 2: Host Room Creation & Start Button Lock State ---');
{
  const mockApp = {
    multiplayer: new MultiplayerManager({}),
    scene: { setOrbit: () => {}, setViewMode: () => {}, setGameMode: () => {} },
    tracker: { setPlayerRole: () => {}, isTracking: false },
    game: { restartMatch: () => {} },
    hockeyGame: { restartMatch: () => {} },
    setBotDifficulty: () => {},
    setGameMode: () => {},
  };

  const sc = new StateController(mockApp);
  assert.strictEqual(sc.btnStartMatch.disabled, false, 'In solo mode, Start Match button is initially enabled');
  assert.strictEqual(sc.btnStartMatchText.textContent, 'Start Match');

  // Switch to Online mode before room is created
  sc.setMatchMode('online');
  assert.strictEqual(sc.btnStartMatch.disabled, true, 'Online mode with no room must lock Start Match');
  assert.strictEqual(sc.btnStartMatchText.textContent, 'Create or Join Room');

  // Host creates room
  mockApp.multiplayer.roomId = 'ABCDE';
  mockApp.multiplayer.role = 'host';
  mockApp.multiplayer.isPartyReady = false;
  sc.updatePartyLobbyUI('ABCDE', 'host');

  assert.strictEqual(sc.partyLobbyCard.style.display, 'block', 'Party lobby card must be visible');
  assert.strictEqual(sc.onlineSplitRow.style.display, 'none', 'Split row must be hidden');
  assert.strictEqual(sc.partyRoomCodeVal.textContent, 'ABCDE', 'Room code value must match');
  assert.strictEqual(sc.partyP1Name.textContent, 'Host (You)');
  assert.strictEqual(sc.partyP1Role.textContent, 'Room Leader');
  assert.strictEqual(sc.partyP2Name.textContent, 'Waiting for opponent...');
  assert.strictEqual(sc.partyP2StatusText.textContent, 'Standby');
  assert.strictEqual(sc.partyStatusPillText.textContent, 'Waiting for Player 2...');

  // Crucial check: Host cannot start match until player 2 joins
  assert.strictEqual(sc.btnStartMatch.disabled, true, 'Start button must be locked for Host until Player 2 joins');
  assert.strictEqual(sc.btnStartMatchText.textContent, 'Waiting for Player 2 to Join...');
  console.log('✓ PASS: Host lobby initializes properly and Start Match button is locked while waiting for opponent');
}

// --------------------------------------------------------------------------
// TEST 3: Guest (Client) Joins Room -> Party Lobby -> Strict Lock on Guest Controls
// --------------------------------------------------------------------------
console.log('\n--- Test 3: Guest (Client) Joins Room & Strict Client Lock ---');
{
  const mockApp = {
    multiplayer: new MultiplayerManager({}),
    scene: { setOrbit: () => {}, setViewMode: () => {}, setGameMode: () => {} },
    tracker: { setPlayerRole: () => {}, isTracking: false },
    game: { restartMatch: () => {} },
    hockeyGame: { restartMatch: () => {} },
    setBotDifficulty: () => {},
    setGameMode: () => {},
  };

  const sc = new StateController(mockApp);
  sc.setMatchMode('online');

  mockApp.multiplayer.roomId = 'ABCDE';
  mockApp.multiplayer.role = 'client';
  mockApp.multiplayer.isPartyReady = false;
  sc.updatePartyLobbyUI('ABCDE', 'client');

  assert.strictEqual(sc.partyLobbyCard.style.display, 'block');
  assert.strictEqual(sc.partyP1Name.textContent, 'Host');
  assert.strictEqual(sc.partyP2Name.textContent, 'You (Guest)');
  assert.strictEqual(sc.partyP2StatusText.textContent, 'Connecting...');
  assert.strictEqual(sc.btnStartMatch.disabled, true);
  assert.strictEqual(sc.btnStartMatchText.textContent, 'Connecting to Room...');

  // Now connection establishes and party is marked ready
  mockApp.multiplayer.isPartyReady = true;
  sc.onPartyPlayerLoaded('client');

  assert.strictEqual(sc.partyStatusPillText.textContent, 'Party Ready (2/2 Players Loaded)');
  assert.strictEqual(sc.partyP2StatusText.textContent, 'Player Loaded!');

  // CRITICAL REQUIREMENT: "the person who put the code cannot do anything they cannot start the match on their own"
  assert.strictEqual(sc.btnStartMatch.disabled, true, 'Client Start Match button MUST REMAIN DISABLED');
  assert.strictEqual(sc.btnStartMatchText.textContent, 'Waiting for Host to Start...');
  assert(sc.btnStartMatch.classList.has('client-waiting'), 'Client button must have client-waiting indicator');
  console.log('✓ PASS: Guest cannot start match on their own; button remains strictly disabled with "Waiting for Host to Start..."');
}

// --------------------------------------------------------------------------
// TEST 4: Host State when Player 2 Loads -> Glowing Ready & Unlocked Start
// --------------------------------------------------------------------------
console.log('\n--- Test 4: Host Unlocks When Player 2 Loads ---');
{
  const mockApp = {
    multiplayer: new MultiplayerManager({}),
    scene: { setOrbit: () => {}, setViewMode: () => {}, setGameMode: () => {} },
    tracker: { setPlayerRole: () => {}, isTracking: false },
    game: { restartMatch: () => {} },
    hockeyGame: { restartMatch: () => {} },
    setBotDifficulty: () => {},
    setGameMode: () => {},
  };

  const sc = new StateController(mockApp);
  sc.setMatchMode('online');
  mockApp.multiplayer.roomId = 'ABCDE';
  mockApp.multiplayer.role = 'host';
  mockApp.multiplayer.isPartyReady = false;
  sc.updatePartyLobbyUI('ABCDE', 'host');

  // Player 2 connects!
  mockApp.multiplayer.isPartyReady = true;
  sc.onPartyPlayerLoaded('host');

  assert.strictEqual(sc.partyP2Name.textContent, 'Player 2');
  assert.strictEqual(sc.partyP2StatusText.textContent, 'Player Loaded!');
  assert.strictEqual(sc.partyStatusPillText.textContent, 'Party Ready (2/2 Players Loaded)');

  // Host button is now UNLOCKED with ready glow
  assert.strictEqual(sc.btnStartMatch.disabled, false, 'Host Start Match button unlocks when Player 2 loads');
  assert.strictEqual(sc.btnStartMatchText.textContent, 'Start Match (Player 2 Ready)');
  assert(sc.btnStartMatch.classList.has('party-ready'), 'Host button must have party-ready glow class');
  console.log('✓ PASS: Host Start Match button is unlocked with "Start Match (Player 2 Ready)"');
}

// --------------------------------------------------------------------------
// TEST 5: Simultaneous Launch: Host starts -> Sends START_MATCH -> Client starts
// --------------------------------------------------------------------------
console.log('\n--- Test 5: Simultaneous Match Launch Protocol ---');
{
  let hostSentPacket = null;
  const hostApp = {
    multiplayer: new MultiplayerManager({}),
    scene: { setOrbit: () => {}, setViewMode: () => {}, setGameMode: () => {} },
    tracker: { setPlayerRole: () => {}, isTracking: false },
    game: { restartMatch: () => {} },
    hockeyGame: { restartMatch: () => {} },
    gameMode: 'hockey',
    currentCameraView: 'host',
    setGameMode: () => {},
    setBotDifficulty: () => {},
  };
  hostApp.stateController = new StateController(hostApp);
  hostApp.stateController.setMatchMode('online');
  hostApp.multiplayer.isConnected = true;
  hostApp.multiplayer.isPartyReady = true;
  hostApp.multiplayer.role = 'host';
  hostApp.multiplayer.roomId = 'GOLDR';
  hostApp.multiplayer.connection = {
    open: true,
    send: (buf) => { hostSentPacket = new Float32Array(buf); },
  };

  const clientApp = {
    multiplayer: new MultiplayerManager({}),
    scene: { setOrbit: () => {}, setViewMode: () => {}, setGameMode: () => {} },
    tracker: { setPlayerRole: () => {}, isTracking: false },
    game: { restartMatch: () => {} },
    hockeyGame: { restartMatch: () => {} },
    gameMode: 'hockey',
    currentCameraView: 'client',
    setGameMode: (m) => { clientApp.gameMode = m; },
    setBotDifficulty: () => {},
  };
  clientApp.stateController = new StateController(clientApp);
  clientApp.stateController.setMatchMode('online');
  clientApp.multiplayer.isConnected = true;
  clientApp.multiplayer.isPartyReady = true;
  clientApp.multiplayer.role = 'client';
  clientApp.multiplayer.roomId = 'GOLDR';

  // Define startOnlineMatchAsHost logic on hostApp
  hostApp.startOnlineMatchAsHost = function() {
    const discCode = this.gameMode === 'tennis' ? 1.0 : 2.0;
    this.multiplayer.sendControl(CONTROL_ACTIONS.START_MATCH, discCode);
    this.stateController.startMatch();
  };

  // Define handleControlPacket logic on clientApp
  clientApp.handleControlPacket = function(packet) {
    const action = packet[1];
    const param1 = packet[2];
    if (action === CONTROL_ACTIONS.START_MATCH) {
      const disc = param1 === 1.0 ? 'tennis' : 'hockey';
      this.setGameMode(disc);
      this.stateController.startMatchAsClient();
    }
  };

  // Host clicks Start Match
  hostApp.startOnlineMatchAsHost();

  assert(hostSentPacket, 'Host must send START_MATCH control packet');
  assert.strictEqual(hostSentPacket[0], 9.0, 'Packet tag is CONTROL (9.0)');
  assert.strictEqual(hostSentPacket[1], 3.0, 'Action is START_MATCH (3.0)');
  assert.strictEqual(hostSentPacket[2], 2.0, 'Discipline param is Hockey (2.0)');
  assert.strictEqual(hostApp.stateController.state, APP_STATES.PLAYING, 'Host transitions to PLAYING state');

  // Client receives packet over WebRTC DataChannel
  clientApp.handleControlPacket(hostSentPacket);

  assert.strictEqual(clientApp.stateController.state, APP_STATES.PLAYING, 'Client transitions to PLAYING state simultaneously');
  assert.strictEqual(clientApp.gameMode, 'hockey', 'Client discipline matches host');
  console.log('✓ PASS: Host match start synchronizes with client simultaneously without desync');
}

// --------------------------------------------------------------------------
// TEST 6: Prevent CPU Bot Takeover During Multiplayer
// --------------------------------------------------------------------------
console.log('\n--- Test 6: Verify CPU Bot is Strictly Disabled in Multiplayer ---');
{
  const mockScene = {
    paddle1: new THREE.Mesh(),
    paddle2: new THREE.Mesh(),
    ball: new THREE.Mesh(),
    striker1: new THREE.Mesh(),
    striker2: new THREE.Mesh(),
    puck: new THREE.Mesh(),
  };

  const physicsWorld = new PhysicsWorld();
  const hockeyPhysics = new AirHockeyPhysics();

  const ttMultiplayer = new MultiplayerManager({});
  ttMultiplayer.isConnected = true; // Connected online!
  ttMultiplayer.role = 'host';

  const ttGame = new TableTennisGame({
    scene: mockScene,
    physics: physicsWorld,
    multiplayer: ttMultiplayer,
  });

  // Verify updateAI returns immediately when multiplayer is connected
  ttGame.aiCurrentPos.set(0, 0, 1.3);
  const initialPos = ttGame.aiCurrentPos.clone();
  ttGame.updateAI(0.016);
  assert.deepStrictEqual(ttGame.aiCurrentPos, initialPos, 'TT CPU AI must not update when connected online');

  const hockeyMultiplayer = new MultiplayerManager({});
  hockeyMultiplayer.isConnected = true;
  hockeyMultiplayer.role = 'host';

  const hockeyGame = new AirHockeyGame({
    scene: mockScene,
    physics: hockeyPhysics,
    multiplayer: hockeyMultiplayer,
  });

  hockeyGame.p2Pos.set(0, 0, 0.4);
  const hockeyInitialPos = hockeyGame.p2Pos.clone();
  hockeyGame.updateAI(0.016);
  assert.deepStrictEqual(hockeyGame.p2Pos, hockeyInitialPos, 'Air Hockey CPU AI must not update when connected online');

  console.log('✓ PASS: CPU Bot logic is strictly bypassed in both disciplines during online multiplayer');
}

console.log('\n============================================================');
console.log('ALL MULTIPLAYER PARTY LOBBY & SYNC TESTS PASSED SUCCESSFULLY');
console.log('============================================================');
