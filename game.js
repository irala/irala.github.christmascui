/* ============================================================================
   COBAYA GOLOSA · Minijuego navideño 2D (top-down)
   Núcleo jugable completo · Canvas 2D · JavaScript ES6+ · Sin dependencias
   ============================================================================
   Todo el juego vive en este único módulo (IIFE). La configuración de niveles
   está en LEVELS_CONFIG y los ajustes globales en TUNING.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  AJUSTES GLOBALES
   * ------------------------------------------------------------------ */

  const TUNING = {
    worldWidth: 400,        // ancho del mundo lógico (el alto se adapta)
    playerRadius: 16,
    rivalRadius: 16,
    prizeRadius: 13,
    obstacleRadius: 19,
    wallPadding: 8,
    topPlayArea: 36,        // margen superior para no pisar las luces
    joystickRadius: 56,     // radio del joystick en px CSS (× ui)
    joystickDeadzone: 0.12,
    knockbackFriction: 6.5,
    hintDuration: 2.8,
  };

  /* ------------------------------------------------------------------ *
   *  CONFIGURACIÓN DE LOS 5 NIVELES
   *  Ajusta libremente cantidades, tiempos y velocidades.
   *  Las velocidades están en unidades de mundo por segundo.
   * ------------------------------------------------------------------ */

  const LEVELS_CONFIG = [
    {
      title: 'Primer bocado',
      prizes: 3,
      timeLimit: 0,          // 0 = sin límite
      obstacles: 0,
      playerSpeed: 208,
      hint: 'Recoge los 3 regalos',
      rival: null,
    },
    {
      title: 'Campo nevado',
      prizes: 5,
      timeLimit: 0,
      obstacles: 2,          // bolas de nieve estáticas
      playerSpeed: 208,
      hint: 'Esquiva las bolas de nieve',
      rival: null,
    },
    {
      title: 'La siesta',
      prizes: 5,
      timeLimit: 20,         // segundos
      obstacles: 0,
      playerSpeed: 212,
      hint: '¡Antes de que se despierte!',
      rival: {
        type: 'sleeper',
        speed: 250,          // velocidad cuando se despierta y roba
        wakeDelay: 0.85,     // pausa de desperezarse
        eatDelay: 0.55,      // pausa mientras mastica
      },
    },
    {
      title: 'Mordisco',
      prizes: 5,
      timeLimit: 0,
      obstacles: 1,
      playerSpeed: 212,
      hint: 'Que no te muerda',
      rival: {
        type: 'chaser',
        speed: 184,          // ligeramente más lenta que la jugadora
        stunDuration: 1.2,   // segundos sin poder moverse
        invulnDuration: 1.5, // invulnerabilidad después del aturdimiento
        knockback: 430,      // impulso del mordisco
        recoverTime: 0.8,    // Castanho retrocede tras morder
      },
    },
    {
      title: 'Nochebuena',
      prizes: 7,
      timeLimit: 0,
      obstacles: 2,
      playerSpeed: 225,
      hint: 'Que no se coma ningún regalo',
      rival: {
        type: 'hungry',
        speed: 190,
        stunDuration: 1.2,
        invulnDuration: 1.5,
        knockback: 430,
        recoverTime: 0.8,
        decisionInterval: 0.28, // cada cuánto reevalúa perseguir o robar
        stealDelay: 3.0,        // margen inicial antes de poder robar
        stealRange: 200,        // solo disputa regalos cercanos a la jugadora
        stealWindup: 1.2,       // aviso antes de lanzarse al regalo
      },
    },
  ];

  /* ------------------------------------------------------------------ *
   *  CONSTANTES Y UTILIDADES
   * ------------------------------------------------------------------ */

  const WORLD_W = TUNING.worldWidth;
  const TAU = Math.PI * 2;
  const UI_FONT = '"Trebuchet MS", "Segoe UI", system-ui, -apple-system, sans-serif';

  const PRIZE_STYLES = {
    red: {
      main: '#d93a45',
      light: '#ff8a8f',
      dark: '#8f1d2a',
      glow: 'rgba(255, 90, 100, 0.13)',
      sparkle: '#ffe6a3',
    },
    green: {
      main: '#2fae63',
      light: '#7fe6a3',
      dark: '#146437',
      glow: 'rgba(90, 230, 150, 0.13)',
      sparkle: '#fff0b0',
    },
  };

  const PRIZE_KEYS = ['red', 'green'];

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const formatTime = (seconds) => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function starPath(ctx, x, y, outer, inner, points, rotation) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = rotation + (i * Math.PI) / points - Math.PI / 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  /* ------------------------------------------------------------------ *
   *  AUDIO: pequeños efectos sintetizados con Web Audio API
   *  No usa archivos externos. El contexto se crea en el primer gesto.
   * ------------------------------------------------------------------ */

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noiseBuffer = null;
      this.muted = this.readMutedPreference();
    }

    readMutedPreference() {
      try {
        return localStorage.getItem('cobayaGolosa.muted') === '1';
      } catch (err) {
        return false;
      }
    }

    persistMutedPreference() {
      try {
        localStorage.setItem('cobayaGolosa.muted', this.muted ? '1' : '0');
      } catch (err) {
        /* localStorage puede no estar disponible */
      }
    }

    ensure() {
      if (!this.ctx) this.create();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    create() {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;

      try {
        const ctx = new AudioCtor();
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.6;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -22;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        master.connect(compressor);
        compressor.connect(ctx.destination);

        this.ctx = ctx;
        this.master = master;
        this.noiseBuffer = this.buildNoiseBuffer(ctx);
      } catch (err) {
        this.ctx = null;
        this.master = null;
        this.noiseBuffer = null;
      }
    }

    buildNoiseBuffer(ctx) {
      const length = Math.floor(ctx.sampleRate * 0.4);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    }

    setMuted(muted) {
      this.muted = !!muted;
      this.persistMutedPreference();

      if (!this.ctx || !this.master) return;

      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, now, 0.02);
    }

    now() {
      return this.ctx ? this.ctx.currentTime + 0.005 : 0;
    }

    tone(freq, duration, options = {}) {
      if (!this.ctx || this.muted) return;

      const {
        type = 'sine',
        gain = 0.08,
        endFreq = 0,
        attack = 0.008,
        when = this.now(),
        filterType = '',
        filterFreq = 0,
      } = options;

      const ctx = this.ctx;
      const t0 = Math.max(when, ctx.currentTime + 0.001);

      try {
        const osc = ctx.createOscillator();
        const envelope = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (endFreq > 0) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
        }

        envelope.gain.setValueAtTime(0.0001, t0);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
        envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

        if (filterType && filterFreq > 0) {
          const filter = ctx.createBiquadFilter();
          filter.type = filterType;
          filter.frequency.value = filterFreq;
          osc.connect(filter);
          filter.connect(envelope);
        } else {
          osc.connect(envelope);
        }

        envelope.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + duration + 0.03);
      } catch (err) {
        /* Si algo falla, el juego sigue sin sonido */
      }
    }

    noise(duration, options = {}) {
      if (!this.ctx || !this.muted || !this.noiseBuffer) return;

      const {
        gain = 0.04,
        when = this.now(),
        filterType = 'lowpass',
        filterFreq = 900,
        q = 0.7,
      } = options;

      const ctx = this.ctx;
      const t0 = Math.max(when, ctx.currentTime + 0.001);

      try {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = filterFreq;
        filter.Q.value = q;

        const envelope = ctx.createGain();
        envelope.gain.setValueAtTime(0.0001, t0);
        envelope.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
        envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

        source.connect(filter);
        filter.connect(envelope);
        envelope.connect(this.master);
        source.start(t0, Math.random() * 0.2);
        source.stop(t0 + duration + 0.03);
      } catch (err) {
        /* Sin sonido, pero sin romper la partida */
      }
    }

    pickup(step = 0) {
      if (!this.ctx || this.muted) return;

      const notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77];
      const index = ((step % notes.length) + notes.length) % notes.length;
      const freq = notes[index];
      const t = this.now();

      this.tone(freq, 0.16, { type: 'sine', gain: 0.11, when: t, attack: 0.006 });
      this.tone(freq * 2, 0.1, { type: 'triangle', gain: 0.024, when: t + 0.006 });
      this.tone(freq * 1.5, 0.2, { type: 'sine', gain: 0.022, when: t + 0.01 });
    }

    rivalWake() {
      if (!this.ctx || this.muted) return;

      const t = this.now();
      this.tone(90, 0.55, {
        type: 'triangle',
        gain: 0.12,
        endFreq: 230,
        when: t,
        attack: 0.08,
        filterType: 'lowpass',
        filterFreq: 700,
      });
      this.tone(120, 0.5, {
        type: 'sawtooth',
        gain: 0.022,
        endFreq: 260,
        when: t + 0.04,
        attack: 0.1,
        filterType: 'lowpass',
        filterFreq: 850,
      });
      this.noise(0.22, {
        gain: 0.024,
        when: t + 0.1,
        filterType: 'bandpass',
        filterFreq: 500,
        q: 0.8,
      });
    }

    steal() {
      if (!this.ctx || this.muted) return;

      const t = this.now();
      this.tone(210, 0.1, {
        type: 'triangle',
        gain: 0.13,
        endFreq: 120,
        when: t,
        attack: 0.004,
      });
      this.noise(0.08, {
        gain: 0.045,
        when: t,
        filterType: 'lowpass',
        filterFreq: 1100,
      });
      this.tone(95, 0.28, {
        type: 'sine',
        gain: 0.11,
        endFreq: 55,
        when: t + 0.07,
        attack: 0.01,
      });
      this.tone(170, 0.09, {
        type: 'triangle',
        gain: 0.06,
        endFreq: 110,
        when: t + 0.16,
        attack: 0.004,
      });
    }

    bite() {
      if (!this.ctx || this.muted) return;

      const t = this.now();
      this.noise(0.09, {
        gain: 0.07,
        when: t,
        filterType: 'lowpass',
        filterFreq: 900,
      });
      this.tone(140, 0.2, {
        type: 'square',
        gain: 0.055,
        endFreq: 65,
        when: t + 0.02,
        attack: 0.004,
        filterType: 'lowpass',
        filterFreq: 600,
      });
      this.tone(80, 0.25, {
        type: 'sine',
        gain: 0.09,
        endFreq: 45,
        when: t + 0.01,
        attack: 0.006,
      });
    }

    levelClear() {
      if (!this.ctx || this.muted) return;

      const t = this.now() + 0.1;
      const notes = [523.25, 659.25, 783.99, 1046.5];

      notes.forEach((freq, i) => {
        this.tone(freq, 0.24, {
          type: 'triangle',
          gain: 0.085,
          when: t + i * 0.09,
          attack: 0.006,
        });
        this.tone(freq * 2, 0.14, {
          type: 'sine',
          gain: 0.018,
          when: t + i * 0.09 + 0.005,
        });
      });

      this.tone(1318.5, 0.5, {
        type: 'sine',
        gain: 0.032,
        when: t + 0.36,
        attack: 0.02,
      });
    }

    victory() {
      if (!this.ctx || this.muted) return;

      const t = this.now() + 0.15;
      const melody = [523.25, 659.25, 783.99, 1046.5, 987.77, 1046.5, 1318.5];

      melody.forEach((freq, i) => {
        this.tone(freq, 0.26, {
          type: 'triangle',
          gain: 0.08,
          when: t + i * 0.13,
          attack: 0.006,
        });
        this.tone(freq * 2, 0.16, {
          type: 'sine',
          gain: 0.016,
          when: t + i * 0.13 + 0.004,
        });
      });

      const chordAt = t + melody.length * 0.13 + 0.05;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
        this.tone(freq, 0.9, {
          type: 'triangle',
          gain: 0.042,
          when: chordAt,
          attack: 0.03,
        });
      });
      this.noise(0.35, {
        gain: 0.01,
        when: chordAt,
        filterType: 'highpass',
        filterFreq: 4200,
      });
    }

    uiConfirm() {
      if (!this.ctx || this.muted) return;

      const t = this.now() + 0.04;
      this.tone(880, 0.08, { type: 'sine', gain: 0.04, when: t });
      this.tone(1174.66, 0.12, { type: 'sine', gain: 0.03, when: t + 0.06 });
    }
  }

  /* ------------------------------------------------------------------ *
   *  JUEGO
   * ------------------------------------------------------------------ */

  class CobayaGolosa {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });

      /* Estado general */
      this.state = 'START';           // START | PLAYING | LEVEL_CLEAR | GAME_OVER | VICTORY
      this.level = null;
      this.levelIndex = 0;
      this.overlayKind = null;
      this.gameOverReason = '';
      this.hasUsedJoystick = false;
      this.victoryAt = 0;
      this.shake = 0;
      this.t = 0;
      this.lastTime = performance.now();

      /* Vista / layout */
      this.vw = 1;
      this.vh = 1;
      this.dpr = 1;
      this.ui = 1;
      this.scale = 1;
      this.worldH = 700;
      this.safeTop = 0;
      this.safeBottom = 0;
      this.safeLeft = 0;
      this.safeRight = 0;
      this.stage = { x: 0, y: 0, w: 1, h: 1 };
      this.arena = { x: 0, y: 0, w: 1, h: 1 };
      this.resizeQueued = false;
      this.muteSize = 42;
      this.muteGap = 8;

      /* Entrada */
      this.input = { x: 0, y: 0 };
      this.keys = new Set();
      this.pointer = {
        active: false,
        id: null,
        baseX: 0,
        baseY: 0,
        knobX: 0,
        knobY: 0,
      };

      /* Efectos */
      this.particles = [];
      this.floaters = [];
      this.snow = [];
      this.confetti = this.makeConfetti();
      this.banner = null;

      /* DOM */
      this.dom = {
        overlay: document.getElementById('overlay'),
        panel: document.getElementById('panel'),
        eyebrow: document.getElementById('ov-eyebrow'),
        title: document.getElementById('ov-title'),
        text: document.getElementById('ov-text'),
        stats: document.getElementById('ov-stats'),
        primary: document.getElementById('ov-primary'),
        secondary: document.getElementById('ov-secondary'),
        tips: document.getElementById('ov-tips'),
        muteBtn: document.getElementById('mute-btn'),
        muteOn: document.querySelector('#mute-btn .mute-icon-on'),
        muteOff: document.querySelector('#mute-btn .mute-icon-off'),
      };

      /* Audio */
      this.audio = new AudioEngine();
      this.updateMuteButton();

      this.loop = this.loop.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);

      this.bindEvents();
      this.resize();
      this.showStart();

      this.lastTime = performance.now();
      requestAnimationFrame(this.loop);
    }

    /* ================================================================ *
     *  CICLO PRINCIPAL
     * ================================================================ */

    loop(now) {
      // deltaTime limitado: evita saltos enormes al volver de segundo plano
      const dt = Math.min(Math.max(0, (now - this.lastTime) / 1000), 0.05);
      this.lastTime = now;

      this.t += dt;
      this.update(dt);
      this.draw();

      requestAnimationFrame(this.loop);
    }

    update(dt) {
      this.updateAmbient(dt);
      this.shake = Math.max(0, this.shake - dt * 2.4);

      if (this.state !== 'PLAYING' || !this.level) return;

      const lvl = this.level;
      const cfg = lvl.cfg;
      lvl.elapsed += dt;

      if (this.banner) {
        this.banner.t -= dt;
        if (this.banner.t <= 0) this.banner = null;
      }

      /* Temporizador */
      let timeExpired = false;
      if (lvl.timeLimit > 0 && !lvl.doom) {
        lvl.timeLeft = Math.max(0, lvl.timeLeft - dt);
        if (lvl.timeLeft <= 0) timeExpired = true;
      }

      /* Jugadora */
      this.updatePlayer(dt);

      /* Rival / secuencia de despertar */
      if (lvl.doom) this.updateDoom(dt);
      else this.updateRival(dt);

      if (this.state !== 'PLAYING') return;

      /* Recogida de regalos y victoria del nivel */
      if (!lvl.locked) this.collectPrizes();

      if (lvl.collected >= cfg.prizes) {
        this.completeLevel();
        return;
      }

      /* Si se agotó el tiempo del nivel de la siesta, empieza la desgracia */
      if (timeExpired && lvl.rival && cfg.rival.type === 'sleeper' && !lvl.doom) {
        this.startDoom();
      }
    }

    updateAmbient(dt) {
      /* Nieve */
      for (const flake of this.snow) {
        flake.x += (flake.vx + Math.sin(this.t * 0.7 + flake.phase) * 5) * dt;
        flake.y += flake.vy * dt;
        if (flake.y > this.vh + 6) {
          flake.y = -6;
          flake.x = Math.random() * this.vw;
        }
        if (flake.x < -8) flake.x = this.vw + 8;
        if (flake.x > this.vw + 8) flake.x = -8;
      }

      /* Partículas */
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 150 * dt;
        p.vx *= Math.exp(-2.2 * dt);
        p.vy *= Math.exp(-1.1 * dt);
      }

      /* Textos flotantes */
      for (let i = this.floaters.length - 1; i >= 0; i--) {
        const f = this.floaters[i];
        f.life -= dt;
        if (f.life <= 0) {
          this.floaters.splice(i, 1);
          continue;
        }
        f.y -= 26 * dt;
      }
    }

    /* ================================================================ *
     *  JUGADORA
     * ================================================================ */

    updatePlayer(dt) {
      const lvl = this.level;
      const p = lvl.player;
      const cfg = lvl.cfg;

      p.animT += dt;
      p.stun = Math.max(0, p.stun - dt);
      p.invuln = Math.max(0, p.invuln - dt);

      const move = p.stun > 0 ? { x: 0, y: 0 } : this.getMoveInput();
      const speed = cfg.playerSpeed;

      const vx = move.x * speed + p.kbX;
      const vy = move.y * speed + p.kbY;

      p.x += vx * dt;
      p.y += vy * dt;

      p.kbX *= Math.exp(-TUNING.knockbackFriction * dt);
      p.kbY *= Math.exp(-TUNING.knockbackFriction * dt);

      const moveLen = Math.hypot(move.x, move.y);
      if (moveLen > 0.05) {
        const targetX = move.x / moveLen;
        const targetY = move.y / moveLen;
        const smooth = 1 - Math.exp(-12 * dt);
        p.facingX = lerp(p.facingX, targetX, smooth);
        p.facingY = lerp(p.facingY, targetY, smooth);
        const fl = Math.hypot(p.facingX, p.facingY) || 1;
        p.facingX /= fl;
        p.facingY /= fl;
      }

      p.lean = lerp(p.lean, clamp(move.x, -1, 1) * 0.12, 1 - Math.exp(-10 * dt));
      p.moving = moveLen;

      this.pushOutObstacles(p);
      this.clampToArena(p);

      p.vx = vx;
      p.vy = vy;
    }

    getMoveInput() {
      let x = this.input.x;
      let y = this.input.y;

      if (this.keys.has('arrowleft') || this.keys.has('a')) x -= 1;
      if (this.keys.has('arrowright') || this.keys.has('d')) x += 1;
      if (this.keys.has('arrowup') || this.keys.has('w')) y -= 1;
      if (this.keys.has('arrowdown') || this.keys.has('s')) y += 1;

      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      return { x, y };
    }

    collectPrizes() {
      const lvl = this.level;
      const p = lvl.player;
      const list = lvl.prizes;

      for (let i = list.length - 1; i >= 0; i--) {
        const prize = list[i];
        if (distance(p.x, p.y, prize.x, prize.y) < p.r + prize.r * 0.72) {
          list.splice(i, 1);
          lvl.collected++;
          this.audio.pickup(lvl.collected - 1);

          this.spawnBurst(
            prize.x,
            prize.y,
            [prize.style.main, prize.style.light, prize.style.sparkle, '#ffffff'],
            13,
            155
          );
          this.addFloater(prize.x, prize.y - 16, '+1', '#ffe08a', 15);
          this.shake = Math.max(this.shake, 0.16);
        }
      }
    }

    /* ================================================================ *
     *  RIVAL: PERSECUCIÓN, MORDISCO Y ROBO
     * ================================================================ */

    updateRival(dt) {
      const lvl = this.level;
      const r = lvl.rival;
      if (!r) return;

      const p = lvl.player;
      const cfg = lvl.cfg;
      const rivalCfg = cfg.rival;

      r.animT += dt;

      if (r.mode === 'asleep') {
        r.moving = 0;
        return;
      }

      /* Castanho retrocede tras morder para no acampar encima */
      if (r.recover > 0) {
        r.recover -= dt;
        r.moving = 1;
        const dx = r.x - p.x;
        const dy = r.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        r.x += (dx / d) * r.speed * 0.55 * dt;
        r.y += (dy / d) * r.speed * 0.55 * dt;
        r.facingX = dx / d;
        r.facingY = dy / d;
        this.pushOutObstacles(r);
        this.clampToArena(r);
        return;
      }

      let targetX = p.x;
      let targetY = p.y;

      /* Nivel 5: decide entre perseguir a la jugadora o robar un regalo */
      if (rivalCfg.type === 'hungry') {
        if (r.stealReady > 0) {
          /* Margen inicial: persigue sin optar al robo */
          r.stealReady -= dt;
          r.targetPrize = null;
          r.mode = 'chase';
        } else {
          r.decision -= dt;
          if (r.decision <= 0 || (r.targetPrize && !lvl.prizes.includes(r.targetPrize))) {
            r.decision = rivalCfg.decisionInterval;
            this.evaluateHungryRival(r);
          }
          if (r.targetPrize) {
            targetX = r.targetPrize.x;
            targetY = r.targetPrize.y;
            r.mode = 'steal';
          } else {
            r.mode = 'chase';
          }
        }
      } else {
        r.mode = 'chase';
      }

      /* Aviso de robo: se queda fijando el objetivo durante un instante.
         Esto da a la jugadora una oportunidad real de adelantarse. */
      if (r.mode === 'steal' && r.stealWindup > 0) {
        r.stealWindup = Math.max(0, r.stealWindup - dt);
        r.moving = 0;

        if (r.targetPrize) {
          const gx = r.targetPrize.x - r.x;
          const gy = r.targetPrize.y - r.y;
          const gd = Math.hypot(gx, gy) || 1;
          r.facingX = gx / gd;
          r.facingY = gy / gd;
        }

        this.pushOutObstacles(r);
        this.clampToArena(r);

        if (r.targetPrize && !lvl.prizes.includes(r.targetPrize)) {
          r.targetPrize = null;
          r.stealWindup = 0;
          r.decision = 0;
          r.mode = 'chase';
        }
        return;
      }

      const dx = targetX - r.x;
      const dy = targetY - r.y;
      const d = Math.hypot(dx, dy) || 1;

      if (d > 1) {
        let ux = dx / d;
        let uy = dy / d;

        /* Esquiva suave de obstáculos para no quedarse atascada */
        for (const o of lvl.obstacles) {
          const ox = r.x - o.x;
          const oy = r.y - o.y;
          const od = Math.hypot(ox, oy) || 1;
          const minD = o.r + r.r + 28;
          if (od < minD) {
            const push = (1 - od / minD) * 1.8;
            ux += (ox / od) * push;
            uy += (oy / od) * push;
          }
        }

        const ul = Math.hypot(ux, uy) || 1;
        r.x += (ux / ul) * r.speed * dt;
        r.y += (uy / ul) * r.speed * dt;
        r.facingX = ux / ul;
        r.facingY = uy / ul;
        r.moving = 1;
      } else {
        r.moving = 0;
      }

      this.pushOutObstacles(r);
      this.clampToArena(r);

      /* ¿Ha llegado a un regalo? */
      if (r.mode === 'steal' && r.targetPrize) {
        const gift = r.targetPrize;
        if (distance(r.x, r.y, gift.x, gift.y) < r.r + gift.r * 0.8) {
          this.rivalEatsPrize(gift);
          return;
        }
      }

      /* ¿Muerde a la jugadora? */
      if (
        distance(r.x, r.y, p.x, p.y) < r.r + p.r * 0.9 &&
        p.invuln <= 0 &&
        p.stun <= 0
      ) {
        this.bitePlayer();
      }
    }

    evaluateHungryRival(r) {
      const lvl = this.level;
      const p = lvl.player;
      const rivalCfg = lvl.cfg.rival;

      /* Mientras está aturdida no se le permite robar: sería una muerte injusta. */
      if (p.stun > 0) {
        r.targetPrize = null;
        r.stealWindup = 0;
        r.mode = 'chase';
        return;
      }

      let best = null;
      let bestDist = Infinity;

      for (const gift of lvl.prizes) {
        const playerDist = distance(p.x, p.y, gift.x, gift.y);
        /* Solo entra a disputar regalos que la jugadora tiene a su alcance.
           Así no roba al otro lado de la pista mientras la persigue. */
        if (playerDist > rivalCfg.stealRange) continue;

        const d = distance(r.x, r.y, gift.x, gift.y);
        if (d < bestDist) {
          bestDist = d;
          best = gift;
        }
      }

      if (best) {
        const playerDist = distance(p.x, p.y, best.x, best.y);
        // Si el regalo está más cerca de ella que de la jugadora, va a por él.
        if (bestDist < playerDist) {
          if (r.targetPrize !== best) {
            r.stealWindup = rivalCfg.stealWindup;
          }
          r.targetPrize = best;
          r.mode = 'steal';
          return;
        }
      }

      r.targetPrize = null;
      r.stealWindup = 0;
      r.mode = 'chase';
    }

    rivalEatsPrize(prize) {
      if (this.state !== 'PLAYING') return;

      const lvl = this.level;
      const r = lvl.rival;

      lvl.prizes = lvl.prizes.filter((p) => p !== prize);
      r.targetPrize = null;

      this.spawnBurst(
        prize.x,
        prize.y,
        [prize.style.main, prize.style.light, prize.style.sparkle, '#ffffff'],
        20,
        185
      );
      this.addFloater(r.x, r.y - 28, '¡ÑAM!', '#ffd166', 17);
      this.shake = 1;

      this.audio.steal();
      this.gameOver('¡Castanho se comió un premio! Ya no puedes completar el nivel.');
    }

    bitePlayer() {
      const lvl = this.level;
      const p = lvl.player;
      const r = lvl.rival;
      const rivalCfg = lvl.cfg.rival;
      if (!r || !rivalCfg) return;

      const dx = p.x - r.x;
      const dy = p.y - r.y;
      const d = Math.hypot(dx, dy) || 1;

      p.kbX = (dx / d) * rivalCfg.knockback;
      p.kbY = (dy / d) * rivalCfg.knockback;
      p.stun = rivalCfg.stunDuration;
      p.invuln = rivalCfg.stunDuration + rivalCfg.invulnDuration;
      r.recover = rivalCfg.recoverTime;

      this.spawnBurst(
        (p.x + r.x) / 2,
        (p.y + r.y) / 2,
        ['#ff6b6b', '#ffd166', '#ffffff'],
        12,
        165
      );
      this.addFloater(p.x, p.y - p.r * 2.1, '¡AY!', '#ff9b9b', 16);
      this.shake = 0.9;
      this.audio.bite();
    }

    /* ================================================================ *
     *  NIVEL 3: SECUENCIA DE DESPERTAR Y ROBAR
     * ================================================================ */

    startDoom() {
      const lvl = this.level;
      const r = lvl.rival;
      if (!r || lvl.doom) return;

      lvl.locked = true;
      r.mode = 'wake';
      r.moving = 1;
      lvl.doom = {
        phase: 'wake',
        timer: lvl.cfg.rival.wakeDelay,
        target: null,
      };

      this.showBanner('¡SE DESPERTÓ!', {
        color: '#ffdede',
        bg: 'rgba(122, 22, 34, 0.92)',
        border: 'rgba(255, 130, 130, 0.55)',
        duration: 2.4,
      });
      this.spawnBurst(r.x, r.y - 8, ['#ffffff', '#ffd166'], 12, 105);
      this.shake = 0.85;
      this.audio.rivalWake();
    }

    updateDoom(dt) {
      const lvl = this.level;
      const r = lvl.rival;
      const doom = lvl.doom;
      if (!r || !doom) return;

      r.animT += dt;
      r.moving = 1;

      if (doom.phase === 'wake') {
        doom.timer -= dt;
        if (doom.timer <= 0) {
          doom.phase = 'run';
          doom.target = this.nearestPrize(r);
          if (!doom.target) {
            doom.phase = 'eat';
            doom.timer = 0.4;
          }
        }
        return;
      }

      if (doom.phase === 'run') {
        const prize = doom.target;
        if (!prize || !lvl.prizes.includes(prize)) {
          doom.phase = 'eat';
          doom.timer = 0.4;
          return;
        }

        const dx = prize.x - r.x;
        const dy = prize.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        const speed = r.speed;

        r.x += (dx / d) * speed * dt;
        r.y += (dy / d) * speed * dt;
        r.facingX = dx / d;
        r.facingY = dy / d;

        this.pushOutObstacles(r);
        this.clampToArena(r);

        if (d < r.r + prize.r) {
          lvl.prizes = lvl.prizes.filter((p) => p !== prize);
          this.spawnBurst(
            prize.x,
            prize.y,
            [prize.style.main, prize.style.light, prize.style.sparkle, '#ffffff'],
            20,
            180
          );
          this.addFloater(r.x, r.y - 28, '¡ÑAM!', '#ffd166', 17);
          this.shake = 0.9;
          this.audio.steal();
          doom.phase = 'eat';
          doom.timer = lvl.cfg.rival.eatDelay;
        }
        return;
      }

      if (doom.phase === 'eat') {
        doom.timer -= dt;
        if (doom.timer <= 0) {
          this.gameOver('¡Se despertó y se comió un premio!');
        }
      }
    }

    /* ================================================================ *
     *  ESTADOS / TRANSICIONES
     * ================================================================ */

    startLevel(index) {
      const cfg = LEVELS_CONFIG[index];
      if (!cfg) return;

      this.levelIndex = index;
      this.gameOverReason = '';
      this.victoryAt = 0;
      this.shake = 0;
      this.particles = [];
      this.floaters = [];
      this.banner = null;

      this.level = {
        cfg,
        elapsed: 0,
        timeLeft: cfg.timeLimit,
        timeLimit: cfg.timeLimit,
        collected: 0,
        locked: false,
        doom: null,
        prizes: [],
        obstacles: [],
        player: null,
        rival: null,
      };

      this.state = 'PLAYING';
      this.hideOverlay();
      this.resetInput();
      this.computeLayout();

      const H = this.worldH;

      /* Jugadora: abajo en el centro */
      this.level.player = {
        x: WORLD_W / 2,
        y: H - 80,
        r: TUNING.playerRadius,
        facingX: 0,
        facingY: 1,
        vx: 0,
        vy: 0,
        kbX: 0,
        kbY: 0,
        stun: 0,
        invuln: 0,
        animT: 0,
        lean: 0,
        moving: 0,
      };

      /* Rival */
      if (cfg.rival) {
        const sleeping = cfg.rival.type === 'sleeper';
        this.level.rival = {
          x: sleeping ? WORLD_W - 72 : WORLD_W / 2,
          y: sleeping ? 102 : 128,
          r: TUNING.rivalRadius,
          speed: cfg.rival.speed,
          facingX: 0,
          facingY: 1,
          animT: 0,
          mode: sleeping ? 'asleep' : 'chase',
          targetPrize: null,
          recover: 0,
          decision: 0,
          stealReady: cfg.rival.type === 'hungry' ? cfg.rival.stealDelay : 0,
          stealWindup: 0,
          moving: 0,
        };
      }

      /* Obstáculos estáticos (bolas de nieve) */
      for (let i = 0; i < (cfg.obstacles || 0); i++) {
        const checks = [
          { x: this.level.player.x, y: this.level.player.y, d: 115 },
        ];
        if (this.level.rival) {
          checks.push({ x: this.level.rival.x, y: this.level.rival.y, d: 105 });
        }
        for (const o of this.level.obstacles) {
          checks.push({ x: o.x, y: o.y, d: o.r * 2 + 44 });
        }
        const spot = this.findSpot(checks, 42);
        this.level.obstacles.push({
          x: spot.x,
          y: spot.y,
          r: TUNING.obstacleRadius,
          seed: Math.random() * 10,
        });
      }

      /* Aros de premio */
      const rivalClear =
        cfg.rival && cfg.rival.type === 'hungry' ? 220 : cfg.rival ? 120 : 0;

      for (let i = 0; i < cfg.prizes; i++) {
        const checks = [
          { x: this.level.player.x, y: this.level.player.y, d: 102 },
        ];
        if (this.level.rival) {
          checks.push({ x: this.level.rival.x, y: this.level.rival.y, d: rivalClear });
        }
        for (const o of this.level.obstacles) {
          checks.push({ x: o.x, y: o.y, d: o.r + 36 });
        }
        for (const g of this.level.prizes) {
          checks.push({ x: g.x, y: g.y, d: 64 });
        }

        const spot = this.findSpot(checks, 40);
        const styleKey = PRIZE_KEYS[(i + index) % PRIZE_KEYS.length];
        this.level.prizes.push({
          x: spot.x,
          y: spot.y,
          r: TUNING.prizeRadius,
          style: PRIZE_STYLES[styleKey],
          seed: Math.random() * 10,
        });
      }

      this.showBanner(cfg.hint, {
        color: '#ffe9b0',
        bg: 'rgba(9, 14, 32, 0.86)',
        border: 'rgba(255, 255, 255, 0.14)',
        duration: TUNING.hintDuration,
      });
    }

    completeLevel() {
      const lvl = this.level;
      this.resetInput();

      if (this.levelIndex >= LEVELS_CONFIG.length - 1) {
        this.state = 'VICTORY';
        this.victoryAt = this.t;
        this.audio.victory();
        this.showVictoryOverlay();
        return;
      }

      this.state = 'LEVEL_CLEAR';
      this.audio.levelClear();
      this.showClearOverlay();
    }

    gameOver(reason) {
      if (this.state !== 'PLAYING') return;

      this.state = 'GAME_OVER';
      this.gameOverReason = reason;
      this.shake = Math.max(this.shake, 1);
      this.resetInput();
      this.showGameOverOverlay();
    }

    showStart() {
      this.state = 'START';
      this.level = null;
      this.levelIndex = 0;
      this.gameOverReason = '';
      this.victoryAt = 0;
      this.banner = null;
      this.particles = [];
      this.floaters = [];
      this.shake = 0;
      this.resetInput();
      this.computeLayout();

      this.setOverlay({
        kind: 'start',
        tone: 'start',
        eyebrow: 'Minijuego navideño',
        title: 'Cobaya Golosa',
        text:
          'Fito, una cobaya calva con mucha hambre, tiene una misión: reunir los regalos de Nochebuena antes de que Castanho se despierte.',
        stats: ['5 niveles', '25 regalos', '1 dedo'],
        primary: 'Empezar la aventura',
        secondary: '',
        tips: 'Arrastra el dedo por la pista para moverte. Suelta para parar.',
      });
    }

    showClearOverlay() {
      const lvl = this.level;
      const n = this.levelIndex + 1;
      const next = LEVELS_CONFIG[this.levelIndex + 1];

      this.setOverlay({
        kind: 'clear',
        tone: 'win',
        eyebrow: `Nivel ${n} / 5 superado`,
        title: '¡Bien hecho!',
        text: `Has reunido los ${lvl.cfg.prizes} regalos de «${lvl.cfg.title}».`,
        stats: [`${lvl.collected} / ${lvl.cfg.prizes} regalos`, `Tiempo ${lvl.elapsed.toFixed(1)} s`],
        primary: 'Siguiente nivel',
        secondary: '',
        tips: next ? `Siguiente: nivel ${n + 1} · ${next.title}` : '',
      });
    }

    showGameOverOverlay() {
      const lvl = this.level;
      const n = this.levelIndex + 1;
      const cfg = lvl.cfg;

      let tip = 'Recoge los regalos sin prisa.';
      if (cfg.rival && cfg.rival.type === 'hungry') {
        tip = 'Adelántate a Castanho: si llega antes a un regalo, se acaba la partida.';
      } else if (cfg.rival && cfg.rival.type === 'chaser') {
        tip = 'Cuando te muerda, muévete en cuanto pase el aturdimiento.';
      } else if (cfg.timeLimit > 0) {
        tip = 'No te entretengas: el reloj no perdona.';
      }

      this.setOverlay({
        kind: 'over',
        tone: 'lose',
        eyebrow: `Nivel ${n} / 5`,
        title: '¡Casi!',
        text: this.gameOverReason,
        stats: [
          `${lvl.collected} / ${cfg.prizes} regalos`,
          cfg.timeLimit > 0
            ? `Tiempo ${formatTime(lvl.timeLeft)}`
            : `Tiempo ${lvl.elapsed.toFixed(1)} s`,
        ],
        primary: 'Reintentar nivel',
        secondary: 'Volver al inicio',
        tips: tip,
      });
    }

    showVictoryOverlay() {
      const totalPrizes = LEVELS_CONFIG.reduce((sum, level) => sum + level.prizes, 0);

      this.setOverlay({
        kind: 'victory',
        tone: 'victory',
        eyebrow: '5 / 5 niveles',
        title: '¡Feliz Navidad!',
        text:
          'Has reunido todos los regalos y has salvado la Nochebuena. Fito ahora está pensando en sus pimientos.',
        stats: [
          `${totalPrizes} regalos`,
          'Castanho vuelve a irse a echar la siesta.',
          'Nochebuena a salvo',
        ],
        primary: 'Jugar otra vez',
        secondary: '',
        tips: 'Gracias por jugar.',
      });
    }

    setOverlay(config) {
      const dom = this.dom;

      dom.eyebrow.textContent = config.eyebrow || '';
      dom.title.textContent = config.title || '';
      dom.text.textContent = config.text || '';

      dom.stats.replaceChildren();
      for (const stat of config.stats || []) {
        const span = document.createElement('span');
        span.className = 'stat';
        span.textContent = stat;
        dom.stats.appendChild(span);
      }
      dom.stats.hidden = !(config.stats && config.stats.length);

      dom.primary.textContent = config.primary || 'Continuar';
      dom.secondary.textContent = config.secondary || '';
      dom.secondary.hidden = !config.secondary;

      dom.tips.textContent = config.tips || '';
      dom.tips.hidden = !config.tips;

      dom.panel.dataset.tone = config.tone || 'default';
      dom.overlay.dataset.tone = config.tone || 'default';
      dom.overlay.hidden = false;
      dom.overlay.classList.remove('show');
      // Reinicia la animación de entrada
      void dom.overlay.offsetWidth;
      dom.overlay.classList.add('show');

      this.overlayKind = config.kind || null;
    }

    hideOverlay() {
      this.dom.overlay.hidden = true;
      this.dom.overlay.classList.remove('show');
      this.overlayKind = null;
    }

    onPrimary() {
      const kind = this.overlayKind;

      if (kind === 'start' || kind === 'victory') {
        this.startLevel(0);
      } else if (kind === 'clear') {
        this.startLevel(this.levelIndex + 1);
      } else if (kind === 'over') {
        this.startLevel(this.levelIndex);
      }
    }

    onSecondary() {
      if (this.overlayKind === 'over') this.showStart();
    }

    toggleMute() {
      this.audio.ensure();
      const muted = !this.audio.muted;
      this.audio.setMuted(muted);
      this.updateMuteButton();
      if (!muted) this.audio.uiConfirm();
    }

    updateMuteButton() {
      const button = this.dom.muteBtn;
      if (!button) return;

      const muted = this.audio.muted;
      button.dataset.muted = muted ? 'true' : 'false';
      button.setAttribute('aria-checked', String(!muted));
      button.title = muted ? 'Activar sonido (M)' : 'Silenciar sonido (M)';

      if (this.dom.muteOn) this.dom.muteOn.hidden = muted;
      if (this.dom.muteOff) this.dom.muteOff.hidden = !muted;
    }

    updateMuteButtonPosition() {
      const button = this.dom.muteBtn;
      if (!button) return;

      const ui = this.ui;
      const size = Math.max(40, 42 * ui);
      this.muteSize = size;
      this.muteGap = 8 * ui;

      const right = this.arena.x + this.arena.w;
      const top = this.stage.y + 10 * ui + (40 * ui - size) / 2;

      button.style.left = `${Math.round(right - size)}px`;
      button.style.top = `${Math.round(top)}px`;
      button.style.right = 'auto';
      button.style.width = `${Math.round(size)}px`;
      button.style.height = `${Math.round(size)}px`;
    }

    /* ================================================================ *
     *  LAYOUT RESPONSIVO
     * ================================================================ */

    resize() {
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);

      this.vw = vw;
      this.vh = vh;
      this.dpr = dpr;

      this.canvas.width = Math.round(vw * dpr);
      this.canvas.height = Math.round(vh * dpr);
      this.canvas.style.width = `${vw}px`;
      this.canvas.style.height = `${vh}px`;

      const css = getComputedStyle(document.documentElement);
      this.safeTop = parseFloat(css.getPropertyValue('--safe-top')) || 0;
      this.safeBottom = parseFloat(css.getPropertyValue('--safe-bottom')) || 0;
      this.safeLeft = parseFloat(css.getPropertyValue('--safe-left')) || 0;
      this.safeRight = parseFloat(css.getPropertyValue('--safe-right')) || 0;

      const oldWorldH = this.worldH;
      this.computeLayout();

      /* Al cambiar de orientación, conservamos la posición relativa */
      if (this.level && oldWorldH > 0 && Math.abs(this.worldH / oldWorldH - 1) > 0.0001) {
        const k = this.worldH / oldWorldH;
        const scaleY = (entity) => {
          entity.y *= k;
        };
        if (this.level.player) scaleY(this.level.player);
        if (this.level.rival) scaleY(this.level.rival);
        this.level.prizes.forEach(scaleY);
        this.level.obstacles.forEach(scaleY);

        if (this.level.player) this.clampToArena(this.level.player);
        if (this.level.rival) this.clampToArena(this.level.rival);
        this.level.prizes.forEach((g) => {
          g.x = clamp(g.x, 30, WORLD_W - 30);
          g.y = clamp(g.y, 50, this.worldH - 30);
        });
      }

      this.makeSnow();
    }

    computeLayout() {
      const usableW = Math.max(1, this.vw - this.safeLeft - this.safeRight);
      const stageH = Math.max(240, this.vh - this.safeTop - this.safeBottom);
      const stageW = Math.min(usableW, Math.max(320, stageH * 0.58));
      const ui = clamp(stageW / 390, 0.8, 1.4);
      this.ui = ui;

      const stageX = Math.round(this.safeLeft + (usableW - stageW) / 2);
      const stageY = this.safeTop;
      this.stage = { x: stageX, y: stageY, w: stageW, h: stageH };

      const hasHud = !!this.level;
      const hasTimer = !!(this.level && this.level.cfg.timeLimit > 0);
      const hudH = hasHud ? (hasTimer ? 82 : 58) * ui : 0;
      const margin = 10 * ui;
      const arenaTop = stageY + hudH + (hasHud ? 8 * ui : 10 * ui);
      const arenaHeight = stageH - hudH - (hasHud ? 18 * ui : 20 * ui);

      this.arena = {
        x: stageX + margin,
        y: arenaTop,
        w: Math.max(80, stageW - margin * 2),
        h: Math.max(120, arenaHeight),
      };

      this.scale = this.arena.w / WORLD_W;
      this.worldH = this.arena.h / this.scale;
      this.updateMuteButtonPosition();
    }

    makeSnow() {
      const count = Math.round(clamp((this.vw * this.vh) / 14000, 30, 90));
      this.snow = [];
      for (let i = 0; i < count; i++) {
        this.snow.push({
          x: Math.random() * this.vw,
          y: Math.random() * this.vh,
          r: rand(0.8, 2.4) * this.ui,
          vy: rand(8, 26) * this.ui,
          vx: rand(-6, 6) * this.ui,
          a: rand(0.14, 0.5),
          phase: rand(0, TAU),
        });
      }
    }

    makeConfetti() {
      const colors = ['#ffd166', '#ff6b6b', '#7ee0a3', '#7ec8ff', '#f4f7ff', '#ffa8d8'];
      const pieces = [];
      for (let i = 0; i < 46; i++) {
        pieces.push({
          nx: Math.random(),
          ny: Math.random(),
          speed: rand(0.5, 1.4),
          sway: rand(0.5, 1.6),
          phase: rand(0, TAU),
          spin: rand(0.6, 2.2),
          size: rand(3, 7),
          color: pick(colors),
        });
      }
      return pieces;
    }

    /* ================================================================ *
     *  ENTRADA: JOYSTICK FLOTANTE + TECLADO
     * ================================================================ */

    bindEvents() {
      this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
      window.addEventListener('pointermove', this.onPointerMove, { passive: false });
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointercancel', this.onPointerUp);
      this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      this.dom.primary.addEventListener('click', () => this.onPrimary());
      this.dom.secondary.addEventListener('click', () => this.onSecondary());
      this.dom.muteBtn.addEventListener('click', () => this.toggleMute());

      /* El contexto de audio necesita un gesto del usuario en móvil. */
      window.addEventListener('pointerdown', () => this.audio.ensure(), { passive: true });

      window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        this.audio.ensure();

        if (
          key === 'arrowup' ||
          key === 'arrowdown' ||
          key === 'arrowleft' ||
          key === 'arrowright' ||
          key === ' '
        ) {
          e.preventDefault();
        }
        this.keys.add(key);

        if (
          key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright' ||
          key === 'w' || key === 'a' || key === 's' || key === 'd'
        ) {
          this.hasUsedJoystick = true;
        }

        if (key === 'm' && !e.repeat) {
          e.preventDefault();
          this.toggleMute();
        }

        if (key === 'enter' && this.overlayKind) {
          e.preventDefault();
          this.onPrimary();
        }
      });

      window.addEventListener('keyup', (e) => {
        this.keys.delete(e.key.toLowerCase());
      });

      window.addEventListener('blur', () => this.resetInput());

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.resetInput();
        } else {
          this.lastTime = performance.now();
        }
      });

      window.addEventListener('resize', () => {
        if (this.resizeQueued) return;
        this.resizeQueued = true;
        requestAnimationFrame(() => {
          this.resizeQueued = false;
          this.resize();
        });
      });

      window.addEventListener('orientationchange', () => {
        setTimeout(() => this.resize(), 120);
      });

      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          if (this.resizeQueued) return;
          this.resizeQueued = true;
          requestAnimationFrame(() => {
            this.resizeQueued = false;
            this.resize();
          });
        });
      }
    }

    onPointerDown(e) {
      this.audio.ensure();

      if (this.state !== 'PLAYING') return;
      if (this.pointer.active) return;

      const local = this.toLocal(e);
      if (!pointInRect(local.x, local.y, this.arena)) return;

      this.pointer.active = true;
      this.pointer.id = e.pointerId;
      this.pointer.baseX = local.x;
      this.pointer.baseY = local.y;
      this.pointer.knobX = local.x;
      this.pointer.knobY = local.y;
      this.hasUsedJoystick = true;

      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer capture no disponible */
      }

      this.updateJoystick(local.x, local.y);
      e.preventDefault();
    }

    onPointerMove(e) {
      if (!this.pointer.active || e.pointerId !== this.pointer.id) return;
      const local = this.toLocal(e);
      this.updateJoystick(local.x, local.y);
      e.preventDefault();
    }

    onPointerUp(e) {
      if (!this.pointer.active || e.pointerId !== this.pointer.id) return;
      this.releaseJoystick();
    }

    updateJoystick(x, y) {
      const maxRadius = TUNING.joystickRadius * this.ui;
      const baseX = this.pointer.baseX;
      const baseY = this.pointer.baseY;

      let dx = x - baseX;
      let dy = y - baseY;
      const rawDist = Math.hypot(dx, dy);

      if (rawDist > maxRadius) {
        dx = (dx / rawDist) * maxRadius;
        dy = (dy / rawDist) * maxRadius;
      }

      this.pointer.knobX = baseX + dx;
      this.pointer.knobY = baseY + dy;

      if (rawDist < 0.0001) {
        this.input.x = 0;
        this.input.y = 0;
        return;
      }

      const magnitude = clamp(rawDist / maxRadius, 0, 1);
      const dead = TUNING.joystickDeadzone;
      const strength = magnitude <= dead ? 0 : (magnitude - dead) / (1 - dead);

      this.input.x = (dx / Math.hypot(dx, dy)) * strength;
      this.input.y = (dy / Math.hypot(dx, dy)) * strength;
    }

    releaseJoystick() {
      this.pointer.active = false;
      this.pointer.id = null;
      this.input.x = 0;
      this.input.y = 0;
    }

    resetInput() {
      this.releaseJoystick();
      this.keys.clear();
    }

    toLocal(e) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    /* ================================================================ *
     *  AYUDAS DE MUNDO
     * ================================================================ */

    findSpot(checks, margin) {
      const top = margin + 34;
      const bottom = this.worldH - margin;
      let fallback = { x: WORLD_W / 2, y: (top + bottom) / 2 };

      for (let i = 0; i < 500; i++) {
        const x = rand(margin, WORLD_W - margin);
        const y = rand(top, bottom);
        fallback = { x, y };

        let ok = true;
        for (const check of checks) {
          if (distance(x, y, check.x, check.y) < check.d) {
            ok = false;
            break;
          }
        }
        if (ok) return { x, y };
      }

      return fallback;
    }

    pushOutObstacles(entity) {
      if (!this.level) return;
      for (const o of this.level.obstacles) {
        const dx = entity.x - o.x;
        const dy = entity.y - o.y;
        const d = Math.hypot(dx, dy) || 1;
        const minDist = o.r + entity.r * 0.86;
        if (d < minDist) {
          entity.x = o.x + (dx / d) * minDist;
          entity.y = o.y + (dy / d) * minDist;
        }
      }
    }

    clampToArena(entity) {
      const side = TUNING.wallPadding + entity.r;
      const top = TUNING.topPlayArea + entity.r;
      const bottom = this.worldH - TUNING.wallPadding - entity.r;
      entity.x = clamp(entity.x, side, WORLD_W - side);
      entity.y = clamp(entity.y, top, Math.max(top, bottom));
    }

    nearestPrize(from) {
      if (!this.level) return null;
      let best = null;
      let bestDist = Infinity;
      for (const gift of this.level.prizes) {
        const d = distance(from.x, from.y, gift.x, gift.y);
        if (d < bestDist) {
          bestDist = d;
          best = gift;
        }
      }
      return best;
    }

    spawnBurst(x, y, colors, count, power) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * TAU;
        const speed = rand(power * 0.25, power);
        const life = rand(0.35, 0.8);
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 18,
          life,
          maxLife: life,
          size: rand(1.5, 3.6),
          color: pick(colors),
        });
      }
    }

    addFloater(x, y, text, color, size) {
      this.floaters.push({
        x,
        y,
        text,
        color,
        size,
        life: 0.8,
        maxLife: 0.8,
      });
    }

    showBanner(text, options = {}) {
      const duration = options.duration || 2.6;
      this.banner = {
        text,
        t: duration,
        duration,
        color: options.color || '#ffe9b0',
        bg: options.bg || 'rgba(9, 14, 32, 0.86)',
        border: options.border || 'rgba(255, 255, 255, 0.14)',
      };
    }

    /* ================================================================ *
     *  RENDER
     * ================================================================ */

    draw() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this.drawBackdrop();
      this.drawArena();
      this.drawSnow();
      this.drawConfetti();
      this.drawHud();
      this.drawJoystick();
    }

    drawBackdrop() {
      const ctx = this.ctx;
      const grad = ctx.createLinearGradient(0, 0, 0, this.vh);
      grad.addColorStop(0, '#0a1027');
      grad.addColorStop(0.45, '#0b1531');
      grad.addColorStop(1, '#060a18');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.vw, this.vh);

      const glow = ctx.createRadialGradient(
        this.vw / 2,
        this.vh * 0.14,
        0,
        this.vw / 2,
        this.vh * 0.14,
        Math.max(this.vw, this.vh) * 0.75
      );
      glow.addColorStop(0, 'rgba(58, 92, 190, 0.26)');
      glow.addColorStop(0.55, 'rgba(30, 50, 120, 0.09)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.vw, this.vh);

      /* Marco sutil cuando la pantalla es más ancha que el escenario */
      if (this.vw - this.stage.w > 8) {
        roundRectPath(
          ctx,
          this.stage.x,
          this.stage.y,
          this.stage.w,
          this.stage.h,
          26 * this.ui
        );
        ctx.fillStyle = 'rgba(8, 13, 30, 0.55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    drawArena() {
      const ctx = this.ctx;
      const a = this.arena;
      if (a.w <= 0 || a.h <= 0) return;

      const radius = 22 * this.ui;

      ctx.save();
      roundRectPath(ctx, a.x, a.y, a.w, a.h, radius);
      ctx.clip();

      /* Fondo de la pista */
      const bg = ctx.createLinearGradient(0, a.y, 0, a.y + a.h);
      bg.addColorStop(0, '#16234d');
      bg.addColorStop(0.5, '#111b3d');
      bg.addColorStop(1, '#0b1330');
      ctx.fillStyle = bg;
      ctx.fillRect(a.x, a.y, a.w, a.h);

      const glow = ctx.createRadialGradient(
        a.x + a.w / 2,
        a.y,
        0,
        a.x + a.w / 2,
        a.y,
        a.h * 0.6
      );
      glow.addColorStop(0, 'rgba(120, 160, 255, 0.13)');
      glow.addColorStop(1, 'rgba(120, 160, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(a.x, a.y, a.w, a.h);

      const scale = a.w / WORLD_W;

      ctx.save();
      if (this.shake > 0.001) {
        const amount = this.shake * this.shake * 9 * this.ui;
        ctx.translate(
          a.x + (Math.random() * 2 - 1) * amount,
          a.y + (Math.random() * 2 - 1) * amount
        );
      } else {
        ctx.translate(a.x, a.y);
      }
      ctx.scale(scale, scale);

      this.drawFloor();
      this.drawLights();

      if (this.level) {
        for (const obstacle of this.level.obstacles) this.drawObstacle(obstacle);
        for (const gift of this.level.prizes) this.drawPrize(gift);
        if (
          this.level.rival &&
          this.level.rival.mode === 'steal' &&
          this.level.rival.stealWindup > 0 &&
          this.level.rival.targetPrize &&
          this.level.prizes.includes(this.level.rival.targetPrize)
        ) {
          this.drawStealWarning(this.level.rival.targetPrize, this.level.rival.stealWindup);
        }
        if (this.level.rival) this.drawRival(this.level.rival);
        this.drawPlayer(this.level.player);
        this.drawParticles();
        this.drawBanner();
      } else {
        this.drawDemoScene();
        this.drawParticles();
      }

      ctx.restore();
      ctx.restore();

      /* Borde de la pista */
      ctx.save();
      roundRectPath(ctx, a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1, radius);
      ctx.strokeStyle = 'rgba(180, 205, 255, 0.16)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      /* Aviso visual de tiempo agotándose */
      if (
        this.state === 'PLAYING' &&
        this.level &&
        this.level.cfg.timeLimit > 0 &&
        this.level.timeLeft < 5
      ) {
        const pulse = 0.3 + 0.3 * Math.sin(this.t * 8);
        roundRectPath(ctx, a.x + 1, a.y + 1, a.w - 2, a.h - 2, radius);
        ctx.strokeStyle = `rgba(255, 90, 90, ${pulse})`;
        ctx.lineWidth = 2.5 * this.ui;
        ctx.stroke();
      }
      ctx.restore();
    }

    drawFloor() {
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = 'rgba(160, 190, 255, 0.055)';
      let row = 0;
      for (let y = 62; y < this.worldH; y += 44) {
        const offset = row % 2 === 0 ? 0 : 22;
        for (let x = 24; x < WORLD_W; x += 44) {
          ctx.beginPath();
          ctx.arc(x + offset, y, 1.4, 0, TAU);
          ctx.fill();
        }
        row++;
      }
      ctx.restore();
    }

    drawLights() {
      const ctx = this.ctx;
      const colors = ['#ffd166', '#ff6b6b', '#7ee0a3', '#7ec8ff', '#ffa8d8'];
      const left = 22;
      const right = WORLD_W - 22;
      const count = 9;

      ctx.save();
      ctx.strokeStyle = 'rgba(200, 215, 255, 0.18)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(left, 12);
      ctx.quadraticCurveTo(WORLD_W / 2, 44, right, 12);
      ctx.stroke();

      for (let i = 0; i < count; i++) {
        const u = count === 1 ? 0 : i / (count - 1);
        const x = lerp(left, right, u);
        const y =
          (1 - u) * (1 - u) * 12 + 2 * (1 - u) * u * 44 + u * u * 12 +
          Math.sin(this.t * 1.8 + i) * 1.3;
        const color = colors[i % colors.length];

        ctx.globalAlpha = 0.14;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 7.5, 0, TAU);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, TAU);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(x - 1.1, y - 1.1, 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    drawDemoScene() {
      const ctx = this.ctx;

      this.drawPrize({
        x: 74,
        y: this.worldH - 176,
        r: TUNING.prizeRadius,
        style: PRIZE_STYLES.green,
        seed: 2,
      });
      this.drawPrize({
        x: WORLD_W - 76,
        y: this.worldH - 238,
        r: TUNING.prizeRadius,
        style: PRIZE_STYLES.red,
        seed: 5,
      });
      this.drawPrize({
        x: WORLD_W - 118,
        y: this.worldH - 126,
        r: TUNING.prizeRadius * 0.9,
        style: PRIZE_STYLES.green,
        seed: 8,
      });

      this.drawGuinea(
        {
          x: WORLD_W / 2,
          y: this.worldH - 74,
          r: 18,
          facingX: 0,
          facingY: 1,
          moving: 0,
          invuln: 0,
          stun: 0,
          lean: 0,
        },
        { rival: false }
      );
    }

    drawObstacle(o) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(o.x, o.y);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
      ctx.beginPath();
      ctx.ellipse(0, o.r * 0.92, o.r * 0.98, o.r * 0.32, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#dbe8ff';
      ctx.beginPath();
      ctx.arc(0, 0, o.r, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#f4f9ff';
      ctx.beginPath();
      ctx.arc(-o.r * 0.24, -o.r * 0.26, o.r * 0.58, 0, TAU);
      ctx.fill();

      ctx.fillStyle = 'rgba(122, 154, 205, 0.34)';
      for (let i = 0; i < 3; i++) {
        const a = o.seed + i * 2.1;
        ctx.beginPath();
        ctx.arc(
          Math.cos(a) * o.r * 0.42,
          Math.sin(a) * o.r * 0.42,
          o.r * 0.09,
          0,
          TAU
        );
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, o.r, 0, TAU);
      ctx.stroke();

      ctx.restore();
    }

    drawPrize(prize) {
      const ctx = this.ctx;
      const s = prize.r;
      const style = prize.style;
      const bob = Math.sin(this.t * 2.2 + prize.seed) * 2.2;
      const tilt = Math.sin(this.t * 1.4 + prize.seed) * 0.06;

      const outer = s * 1.18;
      const band = s * 0.5;
      const ringRadius = outer - band * 0.5;

      ctx.save();
      ctx.translate(prize.x, prize.y + bob);
      ctx.rotate(tilt);

      /* Halo */
      ctx.fillStyle = style.glow;
      ctx.beginPath();
      ctx.arc(0, 0, s * 2.3, 0, TAU);
      ctx.fill();

      /* Sombra */
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(0, s * 1.1, s * 1.06, s * 0.32, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      /* Aro de premio */
      const gradient = ctx.createLinearGradient(-outer, -outer, outer, outer);
      gradient.addColorStop(0, style.light);
      gradient.addColorStop(0.45, style.main);
      gradient.addColorStop(1, style.dark);

      ctx.strokeStyle = gradient;
      ctx.lineWidth = band;
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius, 0, TAU);
      ctx.stroke();

      /* Bordes del aro */
      ctx.strokeStyle = 'rgba(20, 10, 20, 0.35)';
      ctx.lineWidth = s * 0.075;
      ctx.beginPath();
      ctx.arc(0, 0, outer, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = s * 0.06;
      ctx.beginPath();
      ctx.arc(0, 0, outer - band, 0, TAU);
      ctx.stroke();

      /* Brillo superior izquierdo */
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)';
      ctx.lineWidth = s * 0.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius - band * 0.18, Math.PI * 1.04, Math.PI * 1.55);
      ctx.stroke();

      /* Destello del premio */
      const sparkle = 0.5 + 0.5 * Math.sin(this.t * 3 + prize.seed);
      ctx.fillStyle = style.sparkle;
      ctx.globalAlpha = 0.55 + sparkle * 0.45;
      starPath(
        ctx,
        ringRadius * 0.72,
        -ringRadius * 0.72,
        s * 0.24,
        s * 0.09,
        4,
        this.t * 2
      );
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();
    }

    drawPlayer(p) {
      if (!p) return;
      this.drawGuinea(p, { rival: false });
      if (p.stun > 0) this.drawStunStars(p);
    }

    drawStealWarning(prize, windup) {
      const ctx = this.ctx;
      const total = (this.level.cfg.rival && this.level.cfg.rival.stealWindup) || 1.1;
      const progress = clamp(1 - windup / total, 0, 1);
      const radius = prize.r * 2.8 - progress * prize.r * 1.1;

      ctx.save();
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(this.t * 12);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(prize.x, prize.y, radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ffd166';
      ctx.font = `900 9px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', prize.x, prize.y - radius - 7);
      ctx.restore();
    }

    drawRival(r) {
      const asleep = r.mode === 'asleep';
      this.drawGuinea(r, { rival: true, asleep });

      if (asleep) {
        this.drawZzz(r);
        return;
      }

      const topY = r.y - r.r * 2.55;
      if (r.mode === 'steal') {
        this.drawThoughtPrize(
          r.x,
          topY,
          r.targetPrize ? r.targetPrize.style : PRIZE_STYLES.red
        );
      } else {
        this.drawAlert(r.x, topY);
      }
    }

    drawGuinea(g, options = {}) {
      const ctx = this.ctx;
      const r = g.r;
      const rival = !!options.rival;
      const asleep = !!options.asleep;

      const moving = (g.moving || 0) > 0.08;
      const phase = rival ? 1.7 : 0;
      const bob = moving
        ? Math.sin(this.t * 13 + phase) * 1.4
        : Math.sin(this.t * 2.4 + phase) * 0.55;

      const blinking = g.stun > 0 ? 1 : g.invuln > 0 ? 0.55 + 0.45 * Math.sin(this.t * 22) : 1;

      /* Paletas: Fito es un skinny pig rosa con manchas grises;
         Castanho tiene cara blanca con blaze, corona y espalda castañas,
         como la cobaya de la foto. */
      const skin = rival ? '#f7f1e7' : '#edb0ad';
      const furDark = rival ? '#d8cdbb' : '#c98283';
      const belly = rival ? '#fffaf0' : '#f9d5ce';
      const patch = rival ? '#c06a34' : '#5f5961';
      const eyeColor = '#2b201b';
      const noseColor = rival ? '#b97670' : '#b96b70';

      /* Sombra */
      ctx.save();
      ctx.globalAlpha = 0.28 * blinking;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(g.x, g.y + r * 0.98, r * 0.98, r * 0.36, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = blinking;
      ctx.translate(g.x, g.y + bob);
      if (g.lean) ctx.rotate(g.lean);

      /* Respiración / rebote */
      let squash = 1;
      if (asleep) squash = 1 + Math.sin(this.t * 1.8) * 0.025;
      else if (moving) squash = 1 + Math.sin(this.t * 13 + phase) * 0.025;
      ctx.scale(1 / squash, squash);

      /* Orejas (Castanho: una blanca y una castaña; Fito: una gris y una rosa) */
      const ears = rival
        ? [
            { side: -1, color: '#f7f1e7', inner: '#d9a5a0' },
            { side: 1, color: '#c06a34', inner: '#d1937f' },
          ]
        : [
            { side: -1, color: '#5f5961', inner: '#d98d93' },
            { side: 1, color: '#edb0ad', inner: '#d98d93' },
          ];

      for (const ear of ears) {
        ctx.fillStyle = ear.color;
        ctx.beginPath();
        ctx.arc(ear.side * r * 0.62, -r * 0.8, r * 0.44, 0, TAU);
        ctx.fill();

        ctx.fillStyle = ear.inner;
        ctx.beginPath();
        ctx.arc(ear.side * r * 0.62, -r * 0.8, r * 0.2, 0, TAU);
        ctx.fill();
      }

      /* Patitas */
      ctx.fillStyle = rival ? '#c9895c' : furDark;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * r * 0.52, r * 0.84, r * 0.31, r * 0.22, 0, 0, TAU);
        ctx.fill();
      }

      /* Cuerpo */
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.08, r, 0, 0, TAU);
      ctx.fill();

      /* Manchas recortadas a la silueta del cuerpo */
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.08, r, 0, 0, TAU);
      ctx.clip();

      if (rival) {
        /* Castanho: corona y espalda castañas, cara blanca con blaze */
        ctx.fillStyle = patch;
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.62, r * 1.03, r * 0.62, 0, 0, TAU);
        ctx.fill();

        /* Extensiones laterales de la capa castaña */
        ctx.beginPath();
        ctx.ellipse(-r * 0.78, -r * 0.36, r * 0.3, r * 0.4, 0.2, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(r * 0.78, -r * 0.36, r * 0.3, r * 0.4, -0.2, 0, TAU);
        ctx.fill();

        /* Máscara blanca de la cara */
        ctx.fillStyle = belly;
        ctx.beginPath();
        ctx.ellipse(0, r * 0.04, r * 0.68, r * 0.5, 0, 0, TAU);
        ctx.fill();

        /* Blaze blanco de la frente, como en la foto */
        ctx.beginPath();
        ctx.moveTo(-r * 0.14, -r * 0.98);
        ctx.quadraticCurveTo(-r * 0.24, -r * 0.62, -r * 0.16, -r * 0.34);
        ctx.quadraticCurveTo(0, -r * 0.2, r * 0.16, -r * 0.34);
        ctx.quadraticCurveTo(r * 0.24, -r * 0.62, r * 0.14, -r * 0.98);
        ctx.closePath();
        ctx.fill();
      } else {
        /* Fito: piel rosada con manchas gris oscuro y arruguitas */
        ctx.fillStyle = patch;
        ctx.beginPath();
        ctx.ellipse(-r * 0.58, -r * 0.38, r * 0.58, r * 0.44, 0.35, 0, TAU);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(r * 0.56, r * 0.38, r * 0.38, r * 0.28, -0.4, 0, TAU);
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(r * 0.14, -r * 0.72, r * 0.22, r * 0.14, 0.15, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = 'rgba(150, 80, 84, 0.32)';
        ctx.lineWidth = r * 0.035;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(-r * 0.12, r * 0.18, r * 0.62, 0.18 * Math.PI, 0.58 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 0.12, r * 0.1, r * 0.72, 0.22 * Math.PI, 0.62 * Math.PI);
        ctx.stroke();
      }

      ctx.restore();

      /* Brillo del pelaje / de la piel */
      ctx.globalAlpha = blinking * (rival ? 0.16 : 0.1);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(-r * 0.3, -r * 0.36, r * 0.56, r * 0.4, -0.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = blinking;

      /* Barriga */
      ctx.fillStyle = belly;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.3, r * 0.62, r * 0.52, 0, 0, TAU);
      ctx.fill();

      /* Mejillas */
      ctx.fillStyle = 'rgba(255, 140, 150, 0.25)';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * r * 0.56, r * 0.18, r * 0.18, r * 0.12, 0, 0, TAU);
        ctx.fill();
      }

      /* Cara */
      const eyeShiftX = clamp(g.facingX || 0, -1, 1) * r * 0.16;
      const eyeShiftY = clamp(g.facingY || 0, -1, 1) * r * 0.1;

      if (asleep) {
        ctx.strokeStyle = '#4a3a30';
        ctx.lineWidth = r * 0.085;
        ctx.lineCap = 'round';
        for (const side of [-1, 1]) {
          const ex = side * r * 0.34 + eyeShiftX * 0.4;
          const ey = -r * 0.14 + eyeShiftY * 0.4;
          ctx.beginPath();
          ctx.moveTo(ex - r * 0.14, ey);
          ctx.quadraticCurveTo(ex, ey + r * 0.1, ex + r * 0.14, ey);
          ctx.stroke();
        }
      } else if (rival) {
        /* Castanho: ojos oscuros y saltones, con mirada de loca hambrienta */
        const eyeSpecs = [
          { side: -1, radius: r * 0.16, iris: r * 0.12 },
          { side: 1, radius: r * 0.2, iris: r * 0.155 },
        ];

        for (const eye of eyeSpecs) {
          const ex = eye.side * r * 0.34 + eyeShiftX;
          const ey = -r * 0.12 + eyeShiftY;
          /* Mirada bizca y desigual: más de loca */
          const irisX = ex - eye.side * eye.radius * 0.2;
          const irisY = ey + eye.side * eye.radius * 0.05;

          /* Finísimo borde claro para separar el ojo del pelaje */
          ctx.fillStyle = '#fffaf0';
          ctx.beginPath();
          ctx.arc(ex, ey, eye.radius, 0, TAU);
          ctx.fill();

          /* Iris oscuro grande, como el de la foto */
          ctx.fillStyle = eyeColor;
          ctx.beginPath();
          ctx.arc(irisX, irisY, eye.iris, 0, TAU);
          ctx.fill();

          ctx.strokeStyle = 'rgba(70, 45, 30, 0.55)';
          ctx.lineWidth = r * 0.025;
          ctx.beginPath();
          ctx.arc(ex, ey, eye.radius, 0, TAU);
          ctx.stroke();

          /* Brillo húmedo */
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(
            irisX - eye.iris * 0.33,
            irisY - eye.iris * 0.38,
            eye.iris * 0.34,
            0,
            TAU
          );
          ctx.fill();

          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.beginPath();
          ctx.arc(irisX + eye.iris * 0.32, irisY + eye.iris * 0.28, eye.iris * 0.13, 0, TAU);
          ctx.fill();
        }

        /* Cejas alzadas y desiguales */
        ctx.strokeStyle = '#49230f';
        ctx.lineWidth = r * 0.075;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-r * 0.56 + eyeShiftX * 0.4, -r * 0.5 + eyeShiftY * 0.4);
        ctx.quadraticCurveTo(
          -r * 0.36 + eyeShiftX * 0.4,
          -r * 0.64,
          -r * 0.16 + eyeShiftX * 0.4,
          -r * 0.52
        );
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(r * 0.54 + eyeShiftX * 0.4, -r * 0.38 + eyeShiftY * 0.4);
        ctx.quadraticCurveTo(
          r * 0.36 + eyeShiftX * 0.4,
          -r * 0.58,
          r * 0.16 + eyeShiftX * 0.4,
          -r * 0.46
        );
        ctx.stroke();
      } else {
        /* Ojos amables y grandes de Fito */
        for (const side of [-1, 1]) {
          const ex = side * r * 0.34 + eyeShiftX;
          const ey = -r * 0.14 + eyeShiftY;

          ctx.fillStyle = eyeColor;
          ctx.beginPath();
          ctx.arc(ex, ey, r * 0.16, 0, TAU);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(ex - r * 0.045, ey - r * 0.05, r * 0.058, 0, TAU);
          ctx.fill();

          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.beginPath();
          ctx.arc(ex + r * 0.055, ey + r * 0.045, r * 0.022, 0, TAU);
          ctx.fill();
        }

        /* Arrugas de la frente de un skinny pig */
        ctx.strokeStyle = 'rgba(150, 80, 84, 0.28)';
        ctx.lineWidth = r * 0.035;
        ctx.lineCap = 'round';
        for (let i = 0; i < 2; i++) {
          const yy = -r * 0.36 - i * r * 0.12;
          ctx.beginPath();
          ctx.moveTo(-r * 0.26, yy);
          ctx.quadraticCurveTo(0, yy - r * 0.06, r * 0.26, yy);
          ctx.stroke();
        }
      }

      /* Nariz */
      ctx.fillStyle = noseColor;
      ctx.beginPath();
      ctx.ellipse(eyeShiftX * 1.2, r * 0.25, r * 0.16, r * 0.12, 0, 0, TAU);
      ctx.fill();

      /* Boca */
      if (rival && !asleep) {
        /* Sonrisa de hambre con lengua y babilla */
        const mx = eyeShiftX * 1.2;
        const my = r * 0.5;

        ctx.fillStyle = '#4a2328';
        ctx.beginPath();
        ctx.ellipse(mx, my, r * 0.26, r * 0.15, 0, 0, TAU);
        ctx.fill();

        ctx.fillStyle = '#fffaf0';
        ctx.fillRect(mx - r * 0.09, my - r * 0.12, r * 0.055, r * 0.07);
        ctx.fillRect(mx + r * 0.035, my - r * 0.12, r * 0.055, r * 0.07);

        ctx.fillStyle = '#e77786';
        ctx.beginPath();
        ctx.ellipse(mx, my + r * 0.1, r * 0.15, r * 0.09, 0, 0, TAU);
        ctx.fill();

        const droolBob = Math.sin(this.t * 3.6) * r * 0.018;
        ctx.fillStyle = 'rgba(210, 240, 255, 0.85)';
        ctx.beginPath();
        ctx.ellipse(
          mx + r * 0.23,
          my + r * 0.13 + droolBob,
          r * 0.045,
          r * 0.065,
          0.2,
          0,
          TAU
        );
        ctx.fill();
        ctx.beginPath();
        ctx.arc(mx + r * 0.22, my + r * 0.3 + droolBob, r * 0.022, 0, TAU);
        ctx.fill();

        /* Trocito de pimiento amarillo, como el de la foto */
        ctx.save();
        ctx.translate(mx - r * 0.22, my - r * 0.02);
        ctx.rotate(0.8);
        ctx.fillStyle = '#f2c94c';
        roundRectPath(ctx, -r * 0.04, 0, r * 0.08, r * 0.27, r * 0.04);
        ctx.fill();
        ctx.fillStyle = '#d8a52a';
        roundRectPath(ctx, -r * 0.026, r * 0.21, r * 0.052, r * 0.07, r * 0.026);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.strokeStyle = rival ? 'rgba(70, 45, 35, 0.7)' : 'rgba(120, 60, 64, 0.72)';
        ctx.lineWidth = r * 0.055;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(eyeShiftX * 1.2 - r * 0.1, r * 0.42);
        ctx.quadraticCurveTo(eyeShiftX * 1.2, r * 0.5, eyeShiftX * 1.2 + r * 0.1, r * 0.42);
        ctx.stroke();
      }

      /* Gorro de Papá Noel (solo jugadora) */
      if (!rival) {
        ctx.save();
        ctx.rotate(g.lean * 0.8);

        ctx.fillStyle = '#fff7ec';
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.92, r * 0.98, r * 0.3, 0, 0, TAU);
        ctx.fill();

        ctx.fillStyle = '#d83a3a';
        ctx.beginPath();
        ctx.moveTo(-r * 0.72, -r * 1.02);
        ctx.quadraticCurveTo(-r * 0.5, -r * 1.8, r * 0.22, -r * 2.18);
        ctx.quadraticCurveTo(r * 0.62, -r * 1.5, r * 0.72, -r * 1);
        ctx.quadraticCurveTo(0, -r * 1.25, -r * 0.72, -r * 1.02);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = blinking * 0.16;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(-r * 0.16, -r * 1.5, r * 0.18, r * 0.34, 0.3, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = blinking;

        ctx.fillStyle = '#fff7ec';
        ctx.beginPath();
        ctx.arc(r * 0.3, -r * 2.16, r * 0.28, 0, TAU);
        ctx.fill();

        ctx.restore();
      }

      /* Collar de Castanho */
      if (rival) {
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = r * 0.17;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, r * 0.18, r * 0.72, 0.16 * Math.PI, 0.84 * Math.PI);
        ctx.stroke();

        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(0, r * 0.9, r * 0.14, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    }

    drawStunStars(p) {
      const ctx = this.ctx;
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const angle = this.t * 6 + (i * TAU) / 3;
        const x = p.x + Math.cos(angle) * p.r * 1.35;
        const y = p.y - p.r * 1.8 + Math.sin(angle) * p.r * 0.32;
        starPath(ctx, x, y, p.r * 0.22, p.r * 0.09, 5, this.t * 4 + i);
        ctx.fillStyle = i === 1 ? '#fff3c4' : '#ffd166';
        ctx.fill();
      }
      ctx.restore();
    }

    drawZzz(r) {
      const ctx = this.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 3; i++) {
        const p = (this.t * 0.42 + i / 3) % 1;
        const alpha = Math.sin(p * Math.PI);
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = '#cfe0ff';
        ctx.font = `900 ${8 + p * 7}px ${UI_FONT}`;
        ctx.fillText('Z', r.x + 16 + p * 24, r.y - r.r * 2 - p * 30);
      }
      ctx.restore();
    }

    drawAlert(x, y) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);

      ctx.fillStyle = '#ff5d6c';
      ctx.beginPath();
      ctx.arc(0, 0, 7.2, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 7.2, 0, TAU);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `900 10px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, 0.6);

      ctx.restore();
    }

    drawThoughtPrize(x, y, style) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);

      ctx.fillStyle = 'rgba(255, 209, 102, 0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.restore();

      this.drawPrizeIcon(x, y + 0.5, 4.4, style);
    }

    drawParticles() {
      const ctx = this.ctx;

      for (const p of this.particles) {
        const alpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, TAU);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      for (const f of this.floaters) {
        const alpha = clamp(f.life / f.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = f.color;
        ctx.font = `900 ${f.size}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.text, f.x, f.y - (1 - alpha) * 6);
      }

      ctx.globalAlpha = 1;
    }

    drawBanner() {
      if (!this.banner) return;
      const ctx = this.ctx;
      const bar = this.banner;
      const age = bar.duration - bar.t;
      const alpha = clamp(Math.min(bar.t / 0.45, age / 0.18), 0, 1);
      const pop = 0.94 + 0.06 * clamp(age / 0.25, 0, 1);

      let fontSize = 12;
      ctx.save();
      ctx.font = `800 ${fontSize}px ${UI_FONT}`;
      const maxWidth = WORLD_W - 40;
      while (ctx.measureText(bar.text).width + 26 > maxWidth && fontSize > 8) {
        fontSize -= 0.5;
        ctx.font = `800 ${fontSize}px ${UI_FONT}`;
      }

      const width = Math.min(ctx.measureText(bar.text).width + 26, maxWidth);
      const height = 30;
      const x = WORLD_W / 2;
      const y = 57;

      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(pop, pop);

      roundRectPath(ctx, -width / 2, -height / 2, width, height, height / 2);
      ctx.fillStyle = bar.bg;
      ctx.fill();
      ctx.strokeStyle = bar.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = bar.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${fontSize}px ${UI_FONT}`;
      ctx.fillText(bar.text, 0, 0.5);

      ctx.restore();
    }

    drawSnow() {
      const ctx = this.ctx;
      ctx.save();
      for (const flake of this.snow) {
        ctx.globalAlpha = flake.a;
        ctx.fillStyle = '#eaf1ff';
        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    drawConfetti() {
      if (this.state !== 'VICTORY') return;

      const ctx = this.ctx;
      const elapsed = Math.max(0, this.t - this.victoryAt);
      ctx.save();

      for (const c of this.confetti) {
        const x =
          ((c.nx * this.vw + Math.sin(this.t * c.sway + c.phase) * 22) % this.vw + this.vw) %
          this.vw;
        const y = ((c.ny * this.vh + elapsed * c.speed * 70) % (this.vh + 30)) - 15;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(this.t * c.spin + c.phase);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
        ctx.restore();
      }

      ctx.restore();
    }

    drawHud() {
      if (!this.level) return;

      const ctx = this.ctx;
      const lvl = this.level;
      const a = this.arena;
      const ui = this.ui;
      const y0 = this.stage.y + 10 * ui;
      const rowH = 40 * ui;
      const levelPillW = 84 * ui;
      const prizePillW = 116 * ui;
      const radius = 13 * ui;

      /* Píldora de nivel */
      roundRectPath(ctx, a.x, y0, levelPillW, rowH, radius);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(226, 235, 255, 0.55)';
      ctx.font = `800 ${8.5 * ui}px ${UI_FONT}`;
      ctx.fillText('NIVEL', a.x + 12 * ui, y0 + 13 * ui);

      ctx.fillStyle = '#f4f7ff';
      ctx.font = `900 ${16 * ui}px ${UI_FONT}`;
      ctx.fillText(`${this.levelIndex + 1} / 5`, a.x + 12 * ui, y0 + 28 * ui);

      /* Píldora de premios (deja sitio al botón de sonido) */
      const prizeX = a.x + a.w - prizePillW - this.muteSize - this.muteGap;
      roundRectPath(ctx, prizeX, y0, prizePillW, rowH, radius);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      this.drawPrizeIcon(prizeX + 20 * ui, y0 + rowH / 2, 6.6 * ui);

      ctx.fillStyle = '#f4f7ff';
      ctx.font = `900 ${15 * ui}px ${UI_FONT}`;
      ctx.fillText(
        `${lvl.collected} / ${lvl.cfg.prizes}`,
        prizeX + 36 * ui,
        y0 + rowH / 2 + 1
      );

      /* Título del nivel, centrado en el hueco entre las dos píldoras */
      const titleLeft = a.x + levelPillW + 8 * ui;
      const titleRight = prizeX - 8 * ui;
      const available = titleRight - titleLeft;
      const label = lvl.cfg.title.toUpperCase();
      ctx.font = `800 ${9 * ui}px ${UI_FONT}`;
      if (available > 0 && ctx.measureText(label).width < available) {
        ctx.fillStyle = 'rgba(226, 235, 255, 0.5)';
        ctx.textAlign = 'center';
        ctx.fillText(label, (titleLeft + titleRight) / 2, y0 + rowH / 2);
      }

      /* Barra de tiempo */
      if (lvl.cfg.timeLimit > 0) {
        const ty = y0 + rowH + 7 * ui;
        const th = 16 * ui;
        const ratio = clamp(lvl.timeLeft / lvl.cfg.timeLimit, 0, 1);
        const timeColor = ratio > 0.5 ? '#7ee0a3' : ratio > 0.25 ? '#ffd166' : '#ff6b6b';

        roundRectPath(ctx, a.x, ty, a.w, th, th / 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fill();

        if (ratio > 0.001) {
          const fillW = Math.max(th, a.w * ratio);
          roundRectPath(ctx, a.x, ty, fillW, th, th / 2);
          ctx.fillStyle = timeColor;
          ctx.globalAlpha = 0.9;
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        ctx.fillStyle = ratio <= 0.25 ? '#ffdede' : '#eaf0ff';
        ctx.font = `900 ${10 * ui}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `TIEMPO ${formatTime(lvl.timeLeft)}`,
          a.x + a.w / 2,
          ty + th / 2 + 0.5 * ui
        );
      }
    }

    drawPrizeIcon(x, y, s, style = PRIZE_STYLES.red) {
      const ctx = this.ctx;
      const outer = s * 1.05;
      const band = s * 0.56;
      const radius = outer - band / 2;

      ctx.save();
      ctx.translate(x, y);

      const gradient = ctx.createLinearGradient(-outer, -outer, outer, outer);
      gradient.addColorStop(0, style.light);
      gradient.addColorStop(0.45, style.main);
      gradient.addColorStop(1, style.dark);

      ctx.strokeStyle = gradient;
      ctx.lineWidth = band;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(20, 10, 20, 0.3)';
      ctx.lineWidth = Math.max(0.6, s * 0.08);
      ctx.beginPath();
      ctx.arc(0, 0, outer, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = Math.max(0.6, s * 0.12);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, radius - band * 0.12, Math.PI * 1.05, Math.PI * 1.55);
      ctx.stroke();

      ctx.restore();
    }

    drawJoystick() {
      if (this.state !== 'PLAYING' || !this.level) return;

      const ctx = this.ctx;
      const ui = this.ui;
      const maxRadius = TUNING.joystickRadius * ui;

      if (this.pointer.active) {
        const { baseX, baseY, knobX, knobY } = this.pointer;

        ctx.save();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
        ctx.beginPath();
        ctx.arc(baseX, baseY, maxRadius, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(baseX, baseY, maxRadius, 0, TAU);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.075)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(baseX, baseY, maxRadius * 0.55, 0, TAU);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 231, 168, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(knobX, knobY);
        ctx.stroke();

        const knobRadius = maxRadius * 0.4;
        const gradient = ctx.createRadialGradient(
          knobX - knobRadius * 0.3,
          knobY - knobRadius * 0.35,
          1,
          knobX,
          knobY,
          knobRadius
        );
        gradient.addColorStop(0, '#fff6d8');
        gradient.addColorStop(0.55, '#ffd166');
        gradient.addColorStop(1, '#e09a2d');

        ctx.shadowColor = 'rgba(255, 180, 60, 0.35)';
        ctx.shadowBlur = 16 * ui;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(knobX, knobY, knobRadius, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(knobX, knobY, knobRadius, 0, TAU);
        ctx.stroke();

        ctx.restore();
        return;
      }

      /* Pista de control la primera vez */
      if (!this.hasUsedJoystick) {
        const x = this.arena.x + 78 * ui;
        const y = this.arena.y + this.arena.h - 104 * ui;
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
        const radius = maxRadius * 0.82;

        ctx.save();

        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'rgba(6, 10, 24, 0.45)';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.fill();

        ctx.globalAlpha = 0.3 + pulse * 0.14;
        ctx.setLineDash([4 * ui, 5 * ui]);
        ctx.strokeStyle = 'rgba(225, 235, 255, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);

        const knobRadius = radius * 0.34;
        const knobGradient = ctx.createRadialGradient(
          x - knobRadius * 0.25,
          y - knobRadius * 0.3,
          1,
          x,
          y,
          knobRadius
        );
        knobGradient.addColorStop(0, '#fff4cf');
        knobGradient.addColorStop(0.6, '#ffd166');
        knobGradient.addColorStop(1, '#dfa03a');

        ctx.globalAlpha = 0.75 + pulse * 0.2;
        ctx.fillStyle = knobGradient;
        ctx.beginPath();
        ctx.arc(x, y, knobRadius, 0, TAU);
        ctx.fill();

        ctx.globalAlpha = 0.88;
        ctx.fillStyle = 'rgba(240, 246, 255, 0.85)';
        ctx.font = `800 ${9 * ui}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ARRASTRA PARA MOVERTE', this.arena.x + this.arena.w / 2, y - radius - 15 * ui);

        ctx.restore();
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  ARRANQUE
   * ------------------------------------------------------------------ */

  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('game');
    if (!canvas) return;

    const game = new CobayaGolosa(canvas);
    window.__cobayaGolosa = game; // útil para depurar desde la consola

    /* Atajo de desarrollo: index.html?level=3 empieza en ese nivel. */
    const params = new URLSearchParams(window.location.search);
    const startAt = Number.parseInt(params.get('level'), 10);
    if (Number.isInteger(startAt) && startAt >= 1 && startAt <= LEVELS_CONFIG.length) {
      game.startLevel(startAt - 1);
    }
  });
})();
