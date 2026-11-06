import { spawn } from 'child_process';
import assert from 'assert';
import fs from 'fs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9224;
const PREVIEW_PORT = 3105;

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
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Runtime.exceptionThrown') {
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
  console.log('=== LAUNCHING VERIFICATION TEST: CAMERA START BUTTON & CALIBRATION MENU ===');

  // Start Vite preview server on port 3105
  const vitePreview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT)], {
    stdio: 'ignore',
  });

  await wait(1000);

  const tempProfile = `/tmp/test-chrome-profile-calib-${Date.now()}`;
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
      `http://localhost:${PREVIEW_PORT}`,
    ],
    { stdio: 'ignore' }
  );

  const cleanup = () => {
    try {
      chromeProcess.kill('SIGKILL');
    } catch (e) {}
    try {
      vitePreview.kill('SIGKILL');
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

    const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page');
    assert(pageTarget, 'No page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.readyPromise;
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    console.log('Waiting for application to load...');
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const val = await client.evaluate('Boolean((window.gameApp || window.app) && (window.gameApp || window.app).stateController)');
        if (val) {
          ready = true;
          break;
        }
      } catch (e) {}
      await wait(250);
    }
    assert(ready, 'Game app failed to initialize');
    console.log('✓ Application initialized successfully');

    // 1. Verify "Paddle Calibration" text is GONE and replaced by "Calibration"
    const headingText = await client.evaluate(`document.querySelector('#calibration-modal .modal-heading')?.innerText.trim()`);
    console.log('Calibration Modal Heading:', headingText);
    assert.strictEqual(headingText, 'Calibration', 'Modal heading must be "Calibration" without "Paddle"');
    console.log('✓ PASS: Modal heading is cleanly "Calibration"');

    const hasOldPaddleCalib = await client.evaluate(`document.body.innerText.includes("Paddle Calibration")`);
    assert.strictEqual(hasOldPaddleCalib, false, 'No occurrence of "Paddle Calibration" should remain in UI');
    console.log('✓ PASS: Zero occurrences of "Paddle Calibration" anywhere in page');

    // 2. Verify Removed Buttons (Match setup camera button & calibration bottom-left button removed)
    const buttonsExist = await client.evaluate(`({
      hasStartCameraOverlayBtn: Boolean(document.getElementById('btn-start-camera')),
      hasCalibToggleBtn: Boolean(document.getElementById('btn-calib-toggle-camera')),
      hasMenuCamBtn: Boolean(document.getElementById('btn-menu-cam-toggle')),
      hasCameraOverlay: Boolean(document.getElementById('calib-camera-overlay')),
      hasStartMatchBtn: Boolean(document.getElementById('btn-start-match')),
      hasManualCalibSkip: Boolean(document.getElementById('btn-manual-calib-skip'))
    })`);
    console.log('Camera buttons check:', buttonsExist);
    assert(buttonsExist.hasStartCameraOverlayBtn, '#btn-start-camera must exist in viewfinder overlay');
    assert.strictEqual(buttonsExist.hasCalibToggleBtn, false, '#btn-calib-toggle-camera must be REMOVED from modal actions row');
    assert.strictEqual(buttonsExist.hasMenuCamBtn, false, '#btn-menu-cam-toggle must be REMOVED from match setup panel');
    assert(buttonsExist.hasCameraOverlay, '#calib-camera-overlay must exist');
    assert(buttonsExist.hasStartMatchBtn, '#btn-start-match must be cleanly centered in match setup');
    assert(buttonsExist.hasManualCalibSkip, '#btn-manual-calib-skip must exist');
    console.log('✓ PASS: Buttons removed cleanly from match setup and bottom left of calibration');

    // 2b. Verify gold color in titles (Hero, Select Discipline, Match Setup)
    const titleColors = await client.evaluate(`({
      heroMutedColor: getComputedStyle(document.querySelector('.hero-headline .headline-muted')).color,
      disciplineMutedColor: getComputedStyle(document.querySelector('.section-heading .heading-muted')).color,
      setupMutedColor: getComputedStyle(document.querySelector('.panel-heading .heading-muted')).color
    })`);
    console.log('Title colors check:', titleColors);
    // Gold rgb(212, 160, 60)
    assert(titleColors.heroMutedColor.includes('212') && titleColors.heroMutedColor.includes('160'), 'Hero title muted text must be metallic amber gold');
    assert(titleColors.disciplineMutedColor.includes('212') && titleColors.disciplineMutedColor.includes('160'), 'Discipline heading muted text must be metallic amber gold');
    assert(titleColors.setupMutedColor.includes('212') && titleColors.setupMutedColor.includes('160'), 'Match setup heading muted text must be metallic amber gold');
    console.log('✓ PASS: All title grey highlights successfully updated to metallic amber gold!');

    // 3. Open Calibration Modal
    await client.evaluate(`window.gameApp.stateController.triggerCalibrationGate(() => {})`);
    await wait(300);

    const isModalOpen = await client.evaluate(`document.getElementById('calibration-modal').classList.contains('open')`);
    assert(isModalOpen, 'Calibration modal must be open');
    console.log('✓ Calibration modal is open');

    // 4. Test clicking the "Start Camera" button
    console.log('Clicking "Start Camera" button...');
    await client.evaluate(`document.getElementById('btn-start-camera').click()`);
    await wait(1000);

    const cameraState = await client.evaluate(`({
      isTracking: window.gameApp.tracker.isTracking,
      overlayHidden: document.getElementById('calib-camera-overlay').classList.contains('hidden'),
      videoWidth: window.gameApp.tracker.videoElement?.videoWidth
    })`);
    console.log('Camera state after click:', cameraState);
    assert(cameraState.isTracking, 'Hand tracker must be tracking after clicking Start Camera');
    assert(cameraState.overlayHidden, 'Overlay must be hidden when camera is actively streaming');
    console.log('✓ PASS: Clicking "Start Camera" button successfully started webcam tracking!');

    // Capture screenshot of the Calibration modal with camera stream running
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(screenshot.data, 'base64');
    fs.writeFileSync('/tmp/impulse-calibration-camera-active.png', buffer);
    console.log('✓ Captured screenshot to /tmp/impulse-calibration-camera-active.png');

    console.log('Console errors count:', client.consoleErrors.length);
    assert.strictEqual(client.consoleErrors.length, 0, 'No console errors allowed');

    client.close();
    cleanup();
    console.log('\n=== ALL CAMERA START BUTTON & CALIBRATION TESTS PASSED PERFECTLY! ===');
    process.exit(0);
  } catch (err) {
    console.error('Test failed with error:', err);
    cleanup();
    process.exit(1);
  }
}

main();
