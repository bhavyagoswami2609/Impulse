import * as THREE from 'three';
import {
  createTableTennisTable,
  createPaddle,
  createBall,
  createArenaEnvironment,
  createBakedTableShadow,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  TABLE_LENGTH,
} from './procedural_models.js';
import {
  createAirHockeyTable,
  createAirHockeyStriker,
  createAirHockeyPuck,
  AIR_HOCKEY_TABLE_HEIGHT,
  AIR_HOCKEY_TABLE_WIDTH,
  AIR_HOCKEY_TABLE_LENGTH,
} from './air_hockey_models.js';

export class TableTennisScene {
  constructor(canvasContainer) {
    this.container = canvasContainer;

    // 1. Renderer - cap pixel ratio to 1.5 to reduce fragment shader & GPU fillrate overhead
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
      });
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.shadowMap.autoUpdate = true;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      if (this.container) {
        this.container.appendChild(this.renderer.domElement);
      }
    } catch (err) {
      console.warn('WebGLRenderer creation fallback:', err);
      const canvas = document.createElement('canvas');
      if (this.container) this.container.appendChild(canvas);
      this.renderer = {
        domElement: canvas,
        setSize: () => {},
        setPixelRatio: () => {},
        render: () => {},
        shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false },
        toneMapping: 0,
        toneMappingExposure: 1.0,
      };
    }

    // 2. Scene - Warm near-black dark luxury foundation
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0907);
    this.scene.fog = new THREE.FogExp2(0x0a0907, 0.026);

    // 3. Cameras
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 100);

    // Idle camera orbit around the active table during menu showcase
    this.isOrbiting = true;
    this.orbitAngle = 0;
    this.orbitSpeed = 0.22;

    // Camera view presets
    this.views = {
      // Host view: looking from South (-Z) with clear court overview
      host: {
        position: new THREE.Vector3(0, 1.48, -2.55),
        target: new THREE.Vector3(0, 0.82, 0.20),
      },
      client: {
        position: new THREE.Vector3(0, 1.48, 2.55),
        target: new THREE.Vector3(0, 0.82, -0.20),
      },
      broadcast: {
        position: new THREE.Vector3(2.8, 1.6, 0),
        target: new THREE.Vector3(0, 0.8, 0),
      },
      // Overhead Top-Down Bird's Eye View
      topdown: {
        position: new THREE.Vector3(0, 3.25, 0),
        target: new THREE.Vector3(0, 0.82, 0),
        up: new THREE.Vector3(0, 0, 1), // So P1 (-Z) is at screen bottom, P2 (+Z) at screen top!
      },
    };

    this.currentViewMode = 'host';
    this.headParallaxOffset = new THREE.Vector3(0, 0, 0);
    this.smoothedHeadOffset = new THREE.Vector3(0, 0, 0);
    this.headYaw = 0;
    this.smoothedHeadYaw = 0;
    this.setViewMode('host');

    // 4. Lighting
    this.setupLighting();

    // 5. Add Procedural Assets
    this.arena = createArenaEnvironment();
    this.scene.add(this.arena);

    // Static baked shadow plane beneath the table (eliminates real-time dynamic shadow map overhead)
    this.bakedTableShadow = createBakedTableShadow(TABLE_WIDTH, TABLE_LENGTH);
    this.scene.add(this.bakedTableShadow);

    this.table = createTableTennisTable();
    this.scene.add(this.table);

    // Paddles
    this.paddle1 = createPaddle('red');
    this.paddle1.position.set(0, 0.95, -1.45);
    this.scene.add(this.paddle1);

    this.paddle2 = createPaddle('black');
    this.paddle2.position.set(0, 0.95, 1.45);
    this.paddle2.rotation.y = Math.PI;
    this.scene.add(this.paddle2);

    // Ball
    this.ball = createBall();
    this.ball.position.set(0, 1.05, -1.35);
    this.scene.add(this.ball);

    // 6. Glowing Comet Motion Trail for ball visibility
    this.setupBallTrail();

    // 7. Impact Ring Effects
    this.createImpactEffects();

    // 8. High-contrast Landing Target Ring & Vertical Drop-Line on table surface
    const landingRingGeo = new THREE.RingGeometry(0.038, 0.075, 32);
    const landingRingMat = new THREE.MeshBasicMaterial({
      color: 0xd4a03c,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.landingRing = new THREE.Mesh(landingRingGeo, landingRingMat);
    this.landingRing.rotation.x = -Math.PI / 2;
    this.landingRing.position.set(0, TABLE_HEIGHT + 0.002, 0);
    this.scene.add(this.landingRing);

    // Vertical drop line from ball down to table surface
    const dropLineGeo = new THREE.BufferGeometry();
    dropLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0]), 3));
    const dropLineMat = new THREE.LineBasicMaterial({
      color: 0xe8b84e,
      transparent: true,
      opacity: 0.65,
      linewidth: 2,
    });
    this.dropLine = new THREE.Line(dropLineGeo, dropLineMat);
    this.dropLine.visible = false;
    this.scene.add(this.dropLine);

    // 9. Procedural Air Hockey Assets (swapped dynamically)
    this.gameMode = 'tennis';

    this.hockeyTable = createAirHockeyTable();
    this.hockeyTable.visible = false;
    this.scene.add(this.hockeyTable);

    this.striker1 = createAirHockeyStriker('p1');
    this.striker1.position.set(0, AIR_HOCKEY_TABLE_HEIGHT, -0.65);
    this.striker1.visible = false;
    this.scene.add(this.striker1);

    this.striker2 = createAirHockeyStriker('p2');
    this.striker2.position.set(0, AIR_HOCKEY_TABLE_HEIGHT, 0.65);
    this.striker2.visible = false;
    this.scene.add(this.striker2);

    this.puck = createAirHockeyPuck();
    this.puck.position.set(0, AIR_HOCKEY_TABLE_HEIGHT + 0.0038, 0);
    this.puck.visible = false;
    this.scene.add(this.puck);

    this.setupPuckTrail();
    this.setupPuckShadow();

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  setupLighting() {
    // 1. Ambient Light - warm tournament court ambient
    const ambientLight = new THREE.AmbientLight(0xfff2e0, 0.70);
    this.scene.add(ambientLight);

    // 2. Tournament Sky & Court Hemisphere Light - eliminates pitch-black void beneath meshes
    const hemiLight = new THREE.HemisphereLight(0xfffaee, 0x323a48, 0.65);
    this.scene.add(hemiLight);

    // 3. Overhead Tournament Key Light with positive bias (no self-shadow acne)
    const keyLight = new THREE.DirectionalLight(0xfff8ee, 1.45);
    keyLight.position.set(1.5, 6.0, -1.0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 1.0;
    keyLight.shadow.camera.far = 15;
    keyLight.shadow.camera.left = -3.5;
    keyLight.shadow.camera.right = 3.5;
    keyLight.shadow.camera.top = 3.5;
    keyLight.shadow.camera.bottom = -3.5;
    keyLight.shadow.bias = 0.0002;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    // 4. Warm metallic amber fill accent
    const fillLight = new THREE.DirectionalLight(0xd4a03c, 0.55);
    fillLight.position.set(-2.0, 5.0, 3.0);
    this.scene.add(fillLight);

    // 5. Arena rim light for tiered grandstand depth
    const arenaRimLight = new THREE.DirectionalLight(0x323e50, 0.40);
    arenaRimLight.position.set(0, 8.0, -8.0);
    this.scene.add(arenaRimLight);

    // 6. Overhead Table Center Spotlight
    const tableSpot = new THREE.SpotLight(0xfff2dc, 2.0, 12, Math.PI / 4, 0.45, 1.2);
    tableSpot.position.set(0, 5.2, 0);
    tableSpot.target.position.set(0, TABLE_HEIGHT, 0);
    this.scene.add(tableSpot);
    this.scene.add(tableSpot.target);

    // 7. Undercarriage Fill & Ground Bounce Lights
    // Ensures legs, wheels, leveling feet, and floor contact are clearly visible and grounded
    const underTableLight = new THREE.PointLight(0xe8f0fc, 1.2, 5.0, 1.2);
    underTableLight.position.set(0, 0.38, 0);
    this.scene.add(underTableLight);

    const frontUndercarriageFill = new THREE.DirectionalLight(0xdde6f2, 0.65);
    frontUndercarriageFill.position.set(0, 1.2, -3.8);
    this.scene.add(frontUndercarriageFill);

    const rearUndercarriageFill = new THREE.DirectionalLight(0xdde6f2, 0.55);
    rearUndercarriageFill.position.set(0, 1.2, 3.8);
    this.scene.add(rearUndercarriageFill);
  }

  setupBallTrail() {
    this.maxTrailPoints = 24;
    this.trailHistory = [];

    const positions = new Float32Array(this.maxTrailPoints * 3);
    const colors = new Float32Array(this.maxTrailPoints * 3);

    for (let i = 0; i < this.maxTrailPoints; i++) {
      const t = i / this.maxTrailPoints;
      // Flowing metallic amber gold comet trail: champagne gold -> rich amber -> deep bronze
      colors[i * 3 + 0] = 1.0 - t * 0.45;
      colors[i * 3 + 1] = 0.88 * (1.0 - t * 0.40);
      colors[i * 3 + 2] = 0.28 * (1.0 - t * 0.85);
    }

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.trailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.trailMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      linewidth: 3,
      blending: THREE.AdditiveBlending,
    });

    this.trailLine = new THREE.Line(this.trailGeometry, this.trailMaterial);
    this.scene.add(this.trailLine);
  }

  createImpactEffects() {
    const ringGeo = new THREE.RingGeometry(0.03, 0.08, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd4a03c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.impactRing = new THREE.Mesh(ringGeo, ringMat);
    this.impactRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.impactRing);
    this.impactTimer = 0;
  }

  triggerImpact(position, color = 0xd4a03c) {
    this.impactRing.position.copy(position);
    this.impactRing.position.y += 0.002;
    this.impactRing.material.color.setHex(color);
    this.impactRing.material.opacity = 0.9;
    this.impactRing.scale.set(1, 1, 1);
    this.impactTimer = 0.2;
  }

  setupPuckTrail() {
    this.maxPuckTrailPoints = 20;
    this.puckTrailHistory = [];

    const positions = new Float32Array(this.maxPuckTrailPoints * 3);
    const colors = new Float32Array(this.maxPuckTrailPoints * 3);

    for (let i = 0; i < this.maxPuckTrailPoints; i++) {
      const t = i / this.maxPuckTrailPoints;
      // Vibrant glowing neon crimson/orange gradient
      colors[i * 3 + 0] = 1.0;
      colors[i * 3 + 1] = 0.35 * (1.0 - t);
      colors[i * 3 + 2] = 0.15 * (1.0 - t);
    }

    this.puckTrailGeometry = new THREE.BufferGeometry();
    this.puckTrailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.puckTrailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.puckTrailMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      linewidth: 3,
      blending: THREE.AdditiveBlending,
    });

    this.puckTrailLine = new THREE.Line(this.puckTrailGeometry, this.puckTrailMaterial);
    this.puckTrailLine.visible = false;
    this.scene.add(this.puckTrailLine);
  }

  setupPuckShadow() {
    const shadowGeo = new THREE.RingGeometry(0.025, 0.045, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.puckShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.puckShadow.rotation.x = -Math.PI / 2;
    this.puckShadow.position.set(0, AIR_HOCKEY_TABLE_HEIGHT + 0.001, 0);
    this.puckShadow.visible = false;
    this.scene.add(this.puckShadow);
  }

  setGameMode(mode) {
    this.gameMode = mode;
    const isHockey = mode === 'hockey';

    // Toggle Table Tennis objects
    if (this.table) this.table.visible = !isHockey;
    if (this.paddle1) this.paddle1.visible = !isHockey;
    if (this.paddle2) this.paddle2.visible = !isHockey;
    if (this.ball) this.ball.visible = !isHockey;
    if (this.trailLine) this.trailLine.visible = !isHockey;
    if (this.landingRing) this.landingRing.visible = !isHockey;
    if (this.dropLine) this.dropLine.visible = !isHockey;

    // Toggle Air Hockey objects
    if (this.hockeyTable) this.hockeyTable.visible = isHockey;
    if (this.striker1) this.striker1.visible = isHockey;
    if (this.striker2) this.striker2.visible = isHockey;
    if (this.puck) this.puck.visible = isHockey;
    if (this.puckTrailLine) this.puckTrailLine.visible = isHockey;
    if (this.puckShadow) this.puckShadow.visible = isHockey;

    // Adjust baked shadow plane scale for active table footprint
    if (this.bakedTableShadow) {
      if (isHockey) {
        this.bakedTableShadow.scale.set(AIR_HOCKEY_TABLE_WIDTH / TABLE_WIDTH, AIR_HOCKEY_TABLE_LENGTH / TABLE_LENGTH, 1);
      } else {
        this.bakedTableShadow.scale.set(1, 1, 1);
      }
    }

    // Adjust camera targets if in hockey mode
    if (isHockey) {
      this.views.host.position.set(0, 1.48, -2.15);
      this.views.host.target.set(0, 0.82, 0.20);
      this.views.client.position.set(0, 1.48, 2.15);
      this.views.client.target.set(0, 0.82, -0.20);
      this.views.broadcast.position.set(2.4, 1.6, 0);
      this.views.broadcast.target.set(0, 0.82, 0);
    } else {
      this.views.host.position.set(0, 1.48, -2.55);
      this.views.host.target.set(0, 0.82, 0.20);
      this.views.client.position.set(0, 1.48, 2.55);
      this.views.client.target.set(0, 0.82, -0.20);
      this.views.broadcast.position.set(2.8, 1.6, 0);
      this.views.broadcast.target.set(0, 0.8, 0);
    }

    this.setViewMode(this.currentViewMode);
  }

  setHeadParallaxOffset(offset, yaw = 0) {
    if (offset) {
      this.headParallaxOffset.copy(offset);
    }
    if (typeof yaw === 'number') {
      this.headYaw = yaw;
    }
  }

  setHeadTracking(offset, yaw = 0) {
    this.setHeadParallaxOffset(offset, yaw);
  }

  setOrbit(enabled) {
    this.isOrbiting = Boolean(enabled);
    if (!this.isOrbiting) {
      this.setViewMode(this.currentViewMode);
    }
  }

  setViewMode(mode) {
    this.currentViewMode = mode;
    const view = this.views[mode] || this.views.host;
    if (view.up) {
      this.camera.up.copy(view.up);
    } else {
      this.camera.up.set(0, 1, 0);
    }
    this.camera.position.copy(view.position);
    this.camera.lookAt(view.target);
  }

  update(deltaTime) {
    // 0. Idle camera orbit around the table when on menu
    if (this.isOrbiting) {
      this.orbitAngle += deltaTime * this.orbitSpeed;
      const radius = 3.25;
      const camY = 1.62 + Math.sin(this.orbitAngle * 0.5) * 0.14;
      this.camera.position.set(
        Math.sin(this.orbitAngle) * radius,
        camY,
        Math.cos(this.orbitAngle) * radius
      );
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0.82, 0);
    } else {
      // Smooth Camera Perspective with Head-Tracking Parallax and Yaw Rotation
      const view = this.views[this.currentViewMode] || this.views.host;
      if (view) {
        if (view.up) {
          this.camera.up.copy(view.up);
        } else {
          this.camera.up.set(0, 1, 0);
        }

        this.smoothedHeadOffset.lerp(this.headParallaxOffset, Math.min(1.0, deltaTime * 8.0));
        this.smoothedHeadYaw += (this.headYaw - this.smoothedHeadYaw) * Math.min(1.0, deltaTime * 8.0);

        const camX = view.position.x;
        const camY = view.position.y;
        const camZ = view.position.z;

        if (this.currentViewMode === 'topdown') {
          this.camera.position.set(
            camX + this.smoothedHeadOffset.x,
            camY - this.smoothedHeadOffset.z * 0.5,
            camZ + this.smoothedHeadOffset.y
          );
        } else if (this.currentViewMode === 'client') {
          this.camera.position.set(
            camX + this.smoothedHeadOffset.x,
            camY + this.smoothedHeadOffset.y,
            camZ - this.smoothedHeadOffset.z
          );
        } else if (this.currentViewMode === 'broadcast') {
          this.camera.position.set(
            camX - this.smoothedHeadOffset.z,
            camY + this.smoothedHeadOffset.y,
            camZ + this.smoothedHeadOffset.x
          );
        } else {
          // Standard Host view (-Z looking towards +Z)
          this.camera.position.set(
            camX + this.smoothedHeadOffset.x,
            camY + this.smoothedHeadOffset.y,
            camZ + this.smoothedHeadOffset.z
          );
        }

        // Apply Head Yaw Rotation around vertical axis (unmirrored: looking right turns view right)
        if (Math.abs(this.smoothedHeadYaw) > 0.0001) {
          const upAxis = view.up ? view.up.clone() : new THREE.Vector3(0, 1, 0);
          const baseDir = view.target.clone().sub(this.camera.position);
          const rotatedDir = baseDir.applyAxisAngle(upAxis, this.smoothedHeadYaw);
          const effectiveTarget = this.camera.position.clone().add(rotatedDir);
          this.camera.lookAt(effectiveTarget);
        } else {
          this.camera.lookAt(view.target);
        }
      }
    }

    // Fade out impact ring
    if (this.impactTimer > 0) {
      this.impactTimer -= deltaTime;
      const progress = 1 - Math.max(0, this.impactTimer) / 0.2;
      this.impactRing.scale.setScalar(1 + progress * 2.5);
      this.impactRing.material.opacity = Math.max(0, 0.9 * (1 - progress));
    }

    // Dynamic Ball Trail Update
    if (this.ball && this.trailLine) {
      this.trailHistory.unshift(this.ball.position.clone());
      if (this.trailHistory.length > this.maxTrailPoints) {
        this.trailHistory.pop();
      }

      const posAttr = this.trailGeometry.attributes.position;
      for (let i = 0; i < this.maxTrailPoints; i++) {
        if (i < this.trailHistory.length) {
          posAttr.setXYZ(i, this.trailHistory[i].x, this.trailHistory[i].y, this.trailHistory[i].z);
        } else if (this.trailHistory.length > 0) {
          const last = this.trailHistory[this.trailHistory.length - 1];
          posAttr.setXYZ(i, last.x, last.y, last.z);
        }
      }
      posAttr.needsUpdate = true;
    }

    // Landing Ring & Vertical Drop-Line
    if (this.ball && this.landingRing && this.dropLine) {
      const bx = this.ball.position.x;
      const by = this.ball.position.y;
      const bz = this.ball.position.z;

      const heightAboveTable = by - TABLE_HEIGHT;
      const isOnTableX = Math.abs(bx) < 0.95;
      const isOnTableZ = Math.abs(bz) < 1.65;

      if (this.gameMode === 'tennis' && heightAboveTable > 0 && isOnTableX && isOnTableZ) {
        this.landingRing.visible = true;
        this.landingRing.position.set(bx, TABLE_HEIGHT + 0.002, bz);
        const opacity = THREE.MathUtils.clamp(0.95 - heightAboveTable * 0.45, 0.35, 0.95);
        this.landingRing.material.opacity = opacity;
        const scale = THREE.MathUtils.clamp(1.0 + heightAboveTable * 0.5, 0.8, 1.8);
        this.landingRing.scale.set(scale, scale, 1);

        this.dropLine.visible = true;
        const dropPosAttr = this.dropLine.geometry.attributes.position;
        dropPosAttr.setXYZ(0, bx, TABLE_HEIGHT + 0.002, bz);
        dropPosAttr.setXYZ(1, bx, by, bz);
        dropPosAttr.needsUpdate = true;
        this.dropLine.material.opacity = THREE.MathUtils.clamp(opacity * 0.8, 0.25, 0.75);
      } else {
        this.landingRing.visible = false;
        this.dropLine.visible = false;
      }
    }

    // Dynamic Air Hockey Puck Trail & Shadow
    if (this.gameMode === 'hockey' && this.puck && this.puckTrailLine) {
      this.puckTrailHistory.unshift(this.puck.position.clone());
      if (this.puckTrailHistory.length > this.maxPuckTrailPoints) {
        this.puckTrailHistory.pop();
      }

      const pAttr = this.puckTrailGeometry.attributes.position;
      for (let i = 0; i < this.maxPuckTrailPoints; i++) {
        if (i < this.puckTrailHistory.length) {
          pAttr.setXYZ(i, this.puckTrailHistory[i].x, this.puckTrailHistory[i].y, this.puckTrailHistory[i].z);
        } else if (this.puckTrailHistory.length > 0) {
          const last = this.puckTrailHistory[this.puckTrailHistory.length - 1];
          pAttr.setXYZ(i, last.x, last.y, last.z);
        }
      }
      pAttr.needsUpdate = true;

      if (this.puckShadow) {
        this.puckShadow.position.set(
          this.puck.position.x,
          AIR_HOCKEY_TABLE_HEIGHT + 0.001,
          this.puck.position.z
        );
      }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(width, height);
  }
}
