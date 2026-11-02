import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {
  TABLE_WIDTH,
  TABLE_LENGTH,
  TABLE_HEIGHT,
  TABLE_THICKNESS,
  NET_HEIGHT,
  NET_OVERHANG,
  BALL_RADIUS,
} from '../graphics/procedural_models.js';

export class PhysicsWorld {
  constructor(callbacks = {}) {
    this.callbacks = Object.assign(
      {
        onBallHitPaddle: (player, speed) => {},
        onBallBounceTable: (position, side) => {},
        onBallHitNet: () => {},
        onBallHitFloor: () => {},
        onBallHitTableSide: (position) => {},
      },
      callbacks
    );

    // 1. Create Cannon World
    // Aerodynamic tuned gravity (-3.8 m/s^2) for readable, human-reaction ball speeds
    this.world = new CANNON.World();
    this.world.gravity.set(0, -3.8, 0);
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.defaultContactMaterial.contactEquationRelaxation = 3;
    this.world.solver.iterations = 12;
    this.world.solver.tolerance = 0.001;

    // 2. Materials
    this.ballMaterial = new CANNON.Material('ball');
    this.tableMaterial = new CANNON.Material('table');
    this.paddleMaterial = new CANNON.Material('paddle');
    this.netMaterial = new CANNON.Material('net');
    this.floorMaterial = new CANNON.Material('floor');

    // 3. Contact Materials
    const ballTableContact = new CANNON.ContactMaterial(this.ballMaterial, this.tableMaterial, {
      restitution: 0.82,
      friction: 0.14,
    });
    this.world.addContactMaterial(ballTableContact);

    const ballPaddleContact = new CANNON.ContactMaterial(this.ballMaterial, this.paddleMaterial, {
      restitution: 0.95,
      friction: 0.35,
    });
    this.world.addContactMaterial(ballPaddleContact);

    const ballNetContact = new CANNON.ContactMaterial(this.ballMaterial, this.netMaterial, {
      restitution: 0.12,
      friction: 0.6,
    });
    this.world.addContactMaterial(ballNetContact);

    const ballFloorContact = new CANNON.ContactMaterial(this.ballMaterial, this.floorMaterial, {
      restitution: 0.35,
      friction: 0.4,
    });
    this.world.addContactMaterial(ballFloorContact);

    // 4. Setup Bodies
    this.setupTable();
    this.setupNet();
    this.setupFloor();
    this.setupPaddles();
    this.setupBall();

    this.lastTableBounceTime = 0;
    this.lastPaddleHitTime = 0;
    this.isInRally = false;
    this.isServeFlight = false;

    this.setupCollisionListeners();
  }

  setupTable() {
    const halfWidth = TABLE_WIDTH / 2;
    const halfThickness = TABLE_THICKNESS / 2;
    const halfLength = TABLE_LENGTH / 2;

    const tableShape = new CANNON.Box(new CANNON.Vec3(halfWidth, halfThickness, halfLength));
    this.tableBody = new CANNON.Body({
      mass: 0,
      material: this.tableMaterial,
      shape: tableShape,
      position: new CANNON.Vec3(0, TABLE_HEIGHT - halfThickness, 0),
    });
    this.tableBody.name = 'table';
    this.world.addBody(this.tableBody);
  }

  setupNet() {
    const totalNetWidth = TABLE_WIDTH + NET_OVERHANG * 2;
    const netShape = new CANNON.Box(new CANNON.Vec3(totalNetWidth / 2, NET_HEIGHT / 2, 0.012));
    this.netBody = new CANNON.Body({
      mass: 0,
      material: this.netMaterial,
      shape: netShape,
      position: new CANNON.Vec3(0, TABLE_HEIGHT + NET_HEIGHT / 2, 0),
    });
    this.netBody.name = 'net';
    this.world.addBody(this.netBody);
  }

  setupFloor() {
    const floorShape = new CANNON.Plane();
    this.floorBody = new CANNON.Body({
      mass: 0,
      material: this.floorMaterial,
      shape: floorShape,
    });
    this.floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.floorBody.position.set(0, 0, 0);
    this.floorBody.name = 'floor';
    this.world.addBody(this.floorBody);
  }

  setupPaddles() {
    const paddleRadius = 0.095;
    const paddleThickness = 0.035;

    const p1Shape = new CANNON.Cylinder(paddleRadius, paddleRadius, paddleThickness, 24);
    this.paddle1Body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      material: this.paddleMaterial,
      shape: p1Shape,
      position: new CANNON.Vec3(0, 0.95 + 0.082, -1.45),
      collisionResponse: false, // Front-face swept strike detector handles all hits exclusively
    });
    this.paddle1Body.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    this.paddle1Body.name = 'paddle1';
    this.paddle1Body.collisionResponse = false;
    this.world.addBody(this.paddle1Body);

    const p2Shape = new CANNON.Cylinder(paddleRadius, paddleRadius, paddleThickness, 24);
    this.paddle2Body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      material: this.paddleMaterial,
      shape: p2Shape,
      position: new CANNON.Vec3(0, 0.95 + 0.082, 1.45),
      collisionResponse: false,
    });
    this.paddle2Body.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    this.paddle2Body.name = 'paddle2';
    this.paddle2Body.collisionResponse = false;
    this.world.addBody(this.paddle2Body);
  }

  setupBall() {
    const ballShape = new CANNON.Sphere(BALL_RADIUS);
    this.ballBody = new CANNON.Body({
      mass: 0.045,
      material: this.ballMaterial,
      shape: ballShape,
      linearDamping: 0.015,
      angularDamping: 0.035,
      position: new CANNON.Vec3(0, 1.05, -1.35),
    });
    this.ballBody.name = 'ball';
    this.world.addBody(this.ballBody);
  }

  setupCollisionListeners() {
    this.ballBody.addEventListener('collide', (event) => {
      if (!this.isInRally) return;

      const now = performance.now();
      const body = event.body;
      const targetName = body.name || '';

      if (targetName === 'table') {
        let isVerticalSide = false;
        const bPos = this.ballBody.position;

        if (event.contact && event.contact.ni) {
          const isBallBi = event.contact.bi === this.ballBody;
          const normalY = isBallBi ? -event.contact.ni.y : event.contact.ni.y;
          const normalX = isBallBi ? -event.contact.ni.x : event.contact.ni.x;
          const normalZ = isBallBi ? -event.contact.ni.z : event.contact.ni.z;

          // If contact normal is predominantly horizontal (|normalX| > 0.65 or |normalZ| > 0.65)
          // and has negligible/negative upward component (normalY < 0.35), it hit the vertical side
          if (normalY < 0.35 && (Math.abs(normalX) > 0.65 || Math.abs(normalZ) > 0.65)) {
            isVerticalSide = true;
          }
        }

        // Secondary geometric check: if ball center is strictly below table top surface
        if (bPos.y < TABLE_HEIGHT - 0.008) {
          isVerticalSide = true;
        }

        if (isVerticalSide) {
          // Rule: Edge balls on top flat edge/corner are IN.
          // However, hitting the vertical side of the table leaf is OUT!
          sound.playTableBounce(0.5);
          if (this.callbacks.onBallHitTableSide) {
            this.callbacks.onBallHitTableSide(bPos);
          }
          return;
        }

        const vy = Math.abs(this.ballBody.velocity.y);
        if (vy > 0.28 && now - this.lastTableBounceTime > 220) {
          this.lastTableBounceTime = now;
          const bouncePos = this.ballBody.position;
          const side = bouncePos.z < 0 ? 1 : 2;
          this.callbacks.onBallBounceTable(bouncePos, side);
        }
      } else if (targetName === 'paddle1' || targetName === 'paddle2') {
        // Paddle hits are exclusively handled by checkContinuousStrikes for strict front-face realism
        return;
      } else if (targetName === 'net') {
        this.callbacks.onBallHitNet();
      } else if (targetName === 'floor') {
        this.callbacks.onBallHitFloor();
      }
    });
  }

  updatePaddle1(position, quaternion, velocity) {
    const bladeY = position.y + 0.082;
    this.paddle1Body.position.set(position.x, bladeY, position.z);

    if (velocity) {
      this.paddle1Body.velocity.set(velocity.x, velocity.y, velocity.z);
    }

    if (quaternion) {
      const baseRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const combined = quaternion.clone().multiply(baseRot);
      this.paddle1Body.quaternion.set(combined.x, combined.y, combined.z, combined.w);
    }
  }

  updatePaddle2(position, quaternion, velocity) {
    const bladeY = position.y + 0.082;
    this.paddle2Body.position.set(position.x, bladeY, position.z);

    if (velocity) {
      this.paddle2Body.velocity.set(velocity.x, velocity.y, velocity.z);
    }

    if (quaternion) {
      const baseRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const combined = quaternion.clone().multiply(baseRot);
      this.paddle2Body.quaternion.set(combined.x, combined.y, combined.z, combined.w);
    }
  }

  /**
   * Continuous swept strike detector:
   * Tuned for readable, trackable ball pace with high-reaction rally speeds
   */
  checkContinuousStrikes(p1Pos, p1Vel, p1Yaw, p2Pos, p2Vel, p2Yaw, p2AimX, p2PowerMultiplier = 1.0) {
    if (!this.isInRally) return;

    const bPos = this.ballBody.position;
    const bVel = this.ballBody.velocity;
    const now = performance.now();
    const g = -3.8;

    // 1. Player 1 Strike Detection (vz < 0, ball moving towards P1)
    if (bVel.z < 0 && bPos.z < -0.35 && bPos.z > -2.1) {
      const p1BladeY = p1Pos.y + 0.082;
      const dx = bPos.x - p1Pos.x;
      const dy = bPos.y - p1BladeY;
      const dz = bPos.z - p1Pos.z;
      const dist2D = Math.hypot(dx, dy);

      // Contact requires ball to hit strictly the FRONT face (side facing the opponent +Z):
      const yaw = p1Yaw || 0;
      const normX = -Math.sin(yaw);
      const normZ = Math.cos(yaw);
      const distAlongNormal = dx * normX + dz * normZ;

      const relVelX = bVel.x - p1Vel.x;
      const relVelZ = bVel.z - p1Vel.z;
      const closingSpeed = -(relVelX * normX + relVelZ * normZ);

      // Strict Front-Face Only:
      // 1. Ball must be in FRONT of the racket face (dz >= 0.003)
      // 2. Ball must be on the front side of the angled plane (distAlongNormal >= 0.005)
      // 3. Front face must be oriented towards opponent (normZ > 0.35)
      // 4. Relative motion must be closing into front face (closingSpeed > 0.15)
      // 5. Racket must NOT be retreating backward away from net (unless making an active lateral lunge/reach)
      const isLateralReach = Math.abs(p1Vel.x) > 0.35 || Math.abs(p1Pos.x) > (TABLE_WIDTH * 0.40) || Math.abs(bPos.x) > (TABLE_WIDTH * 0.40);
      const isNotRetreating = p1Vel.z >= -0.16 || isLateralReach;

      const isFrontFaceContact = (
        dz >= 0.003 &&
        dz <= 0.18 &&
        distAlongNormal >= 0.005 &&
        normZ > 0.35 &&
        closingSpeed > 0.15 &&
        isNotRetreating
      );

      // Hit radius: default 0.14m, expanded to 0.165m when lunging out for wide shots
      const maxHitDist = isLateralReach ? 0.165 : 0.14;

      if (isFrontFaceContact && dist2D < maxHitDist && now - this.lastPaddleHitTime > 160) {
        this.lastPaddleHitTime = now;

        const swingForward = Math.max(0, p1Vel.z);
        // Dynamic, responsive return pace (2.8 to 4.0 m/s)
        const returnVz = THREE.MathUtils.clamp(2.8 + swingForward * 0.55, 2.8, 4.0);

        // Kinematic return arc: target landing cleanly on opponent's half (zLand = 0.75m)
        const targetZLand = 0.75;
        const flightTime = Math.max(0.35, (targetZLand - bPos.z) / returnVz);
        const deltaY = TABLE_HEIGHT - bPos.y;
        const calculatedVy = (deltaY - 0.5 * g * flightTime * flightTime) / flightTime;
        // Ensure clean net clearance (> 3.5cm over the net tape at Z=0)
        const tNet = Math.max(0.1, -bPos.z / returnVz);
        const minNetClearanceY = TABLE_HEIGHT + NET_HEIGHT + BALL_RADIUS + 0.035;
        const minVyForNet = (minNetClearanceY - bPos.y - 0.5 * g * tNet * tNet) / tNet;
        const returnVy = THREE.MathUtils.clamp(Math.max(calculatedVy, minVyForNet), 0.80, 1.05);

        // Realistic Angled Strike Physics (Linear straight-line trajectories):
        // 1. Paddle face yaw angle (in radians: positive = right, negative = left)
        const yaw = p1Yaw || 0;
        // 2. Horizontal swing swipe direction
        const swingSwipeAngle = Math.atan2(p1Vel.x, Math.max(1.8, swingForward + 1.8));
        // 3. Contact offset on the paddle blade (dx = bPos.x - p1Pos.x)
        const contactOffsetAngle = THREE.MathUtils.clamp(dx / 0.095, -1, 1) * 0.18;

        // Combined physical launch angle
        const launchAngle = yaw * 1.15 + swingSwipeAngle * 0.70 + contactOffsetAngle;

        // Straight-line trajectory along launchAngle:
        const distZ = targetZLand - bPos.z;
        const projectedX = bPos.x + distZ * Math.tan(launchAngle);

        // Playable table limits: allow hitting anywhere across the court up to the outer white lines
        const maxCourtX = (TABLE_WIDTH / 2) * 0.92; // 0.70m (table half-width is 0.7625m)
        const targetAimX = THREE.MathUtils.clamp(projectedX, -maxCourtX, maxCourtX);

        // Horizontal velocity travels in a direct, laser-straight line to targetAimX
        const returnVx = (targetAimX - bPos.x) / flightTime;

        bVel.set(returnVx, returnVy, returnVz);

        // Zero spin for pure, laser-straight flight without mid-air curving
        this.ballBody.angularVelocity.set(0, 0, 0);

        this.callbacks.onBallHitPaddle(1, Math.max(1.0, swingForward));
        return;
      }
    }

    // 2. Player 2 (CPU / Client) Strike Detection (vz > 0, ball moving towards P2)
    if (bVel.z > 0 && bPos.z > 0.35 && bPos.z < 2.1) {
      const p2BladeY = p2Pos.y + 0.082;
      const dx = bPos.x - p2Pos.x;
      const dy = bPos.y - p2BladeY;
      const dz = bPos.z - p2Pos.z;
      const dist2D = Math.hypot(dx, dy);

      // Contact requires ball to hit strictly the FRONT face (-Z side facing Player 1):
      const yaw = p2Yaw || 0;
      const normX = Math.sin(yaw);
      const normZ = -Math.cos(yaw);
      const distAlongNormal = dx * normX + dz * normZ;

      const relVelX = bVel.x - p2Vel.x;
      const relVelZ = bVel.z - p2Vel.z;
      const closingSpeed = -(relVelX * normX + relVelZ * normZ);

      // Strict Front-Face Only:
      // 1. Ball must be in FRONT of Player 2's racket face (dz <= -0.003)
      // 2. Ball must be on front side of angled plane (distAlongNormal >= 0.005)
      // 3. Front face must be oriented towards Player 1 (normZ < -0.35)
      // 4. Relative motion closing into front face (closingSpeed > 0.15)
      // 5. Racket must NOT be pulling backwards towards +Z (unless making an active lateral lunge/reach)
      const isP2LateralReach = Math.abs(p2Vel.x) > 0.35 || Math.abs(p2Pos.x) > (TABLE_WIDTH * 0.40) || Math.abs(bPos.x) > (TABLE_WIDTH * 0.40);
      const isP2NotRetreating = p2Vel.z <= 0.16 || isP2LateralReach;

      const isFrontFaceContact = (
        dz <= -0.003 &&
        dz >= -0.18 &&
        distAlongNormal >= 0.005 &&
        normZ < -0.35 &&
        closingSpeed > 0.15 &&
        isP2NotRetreating
      );

      // Hit radius: default 0.14m, expanded to 0.165m when lunging out for wide shots
      const maxHitDist = isP2LateralReach ? 0.165 : 0.14;

      if (isFrontFaceContact && dist2D < maxHitDist && now - this.lastPaddleHitTime > 160) {
        this.lastPaddleHitTime = now;

        const swingForward = Math.max(0, -p2Vel.z);
        // Scaled return pace based on difficulty returnPower multiplier
        const baseReturnPace = (2.9 + swingForward * 0.50) * (p2PowerMultiplier || 1.0);
        const returnVz = -THREE.MathUtils.clamp(baseReturnPace, 2.3, 4.4);

        // Target landing cleanly deep on P1's table half (zLand = -0.75m)
        const targetZLand = -0.75;
        const flightTime = Math.max(0.35, (targetZLand - bPos.z) / returnVz);
        const deltaY = TABLE_HEIGHT - bPos.y;
        const calculatedVy = (deltaY - 0.5 * g * flightTime * flightTime) / flightTime;
        // Ensure clean net clearance (> 3.5cm over the net tape at Z=0)
        const tNet = Math.max(0.1, bPos.z / Math.abs(returnVz));
        const minNetClearanceY = TABLE_HEIGHT + NET_HEIGHT + BALL_RADIUS + 0.035;
        const minVyForNet = (minNetClearanceY - bPos.y - 0.5 * g * tNet * tNet) / tNet;
        const returnVy = THREE.MathUtils.clamp(Math.max(calculatedVy, minVyForNet), 0.80, 1.05);

        // CPU strategic placement: aim towards targetAimX across court in straight line
        const maxCourtX = (TABLE_WIDTH / 2) * 0.88; // ~0.67m
        const rawAimX = p2AimX !== undefined ? p2AimX : (Math.random() > 0.5 ? 0.38 : -0.38);
        const targetAimX = THREE.MathUtils.clamp(rawAimX, -maxCourtX, maxCourtX);
        const returnVx = (targetAimX - bPos.x) / flightTime;

        bVel.set(returnVx, returnVy, returnVz);

        // Zero spin for pure, laser-straight flight
        this.ballBody.angularVelocity.set(0, 0, 0);

        this.callbacks.onBallHitPaddle(2, Math.max(1.0, swingForward));
      }
    }
  }

  applyMagnusEffect() {
    // Disabled: table tennis ball travels in pure, straight lines without mid-air curving
  }

  step(deltaTime, p1Pos, p1Vel, p1Yaw, p2Pos, p2Vel, p2Yaw, p2AimX, p2PowerMultiplier = 1.0) {
    if (this.isInRally) {
      this.checkContinuousStrikes(p1Pos, p1Vel, p1Yaw, p2Pos, p2Vel, p2Yaw, p2AimX, p2PowerMultiplier);

      // Height safety: clamp maximum ball height so it never balloons into the ceiling
      if (this.ballBody.position.y > 1.08 && this.ballBody.velocity.y > 0) {
        this.ballBody.velocity.y = -0.4;
      }

      // Serve safety: during serve flight, ensure ball never gets stuck in the net at Z=0
      if (this.isServeFlight && Math.abs(this.ballBody.position.z) < 0.22) {
        if (this.ballBody.position.y < 0.95) {
          this.ballBody.position.y = 0.98;
          if (this.ballBody.velocity.y < 0.2) {
            this.ballBody.velocity.y = 0.6;
          }
        }
      }

      const fixedTimeStep = 1 / 120;
      this.world.step(fixedTimeStep, Math.min(deltaTime, 0.05), 4);
    }
  }

  /**
   * Serve physics:
   * Calibrated kinematics for guaranteed first bounce on server's table side,
   * smooth parabolic arc with > 12cm clearance over the net (Z=0),
   * and deep second bounce in the receiver's half for a readable, juicy return.
   */
  serveBall(server = 1, options = {}) {
    this.isInRally = true;
    this.isServeFlight = true;
    this.ballBody.type = CANNON.Body.DYNAMIC;
    this.ballBody.collisionResponse = true;

    const startX = options.startX !== undefined ? options.startX : 0;
    const targetVx = options.targetVx !== undefined ? options.targetVx : 0;
    const paceVz = options.paceVz !== undefined ? options.paceVz : 2.75;
    const vy = options.vy !== undefined ? options.vy : -0.66;

    if (server === 1) {
      // P1 serves towards +Z
      this.ballBody.position.set(startX, 0.98, -1.25);
      this.ballBody.velocity.set(targetVx, vy, paceVz);
      this.ballBody.angularVelocity.set(0, 0, 0);
    } else {
      // CPU serves towards -Z
      this.ballBody.position.set(startX, 0.98, 1.25);
      this.ballBody.velocity.set(targetVx, vy, -paceVz);
      this.ballBody.angularVelocity.set(0, 0, 0);
    }

    // Reset collision debounces
    this.lastPaddleHitTime = performance.now();
    this.lastTableBounceTime = performance.now();
  }

  holdBallForServe(server = 1, paddlePos = null) {
    this.isInRally = false;
    this.isServeFlight = false;
    this.ballBody.type = CANNON.Body.KINEMATIC;
    this.ballBody.collisionResponse = false;
    this.ballBody.velocity.set(0, 0, 0);
    this.ballBody.angularVelocity.set(0, 0, 0);

    const z = server === 1 ? -1.05 : 1.05;
    const x = paddlePos ? THREE.MathUtils.clamp(paddlePos.x, -0.45, 0.45) : 0;
    this.ballBody.position.set(x, TABLE_HEIGHT + 0.22, z);
  }

  applyBallImpulse(impulseVec) {
    this.ballBody.applyImpulse(impulseVec, this.ballBody.position);
  }

  smashBall(player) {
    const dirZ = player === 1 ? 4.6 : -4.6;
    // Smashes drive flat, fast, and aggressively into the opponent's table half
    const clampedVx = THREE.MathUtils.clamp(this.ballBody.velocity.x * 0.25, -0.5, 0.5);
    this.ballBody.velocity.set(clampedVx, 0.20, dirZ);
    // Heavy topspin drives the ball down onto the table
    this.ballBody.angularVelocity.set(player === 1 ? 8.0 : -8.0, 0, 0);
  }
}
