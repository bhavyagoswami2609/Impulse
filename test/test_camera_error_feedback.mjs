import { spawn } from 'child_process';
import assert from 'assert';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9226;
const PREVIEW_PORT = 3108;

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

    this.readyPromise = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
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
    return res.result?.value;
  }
}

async function run() {
  console.log('=== TEST: CAMERA PERMISSION DENIED ACTIONABLE FEEDBACK ===');

  const vitePreview = spawn('npx', ['vite', '--port', String(PREVIEW_PORT), '--strictPort'], {
    stdio: 'ignore',
  });

  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-sandbox',
      '--mute-audio',
      '--window-size=1280,720',
      // Note: intentionally NO fake device so camera can be denied/tested
      `http://localhost:${PREVIEW_PORT}`,
    ],
    { stdio: 'ignore' }
  );

  const cleanup = () => {
    try { chromeProcess.kill('SIGKILL'); } catch (e) {}
    try { vitePreview.kill('SIGKILL'); } catch (e) {}
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
    assert(versionData, 'Chrome failed to start');

    const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page');
    assert(pageTarget, 'No page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.readyPromise;
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    // Deny camera permission explicitly
    try {
      await client.send('Browser.setPermission', {
        permission: { name: 'videoCapture' },
        setting: 'denied',
      });
    } catch (e) {}

    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const val = await client.evaluate('Boolean(window.app && window.app.stateController)');
        if (val) {
          ready = true;
          break;
        }
      } catch (e) {}
      await wait(150);
    }
    assert(ready, 'App failed to initialize');

    // Open calibration modal
    await client.evaluate(`
      window.app.stateController.triggerCalibrationGate(() => {});
    `);
    await wait(300);

    // Click Start Camera
    await client.evaluate(`
      document.getElementById('btn-start-camera').click();
    `);
    await wait(800);

    const errorState = await client.evaluate(`
      (() => {
        const tracker = window.app.tracker;
        const prompt = document.getElementById('calib-camera-prompt')?.textContent;
        const status = document.getElementById('calib-status-text')?.textContent;
        const btnText = document.getElementById('btn-start-camera')?.querySelector('span')?.textContent;
        return {
          hasLastError: Boolean(tracker?.lastError),
          errorMessage: tracker?.lastError?.message,
          errorType: tracker?.lastError?.type,
          prompt,
          status,
          btnText
        };
      })()
    `);

    console.log('Camera error diagnosis result:', errorState);

    assert(errorState.hasLastError, 'Expected tracker.lastError to be set on failure');
    assert.strictEqual(errorState.btnText, 'Retry Camera', 'Button should change to Retry Camera');
    assert(errorState.prompt.includes('denied') || errorState.prompt.includes('detected') || errorState.prompt.includes('unavailable') || errorState.prompt.includes('another app') || errorState.prompt.includes('blocked'), 'Prompt must show clear actionable guidance');
    
    // Wait an additional 300ms (18 frames) to ensure updateCalibrationProgress does NOT overwrite the error message
    await wait(300);
    const sustainedStatus = await client.evaluate(`document.getElementById('calib-status-text')?.textContent`);
    console.log('Sustained status text across 18 animation frames:', sustainedStatus);
    assert.strictEqual(sustainedStatus, errorState.errorMessage, 'Status text must maintain the actionable error message and not be overwritten');

    console.log('✓ PASS: Actionable camera diagnosis and Retry Camera verified successfully!');
  } finally {
    cleanup();
  }
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
