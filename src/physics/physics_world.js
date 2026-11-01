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
    });
    this.paddle1Body.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    this.paddle1Body.name = 'paddle1';
    this.world.addBody(this.paddle1Body);

    const p2Shape = new CANNON.Cylinder(paddleRadius, paddleRadius, paddleThickness, 24);
    this.paddle2Body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      material: this.paddleMaterial,
      shape: p2Shape,
      position: new CANNON.Vec3(0, 0.95 + 0.082, 1.45),
    });
    this.paddle2Body.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    this.paddle2Body.name = 'paddle2';
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
        const vy = Math.abs(this.ballBody.velocity.y);
        if (vy > 0.28 && now - this.lastTableBounceTime > 220) {
          this.lastTableBounceTime = now;
          const bouncePos = this.ballBody.position;
          const side = bouncePos.z < 0 ? 1 : 2;
          this.callbacks.onBallBounceTable(bouncePos, side);
        }
      } else if (targetName === 'paddle1') {
        if (now - this.lastPaddleHitTime > 120) {
          this.lastPaddleHitTime = now;
          this.callbacks.onBallHitPaddle(1, this.paddle1Body.velocity.length());
        }
        // Physics guard: ensure ball always travels forward towards opponent and never shoots wildly sideways
        if (this.ballBody.velocity.z < 1.0) {
          this.ballBody.velocity.z = Math.max(2.8, Math.abs(this.ballBody.velocity.z) * 1.2);
        }
        const toCenterX = -this.ballBody.position.x * 0.65;
        this.ballBody.velocity.x = THREE.MathUtils.clamp(toCenterX, -0.75, 0.75);
        if (this.ballBody.velocity.y < 0.3) this.ballBody.velocity.y = 0.8;
      } else if (targetName === 'paddle2') {
        if (now - this.lastPaddleHitTime > 120) {
          this.lastPaddleHitTime = now;
          this.callbacks.onBallHitPaddle(2, this.paddle2Body.velocity.length());
        }
        if (this.ballBody.velocity.z > -1.0) {
          this.ballBody.velocity.z = -Math.max(2.8, Math.abs(this.ballBody.velocity.z) * 1.2);
        }
        const toCenterX = -this.ballBody.position.x * 0.65;
        this.ballBody.velocity.x = THREE.MathUtils.clamp(toCenterX, -0.75, 0.75);
        if (this.ballBody.velocity.y < 0.3) this.ballBody.velocity.y = 0.8;
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
  checkContinuousStrikes(p1Pos, p1Vel, p1Yaw, p2Pos, p2Vel, p2Yaw, p2AimX) {
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

      // Contact requires ball to physically reach the racket face (within 12cm along Z and within blade radius)
      if (Math.abs(dz) <= 0.12 && dist2D < 0.14 && now - this.lastPaddleHitTime > 160) {
        this.lastPaddleHitTime = now;

        const swingForward = Math.max(0, p1Vel.z);
        // Dynamic, responsive return pace (2.8 to 4.0 m/s)
        const returnVz = THREE.MathUtils.clamp(2.8 + swingForward * 0.55, 2.8, 4.0);

        // Kinematic return arc: target landing cleanly on opponent's half (zLand = 0.75m)
        const targetZLand = 0.75;
        const flightTime = Math.max(0.35, (targetZLand - bPos.z) / returnVz);
        const deltaY = TABLE_HEIGHT - bPos.y;
        const calculatedVy = (deltaY - 0.5 * g * flightTime * flightTime) / flightTime;
        // Low, crisp trajectory clearing the net (0.9125m) without ballooning upwards
        const returnVy = THREE.MathUtils.clamp(calculatedVy, 0.72, 0.92);

        // Targeted aim on opponent's court:
        // When facing opponent (yaw ~ 0), steering is neutral.
        // Even with steering, the target landing X is strictly clamped within the opponent's table half:
        const maxCourtX = (TABLE_WIDTH / 2) * 0.70; // ~0.533m (well inside 0.7625m table half-width)
        const yaw = p1Yaw || 0;
        const steerX = Math.sin(yaw) * 0.35 + THREE.MathUtils.clamp(p1Vel.x * 0.12, -0.22, 0.22);
        const targetAimX = THREE.MathUtils.clamp(bPos.x * 0.20 + steerX, -maxCourtX, maxCourtX);
        const returnVx = THREE.MathUtils.clamp(
          (targetAimX - bPos.x) / flightTime,
          -1.1,
          1.1
        );

        bVel.set(returnVx, returnVy, returnVz);

        // Sidespin & topspin
        const spinY = yaw * 14.0 - p1Vel.x * 5.0;
        const spinX = 3.0 + swingForward * 4.0;
        this.ballBody.angularVelocity.set(spinX, spinY, 0);

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

      // Contact requires ball to physically reach the racket face (within 12cm along Z and within blade radius)
      if (Math.abs(dz) <= 0.12 && dist2D < 0.14 && now - this.lastPaddleHitTime > 160) {
        this.lastPaddleHitTime = now;

        const swingForward = Math.max(0, -p2Vel.z);
        // Powerful, assertive return pace (2.9 to 3.8 m/s) - no weak dribbles into the net!
        const returnVz = -THREE.MathUtils.clamp(2.9 + swingForward * 0.50, 2.9, 3.8);

        // Target landing cleanly deep on P1's table half (zLand = -0.75m)
        const targetZLand = -0.75;
        const flightTime = Math.max(0.35, (targetZLand - bPos.z) / returnVz);
        const deltaY = TABLE_HEIGHT - bPos.y;
        const calculatedVy = (deltaY - 0.5 * g * flightTime * flightTime) / flightTime;
        // Low, crisp trajectory clearing the net (0.9125m) without ballooning upwards
        const returnVy = THREE.MathUtils.clamp(calculatedVy, 0.72, 0.92);

        // CPU strategic placement: aim towards targetAimX clamped inside court
        const maxCourtX = (TABLE_WIDTH / 2) * 0.70; // ~0.533m
        const rawAimX = p2AimX !== undefined ? p2AimX : (Math.random() > 0.5 ? 0.32 : -0.32);
        const targetAimX = THREE.MathUtils.clamp(rawAimX, -maxCourtX, maxCourtX);
        const returnVx = THREE.MathUtils.clamp(
          (targetAimX - bPos.x) / flightTime,
          -1.0,
          1.0
        );

        bVel.set(returnVx, returnVy, returnVz);

        const cpuSpinY = -returnVx * 4.5;
        this.ballBody.angularVelocity.set(3.5, cpuSpinY, 0);

        this.callbacks.onBallHitPaddle(2, Math.max(1.0, swingForward));
      }
    }
  }

  applyMagnusEffect() {
    const v = this.ballBody.velocity;
    const w = this.ballBody.angularVelocity;

    const cx = w.y * v.z - w.z * v.y;
    const cy = w.z * v.x - w.x * v.z;
    const cz = w.x * v.y - w.y * v.x;

    const magnusCoeff = 0.0006;
    this.ballBody.applyForce(
      new CANNON.Vec3(cx * magnusCoeff, cy * magnusCoeff, cz * magnusCoeff),
      this.ballBody.position
    );
  }

  step(deltaTime, p1Pos, p1Vel, p1Yaw, p2Pos, p2Vel, p2Yaw, p2AimX) {
    if (this.isInRally) {
      this.applyMagnusEffect();
      this.checkContinuousStrikes(p1Pos, p1Vel, p1Yaw, p2Pos, p2Vel, p2Yaw, p2AimX);

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

    const startX = options.startX !== undefined ? options.startX : 0;
    const targetVx = options.targetVx !== undefined ? options.targetVx : 0;
    const paceVz = options.paceVz !== undefined ? options.paceVz : 2.75;
    const vy = options.vy !== undefined ? options.vy : -0.66;
    const spinY = options.spinY !== undefined ? options.spinY : 0;

    if (server === 1) {
      // P1 serves towards +Z
      this.ballBody.position.set(startX, 0.98, -1.25);
      this.ballBody.velocity.set(targetVx, vy, paceVz);
      this.ballBody.angularVelocity.set(2.0, spinY, 0);
    } else {
      // CPU serves towards -Z
      this.ballBody.position.set(startX, 0.98, 1.25);
      this.ballBody.velocity.set(targetVx, vy, -paceVz);
      this.ballBody.angularVelocity.set(2.0, spinY, 0);
    }

    // Reset collision debounces
    this.lastPaddleHitTime = performance.now();
    this.lastTableBounceTime = performance.now();
  }

  holdBallForServe(server = 1, paddlePos = null) {
    this.isInRally = false;
    this.isServeFlight = false;
    this.ballBody.type = CANNON.Body.KINEMATIC;
    this.ballBody.velocity.set(0, 0, 0);
    this.ballBody.angularVelocity.set(0, 0, 0);

    const z = server === 1 ? -1.25 : 1.25;
    const x = paddlePos ? THREE.MathUtils.clamp(paddlePos.x, -0.45, 0.45) : 0;
    this.ballBody.position.set(x, 0.98, z);
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
