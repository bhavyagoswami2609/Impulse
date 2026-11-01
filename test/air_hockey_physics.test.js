import assert from 'node:assert';
import {
  AirHockeyPhysics,
  TABLE_LENGTH,
  TABLE_WIDTH,
  HALF_LENGTH,
  HALF_WIDTH,
  GOAL_WIDTH,
  HALF_GOAL_WIDTH,
  POST_RADIUS,
  CORNER_RADIUS,
  STRIKER_RADIUS,
  PUCK_RADIUS,
  PUCK_MASS,
  WALL_RESTITUTION,
  WALL_FRICTION_RETENTION,
  STRIKER_RESTITUTION,
  DEFAULT_DRAG,
  MAX_VELOCITY,
  MIN_VELOCITY_CUTOFF,
} from '../src/physics/air_hockey_physics.js';

console.log('--- STARTING AIR HOCKEY PHYSICS TEST SUITE ---');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    console.error(err.stack);
    testsFailed++;
  }
}

// ----------------------------------------------------------------------------
// 1. Geometry & Constants Verification
// ----------------------------------------------------------------------------
runTest('Geometry: Table & object dimensions match specification', () => {
  const engine = new AirHockeyPhysics();
  const dims = engine.getTableDimensions();

  assert.strictEqual(dims.length, 2.14, 'Table length must be 2.14m');
  assert.strictEqual(dims.width, 1.10, 'Table width must be 1.10m');
  assert.strictEqual(dims.halfLength, 1.07, 'Half length must be 1.07m');
  assert.strictEqual(dims.halfWidth, 0.55, 'Half width must be 0.55m');
  assert.strictEqual(dims.goalWidth, 0.34, 'Goal width must be 0.34m');
  assert.strictEqual(dims.halfGoalWidth, 0.17, 'Half goal width must be 0.17m');
  assert.strictEqual(dims.postRadius, 0.015, 'Goal post radius must be 0.015m');
  assert.strictEqual(dims.cornerRadius, 0.06, 'Corner fillet radius must be 0.06m');
  assert.strictEqual(dims.strikerRadius, 0.050, 'Striker radius must be 0.050m (100mm diameter)');
  assert.strictEqual(dims.puckRadius, 0.038, 'Puck radius must be 0.038m (76mm diameter)');
  assert.strictEqual(dims.puckMass, 0.035, 'Puck mass must be 0.035kg');

  const posts = engine.getGoalPosts();
  assert.strictEqual(posts.length, 4, 'Must have 4 goal posts');
  const postCoords = posts.map(p => ({ x: p.x, z: p.z }));
  assert.deepStrictEqual(
    postCoords,
    [
      { x: -0.17, z: -1.07 },
      { x: 0.17, z: -1.07 },
      { x: -0.17, z: 1.07 },
      { x: 0.17, z: 1.07 },
    ],
    'Post positions must be (±0.17, ±1.07)'
  );
});

// ----------------------------------------------------------------------------
// 2. Cushion Wall Collisions: Normal & Tangential Physics
// ----------------------------------------------------------------------------
runTest('Cushion Wall: Perpendicular hit reflection (angle = 0°)', () => {
  let wallHitFired = false;
  let hitNormal = null;

  const engine = new AirHockeyPhysics({
    drag: 0, // Disable drag to isolate bounce restitution
    onPuckHitWall: (point, normal, speed) => {
      wallHitFired = true;
      hitNormal = normal;
    },
  });

  // Puck placed near right rail (X = 0.55, puck limit is 0.512)
  engine.setPuckPosition(0.50, 0);
  engine.setPuckVelocity(4.0, 0); // Moving purely in +X into right rail

  // Single step dt = 0.01
  engine.step(0.01, { x: 0, z: -0.5 }, { x: 0, z: 0 }, { x: 0, z: 0.5 }, { x: 0, z: 0 });

  const state = engine.getPuckState();
  assert.strictEqual(wallHitFired, true, 'onPuckHitWall callback should fire');
  assert.strictEqual(hitNormal.x, -1, 'Normal must point inward (-1, 0)');
  assert.strictEqual(hitNormal.z, 0);

  // Velocity should reverse with e_wall = 0.88: vx' = -4.0 * 0.88 = -3.52
  assert(Math.abs(state.velocity.x - (-4.0 * WALL_RESTITUTION)) < 1e-3, `Expected -3.52, got ${state.velocity.x}`);
  assert(Math.abs(state.velocity.z) < 1e-4, 'vz should remain 0 on perpendicular bounce');
  assert(state.position.x <= 0.512 + 1e-4, 'Puck must not penetrate right rail');
});

runTest('Cushion Wall: Acute angle bank shot reflection with tangential friction', () => {
  const engine = new AirHockeyPhysics({
    drag: 0,
  });

  // Puck moving diagonally at 45 degrees into right rail: vx = 3.0, vz = 3.0
  engine.setPuckPosition(0.50, 0);
  engine.setPuckVelocity(3.0, 3.0);

  engine.step(0.01, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  const state = engine.getPuckState();
  // Normal velocity vx' = -3.0 * e_wall = -3.0 * 0.88 = -2.64
  // Tangential velocity vz' = 3.0 * k_t = 3.0 * 0.98 = 2.94
  assert(Math.abs(state.velocity.x - (-3.0 * WALL_RESTITUTION)) < 1e-3, `Expected vx=-2.64, got ${state.velocity.x}`);
  assert(Math.abs(state.velocity.z - (3.0 * WALL_FRICTION_RETENTION)) < 1e-3, `Expected vz=2.94, got ${state.velocity.z}`);

  // Bank angle calculation: tan(theta_out) = vz' / |vx'| = 2.94 / 2.64 = 1.1136 => theta_out > theta_in (45 deg)
  const angleIn = Math.atan2(3.0, 3.0);
  const angleOut = Math.atan2(Math.abs(state.velocity.z), Math.abs(state.velocity.x));
  assert(angleOut > angleIn, 'Tangential retention & restitution correctly model bank angle deflection');
});

runTest('Cushion Wall: Corner fillet rounded bounce', () => {
  let filletHit = false;
  let contactNormal = null;

  const engine = new AirHockeyPhysics({
    drag: 0,
    onPuckHitWall: (pt, normal, spd) => {
      filletHit = true;
      contactNormal = normal;
    },
  });

  // Corner center at (0.49, 1.01). Shoot puck directly into corner at 45°
  engine.setPuckPosition(0.48, 1.00);
  engine.setPuckVelocity(2.0, 2.0); // Moving towards corner (0.55, 1.07)

  engine.step(0.02, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  const state = engine.getPuckState();
  assert.strictEqual(filletHit, true, 'Corner fillet hit callback must fire');
  // Both normal components must be negative (pointing towards center of table)
  assert(contactNormal.x < 0, 'Normal X must point inward');
  assert(contactNormal.z < 0, 'Normal Z must point inward');

  // Both velocity components should reverse
  assert(state.velocity.x < 0, 'vx should reflect inwards');
  assert(state.velocity.z < 0, 'vz should reflect inwards');

  // For 45° corner bouncers: puck position must satisfy x + z <= Kp (~1.41626m)
  const dims = engine.getTableDimensions();
  const Kp = (dims.halfWidth - dims.cornerBouncerSize) + dims.halfLength - dims.puckRadius * Math.SQRT2;
  assert(state.position.x + state.position.z <= Kp + 1e-4, `Puck depenetrated from 45° corner bouncer: sum=${state.position.x + state.position.z} <= ${Kp}`);
});

runTest('Cushion Wall: Goal post circle-circle bounce (ricochet & carom)', () => {
  let postHitCount = 0;
  const engine = new AirHockeyPhysics({
    drag: 0,
    onPuckHitPost: (pt) => {
      postHitCount++;
    },
  });

  // Test 1: Puck hitting top-right post at (0.17, 1.07) from inside goal mouth
  // Puck at (0.15, 1.03) shooting towards post (0.17, 1.07)
  engine.setPuckPosition(0.15, 1.03);
  engine.setPuckVelocity(1.0, 3.0);

  engine.step(0.02, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  assert(postHitCount > 0, 'onPuckHitPost callback must fire when colliding with post');
  const state = engine.getPuckState();
  const postDist = Math.hypot(state.position.x - 0.17, state.position.z - 1.07);
  assert(postDist >= 0.053 - 1e-4, `Puck must be pushed outside post radius + puck radius (0.053m), got ${postDist}`);
});

// ----------------------------------------------------------------------------
// 3. Striker-to-Puck Dynamic Impulse: Angle, Swing Momentum & Spin
// ----------------------------------------------------------------------------
runTest('Striker Impulse: Head-on hit shoots straight forward (angle = 0°)', () => {
  let hitSpeed = 0;
  let hitAngle = 0;

  const engine = new AirHockeyPhysics({
    drag: 0,
    onPuckHitStriker: (id, spd, ang) => {
      hitSpeed = spd;
      hitAngle = ang;
    },
  });

  // P1 striker at (0, -0.5), moving forward in +Z at 4.0 m/s
  // Puck at (0, -0.42), stationary (contact distance Rs + Rp = 0.088m, dist = 0.080m)
  const s1Pos = { x: 0, z: -0.5 };
  const s1Vel = { x: 0, z: 4.0 };
  engine.setPuckPosition(0, -0.42);
  engine.setPuckVelocity(0, 0);

  engine.step(0.01, s1Pos, s1Vel, { x: 0, z: 0.5 }, { x: 0, z: 0 });

  const state = engine.getPuckState();
  assert(state.velocity.z > 0, 'Puck must shoot forward along +Z');
  assert(Math.abs(state.velocity.x) < 1e-4, 'vx must remain 0 on head-on hit');
  assert(Math.abs(hitAngle) < 1e-4, 'Departure angle must be straight forward (0 rad)');
  // Velocity transfer should boost puck to high speed: v' ~ v_s * 1.15
  assert(state.velocity.z > 4.0, `Puck speed (${state.velocity.z}) must exceed striker swing speed transfer`);
});

runTest('Striker Impulse: Off-center hit deflects diagonally (cross-table bank angle)', () => {
  let hitAngle = 0;
  const engine = new AirHockeyPhysics({
    drag: 0,
    onPuckHitStriker: (id, spd, ang) => {
      hitAngle = ang;
    },
  });

  // Striker at (0, -0.5) moving forward at 3.0 m/s
  // Puck at (0.06, -0.44): offset in +X!
  const s1Pos = { x: 0, z: -0.5 };
  const s1Vel = { x: 0, z: 3.0 };
  engine.setPuckPosition(0.06, -0.44);
  engine.setPuckVelocity(0, 0);

  engine.step(0.01, s1Pos, s1Vel, { x: 0, z: 0.5 }, { x: 0, z: 0 });

  const state = engine.getPuckState();
  assert(state.velocity.x > 1.0, 'Puck must acquire significant lateral (+X) velocity from off-center hit');
  assert(state.velocity.z > 1.0, 'Puck must also travel forward (+Z)');
  assert(hitAngle > 0.2, `Departure angle (${hitAngle} rad) must be diagonal`);
});

runTest('Striker Impulse: Lateral slice transfers tangential spin and curves puck in flight', () => {
  const engine = new AirHockeyPhysics({
    drag: 0,
    spinCurveFactor: 0.10,
  });

  // Striker slicing to the right: vx = 5.0, vz = 1.0
  const s1Pos = { x: 0, z: -0.5 };
  const s1Vel = { x: 5.0, z: 1.0 };
  engine.setPuckPosition(0, -0.42);
  engine.setPuckVelocity(0, 0);

  engine.step(0.005, s1Pos, s1Vel, { x: 0, z: 0.5 }, { x: 0, z: 0 });

  const state = engine.getPuckState();
  assert(Math.abs(state.spin) > 5.0, `Puck should acquire significant spin from slice hit, got ${state.spin} rad/s`);

  // Step further with puck in free flight to observe curve trajectory
  const startVx = state.velocity.x;
  for (let i = 0; i < 20; i++) {
    engine.step(0.01, { x: 0, z: -0.8 }, { x: 0, z: 0 }, { x: 0, z: 0.8 }, { x: 0, z: 0 });
  }
  const endState = engine.getPuckState();
  assert(endState.velocity.x !== startVx, 'Spin must curve the puck trajectory over time');
});

// ----------------------------------------------------------------------------
// 4. Anti-Tunneling / Swept CCD at 15 m/s
// ----------------------------------------------------------------------------
runTest('Anti-Tunneling: High-speed puck (15 m/s) does NOT tunnel through side wall', () => {
  const engine = new AirHockeyPhysics({ maxVelocity: 20.0 });

  // Puck placed at x = 0.35, flying at 15.0 m/s towards right wall (x = 0.55, limit 0.512)
  // At dt = 0.02s, unconstrained displacement would be 15 * 0.02 = 0.30m => x would be 0.65m (outside table!)
  engine.setPuckPosition(0.35, 0);
  engine.setPuckVelocity(15.0, 0);

  engine.step(0.02, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  const state = engine.getPuckState();
  assert(state.position.x <= 0.512 + 1e-4, `Puck must NOT clip through wall! Got x = ${state.position.x}`);
  assert(state.velocity.x < 0, 'Puck must bounce back with reversed velocity');
});

runTest('Anti-Tunneling: High-speed puck (15 m/s) does NOT tunnel through striker', () => {
  const engine = new AirHockeyPhysics({ maxVelocity: 20.0 });

  // P1 Striker stationary at (0, 0)
  // Puck at (0, -0.20), flying directly at striker at 15 m/s in +Z
  // In dt = 0.02s, displacement is 0.30m => would fly completely past (0, 0) to z = +0.10m!
  engine.setPuckPosition(0, -0.20);
  engine.setPuckVelocity(0, 15.0);

  engine.step(0.02, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0.8 }, { x: 0, z: 0 });

  const state = engine.getPuckState();
  const dist = Math.hypot(state.position.x, state.position.z);
  assert(dist >= (STRIKER_RADIUS + PUCK_RADIUS) - 1e-4, `Puck must not penetrate striker! dist=${dist} >= 0.088`);
  assert(state.velocity.z < 0, 'Puck must reflect backwards');
});

runTest('Anti-Tunneling: Fast-moving striker (10 m/s) smashing into stationary puck', () => {
  const engine = new AirHockeyPhysics({ maxVelocity: 20.0 });

  engine.setPuckPosition(0, -0.30);
  engine.setPuckVelocity(0, 0);

  // Striker swings from z = -0.45 to z = -0.35 at 10 m/s in single step dt = 0.01
  const sPos = { x: 0, z: -0.35 };
  const sVel = { x: 0, z: 10.0 };

  engine.step(0.01, sPos, sVel, { x: 0, z: 0.8 }, { x: 0, z: 0 });

  const state = engine.getPuckState();
  const dist = Math.hypot(state.position.x - sPos.x, state.position.z - sPos.z);
  assert(dist >= (STRIKER_RADIUS + PUCK_RADIUS) - 1e-4, `Puck must depenetrate from fast striker! dist=${dist}`);
  assert(state.velocity.z > 10.0, 'Puck must shoot ahead of fast striker');
});

// ----------------------------------------------------------------------------
// 5. Air Table Float, Drag Damping, & Sleep Cutoff
// ----------------------------------------------------------------------------
runTest('Air Table Float: Drag damping attenuates speed exponentially', () => {
  const dragCoeff = 0.04;
  const engine = new AirHockeyPhysics({ drag: dragCoeff });

  // Place puck at z = -0.4, velocity vz = 0.6 m/s (travels 0.6m in 1s, staying within table [-1.07, +1.07] without hitting walls)
  engine.setPuckPosition(0, -0.4);
  engine.setPuckVelocity(0, 0.6);

  // Simulate 1.0 second as 50 frames of 0.02s
  const frameDt = 0.02;
  const totalFrames = 50;
  for (let i = 0; i < totalFrames; i++) {
    engine.step(frameDt, { x: 0, z: -0.8 }, null, { x: 0, z: 0.8 }, null);
  }

  const state = engine.getPuckState();
  const expectedSpeed = 0.6 * Math.exp(-dragCoeff * 1.0);
  assert(Math.abs(state.speed - expectedSpeed) < 1e-3, `Expected speed ~ ${expectedSpeed}, got ${state.speed}`);
});

runTest('Air Table Float: Max velocity clamping at 5.2 m/s', () => {
  const engine = new AirHockeyPhysics({ maxVelocity: 5.2 });

  engine.setPuckPosition(0, 0);
  engine.setPuckVelocity(25.0, 0); // Exceeds max velocity

  engine.step(0.005, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  const state = engine.getPuckState();
  assert(state.speed <= 5.2 + 1e-4, `Speed must be clamped to 5.2 m/s, got ${state.speed}`);
});

runTest('Air Table Float: Min velocity cutoff puts puck to sleep (< 0.02 m/s)', () => {
  const engine = new AirHockeyPhysics({ minVelocityCutoff: 0.02 });

  engine.setPuckPosition(0, 0);
  engine.setPuckVelocity(0.015, 0); // Below 0.02 m/s

  engine.step(0.01, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  const state = engine.getPuckState();
  assert.strictEqual(state.speed, 0, 'Velocity must clamp to 0 below cutoff');
  assert.strictEqual(state.isSleeping, true, 'isSleeping flag must be true');
});

// ----------------------------------------------------------------------------
// 6. Goal Pocket Sensor & Goal Scored Handling
// ----------------------------------------------------------------------------
runTest('Goal Sensor: P1 scores when puck enters P2 goal cavity (Z > +1.07m, |X| < 0.17m)', () => {
  let scoredPlayer = null;
  const engine = new AirHockeyPhysics({
    onGoalScored: (playerId) => {
      scoredPlayer = playerId;
    },
  });

  // Puck shot through goal mouth towards Z = 1.07
  engine.setPuckPosition(0.05, 1.05);
  engine.setPuckVelocity(0, 4.0);

  engine.step(0.01, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  const state = engine.getPuckState();
  assert.strictEqual(scoredPlayer, 1, 'P1 must be awarded goal when puck enters P2 goal cavity (+Z)');
  assert.strictEqual(state.isGoalScored, true, 'isGoalScored must be true');
  assert.strictEqual(state.lastScorer, 1, 'lastScorer must be 1');
});

runTest('Goal Sensor: P2 scores when puck enters P1 goal cavity (Z < -1.07m, |X| < 0.17m)', () => {
  let scoredPlayer = null;
  const engine = new AirHockeyPhysics({
    onGoalScored: (playerId) => {
      scoredPlayer = playerId;
    },
  });

  // Puck shot through P1 goal mouth towards Z = -1.07
  engine.setPuckPosition(-0.08, -1.05);
  engine.setPuckVelocity(0, -4.0);

  engine.step(0.01, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  const state = engine.getPuckState();
  assert.strictEqual(scoredPlayer, 2, 'P2 must be awarded goal when puck enters P1 goal cavity (-Z)');
  assert.strictEqual(state.isGoalScored, true, 'isGoalScored must be true');
  assert.strictEqual(state.lastScorer, 2, 'lastScorer must be 2');
});

runTest('Goal Sensor: Puck hitting end rail outside goal mouth (|X| >= 0.17m) does NOT score', () => {
  let goalCalled = false;
  let wallHitCalled = false;
  const engine = new AirHockeyPhysics({
    onGoalScored: () => {
      goalCalled = true;
    },
    onPuckHitWall: () => {
      wallHitCalled = true;
    },
  });

  // Puck at X = 0.30 (outside goal mouth |x| < 0.17) shooting at end rail Z = 1.07
  engine.setPuckPosition(0.30, 1.02);
  engine.setPuckVelocity(0, 3.0);

  engine.step(0.01, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);

  assert.strictEqual(goalCalled, false, 'Goal must NOT be scored when hitting end rail outside opening');
  assert.strictEqual(wallHitCalled, true, 'onPuckHitWall must fire');
});

// ----------------------------------------------------------------------------
// 7. Methods: resetPuck & servePuck
// ----------------------------------------------------------------------------
runTest('Methods: resetPuck and servePuck work as specified', () => {
  const engine = new AirHockeyPhysics();

  // Reset for P1
  engine.resetPuck(1);
  let state = engine.getPuckState();
  assert.strictEqual(state.velocity.x, 0);
  assert.strictEqual(state.velocity.z, 0);
  assert(state.position.z < 0, 'P1 reset places puck on -Z side');

  // Reset for P2
  engine.resetPuck(2);
  state = engine.getPuckState();
  assert(state.position.z > 0, 'P2 reset places puck on +Z side');

  // Serve puck with options
  engine.servePuck(1, { speed: 4.5, angle: 0.2, spin: 10 });
  state = engine.getPuckState();
  assert(Math.abs(state.speed - 4.5) < 1e-3, 'Serve speed matches option');
  assert.strictEqual(state.spin, 10, 'Serve spin matches option');
  assert.strictEqual(state.isGoalScored, false, 'Goal flag reset on serve');
});

// ----------------------------------------------------------------------------
// 8. Numerical Stability: 10,000 steps with random inputs, 0 NaNs guaranteed
// ----------------------------------------------------------------------------
runTest('Stability: 10,000 continuous simulation steps with zero NaNs or Infs', () => {
  const engine = new AirHockeyPhysics();
  engine.servePuck(1, { speed: 8.0, angle: 0.35 });

  for (let i = 0; i < 10000; i++) {
    // Random oscillating striker movements
    const t = i * 0.016;
    const s1Pos = { x: 0.3 * Math.sin(t * 3), z: -0.6 + 0.2 * Math.cos(t * 4) };
    const s2Pos = { x: 0.3 * Math.cos(t * 2.5), z: 0.6 + 0.2 * Math.sin(t * 3.5) };

    engine.step(0.016, s1Pos, null, s2Pos, null);

    const s = engine.getPuckState();
    assert(!isNaN(s.position.x), `Step ${i}: pos.x is NaN`);
    assert(!isNaN(s.position.z), `Step ${i}: pos.z is NaN`);
    assert(!isNaN(s.velocity.x), `Step ${i}: vel.x is NaN`);
    assert(!isNaN(s.velocity.z), `Step ${i}: vel.z is NaN`);
    assert(!isNaN(s.spin), `Step ${i}: spin is NaN`);

    assert(isFinite(s.position.x), `Step ${i}: pos.x not finite`);
    assert(isFinite(s.position.z), `Step ${i}: pos.z not finite`);
    assert(isFinite(s.velocity.x), `Step ${i}: vel.x not finite`);
    assert(isFinite(s.velocity.z), `Step ${i}: vel.z not finite`);

    // If goal scored, serve puck back into play
    if (s.isGoalScored) {
      engine.servePuck(s.lastScorer === 1 ? 2 : 1, { speed: 6.0 + Math.random() * 4.0 });
    }
  }
});

// ----------------------------------------------------------------------------
// 9. Goal Post Carom In vs Ricochet Out
// ----------------------------------------------------------------------------
runTest('Goal Post: Inside edge caroms puck into the goal cavity (goal scored)', () => {
  let postHit = false;
  let goalScored = false;
  let contactPt = null;

  const engine = new AirHockeyPhysics({
    drag: 0,
    onPuckHitPost: (pt) => {
      postHit = true;
      contactPt = pt;
    },
    onGoalScored: (id) => {
      if (id === 1) goalScored = true;
    },
  });

  // Puck shot at inside edge of top-right post (0.17, 1.07)
  // Hits post glancingly at x = 0.12, z = 1.06 with high forward velocity vz = 6.0 m/s
  engine.setPuckPosition(0.12, 1.055);
  engine.setPuckVelocity(0.5, 6.0);

  for (let i = 0; i < 5; i++) {
    engine.step(0.005, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);
  }

  assert.strictEqual(postHit, true, 'Must hit goal post');
  assert(!isNaN(contactPt.x) && !isNaN(contactPt.z), 'Contact point must have valid numbers');
  assert.strictEqual(goalScored, true, 'Glancing carom off inside post must deflect into net and score goal');
});

runTest('Goal Post: Outside edge ricochets puck away from goal mouth', () => {
  let postHit = false;
  let goalScored = false;

  const engine = new AirHockeyPhysics({
    drag: 0,
    onPuckHitPost: () => {
      postHit = true;
    },
    onGoalScored: () => {
      goalScored = true;
    },
  });

  // Puck shot at outer face of top-right post (0.17, 1.07)
  // Starts at x = 0.185, z = 1.035, heading towards post with vx = -0.3, vz = 3.0
  engine.setPuckPosition(0.185, 1.035);
  engine.setPuckVelocity(-0.3, 3.0);

  for (let i = 0; i < 5; i++) {
    engine.step(0.01, { x: 0, z: -0.5 }, null, { x: 0, z: 0.5 }, null);
  }

  assert.strictEqual(postHit, true, 'Must hit goal post');
  assert.strictEqual(goalScored, false, 'Ricochet off outside post must NOT score goal');
  const state = engine.getPuckState();
  assert(state.position.z < 1.07, 'Puck must ricochet back into table play');
});

// ----------------------------------------------------------------------------
// 10. Striker Bounds Clamping & Three.js Vector3 Compatibility
// ----------------------------------------------------------------------------
runTest('Striker Clamping: Striker position clamped to legal half of table', () => {
  const engine = new AirHockeyPhysics();

  // P1 attempts to cross center line (z = 0.2) and side rail (x = 0.9)
  const clampedP1 = engine.clampStrikerPosition(1, { x: 0.9, z: 0.2 });
  assert(clampedP1.x <= HALF_WIDTH - STRIKER_RADIUS, 'P1 clamped to right rail');
  assert(clampedP1.z <= 0, 'P1 clamped to P1 half (z <= 0)');

  // P2 attempts to cross center line (z = -0.5) and side rail (x = -0.9)
  const clampedP2 = engine.clampStrikerPosition(2, { x: -0.9, z: -0.5 });
  assert(clampedP2.x >= -HALF_WIDTH + STRIKER_RADIUS, 'P2 clamped to left rail');
  assert(clampedP2.z >= 0, 'P2 clamped to P2 half (z >= 0)');
});

runTest('Three.js Interoperability: step() accepts Three.js Vector3-like objects and arrays', () => {
  const engine = new AirHockeyPhysics();

  // Test Three.js Vector3 {x, y, z} where y is vertical and z is longitudinal
  const p1V3 = { x: 0.1, y: 0.05, z: -0.6 };
  const p1VelV3 = { x: 0.0, y: 0.0, z: 1.0 };
  const p2Array = [0.2, 0.7];
  const p2VelArray = [0.0, -1.0];

  assert.doesNotThrow(() => {
    engine.step(0.016, p1V3, p1VelV3, p2Array, p2VelArray);
  }, 'Should handle {x, y, z} and [x, z] seamlessly');

  const state = engine.getPuckState();
  assert(!isNaN(state.position.x));
  assert(!isNaN(state.position.z));
});

console.log('----------------------------------------------------');
console.log(`TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed.`);

if (testsFailed > 0) {
  process.exit(1);
}
