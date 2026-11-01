/**
 * Procedural Web Audio API Sound Synthesizer for Table Tennis
 * Zero external audio files required. All sounds generated via Web Audio nodes.
 * Features built-in debouncing and velocity scaling to eliminate repeating audio glitches.
 */

class SoundEffects {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
    this.lastTableBounceTime = 0;
    this.lastPaddleHitTime = 0;
    this.lastNetClipTime = 0;
  }

  init() {
    if (this.ctx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
  }

  ensureContext() {
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleSound(enable) {
    this.enabled = enable !== undefined ? enable : !this.enabled;
    return this.enabled;
  }

  /**
   * Paddle hitting ball - crisp rubber "pop/smack"
   * @param {number} intensity - 0.2 to 2.0 based on hit velocity
   * @param {boolean} isSmash - whether it's a hyper smash
   */
  playPaddleHit(intensity = 1.0, isSmash = false) {
    if (!this.enabled) return;
    const now = performance.now();
    // Debounce paddle hits to avoid machine-gun multiple triggering
    if (now - this.lastPaddleHitTime < 110) return;
    this.lastPaddleHitTime = now;

    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const clampedInt = Math.max(0.3, Math.min(2.0, intensity));

    // Pitch oscillator for the rubber bounce thud
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();

    const startFreq = isSmash ? 540 : 420 + Math.random() * 30;
    const endFreq = isSmash ? 160 : 190;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.045);

    oscGain.gain.setValueAtTime(0.55 * clampedInt, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + (isSmash ? 0.08 : 0.055));

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.09);

    // High frequency click / contact transient
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.02);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isSmash ? 2900 : 2300, t);
    filter.Q.setValueAtTime(3.2, t);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime((isSmash ? 0.75 : 0.38) * clampedInt, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noise.start(t);
    noise.stop(t + 0.03);
  }

  /**
   * Table bounce - characteristic resonant wooden table "tok"
   * Debounced to prevent repetitive audio loops when ball rests or rolls on table
   */
  playTableBounce(intensity = 1.0) {
    if (!this.enabled) return;
    const now = performance.now();
    // Strictly debounce table bounces: at least 95ms between bounce sounds
    if (now - this.lastTableBounceTime < 95) return;
    this.lastTableBounceTime = now;

    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const clampedInt = Math.max(0.2, Math.min(1.4, intensity));

    // Wooden table resonance (two harmonic sines)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(320, t);
    osc1.frequency.exponentialRampToValueAtTime(140, t + 0.055);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(640, t);
    osc2.frequency.exponentialRampToValueAtTime(270, t + 0.04);

    gainNode.gain.setValueAtTime(0.45 * clampedInt, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.065);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(this.masterGain);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.075);
    osc2.stop(t + 0.075);
  }

  /**
   * Ball clipping the net
   */
  playNetClip() {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastNetClipTime < 150) return;
    this.lastNetClipTime = now;

    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.linearRampToValueAtTime(90, t + 0.06);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.07);
  }

  /**
   * Score / point scored fanfare:
   * Legendary sparkling victory chime when player scores; gentle soft muted chime when opponent scores.
   * Zero harsh buzzes or grating sawtooth waves.
   *
   * @param {boolean} isPlayer - true if local player scored, false if opponent scored
   */
  playScore(isPlayer = false) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    if (isPlayer) {
      // Legendary rewarding victory arpeggio: E5 -> G#5 -> B5 -> E6
      const freqs = [659.25, 830.61, 987.77, 1318.51];

      freqs.forEach((freq, idx) => {
        const noteTime = t + idx * 0.065;

        // Fundamental warm sine
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, noteTime);

        gain1.gain.setValueAtTime(0, noteTime);
        gain1.gain.linearRampToValueAtTime(0.24, noteTime + 0.015);
        gain1.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.32);

        osc1.connect(gain1);
        gain1.connect(this.masterGain);

        osc1.start(noteTime);
        osc1.stop(noteTime + 0.35);

        // Harmonic overtone for sparkling bell shimmer
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(freq * 2, noteTime);

        gain2.gain.setValueAtTime(0, noteTime);
        gain2.gain.linearRampToValueAtTime(0.09, noteTime + 0.01);
        gain2.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.18);

        osc2.connect(gain2);
        gain2.connect(this.masterGain);

        osc2.start(noteTime);
        osc2.stop(noteTime + 0.20);
      });
    } else {
      // Soft, gentle descending notification (no harsh buzz): A4 -> E4
      const freqs = [440.0, 329.63];

      freqs.forEach((freq, idx) => {
        const noteTime = t + idx * 0.10;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0, noteTime);
        gain.gain.linearRampToValueAtTime(0.14, noteTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.28);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(noteTime);
        osc.stop(noteTime + 0.30);
      });
    }
  }

  /**
   * Legendary Match Championship Victory Fanfare:
   * Multi-part celebratory arcade brass & sparkling chime flourish.
   */
  playMatchVictory() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Part 1: Ascending herald notes (C5 -> E5 -> G5 -> C6)
    const herald = [523.25, 659.25, 783.99, 1046.50];
    herald.forEach((freq, idx) => {
      const noteTime = t + idx * 0.11;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0, noteTime);
      gain.gain.linearRampToValueAtTime(0.28, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 0.38);
    });

    // Part 2: Sustained Grand Major Chord (C4, G4, C5, E5, G5)
    const chordTime = t + 0.48;
    const chordFreqs = [261.63, 392.00, 523.25, 659.25, 783.99];

    chordFreqs.forEach((freq) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, chordTime);

      gain.gain.setValueAtTime(0, chordTime);
      gain.gain.linearRampToValueAtTime(0.18, chordTime + 0.04);
      gain.gain.setValueAtTime(0.18, chordTime + 0.55);
      gain.gain.exponentialRampToValueAtTime(0.001, chordTime + 1.35);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(chordTime);
      osc.stop(chordTime + 1.40);
    });

    // Part 3: Shimmering high victory bells (G6 -> B6 -> C7)
    const sparkleNotes = [1567.98, 1975.53, 2093.00];
    sparkleNotes.forEach((freq, idx) => {
      const noteTime = t + 0.62 + idx * 0.08;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0, noteTime);
      gain.gain.linearRampToValueAtTime(0.12, noteTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.45);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 0.50);
    });
  }

  /**
   * Match Defeat:
   * Smooth, warm, contemplative minor cadence (zero harsh buzz).
   */
  playMatchDefeat() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Gentle descending notes: A4 -> G4 -> F4
    const steps = [440.0, 392.0, 349.23];
    steps.forEach((freq, idx) => {
      const noteTime = t + idx * 0.22;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0, noteTime);
      gain.gain.linearRampToValueAtTime(0.16, noteTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.42);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 0.45);
    });

    // Final soft sustained D minor chord: D3, A3, F4
    const finalChordTime = t + 0.72;
    const finalChord = [146.83, 220.0, 349.23];

    finalChord.forEach((freq) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, finalChordTime);

      gain.gain.setValueAtTime(0, finalChordTime);
      gain.gain.linearRampToValueAtTime(0.12, finalChordTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, finalChordTime + 1.10);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(finalChordTime);
      osc.stop(finalChordTime + 1.15);
    });
  }

  /**
   * Air hockey goal sound:
   * Deep tactile goal cavity thud + celebratory point chime (replaces harsh horn).
   */
  playGoalScored(isPlayer = true) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Resonant sub-bass goal pocket impact (55Hz sweep down to 30Hz)
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(55, t);
    subOsc.frequency.exponentialRampToValueAtTime(30, t + 0.28);

    subGain.gain.setValueAtTime(0.5, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);

    subOsc.start(t);
    subOsc.stop(t + 0.35);

    // Play victory or soft chime
    this.playScore(isPlayer);
  }

  /**
   * Alias for backward compatibility (smooth goal sound instead of harsh buzzer horn)
   */
  playGoalHorn() {
    this.playGoalScored(true);
  }

  /**
   * Polite whistle chime for fault/let
   */
  playFault() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, t);
    osc.frequency.linearRampToValueAtTime(580, t + 0.14);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.18);
  }

  /**
   * Smash activate sound
   */
  playSmashReady() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.15);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.2);
  }

  /**
   * Dual crystal chime when motion & face calibration locks
   */
  playCalibrate() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    [523.25, 1046.50].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.08);

      gain.gain.setValueAtTime(0, t + idx * 0.08);
      gain.gain.linearRampToValueAtTime(0.22, t + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.08 + 0.18);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t + idx * 0.08);
      osc.stop(t + idx * 0.08 + 0.20);
    });
  }

  /**
   * Air hockey striker hitting puck - crisp plastic/felt thud
   */
  playStrikerHit(intensity = 1.0) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const clampedInt = Math.max(0.3, Math.min(1.8, intensity));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.05);

    gain.gain.setValueAtTime(0.5 * clampedInt, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.07);
  }

  /**
   * Air hockey puck hitting aluminum side/end rail - sharp metal clack
   */
  playWallBounce(intensity = 1.0) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const clampedInt = Math.max(0.2, Math.min(1.5, intensity));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880 + Math.random() * 80, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.035);

    gain.gain.setValueAtTime(0.4 * clampedInt, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.05);
  }
}

export const sound = new SoundEffects();
