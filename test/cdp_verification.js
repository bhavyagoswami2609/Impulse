import assert from 'node:assert';

async function getPageWsUrl() {
  const res = await fetch('http://localhost:9222/json/list');
  const pages = await res.json();
  const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:3000'));
  if (!page) {
    throw new Error('Could not find localhost:3000 page in Chrome CDP');
  }
  return page.webSocketDebuggerUrl;
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.callbacks = new Map();
    this.events = [];
    this.consoleLogs = [];
    this.exceptions = [];

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (msg.method === 'Runtime.consoleAPICalled') {
          this.consoleLogs.push(msg.params);
        } else if (msg.method === 'Runtime.exceptionThrown') {
          this.exceptions.push(msg.params);
          console.error('[Browser Exception]:', JSON.stringify(msg.params));
        }
      }
    };
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${res.exceptionDetails.text} (${JSON.stringify(res.exceptionDetails)})`);
    }
    return res.result ? res.result.value : undefined;
  }

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await new Promise((r) => setTimeout(r, 50));
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  async key(key, code) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: 32,
    });
    await new Promise((r) => setTimeout(r, 50));
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
    });
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('--- Connecting to Headless Chrome via CDP ---');
  const wsUrl = await getPageWsUrl();
  const cdp = new CDPClient(wsUrl);
  await cdp.ready;

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  console.log('CDP connected to page.');

  // Check window.app presence
  const appStatus = await cdp.eval(`(() => {
    return {
      hasApp: Boolean(window.app),
      gameMode: window.app?.gameMode,
      isMenuOpen: window.app?.isMenuOpen,
      hasScene: Boolean(window.app?.scene),
      hasPhysics: Boolean(window.app?.physics),
      hasHockeyPhysics: Boolean(window.app?.hockeyPhysics),
      hasGame: Boolean(window.app?.game),
      hasHockeyGame: Boolean(window.app?.hockeyGame),
    };
  })()`);
  console.log('App Status in browser:', appStatus);
  assert.strictEqual(appStatus.hasApp, true, 'window.app must exist');
  assert.strictEqual(appStatus.hasScene, true, 'window.app.scene must exist');

  // Verify Table Tennis Court Models & Boundaries in Three.js
  console.log('\n--- 1. Verifying Table Tennis Court Models in Three.js ---');
  const ttMeshCheck = await cdp.eval(`(() => {
    const s = window.app.scene;
    const table = s.table;
    const paddle1 = s.paddle1;
    const paddle2 = s.paddle2;
    const ball = s.ball;
    const netMesh = table.children.find(c => c.type === 'Mesh' && c.material?.map);
    const legs = table.children.filter(c => c.geometry?.type === 'BoxGeometry' && c.position.y < 0.5);

    return {
      tablePresent: Boolean(table),
      tableVisible: table.visible,
      paddle1Present: Boolean(paddle1),
      paddle1Visible: paddle1.visible,
      paddle2Present: Boolean(paddle2),
      paddle2Visible: paddle2.visible,
      ballPresent: Boolean(ball),
      ballVisible: ball.visible,
      arenaPresent: Boolean(s.arena),
      landingRingPresent: Boolean(s.landingRing),
      dropLinePresent: Boolean(s.dropLine),
      trailLinePresent: Boolean(s.trailLine),
      tableChildrenCount: table.children.length,
      legsCount: legs.length,
      views: Object.keys(s.views),
    };
  })()`);
  console.log('Table Tennis Mesh Check:', ttMeshCheck);
  assert.strictEqual(ttMeshCheck.tablePresent, true);
  assert.strictEqual(ttMeshCheck.paddle1Present, true);
  assert.strictEqual(ttMeshCheck.paddle2Present, true);
  assert.strictEqual(ttMeshCheck.ballPresent, true);
  assert.strictEqual(ttMeshCheck.arenaPresent, true);
  assert.strictEqual(ttMeshCheck.landingRingPresent, true);
  assert.strictEqual(ttMeshCheck.dropLinePresent, true);
  assert.strictEqual(ttMeshCheck.trailLinePresent, true);

  // Verify Air Hockey Court Models in Three.js
  console.log('\n--- 2. Verifying Air Hockey Court Models in Three.js ---');
  const hockeyMeshCheck = await cdp.eval(`(() => {
    const s = window.app.scene;
    const ht = s.hockeyTable;
    const st1 = s.striker1;
    const st2 = s.striker2;
    const puck = s.puck;
    return {
      hockeyTablePresent: Boolean(ht),
      striker1Present: Boolean(st1),
      striker2Present: Boolean(st2),
      puckPresent: Boolean(puck),
      puckTrailPresent: Boolean(s.puckTrailLine),
      puckShadowPresent: Boolean(s.puckShadow),
      hockeyTableChildren: ht.children.length,
      striker1Children: st1.children.length,
      striker2Children: st2.children.length,
      puckChildren: puck.children.length,
    };
  })()`);
  console.log('Air Hockey Mesh Check:', hockeyMeshCheck);
  assert.strictEqual(hockeyMeshCheck.hockeyTablePresent, true);
  assert.strictEqual(hockeyMeshCheck.striker1Present, true);
  assert.strictEqual(hockeyMeshCheck.striker2Present, true);
  assert.strictEqual(hockeyMeshCheck.puckPresent, true);
  assert.strictEqual(hockeyMeshCheck.puckTrailPresent, true);
  assert.strictEqual(hockeyMeshCheck.puckShadowPresent, true);

  // Test Sport Switching
  console.log('\n--- 3. Testing Sport Switching & Visibility Toggle ---');
  await cdp.eval(`window.app.setGameMode('hockey')`);
  const modeIsHockey = await cdp.eval(`(() => {
    const s = window.app.scene;
    return {
      mode: window.app.gameMode,
      ttVisible: s.table.visible,
      p1Visible: s.paddle1.visible,
      ballVisible: s.ball.visible,
      htVisible: s.hockeyTable.visible,
      st1Visible: s.striker1.visible,
      st2Visible: s.striker2.visible,
      puckVisible: s.puck.visible,
      puckShadowVisible: s.puckShadow.visible,
      puckTrailVisible: s.puckTrailLine.visible,
    };
  })()`);
  console.log('Switched to Hockey:', modeIsHockey);
  assert.strictEqual(modeIsHockey.mode, 'hockey');
  assert.strictEqual(modeIsHockey.ttVisible, false, 'TT table should be hidden in hockey mode');
  assert.strictEqual(modeIsHockey.htVisible, true, 'Air Hockey table should be visible');
  assert.strictEqual(modeIsHockey.st1Visible, true, 'Striker 1 should be visible');
  assert.strictEqual(modeIsHockey.st2Visible, true, 'Striker 2 should be visible');
  assert.strictEqual(modeIsHockey.puckVisible, true, 'Puck should be visible');

  await cdp.eval(`window.app.setGameMode('tennis')`);
  const modeIsTennis = await cdp.eval(`(() => {
    const s = window.app.scene;
    return {
      mode: window.app.gameMode,
      ttVisible: s.table.visible,
      htVisible: s.hockeyTable.visible,
    };
  })()`);
  console.log('Switched back to Tennis:', modeIsTennis);
  assert.strictEqual(modeIsTennis.mode, 'tennis');
  assert.strictEqual(modeIsTennis.ttVisible, true);
  assert.strictEqual(modeIsTennis.htVisible, false);

  // Test Start Menu UI, Audio Toggle, Webcam Toggle, Calibration
  console.log('\n--- 4. Testing Start Menu, Audio, Webcam, Calibration & Dismissing ---');

  // Verify initial menu is open
  const menuIsOpenInitial = await cdp.eval(`window.app.isMenuOpen`);
  assert.strictEqual(menuIsOpenInitial, true, 'Menu starts open on launch');

  // Toggle Audio via Menu
  const audioBefore = await cdp.eval(`(() => {
    const btn = document.getElementById('menu-btn-sound-toggle');
    btn.click();
    return {
      audioOn: window.app.syncMenuUI ? document.getElementById('menu-sound-status-text').textContent : null,
      soundEnabled: window.app.toggleSound ? null : null
    };
  })()`);
  console.log('Audio Toggled via menu:', audioBefore);

  // Toggle Audio via HUD
  const audioHud = await cdp.eval(`(() => {
    const btn = document.getElementById('btn-toggle-sound');
    btn.click();
    return document.getElementById('sound-icon').textContent;
  })()`);
  console.log('Audio HUD icon text:', audioHud);

  // Toggle Webcam via Menu
  const webcamToggled = await cdp.eval(`(() => {
    const btn = document.getElementById('menu-btn-cam-toggle');
    btn.click();
    return document.getElementById('menu-cam-status-text').textContent;
  })()`);
  console.log('Webcam Toggled via menu:', webcamToggled);

  // Test Calibration dialog open
  const calibOpen = await cdp.eval(`(async () => {
    await window.app.handleCalibrate();
    const modal = document.getElementById('calibration-modal');
    return {
      modalHasOpenClass: modal.classList.contains('open'),
      directionBadge: document.getElementById('calib-live-direction').textContent,
    };
  })()`);
  console.log('Calibration Modal Open:', calibOpen);
  assert.strictEqual(calibOpen.modalHasOpenClass, true);

  // Close calibration dialog
  await cdp.eval(`(() => {
    const closeBtn = document.getElementById('modal-calib-close');
    closeBtn.click();
  })()`);

  // Open Main Menu again
  await cdp.eval(`window.app.openMainMenu()`);
  const menuReopened = await cdp.eval(`window.app.isMenuOpen && document.getElementById('main-menu-modal').classList.contains('open')`);
  assert.strictEqual(menuReopened, true);

  // Test dismissing menu by clicking backdrop (outside .modal-card)
  const backdropDismiss = await cdp.eval(`(() => {
    const modal = document.getElementById('main-menu-modal');
    // Simulate click on backdrop outside .modal-card
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    modal.dispatchEvent(event);
    return {
      isMenuOpen: window.app.isMenuOpen,
      modalClass: modal.className,
    };
  })()`);
  console.log('Backdrop Dismiss Result:', backdropDismiss);
  assert.strictEqual(backdropDismiss.isMenuOpen, false, 'Menu should close when backdrop is clicked');

  // Test Table Tennis Gameplay: Serve, Bounce, AI Rally
  console.log('\n--- 5. Testing Table Tennis Gameplay (Serve, Bounce, AI Rally) ---');
  await cdp.eval(`window.app.setGameMode('tennis')`);
  await cdp.eval(`window.app.game.resetBall()`);

  // Execute P1 Serve
  const serveRes = await cdp.eval(`(() => {
    window.app.game.serve(new THREE.Vector3(0, 0.95, -1.35), new THREE.Vector3(0, 0.2, 1.5));
    const ballBody = window.app.physics.ballBody;
    return {
      state: window.app.game.state,
      isInRally: window.app.physics.isInRally,
      ballVelZ: ballBody.velocity.z,
      ballPosZ: ballBody.position.z,
    };
  })()`);
  console.log('Table Tennis Serve Executed:', serveRes);
  assert.strictEqual(serveRes.state, 'RALLY');
  assert.strictEqual(serveRes.isInRally, true);
  assert(serveRes.ballVelZ > 2.0, 'Ball velocity Z should be positive towards opponent');

  // Let simulation step for 2 seconds (120 frames) and observe AI interception and return!
  console.log('Simulating 120 frames of Table Tennis rally...');
  const rallySim = await cdp.eval(`(async () => {
    const hits = [];
    const bounces = [];
    const origHit = window.app.physics.callbacks.onBallHitPaddle;
    const origBounce = window.app.physics.callbacks.onBallBounceTable;

    window.app.physics.callbacks.onBallHitPaddle = (player, speed) => {
      hits.push({ player, speed });
      origHit(player, speed);
    };
    window.app.physics.callbacks.onBallBounceTable = (pos, side) => {
      bounces.push({ x: pos.x, y: pos.y, z: pos.z, side });
      origBounce(pos, side);
    };

    // Step through 2.0s of physical simulation
    const dt = 1 / 60;
    for (let i = 0; i < 150; i++) {
      window.app.game.update(dt, {
        position: new THREE.Vector3(0, 0.95, -1.45),
        quaternion: new THREE.Quaternion(),
        velocity: new THREE.Vector3(0, 0, 0.5),
        yaw: 0,
        justOpenedHand: false,
      });
      window.app.scene.update(dt);
      if (hits.length >= 2) break;
    }

    return {
      hits,
      bounces,
      finalBallPos: {
        x: window.app.physics.ballBody.position.x,
        y: window.app.physics.ballBody.position.y,
        z: window.app.physics.ballBody.position.z,
      },
      p2PaddlePos: {
        x: window.app.scene.paddle2.position.x,
        y: window.app.scene.paddle2.position.y,
        z: window.app.scene.paddle2.position.z,
      },
      rallyLength: window.app.game.rallyLength,
    };
  })()`);
  console.log('Table Tennis Rally Simulation Result:', rallySim);
  assert(rallySim.bounces.length > 0, 'Ball must bounce on table during rally');
  assert(rallySim.hits.length > 0, 'Paddle hit callbacks fired');

  // Test Air Hockey Gameplay: Serve, Bank Shot, CPU AI Defend / Attack, Goal Detection
  console.log('\n--- 6. Testing Air Hockey Gameplay (Serve, Puck Bounce, AI, Goal) ---');
  await cdp.eval(`window.app.setGameMode('hockey')`);
  await cdp.eval(`window.app.hockeyGame.resetPuckForServe(1)`);

  const hockeyServeRes = await cdp.eval(`(() => {
    window.app.hockeyGame.serve();
    const pState = window.app.hockeyPhysics.getPuckState();
    return {
      state: window.app.hockeyGame.state,
      puckSpeed: pState.speed,
      puckVelZ: pState.velocity.z,
      puckPosZ: pState.position.z,
    };
  })()`);
  console.log('Air Hockey Serve Executed:', hockeyServeRes);
  assert.strictEqual(hockeyServeRes.state, 'ACTIVE_PLAY');
  assert(hockeyServeRes.puckSpeed > 3.0, 'Puck speed must be > 3 m/s on serve');
  assert(hockeyServeRes.puckVelZ > 0, 'Puck should travel towards P2');

  // Simulate Air Hockey rally for 120 frames
  console.log('Simulating 120 frames of Air Hockey active play...');
  const hockeySim = await cdp.eval(`(async () => {
    const wallHits = [];
    const strikerHits = [];
    const origWall = window.app.hockeyPhysics.onPuckHitWall;
    const origStriker = window.app.hockeyPhysics.onPuckHitStriker;

    window.app.hockeyPhysics.onPuckHitWall = (pt, norm, spd) => {
      wallHits.push({ pt, norm, spd });
      if (origWall) origWall(pt, norm, spd);
    };
    window.app.hockeyPhysics.onPuckHitStriker = (id, spd, ang) => {
      strikerHits.push({ id, spd, ang });
      if (origStriker) origStriker(id, spd, ang);
    };

    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) {
      window.app.hockeyGame.update(dt, {
        position: new THREE.Vector3(0, 0.82, -0.65),
        velocity: new THREE.Vector3(0, 0, 0),
      });
      window.app.scene.update(dt);
      if (window.app.hockeyGame.state === 'GOAL_SCORED') break;
    }

    return {
      wallHitsCount: wallHits.length,
      strikerHitsCount: strikerHits.length,
      finalPuckState: window.app.hockeyPhysics.getPuckState(),
      p2Pos: {
        x: window.app.hockeyGame.p2Pos.x,
        z: window.app.hockeyGame.p2Pos.z,
      },
      scores: window.app.hockeyGame.scores,
    };
  })()`);
  console.log('Air Hockey Simulation Result:', hockeySim);
  assert(hockeySim.wallHitsCount > 0 || hockeySim.strikerHitsCount > 0, 'Puck should interact with walls or strikers');

  // Test Goal Scored Detection and Reset
  console.log('\n--- 7. Testing Goal Scored Detection and Score Update ---');
  const goalTest = await cdp.eval(`(() => {
    // Force puck into P2 goal pocket (|X| < 0.17, Z > 1.07)
    window.app.hockeyPhysics.setPuckPosition(0, 1.06);
    window.app.hockeyPhysics.setPuckVelocity(0, 4.0);
    window.app.hockeyGame.update(0.02, { position: new THREE.Vector3(0, 0.82, -0.65) });
    return {
      isGoalScored: window.app.hockeyPhysics.isGoalScored,
      scores: window.app.hockeyGame.scores,
      state: window.app.hockeyGame.state,
      nextServer: window.app.hockeyGame.server,
    };
  })()`);
  console.log('Goal Detection Test:', goalTest);
  assert.strictEqual(goalTest.isGoalScored, true, 'Puck in goal mouth must trigger goal');
  assert.strictEqual(goalTest.state, 'GOAL_SCORED', 'Game state must transition to GOAL_SCORED');
  assert.strictEqual(goalTest.scores[0], 1, 'Player 1 score should increment');
  assert.strictEqual(goalTest.nextServer, 2, 'CPU should serve next after being scored on');

  // Verify Zero Uncaught Exceptions
  console.log('\n--- 8. Verifying Zero Uncaught Browser Exceptions ---');
  console.log('CDP caught exceptions count:', cdp.exceptions.length);
  if (cdp.exceptions.length > 0) {
    console.error('Exceptions found:', cdp.exceptions);
  }
  assert.strictEqual(cdp.exceptions.length, 0, 'There must be zero uncaught exceptions in browser');

  console.log('\n========================================');
  console.log('ALL VERIFICATION INSPECTIONS PASSED 100%');
  console.log('========================================');

  cdp.close();
}

run().catch((err) => {
  console.error('[FATAL ERROR IN VERIFICATION]:', err);
  process.exit(1);
});
