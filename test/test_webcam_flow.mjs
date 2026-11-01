import { spawn } from 'node:child_process';
import assert from 'node:assert';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9223;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.callbacks = new Map();
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
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
          this.consoleLogs.push({ type: msg.params.type, text });
          if (msg.params.type === 'error') {
            console.error('[Browser console.error]:', text);
          }
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
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    this.ws.close();
  }
}

async function runTest() {
  console.log('--- Launching Chrome with Fake Webcam Device ---');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--user-data-dir=/tmp/chrome-webcam-test-profile-' + Date.now(),
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required',
    'http://localhost:3000',
  ]);

  chromeProc.stderr.on('data', (d) => console.log('[Chrome Stderr]:', d.toString()));
  chromeProc.stdout.on('data', (d) => console.log('[Chrome Stdout]:', d.toString()));

  try {
    // Wait for Chrome CDP port to become active
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
    await cdp.send('Page.enable');

    console.log('Waiting for page and default webcam initialization...');
    // Wait until tracker finishes starting (up to 12s)
    let finishedStarting = false;
    for (let i = 0; i < 24; i++) {
      const isStarting = await cdp.eval('window.app?.tracker?.isStarting');
      const isTracking = await cdp.eval('window.app?.tracker?.isTracking');
      const statusText = await cdp.eval('document.getElementById("tracking-status-text")?.textContent');
      console.log(`[Wait loop ${i}] isStarting: ${isStarting}, isTracking: ${isTracking}, status: ${statusText}`);
      if (!isStarting && isTracking) {
        finishedStarting = true;
        break;
      }
      await sleep(500);
    }

    // Verify window.app is instantiated
    const appExists = await cdp.eval('Boolean(window.app)');
    assert.strictEqual(appExists, true, 'window.app must exist');
    console.log('✓ window.app exists');

    // Check tracker status
    const trackerState = await cdp.eval(`({
      isTracking: window.app.tracker.isTracking,
      isStarting: window.app.tracker.isStarting,
      controlMode: window.app.tracker.controlMode,
      hasStream: Boolean(window.app.tracker.mediaStream),
      hasVideoSrc: Boolean(document.getElementById('webcam-video').srcObject),
      videoReadyState: document.getElementById('webcam-video').readyState,
      hudBtnText: document.getElementById('cam-btn-text').textContent,
      statusText: document.getElementById('tracking-status-text').textContent,
      dotActive: document.getElementById('tracking-status-dot').classList.contains('active')
    })`);

    console.log('Initial Tracker State:', trackerState);
    assert.strictEqual(trackerState.isTracking, true, 'tracker.isTracking should be true');
    assert.strictEqual(trackerState.isStarting, false, 'tracker.isStarting should be false once running');
    assert.strictEqual(trackerState.controlMode, 'webcam', 'controlMode should be webcam');
    assert.strictEqual(trackerState.hasStream, true, 'tracker should hold mediaStream');
    assert.strictEqual(trackerState.hasVideoSrc, true, 'webcam-video element should have srcObject');
    assert.strictEqual(trackerState.hudBtnText, 'WEBCAM: ON', 'HUD button should say WEBCAM: ON');
    assert.strictEqual(trackerState.dotActive, true, 'status dot should be active');
    console.log('✓ Default webcam successfully requested, granted, and running!');

    // Check action toast - ensure it does NOT say CAMERA ACCESS DENIED
    const toastText = await cdp.eval(`document.getElementById('action-toast').textContent`);
    console.log('Action Toast Text:', toastText);
    assert(!toastText.includes('ACCESS DENIED'), 'Toast must not say ACCESS DENIED when camera is granted!');
    console.log('✓ No false access denied toast observed');

    // Test Webcam Toggle: Turn OFF
    console.log('\n--- Testing Toggle Webcam OFF ---');
    await cdp.eval(`document.getElementById('btn-toggle-cam').click()`);
    await sleep(400);

    const offState = await cdp.eval(`({
      isTracking: window.app.tracker.isTracking,
      controlMode: window.app.tracker.controlMode,
      hudBtnText: document.getElementById('cam-btn-text').textContent,
      statusText: document.getElementById('tracking-status-text').textContent,
      dotActive: document.getElementById('tracking-status-dot').classList.contains('active')
    })`);
    console.log('After toggle OFF:', offState);
    assert.strictEqual(offState.isTracking, false, 'Tracking should be stopped');
    assert.strictEqual(offState.controlMode, 'mouse', 'Control mode should fall back to mouse');
    assert.strictEqual(offState.hudBtnText, 'WEBCAM: OFF', 'HUD button should say WEBCAM: OFF');
    assert.strictEqual(offState.dotActive, false, 'status dot should be inactive');
    console.log('✓ Webcam toggled OFF cleanly');

    // Test Webcam Toggle: Turn ON
    console.log('\n--- Testing Toggle Webcam ON ---');
    await cdp.eval(`document.getElementById('btn-toggle-cam').click()`);
    await sleep(2000);

    const onState = await cdp.eval(`({
      isTracking: window.app.tracker.isTracking,
      controlMode: window.app.tracker.controlMode,
      hudBtnText: document.getElementById('cam-btn-text').textContent,
      statusText: document.getElementById('tracking-status-text').textContent,
      dotActive: document.getElementById('tracking-status-dot').classList.contains('active')
    })`);
    console.log('After toggle ON:', onState);
    assert.strictEqual(onState.isTracking, true, 'Tracking should be active again');
    assert.strictEqual(onState.hudBtnText, 'WEBCAM: ON', 'HUD button should say WEBCAM: ON');
    assert.strictEqual(onState.dotActive, true, 'status dot should be active');
    console.log('✓ Webcam restarted cleanly');

    // Test Switching Modes: Table Tennis -> Air Hockey -> Table Tennis
    console.log('\n--- Testing Game Mode Switching ---');
    await cdp.eval(`document.getElementById('btn-mode-hockey').click()`);
    await sleep(400);
    const hockeyMode = await cdp.eval(`window.app.gameMode`);
    assert.strictEqual(hockeyMode, 'hockey', 'Game mode should be hockey');
    const hockeyCamActive = await cdp.eval(`window.app.tracker.isTracking`);
    assert.strictEqual(hockeyCamActive, true, 'Webcam tracking should stay active in hockey mode');
    console.log('✓ Air Hockey mode active with webcam running');

    await cdp.eval(`document.getElementById('btn-mode-tennis').click()`);
    await sleep(400);
    const tennisMode = await cdp.eval(`window.app.gameMode`);
    assert.strictEqual(tennisMode, 'tennis', 'Game mode should be tennis');
    console.log('✓ Switched back to Table Tennis cleanly');

    // Check for runtime application exceptions (ignoring internal 3rd party Emscripten EEXIST warnings)
    const appExceptions = cdp.exceptions.filter((ex) => {
      const url = ex.exceptionDetails?.url || '';
      const desc = ex.exceptionDetails?.exception?.description || '';
      return !url.includes('cdn.jsdelivr.net') && !desc.includes('ErrnoError');
    });

    console.log('\nApplication exceptions caught:', appExceptions.length);
    assert.strictEqual(appExceptions.length, 0, 'No uncaught application exceptions should occur');

    cdp.close();
    console.log('\n>>> ALL WEBCAM INTEGRATION TESTS PASSED PERFECTLY! <<<');
  } finally {
    chromeProc.kill('SIGTERM');
  }
}

runTest().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
