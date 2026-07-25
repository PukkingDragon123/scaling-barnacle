// ---- synthesized audio: sfx + generative music ---------------------------
'use strict';

const PENTA = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3];

const SND = {
  ctx: null, master: null, ready: false, muted: false,
  scene: 'title',           // title | surface | house | dive | shark
  nextPluck: 0, nextBass: 0, nextBeat: 0, nextBubble: 0,
  heartRate: 0.9,
  pad: null,                // { oscs, gain, filter, gloom }
  droneHum: null,

  init() {
    if (this.ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // feedback delay for dreamy space
      this.delay = this.ctx.createDelay(1.0);
      this.delay.delayTime.value = 0.29;
      this.delayGain = this.ctx.createGain();
      this.delayGain.gain.value = 0.3;
      this.delay.connect(this.delayGain);
      this.delayGain.connect(this.delay);
      this.delayGain.connect(this.master);
      // shared noise buffer
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.ready = true;
    } catch (e) { /* audio unavailable; game still playable */ }
  },

  resume() { if (this.ready && this.ctx.state === 'suspended') this.ctx.resume(); },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  },

  tone(o = {}) {
    if (!this.ready || this.muted) return;
    const { f = 440, f2 = 0, type = 'sine', a = 0.005, d = 0.2, v = 0.25, t = 0, fx = false } = o;
    const c = this.ctx, t0 = c.currentTime + t;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f), t0);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + d);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    osc.connect(g); g.connect(this.master);
    if (fx) g.connect(this.delay);
    osc.start(t0); osc.stop(t0 + a + d + 0.1);
  },

  noise(o = {}) {
    if (!this.ready || this.muted) return;
    const { d = 0.15, v = 0.25, f = 1200, f2 = 0, q = 1.2, t = 0 } = o;
    const c = this.ctx, t0 = c.currentTime + t;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = rand(0.85, 1.15);
    const flt = c.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.setValueAtTime(f, t0); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t0 + d);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + d + 0.1);
  },

  // ---- sfx ---------------------------------------------------------------
  click()  { this.tone({ f: 660, type: 'square', d: 0.05, v: 0.1 }); },
  blip()   { this.tone({ f: 880, type: 'square', d: 0.04, v: 0.08 }); },
  pop(p = 1) {
    this.noise({ f: 2400, d: 0.05, v: 0.2 });
    this.tone({ f: 260 * p, f2: 80, type: 'triangle', d: 0.12, v: 0.35 });
    this.tone({ f: 520 * p, f2: 200, type: 'sine', d: 0.08, v: 0.15, t: 0.01 });
  },
  scrape() { this.noise({ f: rand(700, 1600), f2: rand(400, 900), d: 0.07, v: 0.12, q: 2.5 }); },
  clink()  { this.tone({ f: rand(1800, 2400), type: 'square', d: 0.03, v: 0.05 }); },
  splash() { this.noise({ f: 900, f2: 250, d: 0.45, v: 0.35, q: 0.8 }); },
  bubble() { this.tone({ f: rand(300, 500), f2: rand(700, 1100), type: 'sine', d: 0.12, v: 0.05 }); },
  chime()  {
    [880, 1320, 1760, 2200].forEach((f, i) =>
      this.tone({ f, type: 'sine', d: 0.5, v: 0.14, t: i * 0.09, fx: true }));
  },
  cash() {
    this.tone({ f: 1150, type: 'square', d: 0.06, v: 0.12 });
    this.tone({ f: 1540, type: 'square', d: 0.1, v: 0.12, t: 0.07 });
  },
  hurt() {
    this.tone({ f: 220, f2: 60, type: 'sawtooth', d: 0.25, v: 0.3 });
    this.noise({ f: 400, f2: 120, d: 0.2, v: 0.25 });
  },
  bite() {
    this.noise({ f: 300, f2: 80, d: 0.25, v: 0.5, q: 0.7 });
    this.tone({ f: 90, f2: 35, type: 'sawtooth', d: 0.35, v: 0.5 });
  },
  warn()   { this.tone({ f: 980, type: 'square', d: 0.07, v: 0.15 }); this.tone({ f: 980, type: 'square', d: 0.07, v: 0.15, t: 0.12 }); },
  alarm()  { this.tone({ f: 700, f2: 500, type: 'square', d: 0.15, v: 0.1 }); },
  gull()   { this.tone({ f: rand(1100, 1400), f2: 800, type: 'sine', d: 0.25, v: 0.06 }); this.tone({ f: rand(1200, 1500), f2: 850, type: 'sine', d: 0.2, v: 0.05, t: 0.22 }); },
  whale()  { this.tone({ f: 65, f2: 110, type: 'sine', d: 2.8, v: 0.14, fx: true }); },
  relief() { [392, 494, 587].forEach((f, i) => this.tone({ f, type: 'triangle', d: 0.7, v: 0.1, t: i * 0.12, fx: true })); },
  thump(v = 0.5) {
    this.tone({ f: 58, f2: 36, type: 'sine', d: 0.12, v });
    this.tone({ f: 52, f2: 34, type: 'sine', d: 0.1, v: v * 0.6, t: 0.16 });
  },
  sleepy() { [523, 392, 329, 261].forEach((f, i) => this.tone({ f, type: 'triangle', d: 0.6, v: 0.09, t: i * 0.16, fx: true })); },

  droneOn() {
    if (!this.ready || this.droneHum || this.muted) return;
    const c = this.ctx;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o1.type = 'sawtooth'; o1.frequency.value = 92;
    o2.type = 'sawtooth'; o2.frequency.value = 187;
    g.gain.value = 0.028;
    o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.droneHum = { o1, o2, g };
  },
  droneOff() {
    if (!this.droneHum) return;
    const { o1, o2, g } = this.droneHum;
    try { g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.1); o1.stop(this.ctx.currentTime + 0.4); o2.stop(this.ctx.currentTime + 0.4); } catch (e) {}
    this.droneHum = null;
  },

  // ---- underwater pad ------------------------------------------------------
  padOn(gloomy) {
    if (!this.ready) return;
    this.padOff();
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0;
    const flt = c.createBiquadFilter(); flt.type = 'lowpass';
    flt.frequency.value = gloomy ? 160 : 320;
    const oscs = [];
    const fs = gloomy ? [55, 58.3, 41] : [55, 55.4, 82.5];
    for (const f of fs) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(flt); o.start(); oscs.push(o);
    }
    flt.connect(g); g.connect(this.master);
    g.gain.setTargetAtTime(gloomy ? 0.09 : 0.05, c.currentTime, 0.8);
    this.pad = { oscs, gain: g, filter: flt, gloom: !!gloomy };
  },
  padOff() {
    if (!this.pad) return;
    const p = this.pad, c = this.ctx;
    try {
      p.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.4);
      p.oscs.forEach(o => o.stop(c.currentTime + 1.6));
    } catch (e) {}
    this.pad = null;
  },

  setScene(s) {
    if (s === this.scene) return;
    const prev = this.scene;
    this.scene = s;
    if (!this.ready) return;
    if (s === 'dive') this.padOn(false);
    else if (s === 'shark') { this.padOn(true); this.heartRate = 1.0; this.nextBeat = this.ctx.currentTime + 0.2; }
    else if (prev === 'dive' || prev === 'shark') this.padOff();
  },

  update(musicOn) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    if ((this.scene === 'surface' || this.scene === 'house' || this.scene === 'title') && musicOn) {
      if (t > this.nextPluck) {
        this.nextPluck = t + pick([0.28, 0.42, 0.56, 0.56, 0.84, 1.12]);
        if (Math.random() < 0.72)
          this.tone({ f: pick(PENTA), type: 'triangle', a: 0.01, d: 0.7, v: 0.07, fx: true });
      }
      if (t > this.nextBass) {
        this.nextBass = t + 3.36;
        this.tone({ f: pick([110, 98, 82.4, 130.8]), type: 'sine', a: 0.05, d: 2.4, v: 0.06 });
      }
    } else if (this.scene === 'dive') {
      if (t > this.nextBubble) {
        this.nextBubble = t + rand(1.5, 5);
        this.bubble();
      }
    } else if (this.scene === 'shark') {
      if (t > this.nextBeat) {
        this.nextBeat = t + this.heartRate;
        this.thump(0.55);
        this.heartRate = Math.max(0.45, this.heartRate - 0.03);
      }
    }
  },
};
