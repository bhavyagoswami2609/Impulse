import { spawn } from 'child_process';
import assert from 'assert';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9333;
const TARGET_URL = 'http://localhost:3000';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  return await res.json();
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.consoleLogs = [];
    this.consoleErrors = [];

    this.readyPromise = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      } else if (msg.method) {
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
          this.consoleLogs.push({ type: msg.params.type, text });
          if (msg.params.type === 'error') {
            this.consoleErrors.push(text);
          }
        } else if (msg.method === 'Runtime.exceptionThrown') {
          const desc = msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text;
          this.consoleErrors.push(desc);
        }
      }
    };
  }

  async send(method, params = {}) {
    await this.readyPromise;
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Evaluation failed: ${res.exceptionDetails.text}`);
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log('=== LAUNCHING HEADLESS CHROME TEST FOR AIR HOCKEY MIDLINE REACH ===');
  const tempProfile = `/tmp/test-chrome-midline-${Date.now()}`;
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tempProfile}`,
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--no-sandbox',
      '--mute-audio',
      '--window-size=1280,720',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      TARGET_URL,
    ],
    { stdio: 'ignore' }
  );

  const cleanup = () => {
    try {
      chromeProcess.kill('SIGKILL');
    } catch (e) {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  try {
    let versionData = null;
    for (let i = 0; i < 40; i++) {
      try {
        versionData = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
        if (versionData) break;
      } catch (e) {
        await wait(150);
      }
    }
    assert(versionData, 'Failed to connect to Chrome debugging endpoint');
    console.log('✓ Headless Chrome attached on port', DEBUG_PORT);

    const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page');
    assert(pageTarget, 'No page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.readyPromise;
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    console.log('Waiting for window.gameApp to initialize...');
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const val = await client.evaluate('Boolean(window.gameApp && window.gameApp.scene)');
        if (val) {
          ready = true;
          break;
        }
      } catch (e) {}
      await wait(300);
    }
    assert(ready, 'window.gameApp failed to initialize in page');
    console.log('✓ Game app initialized successfully on http://localhost:3000');

    // 1. Switch to Air Hockey Mode
    console.log('--- Testing Switch to Air Hockey Mode ---');
    const switchRes = await client.evaluate(`(() => {
      try {
        const btn = document.getElementById('btn-mode-hockey');
        if (btn) btn.click();
        else window.gameApp.setGameMode('hockey');
        return { success: true, mode: window.gameApp.gameMode };
      } catch (e) {
        return { error: e.message, stack: e.stack };
      }
    })()`);
    console.log('Switch result:', switchRes);
    await wait(200);

    const hockeyState = await client.evaluate(`({
      gameMode: window.gameApp.gameMode,
      p1MaxZ: window.gameApp.tracker.courtLimits.p1.maxZ,
      p2MinZ: window.gameApp.tracker.courtLimits.p2.minZ,
      p1BoundsMaxZ: window.gameApp.hockeyGame.p1Bounds.maxZ,
      striker1Visible: window.gameApp.scene.striker1.visible,
    })`);

    console.log('Hockey mode state:', hockeyState);
    assert.strictEqual(hockeyState.gameMode, 'hockey', 'Game mode must be hockey');
    assert.strictEqual(hockeyState.p1MaxZ, -0.005, 'HandTracker p1MaxZ must allow reaching midline (-0.005m)');
    assert.strictEqual(hockeyState.p2MinZ, 0.005, 'HandTracker p2MinZ must allow reaching midline (0.005m)');
    assert.strictEqual(hockeyState.p1BoundsMaxZ, -0.005, 'AirHockeyGame p1Bounds.maxZ must be -0.005m');
    assert.strictEqual(hockeyState.striker1Visible, true, 'Striker 1 mesh must be visible');
    console.log('✓ Air Hockey mode successfully activated with midline limits');

    // 2. Dispatch Mouse Move Forward to Top of Screen
    console.log('--- Testing Mouse Forward Movement to Midline ---');
    await client.evaluate(`(() => {
      const event = new MouseEvent('mousemove', {
        clientX: window.innerWidth / 2,
        clientY: 5, // Near top of screen (normY ~ 1.0)
        bubbles: true
      });
      window.dispatchEvent(event);
    })()`);
    await wait(100);

    const mouseTargetZ = await client.evaluate(`window.gameApp.tracker.mouseTarget.z`);
    console.log('mouseTargetZ after moving to top of screen:', mouseTargetZ);
    assert.strictEqual(mouseTargetZ, -0.005, 'mouseTarget.z must reach -0.005m at the midline');
    console.log('✓ Mouse target reached the midline (-0.005m)');

    // 3. Let filter settle with live game loop and check in-game striker position
    console.log('--- Letting Filter Settle and Checking In-Game Striker Position ---');
    await wait(400);

    const settledStrikerPos = await client.evaluate(`({
      p1Z: Number(window.gameApp.hockeyGame.p1Pos.z.toFixed(3)),
      sceneStriker1Z: Number(window.gameApp.scene.striker1.position.z.toFixed(3)),
    })`);
    console.log('Settled striker position:', settledStrikerPos);
    assert(settledStrikerPos.p1Z >= -0.02 && settledStrikerPos.p1Z <= -0.005, `Striker P1 should be at midline, got ${settledStrikerPos.p1Z}`);
    assert.strictEqual(settledStrikerPos.p1Z, settledStrikerPos.sceneStriker1Z, '3D Scene striker mesh matches physics striker position');
    console.log('✓ Striker is positioned right at the midline in 3D scene');

    // 4. Dispatch Mouse Move Backward to Bottom of Screen (Goal Defense)
    console.log('--- Testing Mouse Backward Movement to Goal ---');
    await client.evaluate(`(() => {
      const event = new MouseEvent('mousemove', {
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight - 5, // Near bottom of screen (normY ~ -1.0)
        bubbles: true
      });
      window.dispatchEvent(event);
    })()`);
    await wait(100);

    const mouseGoalZ = await client.evaluate(`window.gameApp.tracker.mouseTarget.z`);
    console.log('mouseTargetZ after moving to bottom of screen:', mouseGoalZ);
    assert.strictEqual(mouseGoalZ, -1.02, 'mouseTarget.z must reach -1.02m at the goal rail');
    console.log('✓ Mouse target reached defensive goal rail (-1.02m)');

    // 5. Verify no console errors
    console.log('--- Checking for Browser Console Errors ---');
    console.log('Console errors:', client.consoleErrors);
    assert.strictEqual(client.consoleErrors.length, 0, 'Must have zero browser console errors');
    console.log('✓ Zero browser console errors detected');

    client.close();
    console.log('\n=== ALL AIR HOCKEY BROWSER MIDLINE TESTS PASSED! ===');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
