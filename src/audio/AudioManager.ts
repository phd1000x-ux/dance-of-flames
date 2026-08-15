import type { GameSettings } from "../save/SaveSystem";

/**
 * Fully procedural WebAudio sound engine — no external audio assets.
 * All sounds are synthesized (noise bursts, filtered noise, FM pings, sub sines).
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private fireGain: GainNode | null = null;
  private fireSource: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private activeVoices = 0;
  private lastPlay = new Map<string, number>();

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
      this.noiseBuffer = this.makeNoise(2);
      this.startWindLoop();
    } catch (e) {
      console.warn("[audio] init failed", e);
    }
  }

  applySettings(): void {
    if (this.master) this.master.gain.value = this.settings.masterVolume;
    if (this.sfx) this.sfx.gain.value = this.settings.effectsVolume;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
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

  private noiseBurst(
    dur: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    gain: number,
    q = 1
  ): void {
    if (!this.ctx || !this.sfx || this.activeVoices > 14) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freqStart, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(this.sfx);
    this.activeVoices++;
    src.onended = () => this.activeVoices--;
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0
  ): void {
    if (!this.ctx || !this.sfx || this.activeVoices > 14) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfx);
    this.activeVoices++;
    osc.onended = () => this.activeVoices--;
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ---- ambient loops ----
  private startWindLoop(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 400;
    filter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.03;
    src.connect(filter).connect(this.windGain).connect(this.master!);
    src.start();
    this.windSource = src;
  }

  /** wind intensity by flight speed 0..1 */
  setWind(intensity: number): void {
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(0.02 + intensity * 0.14, this.ctx!.currentTime, 0.3);
    }
  }

  setFireLoop(active: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (active && !this.fireSource) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.playbackRate.value = 0.5;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      g.gain.setTargetAtTime(0.22, ctx.currentTime, 0.08);
      src.connect(filter).connect(g).connect(this.sfx!);
      src.start();
      this.fireSource = src;
      this.fireGain = g;
    } else if (!active && this.fireSource) {
      const src = this.fireSource;
      this.fireGain!.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => src.stop(), 400);
      this.fireSource = null;
      this.fireGain = null;
    }
  }

  // ---- one-shots ----
  roar(big = false): void {
    if (this.throttled("roar", 1500)) return;
    const base = big ? 70 : 110;
    this.tone(base, base * 2.6, big ? 1.6 : 1.0, "sawtooth", 0.25);
    this.tone(base * 1.5, base * 0.7, big ? 1.4 : 0.9, "square", 0.06);
    this.noiseBurst(big ? 1.6 : 1.0, "lowpass", 1400, 200, 0.18);
  }
  flap(): void {
    if (this.throttled("flap", 260)) return;
    this.noiseBurst(0.22, "lowpass", 500, 120, 0.16);
  }
  fireStart(): void {
    this.noiseBurst(0.5, "lowpass", 2400, 700, 0.2);
  }
  arrowWhistle(): void {
    if (this.throttled("whistle", 120)) return;
    this.tone(2100, 900, 0.4, "sine", 0.05);
  }
  arrowHit(): void {
    this.noiseBurst(0.12, "highpass", 2000, 4000, 0.12);
  }
  ballistaFire(): void {
    this.noiseBurst(0.3, "lowpass", 900, 150, 0.3);
    this.tone(160, 60, 0.3, "square", 0.12);
  }
  ballistaTelegraph(): void {
    if (this.throttled("bt", 800)) return;
    this.tone(300, 420, 0.5, "sawtooth", 0.04);
  }
  explosion(): void {
    if (this.throttled("explosion", 100)) return;
    this.noiseBurst(0.9, "lowpass", 3000, 100, 0.4);
    this.tone(120, 30, 0.8, "sine", 0.3);
  }
  buildingCollapse(): void {
    this.noiseBurst(1.6, "lowpass", 700, 60, 0.35);
    this.tone(70, 25, 1.4, "sine", 0.22);
  }
  coin(): void {
    if (this.throttled("coin", 70)) return;
    this.tone(1400, 1400, 0.07, "sine", 0.1);
    this.tone(2100, 2100, 0.1, "sine", 0.08, 0.06);
  }
  heal(): void {
    this.tone(520, 780, 0.25, "sine", 0.12);
    this.tone(780, 1170, 0.3, "sine", 0.1, 0.12);
  }
  relic(): void {
    this.tone(392, 392, 0.3, "triangle", 0.14);
    this.tone(587, 587, 0.3, "triangle", 0.12, 0.15);
    this.tone(784, 784, 0.5, "triangle", 0.12, 0.3);
  }
  swordSwing(): void {
    if (this.throttled("swing", 90)) return;
    this.noiseBurst(0.16, "bandpass", 900, 3000, 0.14, 2);
  }
  swordHit(): void {
    if (this.throttled("shit", 80)) return;
    this.tone(2400, 1600, 0.09, "square", 0.05);
    this.noiseBurst(0.1, "bandpass", 2500, 1200, 0.16, 3);
  }
  playerHurt(): void {
    this.noiseBurst(0.18, "lowpass", 800, 200, 0.2);
  }
  dodge(): void {
    this.noiseBurst(0.2, "bandpass", 600, 1800, 0.1, 1.5);
  }
  superCharge(): void {
    this.tone(150, 1200, 0.8, "sawtooth", 0.12);
  }
  superBlast(): void {
    this.noiseBurst(1.2, "lowpass", 5000, 150, 0.4);
    this.tone(400, 40, 1.0, "sawtooth", 0.2);
  }
  uiClick(): void {
    this.tone(800, 640, 0.06, "sine", 0.06);
  }
  objective(): void {
    this.tone(523, 523, 0.16, "triangle", 0.1);
    this.tone(784, 784, 0.3, "triangle", 0.1, 0.14);
  }
  victory(): void {
    this.tone(523, 523, 0.35, "triangle", 0.12);
    this.tone(659, 659, 0.35, "triangle", 0.12, 0.3);
    this.tone(784, 784, 0.6, "triangle", 0.14, 0.6);
  }
  defeat(): void {
    this.tone(392, 392, 0.5, "triangle", 0.12);
    this.tone(311, 311, 0.5, "triangle", 0.12, 0.45);
    this.tone(233, 233, 1.0, "triangle", 0.13, 0.9);
  }

  dispose(): void {
    try {
      this.windSource?.stop();
      this.fireSource?.stop();
      this.ctx?.close();
    } catch {
      /* noop */
    }
    this.ctx = null;
  }
}
