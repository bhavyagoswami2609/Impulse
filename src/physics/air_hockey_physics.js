/**
 * AirHockeyPhysics - High-Performance 2D Planar Physics Engine for Air Hockey
 *
 * Implements continuous collision detection (CCD), realistic cushion wall reflections
 * with normal restitution & tangential friction retention, circular striker dynamic impulses
 * with velocity transfer and spin/slice curve mechanics, goal post deflectors,
 * corner fillets, air table drag damping, and goal cavity sensors.
 *
 * Coordinate System (Three.js XZ plane, table center at (0, 0)):
 *  - X: Width axis [-0.55m, +0.55m] (Total width W = 1.10m)
 *  - Z: Length axis [-1.07m, +1.07m] (Total length L = 2.14m)
 *  - P1 defends -Z (serves towards +Z), P2 defends +Z (serves towards -Z)
 */

export const TABLE_LENGTH = 2.14; // m (along Z)
export const TABLE_WIDTH = 1.10;  // m (along X)
export const HALF_LENGTH = TABLE_LENGTH / 2; // 1.07m
export const HALF_WIDTH = TABLE_WIDTH / 2;   // 0.55m

export const GOAL_WIDTH = 0.34;   // m (|x| <= 0.17m)
export const HALF_GOAL_WIDTH = GOAL_WIDTH / 2; // 0.17m
export const POST_RADIUS = 0.015; // m (15mm)
export const CORNER_RADIUS = 0.06; // m (fillet radius Rc = 60mm)
export const CORNER_BOUNCER_SIZE = 0.15; // m (150mm 45° angled corner bouncer/deflector)

export const STRIKER_RADIUS = 0.050; // m (100mm diameter)
export const PUCK_RADIUS = 0.038;    // m (76mm diameter)
export const PUCK_MASS = 0.035;      // kg (35g)

export const WALL_RESTITUTION = 0.88;
export const WALL_FRICTION_RETENTION = 0.98;
export const STRIKER_RESTITUTION = 0.55;

export const DEFAULT_DRAG = 0.18;
export const MAX_VELOCITY = 5.2;    // m/s
export const MIN_VELOCITY_CUTOFF = 0.02; // m/s
export const GOAL_POCKET_DEPTH = 0.15; // m behind goal line

export class AirHockeyPhysics {
  /**
   * @param {Object} [options]
   * @param {number} [options.drag=0.04] Air table drag coefficient
   * @param {number} [options.wallRestitution=0.88] Cushion wall normal restitution
   * @param {number} [options.wallFriction=0.98] Cushion wall tangential friction retention
   * @param {number} [options.strikerRestitution=0.92] Striker-puck normal restitution
   * @param {number} [options.velocityBoostFactor=0.15] Extra velocity boost from striker swing
   * @param {number} [options.spinCurveFactor=0.10] Lateral Magnus curve force from puck spin
   * @param {number} [options.spinDrag=0.25] Spin decay rate per second
   * @param {number} [options.maxVelocity=12.0] Maximum puck speed (m/s)
   * @param {number} [options.minVelocityCutoff=0.02] Min puck speed before resting (m/s)
   * @param {Function} [options.onPuckHitWall] Callback (point, normal, speed)
   * @param {Function} [options.onPuckHitStriker] Callback (strikerId, speed, angle)
   * @param {Function} [options.onPuckHitPost] Callback (point)
   * @param {Function} [options.onGoalScored] Callback (scorerPlayerId)
   */
  constructor(options = {}) {
    // Configurable parameters
    this.drag = options.drag ?? DEFAULT_DRAG;
    this.wallRestitution = options.wallRestitution ?? WALL_RESTITUTION;
    this.wallFriction = options.wallFriction ?? WALL_FRICTION_RETENTION;
    this.strikerRestitution = options.strikerRestitution ?? STRIKER_RESTITUTION;
    this.velocityBoostFactor = options.velocityBoostFactor ?? 0.15;
    this.spinCurveFactor = options.spinCurveFactor ?? 0.0;
    this.spinDrag = options.spinDrag ?? 0.25;
    this.maxVelocity = options.maxVelocity ?? MAX_VELOCITY;
    this.minVelocityCutoff = options.minVelocityCutoff ?? MIN_VELOCITY_CUTOFF;

    // Callbacks
    this.onPuckHitWall = options.onPuckHitWall || null;
    this.onPuckHitStriker = options.onPuckHitStriker || null;
    this.onPuckHitPost = options.onPuckHitPost || null;
    this.onGoalScored = options.onGoalScored || null;

    // Puck State
    this.puckPos = { x: 0, z: 0 };
    this.puckVel = { x: 0, z: 0 };
    this.puckSpin = 0; // Angular velocity around Y (rad/s), positive = counter-clockwise in XZ
    this.isGoalScored = false;
    this.lastScorer = null;
    this.isSleeping = false;

    // Previous striker positions to calculate fallback velocities if not provided
    this.prevP1Pos = { x: 0, z: -HALF_LENGTH * 0.5 };
    this.prevP2Pos = { x: 0, z: HALF_LENGTH * 0.5 };

    // Substepping configuration for anti-tunneling
    this.maxSubstepDist = PUCK_RADIUS * 0.25; // max 9.5mm per substep
    this.maxSubsteps = 32;

    // 45° Corner Deflectors / Bouncers across all 4 table corners
    // Replaces sharp 90° corner pockets with solid 45° angled cushions
    // connecting (±0.40m, ±1.07m) and (±0.55m, ±0.92m).
    this.cornerBouncers = [
      { qx: 1, qz: 1 },    // Top-Right (North-East)
      { qx: -1, qz: 1 },   // Top-Left (North-West)
      { qx: 1, qz: -1 },   // Bottom-Right (South-East)
      { qx: -1, qz: -1 },  // Bottom-Left (South-West)
    ];

    // Goal Post Centers (4 posts at ±0.17m, ±1.07m)
    this.goalPosts = [
      { id: 'BL', x: -HALF_GOAL_WIDTH, z: -HALF_LENGTH, radius: POST_RADIUS },
      { id: 'BR', x: HALF_GOAL_WIDTH, z: -HALF_LENGTH, radius: POST_RADIUS },
      { id: 'TL', x: -HALF_GOAL_WIDTH, z: HALF_LENGTH, radius: POST_RADIUS },
      { id: 'TR', x: HALF_GOAL_WIDTH, z: HALF_LENGTH, radius: POST_RADIUS },
    ];

    // Initial reset to center
    this.resetPuck(1);
  }

  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /**
   * Advance the physics simulation by time dt (seconds).
   * Supports input as objects {x, z}, Three.js Vector3 {x, y, z}, or arrays [x, z].
   *
   * @param {number} dt Delta time in seconds
   * @param {Object|Array} p1StrikerPos P1 striker position
   * @param {Object|Array} [p1StrikerVel] P1 striker velocity (optional, computed if omitted)
   * @param {Object|Array} p2StrikerPos P2 striker position
   * @param {Object|Array} [p2StrikerVel] P2 striker velocity (optional, computed if omitted)
   */
  step(dt, p1StrikerPos, p1StrikerVel, p2StrikerPos, p2StrikerVel) {
    if (dt <= 0 || isNaN(dt)) return;
    // Clamp excessive dt (e.g. background tab switch) to maintain numerical stability
    const clampedDt = Math.max(0, Math.min(dt, 0.1));

    // Parse striker positions and velocities
    const s1Pos = this._parseVec2(p1StrikerPos, this.prevP1Pos);
    const s2Pos = this._parseVec2(p2StrikerPos, this.prevP2Pos);

    let s1Vel = p1StrikerVel ? this._parseVec2(p1StrikerVel) : null;
    let s2Vel = p2StrikerVel ? this._parseVec2(p2StrikerVel) : null;

    if (!s1Vel) {
      s1Vel = {
        x: (s1Pos.x - this.prevP1Pos.x) / clampedDt,
        z: (s1Pos.z - this.prevP1Pos.z) / clampedDt,
      };
    }
    if (!s2Vel) {
      s2Vel = {
        x: (s2Pos.x - this.prevP2Pos.x) / clampedDt,
        z: (s2Pos.z - this.prevP2Pos.z) / clampedDt,
      };
    }

    // Update previous positions
    this.prevP1Pos = { x: s1Pos.x, z: s1Pos.z };
    this.prevP2Pos = { x: s2Pos.x, z: s2Pos.z };

    // If puck is resting in goal pocket, apply heavy damping and check constraints
    if (this.isGoalScored) {
      this._stepInGoalPocket(clampedDt);
      return;
    }

    // Adaptive substepping for anti-tunneling Continuous Collision Detection (CCD)
    const puckSpeed = Math.hypot(this.puckVel.x, this.puckVel.z);
    const s1Speed = Math.hypot(s1Vel.x, s1Vel.z);
    const s2Speed = Math.hypot(s2Vel.x, s2Vel.z);
    const maxRelSpeed = Math.max(puckSpeed, s1Speed, s2Speed, 1.0);

    const neededSubsteps = Math.ceil((maxRelSpeed * clampedDt) / this.maxSubstepDist);
    const numSubsteps = Math.min(this.maxSubsteps, Math.max(1, neededSubsteps));
    const subDt = clampedDt / numSubsteps;

    for (let i = 0; i < numSubsteps; i++) {
      // Interpolate striker position for current sub-step
      const alpha0 = i / numSubsteps;
      const alpha1 = (i + 1) / numSubsteps;
      const subS1Pos = {
        x: s1Pos.x - s1Vel.x * (1 - alpha1) * clampedDt,
        z: s1Pos.z - s1Vel.z * (1 - alpha1) * clampedDt,
      };
      const subS2Pos = {
        x: s2Pos.x - s2Vel.x * (1 - alpha1) * clampedDt,
        z: s2Pos.z - s2Vel.z * (1 - alpha1) * clampedDt,
      };

      this._substep(subDt, subS1Pos, s1Vel, subS2Pos, s2Vel);

      if (this.isGoalScored) break;
    }

    // Safeguard check for zero NaNs
    this._sanitizeState();
  }

  /**
   * Reset the puck to a stationary serving state.
   *
   * @param {number} [serverPlayerId=1] 1 (P1, -Z side) or 2 (P2, +Z side)
   */
  resetPuck(serverPlayerId = 1) {
    this.puckVel = { x: 0, z: 0 };
    this.puckSpin = 0;
    this.isGoalScored = false;
    this.lastScorer = null;
    this.isSleeping = false;

    if (serverPlayerId === 2) {
      this.puckPos = { x: 0, z: 0.45 };
    } else {
      this.puckPos = { x: 0, z: -0.45 };
    }
  }

  /**
   * Serve the puck into play with options.
   *
   * @param {number} [serverPlayerId=1] 1 or 2
   * @param {Object} [options]
   * @param {number} [options.speed=3.0] Initial serve speed (m/s)
   * @param {number} [options.angle] Launch angle in radians (0 = straight along +Z, PI = -Z)
   * @param {number} [options.spin=0] Initial spin (rad/s)
   * @param {Object} [options.position] Optional custom starting position {x, z}
   */
  servePuck(serverPlayerId = 1, options = {}) {
    this.isGoalScored = false;
    this.lastScorer = null;
    this.isSleeping = false;

    if (options.position) {
      this.puckPos = { x: options.position.x, z: options.position.z };
    } else {
      const zOffset = serverPlayerId === 2 ? 0.45 : -0.45;
      this.puckPos = { x: 0, z: zOffset };
    }

    const speed = options.speed ?? 3.0;
    let angle = options.angle;
    if (angle === undefined) {
      // Default: shoot towards opponent with a slight slight random bank angle (±15°)
      const spread = (Math.random() - 0.5) * (Math.PI / 6);
      angle = serverPlayerId === 2 ? Math.PI + spread : 0 + spread;
    }

    this.puckVel = {
      x: Math.sin(angle) * speed,
      z: Math.cos(angle) * speed,
    };
    this.puckSpin = options.spin ?? 0;
  }

  /**
   * Get complete snapshot of puck state.
   */
  getPuckState() {
    return {
      position: { x: this.puckPos.x, z: this.puckPos.z },
      velocity: { x: this.puckVel.x, z: this.puckVel.z },
      speed: Math.hypot(this.puckVel.x, this.puckVel.z),
      spin: this.puckSpin,
      isGoalScored: this.isGoalScored,
      lastScorer: this.lastScorer,
      isSleeping: this.isSleeping,
    };
  }

  /**
   * Set puck position directly.
   */
  setPuckPosition(x, z) {
    this.puckPos.x = x;
    this.puckPos.z = z;
  }

  /**
   * Set puck velocity directly.
   */
  setPuckVelocity(vx, vz) {
    this.puckVel.x = vx;
    this.puckVel.z = vz;
  }

  /**
   * Set puck angular velocity (spin).
   */
  setPuckSpin(spin) {
    this.puckSpin = spin;
  }

  /**
   * Clamps striker position to legal physical boundaries (table half, outer rails,
   * and 45° corner bouncers). Striker cannot cross centerline or penetrate corner bouncers.
   *
   * @param {number} strikerId 1 (defending -Z) or 2 (defending +Z)
   * @param {Object} pos {x, z}
   * @returns {{x: number, z: number}}
   */
  clampStrikerPosition(strikerId, pos) {
    let minX = -HALF_WIDTH + STRIKER_RADIUS;
    let maxX = HALF_WIDTH - STRIKER_RADIUS;
    let x = Math.max(minX, Math.min(maxX, pos.x));

    let minZ, maxZ;
    if (strikerId === 1) {
      minZ = -HALF_LENGTH + STRIKER_RADIUS;
      maxZ = -0.005; // Can reach up to the center line (Z=0) without crossing into P2 half
    } else {
      minZ = 0.005;  // Can reach up to the center line (Z=0) without crossing into P1 half
      maxZ = HALF_LENGTH - STRIKER_RADIUS;
    }
    let z = Math.max(minZ, Math.min(maxZ, pos.z));

    // Clamp against 45° corner bouncers so striker cannot enter corner pockets
    const Dcorner = (HALF_WIDTH - CORNER_BOUNCER_SIZE) + HALF_LENGTH; // 0.40 + 1.07 = 1.47m
    const Kstriker = Dcorner - STRIKER_RADIUS * Math.SQRT2; // ~1.39929m
    for (const b of this.cornerBouncers) {
      const s = b.qx * x + b.qz * z;
      if (s > Kstriker) {
        const d = (s - Kstriker) / 2;
        x -= b.qx * d;
        z -= b.qz * d;
      }
    }

    return { x, z };
  }

  /**
   * Return table dimensions and geometry metadata.
   */
  getTableDimensions() {
    return {
      length: TABLE_LENGTH,
      width: TABLE_WIDTH,
      halfLength: HALF_LENGTH,
      halfWidth: HALF_WIDTH,
      goalWidth: GOAL_WIDTH,
      halfGoalWidth: HALF_GOAL_WIDTH,
      postRadius: POST_RADIUS,
      cornerRadius: CORNER_RADIUS,
      cornerBouncerSize: CORNER_BOUNCER_SIZE,
      strikerRadius: STRIKER_RADIUS,
      puckRadius: PUCK_RADIUS,
      puckMass: PUCK_MASS,
    };
  }

  /**
   * Return array of the 4 goal post positions and radius.
   */
  getGoalPosts() {
    return this.goalPosts.map(p => ({ ...p, radius: POST_RADIUS }));
  }

  // --------------------------------------------------------------------------
  // Internal Simulation & Substepping Logic
  // --------------------------------------------------------------------------

  _substep(subDt, s1Pos, s1Vel, s2Pos, s2Vel) {
    // 1. Aerodynamic Air Drag Damping (stable exponential decay)
    const damping = Math.exp(-this.drag * subDt);
    this.puckVel.x *= damping;
    this.puckVel.z *= damping;

    // 2. Spin decay (visual rotation retained, but no artificial Magnus curve force unless configured)
    if (Math.abs(this.puckSpin) > 0.01) {
      if (this.spinCurveFactor > 0.001) {
        const curveMag = this.spinCurveFactor * this.puckSpin * subDt;
        this.puckVel.x += -this.puckVel.z * curveMag;
        this.puckVel.z += this.puckVel.x * curveMag;
      }

      // Spin decay due to air friction
      this.puckSpin *= Math.exp(-this.spinDrag * subDt);
      if (Math.abs(this.puckSpin) < 0.005) this.puckSpin = 0;
    }

    // 3. Velocity Clamping & Min Sleep Cutoff
    let speed = Math.hypot(this.puckVel.x, this.puckVel.z);
    if (speed < this.minVelocityCutoff) {
      this.puckVel.x = 0;
      this.puckVel.z = 0;
      this.isSleeping = true;
      speed = 0;
    } else {
      this.isSleeping = false;
      if (speed > this.maxVelocity) {
        const factor = this.maxVelocity / speed;
        this.puckVel.x *= factor;
        this.puckVel.z *= factor;
        speed = this.maxVelocity;
      }
    }

    // 4. Striker CCD & Impulse Collisions
    // Check both strikers: compute swept circle or static overlap
    this._handleStrikerCollision(1, s1Pos, s1Vel, subDt);
    this._handleStrikerCollision(2, s2Pos, s2Vel, subDt);

    // 5. Integrate Puck Position
    this.puckPos.x += this.puckVel.x * subDt;
    this.puckPos.z += this.puckVel.z * subDt;

    // 6. Check Goal Pocket Entry
    if (this._checkGoalEntry()) {
      return;
    }

    // 7. Goal Post Collisions (Deflectors)
    this._handleGoalPostCollisions();

    // 8. 45° Corner Bouncer Collisions (Deflectors)
    this._handleCornerBouncerCollisions();

    // 9. Cushion Wall Collisions (Straight Side & End Rails)
    this._handleStraightWallCollisions();

    // 10. Secondary Striker Depenetration (guarantee no overlap)
    this._depenetrateStriker(1, s1Pos);
    this._depenetrateStriker(2, s2Pos);
  }

  /**
   * Continuous Collision Detection (CCD) & dynamic impulse between striker and puck.
   */
  _handleStrikerCollision(strikerId, sPos, sVel, subDt) {
    const contactDist = STRIKER_RADIUS + PUCK_RADIUS;
    const contactDistSq = contactDist * contactDist;

    let dx = this.puckPos.x - sPos.x;
    let dz = this.puckPos.z - sPos.z;
    let distSq = dx * dx + dz * dz;

    // Relative velocity: v_rel = v_puck - v_striker
    const vRelX = this.puckVel.x - sVel.x;
    const vRelZ = this.puckVel.z - sVel.z;

    // Swept-Circle Continuous Collision Detection (CCD):
    // Check if puck will collide with striker along relative path during subDt
    let collisionOccurred = false;
    let normalX = 0;
    let normalZ = 0;

    if (distSq <= contactDistSq) {
      // Direct overlap
      collisionOccurred = true;
      const dist = Math.sqrt(distSq);
      if (dist > 1e-6) {
        normalX = dx / dist;
        normalZ = dz / dist;
      } else {
        // If exact center overlap, use striker velocity or default normal
        const sSpeed = Math.hypot(sVel.x, sVel.z);
        if (sSpeed > 1e-4) {
          normalX = sVel.x / sSpeed;
          normalZ = sVel.z / sSpeed;
        } else {
          normalX = 0;
          normalZ = strikerId === 1 ? 1 : -1;
        }
      }
    } else {
      // Check quadratic swept ray: |(p_puck - p_striker) + t * v_rel|^2 = contactDist^2
      const a = vRelX * vRelX + vRelZ * vRelZ;
      const b = 2 * (dx * vRelX + dz * vRelZ);
      const c = distSq - contactDistSq;

      // Only check if moving towards each other (b < 0)
      if (b < 0 && a > 1e-8) {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const tHit = (-b - Math.sqrt(disc)) / (2 * a);
          if (tHit >= 0 && tHit <= subDt) {
            // Collision occurs at tHit! Advance puck to impact point
            this.puckPos.x += this.puckVel.x * tHit;
            this.puckPos.z += this.puckVel.z * tHit;

            // Recalculate normal at impact time
            const sHitX = sPos.x + sVel.x * tHit;
            const sHitZ = sPos.z + sVel.z * tHit;
            dx = this.puckPos.x - sHitX;
            dz = this.puckPos.z - sHitZ;
            const dist = Math.hypot(dx, dz) || contactDist;
            normalX = dx / dist;
            normalZ = dz / dist;
            collisionOccurred = true;
          }
        }
      }
    }

    if (!collisionOccurred) return;

    // Relative normal velocity component
    const relNormalVel = (this.puckVel.x - sVel.x) * normalX + (this.puckVel.z - sVel.z) * normalZ;

    // Normal unit vector n = (normalX, normalZ)
    // Tangent unit vector t = (-normalZ, normalX)
    const tangentX = -normalZ;
    const tangentZ = normalX;

    // Apply impulse if closing in (relNormalVel < 0) or overlapping
    if (relNormalVel < 0 || distSq <= contactDistSq) {
      const strikerNormalSpeed = Math.max(0, sVel.x * normalX + sVel.z * normalZ);
      const incomingPuckNormalSpeed = Math.max(0, -(this.puckVel.x * normalX + this.puckVel.z * normalZ));
      const restitution = strikerNormalSpeed < 0.4 ? 0.35 : 0.72;
      const outgoingNormalSpeed = incomingPuckNormalSpeed * restitution + strikerNormalSpeed * 1.15;

      const puckTangentialSpeed = this.puckVel.x * tangentX + this.puckVel.z * tangentZ;
      const strikerTangentialSpeed = sVel.x * tangentX + sVel.z * tangentZ;
      const outgoingTangentialSpeed = puckTangentialSpeed * 0.90 + strikerTangentialSpeed * 0.15;

      this.puckVel.x = normalX * outgoingNormalSpeed + tangentX * outgoingTangentialSpeed;
      this.puckVel.z = normalZ * outgoingNormalSpeed + tangentZ * outgoingTangentialSpeed;

      // Surface slip velocity and spin transfer (slicing)
      const slipSpeed = (puckTangentialSpeed - strikerTangentialSpeed) - this.puckSpin * PUCK_RADIUS;
      this.puckSpin += (-slipSpeed * 0.28 * 2) / PUCK_RADIUS;
      this.puckSpin = Math.max(-120, Math.min(120, this.puckSpin));
    }

    // Positional Depenetration: push puck along normal so dist >= contactDist + epsilon
    const currentDist = Math.hypot(this.puckPos.x - sPos.x, this.puckPos.z - sPos.z);
    if (currentDist < contactDist) {
      const penetration = contactDist - currentDist + 1e-4;
      this.puckPos.x += normalX * penetration;
      this.puckPos.z += normalZ * penetration;
    }

    // Clamped speed to maxVelocity
    const currentSpeed = Math.hypot(this.puckVel.x, this.puckVel.z);
    if (currentSpeed > this.maxVelocity) {
      const factor = this.maxVelocity / currentSpeed;
      this.puckVel.x *= factor;
      this.puckVel.z *= factor;
    }

    // Trigger Callback
    const postSpeed = Math.hypot(this.puckVel.x, this.puckVel.z);
    const departureAngle = Math.atan2(normalX, normalZ); // Angle relative to Z axis
    if (this.onPuckHitStriker) {
      this.onPuckHitStriker(strikerId, postSpeed, departureAngle);
    }
  }

  /**
   * Depenetrate puck from striker if overlapping after position integration.
   * If puck is pressed against the side wall rail, executes wedge ejection to prevent trapping.
   */
  _depenetrateStriker(strikerId, sPos) {
    const contactDist = STRIKER_RADIUS + PUCK_RADIUS;
    const dx = this.puckPos.x - sPos.x;
    const dz = this.puckPos.z - sPos.z;
    const distSq = dx * dx + dz * dz;

    if (distSq < contactDist * contactDist) {
      const dist = Math.sqrt(distSq);
      const nx = dist > 1e-6 ? dx / dist : 0;
      const nz = dist > 1e-6 ? dz / dist : (strikerId === 1 ? 1 : -1);
      const overlap = contactDist - dist + 1e-4;

      const maxX = HALF_WIDTH - PUCK_RADIUS;
      const minX = -HALF_WIDTH + PUCK_RADIUS;
      const straightSideMaxZ = HALF_LENGTH - CORNER_BOUNCER_SIZE;
      const isNearSideRail =
        (this.puckPos.x >= maxX - 0.008 || this.puckPos.x <= minX + 0.008) &&
        Math.abs(this.puckPos.z) <= straightSideMaxZ;

      if (isNearSideRail) {
        // PINCH / WEDGE RESOLUTION:
        // Puck cannot move outward through the solid wall rail.
        // It pops out along the free longitudinal degree of freedom (Z) and bounces inward (-sign(x)).
        const railSign = Math.sign(this.puckPos.x) || 1;
        const wedgeSignZ = Math.abs(dz) > 0.004 ? Math.sign(dz) : (this.puckPos.z > 0 ? -1 : 1);

        this.puckPos.z += wedgeSignZ * Math.max(overlap * 1.5, 0.008);
        this.puckPos.x = railSign * (maxX - 0.003);

        this.puckVel.z = wedgeSignZ * Math.max(Math.abs(this.puckVel.z), 1.25);
        this.puckVel.x = -railSign * Math.max(Math.abs(this.puckVel.x), 0.65);
      } else {
        this.puckPos.x += nx * overlap;
        this.puckPos.z += nz * overlap;

        // Eliminate any lingering inward velocity
        const vn = this.puckVel.x * nx + this.puckVel.z * nz;
        if (vn < 0) {
          this.puckVel.x -= vn * nx;
          this.puckVel.z -= vn * nz;
        }
      }
    }
  }

  /**
   * Goal Post Deflectors:
   * 4 posts at (±0.17m, ±1.07m) with post radius r_post = 0.015m.
   * Puck radius R_p = 0.038m => contact distance = 0.053m.
   */
  _handleGoalPostCollisions() {
    const postContactDist = POST_RADIUS + PUCK_RADIUS; // 0.015 + 0.038 = 0.053m
    const postContactDistSq = postContactDist * postContactDist;

    for (const post of this.goalPosts) {
      const dx = this.puckPos.x - post.x;
      const dz = this.puckPos.z - post.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < postContactDistSq) {
        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-6 ? dx / dist : 0;
        const nz = dist > 1e-6 ? dz / dist : (post.z > 0 ? -1 : 1);

        // Depenetration
        const penetration = postContactDist - dist + 1e-4;
        this.puckPos.x += nx * penetration;
        this.puckPos.z += nz * penetration;

        // Velocity reflection
        const vn = this.puckVel.x * nx + this.puckVel.z * nz;
        if (vn < 0) {
          const vtX = this.puckVel.x - vn * nx;
          const vtZ = this.puckVel.z - vn * nz;

          // Normal reflection with restitution, tangential friction retention
          this.puckVel.x = this.wallFriction * vtX - this.wallRestitution * vn * nx;
          this.puckVel.z = this.wallFriction * vtZ - this.wallRestitution * vn * nz;

          // Post contact point
          const rPost = post.radius || POST_RADIUS;
          const contactPt = {
            x: post.x + rPost * nx,
            z: post.z + rPost * nz,
          };

          if (this.onPuckHitPost) {
            this.onPuckHitPost(contactPt);
          }
        }
      }
    }
  }

  /**
   * 45° Corner Bouncer Collisions:
   * Replaces sharp 90° corners with solid 45° deflection cushions.
   * Connecting (±0.40, ±1.07) and (±0.55, ±0.92) across all 4 corners.
   * If a puck hits the corner bouncer, it immediately reflects cleanly
   * into open table play, making corner trapping physically impossible.
   */
  _handleCornerBouncerCollisions() {
    const Dcorner = (HALF_WIDTH - CORNER_BOUNCER_SIZE) + HALF_LENGTH; // 1.47m
    const Kp = Dcorner - PUCK_RADIUS * Math.SQRT2; // ~1.41626m

    for (const b of this.cornerBouncers) {
      const s = b.qx * this.puckPos.x + b.qz * this.puckPos.z;
      if (s > Kp) {
        // Depenetrate along inward 45° normal
        const d = (s - Kp) / 2;
        this.puckPos.x -= b.qx * d;
        this.puckPos.z -= b.qz * d;

        // Normal approach velocity into bouncer (outward normal is (qx/sqrt2, qz/sqrt2))
        const vApproach = (b.qx * this.puckVel.x + b.qz * this.puckVel.z) / Math.SQRT2;
        if (vApproach > 0) {
          // Tangential velocity along (-qz/sqrt2, qx/sqrt2)
          const vt = (-b.qz * this.puckVel.x + b.qx * this.puckVel.z) / Math.SQRT2;
          const restitution = Math.max(0.90, this.wallRestitution);
          const vNormReflected = -restitution * vApproach;
          const vTanRetained = this.wallFriction * vt;

          this.puckVel.x = (b.qx * vNormReflected - b.qz * vTanRetained) / Math.SQRT2;
          this.puckVel.z = (b.qz * vNormReflected + b.qx * vTanRetained) / Math.SQRT2;

          this.puckSpin *= 0.80;

          if (this.onPuckHitWall) {
            const impactSpeed = Math.hypot(this.puckVel.x, this.puckVel.z);
            const contactPoint = {
              x: this.puckPos.x + (b.qx * PUCK_RADIUS) / Math.SQRT2,
              z: this.puckPos.z + (b.qz * PUCK_RADIUS) / Math.SQRT2,
            };
            this.onPuckHitWall(
              contactPoint,
              { x: -b.qx / Math.SQRT2, z: -b.qz / Math.SQRT2 },
              impactSpeed
            );
          }
        }
      }
    }
  }

  /**
   * Straight Wall Collisions:
   *  - Left rail: X = -0.55m => active for |Z| <= 0.92m (between 45° bouncers)
   *  - Right rail: X = +0.55m => active for |Z| <= 0.92m (between 45° bouncers)
   *  - Bottom end rail: Z = -1.07m => active for |X| in [0.17m, 0.40m]
   *  - Top end rail: Z = +1.07m => active for |X| in [0.17m, 0.40m]
   */
  _handleStraightWallCollisions() {
    const maxX = HALF_WIDTH - PUCK_RADIUS;  // 0.55 - 0.038 = 0.512m
    const minX = -HALF_WIDTH + PUCK_RADIUS; // -0.512m
    const maxZ = HALF_LENGTH - PUCK_RADIUS; // 1.07 - 0.038 = 1.032m
    const minZ = -HALF_LENGTH + PUCK_RADIUS; // -1.032m

    const straightSideMaxZ = HALF_LENGTH - CORNER_BOUNCER_SIZE; // 1.07 - 0.15 = 0.92m
    const straightEndMaxX = HALF_WIDTH - CORNER_BOUNCER_SIZE;   // 0.55 - 0.15 = 0.40m

    // 1. Right Side Wall (X = +0.55m)
    if (this.puckPos.x >= maxX && Math.abs(this.puckPos.z) <= straightSideMaxZ) {
      this.puckPos.x = maxX - 0.001;

      // Subtle curved deflection: kicks in outside center zone (|Z| > 0.20m) to deflect puck away from dead corners
      const curveZ =
        Math.abs(this.puckPos.z) > 0.20
          ? -Math.sign(this.puckPos.z) * 0.04 * ((Math.abs(this.puckPos.z) - 0.20) / (straightSideMaxZ - 0.20))
          : 0;

      if (this.puckVel.x > 0) {
        this.puckVel.x = -this.wallRestitution * this.puckVel.x;
        this.puckVel.z = this.wallFriction * this.puckVel.z + curveZ * Math.abs(this.puckVel.x);
        this.puckSpin *= 0.80;

        const impactSpeed = Math.hypot(this.puckVel.x, this.puckVel.z);
        if (this.onPuckHitWall) {
          this.onPuckHitWall({ x: HALF_WIDTH, z: this.puckPos.z }, { x: -1, z: curveZ === 0 ? 0 : curveZ }, impactSpeed);
        }
      } else if (Math.abs(this.puckVel.x) < 0.35) {
        // Anti-stick minimum cushion restitution to prevent pinning
        this.puckVel.x = -0.35;
        this.puckVel.z += curveZ * 0.35;
      }
    }

    // 2. Left Side Wall (X = -0.55m)
    if (this.puckPos.x <= minX && Math.abs(this.puckPos.z) <= straightSideMaxZ) {
      this.puckPos.x = minX + 0.001;

      // Subtle curved deflection: kicks in outside center zone (|Z| > 0.20m) to deflect puck away from dead corners
      const curveZ =
        Math.abs(this.puckPos.z) > 0.20
          ? -Math.sign(this.puckPos.z) * 0.04 * ((Math.abs(this.puckPos.z) - 0.20) / (straightSideMaxZ - 0.20))
          : 0;

      if (this.puckVel.x < 0) {
        this.puckVel.x = -this.wallRestitution * this.puckVel.x;
        this.puckVel.z = this.wallFriction * this.puckVel.z + curveZ * Math.abs(this.puckVel.x);
        this.puckSpin *= 0.80;

        const impactSpeed = Math.hypot(this.puckVel.x, this.puckVel.z);
        if (this.onPuckHitWall) {
          this.onPuckHitWall({ x: -HALF_WIDTH, z: this.puckPos.z }, { x: 1, z: curveZ === 0 ? 0 : curveZ }, impactSpeed);
        }
      } else if (Math.abs(this.puckVel.x) < 0.35) {
        // Anti-stick minimum cushion restitution to prevent pinning
        this.puckVel.x = 0.35;
        this.puckVel.z += curveZ * 0.35;
      }
    }

    // 3. Top End Wall (Z = +1.07m), outside goal mouth (|X| >= 0.17m) and inside corner bouncers (|X| <= 0.40m)
    if (this.puckPos.z > maxZ && Math.abs(this.puckPos.x) >= HALF_GOAL_WIDTH && Math.abs(this.puckPos.x) <= straightEndMaxX) {
      this.puckPos.z = maxZ;

      if (this.puckVel.z > 0) {
        this.puckVel.z = -this.wallRestitution * this.puckVel.z;
        this.puckVel.x = this.wallFriction * this.puckVel.x;
        this.puckSpin *= 0.80;

        const impactSpeed = Math.hypot(this.puckVel.x, this.puckVel.z);
        if (this.onPuckHitWall) {
          this.onPuckHitWall({ x: this.puckPos.x, z: HALF_LENGTH }, { x: 0, z: -1 }, impactSpeed);
        }
      }
    }

    // 4. Bottom End Wall (Z = -1.07m), outside goal mouth (|X| >= 0.17m) and inside corner bouncers (|X| <= 0.40m)
    if (this.puckPos.z < minZ && Math.abs(this.puckPos.x) >= HALF_GOAL_WIDTH && Math.abs(this.puckPos.x) <= straightEndMaxX) {
      this.puckPos.z = minZ;

      if (this.puckVel.z < 0) {
        this.puckVel.z = -this.wallRestitution * this.puckVel.z;
        this.puckVel.x = this.wallFriction * this.puckVel.x;
        this.puckSpin *= 0.80;

        const impactSpeed = Math.hypot(this.puckVel.x, this.puckVel.z);
        if (this.onPuckHitWall) {
          this.onPuckHitWall({ x: this.puckPos.x, z: -HALF_LENGTH }, { x: 0, z: 1 }, impactSpeed);
        }
      }
    }
  }

  /**
   * Check if puck has crossed the goal threshold:
   *  - In goal cavity: |x| < HALF_GOAL_WIDTH (0.17m) and |z| > HALF_LENGTH (1.07m).
   *  - P1 scores when puck enters P2 goal cavity (Z > +1.07m).
   *  - P2 scores when puck enters P1 goal cavity (Z < -1.07m).
   */
  _checkGoalEntry() {
    if (this.isGoalScored) return true;

    if (Math.abs(this.puckPos.x) < HALF_GOAL_WIDTH) {
      if (this.puckPos.z > HALF_LENGTH) {
        // Entered P2's goal cavity -> P1 scored!
        this.isGoalScored = true;
        this.lastScorer = 1;
        if (this.onGoalScored) {
          this.onGoalScored(1);
        }
        return true;
      } else if (this.puckPos.z < -HALF_LENGTH) {
        // Entered P1's goal cavity -> P2 scored!
        this.isGoalScored = true;
        this.lastScorer = 2;
        if (this.onGoalScored) {
          this.onGoalScored(2);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Contain puck inside goal pocket cavity until serve/reset.
   */
  _stepInGoalPocket(dt) {
    // Rapidly decelerate inside goal pocket net
    this.puckVel.x *= 0.85;
    this.puckVel.z *= 0.85;
    this.puckSpin *= 0.85;

    this.puckPos.x += this.puckVel.x * dt;
    this.puckPos.z += this.puckVel.z * dt;

    // Constrain to goal pocket cavity
    const maxPocketZ = HALF_LENGTH + GOAL_POCKET_DEPTH;
    const minPocketZ = -(HALF_LENGTH + GOAL_POCKET_DEPTH);
    const maxPocketX = HALF_GOAL_WIDTH - PUCK_RADIUS;

    this.puckPos.x = Math.max(-maxPocketX, Math.min(maxPocketX, this.puckPos.x));
    if (this.puckPos.z > 0) {
      this.puckPos.z = Math.min(maxPocketZ, Math.max(HALF_LENGTH, this.puckPos.z));
    } else {
      this.puckPos.z = Math.max(minPocketZ, Math.min(-HALF_LENGTH, this.puckPos.z));
    }
  }

  /**
   * Parse input vector from object {x, z}, Three.js Vector3 {x, y, z}, or array [x, z].
   */
  _parseVec2(vec, fallback = { x: 0, z: 0 }) {
    if (!vec) return { x: fallback.x, z: fallback.z };
    if (Array.isArray(vec)) {
      return { x: Number(vec[0]) || 0, z: Number(vec[1]) || 0 };
    }
    return {
      x: Number(vec.x !== undefined ? vec.x : fallback.x) || 0,
      z: Number(vec.z !== undefined ? vec.z : (vec.y !== undefined ? vec.y : fallback.z)) || 0,
    };
  }

  /**
   * Zero-NaN safeguard to guarantee numerical stability under all conditions.
   */
  _sanitizeState() {
    if (isNaN(this.puckPos.x) || !isFinite(this.puckPos.x)) this.puckPos.x = 0;
    if (isNaN(this.puckPos.z) || !isFinite(this.puckPos.z)) this.puckPos.z = 0;
    if (isNaN(this.puckVel.x) || !isFinite(this.puckVel.x)) this.puckVel.x = 0;
    if (isNaN(this.puckVel.z) || !isFinite(this.puckVel.z)) this.puckVel.z = 0;
    if (isNaN(this.puckSpin) || !isFinite(this.puckSpin)) this.puckSpin = 0;
  }
}
