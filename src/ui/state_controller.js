/**
 * Core Application States
 */
export const APP_STATES = {
  MENU: 'MENU',
  CALIBRATING: 'CALIBRATING',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  MATCH_OVER: 'MATCH_OVER',
};

/**
 * StateController orchestrates game lifecycle, UI states,
 * hand tracking calibration gate, in-game HUD, and pause/resume flow.
 */
export class StateController {
  constructor(app) {
    this.app = app;

    // Initial state
    this.state = APP_STATES.MENU;
    this.discipline = 'hockey'; // 'hockey' (Air Hockey) or 'tennis' (Table Tennis)
    this.matchMode = 'solo';    // 'solo' or 'online'
    this.difficulty = 'medium'; // 'easy' (Apprentice), 'medium' (Professional), 'hard' (Apex)

    // Hand tracking calibration gate
    this.calibrationStableDuration = 0;
    this.calibrationTargetDuration = 1.0; // 1.0 second continuous stable tracking
    this.isCalibrating = false;
    this.calibrationCallback = null;
    this.lastFrameTime = performance.now();

    // In-game FPS tracking
    this.fpsCounter = 60;
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();

    // Cache DOM elements
    this.initDOMElements();

    // Bind event handlers
    this.bindEvents();

    // Apply initial UI representation
    this.syncUI();
  }

  initDOMElements() {
    // Sections
    this.heroSection = document.getElementById('hero-section');
    this.menuSection = document.getElementById('configuration-menu') || document.getElementById('menu-section');
    this.inGameHud = document.getElementById('in-game-hud');

    // Hero elements
    this.heroSensorDot = document.getElementById('hero-sensor-dot');
    this.heroCtaBtn = document.getElementById('hero-cta-btn');

    // Discipline selection cards
    this.cardHockey = document.getElementById('card-discipline-hockey');
    this.cardTennis = document.getElementById('card-discipline-tennis');

    // Match setup toggles & panels
    this.btnModeSolo = document.getElementById('btn-mode-solo');
    this.btnModeOnline = document.getElementById('btn-mode-online');
    this.soloPanel = document.getElementById('solo-setup-panel');
    this.onlinePanel = document.getElementById('online-setup-panel');
    this.diffButtons = document.querySelectorAll('.diff-btn');

    // Online multiplayer controls
    this.btnCreateMatch = document.getElementById('btn-create-match');
    this.roomCodeWrap = document.getElementById('room-code-display-wrap');
    this.roomCodeVal = document.getElementById('room-code-val');
    this.btnCopyRoomCode = document.getElementById('btn-copy-room-code');
    this.inputMatchCode = document.getElementById('input-match-code');
    this.btnJoinMatch = document.getElementById('btn-join-match');
    this.onlineStatusHint = document.getElementById('online-status-hint');

    // Main action
    this.btnStartMatch = document.getElementById('btn-start-match');

    // In-game HUD
    this.btnGamePause = document.getElementById('btn-game-pause');
    this.hudP1Label = document.getElementById('hud-p1-label');
    this.hudP2Label = document.getElementById('hud-p2-label');
    this.hudScoreDisplay = document.getElementById('hud-score-display');
    this.hudP1Serve = document.getElementById('hud-p1-serve');
    this.hudP2Serve = document.getElementById('hud-p2-serve');
    this.hudTrackingDot = document.getElementById('hud-tracking-dot');
    this.hudTrackingLabel = document.getElementById('hud-tracking-label');
    this.hudFpsCounter = document.getElementById('hud-fps-counter');
    this.servePrompt = document.getElementById('serve-prompt');
    this.actionToast = document.getElementById('action-toast');

    // Calibration modal & camera buttons
    this.calibModal = document.getElementById('calibration-modal');
    this.modalCalibClose = document.getElementById('modal-calib-close');
    this.calibCanvas = document.getElementById('calib-reticle-canvas');
    this.calibStatusText = document.getElementById('calib-status-text');
    this.calibPercent = document.getElementById('calib-progress-percent');
    this.calibStabilityFill = document.getElementById('calib-stability-fill');
    this.btnManualSkip = document.getElementById('btn-manual-calib-skip');
    this.calibDistanceBadge = document.getElementById('calib-distance-badge');
    this.calibDistanceText = document.getElementById('calib-distance-text');
    this.btnStartCamera = document.getElementById('btn-start-camera');
    this.btnCalibToggleCamera = document.getElementById('btn-calib-toggle-camera');
    this.calibCamBtnText = document.getElementById('calib-cam-btn-text');
    this.calibCameraOverlay = document.getElementById('calib-camera-overlay');
    this.calibCameraPrompt = document.getElementById('calib-camera-prompt');

    // Menu camera button & hero pill
    this.btnMenuCamToggle = document.getElementById('btn-menu-cam-toggle');
    this.menuCamText = document.getElementById('menu-cam-text');
    this.heroSensorPill = document.querySelector('.sensor-pill');

    // Pause modal
    this.pauseModal = document.getElementById('pause-modal');
    this.btnPauseResume = document.getElementById('btn-pause-resume');
    this.btnPauseRecalibrate = document.getElementById('btn-pause-recalibrate');
    this.btnPauseQuit = document.getElementById('btn-pause-quit');

    // Match over modal
    this.matchoverModal = document.getElementById('matchover-modal');
    this.matchoverHeadline = document.getElementById('matchover-headline');
    this.matchoverFinalScore = document.getElementById('matchover-final-score');
    this.btnMatchRestart = document.getElementById('btn-match-restart');
    this.btnMatchQuit = document.getElementById('btn-match-quit');
  }

  bindEvents() {
    // Hero smooth scroll to menu
    if (this.heroCtaBtn && this.menuSection) {
      this.heroCtaBtn.addEventListener('click', () => {
        this.menuSection.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Discipline cards selection
    if (this.cardHockey) {
      this.cardHockey.addEventListener('click', () => {
        this.setDiscipline('hockey');
      });
    }
    if (this.cardTennis) {
      this.cardTennis.addEventListener('click', () => {
        this.setDiscipline('tennis');
      });
    }

    // Mode toggles
    if (this.btnModeSolo) {
      this.btnModeSolo.addEventListener('click', () => {
        this.setMatchMode('solo');
      });
    }
    if (this.btnModeOnline) {
      this.btnModeOnline.addEventListener('click', () => {
        this.setMatchMode('online');
      });
    }

    // Difficulty buttons
    this.diffButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const diff = btn.getAttribute('data-diff');
        this.setDifficulty(diff);
      });
    });

    // Online match actions
    if (this.btnCreateMatch) {
      this.btnCreateMatch.addEventListener('click', () => {
        const code = this.app.multiplayer.createRoom();
        if (this.roomCodeWrap && this.roomCodeVal) {
          this.roomCodeWrap.style.display = 'flex';
          this.roomCodeVal.textContent = code;
        }
        if (this.onlineStatusHint) {
          this.onlineStatusHint.textContent = `Room ${code} created. Waiting for opponent...`;
        }
      });
    }

    if (this.btnCopyRoomCode) {
      this.btnCopyRoomCode.addEventListener('click', () => {
        const code = this.roomCodeVal ? this.roomCodeVal.textContent : '';
        if (code) {
          navigator.clipboard.writeText(code).then(() => {
            this.btnCopyRoomCode.textContent = 'Copied';
            setTimeout(() => {
              if (this.btnCopyRoomCode) this.btnCopyRoomCode.textContent = 'Copy';
            }, 1800);
          });
        }
      });
    }

    if (this.btnJoinMatch && this.inputMatchCode) {
      this.btnJoinMatch.addEventListener('click', () => {
        const code = this.inputMatchCode.value.trim().toUpperCase();
        if (code.length >= 4) {
          this.app.joinAsClient(code);
          if (this.onlineStatusHint) {
            this.onlineStatusHint.textContent = `Connecting to room ${code}...`;
          }
        } else {
          this.showToast('Please enter a valid 5-letter code');
        }
      });
    }

    // Camera activation buttons
    if (this.btnStartCamera) {
      this.btnStartCamera.addEventListener('click', (e) => {
        e.preventDefault();
        this.requestStartCamera();
      });
    }
    if (this.btnCalibToggleCamera) {
      this.btnCalibToggleCamera.addEventListener('click', (e) => {
        e.preventDefault();
        this.requestStartCamera();
      });
    }
    if (this.btnMenuCamToggle) {
      this.btnMenuCamToggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.requestStartCamera();
      });
    }
    if (this.heroSensorPill) {
      this.heroSensorPill.style.cursor = 'pointer';
      this.heroSensorPill.title = 'Click to activate or check camera sensor';
      this.heroSensorPill.addEventListener('click', () => {
        this.requestStartCamera();
      });
    }

    // Start match action triggers Hand Calibration Gate
    if (this.btnStartMatch) {
      this.btnStartMatch.addEventListener('click', () => {
        this.triggerCalibrationGate(() => {
          this.startMatch();
        });
      });
    }

    // Pause button in HUD
    if (this.btnGamePause) {
      this.btnGamePause.addEventListener('click', () => {
        this.togglePause();
      });
    }

    // Pause modal actions
    if (this.btnPauseResume) {
      this.btnPauseResume.addEventListener('click', () => {
        this.resumeMatch();
      });
    }
    if (this.btnPauseRecalibrate) {
      this.btnPauseRecalibrate.addEventListener('click', () => {
        this.pauseModal.classList.remove('open');
        this.triggerCalibrationGate(() => {
          this.resumeMatch();
          this.showToast('Recalibrated');
        });
      });
    }
    if (this.btnPauseQuit) {
      this.btnPauseQuit.addEventListener('click', () => {
        this.quitToMenu();
      });
    }

    // Match Over modal actions
    if (this.btnMatchRestart) {
      this.btnMatchRestart.addEventListener('click', () => {
        this.matchoverModal.classList.remove('open');
        this.startMatch();
      });
    }
    if (this.btnMatchQuit) {
      this.btnMatchQuit.addEventListener('click', () => {
        this.matchoverModal.classList.remove('open');
        this.quitToMenu();
      });
    }

    // Calibration modal close / skip
    if (this.modalCalibClose) {
      this.modalCalibClose.addEventListener('click', () => {
        this.closeCalibrationGate(false);
      });
    }
    if (this.btnManualSkip) {
      this.btnManualSkip.addEventListener('click', () => {
        this.closeCalibrationGate(true); // force proceed with mouse controls
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.state === APP_STATES.PLAYING) {
          this.pauseMatch();
        } else if (this.state === APP_STATES.PAUSED) {
          this.resumeMatch();
        } else if (this.state === APP_STATES.CALIBRATING) {
          this.closeCalibrationGate(false);
        }
        return;
      }

      // Key 'R': Instant quick-recalibration without resetting the match score
      if (e.code === 'KeyR') {
        e.preventDefault();
        if (this.state === APP_STATES.PLAYING) {
          this.app.triggerFullCalibration(false);
          this.showToast('Recalibrated');
        }
      }

      // Space: Serve
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.state === APP_STATES.PLAYING) {
          if (this.discipline === 'hockey') {
            this.app.hockeyGame.serve();
          } else {
            this.app.game.serve();
          }
        }
      }
    });
  }

  setDiscipline(discipline) {
    if (discipline !== 'hockey' && discipline !== 'tennis') return;
    this.discipline = discipline;

    // Visual card outline states
    if (this.cardHockey) {
      this.cardHockey.classList.toggle('active', discipline === 'hockey');
      this.cardHockey.classList.toggle('standby', discipline !== 'hockey');
    }
    if (this.cardTennis) {
      this.cardTennis.classList.toggle('active', discipline === 'tennis');
      this.cardTennis.classList.toggle('standby', discipline !== 'tennis');
    }

    // Switch 3D table showcase in background scene
    if (this.app) {
      this.app.setGameMode(discipline);
    }
  }

  setMatchMode(mode) {
    if (mode !== 'solo' && mode !== 'online') return;
    this.matchMode = mode;

    if (this.btnModeSolo) {
      this.btnModeSolo.classList.toggle('active', mode === 'solo');
      this.btnModeSolo.setAttribute('aria-selected', mode === 'solo' ? 'true' : 'false');
    }
    if (this.btnModeOnline) {
      this.btnModeOnline.classList.toggle('active', mode === 'online');
      this.btnModeOnline.setAttribute('aria-selected', mode === 'online' ? 'true' : 'false');
    }

    if (this.soloPanel) this.soloPanel.style.display = mode === 'solo' ? 'block' : 'none';
    if (this.onlinePanel) this.onlinePanel.style.display = mode === 'online' ? 'block' : 'none';

    // Update in-game opponent label
    if (this.hudP2Label) {
      this.hudP2Label.textContent = mode === 'online' ? 'Player 2' : 'Bot';
    }
  }

  setDifficulty(difficulty) {
    if (!['easy', 'medium', 'hard'].includes(difficulty)) return;
    this.difficulty = difficulty;

    this.diffButtons.forEach((btn) => {
      const bDiff = btn.getAttribute('data-diff');
      btn.classList.toggle('active', bDiff === difficulty);
    });

    if (this.app) {
      this.app.setBotDifficulty(difficulty);
    }
  }

  syncUI() {
    this.setDiscipline(this.discipline);
    this.setMatchMode(this.matchMode);
    this.setDifficulty(this.difficulty);

    // Initial state visibility
    document.body.classList.remove('playing');
    if (this.heroSection) this.heroSection.style.display = 'flex';
    if (this.menuSection) this.menuSection.style.display = 'block';
    if (this.inGameHud) this.inGameHud.style.display = 'none';
    if (this.pauseModal) this.pauseModal.classList.remove('open');
    if (this.calibModal) this.calibModal.classList.remove('open');
    if (this.matchoverModal) this.matchoverModal.classList.remove('open');
  }

  setCameraUIStarting(isStarting) {
    const tracker = this.app.tracker;
    const isTracking = Boolean(tracker?.isTracking);
    const hasError = !isTracking && Boolean(tracker?.lastError);

    let promptText = 'Camera stream is offline';
    let btnText = 'Start Camera';

    if (isStarting) {
      promptText = 'Requesting camera access...';
      btnText = 'Starting...';
    } else if (isTracking) {
      promptText = 'Camera connected';
      btnText = 'Camera Active';
    } else if (hasError) {
      promptText = tracker.lastError.message;
      btnText = 'Retry Camera';
    }

    if (this.calibCamBtnText) {
      this.calibCamBtnText.textContent = btnText;
    }
    if (this.calibCameraPrompt) {
      this.calibCameraPrompt.textContent = promptText;
    }
    if (this.btnStartCamera) {
      this.btnStartCamera.disabled = isStarting;
      const span = this.btnStartCamera.querySelector('span');
      if (span) span.textContent = btnText;
    }
    if (this.menuCamText) {
      this.menuCamText.textContent = isStarting ? 'Starting Camera...' : (isTracking ? 'Camera Ready' : (hasError ? 'Retry Camera' : 'Start Camera'));
    }
  }

  updateCameraUI(isActive) {
    const tracker = this.app.tracker;
    const hasError = !isActive && Boolean(tracker?.lastError);
    const promptText = isActive ? 'Camera connected' : (hasError ? tracker.lastError.message : 'Camera stream is offline');
    const btnText = isActive ? 'Camera Active' : (hasError ? 'Retry Camera' : 'Start Camera');

    if (this.calibCameraOverlay) {
      if (isActive) {
        this.calibCameraOverlay.classList.add('hidden');
      } else {
        this.calibCameraOverlay.classList.remove('hidden');
      }
    }
    if (this.calibCameraPrompt) {
      this.calibCameraPrompt.textContent = promptText;
    }
    if (this.btnStartCamera) {
      this.btnStartCamera.disabled = false;
      const span = this.btnStartCamera.querySelector('span');
      if (span) span.textContent = btnText;
    }
    if (this.calibCamBtnText) {
      this.calibCamBtnText.textContent = btnText;
    }
    if (this.btnCalibToggleCamera) {
      this.btnCalibToggleCamera.classList.toggle('active', Boolean(isActive));
    }
    if (this.btnMenuCamToggle) {
      this.btnMenuCamToggle.classList.toggle('active', Boolean(isActive));
    }
    if (this.menuCamText) {
      this.menuCamText.textContent = isActive ? 'Camera Ready' : (hasError ? 'Retry Camera' : 'Start Camera');
    }
    if (this.heroSensorDot) {
      this.heroSensorDot.classList.toggle('active', Boolean(isActive));
    }
  }

  async requestStartCamera() {
    const tracker = this.app.tracker;
    if (!tracker) return false;

    if (tracker.isTracking) {
      this.updateCameraUI(true);
      return true;
    }

    this.setCameraUIStarting(true);
    if (this.calibStatusText) {
      this.calibStatusText.textContent = 'Requesting camera access...';
    }

    try {
      const success = await tracker.startWebcamTracking();
      this.setCameraUIStarting(false);
      this.updateCameraUI(success);
      if (success) {
        if (this.calibStatusText) {
          this.calibStatusText.textContent = 'Show calibration sign (🤟) in frame';
        }
        if (this.app && this.app.faceTracker && !this.app.faceTracker.isTracking) {
          this.app.faceTracker.startTracking();
        }
        this.showToast('Camera Connected');
      } else {
        const errorMsg = tracker.lastError?.message || 'Camera blocked or unavailable.';
        if (this.calibStatusText) {
          this.calibStatusText.textContent = errorMsg;
        }
        this.showToast(errorMsg);
      }
      return success;
    } catch (err) {
      console.warn('Camera request error:', err);
      this.setCameraUIStarting(false);
      this.updateCameraUI(false);
      const errorMsg = tracker.lastError?.message || 'Camera blocked or unavailable.';
      if (this.calibStatusText) {
        this.calibStatusText.textContent = errorMsg;
      }
      this.showToast(errorMsg);
      return false;
    }
  }

  /**
   * Hand Tracking Calibration Gate:
   * Requires showing the calibration sign (🤟) at an optimal distance (~0.5m – 1.2m).
   * Automatically activates camera sensor and provides live distance feedback.
   */
  triggerCalibrationGate(onComplete) {
    this.calibrationCallback = onComplete;
    this.state = APP_STATES.CALIBRATING;
    this.isCalibrating = true;
    this.calibrationStableDuration = 0;
    this.calibrationTargetDuration = 0.40; // 0.40s continuous deliberate hold of sign
    this.calibrationCompleted = false;

    if (this.calibModal) this.calibModal.classList.add('open');
    if (this.calibStatusText) this.calibStatusText.textContent = 'Show calibration sign (🤟) in frame...';
    if (this.calibPercent) this.calibPercent.textContent = '0%';
    if (this.calibStabilityFill) {
      this.calibStabilityFill.style.width = '0%';
      this.calibStabilityFill.classList.remove('locked');
    }
    if (this.calibDistanceBadge) {
      this.calibDistanceBadge.className = 'calib-distance-badge distance-none';
    }
    if (this.calibDistanceText) {
      this.calibDistanceText.textContent = 'Position hand in camera frame';
    }

    const tracker = this.app.tracker;
    if (tracker && tracker.isTracking) {
      this.updateCameraUI(true);
    } else {
      this.updateCameraUI(false);
      // Attempt camera startup since user triggered a direct click action
      this.requestStartCamera();
    }
  }

  closeCalibrationGate(proceed = false) {
    this.isCalibrating = false;
    if (this.calibModal) this.calibModal.classList.remove('open');

    if (proceed && this.calibrationCallback) {
      this.app.triggerFullCalibration(false);
      this.calibrationCallback();
      this.calibrationCallback = null;
    } else {
      this.calibrationCallback = null;
      if (this.state === APP_STATES.CALIBRATING) {
        this.state = APP_STATES.MENU;
      }
    }
  }

  /**
   * Updates calibration progress when modal is active.
   * Advances when the calibration sign (🤟) is detected at an optimal distance (~0.5m – 1.2m).
   */
  updateCalibrationProgress(dt) {
    if (!this.isCalibrating || !this.calibModal || !this.calibModal.classList.contains('open')) return;

    const tracker = this.app.tracker;
    const now = performance.now();
    const isHandDetected = tracker && tracker.isTracking && (now - tracker.lastDetectedTime < 350);

    let distanceZone = 'none'; // 'none', 'too_far', 'too_close', 'optimal'
    let distanceLabel = 'Position hand in camera frame';
    let badgeClass = 'distance-none';
    let isGestureActive = false;

    if (isHandDetected && tracker.latestLandmarks) {
      const depth = tracker.currentDepth || (tracker.lastRawHand ? tracker.lastRawHand.depth : 0.20);
      isGestureActive = Boolean(tracker.isCalibrationGestureActive || tracker.isSpidermanActive);

      if (depth < 0.085) {
        distanceZone = 'too_far';
        distanceLabel = 'Too far · Move closer';
        badgeClass = 'distance-warning';
      } else if (depth > 0.31) {
        distanceZone = 'too_close';
        distanceLabel = 'Too close · Step back';
        badgeClass = 'distance-warning';
      } else {
        distanceZone = 'optimal';
        distanceLabel = 'Optimal distance';
        badgeClass = 'distance-optimal';
      }
    }

    // Update Distance Badge UI
    if (this.calibDistanceText) {
      this.calibDistanceText.textContent = distanceLabel;
    }
    if (this.calibDistanceBadge) {
      this.calibDistanceBadge.className = `calib-distance-badge ${badgeClass}`;
    }

    const isOptimal = distanceZone === 'optimal';
    const canCalibrate = isHandDetected && isOptimal && isGestureActive;

    if (canCalibrate) {
      this.calibrationStableDuration += dt;
      if (this.calibStatusText) {
        this.calibStatusText.textContent = 'Sign detected. Holding to lock...';
      }
    } else {
      // Decay progress if hand dropped or gesture lost
      this.calibrationStableDuration = Math.max(0, this.calibrationStableDuration - dt * 2.5);
      if (this.calibStatusText) {
        if (!tracker || !tracker.isTracking) {
          if (tracker && tracker.isStarting) {
            this.calibStatusText.textContent = 'Requesting camera access...';
          } else if (tracker && tracker.lastError) {
            this.calibStatusText.textContent = tracker.lastError.message;
          } else {
            this.calibStatusText.textContent = 'Camera offline. Click Start Camera below.';
          }
        } else if (!isHandDetected) {
          this.calibStatusText.textContent = 'Hold hand in camera view to begin...';
        } else if (distanceZone === 'too_far') {
          this.calibStatusText.textContent = 'Too far from camera — move closer';
        } else if (distanceZone === 'too_close') {
          this.calibStatusText.textContent = 'Too close to camera — step back';
        } else {
          this.calibStatusText.textContent = 'Form calibration sign with hand (🤟)';
        }
      }
    }

    const progress = Math.min(1.0, this.calibrationStableDuration / this.calibrationTargetDuration);
    const pct = Math.round(progress * 100);

    if (this.calibPercent) this.calibPercent.textContent = `${pct}%`;
    if (this.calibStabilityFill) this.calibStabilityFill.style.width = `${pct}%`;

    // Render Live Viewfinder Vector Reticle
    this.renderReticleViewfinder(tracker, isHandDetected, distanceZone, isGestureActive, progress);

    // Gate achieved: gesture held at optimal distance for target duration
    if (progress >= 1.0 && !this.calibrationCompleted) {
      this.calibrationCompleted = true;
      if (this.calibStatusText) {
        this.calibStatusText.textContent = 'Calibrated & Locked!';
      }
      if (this.calibStabilityFill) {
        this.calibStabilityFill.classList.add('locked');
      }

      // Lock neutral center from current hand location
      if (tracker) {
        tracker.setNeutralCenter();
      }
      this.app.triggerFullCalibration(false);

      // Dismiss modal after brief celebratory feedback
      setTimeout(() => {
        this.closeCalibrationGate(true);
      }, 350);
    }
  }

  renderReticleViewfinder(tracker, isHandDetected, distanceZone = 'none', isGestureActive = false, progress = 0) {
    if (!this.calibCanvas) return;
    const ctx = this.calibCanvas.getContext('2d');
    const w = this.calibCanvas.width;
    const h = this.calibCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw webcam feed if active (mirrored for natural reflection)
    let videoDrawn = false;
    if (tracker && tracker.videoElement && tracker.videoElement.readyState >= 2 && tracker.videoElement.videoWidth > 0) {
      try {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(tracker.videoElement, 0, 0, w, h);
        ctx.restore();
        videoDrawn = true;
      } catch (e) {
        videoDrawn = false;
      }
    }

    if (this.calibCameraOverlay) {
      if (videoDrawn) {
        this.calibCameraOverlay.classList.add('hidden');
      } else if (!tracker || !tracker.isTracking) {
        this.calibCameraOverlay.classList.remove('hidden');
      }
    }

    if (!videoDrawn) {
      // Subtle ambient viewfinder backdrop
      ctx.fillStyle = '#0e0d0b';
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Subtle dark luxury glass tint overlay
    ctx.fillStyle = 'rgba(10, 9, 7, 0.38)';
    ctx.fillRect(0, 0, w, h);

    // 3. Crisp Vector Alignment Reticle
    const cx = w / 2;
    const cy = h / 2;
    const reticleRadius = 52;
    const isLockedOrLocking = isGestureActive && distanceZone === 'optimal';

    ctx.strokeStyle = isLockedOrLocking ? '#e8b84e' : (isHandDetected ? 'rgba(212, 160, 60, 0.65)' : 'rgba(212, 160, 60, 0.35)');
    ctx.lineWidth = 1.5;

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - 75, cy);
    ctx.lineTo(cx - 24, cy);
    ctx.moveTo(cx + 24, cy);
    ctx.lineTo(cx + 75, cy);
    ctx.moveTo(cx, cy - 75);
    ctx.lineTo(cx, cy - 24);
    ctx.moveTo(cx, cy + 24);
    ctx.lineTo(cx, cy + 75);
    ctx.stroke();

    // Center targeting ring
    ctx.beginPath();
    ctx.arc(cx, cy, reticleRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Circular Lock Progress Arc around center reticle ring
    if (progress > 0) {
      ctx.save();
      ctx.strokeStyle = '#e8b84e';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = 'rgba(232, 184, 78, 0.8)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, reticleRadius + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
      ctx.restore();
    }

    // Center dot
    ctx.fillStyle = isLockedOrLocking ? '#e8b84e' : 'rgba(212, 160, 60, 0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Corner alignment brackets
    const bSize = 24;
    const margin = 24;
    ctx.lineWidth = 2.0;

    // Top-left
    ctx.beginPath();
    ctx.moveTo(margin, margin + bSize);
    ctx.lineTo(margin, margin);
    ctx.lineTo(margin + bSize, margin);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(w - margin - bSize, margin);
    ctx.lineTo(w - margin, margin);
    ctx.lineTo(w - margin, margin + bSize);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(margin, h - margin - bSize);
    ctx.lineTo(margin, h - margin);
    ctx.lineTo(margin + bSize, h - margin);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(w - margin - bSize, h - margin);
    ctx.lineTo(w - margin, h - margin);
    ctx.lineTo(w - margin, h - margin - bSize);
    ctx.stroke();

    // 4. Draw Hand Landmarks Overlay if detected
    if (isHandDetected && tracker.latestLandmarks) {
      const landmarks = tracker.latestLandmarks;
      ctx.save();

      // Connections
      const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [0, 9], [9, 10], [10, 11], [11, 12],
        [0, 13], [13, 14], [14, 15], [15, 16],
        [0, 17], [17, 18], [18, 19], [19, 20],
        [5, 9], [9, 13], [13, 17],
      ];

      ctx.strokeStyle = isGestureActive ? '#e8b84e' : 'rgba(212, 160, 60, 0.55)';
      ctx.lineWidth = isGestureActive ? 2.5 : 1.8;

      if (landmarks && landmarks.length >= 21) {
        connections.forEach(([i, j]) => {
          const p1 = landmarks[i];
          const p2 = landmarks[j];
          if (p1 && p2) {
            ctx.beginPath();
            ctx.moveTo((1.0 - p1.x) * w, p1.y * h);
            ctx.lineTo((1.0 - p2.x) * w, p2.y * h);
            ctx.stroke();
          }
        });
      }

      // Landmark Nodes
      landmarks.forEach((lm, idx) => {
        if (!lm) return;
        const lx = (1.0 - lm.x) * w;
        const ly = lm.y * h;
        const isExtendedTip = isGestureActive && (idx === 4 || idx === 8 || idx === 20);

        ctx.fillStyle = isExtendedTip ? '#e8b84e' : 'rgba(212, 160, 60, 0.85)';
        ctx.beginPath();
        ctx.arc(lx, ly, isExtendedTip ? 5.5 : 3.0, 0, Math.PI * 2);
        ctx.fill();

        if (isExtendedTip) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });

      ctx.restore();
    }
  }

  startMatch() {
    this.state = APP_STATES.PLAYING;
    document.body.classList.add('playing');

    // Hide Menu & Hero sections, Show In-game HUD
    if (this.heroSection) this.heroSection.style.display = 'none';
    if (this.menuSection) this.menuSection.style.display = 'none';
    if (this.inGameHud) this.inGameHud.style.display = 'flex';

    // Disable idle camera orbit in 3D scene
    if (this.app && this.app.scene) {
      this.app.scene.setOrbit(false);
      this.app.scene.setViewMode(this.app.currentCameraView || 'host');
    }

    // Ensure Face Tracker is active for 3D holographic head tracking in both disciplines
    if (this.app && this.app.faceTracker && this.app.tracker?.isTracking && !this.app.faceTracker.isTracking) {
      this.app.faceTracker.startTracking();
    }

    // Reset scores & rally for active discipline
    if (this.discipline === 'hockey') {
      this.app.hockeyGame.restartMatch();
    } else {
      this.app.game.restartMatch();
    }

    this.showToast('Match Started');
  }

  togglePause() {
    if (this.state === APP_STATES.PLAYING) {
      this.pauseMatch();
    } else if (this.state === APP_STATES.PAUSED) {
      this.resumeMatch();
    }
  }

  pauseMatch() {
    this.state = APP_STATES.PAUSED;
    if (this.pauseModal) this.pauseModal.classList.add('open');
  }

  resumeMatch() {
    this.state = APP_STATES.PLAYING;
    if (this.pauseModal) this.pauseModal.classList.remove('open');
  }

  quitToMenu() {
    this.state = APP_STATES.MENU;
    document.body.classList.remove('playing');

    // Hide HUD & Modals, Show Hero & Menu
    if (this.inGameHud) this.inGameHud.style.display = 'none';
    if (this.pauseModal) this.pauseModal.classList.remove('open');
    if (this.matchoverModal) this.matchoverModal.classList.remove('open');
    if (this.heroSection) this.heroSection.style.display = 'flex';
    if (this.menuSection) this.menuSection.style.display = 'block';

    // Resume Idle Orbit in 3D scene
    if (this.app && this.app.scene) {
      this.app.scene.setOrbit(true);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.showToast('Returned to Menu');
  }

  onMatchConcluded(result) {
    this.state = APP_STATES.MATCH_OVER;
    if (this.matchoverModal) {
      if (this.matchoverHeadline) {
        this.matchoverHeadline.textContent = `${result.winner} Victorious`;
      }
      if (this.matchoverFinalScore && result.scores) {
        this.matchoverFinalScore.textContent = `${result.scores[0]} - ${result.scores[1]}`;
      }
      this.matchoverModal.classList.add('open');
    }
  }

  updateHUD(p1Score = 0, p2Score = 0, server = 1) {
    // Scoreboard pill: "Player 1  0 - 0  Bot"
    if (this.hudScoreDisplay) {
      this.hudScoreDisplay.textContent = `${p1Score} - ${p2Score}`;
    }

    if (this.hudP1Serve) {
      this.hudP1Serve.classList.toggle('active', server === 1);
    }
    if (this.hudP2Serve) {
      this.hudP2Serve.classList.toggle('active', server === 2);
    }
  }

  updateTrackingStatus(isTracked) {
    if (this.hudTrackingDot) {
      this.hudTrackingDot.classList.toggle('active', isTracked);
      this.hudTrackingDot.classList.toggle('lost', !isTracked);
    }
    if (this.heroSensorDot) {
      this.heroSensorDot.classList.toggle('active', isTracked);
    }
    if (this.hudTrackingLabel) {
      this.hudTrackingLabel.textContent = isTracked ? 'Tracked' : 'Searching';
    }
  }

  updateFPS() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate >= 500) {
      this.fpsCounter = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      if (this.hudFpsCounter) {
        this.hudFpsCounter.textContent = `${this.fpsCounter}`;
      }
    }
  }

  showToast(text) {
    if (!this.actionToast) return;
    this.actionToast.textContent = text;
    this.actionToast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      if (this.actionToast) this.actionToast.classList.remove('show');
    }, 1400);
  }
}
