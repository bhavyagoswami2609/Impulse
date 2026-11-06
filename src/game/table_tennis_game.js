import * as THREE from 'three';
import { TABLE_LENGTH, TABLE_WIDTH, TABLE_HEIGHT } from '../graphics/procedural_models.js';
import { sound } from '../audio/sound_effects.js';

export const GAME_STATES = {
  READY: 'READY',
  SERVE_WAIT: 'SERVE_WAIT',
  RALLY: 'RALLY',
  MATCH_OVER: 'MATCH_OVER',
};

export class TableTennisGame {
  constructor(options = {}) {
    this.scene = options.scene;
    this.physics = options.physics;
    this.multiplayer = options.multiplayer;
    this.onStateChange = options.onStateChange || (() => {});
    this.onScoreUpdate = options.onScoreUpdate || (() => {});
    this.onActionToast = options.onActionToast || (() => {});
    this.onMatchOver = options.onMatchOver || (() => {});

    // Match State
    this.state = GAME_STATES.SERVE_WAIT;
    this.scores = [0, 0]; // [P1, P2/CPU]
    this.initialServer = 1;
    this.server = this.initialServer; // ITTF 2-serve rotation / 1-serve at deuce
    this.winningScore = 11;
    this.isDeuce = false;

    // Rally details
    this.lastHitter = 1;
    this.bouncesP1 = 0;
    this.bouncesP2 = 0;
    this.isServiceInProgress = true;
    this.rallyLength = 0;
    this.matchType = options.matchType || 'singles'; // 'singles' or 'doubles'

    // Smash meters (0 to 100)
    this.smashEnergy = [0, 0];
    this.isHyperSmashActive = [false, false];
    this.netHitDuringServe = false;
    this.deadBallTimer = 0;

    // CPU AI Opponent & Bot Difficulty
    this.aiEnabled = true;
    this.aiCurrentPos = new THREE.Vector3(0, 0.95, 1.45);
    this.aiTargetPos = new THREE.Vector3(0, 0.95, 1.45);
    this.aiServeTimer = 0.65;
    this.aiSwingTimer = 0;
    this.aiCurrentYaw = 0;
    this.aiShotTargetX = -0.38;
    this.aiReactionTimer = 0;
    this.difficulty = 'medium';
    this.difficultyConfigs = {
      easy: {
        aiSpeed: 7.0,
        errorMargin: 0.08,
        reactionDelay: 0.12,
        swingPower: 0.85,
        cornerDriveRate: 0.35,
        interceptRise: 1.34,
        servePace: 2.30,
        returnPower: 0.86,
      },
      medium: {
        aiSpeed: 12.0,
        errorMargin: 0.02,
        reactionDelay: 0.03,
        swingPower: 1.0,
        cornerDriveRate: 0.70,
        interceptRise: 1.28,
        servePace: 2.75,
        returnPower: 1.0,
      },
      hard: {
        aiSpeed: 16.5,
        errorMargin: 0.0,
        reactionDelay: 0.0,
        swingPower: 1.20,
        cornerDriveRate: 0.95,
        interceptRise: 1.22,
        servePace: 3.15,
        returnPower: 1.15,
      },
    };

    // Last recorded player paddle transform
    this.lastP1Pos = new THREE.Vector3(0, 0.95, -1.45);
    this.lastP1Vel = new THREE.Vector3();

    // Pre-allocated Float32Array network buffers (eliminates JSON serialization & GC pauses)
    this.syncBuffer = new Float32Array(22);
    this.clientInputBuffer = new Float32Array(13);

    // Remote opponent interpolation targets across incoming network ticks
    this.remoteTargetPos = new THREE.Vector3(0, 0.95, 1.45);
    this.remoteTargetRot = new THREE.Quaternion(0, 1, 0, 0);
    this.remoteTargetVel = new THREE.Vector3();
    this.hasRemoteInput = false;

    // Client-side prediction for local paddle-ball collisions
    this.predictedBallPos = new THREE.Vector3(0, 1.05, -1.35);
    this.predictedBallVel = new THREE.Vector3();
    this.predictedBallRot = new THREE.Quaternion();
    this.clientBallTarget = new THREE.Vector3(0, 1.05, -1.35);
    this.isPredictingHit = false;
    this.predictedHitTimer = 0;

    this.setupPhysicsCallbacks();
    this.resetRally(1);
  }

  setupPhysicsCallbacks() {
    this.physics.callbacks.onBallBounceTable = (pos, side) => {
      this.handleTableBounce(pos, side);
    };

    this.physics.callbacks.onBallHitPaddle = (player, speed) => {
      this.handlePaddleHit(player, speed);
    };

    this.physics.callbacks.onBallHitNet = () => {
      sound.playNetClip();
      this.handleNetHit();
    };

    this.physics.callbacks.onBallHitFloor = () => {
      this.handleFloorHit();
    };

    this.physics.callbacks.onBallHitTableSide = (pos) => {
      this.handleTableSideHit(pos);
    };
  }

  setMatchType(type) {
    if (type === 'singles' || type === 'doubles') {
      this.matchType = type;
    }
  }

  /**
   * Called when ball contacts the vertical side of the table leaf below the top edge.
   * Rule: Edge balls on the top flat edge/corner are in; hitting the vertical side is out!
   */
  handleTableSideHit(pos) {
    if (this.state !== GAME_STATES.RALLY) return;
    if (this.multiplayer.role === 'client') return;

    this.scene.triggerImpact(new THREE.Vector3(pos.x, pos.y, pos.z), 0xff2200);

    if (this.isServiceInProgress) {
      const receiver = 3 - this.server;
      this.awardPoint(receiver, 'FAULT - TABLE SIDE');
    } else {
      const opponent = this.lastHitter === 1 ? 2 : 1;
      this.awardPoint(opponent, 'OUT - TABLE SIDE');
    }
  }

  /**
   * Computes legal server under ITTF rules (Sections 2.13.3, 2.13.4):
   * - Before deuce (< 10-10): each player serves for 2 consecutive points.
   * - At deuce and beyond (>= 10-10): each player serves for only 1 point in turn.
   */
  computeNextServer(scores) {
    const p1 = scores[0];
    const p2 = scores[1];
    const totalPoints = p1 + p2;
    if (p1 >= 10 && p2 >= 10) {
      return (totalPoints % 2 === 0) ? this.initialServer : (3 - this.initialServer);
    }
    const serviceBlock = Math.floor(totalPoints / 2);
    return (serviceBlock % 2 === 0) ? this.initialServer : (3 - this.initialServer);
  }

  handleTableBounce(pos, side) {
    if (this.state !== GAME_STATES.RALLY) return;

    sound.playTableBounce(1.0);
    this.scene.triggerImpact(new THREE.Vector3(pos.x, pos.y, pos.z), 0x00ff88);

    if (this.multiplayer.role === 'client') return;

    if (side === 1) {
      this.bouncesP1++;
    } else {
      this.bouncesP2++;
    }

    // A. Service Phase Validation
    if (this.isServiceInProgress) {
      if (this.server === 1) {
        // Player 1 Serving:
        if (this.bouncesP1 >= 2) {
          // Bounced twice on server's own table
          this.awardPoint(2, 'FAULT - DOUBLE BOUNCE');
          return;
        }

        // Rule: In singles, the serve can land anywhere on the opponent's side.
        // In doubles, the ball must be served diagonally from right-hand box to right-hand box.
        if (this.matchType === 'doubles') {
          if (side === 1 && pos.x > 0) {
            // Must serve from right-hand box (x <= 0 for P1)
            this.awardPoint(2, 'FAULT - WRONG SERVICE BOX');
            return;
          }
          if (side === 2 && pos.x < 0) {
            // Must land in opponent's right-hand box (x >= 0 for P2)
            this.awardPoint(2, 'FAULT - WRONG SERVICE BOX');
            return;
          }
        }

        if (side === 2) {
          if (this.bouncesP1 === 0) {
            // Did not bounce on server's table first
            this.awardPoint(2, 'FAULT - DIRECT HIT');
            return;
          }
          if (this.bouncesP2 >= 2) {
            // Receiver allowed it to bounce twice
            this.awardPoint(1, 'ACE');
            return;
          }
          if (this.bouncesP1 >= 1 && this.bouncesP2 === 1) {
            if (this.netHitDuringServe) {
              this.netHitDuringServe = false;
              this.onActionToast('LET - RE-SERVE');
              this.resetRally(this.server);
              return;
            }
            // Legal serve completed
            this.isServiceInProgress = false;
            if (this.physics) this.physics.isServeFlight = false;
          }
        }
      } else {
        // Player 2 / CPU Serving:
        if (this.bouncesP2 >= 2) {
          // Bounced twice on server's own table
          this.awardPoint(1, 'FAULT - DOUBLE BOUNCE');
          return;
        }

        // Rule: Doubles placement for Server 2 (diagonal right-to-right box)
        if (this.matchType === 'doubles') {
          if (side === 2 && pos.x < 0) {
            // Must serve from right-hand box (x >= 0 for P2)
            this.awardPoint(1, 'FAULT - WRONG SERVICE BOX');
            return;
          }
          if (side === 1 && pos.x > 0) {
            // Must land in opponent's right-hand box (x <= 0 for P1)
            this.awardPoint(1, 'FAULT - WRONG SERVICE BOX');
            return;
          }
        }

        if (side === 1) {
          if (this.bouncesP2 === 0) {
            // Did not bounce on server's table first
            this.awardPoint(1, 'FAULT - DIRECT HIT');
            return;
          }
          if (this.bouncesP1 >= 2) {
            // Receiver allowed it to bounce twice
            this.awardPoint(2, 'ACE');
            return;
          }
          if (this.bouncesP2 >= 1 && this.bouncesP1 === 1) {
            if (this.netHitDuringServe) {
              this.netHitDuringServe = false;
              this.onActionToast('LET - RE-SERVE');
              this.resetRally(this.server);
              return;
            }
            // Legal serve completed
            this.isServiceInProgress = false;
            if (this.physics) this.physics.isServeFlight = false;
          }
        }
      }
      return;
    }

    // B. Normal Rally Phase Validation
    // When the ball bounces on the table, it can bounce one time on the other side of the net as well!
    const isHitterSide = side === this.lastHitter;
    const receiverBounces = this.lastHitter === 1 ? this.bouncesP2 : this.bouncesP1;
    const hitterBounces = this.lastHitter === 1 ? this.bouncesP1 : this.bouncesP2;

    if (isHitterSide) {
      if (receiverBounces >= 1) {
        // Ball had already bounced on receiver court and returned back without receiver returning it -> hitter point
        this.awardPoint(this.lastHitter, 'WINNER');
        return;
      }
      if (hitterBounces >= 2) {
        // Ball bounced twice on hitter's side without crossing the net -> point to opponent
        const opponent = this.lastHitter === 1 ? 2 : 1;
        this.awardPoint(opponent, 'DOUBLE BOUNCE');
        return;
      }
      // First bounce on hitter's side: play continues so it can bounce one time on the other side of the net as well!
      return;
    } else {
      // Bounced on receiver side:
      if (receiverBounces >= 2) {
        // Receiver allowed double bounce on their side without returning -> point to hitter
        this.awardPoint(this.lastHitter, 'DOUBLE BOUNCE');
        return;
      }
      // First bounce on receiver side: play continues (receiver can return it)
      return;
    }
  }

  handlePaddleHit(player, speed) {
    const isSmash = this.isHyperSmashActive[player - 1];
    sound.playPaddleHit(Math.max(1.0, speed * 0.4), isSmash);

    const padMesh = player === 1 ? this.scene.paddle1 : this.scene.paddle2;
    this.scene.triggerImpact(padMesh.position, isSmash ? 0xff0044 : 0x00ffff);

    if (this.multiplayer.role === 'client') return;

    if (this.state !== GAME_STATES.RALLY) {
      // In SERVE_WAIT, POINT_SCORED, or MATCH_OVER, passive paddle collisions must NEVER affect gameplay
      return;
    }

    // 1. Serving Phase Validation
    if (this.isServiceInProgress) {
      if (player === this.server) {
        // Consecutive hit by server during serve
        const opponent = player === 1 ? 2 : 1;
        this.awardPoint(opponent, 'DOUBLE HIT');
        return;
      }

      // Receiver returning serve:
      // "One Bounce on Your Side: When defending, the ball must bounce exactly once on your side of the table before you return it.
      //  No Volleys: You cannot hit the ball in mid-air before it bounces on your side. Doing so immediately awards the point to your opponent."
      const receiverBounces = this.server === 1 ? this.bouncesP2 : this.bouncesP1;
      if (receiverBounces === 0) {
        this.awardPoint(this.server, 'ILLEGAL VOLLEY');
        return;
      }

      // Legal serve return completed
      this.isServiceInProgress = false;
      if (this.physics) this.physics.isServeFlight = false;
    } else {
      // 2. Normal Rally Phase Validation
      // Rule: ITTF 2.10.1.6 - A player cannot hit the ball twice consecutively
      if (this.lastHitter === player && this.rallyLength > 0) {
        const opponent = player === 1 ? 2 : 1;
        this.awardPoint(opponent, 'DOUBLE HIT');
        return;
      }

      // Defender returning opponent's shot:
      // "One Bounce on Your Side: When defending, the ball must bounce exactly once on your side of the table before you return it.
      //  No Volleys: You cannot hit the ball in mid-air before it bounces on your side. Doing so immediately awards the point to your opponent."
      if (this.lastHitter !== player) {
        const defenderBounces = player === 1 ? this.bouncesP1 : this.bouncesP2;
        if (defenderBounces === 0) {
          const opponent = player === 1 ? 2 : 1;
          this.awardPoint(opponent, 'ILLEGAL VOLLEY');
          return;
        }
      }
    }

    this.lastHitter = player;
    this.bouncesP1 = 0;
    this.bouncesP2 = 0;
    this.rallyLength++;

    // Charge smash power
    const energyGain = isSmash ? -100 : 25 + Math.min(25, speed * 6);
    this.smashEnergy[player - 1] = Math.max(0, Math.min(100, this.smashEnergy[player - 1] + energyGain));

    if (this.smashEnergy[player - 1] >= 100) {
      this.isHyperSmashActive[player - 1] = true;
      sound.playSmashReady();
      this.onActionToast(player === 1 ? 'HYPER SMASH READY' : 'CPU SMASH READY');
    }

    if (isSmash) {
      this.isHyperSmashActive[player - 1] = false;
      this.smashEnergy[player - 1] = 0;
      this.physics.smashBall(player);
      this.onActionToast('MEGA SMASH');
    }
  }

  handleNetHit() {
    sound.playNetClip();
    if (this.isServiceInProgress) {
      this.netHitDuringServe = true;
    }
  }

  /**
   * Determines whether the ball has physically left the table boundaries.
   * True only when:
   * 1. The ball is outside the table perimeter AND drops below table top height (cannot land on table).
   * 2. The ball reaches the floor or flies far out of bounds.
   */
  isBallOffTable(ballPos, dt = 0) {
    if (!ballPos) return false;

    // 1. Reached the floor
    if (ballPos.y <= 0.08) {
      this.deadBallTimer = 0;
      return true;
    }

    // 2. Flown far out of bounds past any playable reach
    if (Math.abs(ballPos.z) > 2.6 || Math.abs(ballPos.x) > 2.2) {
      this.deadBallTimer = 0;
      return true;
    }

    const isOutsideZ = Math.abs(ballPos.z) > TABLE_LENGTH / 2 + 0.08;
    const isOutsideX = Math.abs(ballPos.x) > TABLE_WIDTH / 2 + 0.08;
    const isBelowTable = ballPos.y < TABLE_HEIGHT - 0.04;

    // 3. Past the back endline and dropped below table height
    if (isBelowTable && isOutsideZ) {
      this.deadBallTimer = 0;
      return true;
    }

    // 4. Lateral shot: if it never bounced on receiver court, leaving table laterally is OUT
    const receiverBounces = this.lastHitter === 1 ? this.bouncesP2 : this.bouncesP1;
    if (receiverBounces === 0 && isBelowTable && isOutsideX) {
      this.deadBallTimer = 0;
      return true;
    }

    // Dead ball safety: If ball comes to a complete rest on the table for > 1.2s after bouncing
    if (dt > 0 && this.physics && (this.bouncesP1 >= 1 || this.bouncesP2 >= 1)) {
      const speed = this.physics.ballBody.velocity.length();
      if (speed < 0.06 && ballPos.y < TABLE_HEIGHT + 0.10) {
        this.deadBallTimer = (this.deadBallTimer || 0) + dt;
        if (this.deadBallTimer > 1.2) {
          this.deadBallTimer = 0;
          return true;
        }
      } else {
        this.deadBallTimer = 0;
      }
    }

    return false;
  }

  /**
   * Called strictly when the ball has physically left the table.
   * Decides winner based on where the ball bounced prior to leaving.
   */
  handleBallLeftTable() {
    if (this.multiplayer.role === 'client') return;
    if (this.state !== GAME_STATES.RALLY) return;

    // Serve phase resolution
    if (this.isServiceInProgress) {
      this.isServiceInProgress = false;
      if (this.physics) this.physics.isServeFlight = false;

      // Net clip during serve
      if (this.netHitDuringServe) {
        this.netHitDuringServe = false;
        const landedOnBoth =
          this.server === 1
            ? this.bouncesP1 >= 1 && this.bouncesP2 >= 1
            : this.bouncesP2 >= 1 && this.bouncesP1 >= 1;
        if (landedOnBoth) {
          this.onActionToast('LET - RE-SERVE');
          this.resetRally(this.server);
          return;
        }
      }

      if (this.server === 1) {
        // Player 1 served: must have bounced on P1 side and P2 side
        if (this.bouncesP1 >= 1 && this.bouncesP2 >= 1) {
          this.awardPoint(1, 'WINNER');
        } else {
          this.awardPoint(2, 'FAULT');
        }
      } else {
        // CPU served: must have bounced on P2 side and P1 side
        if (this.bouncesP2 >= 1 && this.bouncesP1 >= 1) {
          this.awardPoint(2, 'WINNER');
        } else {
          this.awardPoint(1, 'FAULT');
        }
      }
      return;
    }

    // Normal rally resolution:
    if (this.lastHitter === 1) {
      // Player 1 struck the ball last
      if (this.bouncesP2 >= 1) {
        // Ball landed on Player 2's side and left without P2 returning -> P1 point
        this.awardPoint(1, 'WINNER');
      } else {
        // Ball left the table without landing on Player 2's side -> P1 hit out -> P2 point
        this.awardPoint(2, 'OUT');
      }
    } else {
      // Player 2 (CPU) struck the ball last
      if (this.bouncesP1 >= 1) {
        // Ball landed on Player 1's side and left without P1 returning -> P2 point
        this.awardPoint(2, 'WINNER');
      } else {
        // Ball left the table without landing on Player 1's side -> P2 hit out -> P1 point
        this.awardPoint(1, 'OUT');
      }
    }
  }

  handleFloorHit() {
    this.handleBallLeftTable();
  }

  /**
   * Awards point adhering strictly to official ITTF rules (Sections 2.11, 2.12, 2.13):
   * - Computes ITTF service rotation (2 serves each, 1 serve each during and after deuce).
   * - Correctly announces Deuce (10-10, 11-11, etc.) and Advantage (11-10, etc.).
   * - Signals Match Over when a player reaches >= 11 with a lead of >= 2.
   */
  awardPoint(winner, reason = 'POINT') {
    if (this.state === GAME_STATES.MATCH_OVER) return;

    this.scores[winner - 1]++;
    const p1 = this.scores[0];
    const p2 = this.scores[1];

    sound.playScore(winner === 1);
    this.server = this.computeNextServer(this.scores);
    this.onScoreUpdate(this.scores);

    // ITTF 2.11: Game won by player first scoring 11 points with at least a 2-point lead
    if ((p1 >= this.winningScore || p2 >= this.winningScore) && Math.abs(p1 - p2) >= 2) {
      this.state = GAME_STATES.MATCH_OVER;
      this.isDeuce = false;
      const champion = p1 > p2 ? 'PLAYER 1' : 'CPU';
      this.onActionToast(`MATCH OVER: ${champion} WINS (${p1}-${p2})`);
      this.onStateChange(this.state);
      this.onMatchOver({ winner: champion, scores: this.scores });
      return;
    }

    // ITTF 2.11 & 2.13.4: Deuce and Advantage announcements
    if (p1 >= 10 && p2 >= 10) {
      this.isDeuce = true;
      if (p1 === p2) {
        this.onActionToast(`DEUCE (${p1}-${p2})`);
      } else if (p1 > p2) {
        this.onActionToast(`ADVANTAGE P1 (${p1}-${p2})`);
      } else {
        this.onActionToast(`ADVANTAGE CPU (${p1}-${p2})`);
      }
    } else {
      this.isDeuce = false;
      const winnerName = winner === 1 ? 'P1' : 'CPU';
      this.onActionToast(`${winnerName} ${reason} (${p1}-${p2})`);
    }

    this.resetRally(this.server);
  }

  setDifficulty(level) {
    if (this.difficultyConfigs && this.difficultyConfigs[level]) {
      this.difficulty = level;
    }
  }

  /**
   * Dynamic Serve Execution:
   * Maps Player 1's actual paddle position & swing velocity to launch angles, pace, and spin curve!
   * When CPU serves, CPU strategically selects challenging corner angles, fast drives, and curving slices!
   */
  serve(customP1Pos = null, customP1Vel = null) {
    if (this.state !== GAME_STATES.SERVE_WAIT) return;
    this.state = GAME_STATES.RALLY;
    this.isServiceInProgress = true;
    this.bouncesP1 = 0;
    this.bouncesP2 = 0;
    this.lastHitter = this.server;
    this.rallyLength = 0;

    if (this.server === 1) {
      const p1Pos = customP1Pos || this.lastP1Pos;
      const p1Vel = customP1Vel || this.lastP1Vel;

      const startX = THREE.MathUtils.clamp(p1Pos.x, -0.45, 0.45);
      // Direction control: moving paddle right aims right
      const targetVx = THREE.MathUtils.clamp(p1Vel.x * 0.35 + (p1Pos.x * 0.35), -0.50, 0.50);
      // Guaranteed powerful legal serve arc clearing the net by > 12cm
      const paceVz = THREE.MathUtils.clamp(2.75 + Math.max(0, p1Vel.z) * 0.25, 2.75, 3.10);
      const vy = -0.66;

      this.physics.serveBall(1, { startX, targetVx, paceVz, vy });

      let dirDesc = 'CENTER';
      if (targetVx < -0.2) dirDesc = 'CROSS-RIGHT';
      else if (targetVx > 0.2) dirDesc = 'CROSS-LEFT';
      this.onActionToast(`P1 SERVE: ${dirDesc}`);
    } else {
      // CPU Tactical Serves:
      // Direct straight-line trajectories along tactical angles scaled to difficulty
      const config = this.difficultyConfigs[this.difficulty] || this.difficultyConfigs.medium;
      const paceFactor = config.servePace / 2.75;
      const cpuServes = [
        { name: 'CROSS FOREHAND', startX: -0.22, targetVx: 0.35, paceVz: 2.75 * paceFactor, vy: -0.66 },
        { name: 'CROSS BACKHAND', startX: 0.22, targetVx: -0.35, paceVz: 2.75 * paceFactor, vy: -0.66 },
        { name: 'POWER DRIVE', startX: 0.0, targetVx: 0.0, paceVz: 2.80 * paceFactor, vy: -0.68 },
        { name: 'FAST ANGLE', startX: 0.16, targetVx: -0.25, paceVz: 2.70 * paceFactor, vy: -0.65 },
      ];
      const choice = cpuServes[Math.floor(Math.random() * cpuServes.length)];
      this.physics.serveBall(2, choice);
      this.onActionToast(`CPU SERVE: ${choice.name}`);
    }

    this.onStateChange(this.state);
  }

  resetRally(server = 1) {
    this.server = server;
    this.state = GAME_STATES.SERVE_WAIT;
    this.isServiceInProgress = true;
    this.netHitDuringServe = false;
    this.deadBallTimer = 0;
    this.bouncesP1 = 0;
    this.bouncesP2 = 0;
    this.rallyLength = 0;
    this.aiServeTimer = 0.65;

    const padPos = this.server === 1 ? this.scene.paddle1.position : this.scene.paddle2.position;
    this.physics.holdBallForServe(this.server, padPos);

    this.onStateChange(this.state);
  }

  resetBall() {
    this.resetRally(this.server);
    this.onActionToast('BALL RESET');
  }

  restartMatch() {
    this.scores = [0, 0];
    this.initialServer = 1;
    this.server = this.initialServer;
    this.isDeuce = false;
    this.smashEnergy = [0, 0];
    this.isHyperSmashActive = [false, false];
    this.resetRally(this.server);
    this.onScoreUpdate(this.scores);
    this.onActionToast('NEW MATCH STARTED');
  }

  /**
   * Smart CPU AI:
   * Dynamically intercepts the ball by stepping forward over the table to strike on the rise,
   * completely preventing double-bounces!
   */
  updateAI(dt) {
    if (!this.aiEnabled || this.multiplayer.isConnected) return;

    const ballPos = this.physics.ballBody.position;
    const ballVel = this.physics.ballBody.velocity;

    // 1. CPU Serving flow
    if (this.state === GAME_STATES.SERVE_WAIT && this.server === 2) {
      this.aiServeTimer -= dt;
      if (this.aiServeTimer <= 0) {
        this.aiTargetPos.z = 1.30;
        this.serve();
      } else {
        this.aiTargetPos.set(0, 0.95, 1.44);
      }
      return;
    }

    // 2. Rally Tracking & Strategic Interception
    const config = this.difficultyConfigs[this.difficulty] || this.difficultyConfigs.medium;

    if (ballVel.z > 0 && ballPos.z > -0.35) {
      if (this.aiReactionTimer > 0) {
        this.aiReactionTimer -= dt;
      }

      // Step forward to meet the ball cleanly on the rise (only step forward after ball bounces to prevent illegal volleys)
      const minZ = this.bouncesP2 >= 1 ? 0.75 : 1.28;
      const interceptZ = THREE.MathUtils.clamp(ballPos.z + 0.18, Math.max(minZ, config.interceptRise), 1.42);
      const distZ = Math.max(0.04, interceptZ - ballPos.z);
      const timeToIntercept = distZ / Math.max(1.0, ballVel.z);

      // Strategic corner/placement aiming: aim away from player position with cornerDriveRate probability!
      const p1X = this.scene.paddle1 ? this.scene.paddle1.position.x : 0;
      const willCornerDrive = Math.random() < config.cornerDriveRate;
      if (willCornerDrive) {
        if (p1X < -0.10) {
          this.aiShotTargetX = 0.42; // Player on right, drive cross-court left
        } else if (p1X > 0.10) {
          this.aiShotTargetX = -0.42; // Player on left, drive cross-court right
        } else {
          this.aiShotTargetX = this.aiShotTargetX > 0 ? -0.38 : 0.38;
        }
      } else {
        // Return towards center or slight angle
        this.aiShotTargetX = (Math.random() - 0.5) * 0.25;
      }

      const errorOffset = Math.sin(Date.now() * 0.005) * config.errorMargin;
      const targetX = THREE.MathUtils.clamp(
        ballPos.x + ballVel.x * timeToIntercept * 0.95 + errorOffset,
        -TABLE_WIDTH * 0.45,
        TABLE_WIDTH * 0.45
      );
      const targetY = THREE.MathUtils.clamp(
        ballPos.y,
        TABLE_HEIGHT + 0.08,
        TABLE_HEIGHT + 0.40
      );

      this.aiTargetPos.x = targetX;
      this.aiTargetPos.y = targetY;
      this.aiTargetPos.z = interceptZ;

      // Track target yaw angle towards open court target
      const desiredYaw = THREE.MathUtils.clamp((this.aiShotTargetX - targetX) * 0.55, -0.42, 0.42);
      this.aiCurrentYaw += (desiredYaw - this.aiCurrentYaw) * Math.min(1.0, dt * (8.0 * config.swingPower));

      // When ball is in strike zone, execute an assertive forward swing through the ball!
      if (distZ < 0.35 && this.aiSwingTimer <= 0) {
        this.aiSwingTimer = 0.22;
      }
    } else {
      this.aiTargetPos.set(0, 0.95, 1.44);
      this.aiCurrentYaw *= Math.max(0, 1 - dt * 4.0);
      this.aiReactionTimer = config.reactionDelay;
    }

    if (this.aiSwingTimer > 0) {
      this.aiSwingTimer -= dt;
      // Drive forward through the ball with power
      this.aiTargetPos.z = Math.max(1.10, this.aiTargetPos.z - (0.25 * config.swingPower));
    }

    const aiSpeed = config.aiSpeed; // Responsive athletic movement scaling with difficulty
    this.aiCurrentPos.x += (this.aiTargetPos.x - this.aiCurrentPos.x) * Math.min(1.0, dt * aiSpeed);
    this.aiCurrentPos.y += (this.aiTargetPos.y - this.aiCurrentPos.y) * Math.min(1.0, dt * aiSpeed);
    this.aiCurrentPos.z += (this.aiTargetPos.z - this.aiCurrentPos.z) * Math.min(1.0, dt * (aiSpeed * 1.5));

    const aiRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + this.aiCurrentYaw, 0));
    const aiVel = new THREE.Vector3(0, 0, (this.aiTargetPos.z - this.aiCurrentPos.z) * 10 * config.swingPower);
    this.physics.updatePaddle2(this.aiCurrentPos, aiRot, aiVel);
  }

  update(dt, localPaddleTransform) {
    const isHost = this.multiplayer.role !== 'client';

    if (isHost) {
      if (localPaddleTransform) {
        this.lastP1Pos.copy(localPaddleTransform.position);
        this.lastP1Vel.copy(localPaddleTransform.velocity);

        // Physical paddle
        this.physics.updatePaddle1(
          localPaddleTransform.position,
          localPaddleTransform.quaternion,
          localPaddleTransform.velocity
        );

        // In the render loop, interpolate (lerp) the local player's paddle position toward tracking target at 60 FPS
        const lerpFactor = Math.min(1.0, 35.0 * dt);
        this.scene.paddle1.position.lerp(localPaddleTransform.position, lerpFactor);
        this.scene.paddle1.quaternion.slerp(localPaddleTransform.quaternion, lerpFactor);
      }

      // Update Player 2 (Remote Multiplayer Client or CPU AI)
      if (this.multiplayer.isConnected && (this.hasRemoteInput || this.clientP2Input)) {
        // Apply linear (lerp) & spherical (slerp) interpolation across incoming network ticks
        const lerpFactor = Math.min(1.0, 25.0 * dt);
        this.scene.paddle2.position.lerp(this.remoteTargetPos, lerpFactor);
        this.scene.paddle2.quaternion.slerp(this.remoteTargetRot, lerpFactor);
        this.physics.updatePaddle2(
          this.scene.paddle2.position,
          this.scene.paddle2.quaternion,
          this.remoteTargetVel
        );
      } else {
        this.updateAI(dt);
        this.scene.paddle2.position.copy(this.aiCurrentPos);
        this.scene.paddle2.quaternion.setFromEuler(new THREE.Euler(0, Math.PI + this.aiCurrentYaw, 0));
      }

      // Physics Step & Serve Handling
      if (this.state === GAME_STATES.SERVE_WAIT) {
        if (this.server === 1) {
          const p1Pos = this.scene.paddle1.position;
          const hoverX = THREE.MathUtils.clamp(p1Pos.x, -0.45, 0.45);
          const ballZ = -1.05;
          this.physics.ballBody.position.set(hoverX, TABLE_HEIGHT + 0.22, ballZ);
          this.physics.ballBody.velocity.set(0, 0, 0);
          this.physics.ballBody.angularVelocity.set(0, 0, 0);
          this.physics.ballBody.collisionResponse = false;

          // Strike serve requires paddle to be strictly BEHIND the ball (p1Pos.z < ballZ - 0.02)
          // and swinging FORWARD (+Z) with the FRONT face of the racket
          const isBehindBall = p1Pos.z < ballZ - 0.02;
          const isMovingForward = localPaddleTransform ? localPaddleTransform.velocity.z > 0.45 : false;
          const distToBall = Math.hypot(p1Pos.x - hoverX, p1Pos.y - (TABLE_HEIGHT + 0.22), p1Pos.z - ballZ);
          const isStrikeServe = isBehindBall && distToBall < 0.22 && isMovingForward;
          const isOpenHandServe = localPaddleTransform ? localPaddleTransform.justOpenedHand : false;

          if (isOpenHandServe || isStrikeServe) {
            this.serve(p1Pos, localPaddleTransform ? localPaddleTransform.velocity : null);
          }
        } else {
          this.physics.holdBallForServe(this.server, this.scene.paddle2.position);
        }
      } else {
        const p1Pos = this.scene.paddle1.position;
        const p1Vel = localPaddleTransform ? localPaddleTransform.velocity : new THREE.Vector3();
        const p1Yaw = localPaddleTransform ? (localPaddleTransform.yaw || 0) : 0;
        const p2Pos = this.scene.paddle2.position;
        const p2Vel = new THREE.Vector3(0, 0, (this.aiTargetPos.z - this.aiCurrentPos.z) * 10);
        const p2Yaw = this.aiCurrentYaw || 0;

        const config = this.difficultyConfigs[this.difficulty] || this.difficultyConfigs.medium;
        this.physics.step(dt, p1Pos, p1Vel, p1Yaw, p2Pos, p2Vel, p2Yaw, this.aiShotTargetX, config.returnPower);

        if (this.isBallOffTable(this.physics.ballBody.position, dt)) {
          this.handleBallLeftTable();
        }
      }

      // Sync ball visual position
      this.scene.ball.position.copy(this.physics.ballBody.position);
      this.scene.ball.quaternion.copy(this.physics.ballBody.quaternion);

      // High-performance flat binary array multiplayer broadcast (TAG_TT_SYNC = 1.0)
      if (this.multiplayer.isConnected) {
        const bPos = this.physics.ballBody.position;
        const bVel = this.physics.ballBody.velocity;
        const p1Pos = this.scene.paddle1.position;
        const p1Rot = this.scene.paddle1.quaternion;

        this.syncBuffer[0] = 1.0; // TAG_TT_SYNC
        this.syncBuffer[1] = bPos.x;
        this.syncBuffer[2] = bPos.y;
        this.syncBuffer[3] = bPos.z;
        this.syncBuffer[4] = bVel.x;
        this.syncBuffer[5] = bVel.y;
        this.syncBuffer[6] = bVel.z;
        this.syncBuffer[7] = p1Pos.x;
        this.syncBuffer[8] = p1Pos.y;
        this.syncBuffer[9] = p1Pos.z;
        this.syncBuffer[10] = p1Rot.x;
        this.syncBuffer[11] = p1Rot.y;
        this.syncBuffer[12] = p1Rot.z;
        this.syncBuffer[13] = p1Rot.w;
        this.syncBuffer[14] = this.scores[0];
        this.syncBuffer[15] = this.scores[1];
        this.syncBuffer[16] = this.server;
        this.syncBuffer[17] = this.state === GAME_STATES.SERVE_WAIT ? 0 : (this.state === GAME_STATES.RALLY ? 1 : 2);
        this.syncBuffer[18] = this.smashEnergy[0];
        this.syncBuffer[19] = this.smashEnergy[1];
        this.syncBuffer[20] = performance.now();
        this.syncBuffer[21] = this.lastHitter;

        this.multiplayer.send(this.syncBuffer);
      }
    } else {
      // Client mode (P2)
      if (localPaddleTransform) {
        // In the render loop, interpolate (lerp) the local player's paddle position toward tracking target at 60 FPS
        const lerpFactor = Math.min(1.0, 35.0 * dt);
        this.scene.paddle2.position.lerp(localPaddleTransform.position, lerpFactor);
        this.scene.paddle2.quaternion.slerp(localPaddleTransform.quaternion, lerpFactor);

        // High-performance flat binary array client input broadcast (TAG_TT_CLIENT_INPUT = 2.0)
        const pPos = localPaddleTransform.position;
        const pRot = localPaddleTransform.quaternion;
        const pVel = localPaddleTransform.velocity;

        this.clientInputBuffer[0] = 2.0; // TAG_TT_CLIENT_INPUT
        this.clientInputBuffer[1] = pPos.x;
        this.clientInputBuffer[2] = pPos.y;
        this.clientInputBuffer[3] = pPos.z;
        this.clientInputBuffer[4] = pRot.x;
        this.clientInputBuffer[5] = pRot.y;
        this.clientInputBuffer[6] = pRot.z;
        this.clientInputBuffer[7] = pRot.w;
        this.clientInputBuffer[8] = pVel.x;
        this.clientInputBuffer[9] = pVel.y;
        this.clientInputBuffer[10] = pVel.z;
        this.clientInputBuffer[11] = localPaddleTransform.justOpenedHand ? 2.0 : (localPaddleTransform.isHandOpen ? 1.0 : 0.0);
        this.clientInputBuffer[12] = performance.now();

        this.multiplayer.send(this.clientInputBuffer);
      }

      // Linear/Spherical interpolation for remote opponent (P1) paddle across incoming network ticks
      const remoteLerpFactor = Math.min(1.0, 25.0 * dt);
      this.scene.paddle1.position.lerp(this.remoteTargetPos, remoteLerpFactor);
      this.scene.paddle1.quaternion.slerp(this.remoteTargetRot, remoteLerpFactor);

      // Client-Side Prediction for local paddle-ball collisions
      if (this.predictedHitTimer > 0) {
        this.predictedHitTimer -= dt;
      }

      if (this.state === GAME_STATES.SERVE_WAIT) {
        this.predictedBallPos.lerp(this.clientBallTarget, Math.min(1.0, 25.0 * dt));
        this.predictedBallVel.set(0, 0, 0);
      } else {
        // Forward dead reckoning simulation
        this.predictedBallVel.y -= 9.82 * dt;
        this.predictedBallVel.multiplyScalar(Math.pow(0.992, dt * 60));
        this.predictedBallPos.addScaledVector(this.predictedBallVel, dt);

        // Table bounce prediction on receiver court (Z > 0)
        if (this.predictedBallPos.y <= TABLE_HEIGHT + 0.02 && this.predictedBallPos.z > 0 && this.predictedBallPos.z < TABLE_LENGTH / 2) {
          if (this.predictedBallVel.y < 0) {
            this.predictedBallVel.y = -this.predictedBallVel.y * 0.88;
            this.predictedBallPos.y = TABLE_HEIGHT + 0.02;
            sound.playTableBounce(Math.min(1.0, Math.abs(this.predictedBallVel.y) / 3.0));
            this.scene.triggerImpact(this.predictedBallPos, 0x00ff88);
          }
        }

        // Local paddle-ball collision prediction:
        // Client is P2 (+Z), ball moving toward client (+Z)
        const p2Pos = this.scene.paddle2.position;
        const p2Vel = localPaddleTransform ? localPaddleTransform.velocity : new THREE.Vector3();
        const dz = this.predictedBallPos.z - p2Pos.z;
        const dx = this.predictedBallPos.x - p2Pos.x;
        const dy = this.predictedBallPos.y - p2Pos.y;
        const dist = Math.hypot(dx, dy, dz);

        if (this.predictedBallVel.z > 0 && dist < 0.20 && dz < 0.08 && dz > -0.14 && this.predictedHitTimer <= 0) {
          // Instant client-side predicted return trajectory
          const swingPower = Math.hypot(p2Vel.x, p2Vel.y, p2Vel.z);
          const returnSpeed = Math.max(3.2, Math.min(6.2, 3.2 + swingPower * 0.65));
          this.predictedBallVel.z = -returnSpeed;
          this.predictedBallVel.x = (dx * -2.2) + (p2Vel.x * 0.35);
          this.predictedBallVel.y = Math.max(1.1, 0.9 + Math.abs(dy) * 1.8);

          sound.playPaddleHit(Math.min(1.0, returnSpeed / 5.0), false);
          this.scene.triggerImpact(this.predictedBallPos, 0xff2a6d);
          this.isPredictingHit = true;
          this.predictedHitTimer = 0.35;
        }

        // Smooth reconciliation toward authoritative host ball state
        const reconSpeed = (this.isPredictingHit && this.predictedBallVel.z < 0) ? 12.0 : 30.0;
        this.predictedBallPos.lerp(this.clientBallTarget, Math.min(1.0, reconSpeed * dt));
      }

      this.scene.ball.position.copy(this.predictedBallPos);
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
            this.remoteTargetPos.set(packet[1], packet[2], packet[3]);
            this.clientBallTarget.set(packet[4], packet[5], packet[6]);
          } else if (this.multiplayer.role === 'host') {
            this.remoteTargetPos.set(packet[1], packet[2], packet[3]);
            this.hasRemoteInput = true;
          }
        } else if (tag === 2.0) { // SCORE_UPDATE
          this.scores = [packet[1], packet[2]];
          this.server = packet[3];
          const stateCode = packet[4];
          this.state = stateCode === 0 ? GAME_STATES.SERVE_WAIT : (stateCode === 1 ? GAME_STATES.RALLY : GAME_STATES.MATCH_OVER);
          this.onScoreUpdate(this.scores);
          this.onStateChange(this.state);
        } else if (tag === 3.0) { // COLLISION_EVENT
          const colType = packet[1];
          const impactPos = new THREE.Vector3(packet[2], packet[3], packet[4]);
          if (colType === 1.0) {
            sound.playPaddleHit(0.8, false);
            if (this.scene && this.scene.triggerImpact) this.scene.triggerImpact(impactPos, 0xd4a03c);
          } else if (colType === 2.0) {
            sound.playTableBounce(0.8);
            if (this.scene && this.scene.triggerImpact) this.scene.triggerImpact(impactPos, 0x00ff88);
          }
        }
        return;
      }

      if (tag === 1.0 && this.multiplayer.role === 'client') {
        // TAG_TT_SYNC (22 floats)
        this.clientBallTarget.set(packet[1], packet[2], packet[3]);
        if (!this.isPredictingHit || packet[6] < 0) {
          this.predictedBallVel.set(packet[4], packet[5], packet[6]);
          if (packet[6] < 0) this.isPredictingHit = false;
        }

        // Linear/spherical interpolation target for remote P1 paddle
        this.remoteTargetPos.set(packet[7], packet[8], packet[9]);
        this.remoteTargetRot.set(packet[10], packet[11], packet[12], packet[13]);

        this.scores = [packet[14], packet[15]];
        this.server = packet[16];
        const stateCode = packet[17];
        this.state = stateCode === 0 ? GAME_STATES.SERVE_WAIT : (stateCode === 1 ? GAME_STATES.RALLY : GAME_STATES.MATCH_OVER);
        this.smashEnergy = [packet[18], packet[19]];

        this.onScoreUpdate(this.scores);
        this.onStateChange(this.state);
      } else if (tag === 2.0 && this.multiplayer.role === 'host') {
        // TAG_TT_CLIENT_INPUT (13 floats)
        this.remoteTargetPos.set(packet[1], packet[2], packet[3]);
        this.remoteTargetRot.set(packet[4], packet[5], packet[6], packet[7]);
        this.remoteTargetVel.set(packet[8], packet[9], packet[10]);
        this.hasRemoteInput = true;
        this.clientP2HandState = packet[11];
      }
      return;
    }

    // Legacy JSON object support
    if (packet.type === 'sync' && this.multiplayer.role === 'client') {
      if (!this.clientBallTarget) this.clientBallTarget = new THREE.Vector3();
      this.clientBallTarget.set(packet.ball.x, packet.ball.y, packet.ball.z);
      this.remoteTargetPos.set(...packet.p1.pos);
      this.remoteTargetRot.set(...packet.p1.rot);

      this.scores = packet.scores;
      this.server = packet.server;
      this.state = packet.state;
      this.smashEnergy = packet.smash;

      this.onScoreUpdate(this.scores);
      this.onStateChange(this.state);
    } else if (packet.type === 'client_input' && this.multiplayer.role === 'host') {
      this.clientP2Input = packet;
      if (packet.pos) this.remoteTargetPos.set(...packet.pos);
      if (packet.rot) this.remoteTargetRot.set(...packet.rot);
      this.hasRemoteInput = true;
    }
  }
}
