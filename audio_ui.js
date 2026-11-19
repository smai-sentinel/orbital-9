import * as THREE from 'three';

export class AudioUIManager {
  constructor(gameContext) {
    this.ctx = gameContext;

    // Web Audio API Graph Nodes & State
    this.audioCtx = null;
    this.masterGain = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.softClipCurve = null;

    // Continuous Synth Nodes
    this.ambientGain = null;
    this.breathBandpass = null;
    this.breathGain = null;
    this.thrusterGain = null;
    this.audioInitialized = false;
    this.audioRunning = false;

    // Audio & UI Timers / Phase Accumulators
    this.breathPhase = 0.0;
    this.heartbeatTimer = 0.0;
    this.klaxonTimer = 0.0;
    this.toastTimer = 0.0;
    this.hudGlitchTimer = 0.0;
    this.lastBeepTime = 0.0;
    this.lastBeepProgress = -1.0;
    this.radarSweepAngle = 0.0;
    this.gameOverShown = false;

    // Cached DOM References & 2D Radar Context
    this.dom = {};
    this.radarCtx = null;

    // Pre-allocated Scratch Math Objects (Zero Per-Frame GC Allocations)
    this._camPos = new THREE.Vector3();
    this._camQuat = new THREE.Quaternion();
    this._camRight = new THREE.Vector3();
    this._camForward = new THREE.Vector3();
    this._camUp = new THREE.Vector3();
    this._toTarget = new THREE.Vector3();
    this._dirHat = new THREE.Vector3();
  }

  init() {
    const get = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

    // Bind Canonical DOM Elements with Null-Guards
    this.dom = {
      startOverlay: get('start-overlay'),
      startBtn: get('start-btn'),
      gameoverOverlay: get('gameover-overlay'),
      gameoverReason: get('gameover-reason'),
      restartBtn: get('restart-btn'),
      hudRoot: get('hud-root'),
      hudMode: get('hud-mode'),
      o2Val: get('hud-o2-val'),
      o2Bar: get('hud-o2-bar'),
      hungerVal: get('hud-hunger-val'),
      hungerBar: get('hud-hunger-bar'),
      healthVal: get('hud-health-val'),
      healthBar: get('hud-health-bar'),
      objectiveBox: get('hud-objective-box'),
      objectiveText: get('hud-objective-text'),
      radarCanvas: get('hud-radar-canvas'),
      promptContainer: get('hud-prompt-container'),
      promptLabel: get('hud-prompt-label'),
      holdRingCircle: get('hud-hold-ring-circle'),
      statusFlashlight: get('hud-status-flashlight'),
      statusStabilizer: get('hud-status-stabilizer'),
      statusAcoustic: get('hud-status-acoustic'),
      statusCargo: get('hud-status-cargo'),
      alertVignette: get('hud-alert-vignette'),
      toast: get('hud-toast')
    };

    // Initialize 160x160 2D Tactical Radar Canvas
    if (this.dom.radarCanvas) {
      if (this.dom.radarCanvas.width !== 160) this.dom.radarCanvas.width = 160;
      if (this.dom.radarCanvas.height !== 160) this.dom.radarCanvas.height = 160;
      this.radarCtx = this.dom.radarCanvas.getContext('2d');
    }

    // Ensure SVG Hold Ring has exact 163.36 stroke-dasharray
    if (this.dom.holdRingCircle) {
      this.dom.holdRingCircle.style.strokeDasharray = '163.36';
      this.dom.holdRingCircle.style.strokeDashoffset = '163.36';
    }

    // Bind Passive User-Gesture Audio Unlock Fallback
    if (typeof window !== 'undefined') {
      const unlockHandler = () => {
        try {
          if (!this.audioRunning) {
            this.resumeAudio();
          }
        } catch (_) {
          // Ignore autoplay restriction errors
        }
      };
      window.addEventListener('pointerdown', unlockHandler, { passive: true });
      window.addEventListener('keydown', unlockHandler, { passive: true });
    }

    // Subscribe to Authoritative EventBus Topics
    const events = this.ctx?.events;
    if (events && typeof events.on === 'function') {
      events.on('FOOTSTEP', (payload) => {
        this.playOneShot('FOOTSTEP', payload || {});
      });

      events.on('AIRLOCK_CYCLE_START', (payload) => {
        this.playOneShot('AIRLOCK_CLUNK', payload || {});
        this.playOneShot('AIRLOCK_HISSSS', payload || {});
        const msg =
          payload?.targetMode === 'EVA'
            ? 'AIRLOCK DEPRESSURIZING — PREPARING FOR EVA'
            : 'AIRLOCK RE-PRESSURIZING — ENGAGING MAG-BOOTS';
        this.showToast(msg, 'warn', 3.4);
      });

      events.on('AIRLOCK_CYCLE_COMPLETE', (payload) => {
        this.playOneShot('AIRLOCK_CLUNK', payload || {});
        const msg =
          payload?.mode === 'EVA'
            ? 'OUTER HATCH OPEN — ZERO-G RCS ACTIVE'
            : 'CABIN PRESSURIZED — MAG-BOOTS LOCKED';
        this.showToast(msg, 'info', 3.0);
      });

      events.on('POD_HARVESTED', (payload) => {
        this.playOneShot('PICKUP', payload || {});
        this.showToast('+35% O2 / +40% RATIONS HARVESTED', 'success', 3.2);
      });

      events.on('SUPPLY_LOCKER_USED', (payload) => {
        this.playOneShot('PICKUP', payload || {});
        this.showToast('LIFE SUPPORT REPLENISHED', 'success', 3.0);
      });

      events.on('BREACH_ALARM_TRIGGERED', (payload) => {
        this.klaxonTimer = 0.0;
        this.playOneShot('KLAXON', payload || {});
        this.klaxonTimer = 1.4;
        this.showToast('CRITICAL: SECTOR BREACH DETECTED', 'alert', 4.5);
      });

      events.on('LOCKDOWN_HOLD_TICK', (payload) => {
        const progress = Number(payload?.progress ?? 0);
        const now = Number(this.ctx?.elapsed ?? performance.now() * 0.001);
        if (progress <= 0.01) {
          this.lastBeepProgress = -1.0;
          return;
        }
        if (now - this.lastBeepTime >= 0.14 || progress - this.lastBeepProgress >= 0.08) {
          this.lastBeepTime = now;
          this.lastBeepProgress = progress;
          this.playOneShot('BEEP', { progress });
        }
      });

      events.on('LOCKDOWN_EXECUTED', (payload) => {
        this.playOneShot('LOCKDOWN_SLAM', payload || {});
        this.showToast('EMERGENCY LOCKDOWN ENGAGED — PURGING VENTS', 'warn', 4.2);
      });

      events.on('LOCKDOWN_CLEAR', (payload) => {
        this.playOneShot('PICKUP', payload || {});
        this.showToast('BREACH REPELLED — POWER & O2 RESTORED', 'success', 4.0);
      });

      events.on('PLAYER_DAMAGED', (payload) => {
        this.playOneShot('DAMAGE', payload || {});
        this.hudGlitchTimer = 0.45;
      });

      events.on('ALIEN_SCREECH', (payload) => {
        this.playOneShot('ALIEN_SCREECH', payload || {});
      });
    }

    // Perform Initial Frame-0 HUD and Radar Render
    this._updateHUD(0.016, 0.0);
    this._renderRadar(0.016, 0.0);
  }

  _makeDistortionCurve(amount = 50) {
    const k = typeof amount === 'number' ? amount : 50;
    const nSamples = 1024;
    const curve = new Float32Array(nSamples);
    const deg = Math.PI / 180;
    for (let i = 0; i < nSamples; ++i) {
      const x = (i * 2) / nSamples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  resumeAudio() {
    try {
      if (typeof window === 'undefined') return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      if (!this.audioInitialized && this.audioCtx) {
        const ac = this.audioCtx;

        // 1. Master Dynamics Compressor & Master Gain
        this.compressor = ac.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-14, ac.currentTime);
        this.compressor.knee.setValueAtTime(18, ac.currentTime);
        this.compressor.ratio.setValueAtTime(6, ac.currentTime);
        this.compressor.attack.setValueAtTime(0.005, ac.currentTime);
        this.compressor.release.setValueAtTime(0.18, ac.currentTime);
        this.compressor.connect(ac.destination);

        this.masterGain = ac.createGain();
        this.masterGain.gain.setValueAtTime(0.85, ac.currentTime);
        this.masterGain.connect(this.compressor);

        // 2. Shared 4-Second White Noise Buffer & Distortion Curve
        const bufferSize = ac.sampleRate * 4;
        this.noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
        const output = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }
        this.softClipCurve = this._makeDistortionCurve(35);

        // 3. Continuous Subtle Station / Deep-Space Ambient Hull Hum
        const ambFilter = ac.createBiquadFilter();
        ambFilter.type = 'lowpass';
        ambFilter.frequency.setValueAtTime(130, ac.currentTime);
        ambFilter.Q.setValueAtTime(1.1, ac.currentTime);

        this.ambientGain = ac.createGain();
        this.ambientGain.gain.setValueAtTime(0.06, ac.currentTime);

        const ambOsc1 = ac.createOscillator();
        ambOsc1.type = 'sine';
        ambOsc1.frequency.setValueAtTime(46, ac.currentTime);

        const ambOsc2 = ac.createOscillator();
        ambOsc2.type = 'triangle';
        ambOsc2.frequency.setValueAtTime(69, ac.currentTime);
        const ambOsc2Gain = ac.createGain();
        ambOsc2Gain.gain.setValueAtTime(0.45, ac.currentTime);

        const ambNoise = ac.createBufferSource();
        ambNoise.buffer = this.noiseBuffer;
        ambNoise.loop = true;
        const ambNoiseGain = ac.createGain();
        ambNoiseGain.gain.setValueAtTime(0.15, ac.currentTime);

        ambOsc1.connect(ambFilter);
        ambOsc2.connect(ambOsc2Gain);
        ambOsc2Gain.connect(ambFilter);
        ambNoise.connect(ambNoiseGain);
        ambNoiseGain.connect(ambFilter);
        ambFilter.connect(this.ambientGain);
        this.ambientGain.connect(this.masterGain);

        ambOsc1.start();
        ambOsc2.start();
        ambNoise.start();

        // 4. Continuous Muffled Helmet Breathing Loop (PLAN.md Section 7.1 #1)
        const breathNoise = ac.createBufferSource();
        breathNoise.buffer = this.noiseBuffer;
        breathNoise.loop = true;

        const breathLowpass = ac.createBiquadFilter();
        breathLowpass.type = 'lowpass';
        breathLowpass.frequency.setValueAtTime(480, ac.currentTime);

        this.breathBandpass = ac.createBiquadFilter();
        this.breathBandpass.type = 'bandpass';
        this.breathBandpass.frequency.setValueAtTime(650, ac.currentTime);
        this.breathBandpass.Q.setValueAtTime(4.5, ac.currentTime);

        this.breathGain = ac.createGain();
        this.breathGain.gain.setValueAtTime(0.04, ac.currentTime);

        breathNoise.connect(breathLowpass);
        breathLowpass.connect(this.breathBandpass);
        this.breathBandpass.connect(this.breathGain);
        this.breathGain.connect(this.masterGain);
        breathNoise.start();

        // 5. Continuous RCS Jetpack Thruster Rumble (PLAN.md Section 7.1 #4)
        const thrustNoise = ac.createBufferSource();
        thrustNoise.buffer = this.noiseBuffer;
        thrustNoise.loop = true;

        const thrustNoiseFilter = ac.createBiquadFilter();
        thrustNoiseFilter.type = 'lowpass';
        thrustNoiseFilter.frequency.setValueAtTime(240, ac.currentTime);
        thrustNoiseFilter.Q.setValueAtTime(1.2, ac.currentTime);

        const thrustSaw = ac.createOscillator();
        thrustSaw.type = 'sawtooth';
        thrustSaw.frequency.setValueAtTime(68, ac.currentTime);

        const thrustSawFilter = ac.createBiquadFilter();
        thrustSawFilter.type = 'lowpass';
        thrustSawFilter.frequency.setValueAtTime(180, ac.currentTime);

        const thrustSawGain = ac.createGain();
        thrustSawGain.gain.setValueAtTime(0.28, ac.currentTime);

        this.thrusterGain = ac.createGain();
        this.thrusterGain.gain.setValueAtTime(0.0, ac.currentTime);

        thrustNoise.connect(thrustNoiseFilter);
        thrustNoiseFilter.connect(this.thrusterGain);

        thrustSaw.connect(thrustSawFilter);
        thrustSawFilter.connect(thrustSawGain);
        thrustSawGain.connect(this.thrusterGain);

        this.thrusterGain.connect(this.masterGain);

        thrustNoise.start();
        thrustSaw.start();

        this.audioInitialized = true;
      }

      this.audioRunning = this.audioCtx && this.audioCtx.state === 'running';
    } catch (_) {
      // Never throw on headless or restricted audio environments
    }
  }

  _triggerHeartbeat(now, stressLevel = 0.5) {
    if (!this.audioCtx || this.audioCtx.state !== 'running' || !this.masterGain) return;
    try {
      const ac = this.audioCtx;
      const gainAmp = 0.14 + 0.16 * Math.min(1, stressLevel);

      // Dual-pulse sub-bass heartbeat (lub-dub)
      const offsets = [0.0, 0.22];
      const amps = [gainAmp, gainAmp * 0.72];

      for (let i = 0; i < 2; i++) {
        const t0 = now + offsets[i];
        const osc = ac.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(58, t0);
        osc.frequency.exponentialRampToValueAtTime(32, t0 + 0.09);

        const g = ac.createGain();
        g.gain.setValueAtTime(0.001, t0);
        g.gain.linearRampToValueAtTime(amps[i], t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);

        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + 0.15);
      }
    } catch (_) {}
  }

  playOneShot(type, params = {}) {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    if (this.audioCtx.state !== 'running' || !this.masterGain) return;

    try {
      const ac = this.audioCtx;
      const now = ac.currentTime;

      switch (type) {
        case 'FOOTSTEP': {
          const surface = params.surface || 'GRATE';
          const intensity = Math.min(1.2, Math.max(0.2, Number(params.intensity ?? 0.75)));
          const jitter = 0.97 + Math.random() * 0.06;

          // 1. Impact Transient Noise Burst (0.045s) -> Bandpass (1100 Hz, Q = 3.0)
          if (this.noiseBuffer) {
            const noise = ac.createBufferSource();
            noise.buffer = this.noiseBuffer;

            const bp = ac.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(1100 * jitter, now);
            bp.Q.setValueAtTime(3.0, now);

            const ng = ac.createGain();
            ng.gain.setValueAtTime(0.24 * intensity, now);
            ng.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

            noise.connect(bp);
            bp.connect(ng);
            ng.connect(this.masterGain);

            noise.start(now, Math.random() * 2.5, 0.05);
            noise.stop(now + 0.05);
          }

          // 2. Metallic Ring: Two Detuned Triangle Oscillators
          const f1 = (surface === 'STEEL' ? 210 : 380) * jitter;
          const f2 = (surface === 'STEEL' ? 315 : 542) * jitter;

          const osc1 = ac.createOscillator();
          const osc2 = ac.createOscillator();
          osc1.type = 'triangle';
          osc2.type = 'triangle';
          osc1.frequency.setValueAtTime(f1, now);
          osc2.frequency.setValueAtTime(f2, now);
          osc1.frequency.exponentialRampToValueAtTime(f1 * 0.72, now + 0.08);
          osc2.frequency.exponentialRampToValueAtTime(f2 * 0.72, now + 0.08);

          const rg = ac.createGain();
          rg.gain.setValueAtTime(0.11 * intensity, now);
          rg.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

          osc1.connect(rg);
          osc2.connect(rg);
          rg.connect(this.masterGain);

          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 0.085);
          osc2.stop(now + 0.085);
          break;
        }

        case 'AIRLOCK_CLUNK': {
          // Mechanical Seal Clunk: Sine (140Hz -> 38Hz over 0.18s) + Square (95Hz, 0.06s) -> WaveShaper
          const shaper = ac.createWaveShaper();
          shaper.curve = this.softClipCurve || this._makeDistortionCurve(45);

          const lp = ac.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(550, now);

          const outGain = ac.createGain();
          outGain.gain.setValueAtTime(0.45, now);
          outGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

          const sine = ac.createOscillator();
          sine.type = 'sine';
          sine.frequency.setValueAtTime(140, now);
          sine.frequency.exponentialRampToValueAtTime(38, now + 0.18);

          const sq = ac.createOscillator();
          sq.type = 'square';
          sq.frequency.setValueAtTime(95, now);
          const sqGain = ac.createGain();
          sqGain.gain.setValueAtTime(0.35, now);
          sqGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

          sine.connect(shaper);
          sq.connect(sqGain);
          sqGain.connect(shaper);

          if (this.noiseBuffer) {
            const latchNoise = ac.createBufferSource();
            latchNoise.buffer = this.noiseBuffer;
            const latchGain = ac.createGain();
            latchGain.gain.setValueAtTime(0.22, now);
            latchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
            latchNoise.connect(latchGain);
            latchGain.connect(shaper);
            latchNoise.start(now, 0.2, 0.08);
            latchNoise.stop(now + 0.08);
          }

          shaper.connect(lp);
          lp.connect(outGain);
          outGain.connect(this.masterGain);

          sine.start(now);
          sq.start(now);
          sine.stop(now + 0.25);
          sq.stop(now + 0.07);
          break;
        }

        case 'AIRLOCK_HISSSS': {
          // 3.5s Vacuum Pressure Sweep: WhiteNoise -> Bandpass (Q = 2.2, 2400Hz -> 120Hz)
          if (!this.noiseBuffer) break;
          const noise = ac.createBufferSource();
          noise.buffer = this.noiseBuffer;
          noise.loop = true;

          const bp = ac.createBiquadFilter();
          bp.type = 'bandpass';
          bp.Q.setValueAtTime(2.2, now);
          bp.frequency.setValueAtTime(2400, now);
          bp.frequency.exponentialRampToValueAtTime(120, now + 3.5);

          const hg = ac.createGain();
          hg.gain.setValueAtTime(0.001, now);
          hg.gain.linearRampToValueAtTime(0.32, now + 0.15);
          hg.gain.exponentialRampToValueAtTime(0.002, now + 3.5);

          noise.connect(bp);
          bp.connect(hg);
          hg.connect(this.masterGain);

          noise.start(now);
          noise.stop(now + 3.55);
          break;
        }

        case 'ALIEN_SCREECH': {
          // FM Screech: Modulator Sine (68 Hz) -> ModGain (420) -> Carrier Sawtooth (1450 -> 620 Hz over 0.7s)
          const modOsc = ac.createOscillator();
          modOsc.type = 'sine';
          modOsc.frequency.setValueAtTime(68, now);

          const modGain = ac.createGain();
          modGain.gain.setValueAtTime(420, now);

          const carrier = ac.createOscillator();
          carrier.type = 'sawtooth';
          carrier.frequency.setValueAtTime(1450, now);
          carrier.frequency.exponentialRampToValueAtTime(620, now + 0.7);

          modOsc.connect(modGain);
          modGain.connect(carrier.frequency);

          const peakFilter = ac.createBiquadFilter();
          peakFilter.type = 'peaking';
          peakFilter.frequency.setValueAtTime(2200, now);
          peakFilter.gain.setValueAtTime(8, now);
          peakFilter.Q.setValueAtTime(2.0, now);

          // 3D Spatial Panning & Distance Attenuation
          let panValue = 0.0;
          let distGain = 0.75;
          const srcPos = params.position;
          const cam = this.ctx?.camera;
          const player = this.ctx?.player;

          if (srcPos && typeof srcPos.x === 'number') {
            if (cam && cam.position) {
              if (cam.parent && cam.parent !== this.ctx?.scene && typeof cam.getWorldPosition === 'function') {
                cam.updateMatrixWorld();
                cam.getWorldPosition(this._camPos);
                cam.getWorldQuaternion(this._camQuat);
              } else {
                this._camPos.copy(cam.position);
                this._camQuat.copy(cam.quaternion);
              }
            } else if (player && player.position) {
              this._camPos.copy(player.position);
              if (player.quaternion) this._camQuat.copy(player.quaternion);
            }
            this._camRight.set(1, 0, 0).applyQuaternion(this._camQuat).normalize();
            this._toTarget.set(srcPos.x - this._camPos.x, srcPos.y - this._camPos.y, srcPos.z - this._camPos.z);
            const dist = this._toTarget.length();
            if (dist > 0.001) {
              this._dirHat.copy(this._toTarget).divideScalar(dist);
              panValue = Math.max(-1, Math.min(1, this._camRight.dot(this._dirHat)));
            }
            const atten = Math.max(0.05, Math.min(1.0, 1.0 - dist / 45.0));
            distGain = atten * atten;
          }

          const envGain = ac.createGain();
          const peakAmp = 0.36 * distGain;
          envGain.gain.setValueAtTime(0.001, now);
          envGain.gain.linearRampToValueAtTime(peakAmp, now + 0.04);
          envGain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

          carrier.connect(peakFilter);
          peakFilter.connect(envGain);

          if (typeof ac.createStereoPanner === 'function') {
            const panner = ac.createStereoPanner();
            panner.pan.setValueAtTime(panValue, now);
            envGain.connect(panner);
            panner.connect(this.masterGain);
          } else {
            envGain.connect(this.masterGain);
          }

          modOsc.start(now);
          carrier.start(now);
          modOsc.stop(now + 0.78);
          carrier.stop(now + 0.78);
          break;
        }

        case 'LOCKDOWN_SLAM': {
          // 1. Massive Sub-Bass Blast Door Impact (Sine 115->24Hz + Triangle 64->26Hz)
          const shaper = ac.createWaveShaper();
          shaper.curve = this.softClipCurve || this._makeDistortionCurve(55);

          const subOsc = ac.createOscillator();
          subOsc.type = 'sine';
          subOsc.frequency.setValueAtTime(115, now);
          subOsc.frequency.exponentialRampToValueAtTime(24, now + 0.65);

          const triOsc = ac.createOscillator();
          triOsc.type = 'triangle';
          triOsc.frequency.setValueAtTime(64, now);
          triOsc.frequency.exponentialRampToValueAtTime(26, now + 0.65);

          const subGain = ac.createGain();
          subGain.gain.setValueAtTime(0.65, now);
          subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.72);

          subOsc.connect(shaper);
          triOsc.connect(shaper);
          shaper.connect(subGain);
          subGain.connect(this.masterGain);

          subOsc.start(now);
          triOsc.start(now);
          subOsc.stop(now + 0.75);
          triOsc.stop(now + 0.75);

          // 2. Metallic Hull Resonance Clang (3 Inharmonic Partials)
          const partials = [185, 312, 520];
          for (let i = 0; i < partials.length; i++) {
            const pOsc = ac.createOscillator();
            pOsc.type = 'triangle';
            pOsc.frequency.setValueAtTime(partials[i], now);
            pOsc.frequency.exponentialRampToValueAtTime(partials[i] * 0.85, now + 0.45);

            const pg = ac.createGain();
            pg.gain.setValueAtTime(0.12 / (i + 1), now);
            pg.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

            pOsc.connect(pg);
            pg.connect(this.masterGain);
            pOsc.start(now);
            pOsc.stop(now + 0.48);
          }

          // 3. 2.8s High-Pressure Thermal Vent Steam Hiss
          if (this.noiseBuffer) {
            const steamNoise = ac.createBufferSource();
            steamNoise.buffer = this.noiseBuffer;
            steamNoise.loop = true;

            const sBp = ac.createBiquadFilter();
            sBp.type = 'bandpass';
            sBp.Q.setValueAtTime(1.6, now + 0.12);
            sBp.frequency.setValueAtTime(1850, now + 0.12);
            sBp.frequency.exponentialRampToValueAtTime(580, now + 2.9);

            const sg = ac.createGain();
            sg.gain.setValueAtTime(0.001, now);
            sg.gain.linearRampToValueAtTime(0.34, now + 0.25);
            sg.gain.exponentialRampToValueAtTime(0.002, now + 2.9);

            steamNoise.connect(sBp);
            sBp.connect(sg);
            sg.connect(this.masterGain);

            steamNoise.start(now + 0.1);
            steamNoise.stop(now + 2.95);
          }
          break;
        }

        case 'PICKUP': {
          // Crisp Sci-Fi Dual-Chime (660Hz -> 990Hz -> 1320Hz shimmer)
          const notes = [660, 990, 1320];
          for (let i = 0; i < notes.length; i++) {
            const t0 = now + i * 0.065;
            const osc = ac.createOscillator();
            osc.type = i === 2 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(notes[i], t0);

            const g = ac.createGain();
            g.gain.setValueAtTime(0.001, t0);
            g.gain.linearRampToValueAtTime(0.18, t0 + 0.012);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);

            osc.connect(g);
            g.connect(this.masterGain);
            osc.start(t0);
            osc.stop(t0 + 0.25);
          }
          break;
        }

        case 'DAMAGE': {
          // Visceral Suit Impact Thud + Polycarbonate Visor Static Crackle
          const thud = ac.createOscillator();
          thud.type = 'sine';
          thud.frequency.setValueAtTime(130, now);
          thud.frequency.exponentialRampToValueAtTime(34, now + 0.22);

          const crunch = ac.createOscillator();
          crunch.type = 'sawtooth';
          crunch.frequency.setValueAtTime(82, now);
          crunch.frequency.exponentialRampToValueAtTime(28, now + 0.18);

          const shaper = ac.createWaveShaper();
          shaper.curve = this.softClipCurve || this._makeDistortionCurve(60);

          const tg = ac.createGain();
          tg.gain.setValueAtTime(0.55, now);
          tg.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

          thud.connect(shaper);
          crunch.connect(shaper);
          shaper.connect(tg);
          tg.connect(this.masterGain);

          thud.start(now);
          crunch.start(now);
          thud.stop(now + 0.28);
          crunch.stop(now + 0.22);

          if (this.noiseBuffer) {
            const crackle = ac.createBufferSource();
            crackle.buffer = this.noiseBuffer;

            const hp = ac.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.setValueAtTime(2800, now);

            const cg = ac.createGain();
            cg.gain.setValueAtTime(0.28, now);
            cg.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

            crackle.connect(hp);
            hp.connect(cg);
            cg.connect(this.masterGain);

            crackle.start(now, Math.random() * 1.5, 0.29);
            crackle.stop(now + 0.29);
          }
          break;
        }

        case 'BEEP': {
          // Console Hold Confirmation Tick ascending smoothly with progress
          const progress = Math.max(0, Math.min(1, Number(params.progress ?? 0)));
          const freq = 520 + progress * 720;

          const osc1 = ac.createOscillator();
          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(freq, now);

          const osc2 = ac.createOscillator();
          osc2.type = 'triangle';
          osc2.frequency.setValueAtTime(freq * 1.5, now);

          const g1 = ac.createGain();
          g1.gain.setValueAtTime(0.13, now);
          g1.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

          const g2 = ac.createGain();
          g2.gain.setValueAtTime(0.04, now);
          g2.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

          osc1.connect(g1);
          osc2.connect(g2);
          g1.connect(this.masterGain);
          g2.connect(this.masterGain);

          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 0.07);
          osc2.stop(now + 0.07);
          break;
        }

        case 'KLAXON': {
          // Dual-Oscillator Industrial Horn (PLAN.md Section 7.1 #5)
          // Sawtooth 440Hz base (420->680 over 0.55s, hold 0.25s, drop to 310 over 0.30s)
          // Paired with Square 587Hz base (560->907->413Hz)
          const saw = ac.createOscillator();
          saw.type = 'sawtooth';
          saw.frequency.setValueAtTime(420, now);
          saw.frequency.linearRampToValueAtTime(680, now + 0.55);
          saw.frequency.setValueAtTime(680, now + 0.80);
          saw.frequency.linearRampToValueAtTime(310, now + 1.10);

          const sq = ac.createOscillator();
          sq.type = 'square';
          sq.frequency.setValueAtTime(560, now);
          sq.frequency.linearRampToValueAtTime(907, now + 0.55);
          sq.frequency.setValueAtTime(907, now + 0.80);
          sq.frequency.linearRampToValueAtTime(413, now + 1.10);

          const lp = ac.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(1600, now);

          const shaper = ac.createWaveShaper();
          shaper.curve = this.softClipCurve || this._makeDistortionCurve(25);

          const kg = ac.createGain();
          kg.gain.setValueAtTime(0.001, now);
          kg.gain.linearRampToValueAtTime(0.18, now + 0.05);
          kg.gain.setValueAtTime(0.18, now + 0.85);
          kg.gain.exponentialRampToValueAtTime(0.001, now + 1.12);

          saw.connect(lp);
          sq.connect(lp);
          lp.connect(shaper);
          shaper.connect(kg);
          kg.connect(this.masterGain);

          saw.start(now);
          sq.start(now);
          saw.stop(now + 1.15);
          sq.stop(now + 1.15);
          break;
        }

        default:
          break;
      }
    } catch (_) {
      // Safeguard against Web Audio API scheduling exceptions
    }
  }

  showToast(message, level = 'info', duration = 3.0) {
    this.toastTimer = duration;
    const toast = this.dom.toast;
    if (!toast) return;

    toast.textContent = message;
    toast.classList.remove(
      'hidden',
      'info',
      'warn',
      'warning',
      'alert',
      'critical',
      'success',
      'toast-info',
      'toast-warn',
      'toast-alert',
      'toast-success'
    );
    toast.classList.add('visible', level, `toast-${level}`);
    toast.style.opacity = '1';

    if (level === 'alert') {
      toast.style.borderColor = '#ef4444';
      toast.style.color = '#fecaca';
    } else if (level === 'warn') {
      toast.style.borderColor = '#f59e0b';
      toast.style.color = '#fde68a';
    } else if (level === 'success') {
      toast.style.borderColor = '#10b981';
      toast.style.color = '#a7f3d0';
    } else {
      toast.style.borderColor = '#38bdf8';
      toast.style.color = '#bae6fd';
    }
  }

  update(dt, elapsed) {
    const safeDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    const safeElapsed = Number(elapsed) || 0;

    this._updateAudioModulation(safeDt, safeElapsed);
    this._updateHUD(safeDt, safeElapsed);
    this._renderRadar(safeDt, safeElapsed);
  }

  _updateAudioModulation(dt) {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;
    this.audioRunning = true;

    const ac = this.audioCtx;
    const now = ac.currentTime;
    const player = this.ctx?.player;
    const station = this.ctx?.station;

    const o2 = Math.max(0, Math.min(100, Number(player?.oxygen ?? 100)));
    const panic = Math.max(0, Math.min(1, Number(player?.panic ?? 0)));
    const hypoxia = 1.0 - o2 / 100.0;

    // 1. Dynamic Helmet Breathing Modulation (PLAN.md Section 7.1 #1)
    const fBreath = 0.28 + 0.65 * panic + 0.45 * hypoxia;
    this.breathPhase = (this.breathPhase + fBreath * dt) % 1.0;

    if (this.breathBandpass && this.breathGain) {
      let targetFreq = 650;
      let env = 0.02;

      if (this.breathPhase < 0.42) {
        // Inhale Phase: sweeps 580 Hz -> 920 Hz
        const u = this.breathPhase / 0.42;
        targetFreq = 580 + (920 - 580) * Math.sin(u * Math.PI * 0.5);
        env = Math.sin(u * Math.PI);
      } else if (this.breathPhase > 0.5 && this.breathPhase < 0.94) {
        // Exhale Phase: sweeps 780 Hz -> 420 Hz
        const u = (this.breathPhase - 0.5) / 0.44;
        targetFreq = 780 - (780 - 420) * u;
        env = Math.sin(u * Math.PI) * 0.85;
      }

      const ampScale = 0.032 + 0.065 * Math.max(panic, hypoxia);
      this.breathBandpass.frequency.setTargetAtTime(targetFreq, now, 0.04);
      this.breathGain.gain.setTargetAtTime(Math.max(0.002, env * ampScale), now, 0.04);
    }

    // 2. Sub-Bass Heartbeat Loop when Panic > 0.35 or O2 < 35%
    if ((panic > 0.35 || o2 < 35.0) && !this.ctx?.isGameOver && !this.ctx?.isPaused) {
      const stress = Math.max(panic, (35.0 - o2) / 35.0);
      const beatInterval = Math.max(0.45, 0.95 - 0.45 * stress);
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        this._triggerHeartbeat(now, stress);
        this.heartbeatTimer = beatInterval;
      }
    } else {
      this.heartbeatTimer = 0.0;
    }

    // 3. RCS Jetpack Thruster Rumble Modulation
    if (this.thrusterGain) {
      const thrustTarget =
        player?.isThrusting && !this.ctx?.isPaused && !this.ctx?.isGameOver ? 0.32 : 0.0;
      this.thrusterGain.gain.setTargetAtTime(thrustTarget, now, 0.05);
    }

    // 4. Ambient Station Hull Hum Modulation
    if (this.ambientGain) {
      const ambTarget = player?.mode === 'EVA' ? 0.024 : 0.065;
      this.ambientGain.gain.setTargetAtTime(ambTarget, now, 0.15);
    }

    // 5. Repeating Emergency Breach Alarm Klaxon (Every 1.4s during Red Alert)
    if (station?.alarmActive && !this.ctx?.isPaused && !this.ctx?.isGameOver) {
      this.klaxonTimer -= dt;
      if (this.klaxonTimer <= 0) {
        this.playOneShot('KLAXON');
        this.klaxonTimer = 1.4;
      }
    } else {
      this.klaxonTimer = 0.0;
    }
  }

  _updateVitalBar(valEl, barEl, rawValue) {
    const pct = Math.max(0, Math.min(100, Number(rawValue ?? 100)));
    const rounded = Math.round(pct);
    if (valEl) {
      valEl.textContent = `${rounded}%`;
      if (pct <= 25) {
        valEl.style.color = '#fca5a5';
      } else if (pct <= 50) {
        valEl.style.color = '#fde68a';
      } else {
        valEl.style.color = '';
      }
    }
    if (barEl) {
      barEl.style.width = `${pct.toFixed(1)}%`;
      barEl.classList.remove('nominal', 'warn', 'warning', 'critical', 'danger');
      if (pct <= 25) {
        barEl.classList.add('critical', 'danger');
      } else if (pct <= 50) {
        barEl.classList.add('warning', 'warn');
      } else {
        barEl.classList.add('nominal');
      }
    }
  }

  _updateHUD(dt, elapsed) {
    const player = this.ctx?.player;
    const station = this.ctx?.station;

    // 1. Suit Vitals Bars (O2, Hunger, Health)
    this._updateVitalBar(this.dom.o2Val, this.dom.o2Bar, player?.oxygen ?? 100);
    this._updateVitalBar(this.dom.hungerVal, this.dom.hungerBar, player?.hunger ?? 100);
    this._updateVitalBar(this.dom.healthVal, this.dom.healthBar, player?.health ?? 100);

    // 2. Mode & Propulsion Telemetry Header
    if (this.dom.hudMode) {
      const mode = player?.mode || 'INTERIOR';
      const airlockState = station?.airlockState || 'PRESSURIZED_INNER';
      const isAlert = Boolean(station?.alarmActive);
      this.dom.hudMode.classList.toggle('eva', mode === 'EVA');
      this.dom.hudMode.classList.toggle('alert', isAlert);

      if (
        mode === 'AIRLOCK_TRANSITION' ||
        airlockState === 'CYCLING_TO_EVA' ||
        airlockState === 'CYCLING_TO_INTERIOR'
      ) {
        const prog = Math.round((station?.airlockProgress ?? 0) * 100);
        this.dom.hudMode.textContent = `MODE: AIRLOCK CYCLING (${prog}%)`;
      } else if (mode === 'EVA') {
        const stab = player?.stabilizersOn !== false ? 'STABILIZER ON' : 'FREE DRIFT';
        this.dom.hudMode.textContent = `MODE: ZERO-G EVA // ${stab}`;
      } else {
        this.dom.hudMode.textContent = 'MODE: INTERIOR // MAG-BOOTS LOCKED';
      }
    }

    // 3. Dynamic Objective Banner
    if (this.dom.objectiveText) {
      let objMsg = 'CYCLE AIRLOCK & SCAVENGE FOOD/O2 PODS OUTSIDE';
      let isAlert = false;

      if (station?.lockdownActive) {
        objMsg = 'LOCKDOWN ACTIVE — THERMAL VENT PURGE IN PROGRESS';
      } else if (station?.alarmActive) {
        objMsg = 'CRITICAL: BREACH DETECTED — ACTIVATE BRIDGE LOCKDOWN [HOLD E]';
        isAlert = true;
      } else if (player?.mode === 'EVA') {
        objMsg = 'SCAVENGE FLOATING SUPPLY PODS (CYAN RADAR)';
      }

      this.dom.objectiveText.textContent = objMsg;

      if (this.dom.objectiveBox) {
        this.dom.objectiveBox.classList.toggle('alert', isAlert);
        if (isAlert) {
          const pulse = 0.55 + 0.45 * Math.sin(elapsed * 8.0);
          this.dom.objectiveBox.style.borderColor = `rgba(239, 68, 68, ${pulse.toFixed(2)})`;
          this.dom.objectiveBox.style.color = '#fecaca';
        } else {
          this.dom.objectiveBox.style.borderColor = '';
          this.dom.objectiveBox.style.color = '';
        }
      }
    }

    // 4. Contextual [E] Reticle Prompt & SVG Radial Hold Progress Ring (circumference = 163.36)
    const activePrompt = player?.activePrompt;
    if (this.dom.promptContainer) {
      if (activePrompt && !this.ctx?.isGameOver) {
        this.dom.promptContainer.classList.remove('hidden');
        this.dom.promptContainer.classList.add('visible');
        this.dom.promptContainer.style.opacity = '1';

        const holdDur = Number(activePrompt.holdDuration ?? 0);
        let holdProg = Number(activePrompt.holdProgress ?? 0);
        if (activePrompt.id === 'BRIDGE_LOCKDOWN_CONSOLE' && station?.lockdownHoldProgress > holdProg) {
          holdProg = station.lockdownHoldProgress;
        }
        holdProg = Math.max(0, Math.min(1, holdProg));

        if (this.dom.promptLabel) {
          const rawLabel = String(activePrompt.label || 'INTERACT');
          const hasBracket = rawLabel.includes('[E]') || rawLabel.includes('[HOLD E]');
          if (hasBracket) {
            this.dom.promptLabel.textContent = rawLabel;
          } else {
            this.dom.promptLabel.textContent = holdDur > 0 ? `[HOLD E] ${rawLabel}` : `[E] ${rawLabel}`;
          }
        }

        if (this.dom.holdRingCircle) {
          const dashOffset = (163.36 * (1.0 - holdProg)).toFixed(2);
          this.dom.holdRingCircle.style.strokeDashoffset = dashOffset;
          this.dom.holdRingCircle.setAttribute('stroke-dashoffset', dashOffset);
          this.dom.holdRingCircle.style.stroke =
            activePrompt.id === 'BRIDGE_LOCKDOWN_CONSOLE' ? '#ef4444' : '#38bdf8';
        }
      } else {
        this.dom.promptContainer.classList.add('hidden');
        this.dom.promptContainer.classList.remove('visible');
        this.dom.promptContainer.style.opacity = '0';
        if (this.dom.holdRingCircle) {
          this.dom.holdRingCircle.style.strokeDashoffset = '163.36';
          this.dom.holdRingCircle.setAttribute('stroke-dashoffset', '163.36');
        }
      }
    }

    // 5. Bottom Suit Telemetry Badges
    if (this.dom.statusFlashlight) {
      const fOn = player?.flashlightOn !== false;
      this.dom.statusFlashlight.textContent = `FLASHLIGHT [F]: ${fOn ? 'ON' : 'OFF'}`;
      this.dom.statusFlashlight.classList.toggle('active', fOn);
    }

    if (this.dom.statusStabilizer) {
      const sOn = player?.stabilizersOn !== false;
      this.dom.statusStabilizer.textContent = `RCS DAMPENERS [R]: ${sOn ? 'ON' : 'OFF'}`;
      this.dom.statusStabilizer.classList.toggle('active', sOn);
      this.dom.statusStabilizer.classList.toggle('warning', !sOn);
    }

    if (this.dom.statusAcoustic) {
      const rad = Number(player?.acousticRadius ?? 1.5);
      let sigLevel = 'LOW';
      if (rad >= 20) sigLevel = 'CRITICAL';
      else if (rad >= 8) sigLevel = 'ELEVATED';
      this.dom.statusAcoustic.textContent = `ACOUSTIC SIG: ${sigLevel} ${rad.toFixed(1)}m`;
      this.dom.statusAcoustic.classList.remove('active', 'warning', 'critical');
      if (sigLevel === 'CRITICAL') this.dom.statusAcoustic.classList.add('critical');
      else if (sigLevel === 'ELEVATED') this.dom.statusAcoustic.classList.add('warning');
      else this.dom.statusAcoustic.classList.add('active');
    }

    if (this.dom.statusCargo) {
      const o2Cells = Number(player?.carriedO2Cells ?? 0);
      const rations = Number(player?.carriedRations ?? 0);
      const relays = Number(player?.repairedRelays ?? 0);
      const hasCargo = o2Cells > 0 || rations > 0;
      const hint = hasCargo ? ' [H/V]' : '';
      this.dom.statusCargo.textContent = `CARGO: ${o2Cells} O2 | ${rations} RAT | ${relays} REL${hint}`;
      this.dom.statusCargo.classList.toggle('active', hasCargo || relays > 0);
    }

    // 6. Red Alert / Damage Vignette & HUD Glitch Jitter
    if (this.dom.alertVignette) {
      const dmg = Math.max(0, Math.min(1, Number(player?.damageFlash ?? 0)));
      const o2 = Number(player?.oxygen ?? 100);
      const lowO2Pulse = o2 < 25 ? ((25 - o2) / 25) * (0.4 + 0.3 * Math.sin(elapsed * 6.0)) : 0;
      const alarmPulse = station?.alarmActive ? 0.25 + 0.2 * Math.sin(elapsed * 5.5) : 0;
      const vignetteAlpha = Math.min(0.85, Math.max(dmg * 0.75, lowO2Pulse, alarmPulse));
      this.dom.alertVignette.style.opacity = vignetteAlpha.toFixed(3);
    }

    if (this.hudGlitchTimer > 0) {
      this.hudGlitchTimer = Math.max(0, this.hudGlitchTimer - dt);
      if (this.dom.hudRoot) {
        if (this.hudGlitchTimer > 0) {
          const jx = ((Math.random() - 0.5) * 8 * this.hudGlitchTimer).toFixed(1);
          const jy = ((Math.random() - 0.5) * 5 * this.hudGlitchTimer).toFixed(1);
          this.dom.hudRoot.style.transform = `translate(${jx}px, ${jy}px)`;
          this.dom.hudRoot.style.textShadow = '2px 0 #ef4444, -2px 0 #38bdf8';
        } else {
          this.dom.hudRoot.style.transform = '';
          this.dom.hudRoot.style.textShadow = '';
        }
      }
    }

    // 7. Toast Notification Countdown
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0 && this.dom.toast) {
        this.dom.toast.style.opacity = '0';
        this.dom.toast.classList.remove('visible');
      }
    }

    // 8. Game Over Overlay Handling
    if (this.ctx?.isGameOver && !this.gameOverShown) {
      this.gameOverShown = true;
      try {
        if (typeof document !== 'undefined' && document.pointerLockElement) {
          document.exitPointerLock();
        }
      } catch (_) {}

      if (this.dom.gameoverReason) {
        this.dom.gameoverReason.textContent =
          this.ctx.gameOverReason || 'VITAL SIGNS TERMINATED — SIGNAL LOST';
      }
      if (this.dom.gameoverOverlay) {
        this.dom.gameoverOverlay.classList.remove('hidden');
        this.dom.gameoverOverlay.classList.add('visible');
        if (
          typeof window !== 'undefined' &&
          window.getComputedStyle(this.dom.gameoverOverlay).display === 'none'
        ) {
          this.dom.gameoverOverlay.style.display = 'flex';
        }
      }
    } else if (!this.ctx?.isGameOver && this.gameOverShown) {
      this.gameOverShown = false;
    }
  }

  _renderRadar(dt, elapsed) {
    const rCtx = this.radarCtx;
    if (!rCtx) return;

    const w = 160;
    const h = 160;
    const cx = 80;
    const cy = 80;
    const maxRadiusPx = 76;
    const maxRangeMeters = 55.0; // Range rings at 15m, 30m, 50m fit inside 76px

    const station = this.ctx?.station;
    const player = this.ctx?.player;
    const cam = this.ctx?.camera;
    const alarm = Boolean(station?.alarmActive);

    rCtx.clearRect(0, 0, w, h);
    rCtx.save();

    // 1. Circular Radar Bezel Clipping & Dark Phosphor Background
    rCtx.beginPath();
    rCtx.arc(cx, cy, maxRadiusPx, 0, Math.PI * 2);
    rCtx.clip();

    rCtx.fillStyle = alarm ? 'rgba(26, 5, 8, 0.88)' : 'rgba(3, 14, 22, 0.88)';
    rCtx.fillRect(0, 0, w, h);

    // 2. Concentric Range Rings (15m, 30m, 50m) & Axis Crosshairs
    const gridColor = alarm ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.22)';
    rCtx.strokeStyle = gridColor;
    rCtx.lineWidth = 1;

    const rings = [15, 30, 50];
    rCtx.font = '8px monospace';
    rCtx.fillStyle = alarm ? 'rgba(252, 165, 165, 0.45)' : 'rgba(125, 211, 252, 0.45)';
    for (let i = 0; i < rings.length; i++) {
      const rPx = (rings[i] / maxRangeMeters) * maxRadiusPx;
      rCtx.beginPath();
      rCtx.arc(cx, cy, rPx, 0, Math.PI * 2);
      rCtx.stroke();
      rCtx.fillText(`${rings[i]}m`, cx + 3, cy - rPx + 8);
    }

    // Crosshairs
    rCtx.beginPath();
    rCtx.moveTo(cx - maxRadiusPx, cy);
    rCtx.lineTo(cx + maxRadiusPx, cy);
    rCtx.moveTo(cx, cy - maxRadiusPx);
    rCtx.lineTo(cx, cy + maxRadiusPx);
    rCtx.stroke();

    // 3. Player Flashlight 24-deg Half-Angle Cone Preview
    if (player?.flashlightOn !== false) {
      const coneAngle = (24 * Math.PI) / 180;
      const coneLen = (35 / maxRangeMeters) * maxRadiusPx;
      const coneGrad = rCtx.createRadialGradient(cx, cy, 2, cx, cy, coneLen);
      coneGrad.addColorStop(0, 'rgba(224, 242, 254, 0.18)');
      coneGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
      rCtx.fillStyle = coneGrad;
      rCtx.beginPath();
      rCtx.moveTo(cx, cy);
      rCtx.arc(cx, cy, coneLen, -Math.PI * 0.5 - coneAngle, -Math.PI * 0.5 + coneAngle);
      rCtx.closePath();
      rCtx.fill();
    }

    // 4. Rotating Phosphor Sweep Wedge
    this.radarSweepAngle = (this.radarSweepAngle + dt * 2.1) % (Math.PI * 2);
    const sweepEnd = this.radarSweepAngle;
    const sweepStart = sweepEnd - 0.55;

    rCtx.fillStyle = alarm ? 'rgba(239, 68, 68, 0.13)' : 'rgba(56, 189, 248, 0.13)';
    rCtx.beginPath();
    rCtx.moveTo(cx, cy);
    rCtx.arc(cx, cy, maxRadiusPx, sweepStart, sweepEnd);
    rCtx.closePath();
    rCtx.fill();

    rCtx.strokeStyle = alarm ? 'rgba(248, 113, 113, 0.7)' : 'rgba(56, 189, 248, 0.75)';
    rCtx.lineWidth = 1.25;
    rCtx.beginPath();
    rCtx.moveTo(cx, cy);
    rCtx.lineTo(cx + Math.cos(sweepEnd) * maxRadiusPx, cy + Math.sin(sweepEnd) * maxRadiusPx);
    rCtx.stroke();

    // 5. Compute Player Local Reference Basis
    if (cam && cam.position) {
      if (cam.parent && cam.parent !== this.ctx?.scene && typeof cam.getWorldPosition === 'function') {
        cam.updateMatrixWorld();
        cam.getWorldPosition(this._camPos);
        cam.getWorldQuaternion(this._camQuat);
      } else {
        this._camPos.copy(cam.position);
        this._camQuat.copy(cam.quaternion);
      }
    } else if (player && player.position) {
      this._camPos.copy(player.position);
      if (player.quaternion) this._camQuat.copy(player.quaternion);
    } else {
      this._camPos.set(0, 1.68, -10);
      this._camQuat.identity();
    }

    this._camRight.set(1, 0, 0).applyQuaternion(this._camQuat);
    this._camForward.set(0, 0, -1).applyQuaternion(this._camQuat);
    this._camUp.set(0, 1, 0).applyQuaternion(this._camQuat);

    // In INTERIOR mode, project onto horizontal XZ plane so pitching head up/down keeps radar rock-steady
    if (player?.mode !== 'EVA') {
      this._camForward.y = 0;
      if (this._camForward.lengthSq() > 1e-5) {
        this._camForward.normalize();
      } else {
        this._camForward.set(0, 0, -1);
      }
      this._camRight.set(-this._camForward.z, 0, this._camForward.x).normalize();
      this._camUp.set(0, 1, 0);
    } else {
      this._camRight.normalize();
      this._camForward.normalize();
      this._camUp.normalize();
    }

    // 6. Project & Draw All Active Radar Targets
    const targets = this.ctx?.radarTargets;
    if (Array.isArray(targets)) {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (!t || t.active === false || !t.position) continue;

        this._toTarget.set(
          t.position.x - this._camPos.x,
          t.position.y - this._camPos.y,
          t.position.z - this._camPos.z
        );

        const localX = this._toTarget.dot(this._camRight);
        const localZ = this._toTarget.dot(this._camForward);
        const localY = this._toTarget.dot(this._camUp);

        const planarDist = Math.hypot(localX, localZ);
        const clampRadius = maxRadiusPx - 4;
        let px = cx + (localX / maxRangeMeters) * maxRadiusPx;
        let py = cy - (localZ / maxRangeMeters) * maxRadiusPx;

        if (planarDist > maxRangeMeters && planarDist > 1e-4) {
          const ux = localX / planarDist;
          const uz = localZ / planarDist;
          px = cx + ux * clampRadius;
          py = cy - uz * clampRadius;
        }

        const type = t.type || 'POD';

        if (type === 'POD') {
          // Cyan Glowing Circle (#38bdf8)
          rCtx.fillStyle = 'rgba(56, 189, 248, 0.28)';
          rCtx.beginPath();
          rCtx.arc(px, py, 5.5, 0, Math.PI * 2);
          rCtx.fill();

          rCtx.fillStyle = '#38bdf8';
          rCtx.beginPath();
          rCtx.arc(px, py, 2.8, 0, Math.PI * 2);
          rCtx.fill();

          // EVA Elevation Indicator Pip (+/-)
          if (player?.mode === 'EVA' && Math.abs(localY) > 5.0) {
            const sign = localY > 0 ? -1 : 1;
            rCtx.strokeStyle = '#7dd3fc';
            rCtx.lineWidth = 1.1;
            rCtx.beginPath();
            rCtx.moveTo(px, py + sign * 3.5);
            rCtx.lineTo(px, py + sign * 8.0);
            rCtx.stroke();
          }
        } else if (type === 'ALIEN') {
          // Pulsing Red Triangle (#ef4444)
          const pulse = 0.65 + 0.35 * Math.sin(elapsed * 10.0 + i);
          rCtx.fillStyle = `rgba(239, 68, 68, ${(0.3 * pulse).toFixed(2)})`;
          rCtx.beginPath();
          rCtx.arc(px, py, 7.0 * pulse, 0, Math.PI * 2);
          rCtx.fill();

          rCtx.fillStyle = '#ef4444';
          rCtx.beginPath();
          rCtx.moveTo(px, py - 4.2);
          rCtx.lineTo(px - 3.8, py + 3.4);
          rCtx.lineTo(px + 3.8, py + 3.4);
          rCtx.closePath();
          rCtx.fill();
        } else if (type === 'CREW') {
          // Emerald Green Crewmate Diamond (#34d399)
          rCtx.fillStyle = 'rgba(52, 211, 153, 0.32)';
          rCtx.beginPath();
          rCtx.arc(px, py, 6.2, 0, Math.PI * 2);
          rCtx.fill();

          rCtx.fillStyle = '#34d399';
          rCtx.beginPath();
          rCtx.moveTo(px, py - 4.4);
          rCtx.lineTo(px + 4.0, py);
          rCtx.lineTo(px, py + 4.4);
          rCtx.lineTo(px - 4.0, py);
          rCtx.closePath();
          rCtx.fill();
        } else if (type === 'AIRLOCK' || type === 'BRIDGE') {
          // Amber Square (#f59e0b) with Micro-Label
          rCtx.fillStyle = '#f59e0b';
          rCtx.fillRect(px - 3, py - 3, 6, 6);
          rCtx.strokeStyle = '#fef3c7';
          rCtx.lineWidth = 0.8;
          rCtx.strokeRect(px - 3, py - 3, 6, 6);

          rCtx.fillStyle = '#fde68a';
          rCtx.font = 'bold 8px monospace';
          rCtx.fillText(type === 'AIRLOCK' ? 'A' : 'B', px + 4.5, py + 3);
        }
      }
    }

    // 7. Center Player Chevron (Pointing Forward / Up)
    rCtx.fillStyle = '#f8fafc';
    rCtx.beginPath();
    rCtx.moveTo(cx, cy - 5);
    rCtx.lineTo(cx - 4, cy + 4);
    rCtx.lineTo(cx, cy + 2);
    rCtx.lineTo(cx + 4, cy + 4);
    rCtx.closePath();
    rCtx.fill();

    // Outer Circular Rim Stroke
    rCtx.strokeStyle = alarm ? 'rgba(239, 68, 68, 0.85)' : 'rgba(56, 189, 248, 0.65)';
    rCtx.lineWidth = 2;
    rCtx.beginPath();
    rCtx.arc(cx, cy, maxRadiusPx - 1, 0, Math.PI * 2);
    rCtx.stroke();

    rCtx.restore();
  }
}
