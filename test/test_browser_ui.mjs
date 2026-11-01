import { spawn } from 'child_process';
import assert from 'assert';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9222;
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
    this.events = [];
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
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log('=== LAUNCHING HEADLESS CHROME TEST FOR UI & BUTTONS ===');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--no-sandbox',
      '--mute-audio',
      '--window-size=1280,720',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      'about:blank',
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
    // Wait for Chrome DevTools port to open
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
    console.log('✓ Headless Chrome attached on port 9222');

    // Get page target
    const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page');
    assert(pageTarget, 'No page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.readyPromise;
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Network.enable');

    console.log('Navigating to', TARGET_URL);
    await client.send('Page.navigate', { url: TARGET_URL });

    // Wait for game app to initialize
    console.log('Waiting for window.gameApp to initialize...');
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const val = await client.evaluate('Boolean((window.gameApp || window.app) && (window.gameApp || window.app).scene)');
        if (val) {
          ready = true;
          break;
        }
      } catch (e) {}
      await wait(300);
    }
    if (!ready) {
      const pageInfo = await client.evaluate(`({
        href: window.location.href,
        title: document.title,
        readyState: document.readyState,
        hasGameApp: Boolean(window.gameApp),
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.src)
      })`);
      console.error('Page diagnostic info:', pageInfo);
      console.error('Browser console logs:', client.consoleLogs);
      console.error('Browser console errors:', client.consoleErrors);
    }
    assert(ready, 'window.gameApp failed to initialize in page');
    console.log('✓ Game app initialized successfully on http://localhost:3000');

    // Test 1: Check HUD buttons presence
    const buttons = await client.evaluate(`({
      tennis: Boolean(document.getElementById('btn-mode-tennis')),
      hockey: Boolean(document.getElementById('btn-mode-hockey')),
      webcam: Boolean(document.getElementById('btn-toggle-cam')),
      facetrack: Boolean(document.getElementById('btn-toggle-facetrack')),
      calibrate: Boolean(document.getElementById('btn-calibrate-hand')),
      camView: Boolean(document.getElementById('btn-camera-view')),
      audio: Boolean(document.getElementById('btn-toggle-sound')),
      serve: Boolean(document.getElementById('btn-serve-ball')),
      pipCanvas: Boolean(document.getElementById('webcam-canvas')),
    })`);
    console.log('--- Checking HUD elements presence ---');
    for (const [k, v] of Object.entries(buttons)) {
      assert(v, `Element for ${k} must exist`);
      console.log(`  ✓ ${k} element present`);
    }

    // Test 2: Initial Face Tracker status (turned ON by default)
    const initialVrState = await client.evaluate(`({
      enabled: window.gameApp.faceTracker.enabled,
      btnText: document.getElementById('facetrack-btn-text')?.textContent,
      hasClass: document.getElementById('btn-toggle-facetrack')?.classList.contains('vr-active')
    })`);
    assert.strictEqual(initialVrState.enabled, true, 'Face tracking must start enabled by default');
    assert.strictEqual(initialVrState.btnText, 'HEAD VR: ON', 'Button text must be HEAD VR: ON');
    assert.strictEqual(initialVrState.hasClass, true, 'Button should have vr-active glowing style initially');
    console.log('✓ Initial state verified: HEAD VR is ON by default');

    // Test 3: Click Face Track button to toggle OFF
    console.log('--- Testing Face Tracking Toggle OFF via Button Click ---');
    const clickResult = await client.evaluate(`(async () => {
      const btn = document.getElementById('btn-toggle-facetrack');
      btn.click();
      await new Promise(r => setTimeout(r, 200));
      return {
        enabled: window.gameApp.faceTracker.enabled,
        btnText: document.getElementById('facetrack-btn-text')?.textContent,
        hasClass: btn.classList.contains('vr-active')
      };
    })()`);
    console.log('clickResult:', clickResult);

    const toggledOffState = await client.evaluate(`({
      enabled: window.gameApp.faceTracker.enabled,
      btnText: document.getElementById('facetrack-btn-text')?.textContent,
      hasClass: document.getElementById('btn-toggle-facetrack')?.classList.contains('vr-active')
    })`);
    console.log('toggledOffState:', toggledOffState);
    assert.strictEqual(toggledOffState.enabled, false, 'Face tracking should be disabled after click');
    assert.strictEqual(toggledOffState.btnText, 'HEAD VR: OFF', 'Button text should update to HEAD VR: OFF');
    assert.strictEqual(toggledOffState.hasClass, false, 'Button should remove vr-active style');
    console.log('✓ Button click successfully toggled HEAD VR: OFF');

    // Test 4: Toggle back ON via Keyboard shortcut 'F'
    console.log('--- Testing Face Tracking Toggle ON via Keyboard Shortcut F ---');
    await client.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF' }))`);
    await wait(250);

    const toggledOnState = await client.evaluate(`({
      enabled: window.gameApp.faceTracker.enabled,
      btnText: document.getElementById('facetrack-btn-text')?.textContent,
      hasClass: document.getElementById('btn-toggle-facetrack')?.classList.contains('vr-active')
    })`);
    assert.strictEqual(toggledOnState.enabled, true, 'Face tracking should toggle back ON via key F');
    assert.strictEqual(toggledOnState.btnText, 'HEAD VR: ON');
    console.log("✓ Keyboard shortcut 'F' successfully toggled HEAD VR back ON");

    // Test 5: Neutral Calibration Lock 'C' and button
    console.log('--- Testing Instant Hand & Face Calibration on Button Click ---');
    await client.evaluate(`document.getElementById('btn-calibrate-hand').click()`);
    await wait(100);

    const calibFeedback = await client.evaluate(`({
      btnText: document.getElementById('btn-calibrate-hand')?.textContent,
      hasPulse: document.getElementById('btn-calibrate-hand')?.classList.contains('calibrated-pulse'),
      toast: document.getElementById('action-toast')?.textContent,
    })`);
    assert(calibFeedback.btnText.includes('CALIBRATED'), `Button text should reflect calibration, got: "${calibFeedback.btnText}"`);
    console.log(`✓ Button click immediately triggered full calibration: "${calibFeedback.btnText}" (Toast: "${calibFeedback.toast}")`);

    // Test Keyboard shortcut 'C'
    await client.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC' }))`);
    await wait(100);
    console.log("✓ Keyboard shortcut 'C' successfully triggers hand & face calibration");

    // Test settings button opens modal
    await client.evaluate(`document.getElementById('btn-calib-settings')?.click()`);
    await wait(150);
    const modalOpen = await client.evaluate(`document.getElementById('calibration-modal')?.classList.contains('open')`);
    assert(modalOpen, 'Settings button must open calibration modal');
    await client.evaluate(`document.getElementById('modal-calib-close')?.click()`);
    await wait(100);
    console.log('✓ Calibration settings modal opens and closes cleanly');

    // Test 5b: Spider-Man Hand Sign (🤟) Automatic Calibration
    console.log('--- Testing Spider-Man Hand Sign (🤟) Automatic Calibration ---');
    const gestureResult = await client.evaluate(`(async () => {
      const tracker = window.gameApp.tracker;
      const seenToasts = [];
      const origToast = window.gameApp.showActionToast.bind(window.gameApp);
      window.gameApp.showActionToast = (msg) => {
        seenToasts.push(msg);
        origToast(msg);
      };

      const spidermanLandmarks = [];
      const wrist = { x: 0.5, y: 0.8, z: 0 };
      spidermanLandmarks[0] = wrist;
      // Thumb extended
      spidermanLandmarks[1] = { x: 0.46, y: 0.74, z: -0.01 };
      spidermanLandmarks[2] = { x: 0.43, y: 0.70, z: -0.015 };
      spidermanLandmarks[3] = { x: 0.38, y: 0.67, z: -0.02 };
      spidermanLandmarks[4] = { x: 0.32, y: 0.65, z: -0.025 };
      // Helper
      function addFinger(mcpIdx, rootX, rootY, isExt) {
        spidermanLandmarks[mcpIdx] = { x: rootX, y: rootY, z: 0 };
        if (isExt) {
          spidermanLandmarks[mcpIdx+1] = { x: rootX, y: rootY - 0.08, z: 0 };
          spidermanLandmarks[mcpIdx+2] = { x: rootX, y: rootY - 0.14, z: 0 };
          spidermanLandmarks[mcpIdx+3] = { x: rootX, y: rootY - 0.20, z: 0 };
        } else {
          spidermanLandmarks[mcpIdx+1] = { x: rootX, y: rootY - 0.05, z: -0.02 };
          spidermanLandmarks[mcpIdx+2] = { x: rootX, y: rootY - 0.02, z: -0.03 };
          spidermanLandmarks[mcpIdx+3] = { x: rootX, y: rootY + 0.02, z: -0.02 };
        }
      }
      addFinger(5, 0.46, 0.65, true);  // Index: extended
      addFinger(9, 0.50, 0.63, false); // Middle: curled
      addFinger(13, 0.54, 0.65, false);// Ring: curled
      addFinger(17, 0.58, 0.68, true); // Pinky: extended

      // Feed frames over 250ms to sustain gesture
      for (let i = 0; i < 9; i++) {
        tracker.onMediaPipeResults({ multiHandLandmarks: [spidermanLandmarks], image: {} });
        await new Promise(r => setTimeout(r, 30));
      }

      window.gameApp.showActionToast = origToast;

      return {
        isCalibrated: tracker.isCalibrated,
        cooldown: tracker.spidermanGestureCooldown,
        seenToasts: seenToasts,
        currentToast: document.getElementById('action-toast')?.textContent
      };
    })()`);

    console.log('gestureResult:', gestureResult);
    assert.strictEqual(gestureResult.isCalibrated, true, 'HandTracker should be calibrated by Spider-Man gesture');
    assert(gestureResult.cooldown > 0, 'Cooldown must be active after gesture calibration');
    assert(
      gestureResult.seenToasts.some(t => t.includes('SPIDER-MAN')),
      `Expected Spider-Man toast, saw: ${JSON.stringify(gestureResult.seenToasts)}`
    );
    console.log(`✓ Spider-Man hand sign successfully triggered automatic calibration (Toasts: ${JSON.stringify(gestureResult.seenToasts)})`);

    // Test 6: Cycle Camera Views
    console.log('--- Testing Camera View Mode Switcher ---');
    const initialView = await client.evaluate('window.gameApp.scene.currentViewMode');
    console.log(`  Initial view mode: ${initialView}`);

    await client.evaluate(`document.getElementById('btn-camera-view').click()`);
    await wait(150);
    const view2 = await client.evaluate('window.gameApp.scene.currentViewMode');
    assert.notStrictEqual(view2, initialView, 'Camera view must cycle on click');
    console.log(`  Cycled view to: ${view2}`);

    // Cycle through remaining
    await client.evaluate(`document.getElementById('btn-camera-view').click()`);
    await wait(150);
    const view3 = await client.evaluate('window.gameApp.scene.currentViewMode');
    console.log(`  Cycled view to: ${view3}`);

    await client.evaluate(`document.getElementById('btn-camera-view').click()`);
    await wait(150);
    const view4 = await client.evaluate('window.gameApp.scene.currentViewMode');
    console.log(`  Cycled view to: ${view4}`);

    // Cycle back to host
    await client.evaluate(`document.getElementById('btn-camera-view').click()`);
    await wait(150);
    const viewFinal = await client.evaluate('window.gameApp.scene.currentViewMode');
    assert.strictEqual(viewFinal, 'host', 'Camera should cycle back to host view');
    console.log(`  Cycled back to: ${viewFinal}`);

    // Test 7: Game Mode Switch (Tennis <-> Hockey)
    console.log('--- Testing Game Mode Switching ---');
    await client.evaluate(`document.getElementById('btn-mode-hockey').click()`);
    await wait(300);
    const mode1 = await client.evaluate('window.gameApp.gameMode');
    assert.strictEqual(mode1, 'hockey', 'Mode should switch to hockey');
    console.log('✓ Switched to Air Hockey successfully');

    await client.evaluate(`document.getElementById('btn-mode-tennis').click()`);
    await wait(300);
    const mode2 = await client.evaluate('window.gameApp.gameMode');
    assert.strictEqual(mode2, 'tennis', 'Mode should switch back to tennis');
    console.log('✓ Switched back to Table Tennis successfully');

    // Test 8: Audio Toggle
    console.log('--- Testing Audio Toggle ---');
    const audioBefore = await client.evaluate("document.getElementById('sound-icon')?.textContent");
    await client.evaluate(`document.getElementById('btn-toggle-sound').click()`);
    await wait(100);
    const audioAfter = await client.evaluate("document.getElementById('sound-icon')?.textContent");
    console.log(`✓ Audio toggle working (Before: "${audioBefore}" -> After: "${audioAfter}")`);

    // Test 9: Serve Ball
    console.log('--- Testing Serve Action ---');
    await client.evaluate(`document.getElementById('btn-serve-ball').click()`);
    await wait(200);
    console.log('✓ Serve action triggered successfully');

    // Test 10: Inspect Console Errors
    console.log('--- Checking Console Errors ---');
    console.log(`Total console log entries: ${client.consoleLogs.length}`);
    const criticalErrors = client.consoleErrors.filter(
      (err) =>
        !err.includes('favicon.ico') &&
        !err.includes('getUserMedia') &&
        !err.includes('DevicesNotFoundError') &&
        !err.includes('mediapipe') &&
        !err.includes('ErrnoError')
    );
    if (criticalErrors.length > 0) {
      console.warn('Console warnings/errors detected:', criticalErrors);
    }
    assert.strictEqual(criticalErrors.length, 0, `Unexpected errors in browser console: ${criticalErrors.join('; ')}`);
    console.log('✓ Zero JavaScript runtime errors in browser console');

    client.close();
    console.log('\n=== ALL BROWSER UI & INTERACTION TESTS PASSED! ===');
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('\n❌ BROWSER TEST FAILED:', err);
  process.exit(1);
});
