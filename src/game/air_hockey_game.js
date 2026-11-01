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
      maxZ: -this.strikerRadius - 0.01, // Cannot cross centerline (Z=0)
    };

    this.p2Bounds = {
      minX: -this.tableHalfW + this.strikerRadius + 0.01,
      maxX: this.tableHalfW - this.strikerRadius - 0.01,
      minZ: this.strikerRadius + 0.01,  // Cannot cross centerline (Z=0)
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
    this.difficulty = 'medium';
    this.difficultyConfigs = {
      easy: { aiSpeed: 4.5, errorMargin: 0.08, maxReachZ: 0.45 },
      medium: { aiSpeed: 7.5, errorMargin: 0.03, maxReachZ: 0.20 },
      hard: { aiSpeed: 11.0, errorMargin: 0.0, maxReachZ: 0.05 },
    };

    // Shot Clock (7 seconds rule)
    this.shotClock = 7.0;

    // Multi-puck / Network synchronization
    this.clientP2Input = null;

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

    // Reset puck inside the serving player's half stationary (closer to goal post)
    this.physics.resetPuck(server);
    this.physics.setPuckPosition(0, server === 1 ? -0.78 : 0.78);
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
   * Analyzes puck position, velocity, and trajectory.
   * Defends goal crease when puck is in P1 half, attacks and banks when puck enters CPU half!
   */
  updateAI(dt) {
    if (!this.aiEnabled || this.multiplayer.isConnected) return;

    const config = this.difficultyConfigs[this.difficulty] || this.difficultyConfigs.medium;
    const puck = this.physics.getPuckState();

    // 1. CPU Serving flow: physically drive forward through puck
    if (this.state === AIR_HOCKEY_STATES.SERVE_WAIT && this.server === 2) {
      this.aiServeTimer -= dt;
      if (this.aiServeTimer <= 0) {
        // Drive forward through puck to physically strike it
        this.aiTargetPos.set(0, AIR_HOCKEY_TABLE_HEIGHT, 0.62);
      } else {
        // Line up behind puck ready to strike
        this.aiTargetPos.set(0, AIR_HOCKEY_TABLE_HEIGHT, 0.92);
      }
    } else if (this.state === AIR_HOCKEY_STATES.ACTIVE_PLAY) {
      // 2. In-Play Decision Logic
      const puckZ = puck.position.z;
      const puckX = puck.position.x;
      const puckVz = puck.velocity.z;
      const puckVx = puck.velocity.x;
      const puckSpeed = Math.hypot(puckVx, puckVz);

      if (puckZ > -0.05) {
        // Puck is in CPU territory or crossing centerline: ATTACK / INTERCEPT!
        const timeToIntercept = Math.max(0.04, Math.min(0.35, (this.p2Pos.z - puckZ) / Math.max(1.0, puckVz)));
        let desiredX = puckX + puckVx * (timeToIntercept * 0.6) + (Math.sin(Date.now() * 0.005) * config.errorMargin);
        desiredX = THREE.MathUtils.clamp(desiredX, this.p2Bounds.minX, this.p2Bounds.maxX);

        const desiredZ = THREE.MathUtils.clamp(puckZ + 0.12, Math.max(this.p2Bounds.minZ, config.maxReachZ), this.p2Bounds.maxZ);

        const distToPuck = Math.hypot(this.p2Pos.x - puckX, this.p2Pos.z - puckZ);
        if (distToPuck < 0.22) {
          this.aiTargetPos.x = desiredX;
          this.aiTargetPos.z = Math.max(this.p2Bounds.minZ, puckZ - 0.08); // Strike through!
        } else {
          this.aiTargetPos.x = desiredX;
          this.aiTargetPos.z = desiredZ;
        }
      } else {
        // Puck is in P1 territory: DEFENSIVE GOAL CREASE STANCE
        const guardX = THREE.MathUtils.clamp(puckX * 0.65, -0.22, 0.22);
        const guardZ = 0.82; // Safe distance in front of goal post (Z=1.07)
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
      if (this.multiplayer.isConnected && this.clientP2Input) {
        this.p2PrevPos.copy(this.p2Pos);
        const [cx, , cz] = this.clientP2Input.pos;
        const clampedP2 = this.physics.clampStrikerPosition(2, { x: cx, z: cz });
        this.p2Pos.set(clampedP2.x, AIR_HOCKEY_TABLE_HEIGHT, clampedP2.z);
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

      // 5. Multiplayer State Broadcast
      if (this.multiplayer.isConnected) {
        this.multiplayer.send({
          type: 'hockey_sync',
          puck: { x: puckState.position.x, z: puckState.position.z },
          p1: [this.p1Pos.x, this.p1Pos.z],
          p2: [this.p2Pos.x, this.p2Pos.z],
          scores: this.scores,
          server: this.server,
          state: this.state,
        });
      }
    } else {
      // Client mode (P2)
      if (localPaddleTransform) {
        const clampedX = THREE.MathUtils.clamp(
          localPaddleTransform.position.x,
          this.p2Bounds.minX,
          this.p2Bounds.maxX
        );
        const clampedZ = THREE.MathUtils.clamp(
          localPaddleTransform.position.z,
          this.p2Bounds.minZ,
          this.p2Bounds.maxZ
        );
        this.p2Pos.set(clampedX, AIR_HOCKEY_TABLE_HEIGHT, clampedZ);

        if (this.scene.striker2) {
          this.scene.striker2.position.copy(this.p2Pos);
        }

        this.multiplayer.send({
          type: 'hockey_client_input',
          pos: [clampedX, AIR_HOCKEY_TABLE_HEIGHT, clampedZ],
        });
      }

      if (this.clientPuckTarget && this.scene.puck) {
        this.scene.puck.position.lerp(this.clientPuckTarget, 0.45);
      }
      if (this.clientP1Target && this.scene.striker1) {
        this.scene.striker1.position.lerp(this.clientP1Target, 0.35);
      }
    }
  }

  handleNetworkData(packet) {
    if (!packet) return;

    if (packet.type === 'hockey_sync' && this.multiplayer.role === 'client') {
      if (!this.clientPuckTarget) this.clientPuckTarget = new THREE.Vector3();
      if (!this.clientP1Target) this.clientP1Target = new THREE.Vector3();

      this.clientPuckTarget.set(packet.puck.x, AIR_HOCKEY_TABLE_HEIGHT + 0.0038, packet.puck.z);
      this.clientP1Target.set(packet.p1[0], AIR_HOCKEY_TABLE_HEIGHT, packet.p1[1]);

      this.scores = packet.scores;
      this.server = packet.server;
      this.state = packet.state;

      this.onScoreUpdate(this.scores);
      this.onStateChange(this.state);
    } else if (packet.type === 'hockey_client_input' && this.multiplayer.role === 'host') {
      this.clientP2Input = packet;
    }
  }
}
