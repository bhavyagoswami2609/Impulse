import { spawn } from 'child_process';
import assert from 'assert';
import fs from 'fs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9223; // Use fresh port
const TARGET_URL = 'http://localhost:3100';

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
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
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
  console.log('=== LAUNCHING HEADLESS CHROME TEST FOR DARK LUXURY 3D MODELS & CROWD ===');
  const tempProfile = `/tmp/test-chrome-profile-luxury-${Date.now()}`;
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

    // Inspect the 3D scene directly in the browser runtime
    const sceneInfo = await client.evaluate(`
      (() => {
        const app = window.gameApp || window.app;
        const scene = app.scene;
        if (!scene) return null;

        const table = scene.table;
        const arena = scene.arena;
        const p1 = scene.paddle1;
        const p2 = scene.paddle2;
        const ball = scene.ball;

        // Check crowd
        let instancedMeshCount = 0;
        let totalSpectatorCount = 0;
        let umpireFound = false;

        arena.traverse(child => {
          if (child.isInstancedMesh) {
            instancedMeshCount++;
            totalSpectatorCount = Math.max(totalSpectatorCount, child.count);
          }
          if (child.name === 'TableTennisTable') {
            // Found
          }
        });

        // Check table
        const topMesh = table.children.find(c => c.isMesh && c.geometry.type === 'BoxGeometry');
        const hasTopTexture = Array.isArray(topMesh?.material) && !!topMesh.material[2]?.map;

        // Check paddle 1 & 2
        const p1Blade = p1.children[0];
        const p2Blade = p2.children[0];

        // Check ball
        const ballMesh = ball.children[0];
        const ballHalo = ball.children[1];
        const ballEmissiveHex = ballMesh.material.emissive ? ballMesh.material.emissive.getHexString() : null;

        // Check landing ring
        const landingRingColorHex = scene.landingRing.material.color.getHexString();

        return {
          tableFound: !!table,
          hasTopTexture,
          topMeshMaterialCount: Array.isArray(topMesh?.material) ? topMesh.material.length : 1,
          p1BladeShadow: p1Blade.castShadow,
          p2BladeShadow: p2Blade.castShadow,
          ballShadow: ballMesh.castShadow,
          ballEmissiveHex,
          landingRingColorHex,
          instancedMeshCount,
          totalSpectatorCount,
        };
      })()
    `);

    console.log('--- Scene Verification Results ---');
    console.log(sceneInfo);

    assert(sceneInfo.tableFound, 'Table tennis table must exist in scene');
    assert(sceneInfo.hasTopTexture, 'Table top must have high-res baked regulation texture');
    assert.strictEqual(sceneInfo.topMeshMaterialCount, 6, 'Table top box must use multi-material faces');
    assert.strictEqual(sceneInfo.p1BladeShadow, false, 'P1 blade dynamic mesh castShadow must be false');
    assert.strictEqual(sceneInfo.p2BladeShadow, false, 'P2 blade dynamic mesh castShadow must be false');
    assert.strictEqual(sceneInfo.ballShadow, false, 'Ball core dynamic mesh castShadow must be false');
    assert.strictEqual(sceneInfo.ballEmissiveHex, 'd4a03c', 'Ball emissive must be metallic amber gold (0xd4a03c)');
    assert.strictEqual(sceneInfo.landingRingColorHex, 'd4a03c', 'Landing ring color must be metallic amber gold (0xd4a03c)');
    assert.strictEqual(sceneInfo.instancedMeshCount, 2, 'Crowd must use 2 InstancedMeshes (bodies and heads)');
    assert(sceneInfo.totalSpectatorCount >= 200, `Crowd must have 200+ spectators (found ${sceneInfo.totalSpectatorCount})`);
    console.log(`✓ Crowd verified: ${sceneInfo.totalSpectatorCount} spectators rendered via ${sceneInfo.instancedMeshCount} InstancedMeshes with zero GPU overhead!`);

    // Capture screenshot of the 3D scene
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(screenshot.data, 'base64');
    fs.writeFileSync('/tmp/impulse-dark-luxury-scene.png', buffer);
    console.log('✓ Captured screenshot to /tmp/impulse-dark-luxury-scene.png');

    console.log('--- Console Errors Check ---');
    console.log('Total console errors:', client.consoleErrors.length);
    if (client.consoleErrors.length > 0) {
      console.warn('Console errors:', client.consoleErrors);
    }
    assert.strictEqual(client.consoleErrors.length, 0, 'No console errors allowed');

    client.close();
    cleanup();
    console.log('\n=== ALL DARK LUXURY 3D MODEL & CROWD CHECKS PASSED PERFECTLY! ===');
    process.exit(0);
  } catch (err) {
    console.error('Test failed with error:', err);
    cleanup();
    process.exit(1);
  }
}

main();
