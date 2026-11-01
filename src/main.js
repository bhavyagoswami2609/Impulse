import confetti from 'canvas-confetti';
import { TableTennisScene } from './graphics/scene.js';
import { PhysicsWorld } from './physics/physics_world.js';
import { AirHockeyPhysics } from './physics/air_hockey_physics.js';
import { HandTracker } from './tracking/hand_tracker.js';
import { FaceTracker } from './tracking/face_tracker.js';
import { MultiplayerManager } from './network/multiplayer.js';
import { TableTennisGame, GAME_STATES } from './game/table_tennis_game.js';
import { AirHockeyGame, AIR_HOCKEY_STATES } from './game/air_hockey_game.js';
import { sound } from './audio/sound_effects.js';

class TableTennisApp {
  constructor() {
    this.container = document.getElementById('canvas-container');

    // 1. Initialize 3D Graphics
    this.scene = new TableTennisScene(this.container);

    // 2. Initialize Physics Engines
    this.physics = new PhysicsWorld();
    this.hockeyPhysics = new AirHockeyPhysics();

    // Game Mode ('tennis' or 'hockey')
    this.gameMode = 'tennis';

    // 3. Initialize WebRTC Multiplayer (PeerJS)
    this.multiplayer = new MultiplayerManager({
      onConnected: this.onPeerConnected.bind(this),
      onDisconnected: this.onPeerDisconnected.bind(this),
      onDataReceived: (packet) => {
        if (packet && packet.type && packet.type.startsWith('hockey')) {
          this.hockeyGame.handleNetworkData(packet);
        } else {
          this.game.handleNetworkData(packet);
        }
      },
      onStatusChange: (status, msg) => this.updateMultiplayerStatus(status, msg),
    });

    // 4. Initialize MediaPipe Hand Tracker
    this.tracker = new HandTracker({
      videoElement: document.getElementById('webcam-video'),
      canvasElement: document.getElementById('webcam-canvas'),
      onStatusChange: this.onTrackingStatusChange.bind(this),
      onCalibrationUpdate: this.onCalibrationUpdate.bind(this),
    });

    // 4b. Initialize Face Tracker for VR Holographic Head Tracking Perspective
    this.faceTracker = new FaceTracker({
      videoElement: document.getElementById('webcam-video'),
      canvasElement: document.getElementById('webcam-canvas'),
      onStatusChange: () => this.syncHUD(),
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
      onActionToast: this.showActionToast.bind(this),
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
      onActionToast: this.showActionToast.bind(this),
      onMatchOver: this.onMatchOver.bind(this),
    });

    this.lastTime = performance.now();
    this.currentCameraView = 'host';
    this.hasStarted = true;

    // 7. Bind DOM UI Elements & Hotkeys
    this.bindUI();

    // 8. Check for Room ID in URL parameters
    this.checkUrlParams();

    // 9. Sync HUD to initial settings
    this.syncHUD();

    // 10. Start Game Animation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    // 11. Auto-start webcam tracking by default
    this.startDefaultWebcam();
  }

  syncHUD() {
    // 1. Top HUD Mode Switcher Pills
    const isTennis = this.gameMode === 'tennis';
    const btnModeTennis = document.getElementById('btn-mode-tennis');
    const btnModeHockey = document.getElementById('btn-mode-hockey');
    if (btnModeTennis) btnModeTennis.classList.toggle('active', isTennis);
    if (btnModeHockey) btnModeHockey.classList.toggle('active', !isTennis);

    // 2. Webcam state
    const isCamTracking = Boolean(this.tracker && this.tracker.isTracking);
    const isCamStarting = Boolean(this.tracker && this.tracker.isStarting);
    const isCamOn = isCamTracking || isCamStarting;

    // HUD Webcam Toggle
    const btnCam = document.getElementById('btn-toggle-cam');
    const camBtnText = document.getElementById('cam-btn-text');
    if (btnCam) {
      btnCam.classList.toggle('active', isCamOn);
    }
    if (camBtnText) {
      if (isCamStarting) {
        camBtnText.textContent = 'WEBCAM: STARTING...';
      } else {
        camBtnText.textContent = isCamTracking ? 'WEBCAM: ON' : 'WEBCAM: OFF';
      }
    }

    // PIP Status
    const dot = document.getElementById('tracking-status-dot');
    const statusText = document.getElementById('tracking-status-text');
    if (dot) {
      dot.className = `status-indicator-dot ${isCamOn ? 'active' : ''}`;
    }
    if (statusText) {
      if (isCamStarting) {
        statusText.textContent = 'STARTING WEBCAM...';
      } else if (isCamTracking) {
        statusText.textContent = 'INPUT: WEBCAM';
      } else {
        statusText.textContent = 'INPUT: MOUSE';
      }
    }

    // 3. Face Tracking (Head VR Perspective) state
    const isFaceTracking = Boolean(this.faceTracker && this.faceTracker.enabled);
    const btnFaceTrack = document.getElementById('btn-toggle-facetrack');
    const faceTrackBtnText = document.getElementById('facetrack-btn-text');
    if (btnFaceTrack) {
      btnFaceTrack.classList.toggle('vr-active', isFaceTracking);
    }
    if (faceTrackBtnText) {
      faceTrackBtnText.textContent = isFaceTracking ? 'HEAD VR: ON' : 'HEAD VR: OFF';
    }

    // 4. Audio state
    const isSoundOn = Boolean(sound && sound.enabled);
    const btnSound = document.getElementById('btn-toggle-sound');
    const soundIcon = document.getElementById('sound-icon');
    if (btnSound) {
      btnSound.classList.toggle('active', isSoundOn);
    }
    if (soundIcon) {
      soundIcon.textContent = isSoundOn ? 'AUDIO ON' : 'AUDIO OFF';
    }

    // 5. Invert X
    const chkInvertX = document.getElementById('chk-invert-x');
    const isInvert = Boolean(this.tracker && this.tracker.invertX);
    if (chkInvertX) chkInvertX.checked = isInvert;
  }

  async startDefaultWebcam() {
    this.syncHUD();
    const success = await this.tracker.startWebcamTracking();
    this.syncHUD();
    if (success) {
      this.showActionToast('WEBCAM TRACKING ACTIVE');
      if (this.faceTracker && this.faceTracker.enabled) {
        this.faceTracker.startTracking();
      }
    } else {
      const err = this.tracker.lastError;
      if (err && err.type === 'not_allowed') {
        this.showActionToast('CAMERA PERMISSION DENIED - MOUSE ACTIVE');
      } else if (err && err.type === 'not_found') {
        this.showActionToast('NO WEBCAM DETECTED - MOUSE ACTIVE');
      } else if (err && err.type === 'not_readable') {
        this.showActionToast('CAMERA IN USE - MOUSE ACTIVE');
      } else if (err && err.type === 'insecure') {
        this.showActionToast('CAMERA REQUIRES HTTPS OR LOCALHOST');
      }
    }
  }

  async toggleWebcam() {
    sound.ensureContext();
    if (this.tracker.isTracking || this.tracker.isStarting) {
      this.tracker.stopWebcamTracking();
      if (this.faceTracker) this.faceTracker.stopTracking();
      this.syncHUD();
      this.showActionToast('WEBCAM: OFF (MOUSE ACTIVE)');
    } else {
      this.syncHUD();
      this.showActionToast('STARTING WEBCAM...');
      const success = await this.tracker.startWebcamTracking();
      this.syncHUD();
      if (success) {
        this.showActionToast('WEBCAM: ON');
        if (this.faceTracker && this.faceTracker.enabled) {
          this.faceTracker.startTracking();
        }
      } else {
        const err = this.tracker.lastError;
        if (err && err.type === 'not_allowed') {
          this.showActionToast('CAMERA ACCESS DENIED - MOUSE ACTIVE');
        } else if (err && err.type === 'not_found') {
          this.showActionToast('NO WEBCAM DETECTED - MOUSE ACTIVE');
        } else if (err && err.type === 'not_readable') {
          this.showActionToast('CAMERA IN USE - MOUSE ACTIVE');
        } else if (err && err.type === 'insecure') {
          this.showActionToast('CAMERA REQUIRES HTTPS OR LOCALHOST');
        } else {
          this.showActionToast('WEBCAM UNAVAILABLE - MOUSE ACTIVE');
        }
      }
    }
  }

  async toggleFaceTracking() {
    sound.ensureContext();
    const enabled = await this.faceTracker.toggle();
    this.syncHUD();
    this.showActionToast(enabled ? 'HEAD VR PERSPECTIVE: ON' : 'HEAD VR PERSPECTIVE: OFF');

    if (enabled) {
      // If webcam is not yet running, start it up automatically so face tracking can track
      if (!this.tracker.isTracking && !this.tracker.isStarting) {
        this.tracker.startWebcamTracking().then((success) => {
          if (success && this.faceTracker.enabled) {
            this.faceTracker.startTracking();
          }
          this.syncHUD();
        });
      } else if (this.tracker.isTracking) {
        this.faceTracker.startTracking();
      }
    }
  }

  toggleSound() {
    sound.ensureContext();
    const enabled = sound.toggleSound();
    this.syncHUD();
    this.showActionToast(enabled ? 'AUDIO: ON' : 'AUDIO: OFF');
    return enabled;
  }

  async handleCalibrate() {
    sound.ensureContext();
    const calibModal = document.getElementById('calibration-modal');
    if (calibModal) calibModal.classList.add('open');

    // If webcam is off, start it
    if (!this.tracker.isTracking && !this.tracker.isStarting) {
      this.showActionToast('STARTING WEBCAM FOR CALIBRATION...');
      const success = await this.tracker.startWebcamTracking();
      this.syncHUD();
      if (!success) {
        const err = this.tracker.lastError;
        if (err && err.type === 'not_allowed') {
          this.showActionToast('CAMERA ACCESS DENIED - MOUSE ACTIVE');
        } else if (err && err.type === 'not_found') {
          this.showActionToast('NO WEBCAM DETECTED - MOUSE ACTIVE');
        } else {
          this.showActionToast('WEBCAM UNAVAILABLE - MOUSE ACTIVE');
        }
      }
    }

    this.tracker.setNeutralCenter();
    if (this.faceTracker) this.faceTracker.setNeutralCenter();
    this.showActionToast('CENTER LOCKED & CALIBRATED');
  }

  bindUI() {
    // Top HUD Mode Switcher, Quick Actions & Settings
    // Mode Switcher Buttons in HUD
    const btnModeTennis = document.getElementById('btn-mode-tennis');
    const btnModeHockey = document.getElementById('btn-mode-hockey');
    if (btnModeTennis) {
      btnModeTennis.addEventListener('click', () => {
        sound.ensureContext();
        this.setGameMode('tennis');
      });
    }
    if (btnModeHockey) {
      btnModeHockey.addEventListener('click', () => {
        sound.ensureContext();
        this.setGameMode('hockey');
      });
    }

    // Reset Ball / Puck Button
    const btnResetBall = document.getElementById('btn-reset-ball');
    btnResetBall.addEventListener('click', () => {
      sound.ensureContext();
      if (this.gameMode === 'hockey') {
        this.hockeyGame.resetPuckForServe(this.hockeyGame.server);
      } else {
        this.game.resetBall();
      }
    });

    // Serve Action
    const triggerServe = () => {
      sound.ensureContext();
      if (this.gameMode === 'hockey') {
        this.hockeyGame.serve();
      } else {
        this.game.serve();
      }
    };

    // Serve Ball Button
    const btnServeBall = document.getElementById('btn-serve-ball');
    btnServeBall.addEventListener('click', triggerServe);

    // Serve Prompt Banner
    const servePrompt = document.getElementById('serve-prompt');
    servePrompt.addEventListener('click', triggerServe);

    // Webcam / Mouse Toggle in HUD
    const btnCam = document.getElementById('btn-toggle-cam');
    if (btnCam) {
      btnCam.addEventListener('click', () => this.toggleWebcam());
    }

    // Camera View Toggle (P1, P2 180°, Side Broadcast, and Top-Down Bird's Eye)
    const btnCamera = document.getElementById('btn-camera-view');
    const camViews = ['host', 'client', 'broadcast', 'topdown'];
    const camViewLabels = {
      host: 'CAM: P1',
      client: 'CAM: P2 (180°)',
      broadcast: 'CAM: SIDE TV',
      topdown: 'CAM: TOP-DOWN',
    };

    btnCamera.addEventListener('click', () => {
      const curIdx = camViews.indexOf(this.currentCameraView);
      const nextIdx = (curIdx + 1) % camViews.length;
      this.currentCameraView = camViews[nextIdx];
      this.scene.setViewMode(this.currentCameraView);
      document.getElementById('cam-view-text').textContent = camViewLabels[this.currentCameraView];
      this.showActionToast(camViewLabels[this.currentCameraView]);
      this.syncHUD();
    });

    // Face Tracking / VR Head Perspective Toggle in HUD
    const btnFaceTrack = document.getElementById('btn-toggle-facetrack');
    if (btnFaceTrack) {
      btnFaceTrack.addEventListener('click', () => this.toggleFaceTracking());
    }

    // Calibration Setup Modal
    const calibModal = document.getElementById('calibration-modal');
    const btnCalibrate = document.getElementById('btn-calibrate-hand');
    const modalCalibClose = document.getElementById('modal-calib-close');
    const btnSaveCalib = document.getElementById('btn-save-calib-modal');
    const btnSetCenterModal = document.getElementById('btn-set-center-modal');
    const btnPipQuickCenter = document.getElementById('btn-pip-quick-center');

    if (btnCalibrate) {
      btnCalibrate.addEventListener('click', () => this.handleCalibrate());
    }

    if (calibModal) {
      calibModal.addEventListener('click', (e) => {
        if (!e.target.closest('.modal-card')) {
          calibModal.classList.remove('open');
        }
      });
    }

    modalCalibClose.addEventListener('click', () => {
      calibModal.classList.remove('open');
    });

    btnSaveCalib.addEventListener('click', () => {
      calibModal.classList.remove('open');
      this.showActionToast('SETTINGS APPLIED');
    });

    const triggerCenterLock = () => {
      sound.ensureContext();
      this.tracker.setNeutralCenter();
      if (this.faceTracker) this.faceTracker.setNeutralCenter();
      this.showActionToast('CENTER LOCKED');
    };

    btnSetCenterModal.addEventListener('click', triggerCenterLock);
    btnPipQuickCenter.addEventListener('click', triggerCenterLock);

    // Calibration Sliders
    const sliderX = document.getElementById('slider-sens-x');
    const valX = document.getElementById('val-sens-x');
    sliderX.addEventListener('input', (e) => {
      this.tracker.settings.sensitivityX = parseFloat(e.target.value);
      valX.textContent = `${this.tracker.settings.sensitivityX.toFixed(1)}x`;
    });

    const sliderY = document.getElementById('slider-sens-y');
    const valY = document.getElementById('val-sens-y');
    sliderY.addEventListener('input', (e) => {
      this.tracker.settings.sensitivityY = parseFloat(e.target.value);
      valY.textContent = `${this.tracker.settings.sensitivityY.toFixed(1)}x`;
    });

    const sliderZ = document.getElementById('slider-sens-z');
    const valZ = document.getElementById('val-sens-z');
    sliderZ.addEventListener('input', (e) => {
      this.tracker.settings.sensitivityZ = parseFloat(e.target.value);
      valZ.textContent = `${this.tracker.settings.sensitivityZ.toFixed(1)}x`;
    });

    const sliderSmooth = document.getElementById('slider-smooth');
    const valSmooth = document.getElementById('val-smooth');
    sliderSmooth.addEventListener('input', (e) => {
      this.tracker.settings.smoothSpeed = parseFloat(e.target.value);
      valSmooth.textContent = `${this.tracker.settings.smoothSpeed}`;
    });

    const chkInvertX = document.getElementById('chk-invert-x');
    const webcamCanvas = document.getElementById('webcam-canvas');
    if (chkInvertX) {
      chkInvertX.checked = this.tracker.invertX;
      chkInvertX.addEventListener('change', (e) => {
        this.tracker.invertX = e.target.checked;
        if (webcamCanvas) webcamCanvas.classList.toggle('mirrored', this.tracker.invertX);
        this.syncHUD();
      });
    }

    // Match Over / Rematch Modal
    const matchModal = document.getElementById('matchover-modal');
    const btnMatchRestart = document.getElementById('btn-match-restart');
    if (btnMatchRestart) {
      btnMatchRestart.addEventListener('click', () => {
        matchModal.classList.remove('open');
        if (this.gameMode === 'hockey') {
          this.hockeyGame.restartMatch();
        } else {
          this.game.restartMatch();
        }
      });
    }
    if (matchModal) {
      matchModal.addEventListener('click', (e) => {
        if (!e.target.closest('.modal-card')) {
          matchModal.classList.remove('open');
        }
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      if (e.code === 'Escape') {
        e.preventDefault();
        sound.ensureContext();
        const calibModal = document.getElementById('calibration-modal');
        const mpModal = document.getElementById('multiplayer-modal');
        const matchModal = document.getElementById('matchover-modal');

        if (calibModal && calibModal.classList.contains('open')) {
          calibModal.classList.remove('open');
          return;
        }
        if (mpModal && mpModal.classList.contains('open')) {
          mpModal.classList.remove('open');
          return;
        }
        if (matchModal && matchModal.classList.contains('open')) {
          matchModal.classList.remove('open');
          return;
        }

        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        sound.ensureContext();
        if (this.gameMode === 'hockey') {
          this.hockeyGame.serve();
        } else {
          this.game.serve();
        }
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        sound.ensureContext();
        if (this.gameMode === 'hockey') {
          this.hockeyGame.resetPuckForServe(this.hockeyGame.server);
        } else {
          this.game.resetBall();
        }
      } else if (e.code === 'KeyT') {
        sound.ensureContext();
        this.setGameMode(this.gameMode === 'tennis' ? 'hockey' : 'tennis');
      } else if (e.code === 'KeyC') {
        triggerCenterLock();
      } else if (e.code === 'KeyV') {
        btnCamera.click();
      } else if (e.code === 'KeyM') {
        this.toggleWebcam();
      } else if (e.code === 'KeyF') {
        this.toggleFaceTracking();
      }
    });

    // Multiplayer Modal
    const modal = document.getElementById('multiplayer-modal');
    const btnMultiplayer = document.getElementById('btn-multiplayer');
    const modalClose = document.getElementById('modal-close-btn');

    if (btnMultiplayer) {
      btnMultiplayer.addEventListener('click', () => {
        modal.classList.add('open');
      });
    }

    if (modalClose) {
      modalClose.addEventListener('click', () => {
        modal.classList.remove('open');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (!e.target.closest('.modal-card')) {
          modal.classList.remove('open');
        }
      });
    }

    const btnCreateRoom = document.getElementById('btn-create-room');
    btnCreateRoom.addEventListener('click', () => {
      sound.ensureContext();
      const roomId = this.multiplayer.createRoom();
      document.getElementById('room-code-container').style.display = 'flex';
      document.getElementById('display-room-code').textContent = roomId;
      document.getElementById('btn-open-second-tab').style.display = 'block';
      this.tracker.setPlayerRole('host');
      this.scene.setViewMode('host');
      this.currentCameraView = 'host';
      document.getElementById('cam-view-text').textContent = 'CAM: P1';
      document.getElementById('p1-label').textContent = 'P1 (YOU - HOST)';
      document.getElementById('p2-label').textContent = 'P2 (WAITING...)';
    });

    const btnCopyLink = document.getElementById('btn-copy-link');
    btnCopyLink.addEventListener('click', () => {
      const joinUrl = `${window.location.origin}${window.location.pathname}?room=${this.multiplayer.roomId}&role=client`;
      navigator.clipboard.writeText(joinUrl).then(() => {
        btnCopyLink.textContent = 'COPIED';
        setTimeout(() => (btnCopyLink.textContent = 'COPY LINK'), 2000);
      });
    });

    const btnOpenSecond = document.getElementById('btn-open-second-tab');
    btnOpenSecond.addEventListener('click', () => {
      const joinUrl = `${window.location.origin}${window.location.pathname}?room=${this.multiplayer.roomId}&role=client`;
      window.open(joinUrl, '_blank', 'width=900,height=650');
    });

    const btnJoinRoom = document.getElementById('btn-join-room');
    const inputJoinCode = document.getElementById('input-join-code');
    btnJoinRoom.addEventListener('click', () => {
      sound.ensureContext();
      const code = inputJoinCode.value.trim();
      if (!code) return;
      this.joinAsClient(code);
    });
  }

  joinAsClient(code) {
    this.multiplayer.joinRoom(code);
    this.tracker.setPlayerRole('client');
    this.scene.setViewMode('client');
    this.currentCameraView = 'client';
    document.getElementById('cam-view-text').textContent = 'CAM: P2 (180°)';
    document.getElementById('p1-label').textContent = 'P1 (HOST)';
    document.getElementById('p2-label').textContent = 'P2 (YOU - CLIENT)';
    document.getElementById('hud-p2-badge').textContent = 'P2 (YOU)';
    document.getElementById('hud-p1-badge').textContent = 'P1';
  }

  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const roleParam = params.get('role');

    if (roomParam && roleParam === 'client') {
      setTimeout(() => {
        this.joinAsClient(roomParam);
        this.showActionToast(`JOINING ROOM ${roomParam}`);
      }, 500);
    }
  }

  onPeerConnected(role, peerId) {
    const modal = document.getElementById('multiplayer-modal');
    modal.classList.remove('open');

    if (role === 'host') {
      document.getElementById('p2-label').textContent = 'P2 (CLIENT)';
      document.getElementById('hud-p2-badge').textContent = 'P2';
      this.showActionToast('PLAYER 2 CONNECTED');
    } else {
      this.showActionToast('CONNECTED TO HOST');
    }
    sound.playScore(true);
  }

  onPeerDisconnected() {
    this.showActionToast('PEER DISCONNECTED');
    if (this.multiplayer.role === 'host') {
      document.getElementById('p2-label').textContent = 'CPU (AI)';
      document.getElementById('hud-p2-badge').textContent = 'CPU';
    }
  }

  updateMultiplayerStatus(status, message) {
    const statusEl = document.getElementById('mp-modal-status');
    if (statusEl) {
      statusEl.textContent = `Status: ${message}`;
    }
  }

  onTrackingStatusChange(info) {
    const dot = document.getElementById('tracking-status-dot');
    const text = document.getElementById('tracking-status-text');
    const btnCam = document.getElementById('btn-toggle-cam');
    const camBtnText = document.getElementById('cam-btn-text');

    if (info.status === 'active') {
      if (dot) dot.className = 'status-indicator-dot active';
      if (text) text.textContent = 'INPUT: WEBCAM';
      if (btnCam) btnCam.classList.add('active');
      if (camBtnText) camBtnText.textContent = 'WEBCAM: ON';
    } else if (info.status === 'error' || info.status === 'stopped') {
      if (dot) dot.className = 'status-indicator-dot';
      if (text) text.textContent = 'INPUT: MOUSE';
      if (btnCam) btnCam.classList.remove('active');
      if (camBtnText) camBtnText.textContent = 'WEBCAM: OFF';
    } else if (info.status === 'initializing') {
      if (dot) dot.className = 'status-indicator-dot active';
      if (text) text.textContent = 'STARTING WEBCAM...';
      if (btnCam) btnCam.classList.add('active');
      if (camBtnText) camBtnText.textContent = 'WEBCAM: ON';
    } else {
      if (text) text.textContent = info.message.toUpperCase();
    }
    this.syncHUD();
  }

  onCalibrationUpdate(data) {
    if (data.readout) {
      const dirBadge = document.getElementById('pip-dir-badge');
      const calibDir = document.getElementById('calib-live-direction');
      if (dirBadge) dirBadge.textContent = data.readout.direction;
      if (calibDir) calibDir.textContent = data.readout.direction;
    }
  }

  setGameMode(mode) {
    if (this.gameMode === mode) return;
    this.gameMode = mode;
    this.scene.setGameMode(mode);

    const btnTennis = document.getElementById('btn-mode-tennis');
    const btnHockey = document.getElementById('btn-mode-hockey');
    const matchCat = document.getElementById('match-category');
    const p1Badge = document.getElementById('hud-p1-badge');
    const p2Badge = document.getElementById('hud-p2-badge');
    const staminaCards = document.querySelectorAll('.player-stamina-card');

    if (mode === 'hockey') {
      if (btnTennis) btnTennis.classList.remove('active');
      if (btnHockey) btnHockey.classList.add('active');
      if (matchCat) matchCat.textContent = 'AIR HOCKEY ARCADE CHAMPIONSHIP';
      if (p1Badge) p1Badge.textContent = 'P1 STRIKER';
      if (p2Badge) p2Badge.textContent = 'CPU STRIKER';
      staminaCards.forEach((c) => (c.style.display = 'none'));
      this.showActionToast('AIR HOCKEY ACTIVE');
      this.onScoreUpdate(this.hockeyGame.scores);
      this.onGameStateChange(this.hockeyGame.state);
    } else {
      if (btnHockey) btnHockey.classList.remove('active');
      if (btnTennis) btnTennis.classList.add('active');
      if (matchCat) matchCat.textContent = 'TABLE TENNIS CHAMPIONSHIP';
      if (p1Badge) p1Badge.textContent = 'P1';
      if (p2Badge) p2Badge.textContent = 'CPU';
      staminaCards.forEach((c) => (c.style.display = 'flex'));
      this.showActionToast('TABLE TENNIS ACTIVE');
      this.onScoreUpdate(this.game.scores);
      this.onGameStateChange(this.game.state);
    }
    this.syncHUD();
  }

  onGameStateChange(state) {
    const servePrompt = document.getElementById('serve-prompt');
    const isHockey = this.gameMode === 'hockey';
    const activeGame = isHockey ? this.hockeyGame : this.game;
    const isServeWait = isHockey
      ? state === AIR_HOCKEY_STATES.SERVE_WAIT
      : state === GAME_STATES.SERVE_WAIT;

    if (isServeWait) {
      if (servePrompt) servePrompt.style.display = 'block';
      const serverNum = (activeGame && activeGame.server) ? activeGame.server : 1;
      if (serverNum === 1) {
        if (servePrompt) {
          servePrompt.textContent = isHockey
            ? 'YOUR PUCK SERVE - STRIKE PUCK TO SERVE'
            : 'OPEN HAND OR SWING THROUGH BALL TO SERVE';
        }
      } else {
        if (servePrompt) servePrompt.textContent = 'CPU SERVING...';
      }
    } else {
      if (servePrompt) servePrompt.style.display = 'none';
    }
  }

  onScoreUpdate(scores) {
    const isHockey = this.gameMode === 'hockey';
    const activeGame = isHockey ? this.hockeyGame : this.game;

    const p1Score = document.getElementById('p1-score');
    const p2Score = document.getElementById('p2-score');
    if (p1Score && scores) p1Score.textContent = scores[0];
    if (p2Score && scores) p2Score.textContent = scores[1];

    const p1Dot = document.getElementById('p1-serve-dot');
    const p2Dot = document.getElementById('p2-serve-dot');
    const serverNum = (activeGame && activeGame.server) ? activeGame.server : 1;
    if (p1Dot) p1Dot.className = `serve-dot ${serverNum === 1 ? 'active' : ''}`;
    if (p2Dot) p2Dot.className = `serve-dot ${serverNum === 2 ? 'active' : ''}`;
  }

  onMatchOver(result) {
    const isPlayerWinner = result.winner === 'PLAYER 1';
    if (isPlayerWinner) {
      sound.playMatchVictory();
      this.triggerVictoryCelebration();
    } else {
      sound.playMatchDefeat();
    }

    const matchModal = document.getElementById('matchover-modal');
    document.getElementById('matchover-headline').textContent = `${result.winner} VICTORIOUS`;
    document.getElementById('matchover-final-score').textContent = `${result.scores[0]} - ${result.scores[1]}`;
    matchModal.classList.add('open');
  }

  showActionToast(text) {
    const toast = document.getElementById('action-toast');
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 1100);
  }

  triggerVictoryCelebration() {
    confetti({
      particleCount: 130,
      spread: 85,
      origin: { y: 0.6 },
    });
    setTimeout(() => {
      confetti({
        particleCount: 90,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
      });
      confetti({
        particleCount: 90,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
      });
    }, 350);
  }

  updateStaminaBars() {
    const p1Fill = document.getElementById('p1-smash-fill');
    const p2Fill = document.getElementById('p2-smash-fill');

    const p1Val = this.game.smashEnergy[0];
    const p2Val = this.game.smashEnergy[1];

    p1Fill.style.width = `${Math.max(10, p1Val)}%`;
    p2Fill.style.width = `${Math.max(10, p2Val)}%`;

    p1Fill.className = `stamina-bar-fill ${p1Val >= 100 ? 'hyper' : ''}`;
    p2Fill.className = `stamina-bar-fill ${p2Val >= 100 ? 'hyper' : ''}`;
  }

  animate(now) {
    requestAnimationFrame(this.animate);

    const deltaTime = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // 1. Get smoothly filtered paddle/striker transform from Hand Tracker or Mouse
    const localPaddleTransform = this.tracker.getTransform(deltaTime);

    // 1b. Update Face Tracking Parallax Offset (VR Perspective)
    const headOffset = this.faceTracker.getParallaxOffset(deltaTime);
    this.scene.setHeadParallaxOffset(headOffset);

    // 1c. Draw Holographic Face Box on PIP Canvas if active
    if (this.faceTracker.enabled && this.tracker.canvasCtx && this.tracker.canvasElement) {
      this.faceTracker.drawPIPOverlay(
        this.tracker.canvasCtx,
        this.tracker.canvasElement.width,
        this.tracker.canvasElement.height
      );
    }

    // 2. Update active game (Air Hockey or Table Tennis)
    if (!this.isMenuOpen) {
      if (this.gameMode === 'hockey') {
        this.hockeyGame.update(deltaTime, localPaddleTransform);
      } else {
        this.game.update(deltaTime, localPaddleTransform);
        this.updateStaminaBars();
      }
    } else {
      // While menu is open, keep local player visual paddle/striker updated so motion tracking is visible
      if (localPaddleTransform) {
        if (this.gameMode === 'hockey') {
          if (this.scene.striker1) {
            this.scene.striker1.position.copy(localPaddleTransform.position);
          }
        } else {
          if (this.scene.paddle1) {
            this.scene.paddle1.position.copy(localPaddleTransform.position);
            this.scene.paddle1.quaternion.copy(localPaddleTransform.quaternion);
          }
        }
      }
    }

    // 3. Update Scene graphics effects & shadows
    this.scene.update(deltaTime);

    // 4. Render Three.js frame
    this.scene.render();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = window.gameApp = new TableTennisApp();
  });
} else {
  window.app = window.gameApp = new TableTennisApp();
}
