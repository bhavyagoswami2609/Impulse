import * as THREE from 'three';

/**
 * Air Hockey Procedural 3D Models & Physical Regulations
 * Standard commercial arcade tournament specifications:
 * - Table Length: L = 2.14m (along Z)
 * - Table Width:  W = 1.10m (along X)
 * - Table Height: Y = 0.82m (playing surface elevation above floor)
 * - Striker Radius: R_s = 0.050m (100mm diameter)
 * - Puck Radius:    R_p = 0.038m (76mm diameter, 7.5mm thickness)
 * - Goal Mouth Width: W_goal = 0.34m (opening from X = -0.17m to +0.17m)
 * - Goal Post Radius: R_post = 0.015m at (±0.17m, ±1.07m)
 * - Rail Corner Fillet Radius: R_corner = 0.060m
 */

export const AIR_HOCKEY_TABLE_WIDTH = 1.10;
export const AIR_HOCKEY_TABLE_LENGTH = 2.14;
export const AIR_HOCKEY_TABLE_HEIGHT = 0.82;
export const AIR_HOCKEY_TABLE_THICKNESS = 0.045;
export const AIR_HOCKEY_STRIKER_RADIUS = 0.050;
export const AIR_HOCKEY_PUCK_RADIUS = 0.038;
export const AIR_HOCKEY_PUCK_THICKNESS = 0.0075;
export const AIR_HOCKEY_GOAL_WIDTH = 0.34;
export const AIR_HOCKEY_POST_RADIUS = 0.015;
export const AIR_HOCKEY_CORNER_RADIUS = 0.060;
export const AIR_HOCKEY_CORNER_BOUNCER_SIZE = 0.150; // 15cm 45° corner deflector
export const AIR_HOCKEY_RAIL_HEIGHT = 0.038;
export const AIR_HOCKEY_RAIL_WIDTH = 0.055;

/**
 * Universal canvas texture generator with headless Node.js fallback
 */
function createProceduralTexture(width, height, drawCallback, fallbackColor = [240, 245, 250, 255]) {
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawCallback(ctx, width, height, canvas);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    }
  }

  // Graceful 4x4 DataTexture fallback for Node.js test environments
  const size = 4;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 0] = fallbackColor[0];
    data[i * 4 + 1] = fallbackColor[1];
    data[i * 4 + 2] = fallbackColor[2];
    data[i * 4 + 3] = fallbackColor[3];
  }
  const fallbackTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  fallbackTexture.needsUpdate = true;
  return fallbackTexture;
}

/**
 * High-resolution canvas texture for the Air Hockey playfield
 * Features:
 * - Ice-white playing bed with electric blue vignette and crystalline sheen
 * - Staggered micro-dot air hole perforations across the entire table
 * - Center line dividing P1 and P2 domains with futuristic pinstripes
 * - Center face-off circle (R = 0.16m) with glowing crosshairs and alignment ring
 * - Goal crease arcs (R = 0.28m) at North and South ends
 * - Symmetrical Championship badges facing each player
 * - Tournament safety warnings and technical boundary markings
 */
export function createPlayfieldTexture() {
  return createProceduralTexture(1024, 2048, (ctx, w, h) => {
    // 1. Base ice-white / electric blue bed
    const baseGrad = ctx.createRadialGradient(w / 2, h / 2, 80, w / 2, h / 2, h * 0.58);
    baseGrad.addColorStop(0, '#f8fbfe');
    baseGrad.addColorStop(0.55, '#ebf5fc');
    baseGrad.addColorStop(0.85, '#d6ecfa');
    baseGrad.addColorStop(1, '#bee1f7');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, w, h);

    // Fine crystalline ice grain / brushed acrylic sheen
    ctx.fillStyle = 'rgba(0, 160, 240, 0.025)';
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 2);
    }
    for (let x = 0; x < w; x += 4) {
      ctx.fillRect(x, 0, 2, h);
    }

    // 2. Subtle air hole micro-dots (Thousands of pressurized laminar air jets)
    const stepX = 22;
    const stepY = 22;
    ctx.fillStyle = 'rgba(45, 95, 145, 0.24)';
    for (let y = 30; y < h - 30; y += stepY) {
      const offsetX = ((y / stepY) % 2 === 0) ? 0 : stepX / 2;
      for (let x = 30 + offsetX; x < w - 30; x += stepX) {
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Sub-pixel white highlight to give holes 3D recessed depth
    ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
    for (let y = 30; y < h - 30; y += stepY) {
      const offsetX = ((y / stepY) % 2 === 0) ? 0 : stepX / 2;
      for (let x = 30 + offsetX; x < w - 30; x += stepX) {
        ctx.beginPath();
        ctx.arc(x + 0.6, y + 0.6, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 3. Perimeter guide border
    ctx.strokeStyle = 'rgba(0, 120, 200, 0.45)';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, w - 40, h - 40);

    // 4. Center Line dividing P1 and P2 domains (Z = 0 is Y = 1024)
    const centerY = h / 2;
    // Glowing center glow band
    const centerGlow = ctx.createLinearGradient(0, centerY - 24, 0, centerY + 24);
    centerGlow.addColorStop(0, 'rgba(0, 210, 255, 0.0)');
    centerGlow.addColorStop(0.5, 'rgba(0, 210, 255, 0.25)');
    centerGlow.addColorStop(1, 'rgba(0, 210, 255, 0.0)');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(20, centerY - 24, w - 40, 48);

    // Primary center line
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(20, centerY);
    ctx.lineTo(w - 20, centerY);
    ctx.stroke();

    // Secondary parallel pinstripes
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, centerY - 10);
    ctx.lineTo(w - 20, centerY - 10);
    ctx.moveTo(20, centerY + 10);
    ctx.lineTo(w - 20, centerY + 10);
    ctx.stroke();

    // Center divider text labels
    ctx.font = 'bold 13px "Segoe UI", "Helvetica Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0, 140, 220, 0.75)';
    ctx.letterSpacing = '3px';
    ctx.fillText('◄ PLAYER 1 DOMAIN (SOUTH)', w / 2 - 240, centerY - 16);
    ctx.fillText('PLAYER 2 / CPU DOMAIN (NORTH) ►', w / 2 + 240, centerY + 25);

    // 5. Center Face-Off Circle (R = 0.16m -> ~149px on 1024 width)
    const centerRadiusPx = 149;
    // Outer glow aura
    ctx.strokeStyle = 'rgba(0, 180, 255, 0.35)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(w / 2, centerY, centerRadiusPx, 0, Math.PI * 2);
    ctx.stroke();

    // Crisp outer circle
    ctx.strokeStyle = '#0099ff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w / 2, centerY, centerRadiusPx, 0, Math.PI * 2);
    ctx.stroke();

    // Inner dashed concentric ring
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.arc(w / 2, centerY, centerRadiusPx * 0.58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Longitudinal alignment crossbars
    ctx.strokeStyle = 'rgba(0, 160, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, centerY - centerRadiusPx - 30);
    ctx.lineTo(w / 2, centerY + centerRadiusPx + 30);
    ctx.stroke();

    // Center face-off dot
    ctx.fillStyle = '#00eeff';
    ctx.beginPath();
    ctx.arc(w / 2, centerY, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(w / 2, centerY, 6, 0, Math.PI * 2);
    ctx.fill();

    // 6. Goal Crease Arcs & End Zone Markings
    // Goal mouth is 0.34m wide -> 316.5px, centered horizontally [354, 670]
    const goalCreaseRadius = 260; // ~0.28m radius arc

    // South End (Player 1, Y = 0 to 400)
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.4)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(w / 2, 20, goalCreaseRadius, 0, Math.PI);
    ctx.stroke();

    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w / 2, 20, goalCreaseRadius, 0, Math.PI);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 220, 255, 0.7)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(w / 2, 20, goalCreaseRadius * 0.7, 0, Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // Goal threshold line (Goal mouth opening 316px wide)
    ctx.strokeStyle = '#ff2b56';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 158, 20);
    ctx.lineTo(w / 2 + 158, 20);
    ctx.stroke();

    // North End (Player 2 / CPU, Y = 1648 to 2048)
    ctx.strokeStyle = 'rgba(255, 50, 90, 0.35)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(w / 2, h - 20, goalCreaseRadius, Math.PI, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#ff2b56';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w / 2, h - 20, goalCreaseRadius, Math.PI, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 170, 0, 0.7)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(w / 2, h - 20, goalCreaseRadius * 0.7, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Goal threshold line
    ctx.strokeStyle = '#ff2b56';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 158, h - 20);
    ctx.lineTo(w / 2 + 158, h - 20);
    ctx.stroke();

    // 7. Tactical Striker Face-Off Target Spots (4 quadrants)
    const targetSpots = [
      { x: 260, y: 560, color: '#00b8ff' },
      { x: w - 260, y: 560, color: '#00b8ff' },
      { x: 260, y: h - 560, color: '#ff4466' },
      { x: w - 260, y: h - 560, color: '#ff4466' },
    ];
    targetSpots.forEach((spot) => {
      ctx.strokeStyle = spot.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, 44, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = spot.color;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair alignment ticks
      ctx.beginPath();
      ctx.moveTo(spot.x - 52, spot.y);
      ctx.lineTo(spot.x + 52, spot.y);
      ctx.moveTo(spot.x, spot.y - 52);
      ctx.lineTo(spot.x, spot.y + 52);
      ctx.stroke();
    });

    // 8. Tournament Championship Branding
    // Helper to draw the authentic tournament sphere logo & lettering
    const drawTournamentBranding = (x, y, isFlipped = false) => {
      ctx.save();
      ctx.translate(x, y);
      if (isFlipped) ctx.rotate(Math.PI);

      // Glowing emblem sphere
      const sphereRadius = 40;
      const sphereGrad = ctx.createRadialGradient(-10, -10, 6, 0, 0, sphereRadius);
      sphereGrad.addColorStop(0, '#ffffff');
      sphereGrad.addColorStop(0.35, '#00ddff');
      sphereGrad.addColorStop(0.75, '#0077b6');
      sphereGrad.addColorStop(1, '#023e8a');
      ctx.fillStyle = sphereGrad;
      ctx.beginPath();
      ctx.arc(0, 0, sphereRadius, 0, Math.PI * 2);
      ctx.fill();

      // Chrome outer ring
      ctx.strokeStyle = '#e0e8f0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, sphereRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Stylized concave emblem
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.quadraticCurveTo(-14, -28, -26, -26);
      ctx.quadraticCurveTo(-12, -12, -4, 0);
      ctx.quadraticCurveTo(-12, 12, -26, 26);
      ctx.quadraticCurveTo(-14, 28, 0, 6);
      ctx.quadraticCurveTo(14, 28, 26, 26);
      ctx.quadraticCurveTo(12, 12, 4, 0);
      ctx.quadraticCurveTo(12, -12, 26, -26);
      ctx.quadraticCurveTo(14, -28, 0, -6);
      ctx.closePath();
      ctx.fill();

      // Primary Branding Typography
      ctx.textAlign = 'center';
      ctx.font = 'bold 36px "Segoe UI", "Helvetica Neue", sans-serif';
      ctx.fillStyle = '#102538';
      ctx.shadowColor = 'rgba(0, 180, 255, 0.45)';
      ctx.shadowBlur = 10;
      ctx.fillText('IMPULSE', 0, 72);

      ctx.font = 'bold 18px "Segoe UI", sans-serif';
      ctx.fillStyle = '#0077b6';
      ctx.shadowBlur = 0;
      ctx.letterSpacing = '5px';
      ctx.fillText('AIR HOCKEY CHAMPIONSHIP', 0, 100);

      ctx.font = '600 12px "Segoe UI", sans-serif';
      ctx.fillStyle = '#6c8ea5';
      ctx.letterSpacing = '2.5px';
      ctx.fillText('PRO ARCADE TOURNAMENT EDITION // 120 FPS HIGH PRECISION', 0, 124);

      ctx.restore();
    };

    // South Player 1 Logo
    drawTournamentBranding(w / 2, 730, false);
    // North Player 2 / CPU Logo (Rotated 180° so it faces Player 2)
    drawTournamentBranding(w / 2, h - 730, true);

    // 9. Safety Warning Markings along rails
    const drawWarningStrip = (x, y, length, text) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 2);

      // Hazard pattern background
      ctx.fillStyle = 'rgba(255, 180, 0, 0.18)';
      ctx.fillRect(-length / 2, -12, length, 24);

      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#3a4e60';
      ctx.letterSpacing = '2px';
      ctx.fillText(text, 0, 0);

      ctx.restore();
    };

    drawWarningStrip(34, 480, 420, '▲ CAUTION: HIGH-SPEED PUCK REBOUND // KEEP HANDS OUTSIDE RAILS ▲');
    drawWarningStrip(34, h - 480, 420, '▲ CAUTION: LAMINAR HIGH PRESSURE AIR JETS // DO NOT OBSTRUCT ▲');
    drawWarningStrip(w - 34, 480, 420, '▲ CAUTION: HIGH-SPEED PUCK REBOUND // KEEP HANDS OUTSIDE RAILS ▲');
    drawWarningStrip(w - 34, h - 480, 420, '▲ CAUTION: LAMINAR HIGH PRESSURE AIR JETS // DO NOT OBSTRUCT ▲');
  });
}

/**
 * Creates procedural texture for the semi-transparent holographic laser beam
 */
function createDividerBeamTexture() {
  return createProceduralTexture(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.15, 'rgba(0, 240, 255, 0.85)');
    grad.addColorStop(0.45, 'rgba(0, 190, 255, 0.45)');
    grad.addColorStop(0.80, 'rgba(0, 130, 255, 0.15)');
    grad.addColorStop(1.0, 'rgba(0, 100, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Fine holographic scanlines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    for (let x = 0; x < w; x += 16) {
      ctx.fillRect(x, h * 0.4, 2, h * 0.6);
    }
  }, [0, 240, 255, 200]);
}

/**
 * Creates procedural soft radial gradient texture for puck contact shadow and reflection
 */
function createPuckContactTexture() {
  return createProceduralTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
    grad.addColorStop(0.0, 'rgba(8, 14, 24, 0.85)');
    grad.addColorStop(0.42, 'rgba(15, 22, 35, 0.65)');
    grad.addColorStop(0.68, 'rgba(255, 75, 0, 0.40)'); // Vibrant warm reflection ring
    grad.addColorStop(0.88, 'rgba(255, 60, 0, 0.12)');
    grad.addColorStop(1.0, 'rgba(255, 50, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, [255, 80, 0, 180]);
}

/**
 * Creates procedural soft halo texture for the striker base
 */
function createStrikerHaloTexture(colorHex) {
  const c = new THREE.Color(colorHex);
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);

  return createProceduralTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.28, w / 2, h / 2, w * 0.48);
    grad.addColorStop(0.0, `rgba(${r}, ${g}, ${b}, 0.0)`);
    grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.35)`);
    grad.addColorStop(0.8, `rgba(${r}, ${g}, ${b}, 0.12)`);
    grad.addColorStop(1.0, `rgba(${r}, ${g}, ${b}, 0.0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, [r, g, b, 120]);
}

/**
 * Builds 45° corner bouncer / deflector unit
 * Corner size: AIR_HOCKEY_CORNER_BOUNCER_SIZE (0.15m)
 * Extruded height: AIR_HOCKEY_RAIL_HEIGHT (0.038m)
 * Bridges the gap between side rails and end rails with a 45° angled rebound cushion,
 * making corner trapping physically and visually impossible.
 */
function createCornerBouncerUnit(aluminumRailMat, reboundCushionMat) {
  const group = new THREE.Group();
  const cbSize = AIR_HOCKEY_CORNER_BOUNCER_SIZE; // 0.15m
  const railW = AIR_HOCKEY_RAIL_WIDTH;           // 0.055m
  const railH = AIR_HOCKEY_RAIL_HEIGHT;          // 0.038m

  // Define 2D polygon in (X, Y) plane such that when rotated around X by -Math.PI / 2:
  // X -> X
  // Y -> -Z (so Z_table = -Y => Y = -Z_table)
  // Z_extrude -> Y_table (height from 0 to railH)
  //
  // In table space (relative to corner at (0, 0)):
  // Point 1: inner end-rail junction at (x = -cbSize, z = 0) => shape (-cbSize, 0)
  // Point 2: inner side-rail junction at (x = 0, z = -cbSize) => shape (0, cbSize)
  // Point 3: outer side-rail edge at (x = railW, z = -cbSize) => shape (railW, cbSize)
  // Point 4: outer corner at (x = railW, z = railW) => shape (railW, -railW)
  // Point 5: outer end-rail edge at (x = -cbSize, z = railW) => shape (-cbSize, -railW)
  const shape = new THREE.Shape();
  shape.moveTo(-cbSize, 0);
  shape.lineTo(0, cbSize);
  shape.lineTo(railW, cbSize);
  shape.lineTo(railW, -railW);
  shape.lineTo(-cbSize, -railW);
  shape.closePath();

  const extrudeSettings = {
    depth: railH,
    bevelEnabled: false,
  };
  const wedgeGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  wedgeGeo.rotateX(-Math.PI / 2);
  wedgeGeo.computeVertexNormals();

  const wedgeMesh = new THREE.Mesh(wedgeGeo, aluminumRailMat);
  wedgeMesh.castShadow = true;
  wedgeMesh.receiveShadow = true;
  group.add(wedgeMesh);

  // 45° Rebound Cushion facing the playfield
  // Cushion face spans from (-cbSize, 0) to (0, -cbSize)
  const cushionLength = cbSize * Math.SQRT2; // ~0.212m
  const cushionThick = 0.006;
  const cushionGeo = new THREE.BoxGeometry(cushionLength, railH * 0.75, cushionThick);
  const cushionMesh = new THREE.Mesh(cushionGeo, reboundCushionMat);
  cushionMesh.rotation.y = Math.PI / 4;
  // Offset slightly along inward normal (-1/sqrt2, -1/sqrt2) to guarantee zero Z-fighting with wedge
  const offset = 0.001;
  cushionMesh.position.set(-cbSize / 2 - offset * 0.7071, railH * 0.42, -cbSize / 2 - offset * 0.7071);
  cushionMesh.castShadow = true;
  cushionMesh.receiveShadow = true;
  group.add(cushionMesh);

  // Subtle glowing LED accent strip on top edge of 45° bouncer
  const neonMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff });
  const neonGeo = new THREE.BoxGeometry(cushionLength, 0.003, 0.004);
  const neonMesh = new THREE.Mesh(neonGeo, neonMat);
  neonMesh.rotation.y = Math.PI / 4;
  neonMesh.position.set(-cbSize / 2 - offset * 0.7071, railH - 0.002, -cbSize / 2 - offset * 0.7071);
  group.add(neonMesh);

  return group;
}

/**
 * Builds the complete regulation Air Hockey Table
 * Includes:
 * - Regulation playfield with procedural high-res texture
 * - Solid extruded aluminum rails with nylon rebound cushions and goal slits
 * - 4 rounded corner fillets (R = 0.06m)
 * - Goal mouth posts (R = 0.015m at ±0.17m, ±1.07m)
 * - Recessed goal pockets with puck chutes and angled 45° internal backstops
 * - Center domain divider: semi-transparent glowing holographic laser beam & rail projectors
 * - Heavy-duty tournament arcade cabinet: metallic dark chassis, chrome corner castings,
 *   4 angled structural steel legs with chrome leveler feet, and illuminated LED side accents
 */
export function createAirHockeyTable() {
  const tableGroup = new THREE.Group();
  tableGroup.name = 'AirHockeyTable';

  const W = AIR_HOCKEY_TABLE_WIDTH;
  const L = AIR_HOCKEY_TABLE_LENGTH;
  const H = AIR_HOCKEY_TABLE_HEIGHT;
  const T = AIR_HOCKEY_TABLE_THICKNESS;
  const railH = AIR_HOCKEY_RAIL_HEIGHT;
  const railW = AIR_HOCKEY_RAIL_WIDTH;
  const Rc = AIR_HOCKEY_CORNER_RADIUS;
  const goalW = AIR_HOCKEY_GOAL_WIDTH;
  const postR = AIR_HOCKEY_POST_RADIUS;

  // 1. PLAYFIELD BED & SLAB
  const playfieldTex = createPlayfieldTexture();
  const playfieldMat = new THREE.MeshStandardMaterial({
    map: playfieldTex,
    roughness: 0.18, // Ultra-slick polished laminate surface
    metalness: 0.08,
  });

  const playfieldGeo = new THREE.PlaneGeometry(W, L);
  const playfieldMesh = new THREE.Mesh(playfieldGeo, playfieldMat);
  playfieldMesh.rotation.x = -Math.PI / 2;
  playfieldMesh.position.set(0, H, 0);
  playfieldMesh.receiveShadow = true;
  tableGroup.add(playfieldMesh);

  // Structural substrate underneath the playfield laminate
  const bedCoreMat = new THREE.MeshStandardMaterial({
    color: 0x141820,
    roughness: 0.7,
    metalness: 0.2,
  });
  const bedCoreGeo = new THREE.BoxGeometry(W, T, L);
  const bedCoreMesh = new THREE.Mesh(bedCoreGeo, bedCoreMat);
  bedCoreMesh.position.set(0, H - T / 2 - 0.001, 0);
  bedCoreMesh.castShadow = true;
  bedCoreMesh.receiveShadow = true;
  tableGroup.add(bedCoreMesh);

  // 2. EXTRUDED ALUMINUM DEFLECTION RAILS & CUSHIONS
  const aluminumRailMat = new THREE.MeshStandardMaterial({
    color: 0xdde4ec,
    metalness: 0.92,
    roughness: 0.22,
  });

  const reboundCushionMat = new THREE.MeshStandardMaterial({
    color: 0x11161d, // High-density surlyn/nylon rebound face
    roughness: 0.35,
    metalness: 0.1,
  });

  // A. Side Rails (Left and Right along X = ±0.55m)
  // Length runs between the 45° corner bouncers: from Z = -L/2 + cbSize to +L/2 - cbSize = 1.84m
  const cbSize = AIR_HOCKEY_CORNER_BOUNCER_SIZE; // 0.15m
  const sideRailLength = L - 2 * cbSize; // 1.84m
  const sideRailGeo = new THREE.BoxGeometry(railW, railH, sideRailLength);
  const sideCushionGeo = new THREE.BoxGeometry(0.006, railH * 0.75, sideRailLength);

  // Left Side Rail
  const leftSideRail = new THREE.Mesh(sideRailGeo, aluminumRailMat);
  leftSideRail.position.set(-W / 2 - railW / 2, H + railH / 2, 0);
  leftSideRail.castShadow = true;
  leftSideRail.receiveShadow = true;
  tableGroup.add(leftSideRail);

  const leftCushion = new THREE.Mesh(sideCushionGeo, reboundCushionMat);
  leftCushion.position.set(-W / 2 + 0.003, H + railH * 0.42, 0);
  leftCushion.castShadow = true;
  leftCushion.receiveShadow = true;
  tableGroup.add(leftCushion);

  // Right Side Rail
  const rightSideRail = new THREE.Mesh(sideRailGeo, aluminumRailMat);
  rightSideRail.position.set(W / 2 + railW / 2, H + railH / 2, 0);
  rightSideRail.castShadow = true;
  rightSideRail.receiveShadow = true;
  tableGroup.add(rightSideRail);

  const rightCushion = new THREE.Mesh(sideCushionGeo, reboundCushionMat);
  rightCushion.position.set(W / 2 - 0.003, H + railH * 0.42, 0);
  rightCushion.castShadow = true;
  rightCushion.receiveShadow = true;
  tableGroup.add(rightCushion);

  // B. End Rails (South Z = -1.07m and North Z = +1.07m)
  // Each end has 2 rail sections flanking the 0.34m goal mouth opening:
  // Spanning from 45° corner bouncer (X = ±(W/2 - cbSize) = ±0.40m) to goal mouth edge (X = ±goalW/2 = ±0.17m)
  // Segment length = 0.40 - 0.17 = 0.23m
  const endRailSegmentLength = (W / 2 - cbSize) - (goalW / 2); // 0.23m
  const endRailGeo = new THREE.BoxGeometry(endRailSegmentLength, railH, railW);
  const endCushionGeo = new THREE.BoxGeometry(endRailSegmentLength, railH * 0.75, 0.006);

  const endRailCenterX = goalW / 2 + endRailSegmentLength / 2; // 0.17 + 0.115 = 0.285m

  // South End Rails (Z = -L/2)
  const southLeftRail = new THREE.Mesh(endRailGeo, aluminumRailMat);
  southLeftRail.position.set(-endRailCenterX, H + railH / 2, -L / 2 - railW / 2);
  southLeftRail.castShadow = true;
  southLeftRail.receiveShadow = true;
  tableGroup.add(southLeftRail);

  const southLeftCushion = new THREE.Mesh(endCushionGeo, reboundCushionMat);
  southLeftCushion.position.set(-endRailCenterX, H + railH * 0.42, -L / 2 + 0.003);
  tableGroup.add(southLeftCushion);

  const southRightRail = new THREE.Mesh(endRailGeo, aluminumRailMat);
  southRightRail.position.set(endRailCenterX, H + railH / 2, -L / 2 - railW / 2);
  southRightRail.castShadow = true;
  southRightRail.receiveShadow = true;
  tableGroup.add(southRightRail);

  const southRightCushion = new THREE.Mesh(endCushionGeo, reboundCushionMat);
  southRightCushion.position.set(endRailCenterX, H + railH * 0.42, -L / 2 + 0.003);
  tableGroup.add(southRightCushion);

  // North End Rails (Z = +L/2)
  const northLeftRail = new THREE.Mesh(endRailGeo, aluminumRailMat);
  northLeftRail.position.set(-endRailCenterX, H + railH / 2, L / 2 + railW / 2);
  northLeftRail.castShadow = true;
  northLeftRail.receiveShadow = true;
  tableGroup.add(northLeftRail);

  const northLeftCushion = new THREE.Mesh(endCushionGeo, reboundCushionMat);
  northLeftCushion.position.set(-endRailCenterX, H + railH * 0.42, L / 2 - 0.003);
  tableGroup.add(northLeftCushion);

  const northRightRail = new THREE.Mesh(endRailGeo, aluminumRailMat);
  northRightRail.position.set(endRailCenterX, H + railH / 2, L / 2 + railW / 2);
  northRightRail.castShadow = true;
  northRightRail.receiveShadow = true;
  tableGroup.add(northRightRail);

  const northRightCushion = new THREE.Mesh(endCushionGeo, reboundCushionMat);
  northRightCushion.position.set(endRailCenterX, H + railH * 0.42, L / 2 - 0.003);
  tableGroup.add(northRightCushion);

  // C. 4 45° Angled Corner Bouncers / Deflectors (Watertight geometric corner deflector units)
  // Corner 1: South-West (-X, -Z)
  const cornerSW = createCornerBouncerUnit(aluminumRailMat, reboundCushionMat);
  cornerSW.rotation.y = Math.PI;
  cornerSW.position.set(-W / 2, H, -L / 2);
  tableGroup.add(cornerSW);

  // Corner 2: South-East (+X, -Z)
  const cornerSE = createCornerBouncerUnit(aluminumRailMat, reboundCushionMat);
  cornerSE.rotation.y = Math.PI / 2;
  cornerSE.position.set(W / 2, H, -L / 2);
  tableGroup.add(cornerSE);

  // Corner 3: North-East (+X, +Z)
  const cornerNE = createCornerBouncerUnit(aluminumRailMat, reboundCushionMat);
  cornerNE.rotation.y = 0;
  cornerNE.position.set(W / 2, H, L / 2);
  tableGroup.add(cornerNE);

  // Corner 4: North-West (-X, +Z)
  const cornerNW = createCornerBouncerUnit(aluminumRailMat, reboundCushionMat);
  cornerNW.rotation.y = -Math.PI / 2;
  cornerNW.position.set(-W / 2, H, L / 2);
  tableGroup.add(cornerNW);

  // D. Goal Mouth Posts (Radius = 0.015m at ±0.17m, ±1.07m)
  const postHeight = railH + 0.012;
  const postGeo = new THREE.CylinderGeometry(postR, postR, postHeight, 24);
  const postCapGeo = new THREE.SphereGeometry(postR, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const chromePostMat = new THREE.MeshStandardMaterial({
    color: 0xf0f4f8,
    metalness: 0.98,
    roughness: 0.12,
  });

  const postPositions = [
    [-goalW / 2, -L / 2],
    [goalW / 2, -L / 2],
    [-goalW / 2, L / 2],
    [goalW / 2, L / 2],
  ];

  postPositions.forEach(([px, pz]) => {
    const post = new THREE.Mesh(postGeo, chromePostMat);
    post.position.set(px, H + postHeight / 2, pz);
    post.castShadow = true;
    post.receiveShadow = true;
    tableGroup.add(post);

    const cap = new THREE.Mesh(postCapGeo, chromePostMat);
    cap.position.set(px, H + postHeight, pz);
    tableGroup.add(cap);
  });

  // 3. RECESSED GOAL POCKETS WITH INTERNAL BACKSTOPS & PUCK CHUTE CAVITIES
  const createGoalPocket = (zPos, isNorth = false) => {
    const goalGroup = new THREE.Group();
    const pocketDepth = 0.16; // meters behind goal line
    const pocketWidth = goalW + 0.02; // 0.36m
    const pocketDrop = 0.07; // depth below table bed

    const interiorDarkMat = new THREE.MeshStandardMaterial({
      color: 0x080c10, // Sound-dampened impact chamber
      roughness: 0.85,
      metalness: 0.15,
    });

    // Chute bottom ramp sloping downward to puck return
    const chuteGeo = new THREE.BoxGeometry(pocketWidth, 0.012, pocketDepth);
    const chute = new THREE.Mesh(chuteGeo, interiorDarkMat);
    chute.position.set(0, H - pocketDrop / 2, isNorth ? zPos + pocketDepth / 2 : zPos - pocketDepth / 2);
    chute.rotation.x = isNorth ? -0.22 : 0.22; // Slanted towards puck return pocket
    chute.receiveShadow = true;
    goalGroup.add(chute);

    // Goal throat side walls
    const throatWallGeo = new THREE.BoxGeometry(0.016, pocketDrop + railH, pocketDepth);
    const leftThroat = new THREE.Mesh(throatWallGeo, interiorDarkMat);
    leftThroat.position.set(-pocketWidth / 2, H - pocketDrop / 2 + railH / 2, isNorth ? zPos + pocketDepth / 2 : zPos - pocketDepth / 2);
    goalGroup.add(leftThroat);

    const rightThroat = new THREE.Mesh(throatWallGeo, interiorDarkMat);
    rightThroat.position.set(pocketWidth / 2, H - pocketDrop / 2 + railH / 2, isNorth ? zPos + pocketDepth / 2 : zPos - pocketDepth / 2);
    goalGroup.add(rightThroat);

    // Angled 45° internal backstop plate
    const backstopMat = new THREE.MeshStandardMaterial({
      color: 0x222a33,
      metalness: 0.8,
      roughness: 0.4,
    });
    const backstopGeo = new THREE.BoxGeometry(pocketWidth - 0.01, 0.08, 0.012);
    const backstop = new THREE.Mesh(backstopGeo, backstopMat);
    backstop.position.set(0, H - 0.01, isNorth ? zPos + pocketDepth - 0.02 : zPos - pocketDepth + 0.02);
    backstop.rotation.x = isNorth ? Math.PI / 4 : -Math.PI / 4;
    backstop.castShadow = true;
    goalGroup.add(backstop);

    // Overhead Goal Hood / Optical Sensor Crossbar Housing
    const goalCrossbarGeo = new THREE.BoxGeometry(goalW + 0.04, 0.024, 0.045);
    const goalCrossbar = new THREE.Mesh(goalCrossbarGeo, aluminumRailMat);
    goalCrossbar.position.set(0, H + railH + 0.012, isNorth ? zPos + 0.02 : zPos - 0.02);
    goalCrossbar.castShadow = true;
    goalGroup.add(goalCrossbar);

    // Optical Electronic Goal Sensor indicator lens
    const sensorLensGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.008, 16);
    const sensorLensMat = new THREE.MeshBasicMaterial({
      color: isNorth ? 0xff2244 : 0x00f0ff,
    });
    const leftSensor = new THREE.Mesh(sensorLensGeo, sensorLensMat);
    leftSensor.rotation.z = Math.PI / 2;
    leftSensor.position.set(-goalW / 2 + 0.01, H + 0.015, zPos);
    goalGroup.add(leftSensor);

    const rightSensor = new THREE.Mesh(sensorLensGeo, sensorLensMat);
    rightSensor.rotation.z = Math.PI / 2;
    rightSensor.position.set(goalW / 2 - 0.01, H + 0.015, zPos);
    goalGroup.add(rightSensor);

    // Front/Rear Cabinet Puck Return Tray Cavity
    const returnPocketGeo = new THREE.BoxGeometry(0.24, 0.09, 0.12);
    const returnPocketMat = new THREE.MeshStandardMaterial({
      color: 0x111418,
      metalness: 0.8,
      roughness: 0.3,
    });
    const returnPocket = new THREE.Mesh(returnPocketGeo, returnPocketMat);
    returnPocket.position.set(0, H - 0.24, isNorth ? zPos + 0.07 : zPos - 0.07);
    goalGroup.add(returnPocket);

    return goalGroup;
  };

  tableGroup.add(createGoalPocket(-L / 2, false));
  tableGroup.add(createGoalPocket(L / 2, true));

  // 4. CENTER DOMAIN DIVIDER (NEON BEAM & RAIL PROJECTORS)
  // Projected Line on Table Surface
  const dividerLineGeo = new THREE.PlaneGeometry(W, 0.014);
  const dividerLineMat = new THREE.MeshBasicMaterial({
    color: 0x00f5ff,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const dividerLine = new THREE.Mesh(dividerLineGeo, dividerLineMat);
  dividerLine.rotation.x = -Math.PI / 2;
  dividerLine.position.set(0, H + 0.001, 0);
  tableGroup.add(dividerLine);

  // Holographic Semi-transparent Vertical Laser Curtain
  const beamHeight = 0.065;
  const dividerBeamGeo = new THREE.PlaneGeometry(W, beamHeight);
  const beamTex = createDividerBeamTexture();
  const dividerBeamMat = new THREE.MeshBasicMaterial({
    map: beamTex,
    transparent: true,
    opacity: 0.58,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const dividerBeam = new THREE.Mesh(dividerBeamGeo, dividerBeamMat);
  dividerBeam.position.set(0, H + beamHeight / 2, 0);
  tableGroup.add(dividerBeam);

  // Chrome Laser Projector Pods mounted on left and right rails at Z = 0
  const projectorHousingGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.032, 20);
  const projectorLensGeo = new THREE.SphereGeometry(0.010, 16, 16);
  const projectorLensMat = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00f0ff,
    emissiveIntensity: 2.2,
    roughness: 0.1,
  });

  const leftProjector = new THREE.Mesh(projectorHousingGeo, chromePostMat);
  leftProjector.rotation.z = Math.PI / 2;
  leftProjector.position.set(-W / 2 - railW / 2, H + railH + 0.012, 0);
  tableGroup.add(leftProjector);

  const leftLens = new THREE.Mesh(projectorLensGeo, projectorLensMat);
  leftLens.position.set(-W / 2 + 0.004, H + railH + 0.012, 0);
  tableGroup.add(leftLens);

  const rightProjector = new THREE.Mesh(projectorHousingGeo, chromePostMat);
  rightProjector.rotation.z = Math.PI / 2;
  rightProjector.position.set(W / 2 + railW / 2, H + railH + 0.012, 0);
  tableGroup.add(rightProjector);

  const rightLens = new THREE.Mesh(projectorLensGeo, projectorLensMat);
  rightLens.position.set(W / 2 - 0.004, H + railH + 0.012, 0);
  tableGroup.add(rightLens);

  // 5. HEAVY-DUTY ARCADE CABINET CHASSIS
  const cabinetWidth = W + 2 * railW + 0.02; // 1.23m
  const cabinetLength = L + 2 * railW + 0.02; // 2.27m
  const apronHeight = 0.36; // meters below rails

  const chassisDarkMat = new THREE.MeshStandardMaterial({
    color: 0x161a22, // Dark metallic titanium
    roughness: 0.38,
    metalness: 0.72,
  });

  // Main cabinet box
  const cabinetBoxGeo = new THREE.BoxGeometry(cabinetWidth, apronHeight, cabinetLength);
  const cabinetBox = new THREE.Mesh(cabinetBoxGeo, chassisDarkMat);
  cabinetBox.position.set(0, H - apronHeight / 2 - 0.005, 0);
  cabinetBox.castShadow = true;
  cabinetBox.receiveShadow = true;
  tableGroup.add(cabinetBox);

  // Lower beveled skirt
  const skirtGeo = new THREE.BoxGeometry(cabinetWidth - 0.06, 0.08, cabinetLength - 0.06);
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x0e1116,
    roughness: 0.6,
    metalness: 0.8,
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.set(0, H - apronHeight - 0.04, 0);
  skirt.castShadow = true;
  tableGroup.add(skirt);

  // Air Blower Intake Louvers (Slotted side ventilation for commercial air blower)
  const louverMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c10,
    roughness: 0.8,
    metalness: 0.3,
  });
  for (let side of [-1, 1]) {
    for (let i = -2; i <= 2; i++) {
      const louverGeo = new THREE.BoxGeometry(0.012, 0.014, 0.22);
      const louver = new THREE.Mesh(louverGeo, louverMat);
      louver.position.set(side * (cabinetWidth / 2 + 0.002), H - 0.22 + i * 0.026, 0);
      tableGroup.add(louver);
    }
  }

  // Coin-op / Service Access Panel on cabinet flank
  const coinDoorGeo = new THREE.BoxGeometry(0.014, 0.18, 0.28);
  const coinDoorMat = new THREE.MeshStandardMaterial({
    color: 0x222730,
    metalness: 0.85,
    roughness: 0.25,
  });
  const coinDoor = new THREE.Mesh(coinDoorGeo, coinDoorMat);
  coinDoor.position.set(cabinetWidth / 2 + 0.005, H - 0.20, 0.55);
  tableGroup.add(coinDoor);

  const lockKeyGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.018, 16);
  const lockKey = new THREE.Mesh(lockKeyGeo, chromePostMat);
  lockKey.rotation.z = Math.PI / 2;
  lockKey.position.set(cabinetWidth / 2 + 0.015, H - 0.15, 0.55);
  tableGroup.add(lockKey);

  // 6. CHROME CORNER CASTINGS (4 Die-Cast Protective Corner Caps)
  const cornerCastingGeo = new THREE.BoxGeometry(0.075, railH + 0.03, 0.075);
  const cornerCastingPositions = [
    [-cabinetWidth / 2 + 0.03, -cabinetLength / 2 + 0.03],
    [cabinetWidth / 2 - 0.03, -cabinetLength / 2 + 0.03],
    [-cabinetWidth / 2 + 0.03, cabinetLength / 2 - 0.03],
    [cabinetWidth / 2 - 0.03, cabinetLength / 2 - 0.03],
  ];

  const boltGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.006, 8);
  cornerCastingPositions.forEach(([cx, cz]) => {
    const casting = new THREE.Mesh(cornerCastingGeo, chromePostMat);
    casting.position.set(cx, H + railH / 2 - 0.005, cz);
    casting.castShadow = true;
    tableGroup.add(casting);

    // Decorative hex bolt heads
    const bolt = new THREE.Mesh(boltGeo, chromePostMat);
    bolt.position.set(cx, H + railH + 0.012, cz);
    tableGroup.add(bolt);
  });

  // 7. 4 HEAVY-DUTY COMMERCIAL TOURNAMENT LEGS & CHROME LEVELERS
  const legOffsetX = W / 2 - 0.08;
  const legOffsetZ = L / 2 - 0.22;
  const legHeight = H - apronHeight;
  const legGeo = new THREE.BoxGeometry(0.078, legHeight, 0.078);
  const steelLegMat = new THREE.MeshStandardMaterial({
    color: 0x1a1e26, // Dark metallic titanium anthracite
    metalness: 0.85,
    roughness: 0.28,
  });

  const chromeStemGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.040, 16);
  const levelerFootGeo = new THREE.CylinderGeometry(0.060, 0.068, 0.024, 24);
  const rubberPadGeo = new THREE.CylinderGeometry(0.066, 0.068, 0.008, 24);
  const rubberPadMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const mountFlangeGeo = new THREE.BoxGeometry(0.105, 0.022, 0.105);

  const legConfigs = [
    { x: -legOffsetX, z: -legOffsetZ, rotX: -0.07, rotZ: -0.07 },
    { x: legOffsetX, z: -legOffsetZ, rotX: -0.07, rotZ: 0.07 },
    { x: -legOffsetX, z: legOffsetZ, rotX: 0.07, rotZ: -0.07 },
    { x: legOffsetX, z: legOffsetZ, rotX: 0.07, rotZ: 0.07 },
  ];

  legConfigs.forEach((cfg) => {
    // Upper mounting flange where leg anchors into cabinet skirt
    const flange = new THREE.Mesh(mountFlangeGeo, chromePostMat);
    flange.position.set(cfg.x, H - apronHeight - 0.011, cfg.z);
    flange.castShadow = true;
    tableGroup.add(flange);

    // Main structural leg column
    const legMesh = new THREE.Mesh(legGeo, steelLegMat);
    legMesh.position.set(cfg.x, legHeight / 2, cfg.z);
    legMesh.rotation.x = cfg.rotX;
    legMesh.rotation.z = cfg.rotZ;
    legMesh.castShadow = true;
    legMesh.receiveShadow = true;
    tableGroup.add(legMesh);

    // Threaded chrome screw stem
    const stem = new THREE.Mesh(chromeStemGeo, chromePostMat);
    stem.position.set(cfg.x * 1.07, 0.030, cfg.z * 1.07);
    tableGroup.add(stem);

    // Heavy-duty chrome leveler foot cup
    const levelerFoot = new THREE.Mesh(levelerFootGeo, chromePostMat);
    levelerFoot.position.set(cfg.x * 1.07, 0.014, cfg.z * 1.07);
    levelerFoot.castShadow = true;
    tableGroup.add(levelerFoot);

    // Non-marking vulcanized rubber base pad
    const rubberPad = new THREE.Mesh(rubberPadGeo, rubberPadMat);
    rubberPad.position.set(cfg.x * 1.07, 0.004, cfg.z * 1.07);
    tableGroup.add(rubberPad);
  });

  // Structural Steel Cross-Braces between left and right legs
  const crossBraceGeo = new THREE.CylinderGeometry(0.018, 0.018, W - 0.14, 16);
  const braceSouth = new THREE.Mesh(crossBraceGeo, steelLegMat);
  braceSouth.rotation.z = Math.PI / 2;
  braceSouth.position.set(0, 0.22, -legOffsetZ);
  tableGroup.add(braceSouth);

  const braceNorth = new THREE.Mesh(crossBraceGeo, steelLegMat);
  braceNorth.rotation.z = Math.PI / 2;
  braceNorth.position.set(0, 0.22, legOffsetZ);
  tableGroup.add(braceNorth);

  // Chrome gusset plates on cross-brace centers
  const centerGussetGeo = new THREE.BoxGeometry(0.075, 0.055, 0.045);
  for (let bz of [-legOffsetZ, legOffsetZ]) {
    const gusset = new THREE.Mesh(centerGussetGeo, chromePostMat);
    gusset.position.set(0, 0.22, bz);
    tableGroup.add(gusset);
  }

  // Longitudinal lower structural stretcher beam connecting South and North crossbars
  const stretcherLength = L - 0.44;
  const stretcherGeo = new THREE.BoxGeometry(0.038, 0.038, stretcherLength);
  const stretcher = new THREE.Mesh(stretcherGeo, steelLegMat);
  stretcher.position.set(0, 0.22, 0);
  stretcher.castShadow = true;
  tableGroup.add(stretcher);

  // 8. ILLUMINATED LED SIDE RAIL ACCENTS (Dual-zone glowing light channels)
  const ledStripLength = L - 0.14; // 2.0m along sides
  const ledChannelGeo = new THREE.BoxGeometry(0.012, 0.016, ledStripLength / 2 - 0.02);

  // South Half (Player 1): Electric Cyan LED Strip
  const ledMatCyan = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00e5ff,
    emissiveIntensity: 1.8,
    roughness: 0.1,
  });

  // North Half (Player 2): Neon Amber / Electric Green LED Strip
  const ledMatP2 = new THREE.MeshStandardMaterial({
    color: 0x9bf00b,
    emissive: 0x76c900,
    emissiveIntensity: 1.8,
    roughness: 0.1,
  });

  // Left Side LEDs
  const leftLedP1 = new THREE.Mesh(ledChannelGeo, ledMatCyan);
  leftLedP1.position.set(-cabinetWidth / 2 - 0.004, H + railH * 0.35, -ledStripLength / 4);
  tableGroup.add(leftLedP1);

  const leftLedP2 = new THREE.Mesh(ledChannelGeo, ledMatP2);
  leftLedP2.position.set(-cabinetWidth / 2 - 0.004, H + railH * 0.35, ledStripLength / 4);
  tableGroup.add(leftLedP2);

  // Right Side LEDs
  const rightLedP1 = new THREE.Mesh(ledChannelGeo, ledMatCyan);
  rightLedP1.position.set(cabinetWidth / 2 + 0.004, H + railH * 0.35, -ledStripLength / 4);
  tableGroup.add(rightLedP1);

  const rightLedP2 = new THREE.Mesh(ledChannelGeo, ledMatP2);
  rightLedP2.position.set(cabinetWidth / 2 + 0.004, H + railH * 0.35, ledStripLength / 4);
  tableGroup.add(rightLedP2);

  return tableGroup;
}

/**
 * Creates a procedural 3D Air Hockey Striker (Sombrero / Mallet shape)
 * Dimensions & Specs:
 * - Base disk: Radius R = 0.050m (100mm diameter) with chamfered rim
 * - Low-friction felt base ring underneath with central air pocket recess
 * - Ergonomic tapered stem
 * - Cylindrical grip knob with 3 rubberized traction rings
 * - Top rounded dome cap with recessed championship emblem jewel
 * - Two distinct tournament colorways:
 *   - 'p1' / 'cyan': Electric Cyan primary with Crimson/Graphite trim
 *   - 'p2' / 'cpu' / 'amber': Neon Amber primary with Graphite trim
 * - Real-time dynamic shadow casting and subtle halo glow
 *
 * @param {string} colorName - 'p1', 'p2', 'cyan', 'crimson', 'amber', 'graphite'
 * @returns {THREE.Group} Striker 3D model
 */
export function createAirHockeyStriker(colorName = 'p1') {
  const normColor = (colorName || 'p1').toLowerCase();
  const isP2 = normColor === 'p2' || normColor === 'cpu' || normColor === 'amber' || normColor === 'orange' || normColor === 'graphite';
  const isCrimson = normColor === 'crimson' || normColor === 'red';

  const strikerGroup = new THREE.Group();
  strikerGroup.name = `AirHockeyStriker_${isP2 ? 'P2' : (isCrimson ? 'Crimson' : 'P1')}`;

  const R = AIR_HOCKEY_STRIKER_RADIUS; // 0.050m
  const baseDiskHeight = 0.009; // 9mm base flange
  const chamferHeight = 0.007; // 7mm beveled rim
  const stemHeight = 0.034; // 34mm tapered neck
  const knobHeight = 0.032; // 32mm grip cylinder
  const knobRadius = 0.024; // 24mm handle radius

  // Tournament Color Palette
  let primaryColorHex = 0x00c8f8; // Electric Cyan
  let primaryEmissiveHex = 0x0088cc;
  let accentColorHex = 0x141820; // Midnight graphite
  let glowColorHex = 0x00f0ff;

  if (isP2) {
    primaryColorHex = 0xff9900; // Neon Amber
    primaryEmissiveHex = 0x995500;
    accentColorHex = 0x1c2128;
    glowColorHex = 0xffaa00;
  } else if (isCrimson) {
    primaryColorHex = 0xe60039; // Crimson Red
    primaryEmissiveHex = 0x880020;
    accentColorHex = 0x10141b;
    glowColorHex = 0xff2040;
  }

  // High-gloss injection-molded polycarbonate mallet material
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: primaryColorHex,
    roughness: 0.16,
    metalness: 0.14,
    emissive: primaryEmissiveHex,
    emissiveIntensity: 0.35,
  });

  const darkAccentMaterial = new THREE.MeshStandardMaterial({
    color: accentColorHex,
    roughness: 0.35,
    metalness: 0.45,
  });

  const gripRubberMaterial = new THREE.MeshStandardMaterial({
    color: 0x121418, // High-friction textured matte rubber
    roughness: 0.82,
    metalness: 0.05,
  });

  const neonGlowMaterial = new THREE.MeshStandardMaterial({
    color: glowColorHex,
    emissive: glowColorHex,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });

  // 1. LOW-FRICTION FELT BASE RING (Underside Y <= 0)
  // Outer radius 0.048m, inner radius 0.024m (recessed central air chamber)
  const feltRingGeo = new THREE.RingGeometry(0.024, 0.048, 36);
  const feltMat = new THREE.MeshStandardMaterial({
    color: 0x1b2b20, // Authentic tournament green billiard/air-hockey felt
    roughness: 0.96,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const feltRing = new THREE.Mesh(feltRingGeo, feltMat);
  feltRing.rotation.x = -Math.PI / 2;
  feltRing.position.y = 0.0004;
  strikerGroup.add(feltRing);

  // 2. WIDE CIRCULAR BOTTOM DISK (R = 0.050m) & DEFLECTION RIM
  // Main disk cylinder: Y from 0 to 0.009m
  const baseDiskGeo = new THREE.CylinderGeometry(R, R, baseDiskHeight, 48);
  const baseDisk = new THREE.Mesh(baseDiskGeo, bodyMaterial);
  baseDisk.position.y = baseDiskHeight / 2;
  baseDisk.castShadow = false;
  baseDisk.receiveShadow = false;
  strikerGroup.add(baseDisk);

  // Chamfered deflection rim: prevents puck from riding over the striker
  // Tapers from R = 0.050m to R = 0.041m, Y from 0.009 to 0.016m
  const chamferGeo = new THREE.CylinderGeometry(0.041, R, chamferHeight, 48);
  const chamfer = new THREE.Mesh(chamferGeo, bodyMaterial);
  chamfer.position.y = baseDiskHeight + chamferHeight / 2;
  chamfer.castShadow = false;
  chamfer.receiveShadow = false;
  strikerGroup.add(chamfer);

  // Luminous Accent Ring channel at top of rim
  const accentRingGeo = new THREE.TorusGeometry(0.0415, 0.0016, 12, 48);
  const accentRing = new THREE.Mesh(accentRingGeo, neonGlowMaterial);
  accentRing.rotation.x = Math.PI / 2;
  accentRing.position.y = baseDiskHeight + chamferHeight;
  strikerGroup.add(accentRing);

  // 3. TAPERED ERGONOMIC STEM (Y from 0.016 to 0.050m)
  // Gracefully lofts from 0.038m radius at base to 0.018m radius at waist
  const stemGeo = new THREE.CylinderGeometry(0.018, 0.038, stemHeight, 36);
  const stem = new THREE.Mesh(stemGeo, bodyMaterial);
  stem.position.y = baseDiskHeight + chamferHeight + stemHeight / 2;
  stem.castShadow = false;
  stem.receiveShadow = false;
  strikerGroup.add(stem);

  // Contrast collar band at stem waist
  const collarGeo = new THREE.CylinderGeometry(0.020, 0.020, 0.006, 36);
  const collar = new THREE.Mesh(collarGeo, darkAccentMaterial);
  collar.position.y = baseDiskHeight + chamferHeight + stemHeight - 0.003;
  collar.castShadow = false;
  strikerGroup.add(collar);

  // 4. ERGONOMIC CYLINDRICAL GRIP KNOB (Y from 0.050 to 0.082m)
  const knobBaseY = baseDiskHeight + chamferHeight + stemHeight;
  const knobGeo = new THREE.CylinderGeometry(knobRadius, knobRadius, knobHeight, 36);
  const knob = new THREE.Mesh(knobGeo, bodyMaterial);
  knob.position.y = knobBaseY + knobHeight / 2;
  knob.castShadow = false;
  knob.receiveShadow = false;
  strikerGroup.add(knob);

  // 3 Rubberized Traction Grip Rings for thumb and fingertip purchase
  for (let i = 0; i < 3; i++) {
    const ringGeo = new THREE.TorusGeometry(knobRadius + 0.0008, 0.0018, 12, 36);
    const ringMesh = new THREE.Mesh(ringGeo, gripRubberMaterial);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = knobBaseY + 0.008 + i * 0.008;
    ringMesh.castShadow = false;
    strikerGroup.add(ringMesh);
  }

  // 5. TOP ROUNDED DOME CAP & EMBLEM JEWEL (Y = 0.082m)
  const domeRadius = knobRadius;
  const domeGeo = new THREE.SphereGeometry(domeRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, bodyMaterial);
  dome.position.y = knobBaseY + knobHeight;
  dome.castShadow = false;
  dome.receiveShadow = false;
  strikerGroup.add(dome);

  // Championship Emblem Jewel on crown
  const jewelGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.002, 24);
  const jewelMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x00a2ff,
    emissiveIntensity: 0.9,
    metalness: 0.9,
    roughness: 0.1,
  });
  const jewel = new THREE.Mesh(jewelGeo, jewelMat);
  jewel.position.y = knobBaseY + knobHeight + domeRadius * 0.92;
  strikerGroup.add(jewel);

  // Chrome bezel around crown jewel
  const jewelBezelGeo = new THREE.TorusGeometry(0.0125, 0.0015, 12, 24);
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xf4f8fc,
    metalness: 0.98,
    roughness: 0.12,
  });
  const bezel = new THREE.Mesh(jewelBezelGeo, chromeMat);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = jewel.position.y;
  strikerGroup.add(bezel);

  // 6. SUBTLE HALO GLOW AT TABLE CONTACT SURFACE
  const haloGeo = new THREE.PlaneGeometry(R * 2.4, R * 2.4);
  const haloTex = createStrikerHaloTexture(glowColorHex);
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.001; // Just above playing bed
  strikerGroup.add(halo);

  strikerGroup.userData = {
    type: 'striker',
    radius: R,
    height: knobBaseY + knobHeight + domeRadius,
    colorway: isP2 ? 'p2' : (isCrimson ? 'crimson' : 'p1'),
  };

  return strikerGroup;
}

/**
 * Creates a procedural 3D Air Hockey Puck
 * Regulation Specs:
 * - High-impact fluorescent Lexan puck (cylinder R = 0.038m / 76mm diameter, thickness = 0.0075m)
 * - Neon fluorescent orange/red with emissive glow for ultra-high visibility from all camera angles
 * - Beveled outer edges (prevents rail snagging) and recessed inner core circle with aerodynamic dimple
 * - Grounding contact shadow / warm reflection disc on table surface
 *
 * @returns {THREE.Group} Puck 3D model
 */
export function createAirHockeyPuck() {
  const puckGroup = new THREE.Group();
  puckGroup.name = 'AirHockeyPuck';

  const R = AIR_HOCKEY_PUCK_RADIUS; // 0.038m (76mm diameter)
  const H = AIR_HOCKEY_PUCK_THICKNESS; // 0.0075m (7.5mm)
  const bevelOffset = 0.0012; // 1.2mm bevel transition

  // High-impact fluorescent Lexan polycarbonate material
  const puckMat = new THREE.MeshStandardMaterial({
    color: 0xff3800, // Vibrant fluorescent orange-red
    roughness: 0.15,
    metalness: 0.08,
    emissive: 0xff1e00,
    emissiveIntensity: 0.82, // Distinct glowing presence across all lighting
  });

  // 1. MAIN PUCK CYLINDRICAL BODY
  const bodyRadius = R - bevelOffset;
  const bodyGeo = new THREE.CylinderGeometry(bodyRadius, bodyRadius, H, 48);
  const body = new THREE.Mesh(bodyGeo, puckMat);
  body.castShadow = false;
  body.receiveShadow = false;
  puckGroup.add(body);

  // 2. BEVELED OUTER EDGES (Top and Bottom Chamfer Rings)
  // Torus rings create a smooth rounded outer perimeter edge of radius R = 0.038m
  const bevelRingGeo = new THREE.TorusGeometry(bodyRadius, bevelOffset, 16, 48);

  const topBevel = new THREE.Mesh(bevelRingGeo, puckMat);
  topBevel.rotation.x = Math.PI / 2;
  topBevel.position.y = H / 2 - bevelOffset;
  topBevel.castShadow = false;
  topBevel.receiveShadow = false;
  puckGroup.add(topBevel);

  const bottomBevel = new THREE.Mesh(bevelRingGeo, puckMat);
  bottomBevel.rotation.x = Math.PI / 2;
  bottomBevel.position.y = -H / 2 + bevelOffset;
  bottomBevel.castShadow = false;
  bottomBevel.receiveShadow = false;
  puckGroup.add(bottomBevel);

  // 3. RECESSED INNER CORE CIRCLE (Authentic arcade recessed face)
  // Sunken inner circle (radius 0.022m, recessed 0.6mm into top face)
  const coreRadius = 0.022;
  const coreDepth = 0.0006;
  const innerCoreGeo = new THREE.CylinderGeometry(coreRadius, coreRadius, coreDepth, 36);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xe62800,
    roughness: 0.22,
    metalness: 0.12,
    emissive: 0xff1400,
    emissiveIntensity: 0.95,
  });

  const topCore = new THREE.Mesh(innerCoreGeo, coreMat);
  topCore.position.y = H / 2 - coreDepth / 2;
  topCore.castShadow = false;
  puckGroup.add(topCore);

  const bottomCore = new THREE.Mesh(innerCoreGeo, coreMat);
  bottomCore.position.y = -H / 2 + coreDepth / 2;
  puckGroup.add(bottomCore);

  // Center aerodynamic injection dimple
  const dimpleGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.0008, 16);
  const dimpleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const topDimple = new THREE.Mesh(dimpleGeo, dimpleMat);
  topDimple.position.y = H / 2;
  puckGroup.add(topDimple);

  // Aerodynamic boundary-layer micro-groove ring
  const aeroGrooveGeo = new THREE.TorusGeometry(0.016, 0.0004, 8, 36);
  const aeroGrooveMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
  const aeroGroove = new THREE.Mesh(aeroGrooveGeo, aeroGrooveMat);
  aeroGroove.rotation.x = Math.PI / 2;
  aeroGroove.position.y = H / 2 + 0.0001;
  puckGroup.add(aeroGroove);

  // 4. CONTACT SHADOW & REFLECTION DISC (Lies just under puck on table surface)
  const discDiameter = R * 2.4; // 0.091m
  const shadowGeo = new THREE.PlaneGeometry(discDiameter, discDiameter);
  const shadowTex = createPuckContactTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const contactDisc = new THREE.Mesh(shadowGeo, shadowMat);
  contactDisc.rotation.x = -Math.PI / 2;
  contactDisc.position.y = -H / 2 - 0.0004;
  puckGroup.add(contactDisc);

  puckGroup.userData = {
    type: 'puck',
    radius: R,
    thickness: H,
    mesh: body,
    material: puckMat,
    contactDisc,
  };

  return puckGroup;
}
