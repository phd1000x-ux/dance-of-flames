import type { GameSettings } from "../save/SaveSystem";

/**
 * Layered procedural sound engine (no external assets).
 * Buses: master → { sfx, ambient, music } with ducking support.
 * Every "realistic" sound is built from multiple synchronized synthesis layers
 * (sub + formant + noise), randomized per play to avoid repetition.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambient: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private activeVoices = 0;
  private lastPlay = new Map<string, number>();

  // wind
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windWhistleGain: GainNode | null = null;

  // fire loop layers
  private fireNodes: { rumble: GainNode; body: GainNode; hiss: GainNode; any: AudioNode } | null = null;
  private fireCrackleTimer: ReturnType<typeof setInterval> | null = null;

  // ambient zone layers
  private zoneGains: Record<string, GainNode> = {};
  private zoneScheduler: ReturnType<typeof setInterval> | null = null;
  private currentZone = "field";
  private battleBed: GainNode | null = null;

  constructor(private settings: GameSettings) {}

  /** must be called from a user gesture */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.masterVolume;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = this.settings.effectsVolume;
      this.sfx.connect(this.master);
      this.ambient = this.ctx.createGain();
      this.ambient.gain.value = this.settings.effectsVolume * 0.8;
      this.ambient.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.settings.musicVolume ?? 0.7;
      this.musicBus.connect(this.master);
      this.noiseBuffer = this.makeNoise(2.5);
      this.startWindLoop();
      this.startAmbientZones();
      this.startBattleBed();
    } catch (e) {
      console.warn("[audio] init failed", e);
    }
  }

  /** MusicSystem connects its output here */
  get musicInput(): AudioNode | null {
    return this.musicBus;
  }

  applySettings(): void {
    if (this.master) this.master.gain.value = this.settings.masterVolume;
    if (this.sfx) this.sfx.gain.value = this.settings.effectsVolume;
    if (this.ambient) this.ambient.gain.value = this.settings.effectsVolume * 0.8;
    if (this.musicBus) this.musicBus.gain.value = this.settings.musicVolume ?? 0.7;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private throttled(name: string, minGapMs: number): boolean {
    const now = performance.now();
    const last = this.lastPlay.get(name) ?? -1e9;
    if (now - last < minGapMs) return true;
    this.lastPlay.set(name, now);
    return false;
  }

  // ============ primitive layers ============
  /** stereo pan of a world position relative to a listener (pure — unit-tested) */
  static panFor(pos: { x: number; z: number }, listener: { x: number; z: number; yaw: number }): number {
    const dx = pos.x - listener.x;
    const dz = pos.z - listener.z;
    const bearing = Math.atan2(dx, dz);
    let rel = bearing - listener.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    return Math.max(-1, Math.min(1, Math.sin(rel)));
  }

  /** per-voice stereo panner inserted before dest when pan is audible */
  private panDest(pan: number | undefined, dest: AudioNode): AudioNode {
    if (pan === undefined || Math.abs(pan) < 0.01 || !this.ctx) return dest;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return p;
  }

  private noise(
    dur: number,
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    gain: number,
    q = 1,
    dest?: AudioNode,
    when = 0,
    pan?: number
  ): void {
    if (!this.ctx || !this.sfx || this.activeVoices > 24) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(this.panDest(pan, dest ?? this.sfx));
    this.activeVoices++;
    src.onended = () => this.activeVoices--;
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private tone(
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    opts: { when?: number; dest?: AudioNode; attack?: number; am?: number; detune?: number; pan?: number } = {}
  ): void {
    if (!this.ctx || !this.sfx || this.activeVoices > 24) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (opts.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = g;
    if (opts.am) {
      // amplitude modulation (growl)
      const lfo = ctx.createOscillator();
      lfo.frequency.value = opts.am;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = gain * 0.55;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(gain, t + atk);
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start(t);
      lfo.stop(t + dur);
      out = g;
    }
    osc.connect(g);
    g.connect(this.panDest(opts.pan, opts.dest ?? this.sfx));
    this.activeVoices++;
    osc.onended = () => this.activeVoices--;
    osc.start(t);
    osc.stop(t + dur + 0.05);
    void out;
  }

  // ============ ducking ============
  impactDuck(scale = 0.35, seconds = 1.6): void {
    if (!this.ctx || !this.musicBus || !this.ambient) return;
    const t = this.ctx.currentTime;
    const m = this.settings.musicVolume ?? 0.7;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(m * scale, t, 0.08);
    this.musicBus.gain.setTargetAtTime(m, t + seconds, 0.5);
    const a = this.settings.effectsVolume * 0.8;
    this.ambient.gain.setTargetAtTime(a * (scale + 0.3), t, 0.1);
    this.ambient.gain.setTargetAtTime(a, t + seconds * 0.7, 0.5);
  }

  // ============ dragon ============
  /** layered roar: sub body + formant growl + noise texture */
  roar(big = false): void {
    if (this.throttled("roar", 1500)) return;
    const p = 0.9 + Math.random() * 0.2;
    const dur = big ? 1.9 : 1.2;
    // 1) sub body with growl AM
    this.tone(58 * p, 36 * p, dur, "sine", big ? 0.4 : 0.28, { am: 26, attack: 0.05 });
    this.tone(29 * p, 22 * p, dur, "sine", big ? 0.22 : 0.12, { attack: 0.06 });
    // 2) formant layer (distorted saw through moving bandpasses)
    if (this.ctx && this.sfx) {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(105 * p, t);
      osc.frequency.linearRampToValueAtTime(165 * p, t + dur * 0.3);
      osc.frequency.linearRampToValueAtTime(82 * p, t + dur);
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * 2 - 1;
        curve[i] = Math.tanh(x * 3.2);
      }
      shaper.curve = curve;
      const f1 = ctx.createBiquadFilter();
      f1.type = "bandpass";
      f1.Q.value = 2.2;
      f1.frequency.setValueAtTime(340, t);
      f1.frequency.linearRampToValueAtTime(720, t + dur * 0.4);
      const f2 = ctx.createBiquadFilter();
      f2.type = "bandpass";
      f2.Q.value = 2.8;
      f2.frequency.setValueAtTime(950, t);
      f2.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(big ? 0.2 : 0.13, t + 0.09);
      g.gain.setValueAtTime(big ? 0.2 : 0.13, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(shaper);
      shaper.connect(f1).connect(g);
      shaper.connect(f2).connect(g);
      g.connect(this.sfx);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    // 3) high growl texture
    this.noise(dur * 0.8, "bandpass", 1700 * p, 900, 0.09, 1.6);
    this.impactDuck(0.5, 1.2);
  }

  /** war-dragon roar: pitched-down, slower, heavier than the player roar */
  deepRoar(pan = 0): void {
    if (this.throttled("deepRoar", 2500)) return;
    const dur = 2.6;
    this.tone(34, 20, dur, "sine", 0.5, { am: 14, attack: 0.15, pan });
    this.tone(17, 12, dur, "sine", 0.3, { attack: 0.2, pan });
    this.noise(dur, "bandpass", 240, 120, 0.16, 1.2, undefined, 0, pan);
    this.impactDuck(0.7, 2);
  }

  // ============ war horn ============
  /** brass horn voice: detuned root+fifth saws, lowpass body, slow brass vibrato */
  private hornBlast(dur: number, gain: number, pan = 0): void {
    if (!this.ctx || !this.sfx || this.activeVoices > 24) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const attack = Math.min(0.35, dur * 0.35);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 2.2; // pitch vibrato depth (Hz)
    lfo.connect(lfoGain);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(480, t);
    lp.frequency.linearRampToValueAtTime(900, t + Math.max(0.1, attack));
    lp.Q.value = 1.0;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.setValueAtTime(gain, Math.max(t + attack, t + dur - 0.22));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const oscs: OscillatorNode[] = [];
    for (const [f, det] of [
      [110, -7],
      [165, 6],
    ] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      lfoGain.connect(o.frequency);
      o.connect(lp);
      oscs.push(o);
    }
    lp.connect(env).connect(this.panDest(pan, this.sfx));
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    for (const o of oscs) {
      this.activeVoices++;
      o.onended = () => this.activeVoices--;
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** long war horn — assault begins */
  warHorn(pan = 0): void {
    if (this.throttled("warHorn", 10000)) return;
    this.hornBlast(2.4, 0.16, pan); // 0.35 attack + 1.8 sustain + release
    this.impactDuck(0.55, 1.4);
  }

  /** short war horn stab — escalation band change */
  warHornShort(pan = 0): void {
    if (this.throttled("warHornShort", 2000)) return;
    this.hornBlast(0.5, 0.13, pan);
  }

  /** flame-sweep telegraph inhale */
  inhale(pan = 0): void {
    this.noise(1.0, "bandpass", 400, 1600, 0.14, 2, undefined, 0, pan);
    this.tone(140, 320, 1.0, "sine", 0.06, { pan });
  }

  /** near-miss / wing buffet whoosh */
  wingBuffet(intensity = 1): void {
    if (this.throttled("buffet", 300)) return;
    this.noise(0.5, "lowpass", 300 + 200 * intensity, 150, 0.2, 1.5);
  }

  /** hit on war-dragon scales */
  bossHit(): void {
    if (this.throttled("bossHit", 120)) return;
    this.tone(220, 90, 0.12, "square", 0.1);
    this.noise(0.1, "highpass", 3000, 1500, 0.12, 1);
  }

  /** wingbeat — size-appropriate thump + leather snap, varies every beat */
  flapBeat(intensity = 1): void {
    if (this.throttled("flap", 170)) return;
    const p = 0.85 + Math.random() * 0.3;
    const g = 0.1 + 0.12 * Math.min(1, intensity);
    this.tone(64 * p, 34 * p, 0.22, "sine", g, { attack: 0.012 });
    this.noise(0.16, "lowpass", 480 * p, 140, g * 0.7, 0.7);
    if (Math.random() < 0.8) this.noise(0.045, "bandpass", 700 + Math.random() * 300, 500, g * 0.35, 2.5);
  }

  fireStart(): void {
    this.noise(0.4, "lowpass", 2600, 500, 0.22);
    this.tone(90, 45, 0.35, "sine", 0.18);
  }

  /** continuous fire: rumble + roar body + hiss + scheduled crackle */
  setFireLoop(active: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (active && !this.fireNodes) {
      const rumbleSrc = ctx.createBufferSource();
      rumbleSrc.buffer = this.noiseBuffer;
      rumbleSrc.loop = true;
      rumbleSrc.playbackRate.value = 0.4;
      const rumbleF = ctx.createBiquadFilter();
      rumbleF.type = "lowpass";
      rumbleF.frequency.value = 160;
      const rumbleG = ctx.createGain();
      rumbleG.gain.value = 0;
      rumbleG.gain.setTargetAtTime(0.3, ctx.currentTime, 0.12);
      rumbleSrc.connect(rumbleF).connect(rumbleG).connect(this.sfx!);

      const bodySrc = ctx.createBufferSource();
      bodySrc.buffer = this.noiseBuffer;
      bodySrc.loop = true;
      bodySrc.playbackRate.value = 0.75;
      const bodyF = ctx.createBiquadFilter();
      bodyF.type = "bandpass";
      bodyF.frequency.value = 640;
      bodyF.Q.value = 0.7;
      const bodyG = ctx.createGain();
      bodyG.gain.value = 0;
      bodyG.gain.setTargetAtTime(0.22, ctx.currentTime, 0.15);
      bodySrc.connect(bodyF).connect(bodyG).connect(this.sfx!);

      const hissSrc = ctx.createBufferSource();
      hissSrc.buffer = this.noiseBuffer;
      hissSrc.loop = true;
      hissSrc.playbackRate.value = 1.3;
      const hissF = ctx.createBiquadFilter();
      hissF.type = "bandpass";
      hissF.frequency.value = 2400;
      hissF.Q.value = 1.8;
      const hissG = ctx.createGain();
      hissG.gain.value = 0;
      hissG.gain.setTargetAtTime(0.05, ctx.currentTime, 0.2);
      hissSrc.connect(hissF).connect(hissG).connect(this.sfx!);

      rumbleSrc.start();
      bodySrc.start();
      hissSrc.start();
      this.fireNodes = { rumble: rumbleG, body: bodyG, hiss: hissG, any: rumbleSrc };

      // ember crackle scheduler
      this.fireCrackleTimer = setInterval(() => {
        if (!this.fireNodes) return;
        if (Math.random() < 0.65) {
          this.noise(0.03 + Math.random() * 0.03, "highpass", 1800, 2600, 0.05 + Math.random() * 0.05, 1);
        }
      }, 110);
    } else if (!active && this.fireNodes) {
      const t = ctx.currentTime;
      const nodes = this.fireNodes;
      this.fireNodes = null;
      if (this.fireCrackleTimer) {
        clearInterval(this.fireCrackleTimer);
        this.fireCrackleTimer = null;
      }
      nodes.rumble.gain.setTargetAtTime(0, t, 0.09);
      nodes.body.gain.setTargetAtTime(0, t, 0.09);
      nodes.hiss.gain.setTargetAtTime(0, t, 0.09);
      setTimeout(() => {
        try {
          (nodes.any as AudioBufferSourceNode).stop();
        } catch {
          /* already stopped */
        }
      }, 500);
    }
  }

  /** parameterized wind: volume + filter follow flight speed */
  setWind(intensity: number): void {
    if (!this.windGain || !this.windFilter || !this.windWhistleGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    const i = Math.max(0, Math.min(1.2, intensity));
    this.windGain.gain.setTargetAtTime(0.018 + i * 0.15, t, 0.25);
    this.windFilter.frequency.setTargetAtTime(260 + i * 740, t, 0.25);
    this.windWhistleGain.gain.setTargetAtTime(Math.max(0, i - 0.62) * 0.16, t, 0.3);
  }

  private startWindLoop(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.55;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.03;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master!);

    const wSrc = ctx.createBufferSource();
    wSrc.buffer = this.noiseBuffer;
    wSrc.loop = true;
    wSrc.playbackRate.value = 1.1;
    const wf = ctx.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = 2300;
    wf.Q.value = 3.5;
    this.windWhistleGain = ctx.createGain();
    this.windWhistleGain.gain.value = 0;
    wSrc.connect(wf).connect(this.windWhistleGain).connect(this.master!);
    src.start();
    wSrc.start();
  }

  // ============ ambient zones ============
  private startAmbientZones(): void {
    const ctx = this.ctx!;
    const mkZone = (type: BiquadFilterType, freq: number, q: number, rate: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer!;
      s.loop = true;
      s.playbackRate.value = rate;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.ambient!);
      s.start();
      return g;
    };
    this.zoneGains.field = mkZone("lowpass", 520, 0.4, 0.55); // open air
    this.zoneGains.village = mkZone("lowpass", 300, 0.6, 0.4); // warm rumble
    this.zoneGains.castle = mkZone("bandpass", 760, 0.8, 0.7); // stone wind
    this.setAmbientZone("field");

    // zone-flavored one-shot scheduler
    this.zoneScheduler = setInterval(() => {
      if (!this.fireNodes) return; // don't stack during dragon fire
      const z = this.currentZone;
      const r = Math.random();
      if (z === "castle") {
        if (r < 0.28) this.flagFlap();
        else if (r < 0.5) this.brazierCrackle();
        else if (r < 0.62) this.distantVoices();
      } else if (z === "village") {
        if (r < 0.25) this.brazierCrackle();
        else if (r < 0.38) this.distantVoices();
      }
    }, 1600);
  }

  setAmbientZone(zone: "field" | "village" | "castle"): void {
    if (!this.ctx || this.currentZone === zone) return;
    this.currentZone = zone;
    const t = this.ctx.currentTime;
    for (const [name, g] of Object.entries(this.zoneGains)) {
      g.gain.setTargetAtTime(name === zone ? (name === "field" ? 0.05 : 0.075) : 0, t, 0.9);
    }
  }

  /** faint battle crowd bed, 0..1 */
  setBattleIntensity(v: number): void {
    if (!this.battleBed || !this.ctx) return;
    this.battleBed.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.045, this.ctx.currentTime, 1.2);
  }

  private startBattleBed(): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuffer!;
    s.loop = true;
    s.playbackRate.value = 0.3;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 460;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.012;
    this.battleBed = ctx.createGain();
    this.battleBed.gain.value = 0;
    lfo.connect(lfoG).connect(this.battleBed.gain);
    s.connect(f).connect(this.battleBed).connect(this.ambient!);
    s.start();
    lfo.start();
  }

  private flagFlap(): void {
    this.noise(0.16, "bandpass", 900 + Math.random() * 400, 300, 0.035, 1.4, this.ambient!);
    this.noise(0.1, "bandpass", 1500, 700, 0.02, 2, this.ambient!);
  }
  private brazierCrackle(): void {
    for (let i = 0; i < 3; i++) {
      this.noise(0.025, "highpass", 1600, 2400, 0.02 + Math.random() * 0.02, 1, this.ambient!, i * 0.05);
    }
  }
  private distantVoices(): void {
    this.noise(0.7, "bandpass", 300 + Math.random() * 200, 220, 0.02, 3, this.ambient!);
  }

  // ============ combat ============
  arrowWhistle(): void {
    if (this.throttled("whistle", 120)) return;
    this.tone(2100, 900, 0.4, "sine", 0.05);
    this.noise(0.3, "bandpass", 1800, 900, 0.02, 4);
  }
  arrowHit(): void {
    this.noise(0.1, "highpass", 2200, 3800, 0.1);
    this.tone(300, 120, 0.08, "triangle", 0.07);
  }
  ballistaFire(pan = 0): void {
    // mechanical: click + spring + heavy launch
    this.tone(1300, 900, 0.03, "square", 0.06, { pan });
    this.tone(420, 90, 0.11, "sawtooth", 0.08, { pan });
    this.tone(140, 55, 0.3, "sine", 0.22, { pan });
    this.noise(0.28, "lowpass", 900, 160, 0.22, 1, undefined, 0, pan);
  }
  ballistaTelegraph(pan = 0): void {
    if (this.throttled("bt", 800)) return;
    this.tone(300, 430, 0.5, "sawtooth", 0.035, { pan });
  }
  explosion(pan = 0): void {
    if (this.throttled("explosion", 100)) return;
    this.noise(0.9, "lowpass", 3200, 90, 0.34, 1, undefined, 0, pan);
    this.tone(110, 28, 0.85, "sine", 0.3, { pan });
    this.noise(0.25, "highpass", 2500, 3500, 0.08, 1, undefined, 0, pan);
    this.impactDuck(0.45, 1.0);
  }
  buildingCollapse(pan = 0): void {
    if (this.throttled("collapse", 150)) return;
    // crack → rumble → debris patter
    this.noise(0.22, "highpass", 900, 1400, 0.16, 1, undefined, 0, pan);
    this.tone(65, 26, 1.5, "sine", 0.28, { attack: 0.02, pan });
    this.noise(1.4, "lowpass", 620, 70, 0.3, 1, undefined, 0, pan);
    for (let i = 0; i < 7; i++) {
      this.noise(0.03, "bandpass", 1300 + Math.random() * 1800, 900, 0.045, 3, undefined, 0.25 + Math.random() * 0.85, pan);
    }
    this.impactDuck(0.5, 1.4);
  }
  coin(): void {
    if (this.throttled("coin", 70)) return;
    this.tone(1450, 1450, 0.06, "sine", 0.08);
    this.tone(2150, 2150, 0.09, "sine", 0.06, { when: 0.055 });
  }
  heal(): void {
    this.tone(520, 780, 0.22, "sine", 0.1);
    this.tone(780, 1170, 0.28, "sine", 0.08, { when: 0.11 });
  }
  relic(): void {
    this.tone(392, 392, 0.3, "triangle", 0.12);
    this.tone(587, 587, 0.3, "triangle", 0.1, { when: 0.14 });
    this.tone(784, 784, 0.5, "triangle", 0.1, { when: 0.28 });
  }
  swordSwing(): void {
    if (this.throttled("swing", 80)) return;
    this.noise(0.15, "bandpass", 1400, 260, 0.13, 1.6);
    this.tone(620, 240, 0.13, "sine", 0.02); // doppler body
  }
  /** blade into armor/ flesh: metallic partials + crunch */
  swordHitArmor(): void {
    if (this.throttled("shit", 70)) return;
    this.tone(1950, 1700, 0.13, "sine", 0.06);
    this.tone(2740, 2500, 0.09, "sine", 0.045);
    this.tone(3900, 3600, 0.06, "sine", 0.03);
    this.noise(0.05, "highpass", 3000, 4000, 0.09);
    this.tone(210, 130, 0.07, "triangle", 0.09);
  }
  /** blade into shield: wooden knock + rattle */
  swordHitShield(): void {
    if (this.throttled("shsh", 70)) return;
    this.tone(640, 560, 0.1, "triangle", 0.12);
    this.tone(185, 150, 0.09, "sine", 0.1);
    for (let i = 0; i < 3; i++) {
      this.noise(0.04, "bandpass", 900 + Math.random() * 500, 700, 0.05, 2.5, undefined, 0.05 + i * 0.055);
    }
  }
  /** successful parry: bright ring */
  parry(): void {
    this.tone(1560, 1520, 0.4, "sine", 0.07);
    this.tone(2320, 2280, 0.32, "sine", 0.05);
    this.noise(0.04, "highpass", 3500, 4500, 0.08);
  }
  playerHurt(): void {
    this.tone(150, 90, 0.16, "sine", 0.16);
    this.noise(0.14, "lowpass", 700, 250, 0.12);
    this.noise(0.2, "bandpass", 500, 350, 0.04, 2); // breath
  }
  dodge(): void {
    this.noise(0.18, "bandpass", 650, 1900, 0.09, 1.4);
  }
  superCharge(): void {
    this.tone(150, 1200, 0.8, "sawtooth", 0.1);
    this.noise(0.8, "bandpass", 400, 2400, 0.05, 2);
  }
  superBlast(): void {
    this.noise(1.1, "lowpass", 5000, 160, 0.36);
    this.tone(380, 38, 1.0, "sawtooth", 0.18);
    this.tone(95, 30, 1.1, "sine", 0.28);
    this.impactDuck(0.4, 1.2);
  }
  uiClick(): void {
    this.tone(760, 620, 0.06, "sine", 0.06);
    this.tone(1520, 1240, 0.05, "sine", 0.025, { when: 0.01 });
  }
  uiMove(): void {
    if (this.throttled("uimove", 40)) return;
    this.tone(520, 500, 0.035, "sine", 0.035);
  }
  objective(): void {
    this.tone(523, 523, 0.16, "triangle", 0.09);
    this.tone(784, 784, 0.3, "triangle", 0.09, { when: 0.13 });
  }
  victory(): void {
    this.tone(523, 523, 0.35, "triangle", 0.1);
    this.tone(659, 659, 0.35, "triangle", 0.1, { when: 0.28 });
    this.tone(784, 784, 0.6, "triangle", 0.12, { when: 0.56 });
  }
  defeat(): void {
    this.tone(392, 392, 0.5, "triangle", 0.1);
    this.tone(311, 311, 0.5, "triangle", 0.1, { when: 0.42 });
    this.tone(233, 233, 1.0, "triangle", 0.11, { when: 0.84 });
  }

  dispose(): void {
    try {
      if (this.fireCrackleTimer) clearInterval(this.fireCrackleTimer);
      if (this.zoneScheduler) clearInterval(this.zoneScheduler);
      this.ctx?.close();
    } catch {
      /* noop */
    }
    this.ctx = null;
  }
}
