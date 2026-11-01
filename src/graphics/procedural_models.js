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
 * Creates procedural canvas texture for the court floor / hardwood arena
 */
function createFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2b4736';
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.strokeStyle = '#243e2f';
  ctx.lineWidth = 2;
  const step = 64;
  for (let x = 0; x < 1024; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1024);
    ctx.stroke();
  }
  for (let y = 0; y < 1024; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }

  for (let i = 0; i < 40000; i++) {
    const rx = Math.random() * 1024;
    const ry = Math.random() * 1024;
    const lum = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${lum}, ${lum}, ${lum}, 0.02)`;
    ctx.fillRect(rx, ry, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 8);
  return texture;
}

/**
 * Creates procedural texture for table tennis net mesh
 */
function createNetTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(10, 15, 20, 0.4)';
  ctx.fillRect(0, 0, 64, 64);

  ctx.strokeStyle = 'rgba(230, 235, 245, 0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 56, 56);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(36, 4);
  return texture;
}

/**
 * Creates procedural sponsor banner texture inspired by Xbox 360 tennis titles
 */
function createBannerTexture(title, subtitle = 'WORLD CHAMPIONSHIP') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#0a2218');
  grad.addColorStop(0.5, '#123928');
  grad.addColorStop(1, '#0a2218');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 256);

  ctx.fillStyle = '#00ff88';
  ctx.fillRect(0, 0, 1024, 8);
  ctx.fillStyle = '#00bbff';
  ctx.fillRect(0, 248, 1024, 8);

  ctx.font = 'bold 54px "Segoe UI", "Helvetica Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 255, 136, 0.6)';
  ctx.shadowBlur = 12;
  ctx.fillText(title, 512, 100);

  ctx.font = 'bold 24px "Segoe UI", sans-serif';
  ctx.fillStyle = '#8ceebb';
  ctx.shadowBlur = 0;
  ctx.letterSpacing = '4px';
  ctx.fillText(subtitle, 512, 170);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * Builds the regulation table tennis table using procedural geometric primitives
 */
export function createTableTennisTable() {
  const tableGroup = new THREE.Group();
  tableGroup.name = 'TableTennisTable';

  const tableTopMaterial = new THREE.MeshStandardMaterial({
    color: 0x163d70,
    roughness: 0.35,
    metalness: 0.08,
  });

  const tableTopGeo = new THREE.BoxGeometry(TABLE_WIDTH, TABLE_THICKNESS, TABLE_LENGTH);
  const tableTopMesh = new THREE.Mesh(tableTopGeo, tableTopMaterial);
  tableTopMesh.position.y = TABLE_HEIGHT - TABLE_THICKNESS / 2;
  tableTopMesh.castShadow = true;
  tableTopMesh.receiveShadow = true;
  tableGroup.add(tableTopMesh);

  const lineWidth = 0.02;
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lineElevation = TABLE_HEIGHT + 0.0005;

  const sideLineGeo = new THREE.PlaneGeometry(lineWidth, TABLE_LENGTH);
  const leftSideLine = new THREE.Mesh(sideLineGeo, lineMat);
  leftSideLine.rotation.x = -Math.PI / 2;
  leftSideLine.position.set(-TABLE_WIDTH / 2 + lineWidth / 2, lineElevation, 0);
  tableGroup.add(leftSideLine);

  const rightSideLine = new THREE.Mesh(sideLineGeo, lineMat);
  rightSideLine.rotation.x = -Math.PI / 2;
  rightSideLine.position.set(TABLE_WIDTH / 2 - lineWidth / 2, lineElevation, 0);
  tableGroup.add(rightSideLine);

  const endLineGeo = new THREE.PlaneGeometry(TABLE_WIDTH, lineWidth);
  const nearEndLine = new THREE.Mesh(endLineGeo, lineMat);
  nearEndLine.rotation.x = -Math.PI / 2;
  nearEndLine.position.set(0, lineElevation, -TABLE_LENGTH / 2 + lineWidth / 2);
  tableGroup.add(nearEndLine);

  const farEndLine = new THREE.Mesh(endLineGeo, lineMat);
  farEndLine.rotation.x = -Math.PI / 2;
  farEndLine.position.set(0, lineElevation, TABLE_LENGTH / 2 - lineWidth / 2);
  tableGroup.add(farEndLine);

  const centerLineGeo = new THREE.PlaneGeometry(0.003, TABLE_LENGTH);
  const centerLine = new THREE.Mesh(centerLineGeo, lineMat);
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.set(0, lineElevation, 0);
  tableGroup.add(centerLine);

  const apronMaterial = new THREE.MeshStandardMaterial({
    color: 0x0c1e36,
    roughness: 0.6,
    metalness: 0.3,
  });

  const apronHeight = 0.05;
  const sideApronGeo = new THREE.BoxGeometry(0.015, apronHeight, TABLE_LENGTH - 0.04);
  const leftApron = new THREE.Mesh(sideApronGeo, apronMaterial);
  leftApron.position.set(-TABLE_WIDTH / 2 + 0.02, TABLE_HEIGHT - TABLE_THICKNESS - apronHeight / 2, 0);
  tableGroup.add(leftApron);

  const rightApron = new THREE.Mesh(sideApronGeo, apronMaterial);
  rightApron.position.set(TABLE_WIDTH / 2 - 0.02, TABLE_HEIGHT - TABLE_THICKNESS - apronHeight / 2, 0);
  tableGroup.add(rightApron);

  const legGeo = new THREE.BoxGeometry(0.045, TABLE_HEIGHT - TABLE_THICKNESS, 0.045);
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x22262c,
    roughness: 0.4,
    metalness: 0.6,
  });

  const legOffsetX = TABLE_WIDTH / 2 - 0.12;
  const legOffsetZ = TABLE_LENGTH / 2 - 0.22;
  const legY = (TABLE_HEIGHT - TABLE_THICKNESS) / 2;

  const legPositions = [
    [-legOffsetX, legY, -legOffsetZ],
    [legOffsetX, legY, -legOffsetZ],
    [-legOffsetX, legY, legOffsetZ],
    [legOffsetX, legY, legOffsetZ],
    [-legOffsetX * 0.85, legY, 0],
    [legOffsetX * 0.85, legY, 0],
  ];

  legPositions.forEach((pos) => {
    const leg = new THREE.Mesh(legGeo, legMaterial);
    leg.position.set(pos[0], pos[1], pos[2]);
    leg.castShadow = true;
    tableGroup.add(leg);

    const footGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.015, 16);
    const footMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.set(pos[0], 0.0075, pos[2]);
    tableGroup.add(foot);
  });

  const crossBraceGeo = new THREE.CylinderGeometry(0.012, 0.012, TABLE_WIDTH - 0.24, 12);
  const brace1 = new THREE.Mesh(crossBraceGeo, legMaterial);
  brace1.rotation.z = Math.PI / 2;
  brace1.position.set(0, 0.25, -legOffsetZ);
  tableGroup.add(brace1);

  const brace2 = new THREE.Mesh(crossBraceGeo, legMaterial);
  brace2.rotation.z = Math.PI / 2;
  brace2.position.set(0, 0.25, legOffsetZ);
  tableGroup.add(brace2);

  // NET ASSEMBLY
  const totalNetWidth = TABLE_WIDTH + NET_OVERHANG * 2;
  const netGeo = new THREE.PlaneGeometry(totalNetWidth, NET_HEIGHT);
  const netTex = createNetTexture();
  const netMat = new THREE.MeshStandardMaterial({
    map: netTex,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });

  const netMesh = new THREE.Mesh(netGeo, netMat);
  netMesh.position.set(0, TABLE_HEIGHT + NET_HEIGHT / 2, 0);
  netMesh.castShadow = true;
  tableGroup.add(netMesh);

  const netTopTapeGeo = new THREE.BoxGeometry(totalNetWidth, 0.015, 0.006);
  const netTopTapeMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.3 });
  const netTopTape = new THREE.Mesh(netTopTapeGeo, netTopTapeMat);
  netTopTape.position.set(0, TABLE_HEIGHT + NET_HEIGHT - 0.0075, 0);
  tableGroup.add(netTopTape);

  const netBottomTapeGeo = new THREE.BoxGeometry(totalNetWidth, 0.008, 0.006);
  const netBottomTape = new THREE.Mesh(netBottomTapeGeo, netTopTapeMat);
  netBottomTape.position.set(0, TABLE_HEIGHT + 0.004, 0);
  tableGroup.add(netBottomTape);

  const postGeo = new THREE.CylinderGeometry(0.015, 0.015, NET_HEIGHT + 0.06, 16);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x333842,
    roughness: 0.3,
    metalness: 0.8,
  });

  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(-totalNetWidth / 2, TABLE_HEIGHT + NET_HEIGHT / 2 - 0.01, 0);
  leftPost.castShadow = true;
  tableGroup.add(leftPost);

  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(totalNetWidth / 2, TABLE_HEIGHT + NET_HEIGHT / 2 - 0.01, 0);
  rightPost.castShadow = true;
  tableGroup.add(rightPost);

  return tableGroup;
}

/**
 * Creates a procedural 3D Table Tennis Paddle
 */
export function createPaddle(primaryColor = 'red') {
  const paddleGroup = new THREE.Group();
  paddleGroup.name = `Paddle_${primaryColor}`;

  const bladeRadius = 0.082;
  const bladeThickness = 0.008;
  const rubberThickness = 0.0025;

  const bladeGeo = new THREE.CylinderGeometry(bladeRadius, bladeRadius, bladeThickness, 36);
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0xd9b382,
    roughness: 0.6,
    metalness: 0.05,
  });
  const blade = new THREE.Mesh(bladeGeo, woodMat);
  blade.rotation.x = Math.PI / 2;
  blade.position.y = bladeRadius;
  blade.castShadow = true;
  paddleGroup.add(blade);

  const rubberGeo = new THREE.CylinderGeometry(bladeRadius - 0.001, bladeRadius - 0.001, rubberThickness, 36);
  const redRubberMat = new THREE.MeshStandardMaterial({
    color: 0xd91616,
    roughness: 0.32,
    metalness: 0.05,
  });
  const redFace = new THREE.Mesh(rubberGeo, redRubberMat);
  redFace.rotation.x = Math.PI / 2;
  redFace.position.set(0, bladeRadius, -bladeThickness / 2 - rubberThickness / 2);
  redFace.castShadow = true;
  paddleGroup.add(redFace);

  const blackRubberMat = new THREE.MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.35,
    metalness: 0.05,
  });
  const blackFace = new THREE.Mesh(rubberGeo, blackRubberMat);
  blackFace.rotation.x = Math.PI / 2;
  blackFace.position.set(0, bladeRadius, bladeThickness / 2 + rubberThickness / 2);
  blackFace.castShadow = true;
  paddleGroup.add(blackFace);

  const edgeGeo = new THREE.TorusGeometry(bladeRadius, (bladeThickness + rubberThickness * 2) / 2, 8, 36);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: primaryColor === 'red' ? 0x0044ff : 0xd4af37,
    roughness: 0.4,
  });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.position.set(0, bladeRadius, 0);
  paddleGroup.add(edge);

  const handleLength = 0.105;
  const handleWidth = 0.028;
  const handleThickness = 0.022;

  const handleGroup = new THREE.Group();

  const handleGeo = new THREE.BoxGeometry(handleWidth, handleLength, handleThickness);
  const handleWoodMat = new THREE.MeshStandardMaterial({
    color: 0xc89968,
    roughness: 0.5,
  });
  const handle = new THREE.Mesh(handleGeo, handleWoodMat);
  handle.position.y = -handleLength / 2 + 0.01;
  handle.castShadow = true;
  handleGroup.add(handle);

  const stripeGeo = new THREE.BoxGeometry(0.006, handleLength - 0.01, handleThickness + 0.002);
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0x3d2314,
    roughness: 0.5,
  });
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  stripe.position.y = -handleLength / 2 + 0.01;
  handleGroup.add(stripe);

  paddleGroup.add(handleGroup);

  return paddleGroup;
}

/**
 * Creates the high-visibility 3D table tennis ball with luminous glow and landing shadow
 */
export function createBall() {
  const ballGroup = new THREE.Group();
  ballGroup.name = 'TableTennisBall';

  // High-visibility luminous sphere (high-contrast white/neon-yellow core)
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.15,
    metalness: 0.05,
    emissive: 0xccff00,
    emissiveIntensity: 1.1, // Distinct glowing neon presence
  });

  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = false;
  ballGroup.add(ballMesh);

  // Soft luminous halo
  const haloGeo = new THREE.SphereGeometry(BALL_RADIUS * 1.25, 16, 16);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xccff00,
    transparent: true,
    opacity: 0.35,
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
 * Creates the immersive Xbox 360 style arena environment
 */
export function createArenaEnvironment() {
  const arenaGroup = new THREE.Group();
  arenaGroup.name = 'ArenaEnvironment';

  const floorGeo = new THREE.PlaneGeometry(32, 40);
  const floorTex = createFloorTexture();
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.75,
    metalness: 0.1,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  arenaGroup.add(floor);

  const barrierHeight = 0.95;
  const barrierMatSide = new THREE.MeshStandardMaterial({
    map: createBannerTexture('XBOX 360 TABLE TENNIS', 'SMASH CHAMPIONSHIP'),
    roughness: 0.4,
  });
  const bannerMatFar = new THREE.MeshStandardMaterial({
    map: createBannerTexture('The bank for a changing world', 'OFFICIAL TOURNAMENT PARTNER'),
    roughness: 0.4,
  });

  const farBarrierGeo = new THREE.BoxGeometry(16, barrierHeight, 0.1);
  const farBarrier = new THREE.Mesh(farBarrierGeo, bannerMatFar);
  farBarrier.position.set(0, barrierHeight / 2, 7.5);
  farBarrier.castShadow = true;
  farBarrier.receiveShadow = true;
  arenaGroup.add(farBarrier);

  const nearBarrier = new THREE.Mesh(farBarrierGeo, bannerMatFar);
  nearBarrier.position.set(0, barrierHeight / 2, -7.5);
  nearBarrier.castShadow = true;
  arenaGroup.add(nearBarrier);

  const sideBarrierGeo = new THREE.BoxGeometry(0.1, barrierHeight, 15);
  const leftBarrier = new THREE.Mesh(sideBarrierGeo, barrierMatSide);
  leftBarrier.position.set(-6.5, barrierHeight / 2, 0);
  leftBarrier.castShadow = true;
  arenaGroup.add(leftBarrier);

  const rightBarrier = new THREE.Mesh(sideBarrierGeo, barrierMatSide);
  rightBarrier.position.set(6.5, barrierHeight / 2, 0);
  rightBarrier.castShadow = true;
  arenaGroup.add(rightBarrier);

  const standLevels = 4;
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x15222d,
    roughness: 0.8,
  });

  for (let i = 0; i < standLevels; i++) {
    const tierHeight = 1.2;
    const tierDepth = 2.0;
    const y = barrierHeight + i * tierHeight;
    const z = 7.5 + i * tierDepth;

    const tierGeo = new THREE.BoxGeometry(24, tierHeight, tierDepth);
    const tier = new THREE.Mesh(tierGeo, standMat);
    tier.position.set(0, y, z + tierDepth / 2);
    arenaGroup.add(tier);

    const tierFront = new THREE.Mesh(tierGeo, standMat);
    tierFront.position.set(0, y, -z - tierDepth / 2);
    arenaGroup.add(tierFront);
  }

  const createJudge = (x, z) => {
    const judge = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.7, 12);
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x1e6091 });
    const body = new THREE.Mesh(bodyGeo, jacketMat);
    body.position.y = 1.0;
    judge.add(body);

    const headGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xdeb887 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.48;
    judge.add(head);

    const legsGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.65, 12);
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0xd8c8b8 });
    const legs = new THREE.Mesh(legsGeo, pantsMat);
    legs.position.y = 0.35;
    judge.add(legs);

    judge.position.set(x, 0, z);
    return judge;
  };

  arenaGroup.add(createJudge(-3.5, 7.2));
  arenaGroup.add(createJudge(0, 7.2));
  arenaGroup.add(createJudge(3.5, 7.2));

  return arenaGroup;
}
