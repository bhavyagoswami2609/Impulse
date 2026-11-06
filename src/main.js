import confetti from 'canvas-confetti';
import { TableTennisScene } from './graphics/scene.js';
import { PhysicsWorld } from './physics/physics_world.js';
import { AirHockeyPhysics } from './physics/air_hockey_physics.js';
import { HandTracker } from './tracking/hand_tracker.js';
import { FaceTracker } from './tracking/face_tracker.js';
import { MultiplayerManager } from './network/multiplayer.js';
import { TableTennisGame, GAME_STATES } from './game/table_tennis_game.js';
import { AirHockeyGame, AIR_HOCKEY_STATES } from './game/air_hockey_game.js';
import { StateController, APP_STATES } from './ui/state_controller.js';
import { sound } from './audio/sound_effects.js';

class TableTennisApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    window.app = window.gameApp = window.__tableTennisApp = this;

    // 1. Initialize 3D Graphics Scene
    this.scene = new TableTennisScene(this.container);

    // 2. Initialize Physics Engines
    this.physics = new PhysicsWorld();
    this.hockeyPhysics = new AirHockeyPhysics();

    // Default discipline is Air Hockey (Card 1 active outline)
    this.gameMode = 'hockey';
    this.scene.setGameMode('hockey');

    // 3. Initialize WebRTC Multiplayer (PeerJS with binary packets & raw serialization)
    this.multiplayer = new MultiplayerManager({
      onConnected: this.onPeerConnected.bind(this),
      onDisconnected: this.onPeerDisconnected.bind(this),
      onDataReceived: (packet) => {
        if (packet instanceof Float32Array) {
          const tag = packet[0];
          if (this.gameMode === 'hockey' || tag === 3.0 || tag === 4.0) {
            this.hockeyGame.handleNetworkData(packet);
          } else {
            this.game.handleNetworkData(packet);
          }
          return;
        }
        if (packet && packet.type && packet.type.startsWith('hockey')) {
          this.hockeyGame.handleNetworkData(packet);
        } else {
          this.game.handleNetworkData(packet);
        }
      },
      onStatusChange: (status, msg) => this.updateMultiplayerStatus(status, msg),
    });

    // 4. Initialize MediaPipe Hand Tracker (Decoupled boot pipeline: does NOT auto-boot straight into gameplay)
    this.tracker = new HandTracker({
      gameMode: this.gameMode,
      videoElement: document.getElementById('webcam-video'),
      canvasElement: document.getElementById('webcam-canvas'),
      onStatusChange: this.onTrackingStatusChange.bind(this),
      onCalibrationUpdate: this.onCalibrationUpdate.bind(this),
      onGestureCalibrate: () => {
        this.triggerFullCalibration(true);
      },
    });

    // 4b. Initialize Face Tracker for VR Parallax Perspective
    this.faceTracker = new FaceTracker({
      videoElement: document.getElementById('webcam-video'),
      canvasElement: document.getElementById('webcam-canvas'),
      onStatusChange: () => {},
    });

    // 5. Initialize Table Tennis Game Rules & Logic
    this.game = new TableTennisGame({
      scene: this.scene,
      physics: this.physics,
      multiplayer: this.multiplayer,
      onStateChange: (st) => {
        if (this.gameMode === 'tennis') this.onGameStateChange(st);
      },
      onScoreUpdate: (sc) => {
        if (this.gameMode === 'tennis') this.onScoreUpdate(sc);
      },
      onActionToast: (msg) => {
        if (this.stateController) this.stateController.showToast(msg);
      },
      onMatchOver: this.onMatchOver.bind(this),
    });

    // 6. Initialize Air Hockey Game Rules & Logic
    this.hockeyGame = new AirHockeyGame({
      scene: this.scene,
      physics: this.hockeyPhysics,
      multiplayer: this.multiplayer,
      onStateChange: (st) => {
        if (this.gameMode === 'hockey') this.onGameStateChange(st);
      },
      onScoreUpdate: (sc) => {
        if (this.gameMode === 'hockey') this.onScoreUpdate(sc);
      },
      onActionToast: (msg) => {
        if (this.stateController) this.stateController.showToast(msg);
      },
      onMatchOver: this.onMatchOver.bind(this),
    });

    this.lastTime = performance.now();
    this.currentCameraView = 'host';
    this.botDifficulty = 'medium';

    // 7. Initialize State Controller (Menu, Calibration Gate, HUD, Pause Flow)
    this.stateController = new StateController(this);

    // 8. Background 3D Canvas starts in Idle Camera Orbit around the selected table
    this.scene.setOrbit(true);

    // 9. Check for Room ID in URL parameters
    this.checkUrlParams();

    // 10. Start Animation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  showActionToast(msg) {
    if (this.stateController) {
      this.stateController.showToast(msg);
    }
  }

  setGameMode(mode) {
    if (mode !== 'tennis' && mode !== 'hockey') return;
    this.gameMode = mode;
    this.scene.setGameMode(mode);

    if (this.tracker) {
      this.tracker.setGameMode(mode);
    }

    if (this.stateController && this.stateController.discipline !== mode) {
      this.stateController.setDiscipline(mode);
    }

    const activeGame = mode === 'hockey' ? this.hockeyGame : this.game;
    this.onScoreUpdate(activeGame.scores);
    this.onGameStateChange(activeGame.state);
  }

  setBotDifficulty(level) {
    if (!['easy', 'medium', 'hard'].includes(level)) return;
    this.botDifficulty = level;

    if (this.game && typeof this.game.setDifficulty === 'function') {
      this.game.setDifficulty(level);
    }
    if (this.hockeyGame && typeof this.hockeyGame.setDifficulty === 'function') {
      this.hockeyGame.setDifficulty(level);
    }
  }

  cycleBotDifficulty() {
    const cycle = { easy: 'medium', medium: 'hard', hard: 'easy' };
    const nextLevel = cycle[this.botDifficulty] || 'medium';
    this.setBotDifficulty(nextLevel);
    if (this.stateController) {
      this.stateController.setDifficulty(nextLevel);
    }
  }

  triggerFullCalibration(isGesture = false) {
    sound.ensureContext();
    if (sound && sound.playCalibrate) {
      sound.playCalibrate();
    }

    // 1. Calibrate Hand Tracker neutral center
    if (this.tracker) {
      this.tracker.setNeutralCenter();
    }

    // 2. Calibrate Face Tracker neutral position
    if (this.faceTracker) {
      this.faceTracker.setNeutralCenter();
    }

    if (this.stateController) {
      this.stateController.showToast(isGesture ? 'Gesture Calibrated' : 'Calibrated');
    }
  }

  onTrackingStatusChange(info) {
    const isTracked = info.status === 'active';
    if (this.stateController) {
      this.stateController.updateTrackingStatus(isTracked);
      this.stateController.updateCameraUI(isTracked);
    }
    if (isTracked) {
      if (this.faceTracker && !this.faceTracker.isTracking) {
        this.faceTracker.startTracking();
      }
    } else {
      if (this.faceTracker && this.faceTracker.isTracking) {
        this.faceTracker.stopTracking();
      }
    }
  }

  onCalibrationUpdate(data) {
    if (data.status === 'calibrated') {
      if (this.faceTracker) {
        this.faceTracker.setNeutralCenter();
      }
      if (sound && sound.playCalibrate) {
        sound.playCalibrate();
      }
      if (this.stateController) {
        this.stateController.showToast('Calibrated');
      }
    }
  }

  onGameStateChange(state) {
    const isHockey = this.gameMode === 'hockey';
    const activeGame = isHockey ? this.hockeyGame : this.game;
    const isServeWait = isHockey
      ? state === AIR_HOCKEY_STATES.SERVE_WAIT
      : state === GAME_STATES.SERVE_WAIT;

    const servePrompt = document.getElementById('serve-prompt');
    if (servePrompt) {
      if (isServeWait) {
        servePrompt.style.display = 'block';
        const serverNum = (activeGame && activeGame.server) ? activeGame.server : 1;
        if (serverNum === 1) {
          servePrompt.textContent = isHockey
            ? 'Your Puck Serve - Strike Puck to Serve'
            : 'Open Hand or Swing Paddle to Serve';
        } else {
          servePrompt.textContent = 'Opponent Serving...';
        }
      } else {
        servePrompt.style.display = 'none';
      }
    }
  }

  onScoreUpdate(scores) {
    const isHockey = this.gameMode === 'hockey';
    const activeGame = isHockey ? this.hockeyGame : this.game;
    const serverNum = (activeGame && activeGame.server) ? activeGame.server : 1;

    if (this.stateController && scores) {
      this.stateController.updateHUD(scores[0], scores[1], serverNum);
    }
  }

  onMatchOver(result) {
    const isPlayerWinner = result.winner === 'PLAYER 1';
    if (isPlayerWinner) {
      sound.playMatchVictory();
      this.triggerVictoryCelebration();
    } else {
      sound.playMatchDefeat();
    }

    if (this.stateController) {
      this.stateController.onMatchConcluded(result);
    }
  }

  triggerVictoryCelebration() {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
    });
    setTimeout(() => {
      confetti({
        particleCount: 80,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
      });
      confetti({
        particleCount: 80,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
      });
    }, 320);
  }

  joinAsClient(code) {
    this.multiplayer.joinRoom(code);
    this.tracker.setPlayerRole('client');
    this.scene.setViewMode('client');
    this.currentCameraView = 'client';

    if (this.stateController) {
      this.stateController.setMatchMode('online');
      if (this.stateController.hudP1Label) this.stateController.hudP1Label.textContent = 'Host';
      if (this.stateController.hudP2Label) this.stateController.hudP2Label.textContent = 'You (Client)';
    }
  }

  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const roleParam = params.get('role');

    if (roomParam && roleParam === 'client') {
      setTimeout(() => {
        this.joinAsClient(roomParam);
        if (this.stateController) {
          this.stateController.showToast(`Joining Room ${roomParam}`);
        }
      }, 500);
    }
  }

  onPeerConnected(role) {
    if (this.stateController) {
      this.stateController.showToast(role === 'host' ? 'Opponent Connected' : 'Connected to Host');
      if (role === 'host') {
        if (this.stateController.hudP2Label) this.stateController.hudP2Label.textContent = 'Player 2';
      }
    }
    sound.playScore(true);
  }

  onPeerDisconnected() {
    if (this.stateController) {
      this.stateController.showToast('Peer Disconnected');
    }
  }

  updateMultiplayerStatus(status, message) {
    const statusHint = document.getElementById('online-status-hint');
    if (statusHint) {
      statusHint.textContent = message;
    }
  }

  renderPIPCanvas() {
    if (!this.tracker || !this.tracker.canvasCtx || !this.tracker.canvasElement) return;

    const canvas = this.tracker.canvasElement;
    const ctx = this.tracker.canvasCtx;
    const video = this.tracker.videoElement;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (this.tracker.isTracking && video && video.readyState >= 2) {
      try {
        ctx.drawImage(video, 0, 0, w, h);
      } catch (e) {
        ctx.fillStyle = '#0e0d0b';
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      ctx.fillStyle = '#0e0d0b';
      ctx.fillRect(0, 0, w, h);
    }

    // Render Face Parallax & Hand Skeleton on PIP
    if (this.tracker && this.tracker.isTracking) {
      const isHandActive = performance.now() - this.tracker.lastDetectedTime < 400;
      if (isHandActive && this.tracker.latestLandmarks) {
        this.tracker.drawHandSkeleton(ctx, this.tracker.latestLandmarks, w, h, this.tracker.isSpidermanActive);
      }
      if (this.faceTracker && this.faceTracker.isTracking) {
        this.faceTracker.drawPIPOverlay(ctx, w, h);
      }
    }
  }

  animate(now) {
    requestAnimationFrame(this.animate);

    const deltaTime = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // 1. Update FPS counter in StateController
    if (this.stateController) {
      this.stateController.updateFPS();
    }

    const appState = this.stateController ? this.stateController.state : APP_STATES.MENU;

    // 2. Decoupled Pipeline: On Menu, game loop and physics remain paused while idle orbit runs in background
    if (appState === APP_STATES.MENU) {
      this.scene.update(deltaTime);
      this.scene.render();
      return;
    }

    // 3. Calibration Gate state: camera reticle updates while physics remains paused
    if (appState === APP_STATES.CALIBRATING) {
      if (this.stateController) {
        this.stateController.updateCalibrationProgress(deltaTime);
      }
      if (this.faceTracker && this.faceTracker.enabled) {
        const headOffset = this.faceTracker.getParallaxOffset(deltaTime);
        const headYaw = this.faceTracker.getYaw(deltaTime);
        this.scene.setHeadParallaxOffset(headOffset, headYaw);
      }
      this.scene.update(deltaTime);
      this.scene.render();
      return;
    }

    // 4. Paused state: 3D physics paused
    if (appState === APP_STATES.PAUSED) {
      this.scene.render();
      return;
    }

    // 5. Active PLAYING state: full 3D physics & real-time gesture tracking
    const localPaddleTransform = this.tracker.getTransform(deltaTime);

    // Update Face Tracking Parallax Offset
    if (this.faceTracker && this.faceTracker.enabled) {
      const headOffset = this.faceTracker.getParallaxOffset(deltaTime);
      const headYaw = this.faceTracker.getYaw(deltaTime);
      this.scene.setHeadParallaxOffset(headOffset, headYaw);
    }

    // Render PIP Viewfinder
    this.renderPIPCanvas();

    // Update active game physics
    if (this.gameMode === 'hockey') {
      this.hockeyGame.update(deltaTime, localPaddleTransform);
    } else {
      this.game.update(deltaTime, localPaddleTransform);
    }

    // Update Scene graphics effects & shadows
    this.scene.update(deltaTime);

    // Render Three.js frame
    this.scene.render();
  }
}

// Instantiate application on DOM readiness
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = window.gameApp = new TableTennisApp();
  });
} else {
  window.app = window.gameApp = new TableTennisApp();
}
