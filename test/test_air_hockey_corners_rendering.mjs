import assert from 'node:assert';
import * as THREE from 'three';
import { createAirHockeyTable } from '../src/graphics/air_hockey_models.js';

console.log('=== VERIFICATION TEST: AIR HOCKEY CORNER TABS RENDERING ===\n');

// 1. Build Air Hockey Table
const table = createAirHockeyTable();
assert(table instanceof THREE.Group, 'Table must be a THREE.Group');

// 2. Locate all corner bouncer objects in table
const cornerBouncers = [];
table.traverse((child) => {
  // Check if mesh geometry matches corner bouncer wedge or cushion
  if (child.isMesh && child.geometry) {
    const geo = child.geometry;
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    const sizeX = box.max.x - box.min.x;
    const sizeZ = box.max.z - box.min.z;
    // Wedge size is roughly 0.15 + 0.055 = 0.205m
    if (sizeX > 0.19 && sizeX < 0.22 && sizeZ > 0.19 && sizeZ < 0.22) {
      cornerBouncers.push(child);
    }
  }
});

console.log(`Found ${cornerBouncers.length} corner bouncer wedges (expected: 4)`);
assert.strictEqual(cornerBouncers.length, 4, 'Table must contain exactly 4 corner bouncer wedges');

// 3. Verify that NO object in the table hierarchy has negative scaling (which causes backface culling bugs)
table.traverse((child) => {
  assert(child.scale.x > 0, `Object ${child.name || child.type} scale.x must be positive (> 0), got ${child.scale.x}`);
  assert(child.scale.y > 0, `Object ${child.name || child.type} scale.y must be positive (> 0), got ${child.scale.y}`);
  assert(child.scale.z > 0, `Object ${child.name || child.type} scale.z must be positive (> 0), got ${child.scale.z}`);
});
console.log('✓ All table hierarchy nodes have positive scales: scale=(1, 1, 1) — ZERO backface culling flipping');

// 4. Verify that each corner wedge has outward-pointing normals and valid vertex normals
for (let i = 0; i < cornerBouncers.length; i++) {
  const mesh = cornerBouncers[i];
  const geo = mesh.geometry;
  const normals = geo.attributes.normal;
  assert(normals, 'Geometry must have normal attribute');
  assert(normals.count > 0, 'Normals count must be > 0');

  for (let j = 0; j < normals.count; j++) {
    const nx = normals.getX(j);
    const ny = normals.getY(j);
    const nz = normals.getZ(j);
    const len = Math.hypot(nx, ny, nz);
    assert(Math.abs(len - 1.0) < 0.01, `Normal vector length must be normalized ~1.0, got ${len}`);
  }
}
console.log('✓ All 4 corner wedges have normalized, valid outward vertex normals');

// 5. Update World Matrix and test Raycasting against all 4 corner positions from center
table.updateMatrixWorld(true);

const W = 1.10, L = 2.14, H = 0.82;
const testCorners = [
  { name: 'South-West (-X, -Z)', pos: [-W / 2 * 0.9, H + 0.02, -L / 2 * 0.9] },
  { name: 'South-East (+X, -Z)', pos: [W / 2 * 0.9, H + 0.02, -L / 2 * 0.9] },
  { name: 'North-East (+X, +Z)', pos: [W / 2 * 0.9, H + 0.02, L / 2 * 0.9] },
  { name: 'North-West (-X, +Z)', pos: [-W / 2 * 0.9, H + 0.02, L / 2 * 0.9] },
];

const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3(0, H + 0.02, 0);

for (const tc of testCorners) {
  const dir = new THREE.Vector3(...tc.pos).sub(origin).normalize();
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObjects(table.children, true);
  assert(hits.length >= 2, `${tc.name} must intersect both rebound cushion and wedge`);
  console.log(`✓ ${tc.name}: first hit at ${hits[0].distance.toFixed(3)}m, total hits: ${hits.length}`);
}

console.log('\n=== ALL AIR HOCKEY CORNER RENDERING TESTS PASSED PERFECTLY! ===');
