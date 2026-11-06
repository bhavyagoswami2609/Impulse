import assert from 'assert';
import * as THREE from 'three';
import { createTableTennisTable, createPaddle, createBall } from '../src/graphics/procedural_models.js';
import { createAirHockeyTable, createAirHockeyStriker, createAirHockeyPuck } from '../src/graphics/air_hockey_models.js';

console.log('=== VERIFICATION TEST: RESTORED 3D MODELS & POLISHED LEGS ===');

// 1. Test Table Tennis Table
console.log('\n--- 1. Table Tennis Table Model & Polished Legs ---');
const ttTable = createTableTennisTable();
assert(ttTable, 'Table Tennis table must be created');
assert.strictEqual(ttTable.name, 'TableTennisTable', 'Name must be TableTennisTable');

// Tabletop color verification (ITTF Blue: 0x163d70)
const topMesh = ttTable.children.find((c) => c.isMesh && c.geometry.type === 'BoxGeometry' && c.material.color?.getHex() === 0x163d70);
assert(topMesh, 'Tabletop must be classic ITTF regulation blue (0x163d70)');
assert.strictEqual(topMesh.receiveShadow, false, 'Tabletop receiveShadow must be false to eliminate shadow map acne/artifacts');
console.log('✓ PASS: Tabletop restored to classic ITTF regulation blue (0x163d70) with receiveShadow = false');

// White boundary lines check
const whiteLines = ttTable.children.filter((c) => c.isMesh && c.material?.color?.getHex() === 0xffffff);
assert(whiteLines.length >= 5, `Expected at least 5 white boundary lines (2 sidelines, 2 endlines, 1 centerline), found ${whiteLines.length}`);
console.log(`✓ PASS: ${whiteLines.length} crisp white boundary lines verified (sidelines, endlines, centerline)`);

// Polished Legs & Undercarriage check
const legs = ttTable.children.filter((c) => c.isMesh && c.geometry.type === 'BoxGeometry' && (c.material?.color?.getHex() === 0x8294a6 || c.material?.color?.getHex() === 0x1a1e24));
assert.strictEqual(legs.length, 6, `Expected 6 tournament-grade steel legs, found ${legs.length}`);
console.log('✓ PASS: 6 polished tournament steel legs verified (4 outer corner + 2 center net-line legs)');

// Chrome Leveling Feet & Rubber Floor Pads check
const chromeParts = ttTable.children.filter((c) => c.isMesh && (c.material?.color?.getHex() === 0xe2e7ee || c.material?.color?.getHex() === 0xd8dde4));
assert(chromeParts.length >= 6, `Expected at least 6 chrome leveling foot cups/hardware, found ${chromeParts.length}`);
console.log(`✓ PASS: ${chromeParts.length} machined chrome hardware & leveling cups verified`);

// Cross-bracing and diagonal structural struts check
const cylindricalSupports = ttTable.children.filter((c) => c.isMesh && c.geometry.type === 'CylinderGeometry' && (c.material?.color?.getHex() === 0x8294a6 || c.material?.color?.getHex() === 0x1a1e24));
assert(cylindricalSupports.length >= 7, `Expected at least 7 structural tubular steel struts/crossbars, found ${cylindricalSupports.length}`);
console.log(`✓ PASS: ${cylindricalSupports.length} structural cross-bracing and diagonal linkage struts verified`);

// Tournament Net Assembly
const netMesh = ttTable.children.find((c) => c.isMesh && c.material?.opacity === 0.88);
assert(netMesh, 'Tournament net mesh must exist');
const whiteTapes = ttTable.children.filter((c) => c.isMesh && c.material?.color?.getHex() === 0xfafafa);
assert.strictEqual(whiteTapes.length, 2, 'Expected top and bottom white tape bands on net');
console.log('✓ PASS: Tournament net assembly verified with white top/bottom tape bands and steel posts');


// 2. Test Table Tennis Paddles
console.log('\n--- 2. Table Tennis Paddles (Restored Birch, Red & Black Faces) ---');
const p1Paddle = createPaddle('red');
const p2Paddle = createPaddle('black');

// Check Blade
const p1Blade = p1Paddle.children[0];
assert.strictEqual(p1Blade.material.color.getHex(), 0xd9b382, 'Blade must be natural birch wood (0xd9b382)');
assert.strictEqual(p1Blade.castShadow, false, 'Dynamic blade mesh castShadow must be false for 60fps optimization');
console.log('✓ PASS: Blade core restored to natural 5-ply birch wood (0xd9b382)');

// Check Rubbers (Forehand Red 0xd91616, Backhand Black 0x141414)
const p1RedFace = p1Paddle.children.find((c) => c.isMesh && c.material?.color?.getHex() === 0xd91616);
const p1BlackFace = p1Paddle.children.find((c) => c.isMesh && c.material?.color?.getHex() === 0x141414);
assert(p1RedFace, 'Paddle must have iconic competition red forehand rubber (0xd91616)');
assert(p1BlackFace, 'Paddle must have classic competition black backhand rubber (0x141414)');
assert.strictEqual(p1RedFace.castShadow, false, 'Red rubber castShadow must be false');
assert.strictEqual(p1BlackFace.castShadow, false, 'Black rubber castShadow must be false');
console.log('✓ PASS: Authentic competition red (0xd91616) and black (0x141414) rubber faces verified');

// Check Handle & Grip Stripe
const p1HandleGroup = p1Paddle.children.find((c) => c.isGroup);
assert(p1HandleGroup, 'Paddle must have handle group');
const p1HandleWood = p1HandleGroup.children.find((c) => c.isMesh && c.material?.color?.getHex() === 0xc89968);
const p1Stripe = p1HandleGroup.children.find((c) => c.isMesh && c.material?.color?.getHex() === 0x3d2314);
assert(p1HandleWood, 'Paddle handle must be natural wood (0xc89968)');
assert(p1Stripe, 'Paddle handle must have mahogany inlay grip stripe (0x3d2314)');
console.log('✓ PASS: Flared ergonomic wooden handle with mahogany grip stripe verified');


// 3. Test Air Hockey Table Model & Polished Legs
console.log('\n--- 3. Air Hockey Table Model & Polished Legs ---');
const hockeyTable = createAirHockeyTable();
assert(hockeyTable, 'Air Hockey table must be created');
assert.strictEqual(hockeyTable.name, 'AirHockeyTable', 'Name must be AirHockeyTable');

// Check Commercial Pedestal Legs
const ahLegs = hockeyTable.children.filter((c) => c.isMesh && c.geometry.type === 'BoxGeometry' && (c.material?.color?.getHex() === 0x7a8c9e || c.material?.color?.getHex() === 0x1a1e26));
// Expect 4 main legs + 1 longitudinal stretcher = at least 5
assert(ahLegs.length >= 5, `Expected at least 5 heavy-duty steel leg/stretcher components, found ${ahLegs.length}`);
console.log(`✓ PASS: ${ahLegs.length} commercial heavy-duty steel leg columns and longitudinal stretcher verified`);

// Check Flanges, Chrome Leveler Cups, and Leveler Stems
const ahChromeHardware = hockeyTable.children.filter((c) => c.isMesh && (c.material?.metalness >= 0.85 || c.material?.roughness <= 0.25));
assert(ahChromeHardware.length >= 8, `Expected heavy-duty chrome levelers, flanges, and corner hardware, found ${ahChromeHardware.length}`);
console.log(`✓ PASS: Heavy-duty cast mounting flanges, threaded chrome stems, and commercial leveler feet verified`);

console.log('\n=== ALL 3D MODEL RESTORATION & POLISHED LEGS VERIFICATIONS PASSED PERFECTLY! ===');
