import * as THREE from 'three';
import {
  AIR_HOCKEY_TABLE_WIDTH,
  AIR_HOCKEY_TABLE_LENGTH,
  AIR_HOCKEY_TABLE_HEIGHT,
  AIR_HOCKEY_STRIKER_RADIUS,
  AIR_HOCKEY_PUCK_RADIUS,
} from '../graphics/air_hockey_models.js';
import { sound } from '../audio/sound_effects.js';

export const AIR_HOCKEY_STATES = {
  READY: 'READY',
  SERVE_WAIT: 'SERVE_WAIT',
  ACTIVE_PLAY: 'ACTIVE_PLAY',
  GOAL_SCORED: 'GOAL_SCORED',
  MATCH_OVER: 'MATCH_OVER',
};

export class AirHockeyGame {
  constructor(options = {}) {
    this.scene = options.scene;
    this.physics = options.physics;
    this.multiplayer = options.multiplayer;
    this.onStateChange = options.onStateChange || (() => {});
    this.onScoreUpdate = options.onScoreUpdate || (() => {});
    this.onActionToast = options.onActionToast || (() => {});
    this.onMatchOver = options.onMatchOver || (() => {});

    // Match Rules
    this.winningScore = 7; // Official standard first to 7
    this.scores = [0, 0];   // [P1, P2/CPU]
    this.server = 1;        // 1 = P1, 2 = P2/CPU
    this.state = AIR_HOCKEY_STATES.SERVE_WAIT;

    // Striker Limits
    this.strikerRadius = AIR_HOCKEY_STRIKER_RADIUS; // 0.050m
    this.tableHalfW = AIR_HOCKEY_TABLE_WIDTH / 2;   // 0.55m
    this.tableHalfL = AIR_HOCKEY_TABLE_LENGTH / 2;  // 1.07m

    this.p1Bounds = {
      minX: -this.tableHalfW + this.strikerRadius + 0.01,
      maxX: this.tableHalfW - this.strikerRadius - 0.01,
      minZ: -this.tableHalfL + this.strikerRadius + 0.01,
      maxZ: -0.005, // Striker can advance up to the midline (Z=0) without crossing into P2 half
    };

    this.p2Bounds = {
      minX: -this.tableHalfW + this.strikerRadius + 0.01,
      maxX: this.tableHalfW - this.strikerRadius - 0.01,
      minZ: 0.005,  // Striker can advance up to the midline (Z=0) without crossing into P1 half
      maxZ: this.tableHalfL - this.strikerRadius - 0.01,
    };

    // Strikers State (XZ plane at table elevation)
    this.p1Pos = new THREE.Vector3(0, AIR_HOCKEY_TABLE_HEIGHT, -0.65);
    this.p1PrevPos = this.p1Pos.clone();
    this.p1Vel = new THREE.Vector3();

    this.p2Pos = new THREE.Vector3(0, AIR_HOCKEY_TABLE_HEIGHT, 0.65);
    this.p2PrevPos = this.p2Pos.clone();
    this.p2Vel = new THREE.Vector3();

    // Smart CPU AI Opponent
    this.aiEnabled = true;
    this.aiTargetPos = new THREE.Vector3(0, AIR_HOCKEY_TABLE_HEIGHT, 0.75);
    this.aiServeTimer = 0.8;
    this.aiReactionDelay = 0;
    this.aiShotTimer = 0;
    this.aiSwingTimer = 0;
    this.difficulty = 'medium';
    this.difficultyConfigs = {
      easy: { aiSpeed: 4.5, errorMargin: 0.08, maxReachZ: 0.45, strikePower: 0.8 },
      medium: { aiSpeed: 7.5, errorMargin: 0.03, maxReachZ: 0.20, strikePower: 1.0 },
      hard: { aiSpeed: 12.0, errorMargin: 0.0, maxReachZ: 0.04, strikePower: 1.3 },
    };

    // Shot Clock (7 seconds rule)
    this.shotClock = 7.0;

    // Multi-puck / Network synchronization
    this.clientP2Input = null;

    // Pre-allocated Float32Array network buffers (zero GC allocations during 60 FPS gameplay)
    this.syncBuffer = new Float32Array(15);
    this.clientInputBuffer = new Float32Array(6);

    // Remote opponent interpolation targets
    this.remoteTargetPos = new THREE.Vector3(0, AIR_HOCKEY_TABLE_HEIGHT, 0.65);
    this.remoteTargetVel = new THREE.Vector3();
    this.hasRemoteInput = false;

    // Client-side prediction for puck & local striker collisions
    this.predictedPuckPos = new THREE.Vector3(0, AIR_HOCKEY_TABLE_HEIGHT + 0.0038, 0);
    this.predictedPuckVel = new THREE.Vector3();
    this.clientPuckTarget = new THREE.Vector3(0, AIR_HOCKEY_TABLE_HEIGHT + 0.0038, 0);
    this.isPredictingHit = false;
    this.predictedHitTimer = 0;

    this.setupPhysicsCallbacks();
    this.resetPuckForServe(1);
  }

  setupPhysicsCallbacks() {
    this.physics.onPuckHitWall = (point, normal, speed) => {
      sound.playWallBounce(Math.max(1.0, speed * 0.4));
      if (this.scene && this.scene.triggerImpact) {
        this.scene.triggerImpact(new THREE.Vector3(point.x, AIR_HOCKEY_TABLE_HEIGHT + 0.005, point.z), 0x00ffcc);
      }
    };

    this.physics.onPuckHitStriker = (strikerId, speed, angle) => {
      sound.playStrikerHit(Math.max(1.0, speed * 0.5));
      const strikerMesh = strikerId === 1 ? this.scene.striker1 : this.scene.striker2;
      if (strikerMesh && this.scene && this.scene.triggerImpact) {
        this.scene.triggerImpact(strikerMesh.position, strikerId === 1 ? 0x00ffff : 0xffaa00);
      }

      // Striker strike transitions SERVE_WAIT to ACTIVE_PLAY
      if (this.state === AIR_HOCKEY_STATES.SERVE_WAIT) {
        this.state = AIR_HOCKEY_STATES.ACTIVE_PLAY;
        this.onStateChange(this.state);
        this.onActionToast(strikerId === 1 ? 'P1 STRIKE SERVE!' : 'CPU STRIKE SERVE!');
      }
    };

    this.physics.onPuckHitPost = (point) => {
      sound.playWallBounce(1.5);
      if (this.scene && this.scene.triggerImpact) {
        this.scene.triggerImpact(new THREE.Vector3(point.x, AIR_HOCKEY_TABLE_HEIGHT + 0.005, point.z), 0xffffff);
      }
    };

    this.physics.onGoalScored = (scorerId) => {
      this.handleGoal(scorerId);
    };
  }

  handleGoal(scorerId) {
    if (this.state === AIR_HOCKEY_STATES.MATCH_OVER) return;

    // Safety rule: during SERVE_WAIT, entering own goal is a foul / dead serve, NOT an opponent goal!
    if (this.state === AIR_HOCKEY_STATES.SERVE_WAIT) {
      this.resetPuckForServe(this.server);
      this.onActionToast('INVALID SERVE - RE-SERVE');
      return;
    }

    this.state = AIR_HOCKEY_STATES.GOAL_SCORED;
    this.scores[scorerId - 1]++;

    // Rule: The player who was scored upon receives puck possession to serve next
    this.server = scorerId === 1 ? 2 : 1;

    sound.playGoalScored(scorerId === 1);

    const scorerName = scorerId === 1 ? 'PLAYER 1' : 'CPU';
    this.onActionToast(`GOAL! ${scorerName} SCORES!`);
    this.onScoreUpdate(this.scores);
    this.onStateChange(this.state);

    // Check Match Win Condition
    const p1 = this.scores[0];
    const p2 = this.scores[1];

    if (p1 >= this.winningScore || p2 >= this.winningScore) {
      this.state = AIR_HOCKEY_STATES.MATCH_OVER;
      const champion = p1 > p2 ? 'PLAYER 1' : 'CPU';
      this.onActionToast(`MATCH OVER: ${champion} WINS!`);
      this.onMatchOver({ winner: champion, scores: this.scores });
      this.onStateChange(this.state);
      return;
    }

    // Brief goal pause then reset for next serve
    setTimeout(() => {
      if (this.state === AIR_HOCKEY_STATES.GOAL_SCORED) {
        this.resetPuckForServe(this.server);
      }
    }, 1400);
  }

  resetPuckForServe(server = 1) {
    this.server = server;
    this.state = AIR_HOCKEY_STATES.SERVE_WAIT;
    this.shotClock = 7.0;
    this.aiServeTimer = 0.85;
    this.aiSwingTimer = 0;

    // Reset puck inside the serving player's half stationary in front of the striking player's striker
    this.physics.resetPuck(server);

    const gap = 0.20; // 20cm center-to-center (~11.2cm clearance between striker and puck edges)
    let puckX = 0;
    let puckZ = 0;

    if (server === 1) {
      // In front of P1's striker (+Z direction towards midline)
      puckX = THREE.MathUtils.clamp(this.p1Pos.x, -0.25, 0.25);
      if (this.p1Pos.z > -0.55) {
        this.p1Pos.z = -0.65;
        this.p1PrevPos.copy(this.p1Pos);
      }
      puckZ = THREE.MathUtils.clamp(this.p1Pos.z + gap, -0.55, -0.25);
    } else {
      // In front of P2's striker (-Z direction towards midline)
      puckX = THREE.MathUtils.clamp(this.p2Pos.x, -0.25, 0.25);
      if (this.p2Pos.z < 0.55) {
        this.p2Pos.z = 0.65;
        this.p2PrevPos.copy(this.p2Pos);
      }
      puckZ = THREE.MathUtils.clamp(this.p2Pos.z - gap, 0.25, 0.55);
    }

    this.physics.setPuckPosition(puckX, puckZ);
    this.physics.setPuckVelocity(0, 0);
    this.physics.setPuckSpin(0);

    this.onStateChange(this.state);
    const serverName = server === 1 ? 'P1' : 'CPU';
    this.onActionToast(`${serverName} TO SERVE (STRIKE PUCK)`);
  }

  serve() {
    if (this.state !== AIR_HOCKEY_STATES.SERVE_WAIT) return;

    this.state = AIR_HOCKEY_STATES.ACTIVE_PLAY;
    this.shotClock = 7.0;

    if (this.server === 1) {
      // P1 serves: launches puck forward with a clean angle based on striker position
      const p1X = this.p1Pos.x;
      const targetAngle = THREE.MathUtils.clamp(-p1X * 0.45, -0.4, 0.4);
      this.physics.servePuck(1, {
        speed: 4.8,
        angle: targetAngle,
        spin: targetAngle * 8.0,
      });
      this.onActionToast('P1 SERVE');
    } else {
      // CPU Tactical Serves: select angle or bank shot
      const serves = [
        { name: 'CROSS BANK', speed: 5.2, angle: 0.35, spin: 6.0 },
        { name: 'WIDE SLICE', speed: 5.0, angle: -0.38, spin: -7.0 },
        { name: 'FAST DRIVE', speed: 5.8, angle: 0.05, spin: 0.0 },
      ];
      const pick = serves[Math.floor(Math.random() * serves.length)];
      this.physics.servePuck(2, pick);
      this.onActionToast(`CPU SERVE: ${pick.name}`);
    }

    this.onStateChange(this.state);
  }

  restartMatch() {
    this.scores = [0, 0];
    this.server = 1;
    this.p1Pos.set(0, AIR_HOCKEY_TABLE_HEIGHT, -0.65);
    this.p1PrevPos.copy(this.p1Pos);
    this.p1Vel.set(0, 0, 0);
    this.p2Pos.set(0, AIR_HOCKEY_TABLE_HEIGHT, 0.65);
    this.p2PrevPos.copy(this.p2Pos);
    this.p2Vel.set(0, 0, 0);
    this.resetPuckForServe(1);
    this.onScoreUpdate(this.scores);
    this.onActionToast('AIR HOCKEY MATCH START');
  }

  setDifficulty(level) {
    if (this.difficultyConfigs[level]) {
      this.difficulty = level;
    }
  }

  /**
   * Smart CPU AI Opponent:
   * - Intelligent rail tactics: avoids ramming into the wall by striking inside-out.
   * - Anti-own-goal recovery: when puck is behind the mallet, flanks along center lane to avoid dragging.
   * - Committed forward strikes: drives cleanly through puck into opponent territory.
   * - Defensive goal crease stance when puck is in P1 territory.
   */
  updateAI(dt) {
    if (!this.aiEnabled || this.multiplayer.isConnected) return;

    const config = this.difficultyConfigs[this.difficulty] || this.difficultyConfigs.medium;
    const puck = this.physics.getPuckState();
    const puckZ = puck.position.z;
    const puckX = puck.position.x;
    const puckVz = puck.velocity.z;
    const puckVx = puck.velocity.x;
    const puckSpeed = Math.hypot(puckVx, puckVz);

    // 1. CPU Serving flow: physically drive forward through puck
    if (this.state === AIR_HOCKEY_STATES.SERVE_WAIT && this.server === 2) {
      this.aiServeTimer -= dt;
      if (this.aiServeTimer <= 0) {
        // Drive forward through puck (at Z ~ 0.45m) to physically strike it
        const strikeOffset = Math.max(this.p2Bounds.minZ, 0.25 - 0.05 * ((config.strikePower || 1.0) - 1.0));
        this.aiTargetPos.set(0, AIR_HOCKEY_TABLE_HEIGHT, strikeOffset);
      } else {
        // Line up behind puck ready to strike
        this.aiTargetPos.set(0, AIR_HOCKEY_TABLE_HEIGHT, 0.65);
      }
    } else if (this.state === AIR_HOCKEY_STATES.ACTIVE_PLAY) {
      // 2. Active Play Flow
      if (this.aiSwingTimer > 0) {
        // A. Committed Forward Strike in progress
        this.aiSwingTimer -= dt;
        // Terminate swing early only if puck has successfully launched into P1 half
        if (puckZ < 0.05 || puckVz < -0.8) {
          this.aiSwingTimer = 0;
        }
      } else if (puckZ > -0.05) {
        // B. Puck is in CPU territory or crossing center line
        const isBehindMallet = puckZ > (this.p2Pos.z + 0.01);
        const isLateralOverlap = Math.abs(this.p2Pos.x - puckX) < (this.strikerRadius + 0.05);

        if (isBehindMallet && isLateralOverlap) {
          // B1. OWN-GOAL PREVENTION / FLANK RECOVERY:
          // Mallet is between the puck and P1 territory, dangerously aligned with puck in X!
          // NEVER move in +Z towards own goal while in front of the puck!
          // Instead, flank toward center lane (X -> 0) while maintaining Z forward of the puck:
          const flankX = puckX > 0 ? Math.max(0.0, puckX - 0.22) : Math.min(0.0, puckX + 0.22);
          this.aiTargetPos.x = flankX;
          this.aiTargetPos.z = Math.min(this.p2Pos.z, puckZ - 0.06);
        } else if (isBehindMallet && !isLateralOverlap) {
          // B2. Lateral clearance achieved: safely retreat behind the puck
          this.aiTargetPos.x = this.p2Pos.x;
          this.aiTargetPos.z = Math.min(this.p2Bounds.maxZ, puckZ + 0.12);
        } else {
          // B3. Mallet is safely BEHIND the puck (Z >= puckZ): align or strike!
          let strikeX;
          if (Math.abs(puckX) > 0.28) {
            // Rail shot: Mallet aligns slightly on the inside (0.025m inside of puck)
            strikeX = puckX > 0 ? puckX - 0.025 : puckX + 0.025;
          } else {
            // Open ice: calculate lead intercept
            const timeToIntercept = Math.max(0.04, Math.min(0.35, (this.p2Pos.z - puckZ) / Math.max(1.0, puckVz)));
            strikeX = puckX + puckVx * (timeToIntercept * 0.5) + (Math.sin(Date.now() * 0.005) * config.errorMargin);
            strikeX = THREE.MathUtils.clamp(strikeX, -0.38, 0.38);
          }

          const setupZ = Math.min(this.p2Bounds.maxZ, puckZ + 0.10);
          const inPosition = (this.p2Pos.z > puckZ + 0.015) && (Math.abs(this.p2Pos.x - strikeX) < 0.06);

          if (inPosition) {
            // Trigger committed forward strike!
            this.aiSwingTimer = 0.32;
            const forwardReach = 0.25 * (config.strikePower || 1.0);
            const reachLimit = Math.max(this.p2Bounds.minZ, config.maxReachZ || 0.005);
            this.aiTargetPos.z = Math.max(reachLimit, puckZ - forwardReach);
            this.aiTargetPos.x = strikeX;
          } else {
            this.aiTargetPos.x = strikeX;
            this.aiTargetPos.z = setupZ;
          }
        }
      } else {
        // C. Puck is in Player 1 territory: DEFENSIVE GOAL CREASE STANCE
        const guardX = THREE.MathUtils.clamp(puckX * 0.65, -0.22, 0.22);
        const guardZ = 0.82; // Safe distance in front of goal mouth
        this.aiTargetPos.set(guardX, AIR_HOCKEY_TABLE_HEIGHT, guardZ);
      }
    }

    // Smooth movement towards aiTargetPos
    const aiSpeed = config.aiSpeed;
    this.p2PrevPos.copy(this.p2Pos);
    this.p2Pos.x += (this.aiTargetPos.x - this.p2Pos.x) * Math.min(1.0, dt * aiSpeed);
    this.p2Pos.z += (this.aiTargetPos.z - this.p2Pos.z) * Math.min(1.0, dt * (aiSpeed * 1.2));
    this.p2Pos.y = AIR_HOCKEY_TABLE_HEIGHT;

    // Enforce CPU territory boundaries and 45° corner bouncers
    const clampedP2 = this.physics.clampStrikerPosition(2, this.p2Pos);
    this.p2Pos.x = clampedP2.x;
    this.p2Pos.z = clampedP2.z;

    if (dt > 0.0001) {
      this.p2Vel.subVectors(this.p2Pos, this.p2PrevPos).divideScalar(dt);
    }
  }

  update(dt, localPaddleTransform) {
    const isHost = this.multiplayer.role !== 'client';

    if (isHost) {
      // 1. Update Player 1 Striker from Hand Tracker / Mouse Input
      if (localPaddleTransform) {
        this.p1PrevPos.copy(this.p1Pos);

        // Clamp P1 striker strictly to P1 territory and 45° corner bouncers
        const clampedP1 = this.physics.clampStrikerPosition(1, {
          x: localPaddleTransform.position.x,
          z: localPaddleTransform.position.z,
        });

        this.p1Pos.set(clampedP1.x, AIR_HOCKEY_TABLE_HEIGHT, clampedP1.z);

        if (dt > 0.0001) {
          this.p1Vel.subVectors(this.p1Pos, this.p1PrevPos).divideScalar(dt);
        }
      }

      // 2. Update Player 2 Striker (Multiplayer client or CPU AI)
      if (this.multiplayer.isConnected && (this.hasRemoteInput || this.clientP2Input)) {
        this.p2PrevPos.copy(this.p2Pos);
        // Apply linear interpolation to remote opponent striker across network ticks
        const lerpFactor = Math.min(1.0, 25.0 * dt);
        this.p2Pos.lerp(this.remoteTargetPos, lerpFactor);
        if (dt > 0.0001) {
          this.p2Vel.subVectors(this.p2Pos, this.p2PrevPos).divideScalar(dt);
        }
      } else {
        this.updateAI(dt);
      }

      // 3. Step Air Hockey 2D Planar Physics
      if (this.state === AIR_HOCKEY_STATES.ACTIVE_PLAY || this.state === AIR_HOCKEY_STATES.SERVE_WAIT) {
        this.physics.step(dt, this.p1Pos, this.p1Vel, this.p2Pos, this.p2Vel);
      }

      // Safety guard during SERVE_WAIT: prevent puck from getting trapped behind server striker
      if (this.state === AIR_HOCKEY_STATES.SERVE_WAIT) {
        const puck = this.physics.getPuckState();
        if (this.server === 1) {
          if (puck.position.z <= this.p1Pos.z + 0.09) {
            this.physics.setPuckPosition(
              THREE.MathUtils.clamp(this.p1Pos.x, -0.25, 0.25),
              THREE.MathUtils.clamp(this.p1Pos.z + 0.20, -0.55, -0.25)
            );
            this.physics.setPuckVelocity(0, 0);
          }
        } else if (this.server === 2) {
          if (puck.position.z >= this.p2Pos.z - 0.09) {
            this.physics.setPuckPosition(
              THREE.MathUtils.clamp(this.p2Pos.x, -0.25, 0.25),
              THREE.MathUtils.clamp(this.p2Pos.z - 0.20, 0.25, 0.55)
            );
            this.physics.setPuckVelocity(0, 0);
          }
        }
      }

      const puckState = this.physics.getPuckState();

      // 4. Update Three.js Scene Meshes
      if (this.scene.striker1) {
        this.scene.striker1.position.copy(this.p1Pos);
      }
      if (this.scene.striker2) {
        this.scene.striker2.position.copy(this.p2Pos);
      }
      if (this.scene.puck) {
        this.scene.puck.position.set(
          puckState.position.x,
          AIR_HOCKEY_TABLE_HEIGHT + 0.0038,
          puckState.position.z
        );
        // Spin rotation around Y
        this.scene.puck.rotation.y += puckState.spin * dt;
      }

      // 5. High-performance flat binary array multiplayer broadcast (TAG_HOCKEY_SYNC = 3.0)
      if (this.multiplayer.isConnected) {
        this.syncBuffer[0] = 3.0; // TAG_HOCKEY_SYNC
        this.syncBuffer[1] = puckState.position.x;
        this.syncBuffer[2] = puckState.position.z;
        this.syncBuffer[3] = puckState.velocity.x;
        this.syncBuffer[4] = puckState.velocity.z;
        this.syncBuffer[5] = puckState.spin;
        this.syncBuffer[6] = this.p1Pos.x;
        this.syncBuffer[7] = this.p1Pos.z;
        this.syncBuffer[8] = this.p2Pos.x;
        this.syncBuffer[9] = this.p2Pos.z;
        this.syncBuffer[10] = this.scores[0];
        this.syncBuffer[11] = this.scores[1];
        this.syncBuffer[12] = this.server;
        this.syncBuffer[13] = this.state === AIR_HOCKEY_STATES.SERVE_WAIT ? 0 : (this.state === AIR_HOCKEY_STATES.ACTIVE_PLAY ? 1 : 2);
        this.syncBuffer[14] = performance.now();

        this.multiplayer.send(this.syncBuffer);
      }
    } else {
      // Client mode (P2)
      if (localPaddleTransform) {
        const clampedP2 = this.physics.clampStrikerPosition(2, {
          x: localPaddleTransform.position.x,
          z: localPaddleTransform.position.z,
        });
        this.p2Pos.set(clampedP2.x, AIR_HOCKEY_TABLE_HEIGHT, clampedP2.z);

        if (this.scene.striker2) {
          this.scene.striker2.position.copy(this.p2Pos);
        }

        // High-performance flat binary array client input broadcast (TAG_HOCKEY_CLIENT_INPUT = 4.0)
        this.clientInputBuffer[0] = 4.0; // TAG_HOCKEY_CLIENT_INPUT
        this.clientInputBuffer[1] = clampedP2.x;
        this.clientInputBuffer[2] = clampedP2.z;
        this.clientInputBuffer[3] = localPaddleTransform.velocity ? localPaddleTransform.velocity.x : 0;
        this.clientInputBuffer[4] = localPaddleTransform.velocity ? localPaddleTransform.velocity.z : 0;
        this.clientInputBuffer[5] = performance.now();

        this.multiplayer.send(this.clientInputBuffer);
      }

      // Linear interpolation to remote opponent (P1) striker across network ticks
      if (this.scene.striker1) {
        this.scene.striker1.position.lerp(this.remoteTargetPos, Math.min(1.0, 25.0 * dt));
      }

      // Client-Side Prediction for puck & local striker-puck collisions
      if (this.predictedHitTimer > 0) {
        this.predictedHitTimer -= dt;
      }

      if (this.state === AIR_HOCKEY_STATES.SERVE_WAIT) {
        this.predictedPuckPos.lerp(this.clientPuckTarget, Math.min(1.0, 25.0 * dt));
        this.predictedPuckVel.set(0, 0, 0);
      } else {
        // Forward dead reckoning simulation
        this.predictedPuckPos.x += this.predictedPuckVel.x * dt;
        this.predictedPuckPos.z += this.predictedPuckVel.z * dt;
        this.predictedPuckVel.multiplyScalar(Math.pow(0.994, dt * 60));

        // Local striker-puck collision prediction
        const p2Pos = this.p2Pos;
        const dist = Math.hypot(this.predictedPuckPos.x - p2Pos.x, this.predictedPuckPos.z - p2Pos.z);
        const minDist = 0.050 + 0.026; // strikerRadius + puckRadius = 0.076m
        if (this.predictedPuckVel.z > 0 && dist < minDist + 0.015 && this.predictedHitTimer <= 0) {
          this.predictedPuckVel.z = -Math.max(2.5, Math.abs(this.predictedPuckVel.z) * 1.1);
          this.predictedPuckVel.x = (this.predictedPuckPos.x - p2Pos.x) * 15.0;
          sound.playStrikerHit(1.2);
          if (this.scene && this.scene.triggerImpact) {
            this.scene.triggerImpact(p2Pos, 0x00ffcc);
          }
          this.isPredictingHit = true;
          this.predictedHitTimer = 0.25;
        }

        // Smooth reconciliation toward authoritative host puck target
        const reconSpeed = (this.isPredictingHit && this.predictedPuckVel.z < 0) ? 12.0 : 30.0;
        this.predictedPuckPos.lerp(this.clientPuckTarget, Math.min(1.0, reconSpeed * dt));
      }

      if (this.scene.puck) {
        this.scene.puck.position.set(
          this.predictedPuckPos.x,
          AIR_HOCKEY_TABLE_HEIGHT + 0.0038,
          this.predictedPuckPos.z
        );
      }
    }
  }

  handleNetworkData(packet) {
    if (!packet) return;

    if (packet instanceof Float32Array) {
      const tag = packet[0];

      // Standard 32-byte (8 float) binary packet handling
      if (packet.length === 8) {
        if (tag === 1.0) { // POSITION_STATE
          if (this.multiplayer.role === 'client') {
            this.clientPuckTarget.set(packet[4], AIR_HOCKEY_TABLE_HEIGHT + 0.0038, packet[5]);
            this.remoteTargetPos.set(packet[1], AIR_HOCKEY_TABLE_HEIGHT, packet[3]);
          } else if (this.multiplayer.role === 'host') {
            this.remoteTargetPos.set(packet[1], AIR_HOCKEY_TABLE_HEIGHT, packet[3]);
            this.hasRemoteInput = true;
          }
        } else if (tag === 2.0) { // SCORE_UPDATE
          this.scores = [packet[1], packet[2]];
          this.server = packet[3];
          const stateCode = packet[4];
          this.state = stateCode === 0 ? AIR_HOCKEY_STATES.SERVE_WAIT : (stateCode === 1 ? AIR_HOCKEY_STATES.ACTIVE_PLAY : AIR_HOCKEY_STATES.MATCH_OVER);
          this.onScoreUpdate(this.scores);
          this.onStateChange(this.state);
        } else if (tag === 3.0) { // COLLISION_EVENT
          sound.playStrikerHit(1.0);
          if (this.scene && this.scene.triggerImpact) {
            this.scene.triggerImpact(new THREE.Vector3(packet[2], packet[3], packet[4]), 0xd4a03c);
          }
        }
        return;
      }

      if (tag === 3.0 && this.multiplayer.role === 'client') {
        // TAG_HOCKEY_SYNC (15 floats)
        this.clientPuckTarget.set(packet[1], AIR_HOCKEY_TABLE_HEIGHT + 0.0038, packet[2]);
        if (!this.isPredictingHit || packet[4] < 0) {
          this.predictedPuckVel.set(packet[3], 0, packet[4]);
          if (packet[4] < 0) this.isPredictingHit = false;
        }

        // Remote opponent (P1) target for linear interpolation
        this.remoteTargetPos.set(packet[6], AIR_HOCKEY_TABLE_HEIGHT, packet[7]);

        this.scores = [packet[10], packet[11]];
        this.server = packet[12];
        const stateCode = packet[13];
        this.state = stateCode === 0 ? AIR_HOCKEY_STATES.SERVE_WAIT : (stateCode === 1 ? AIR_HOCKEY_STATES.ACTIVE_PLAY : AIR_HOCKEY_STATES.MATCH_OVER);

        this.onScoreUpdate(this.scores);
        this.onStateChange(this.state);
      } else if (tag === 4.0 && this.multiplayer.role === 'host') {
        // TAG_HOCKEY_CLIENT_INPUT (6 floats)
        this.remoteTargetPos.set(packet[1], AIR_HOCKEY_TABLE_HEIGHT, packet[2]);
        this.remoteTargetVel.set(packet[3], 0, packet[4]);
        this.hasRemoteInput = true;
      }
      return;
    }

    // Legacy JSON object support
    if (packet.type === 'hockey_sync' && this.multiplayer.role === 'client') {
      if (!this.clientPuckTarget) this.clientPuckTarget = new THREE.Vector3();
      this.clientPuckTarget.set(packet.puck.x, AIR_HOCKEY_TABLE_HEIGHT + 0.0038, packet.puck.z);
      this.remoteTargetPos.set(packet.p1[0], AIR_HOCKEY_TABLE_HEIGHT, packet.p1[1]);

      this.scores = packet.scores;
      this.server = packet.server;
      this.state = packet.state;

      this.onScoreUpdate(this.scores);
      this.onStateChange(this.state);
    } else if (packet.type === 'hockey_client_input' && this.multiplayer.role === 'host') {
      this.clientP2Input = packet;
      if (packet.pos) this.remoteTargetPos.set(packet.pos[0], AIR_HOCKEY_TABLE_HEIGHT, packet.pos[2]);
      this.hasRemoteInput = true;
    }
  }
}
