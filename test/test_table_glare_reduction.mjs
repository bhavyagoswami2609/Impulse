import assert from 'assert';
import * as THREE from 'three';
import { createTableTennisTable } from '../src/graphics/procedural_models.js';
import { createAirHockeyTable } from '../src/graphics/air_hockey_models.js';
import { TableTennisScene } from '../src/graphics/scene.js';

console.log('=== TEST: TABLE GLARE REDUCTION & LIGHTING CALIBRATION ===\n');

// Mock browser globals if needed for Three.js headless execution
const createDummyCtx = () => {
  const dummyFn = () => ({ addColorStop: () => {} });
  return new Proxy({
    measureText: () => ({ width: 50 }),
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: () => ({ data: new Uint8Array(4) }),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : dummyFn),
    set: () => true,
  });
};

if (typeof document === 'undefined') {
  global.document = {
    createElementNS: (ns, tag) => {
      if (tag === 'canvas') {
        return {
          getContext: () => createDummyCtx(),
          width: 512,
          height: 512,
          style: {},
          addEventListener: () => {},
          removeEventListener: () => {},
        };
      }
      return { style: {}, addEventListener: () => {}, removeEventListener: () => {} };
    },
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          getContext: () => createDummyCtx(),
          width: 512,
          height: 512,
          style: {},
        };
      }
      return { style: {} };
    },
    getElementById: () => null,
  };
}

if (typeof window === 'undefined') {
  global.window = {
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

// 1. Verify Table Tennis Table Surface
console.log('--- 1. Table Tennis Surface Material Finish ---');
const ttTable = createTableTennisTable();
const ttTopMesh = ttTable.children.find(
  (c) => c.isMesh && c.geometry.type === 'BoxGeometry' && c.material.color?.getHex() === 0x163d70
);

assert(ttTopMesh, 'Table tennis tabletop mesh found');
const ttMat = ttTopMesh.material;
console.log(`Table Tennis Top roughness: ${ttMat.roughness}, metalness: ${ttMat.metalness}`);
assert(ttMat.roughness >= 0.85, `Expected roughness >= 0.85 (got ${ttMat.roughness})`);
assert.strictEqual(ttMat.metalness, 0.0, `Expected metalness 0.0 (got ${ttMat.metalness})`);
console.log('✓ PASS: Table tennis table has matte glare-free tournament finish\n');

// 2. Verify Air Hockey Table Surface
console.log('--- 2. Air Hockey Surface Material Finish ---');
const ahTable = createAirHockeyTable();
const ahPlayfieldMesh = ahTable.children.find(
  (child) => child.isMesh && child.geometry?.type === 'PlaneGeometry' && child.geometry?.parameters?.width > 1.0
);
let ahReboundMesh = null;
ahTable.traverse((child) => {
  if (child.isMesh && child.material && child.material.color && child.material.color.getHex() === 0x11161d) {
    ahReboundMesh = child;
  }
});

assert(ahPlayfieldMesh, 'Air hockey playfield mesh found');
const ahMat = ahPlayfieldMesh.material;
console.log(`Air Hockey Playfield roughness: ${ahMat.roughness}, metalness: ${ahMat.metalness}`);
assert(ahMat.roughness >= 0.80, `Expected roughness >= 0.80 (got ${ahMat.roughness})`);
assert.strictEqual(ahMat.metalness, 0.0, `Expected metalness 0.0 (got ${ahMat.metalness})`);

assert(ahReboundMesh, 'Air hockey rebound cushion mesh found');
console.log(`Air Hockey Rebound Cushion roughness: ${ahReboundMesh.material.roughness}`);
assert(ahReboundMesh.material.roughness >= 0.60, `Expected cushion roughness >= 0.60`);
console.log('✓ PASS: Air hockey table playfield and rails have soft satin glare-free finish\n');

// 3. Verify Lighting Calibration in Scene
console.log('--- 3. Scene Lighting Rig & Glare Prevention ---');
const container = { appendChild: () => {}, clientWidth: 1920, clientHeight: 1080 };
const sceneObj = new TableTennisScene(container);

let foundKeyLight = null;
let foundTableSpot = null;
let foundAmbientLight = null;
let foundFillLight = null;

sceneObj.scene.traverse((obj) => {
  if (obj.isSpotLight) {
    foundTableSpot = obj;
  } else if (obj.isDirectionalLight) {
    if (obj.color.getHex() === 0xfff8ee) {
      foundKeyLight = obj;
    } else if (obj.color.getHex() === 0xd4a03c) {
      foundFillLight = obj;
    }
  } else if (obj.isAmbientLight) {
    foundAmbientLight = obj;
  }
});

assert(foundTableSpot, 'Table spotlight found');
console.log(`Table spotlight intensity: ${foundTableSpot.intensity}, penumbra: ${foundTableSpot.penumbra}`);
assert(foundTableSpot.intensity <= 1.0, `Table spotlight intensity must be <= 1.0 (got ${foundTableSpot.intensity})`);
assert(foundTableSpot.penumbra >= 0.80, `Table spotlight penumbra must be >= 0.80 (got ${foundTableSpot.penumbra})`);
console.log('✓ PASS: Table spotlight is softened to prevent harsh hotspot glare');

assert(foundKeyLight, 'Tournament key light found');
console.log(`Key light intensity: ${foundKeyLight.intensity}, position Z: ${foundKeyLight.position.z}`);
assert(foundKeyLight.intensity <= 1.2, `Key light intensity must be <= 1.2 (got ${foundKeyLight.intensity})`);
assert(foundKeyLight.position.z >= 0, `Key light position.z must be >= 0 so specular reflection angles away from player camera`);
console.log('✓ PASS: Key light is angled forward and dimmed to bounce reflections away from camera');

assert(foundAmbientLight, 'Ambient light found');
console.log(`Ambient light intensity: ${foundAmbientLight.intensity}`);
assert(foundAmbientLight.intensity >= 0.70, `Ambient light must be >= 0.70 for balanced diffuse light`);
console.log('✓ PASS: Ambient diffuse lighting maintains crisp visibility without harsh specular shine\n');

console.log('============================================================');
console.log('ALL TABLE GLARE REDUCTION TESTS PASSED PERFECTLY!');
console.log('============================================================');
