import * as THREE from 'three';

// Regulation table dimensions (meters)
export const TABLE_WIDTH = 1.525;
export const TABLE_LENGTH = 2.74;
export const TABLE_HEIGHT = 0.76;
export const TABLE_THICKNESS = 0.045;
export const NET_HEIGHT = 0.1525;
export const NET_OVERHANG = 0.1525;
// High-visibility ball radius (70mm diameter for optimal visual tracking)
export const BALL_RADIUS = 0.035;

/**
 * Universal safe canvas texture creator with graceful headless Node.js fallback
 */
function createSafeCanvasTexture(width, height, drawFn) {
  if (typeof document !== 'undefined' && document.createElement) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawFn(ctx, width, height, canvas);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        return texture;
      }
    } catch (e) {
      // In headless or test environments without 2D context, fail safely
    }
  }
  return null;
}

/**
 * Creates procedural canvas texture for the dark luxury court floor / architectural hardwood
 */
function createFloorTexture() {
  const tex = createSafeCanvasTexture(1024, 1024, (ctx) => {
    // 1. Warm tournament court hardwood foundation
    const baseGrad = ctx.createLinearGradient(0, 0, 1024, 1024);
    baseGrad.addColorStop(0, '#1d1712');
    baseGrad.addColorStop(0.5, '#28211a');
    baseGrad.addColorStop(1, '#1f1913');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, 1024, 1024);

    // 2. Parquet plank joints with warm amber micro-lines
    ctx.strokeStyle = 'rgba(212, 160, 60, 0.14)';
    ctx.lineWidth = 1.5;
    const step = 64;
    for (let x = 0; x < 1024; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1024);
      ctx.stroke();
    }

    // Staggered plank subdivisions
    ctx.strokeStyle = 'rgba(42, 34, 26, 0.85)';
    ctx.lineWidth = 2;
    for (let y = 0; y < 1024; y += step * 2) {
      for (let x = 0; x < 1024; x += step) {
        const offsetY = ((x / step) % 2 === 0) ? 0 : step;
        ctx.beginPath();
        ctx.moveTo(x, y + offsetY);
        ctx.lineTo(x + step, y + offsetY);
        ctx.stroke();
      }
    }

    // 3. Subtle micro-grain noise for authentic satin wood sheen
    for (let i = 0; i < 35000; i++) {
      const rx = Math.random() * 1024;
      const ry = Math.random() * 1024;
      const lum = Math.random() > 0.6 ? '212, 160, 60' : '240, 230, 215';
      const alpha = Math.random() * 0.028;
      ctx.fillStyle = `rgba(${lum}, ${alpha})`;
      ctx.fillRect(rx, ry, 2, 2);
    }
  });

  if (tex) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 8);
  }
  return tex;
}

/**
 * Creates procedural texture for table tennis net mesh (classic white grid on dark mesh)
 */
function createNetTexture() {
  const tex = createSafeCanvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = 'rgba(10, 15, 20, 0.4)';
    ctx.fillRect(0, 0, 64, 64);

    ctx.strokeStyle = 'rgba(230, 235, 245, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 56, 56);
  });

  if (tex) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(36, 4);
  }
  return tex;
}

/**
 * Creates procedural sponsor & arena banner texture inspired by dark luxury championship branding.
 * Uses prominent IMPULSE typographic branding in the Syne/Outfit display font.
 * Free of any commercial bank logos or slogans.
 */
function createBannerTexture(title = 'IMPULSE', subtitle = 'CHAMPIONSHIP ARENA') {
  return createSafeCanvasTexture(1024, 256, (ctx) => {
    // 1. Dark luxury background gradient
    const grad = ctx.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, '#0a0907');
    grad.addColorStop(0.35, '#151310');
    grad.addColorStop(0.5, '#1c1914');
    grad.addColorStop(0.65, '#151310');
    grad.addColorStop(1, '#0a0907');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 256);

    // 2. Metallic amber gold top and bottom framing trims
    ctx.fillStyle = '#d4a03c';
    ctx.fillRect(0, 0, 1024, 6);
    ctx.fillRect(0, 250, 1024, 6);

    ctx.fillStyle = '#e8b84e';
    ctx.fillRect(0, 6, 1024, 2);
    ctx.fillRect(0, 248, 1024, 2);

    // 3. Prominent IMPULSE display typography in Syne/Outfit
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '800 64px "Syne", "Outfit", "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(212, 160, 60, 0.75)';
    ctx.shadowBlur = 18;
    ctx.letterSpacing = '6px';
    ctx.fillText(title, 512, 102);

    // 4. Refined metallic gold subtitle
    ctx.font = '600 22px "Outfit", "Segoe UI", sans-serif';
    ctx.fillStyle = '#e8b84e';
    ctx.shadowBlur = 0;
    ctx.letterSpacing = '7px';
    ctx.fillText(subtitle, 512, 172);

    // Subtle side accents
    ctx.fillStyle = 'rgba(212, 160, 60, 0.35)';
    ctx.fillRect(120, 170, 80, 1.5);
    ctx.fillRect(1024 - 200, 170, 80, 1.5);
  });
}

/**
 * Builds the regulation table tennis table using procedural geometric primitives.
 * Classic regulation ITTF tournament blue playing surface with crisp white boundary lines,
 * sturdy undercarriage apron frame, tournament net assembly with steel posts,
 * and heavy-duty polished steel legs with leveling feet.
 */
export function createTableTennisTable() {
  const tableGroup = new THREE.Group();
  tableGroup.name = 'TableTennisTable';

  // 1. REGULATION ITTF TOURNAMENT BLUE TABLETOP
  const tableTopMaterial = new THREE.MeshStandardMaterial({
    color: 0x163d70, // Classic regulation ITTF blue
    roughness: 0.35,
    metalness: 0.08,
  });

  const tableTopGeo = new THREE.BoxGeometry(TABLE_WIDTH, TABLE_THICKNESS, TABLE_LENGTH);
  const tableTopMesh = new THREE.Mesh(tableTopGeo, tableTopMaterial);
  tableTopMesh.position.y = TABLE_HEIGHT - TABLE_THICKNESS / 2;
  tableTopMesh.castShadow = true;
  // Never receive directional shadow map to eliminate dark shadow acne / artifacts on playing surface
  tableTopMesh.receiveShadow = false;
  tableGroup.add(tableTopMesh);

  // 2. CRISP REGULATION WHITE BOUNDARY LINES
  // Uses polygonOffset to guarantee zero z-fighting/flicker on any GPU
  const lineWidth = 0.02; // 20mm outer perimeter lines
  const lineMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -4.0,
  });
  const lineElevation = TABLE_HEIGHT + 0.0006;

  // Left & Right Sidelines
  const sideLineGeo = new THREE.PlaneGeometry(lineWidth, TABLE_LENGTH);
  const leftSideLine = new THREE.Mesh(sideLineGeo, lineMat);
  leftSideLine.rotation.x = -Math.PI / 2;
  leftSideLine.position.set(-TABLE_WIDTH / 2 + lineWidth / 2, lineElevation, 0);
  leftSideLine.receiveShadow = false;
  tableGroup.add(leftSideLine);

  const rightSideLine = new THREE.Mesh(sideLineGeo, lineMat);
  rightSideLine.rotation.x = -Math.PI / 2;
  rightSideLine.position.set(TABLE_WIDTH / 2 - lineWidth / 2, lineElevation, 0);
  rightSideLine.receiveShadow = false;
  tableGroup.add(rightSideLine);

  // Near & Far Endlines
  const endLineGeo = new THREE.PlaneGeometry(TABLE_WIDTH, lineWidth);
  const nearEndLine = new THREE.Mesh(endLineGeo, lineMat);
  nearEndLine.rotation.x = -Math.PI / 2;
  nearEndLine.position.set(0, lineElevation, -TABLE_LENGTH / 2 + lineWidth / 2);
  nearEndLine.receiveShadow = false;
  tableGroup.add(nearEndLine);

  const farEndLine = new THREE.Mesh(endLineGeo, lineMat);
  farEndLine.rotation.x = -Math.PI / 2;
  farEndLine.position.set(0, lineElevation, TABLE_LENGTH / 2 - lineWidth / 2);
  farEndLine.receiveShadow = false;
  tableGroup.add(farEndLine);

  // Center 3mm Division Line
  const centerLineGeo = new THREE.PlaneGeometry(0.003, TABLE_LENGTH);
  const centerLine = new THREE.Mesh(centerLineGeo, lineMat);
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.set(0, lineElevation, 0);
  centerLine.receiveShadow = false;
  tableGroup.add(centerLine);

  // 3. UNDER-TABLE APRON FRAME (Classic tournament dark navy/black steel)
  const apronMaterial = new THREE.MeshStandardMaterial({
    color: 0x0c1e36,
    roughness: 0.5,
    metalness: 0.35,
  });

  const apronHeight = 0.052;
  const sideApronGeo = new THREE.BoxGeometry(0.015, apronHeight, TABLE_LENGTH - 0.04);
  const leftApron = new THREE.Mesh(sideApronGeo, apronMaterial);
  leftApron.position.set(-TABLE_WIDTH / 2 + 0.02, TABLE_HEIGHT - TABLE_THICKNESS - apronHeight / 2, 0);
  tableGroup.add(leftApron);

  const rightApron = new THREE.Mesh(sideApronGeo, apronMaterial);
  rightApron.position.set(TABLE_WIDTH / 2 - 0.02, TABLE_HEIGHT - TABLE_THICKNESS - apronHeight / 2, 0);
  tableGroup.add(rightApron);

  const endApronGeo = new THREE.BoxGeometry(TABLE_WIDTH - 0.04, apronHeight, 0.015);
  const nearApron = new THREE.Mesh(endApronGeo, apronMaterial);
  nearApron.position.set(0, TABLE_HEIGHT - TABLE_THICKNESS - apronHeight / 2, -TABLE_LENGTH / 2 + 0.02);
  tableGroup.add(nearApron);

  const farApron = new THREE.Mesh(endApronGeo, apronMaterial);
  farApron.position.set(0, TABLE_HEIGHT - TABLE_THICKNESS - apronHeight / 2, TABLE_LENGTH / 2 - 0.02);
  tableGroup.add(farApron);

  // 4. POLISHED TOURNAMENT STEEL LEGS & UNDERCARRIAGE
  // Heavy-duty 54mm square steel tubing positioned prominently at outer corners and center net-line
  const legThickness = 0.054;
  const legHeight = TABLE_HEIGHT - TABLE_THICKNESS;
  const legGeo = new THREE.BoxGeometry(legThickness, legHeight, legThickness);
  const steelLegMat = new THREE.MeshStandardMaterial({
    color: 0x8294a6, // Polished tournament championship metallic steel
    roughness: 0.28,
    metalness: 0.78,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e7ee, // Machined stainless / bright chrome
    roughness: 0.18,
    metalness: 0.92,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x181818, // Dense vulcanized rubber
    roughness: 0.85,
    metalness: 0.05,
  });

  const rubberFootMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

  // Outer corner placement so legs clearly frame the table and are immediately visible to player & spectators
  const legOffsetX = TABLE_WIDTH / 2 - 0.05;
  const legOffsetZ = TABLE_LENGTH / 2 - 0.16;
  const legY = legHeight / 2;

  // 6 Tournament legs: 4 outer corner legs + 2 center legs at net line
  const legConfigs = [
    { x: -legOffsetX, z: -legOffsetZ }, // South West
    { x: legOffsetX, z: -legOffsetZ },  // South East
    { x: -legOffsetX, z: legOffsetZ },  // North West
    { x: legOffsetX, z: legOffsetZ },   // North East
    { x: -legOffsetX * 0.94, z: 0 },    // Center West (Net line)
    { x: legOffsetX * 0.94, z: 0 },     // Center East (Net line)
  ];

  const levelerCupGeo = new THREE.CylinderGeometry(0.046, 0.054, 0.020, 24);
  const levelerRubberGeo = new THREE.CylinderGeometry(0.052, 0.054, 0.008, 24);
  const levelerStemGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.026, 16);
  const collarGeo = new THREE.BoxGeometry(0.076, 0.018, 0.076);

  legConfigs.forEach((cfg) => {
    // Main tubular steel leg
    const leg = new THREE.Mesh(legGeo, steelLegMat);
    leg.position.set(cfg.x, legY, cfg.z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    tableGroup.add(leg);

    // Chrome collar flange bracket connecting leg to the under-apron
    const collar = new THREE.Mesh(collarGeo, chromeMat);
    collar.position.set(cfg.x, TABLE_HEIGHT - TABLE_THICKNESS - 0.009, cfg.z);
    tableGroup.add(collar);

    // Chrome threaded leveling stem
    const stem = new THREE.Mesh(levelerStemGeo, chromeMat);
    stem.position.set(cfg.x, 0.026, cfg.z);
    tableGroup.add(stem);

    // Machined chrome leveling foot cup
    const footCup = new THREE.Mesh(levelerCupGeo, chromeMat);
    footCup.position.set(cfg.x, 0.014, cfg.z);
    footCup.castShadow = true;
    tableGroup.add(footCup);

    // Non-slip vulcanized rubber floor pad
    const rubberPad = new THREE.Mesh(levelerRubberGeo, rubberFootMat);
    rubberPad.position.set(cfg.x, 0.004, cfg.z);
    tableGroup.add(rubberPad);
  });

  // Sturdy cross-bracing linkage bars connecting left & right leg pairs
  const crossBraceGeo = new THREE.CylinderGeometry(0.014, 0.014, TABLE_WIDTH - 0.10, 16);
  const bracePositionsZ = [-legOffsetZ, 0, legOffsetZ];
  bracePositionsZ.forEach((bz) => {
    const brace = new THREE.Mesh(crossBraceGeo, steelLegMat);
    brace.rotation.z = Math.PI / 2;
    brace.position.set(0, 0.22, bz);
    tableGroup.add(brace);

    // Chrome coupling rings on brace ends
    for (let side of [-1, 1]) {
      const ringGeo = new THREE.CylinderGeometry(0.020, 0.020, 0.024, 16);
      const ring = new THREE.Mesh(ringGeo, chromeMat);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(side * (legOffsetX - 0.022), 0.22, bz);
      tableGroup.add(ring);
    }
  });

  // Diagonal structural linkage struts connecting legs to center undercarriage
  const strutLength = Math.hypot(legOffsetX * 0.42, 0.36, legOffsetZ * 0.52);
  const strutGeo = new THREE.CylinderGeometry(0.011, 0.011, strutLength, 12);
  for (let sx of [-1, 1]) {
    for (let sz of [-1, 1]) {
      const strut = new THREE.Mesh(strutGeo, steelLegMat);
      strut.position.set(sx * (legOffsetX * 0.62), 0.38, sz * (legOffsetZ * 0.52));
      strut.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-sx * 0.35, 0.65, -sz * 0.65).normalize()
      );
      tableGroup.add(strut);
    }
  }

  // Central ITTF Undercarriage Transport Wheel Carriage (4 heavy-duty dual-caster wheels at net line)
  const wheelHubGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.026, 16);
  const wheelTireGeo = new THREE.CylinderGeometry(0.046, 0.046, 0.022, 20);
  const wheelAxleGeo = new THREE.CylinderGeometry(0.010, 0.010, TABLE_WIDTH - 0.30, 16);

  const wheelAxle = new THREE.Mesh(wheelAxleGeo, steelLegMat);
  wheelAxle.rotation.z = Math.PI / 2;
  wheelAxle.position.set(0, 0.046, 0);
  tableGroup.add(wheelAxle);

  const wheelPositionsX = [-0.42, -0.18, 0.18, 0.42];
  wheelPositionsX.forEach((wx) => {
    // Rubber tire
    const tire = new THREE.Mesh(wheelTireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(wx, 0.046, 0);
    tire.castShadow = true;
    tableGroup.add(tire);

    // Chrome center hub
    const hub = new THREE.Mesh(wheelHubGeo, chromeMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, 0.046, 0);
    tableGroup.add(hub);

    // Vertical wheel caster strut connecting axle to undercarriage center crossbar
    const casterStrutGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.174, 12);
    const casterStrut = new THREE.Mesh(casterStrutGeo, steelLegMat);
    casterStrut.position.set(wx, 0.133, 0);
    tableGroup.add(casterStrut);
  });

  // 5. REGULATION TOURNAMENT NET ASSEMBLY
  const totalNetWidth = TABLE_WIDTH + NET_OVERHANG * 2;
  const netGeo = new THREE.PlaneGeometry(totalNetWidth, NET_HEIGHT);
  const netTex = createNetTexture();
  const netMat = new THREE.MeshStandardMaterial({
    map: netTex,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    roughness: 0.90,
  });

  const netMesh = new THREE.Mesh(netGeo, netMat);
  netMesh.position.set(0, TABLE_HEIGHT + NET_HEIGHT / 2, 0);
  netMesh.castShadow = true;
  tableGroup.add(netMesh);

  // Crisp White Top Tape Band
  const netTopTapeGeo = new THREE.BoxGeometry(totalNetWidth, 0.015, 0.006);
  const netTopTapeMat = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.30,
  });
  const netTopTape = new THREE.Mesh(netTopTapeGeo, netTopTapeMat);
  netTopTape.position.set(0, TABLE_HEIGHT + NET_HEIGHT - 0.0075, 0);
  tableGroup.add(netTopTape);

  // White Bottom Tape Band
  const netBottomTapeGeo = new THREE.BoxGeometry(totalNetWidth, 0.008, 0.006);
  const netBottomTape = new THREE.Mesh(netBottomTapeGeo, netTopTapeMat);
  netBottomTape.position.set(0, TABLE_HEIGHT + 0.004, 0);
  tableGroup.add(netBottomTape);

  // Tournament Steel Net Posts & Clamp Fixtures
  const postGeo = new THREE.CylinderGeometry(0.015, 0.015, NET_HEIGHT + 0.06, 16);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x333842,
    roughness: 0.30,
    metalness: 0.80,
  });

  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(-totalNetWidth / 2, TABLE_HEIGHT + NET_HEIGHT / 2 - 0.01, 0);
  leftPost.castShadow = true;
  tableGroup.add(leftPost);

  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(totalNetWidth / 2, TABLE_HEIGHT + NET_HEIGHT / 2 - 0.01, 0);
  rightPost.castShadow = true;
  tableGroup.add(rightPost);

  // Net Post Table Clamps
  for (let side of [-1, 1]) {
    const clampGeo = new THREE.BoxGeometry(0.038, 0.055, 0.045);
    const clamp = new THREE.Mesh(clampGeo, postMat);
    clamp.position.set(side * (totalNetWidth / 2), TABLE_HEIGHT - 0.012, 0);
    tableGroup.add(clamp);

    // Tension Adjustment Dial
    const dialGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16);
    const dial = new THREE.Mesh(dialGeo, chromeMat);
    dial.position.set(side * (totalNetWidth / 2), TABLE_HEIGHT + NET_HEIGHT + 0.02, 0);
    tableGroup.add(dial);
  }

  return tableGroup;
}

/**
 * Creates a procedural 3D Table Tennis Paddle.
 * Restores the classic, authentic competition racket design:
 * - Natural 5-ply wood blade
 * - Iconic competition red rubber forehand
 * - Classic competition black rubber backhand
 * - Protective edge tape
 * - Flared ergonomic wooden handle with mahogany inlay grip stripe
 * - children[0].castShadow = false for 60fps performance pipeline
 */
export function createPaddle(primaryColor = 'red') {
  const paddleGroup = new THREE.Group();
  paddleGroup.name = `Paddle_${primaryColor}`;

  const bladeRadius = 0.082;
  const bladeThickness = 0.008;
  const rubberThickness = 0.0025;

  // 1. Blade Core: Laminated natural birch / 5-ply wood
  const bladeGeo = new THREE.CylinderGeometry(bladeRadius, bladeRadius, bladeThickness, 36);
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0xd9b382,
    roughness: 0.60,
    metalness: 0.05,
  });
  const blade = new THREE.Mesh(bladeGeo, woodMat);
  blade.rotation.x = Math.PI / 2;
  blade.position.y = bladeRadius;
  blade.castShadow = false; // Strictly false for dynamic mesh optimization
  paddleGroup.add(blade);

  // 2. Forehand Rubber Face: Iconic Competition Red
  const rubberGeo = new THREE.CylinderGeometry(bladeRadius - 0.001, bladeRadius - 0.001, rubberThickness, 36);
  const redRubberMat = new THREE.MeshStandardMaterial({
    color: 0xd91616,
    roughness: 0.32,
    metalness: 0.05,
  });
  const redFace = new THREE.Mesh(rubberGeo, redRubberMat);
  redFace.rotation.x = Math.PI / 2;
  redFace.position.set(0, bladeRadius, -bladeThickness / 2 - rubberThickness / 2);
  redFace.castShadow = false;
  paddleGroup.add(redFace);

  // 3. Backhand Rubber Face: Classic Competition Black
  const blackRubberMat = new THREE.MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.35,
    metalness: 0.05,
  });
  const blackFace = new THREE.Mesh(rubberGeo, blackRubberMat);
  blackFace.rotation.x = Math.PI / 2;
  blackFace.position.set(0, bladeRadius, bladeThickness / 2 + rubberThickness / 2);
  blackFace.castShadow = false;
  paddleGroup.add(blackFace);

  // 4. Protective Edge Tape
  const edgeGeo = new THREE.TorusGeometry(bladeRadius, (bladeThickness + rubberThickness * 2) / 2, 8, 36);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: primaryColor === 'red' ? 0x0044ff : 0xd4af37,
    roughness: 0.40,
    metalness: 0.20,
  });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.set(0, bladeRadius, 0);
  edge.castShadow = false;
  paddleGroup.add(edge);

  // 5. Flared Ergonomic Wooden Handle
  const handleLength = 0.105;
  const handleWidth = 0.028;
  const handleThickness = 0.022;

  const handleGroup = new THREE.Group();

  const handleGeo = new THREE.BoxGeometry(handleWidth, handleLength, handleThickness);
  const handleWoodMat = new THREE.MeshStandardMaterial({
    color: 0xc89968,
    roughness: 0.50,
  });
  const handle = new THREE.Mesh(handleGeo, handleWoodMat);
  handle.position.y = -handleLength / 2 + 0.01;
  handle.castShadow = false;
  handleGroup.add(handle);

  // Contrasting Mahogany / Walnut Inlay Grip Stripe
  const stripeGeo = new THREE.BoxGeometry(0.006, handleLength - 0.01, handleThickness + 0.002);
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0x3d2314,
    roughness: 0.50,
  });
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  stripe.position.y = -handleLength / 2 + 0.01;
  stripe.castShadow = false;
  handleGroup.add(stripe);

  paddleGroup.add(handleGroup);

  return paddleGroup;
}

/**
 * Creates the high-visibility 3D table tennis ball tailored to dark luxury aesthetic.
 * Features a warm champagne pearl core with warm amber emissive glow, plus luminous aura.
 * Preserves children[0].castShadow = false for performance optimization assertions.
 */
export function createBall() {
  const ballGroup = new THREE.Group();
  ballGroup.name = 'TableTennisBall';

  // High-visibility warm champagne pearl core with luminous amber emission
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xfffcf5,
    roughness: 0.18,
    metalness: 0.06,
    emissive: 0xd4a03c,
    emissiveIntensity: 0.85,
  });

  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = false; // Strictly false for dynamic mesh optimization
  ballMesh.receiveShadow = false;
  ballGroup.add(ballMesh);

  // Luminous warm amber halo
  const haloGeo = new THREE.SphereGeometry(BALL_RADIUS * 1.25, 16, 16);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xd4a03c,
    transparent: true,
    opacity: 0.32,
    side: THREE.BackSide,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  ballGroup.add(halo);

  ballGroup.userData = {
    mesh: ballMesh,
    material: ballMat,
  };

  return ballGroup;
}

/**
 * Creates the immersive dark luxury championship arena environment.
 * Features:
 * - Architectural dark hardwood/slate parquet floor
 * - 4-sided IMPULSE championship banners (zero bank references)
 * - 4-tiered grandstands surrounding the court
 * - Dense spectator crowd of 260+ fans rendered via THREE.InstancedMesh (only 2 draw calls!)
 * - Elevated tournament umpire high-chair at midline
 */
export function createArenaEnvironment() {
  const arenaGroup = new THREE.Group();
  arenaGroup.name = 'ArenaEnvironment';

  // 1. COURT FLOOR
  const floorGeo = new THREE.PlaneGeometry(36, 44);
  const floorTex = createFloorTexture();
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    color: 0x12110e,
    roughness: 0.75,
    metalness: 0.15,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  arenaGroup.add(floor);

  // 2. ARENA SURROUND BARRIERS (IMPULSE BRANDED)
  const barrierHeight = 0.95;
  const bannerFar = createBannerTexture('IMPULSE', 'CHAMPIONSHIP ARENA');
  const bannerNear = createBannerTexture('IMPULSE', 'TOUCHLESS PHYSICAL ARCADE');
  const bannerSideLeft = createBannerTexture('IMPULSE', 'MOTION TRACKED SPORTS');
  const bannerSideRight = createBannerTexture('IMPULSE', 'PRECISION & MASTERY');

  const bannerMatFar = new THREE.MeshStandardMaterial({ map: bannerFar, roughness: 0.4 });
  const bannerMatNear = new THREE.MeshStandardMaterial({ map: bannerNear, roughness: 0.4 });
  const bannerMatLeft = new THREE.MeshStandardMaterial({ map: bannerSideLeft, roughness: 0.4 });
  const bannerMatRight = new THREE.MeshStandardMaterial({ map: bannerSideRight, roughness: 0.4 });

  // Metallic gold top rail cap for barriers
  const railCapMat = new THREE.MeshStandardMaterial({
    color: 0xd4a03c,
    roughness: 0.3,
    metalness: 0.8,
  });

  // Far barrier (+Z)
  const farBarrierGeo = new THREE.BoxGeometry(16, barrierHeight, 0.1);
  const farBarrier = new THREE.Mesh(farBarrierGeo, bannerMatFar);
  farBarrier.position.set(0, barrierHeight / 2, 7.5);
  farBarrier.castShadow = true;
  farBarrier.receiveShadow = true;
  arenaGroup.add(farBarrier);

  const farRail = new THREE.Mesh(new THREE.BoxGeometry(16.02, 0.02, 0.12), railCapMat);
  farRail.position.set(0, barrierHeight + 0.01, 7.5);
  arenaGroup.add(farRail);

  // Near barrier (-Z)
  const nearBarrier = new THREE.Mesh(farBarrierGeo, bannerMatNear);
  nearBarrier.position.set(0, barrierHeight / 2, -7.5);
  nearBarrier.castShadow = true;
  nearBarrier.receiveShadow = true;
  arenaGroup.add(nearBarrier);

  const nearRail = new THREE.Mesh(new THREE.BoxGeometry(16.02, 0.02, 0.12), railCapMat);
  nearRail.position.set(0, barrierHeight + 0.01, -7.5);
  arenaGroup.add(nearRail);

  // Left barrier (-X)
  const sideBarrierGeo = new THREE.BoxGeometry(0.1, barrierHeight, 15);
  const leftBarrier = new THREE.Mesh(sideBarrierGeo, bannerMatLeft);
  leftBarrier.position.set(-6.5, barrierHeight / 2, 0);
  leftBarrier.castShadow = true;
  leftBarrier.receiveShadow = true;
  arenaGroup.add(leftBarrier);

  const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 15.02), railCapMat);
  leftRail.position.set(-6.5, barrierHeight + 0.01, 0);
  arenaGroup.add(leftRail);

  // Right barrier (+X)
  const rightBarrier = new THREE.Mesh(sideBarrierGeo, bannerMatRight);
  rightBarrier.position.set(6.5, barrierHeight / 2, 0);
  rightBarrier.castShadow = true;
  rightBarrier.receiveShadow = true;
  arenaGroup.add(rightBarrier);

  const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 15.02), railCapMat);
  rightRail.position.set(6.5, barrierHeight + 0.01, 0);
  arenaGroup.add(rightRail);

  // 3. TIERED STADIUM GRANDSTANDS
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x11100e,
    roughness: 0.85,
    metalness: 0.2,
  });

  const balustradeMat = new THREE.MeshStandardMaterial({
    color: 0xd4a03c,
    roughness: 0.35,
    metalness: 0.75,
  });

  const spectatorPositions = [];

  // Far Grandstand (+Z, 4 tiers)
  const farTiers = 4;
  for (let i = 0; i < farTiers; i++) {
    const tierHeight = 1.15;
    const tierDepth = 2.1;
    const y = barrierHeight + i * tierHeight;
    const z = 7.6 + i * tierDepth;

    const tierGeo = new THREE.BoxGeometry(26, tierHeight, tierDepth);
    const tier = new THREE.Mesh(tierGeo, standMat);
    tier.position.set(0, y - tierHeight / 2, z + tierDepth / 2);
    arenaGroup.add(tier);

    // Gold safety balustrade railing
    const railGeo = new THREE.BoxGeometry(26, 0.02, 0.03);
    const rail = new THREE.Mesh(railGeo, balustradeMat);
    rail.position.set(0, y + 0.75, z + 0.05);
    arenaGroup.add(rail);

    // Generate spectator seats along this row
    const countInRow = 28;
    for (let s = 0; s < countInRow; s++) {
      const x = -11.5 + (s / (countInRow - 1)) * 23.0;
      spectatorPositions.push({
        x: x + (Math.random() - 0.5) * 0.12,
        y: y,
        z: z + tierDepth * 0.45 + (Math.random() - 0.5) * 0.1,
        lookTarget: [0, TABLE_HEIGHT, 0],
      });
    }
  }

  // Near Grandstand (-Z, 3 tiers behind player)
  const nearTiers = 3;
  for (let i = 0; i < nearTiers; i++) {
    const tierHeight = 1.15;
    const tierDepth = 2.1;
    const y = barrierHeight + i * tierHeight;
    const z = -7.6 - i * tierDepth;

    const tierGeo = new THREE.BoxGeometry(26, tierHeight, tierDepth);
    const tier = new THREE.Mesh(tierGeo, standMat);
    tier.position.set(0, y - tierHeight / 2, z - tierDepth / 2);
    arenaGroup.add(tier);

    const railGeo = new THREE.BoxGeometry(26, 0.02, 0.03);
    const rail = new THREE.Mesh(railGeo, balustradeMat);
    rail.position.set(0, y + 0.75, z - 0.05);
    arenaGroup.add(rail);

    const countInRow = 24;
    for (let s = 0; s < countInRow; s++) {
      const x = -10.5 + (s / (countInRow - 1)) * 21.0;
      spectatorPositions.push({
        x: x + (Math.random() - 0.5) * 0.12,
        y: y,
        z: z - tierDepth * 0.45 + (Math.random() - 0.5) * 0.1,
        lookTarget: [0, TABLE_HEIGHT, 0],
      });
    }
  }

  // Left Grandstand (-X, 3 tiers)
  const leftTiers = 3;
  for (let i = 0; i < leftTiers; i++) {
    const tierHeight = 1.15;
    const tierDepth = 2.1;
    const y = barrierHeight + i * tierHeight;
    const x = -6.6 - i * tierDepth;

    const tierGeo = new THREE.BoxGeometry(tierDepth, tierHeight, 20);
    const tier = new THREE.Mesh(tierGeo, standMat);
    tier.position.set(x - tierDepth / 2, y - tierHeight / 2, 0);
    arenaGroup.add(tier);

    const countInRow = 15;
    for (let s = 0; s < countInRow; s++) {
      const z = -7.5 + (s / (countInRow - 1)) * 15.0;
      spectatorPositions.push({
        x: x - tierDepth * 0.45 + (Math.random() - 0.5) * 0.1,
        y: y,
        z: z + (Math.random() - 0.5) * 0.12,
        lookTarget: [0, TABLE_HEIGHT, 0],
      });
    }
  }

  // Right Grandstand (+X, 3 tiers)
  const rightTiers = 3;
  for (let i = 0; i < rightTiers; i++) {
    const tierHeight = 1.15;
    const tierDepth = 2.1;
    const y = barrierHeight + i * tierHeight;
    const x = 6.6 + i * tierDepth;

    const tierGeo = new THREE.BoxGeometry(tierDepth, tierHeight, 20);
    const tier = new THREE.Mesh(tierGeo, standMat);
    tier.position.set(x + tierDepth / 2, y - tierHeight / 2, 0);
    arenaGroup.add(tier);

    const countInRow = 15;
    for (let s = 0; s < countInRow; s++) {
      const z = -7.5 + (s / (countInRow - 1)) * 15.0;
      spectatorPositions.push({
        x: x + tierDepth * 0.45 + (Math.random() - 0.5) * 0.1,
        y: y,
        z: z + (Math.random() - 0.5) * 0.12,
        lookTarget: [0, TABLE_HEIGHT, 0],
      });
    }
  }

  // 4. DENSE SPECTATOR CROWD (260+ SPECTATORS VIA THREE.InstancedMesh - ONLY 2 DRAW CALLS!)
  const totalSpectators = spectatorPositions.length;

  // Dark luxury spectator clothing palette
  const wardrobeColors = [
    new THREE.Color(0x1a1917), // Charcoal black
    new THREE.Color(0x131a26), // Midnight navy
    new THREE.Color(0x3d1419), // Deep royal burgundy
    new THREE.Color(0x5c4228), // Warm camel / cognac
    new THREE.Color(0x4a3618), // Dark amber bronze
    new THREE.Color(0x28292c), // Smoked slate
    new THREE.Color(0x22281e), // Forest olive
    new THREE.Color(0x261d18), // Dark espresso
    new THREE.Color(0x6e685f), // Muted stone
  ];

  // Natural head and hair tones
  const headColors = [
    new THREE.Color(0xd8ad88),
    new THREE.Color(0xc68b59),
    new THREE.Color(0x9e6538),
    new THREE.Color(0x5c3818),
    new THREE.Color(0x2c1a10),
    new THREE.Color(0x1e1612),
    new THREE.Color(0x482d1c),
    new THREE.Color(0x321e14),
  ];

  // Body instance mesh (seated torso and shoulders)
  const bodyGeo = new THREE.CylinderGeometry(0.20, 0.24, 0.62, 12);
  const bodyMat = new THREE.MeshStandardMaterial({
    roughness: 0.72,
    metalness: 0.15,
  });
  const bodyInstancedMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, totalSpectators);

  // Head instance mesh
  const headGeo = new THREE.SphereGeometry(0.115, 12, 12);
  const headMat = new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0.05,
  });
  const headInstancedMesh = new THREE.InstancedMesh(headGeo, headMat, totalSpectators);

  const dummyMatrix = new THREE.Matrix4();
  const dummyPos = new THREE.Vector3();
  const dummyQuat = new THREE.Quaternion();
  const dummyScale = new THREE.Vector3();
  const upVec = new THREE.Vector3(0, 1, 0);

  spectatorPositions.forEach((spec, i) => {
    // Height & posture scale variations
    const heightScale = 0.92 + Math.random() * 0.16;
    const bodyHeight = 0.62 * heightScale;
    const seatedY = spec.y + bodyHeight / 2;

    dummyPos.set(spec.x, seatedY, spec.z);

    // Orientation: face towards the table center with natural angle jitter
    const dx = spec.lookTarget[0] - spec.x;
    const dz = spec.lookTarget[2] - spec.z;
    const baseYaw = Math.atan2(dx, dz);
    const yawJitter = (Math.random() - 0.5) * 0.35;
    const pitchJitter = (Math.random() - 0.5) * 0.08;

    const euler = new THREE.Euler(pitchJitter, baseYaw + yawJitter, 0, 'YXZ');
    dummyQuat.setFromEuler(euler);
    dummyScale.set(1.0, heightScale, 1.0);

    // Transform body
    dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
    bodyInstancedMesh.setMatrixAt(i, dummyMatrix);

    // Assign randomized dark luxury clothing color
    const bodyColor = wardrobeColors[Math.floor(Math.random() * wardrobeColors.length)];
    bodyInstancedMesh.setColorAt(i, bodyColor);

    // Transform head
    const headY = seatedY + bodyHeight / 2 + 0.125 * heightScale;
    dummyPos.set(spec.x, headY, spec.z);
    dummyScale.set(1.0, 1.0, 1.0);
    dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
    headInstancedMesh.setMatrixAt(i, dummyMatrix);

    // Assign natural head color
    const headColor = headColors[Math.floor(Math.random() * headColors.length)];
    headInstancedMesh.setColorAt(i, headColor);
  });

  if (bodyInstancedMesh.instanceColor) bodyInstancedMesh.instanceColor.needsUpdate = true;
  if (headInstancedMesh.instanceColor) headInstancedMesh.instanceColor.needsUpdate = true;

  bodyInstancedMesh.instanceMatrix.needsUpdate = true;
  headInstancedMesh.instanceMatrix.needsUpdate = true;

  arenaGroup.add(bodyInstancedMesh);
  arenaGroup.add(headInstancedMesh);

  // 5. TOURNAMENT UMPIRE HIGH-CHAIR AT COURT MIDLINE
  const umpireGroup = new THREE.Group();
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x181816, roughness: 0.4, metalness: 0.7 });
  const chairGoldMat = new THREE.MeshStandardMaterial({ color: 0xd4a03c, roughness: 0.3, metalness: 0.8 });

  // Elevated structure legs
  const chairLegGeo = new THREE.CylinderGeometry(0.02, 0.025, 2.0, 8);
  const leftFrontLeg = new THREE.Mesh(chairLegGeo, chairMat);
  leftFrontLeg.position.set(-4.85, 1.0, -0.35);
  umpireGroup.add(leftFrontLeg);

  const rightFrontLeg = new THREE.Mesh(chairLegGeo, chairMat);
  rightFrontLeg.position.set(-4.85, 1.0, 0.35);
  umpireGroup.add(rightFrontLeg);

  const backLeg = new THREE.Mesh(chairLegGeo, chairMat);
  backLeg.position.set(-5.35, 1.0, 0);
  umpireGroup.add(backLeg);

  // Elevated seat
  const seatGeo = new THREE.BoxGeometry(0.5, 0.04, 0.5);
  const seat = new THREE.Mesh(seatGeo, chairGoldMat);
  seat.position.set(-5.0, 2.0, 0);
  umpireGroup.add(seat);

  const backrestGeo = new THREE.BoxGeometry(0.04, 0.4, 0.5);
  const backrest = new THREE.Mesh(backrestGeo, chairGoldMat);
  backrest.position.set(-5.23, 2.22, 0);
  umpireGroup.add(backrest);

  // Seated tournament referee
  const refBodyGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.6, 12);
  const refBodyMat = new THREE.MeshStandardMaterial({ color: 0x1f1e1b, roughness: 0.6 });
  const refBody = new THREE.Mesh(refBodyGeo, refBodyMat);
  refBody.position.set(-5.0, 2.34, 0);
  refBody.rotation.y = Math.PI / 2; // Looking directly across the net
  umpireGroup.add(refBody);

  const refHeadGeo = new THREE.SphereGeometry(0.11, 12, 12);
  const refHeadMat = new THREE.MeshStandardMaterial({ color: 0xd8ad88, roughness: 0.5 });
  const refHead = new THREE.Mesh(refHeadGeo, refHeadMat);
  refHead.position.set(-5.0, 2.72, 0);
  umpireGroup.add(refHead);

  arenaGroup.add(umpireGroup);

  return arenaGroup;
}

/**
 * Creates a static baked shadow plane beneath the table.
 * Uses a soft radial/box gradient to simulate realistic ambient occlusion & contact shadow on the floor
 * with zero real-time GPU shadow map update overhead.
 */
export function createBakedTableShadow(width = TABLE_WIDTH, length = TABLE_LENGTH) {
  let texture = null;
  if (typeof document !== 'undefined' && document.createElement) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const cx = 128;
        const cy = 128;
        const grad = ctx.createRadialGradient(cx, cy, 35, cx, cy, 124);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
        grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.42)');
        grad.addColorStop(0.8, 'rgba(0, 0, 0, 0.12)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 256);
        texture = new THREE.CanvasTexture(canvas);
      }
    } catch (e) {}
  }

  const geo = new THREE.PlaneGeometry(width * 1.35, length * 1.18);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    color: texture ? 0xffffff : 0x000000,
    transparent: true,
    opacity: texture ? 0.75 : 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.003, 0); // Positioned slightly above the floor
  mesh.name = 'BakedTableShadow';
  return mesh;
}
