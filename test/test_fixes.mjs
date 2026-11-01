import { spawn } from 'node:child_process';
import assert from 'node:assert';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9224;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.callbacks = new Map();
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
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(msg.params);
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
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    this.ws.close();
  }
}

async function runTest() {
  console.log('--- Launching Chrome Headless for Physics & Corner Verification ---');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--user-data-dir=/tmp/chrome-physics-test-profile-' + Date.now(),
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required',
    'http://localhost:3000',
  ]);

  try {
    let connected = false;
    let targetWs = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const pages = await res.json();
        const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:3000'));
        if (page && page.webSocketDebuggerUrl) {
          targetWs = page.webSocketDebuggerUrl;
          connected = true;
          break;
        }
      } catch (e) {
        await sleep(200);
      }
    }

    assert(connected && targetWs, 'Failed to connect to Chrome headless');
    console.log('Connected to Chrome via CDP:', targetWs);

    const cdp = new CDPClient(targetWs);
    await cdp.send('Runtime.enable');

    console.log('Waiting for application to stabilize...');
    for (let i = 0; i < 30; i++) {
      try {
        const ready = await cdp.eval('Boolean(window.app && window.app.game && window.app.tracker && !window.app.tracker.isStarting)');
        if (ready) {
          console.log('App ready after', (i + 1) * 300, 'ms');
          break;
        }
      } catch (e) {}
      await sleep(300);
    }

    // ==========================================
    // TEST 1: Table Tennis CPU Serve Trajectory
    // ==========================================
    console.log('\n--- 1. Testing Table Tennis CPU Serve ---');
    // Ensure we are in tennis mode
    await cdp.eval(`window.app.setGameMode('tennis')`);
    
    // Set server to CPU (2) and trigger serve
    await cdp.eval(`
      window.app.game.resetRally(2);
      window.app.game.serve();
    `);

    // Monitor trajectory over 1.2 seconds
    const trajectoryData = await cdp.eval(`
      new Promise((resolve) => {
        let bounces = [];
        let netCrossing = null;
        let letOrFault = false;
        let timer = 0;

        const origToast = window.app.showActionToast;
        window.app.showActionToast = (msg) => {
          if (msg.includes('FAULT') || msg.includes('LET') || msg.includes('RE-SERVE')) {
            letOrFault = msg;
          }
        };

        const interval = setInterval(() => {
          timer += 16;
          const b = window.app.physics.ballBody;
          const pos = b.position;
          const vel = b.velocity;

          // Track net crossing
          if (!netCrossing && Math.abs(pos.z) < 0.12) {
            netCrossing = { y: pos.y, z: pos.z, vy: vel.y, vz: vel.z };
          }

          if (timer >= 1200) {
            clearInterval(interval);
            window.app.showActionToast = origToast;
            resolve({
              bouncesP1: window.app.game.bouncesP1,
              bouncesP2: window.app.game.bouncesP2,
              netCrossing,
              letOrFault,
              state: window.app.game.state
            });
          }
        }, 16);
      })
    `);

    console.log('CPU Serve Trajectory Result:', trajectoryData);
    assert.strictEqual(trajectoryData.letOrFault, false, `CPU serve must never fault or let! Got: ${trajectoryData.letOrFault}`);
    assert(trajectoryData.netCrossing !== null, 'Ball must cross the net!');
    assert(trajectoryData.netCrossing.y >= 0.95, `Net crossing height (${trajectoryData.netCrossing.y.toFixed(3)}m) must be > 0.95m (top of net is 0.9125m)!`);
    console.log(`✓ CPU Serve cleared net cleanly at ${trajectoryData.netCrossing.y.toFixed(3)}m (> 0.9125m net height) with 0 faults!`);

    // ==========================================
    // TEST 2: Table Tennis Player 1 Serve Trajectory
    // ==========================================
    console.log('\n--- 2. Testing Table Tennis Player 1 Serve ---');
    await cdp.eval(`
      window.app.game.resetRally(1);
      window.app.game.serve();
    `);

    const p1ServeData = await cdp.eval(`
      new Promise((resolve) => {
        let netCrossing = null;
        let letOrFault = false;
        let timer = 0;

        const origToast = window.app.showActionToast;
        window.app.showActionToast = (msg) => {
          if (msg.includes('FAULT') || msg.includes('LET') || msg.includes('RE-SERVE')) {
            letOrFault = msg;
          }
        };

        const interval = setInterval(() => {
          timer += 16;
          const b = window.app.physics.ballBody;
          const pos = b.position;
          const vel = b.velocity;

          if (!netCrossing && Math.abs(pos.z) < 0.12) {
            netCrossing = { y: pos.y, z: pos.z, vy: vel.y, vz: vel.z };
          }

          if (timer >= 1200) {
            clearInterval(interval);
            window.app.showActionToast = origToast;
            resolve({
              netCrossing,
              letOrFault,
              state: window.app.game.state
            });
          }
        }, 16);
      })
    `);

    console.log('P1 Serve Trajectory Result:', p1ServeData);
    assert.strictEqual(p1ServeData.letOrFault, false, `P1 serve must never fault or let! Got: ${p1ServeData.letOrFault}`);
    assert(p1ServeData.netCrossing !== null, 'P1 Ball must cross the net!');
    assert(p1ServeData.netCrossing.y >= 0.95, `P1 Net crossing height (${p1ServeData.netCrossing.y.toFixed(3)}m) must be > 0.95m!`);
    console.log(`✓ P1 Serve cleared net cleanly at ${p1ServeData.netCrossing.y.toFixed(3)}m with 0 faults!`);

    // ==========================================
    // TEST 3: Air Hockey Corner Anti-Wedge
    // ==========================================
    console.log('\n--- 3. Testing Air Hockey Corner Anti-Wedge Logic ---');
    await cdp.eval(`window.app.setGameMode('hockey')`);
    await sleep(400);

    // Place puck deep in CPU corner and observe for 1.8 seconds
    const cornerTestResult = await cdp.eval(`
      new Promise((resolve) => {
        const game = window.app.hockeyGame;
        const phys = window.app.hockeyPhysics;

        // Force active play state and place puck in deep corner
        game.state = 'ACTIVE_PLAY';
        phys.setPuckPosition(0.48, 0.98);
        phys.setPuckVelocity(0, 0);

        let maxDistTraveled = 0;
        let escapedCorner = false;
        let timer = 0;

        const interval = setInterval(() => {
          timer += 20;
          const p = phys.getPuckState();
          const distFromCorner = Math.hypot(0.48 - p.position.x, 0.98 - p.position.z);
          if (distFromCorner > maxDistTraveled) maxDistTraveled = distFromCorner;

          // Check if puck moved away from the deep corner towards center (Z <= 0.70 or X <= 0.25)
          if (p.position.z <= 0.72 || p.position.x <= 0.28) {
            escapedCorner = true;
          }

          if (timer >= 1800) {
            clearInterval(interval);
            resolve({
              finalPuckPos: p.position,
              finalPuckVel: p.velocity,
              maxDistTraveled,
              escapedCorner,
              cpuStrikerPos: game.p2Pos
            });
          }
        }, 20);
      })
    `);

    console.log('Air Hockey Corner Result:', cornerTestResult);
    assert(cornerTestResult.escapedCorner, 'Puck must escape the corner cleanly without being wedged!');
    console.log('✓ Air Hockey corner anti-wedge confirmed: puck moved out of corner to open play!');

    cdp.close();
    console.log('\n>>> ALL VERIFICATION TESTS PASSED PERFECTLY! <<<');
  } finally {
    chromeProc.kill('SIGTERM');
  }
}

runTest().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
