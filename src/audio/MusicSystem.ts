import { composeBar, stateConfig, type MusicStateId, type NoteEvent, type BarPlan } from "./MusicComposer";
import { SeededRng } from "../core/SeededRng";

/** Original adaptive score. All instruments and the stereo room are synthesized. */
export class MusicSystem {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private mix: GainNode | null = null;
  private room: ConvolverNode | null = null;
  private impulse: AudioBuffer | null = null;
  private graph: AudioNode[] = [];
  private sources = new Set<AudioScheduledSourceNode>();
  private envelopes = new Set<GainNode>();
  private state: MusicStateId = "menu";
  private renderedState: MusicStateId = "menu";
  private pendingState: MusicStateId | null = null;
  private barIndex = 0;
  private nextBarTime = 0;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private enabled = true;
  private oneShotPlayed = false;
  private rng: SeededRng;

  constructor(seed = 20260815) { this.rng = new SeededRng(seed); }

  start(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.mix = ctx.createGain();
    this.mix.gain.value = 1.4;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 35;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;
    this.out = ctx.createGain();
    this.out.gain.value = this.enabled ? 0.85 : 0;
    this.mix.connect(highpass).connect(compressor).connect(this.out).connect(destination);
    this.room = ctx.createConvolver();
    this.impulse = this.makeRoom(ctx);
    this.room.buffer = this.impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.2;
    this.mix.connect(this.room).connect(wet).connect(compressor);
    this.graph = [this.mix, highpass, compressor, this.out, this.room, wet];
    this.renderedState = this.state;
    this.nextBarTime = ctx.currentTime + 0.08;
    this.schedulerTimer = setInterval(() => this.tick(), 80);
    this.tick();
  }

  setState(state: MusicStateId): void {
    if (state === this.state) return;
    this.state = state;
    this.oneShotPlayed = false;
    if (!stateConfig(state).loop) {
      this.pendingState = null;
      this.renderedState = state;
      this.barIndex = 0;
      // Retire the previous phrase, including future scheduled notes.
      this.stopVoices();
      if (this.ctx) this.nextBarTime = this.ctx.currentTime + 0.04;
      this.tick();
    } else {
      this.pendingState = state;
      if (this.ctx && !stateConfig(this.renderedState).loop) {
        this.nextBarTime = Math.max(this.ctx.currentTime + 0.04, this.nextBarTime);
      }
    }
  }

  get currentState(): MusicStateId { return this.state; }

  /** Mutes the entire dry/wet output and retires scheduled voices; SFX are independent. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!this.ctx || !this.out) return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(enabled ? 0.85 : 0, now + 0.035);
    if (!enabled) {
      this.stopVoices();
      if (this.room) this.room.buffer = null;
    } else {
      if (this.room) this.room.buffer = this.impulse;
      this.renderedState = this.state;
      this.pendingState = null;
      this.barIndex = 0;
      this.nextBarTime = now + 0.08;
      // Terminal cues already heard should not replay when toggling music.
      this.tick();
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.mix || !this.enabled || ctx.state !== "running") return;
    const now = ctx.currentTime;
    // A background tab can delay the JS timer for minutes. Never render its backlog.
    if (this.nextBarTime < now - 0.2) this.nextBarTime = now + 0.04;
    if (this.nextBarTime >= now + 0.3) return;
    if (this.pendingState) {
      this.renderedState = this.pendingState;
      this.pendingState = null;
      this.barIndex = 0;
      this.oneShotPlayed = false;
    }
    const loop = stateConfig(this.renderedState).loop;
    if (!loop && this.oneShotPlayed) return;
    const bar = composeBar(this.renderedState, this.barIndex++, Math.floor(this.rng.next() * 10000));
    this.renderBar(bar, this.nextBarTime);
    this.nextBarTime += bar.beats * 60 / bar.bpm;
    if (!loop) this.oneShotPlayed = true;
  }

  private renderBar(bar: BarPlan, start: number): void {
    const beat = 60 / bar.bpm;
    for (const note of bar.notes) this.playNote(note, start + note.start * beat, note.dur * beat);
  }

  private playNote(note: NoteEvent, t: number, dur: number): void {
    const ctx = this.ctx!;
    const nodes: AudioNode[] = [];
    const sources: OscillatorNode[] = [];
    const gain = ctx.createGain();
    this.envelopes.add(gain);
    const pan = ctx.createStereoPanner();
    pan.pan.value = { cello: -0.24, violin: 0.28, pad: 0, harp: -0.42, drum: 0.04 }[note.voice];
    gain.connect(pan).connect(this.mix!);
    nodes.push(gain, pan);
    const drum = note.voice === "drum";
    const harp = note.voice === "harp";
    const pad = note.voice === "pad";
    const cello = note.voice === "cello";
    const attack = drum ? 0.006 : harp ? 0.008 : Math.min(dur * 0.22, pad ? 0.7 : cello ? 0.16 : 0.1);
    const release = drum ? 0.24 : harp ? 0.65 : pad ? 0.8 : 0.24;
    const end = t + dur + release;
    const peak = note.vel * (drum ? 0.28 : harp ? 0.16 : pad ? 0.12 : cello ? 0.28 : 0.2);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    if (drum || harp) {
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
    } else {
      gain.gain.linearRampToValueAtTime(peak * 0.78, t + Math.max(attack, dur * 0.72));
      gain.gain.linearRampToValueAtTime(0, end);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.55;
    const brightness = pad ? 1100 : cello ? 1600 : harp ? 3800 : 3100;
    filter.frequency.setValueAtTime(drum ? 240 : brightness * 0.65, t);
    filter.frequency.linearRampToValueAtTime(drum ? 130 : brightness, t + attack);
    filter.connect(gain);
    nodes.push(filter);
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    const oscillator = (freq: number, detune: number, type: OscillatorType, level: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.value = detune;
      const balance = ctx.createGain();
      balance.gain.value = level;
      osc.connect(balance).connect(filter);
      sources.push(osc);
      nodes.push(osc, balance);
      return osc;
    };
    if (drum) {
      const fundamental = oscillator(100, 0, "sine", 0.85);
      fundamental.frequency.exponentialRampToValueAtTime(43, t + 0.18);
      oscillator(147, 0, "sine", 0.15).frequency.exponentialRampToValueAtTime(76, t + 0.1);
    } else if (harp) {
      oscillator(frequency, 0, "triangle", 0.78);
      oscillator(frequency * 2, 0, "sine", 0.16);
      oscillator(frequency * 3, 0, "sine", 0.06);
    } else {
      // Limited harmonic spectrum avoids the abrasive, full-band sawtooth pair.
      const harmonics = new Float32Array(pad ? [0, 1, 0.25, 0.1, 0.04] : [0, 1, 0.5, 0.28, 0.16, 0.09, 0.05, 0.025]);
      const wave = ctx.createPeriodicWave(new Float32Array(harmonics.length), harmonics);
      const a = oscillator(frequency, -3.5, "sine", 0.5);
      const b = oscillator(frequency, 3.5, "sine", 0.5);
      a.setPeriodicWave(wave);
      b.setPeriodicWave(wave);
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = cello ? 4.9 : 5.5;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(pad ? 2 : 7, t + Math.min(dur * 0.65, 0.5));
      vibrato.connect(depth);
      depth.connect(a.detune);
      depth.connect(b.detune);
      sources.push(vibrato);
      nodes.push(vibrato, depth);
    }
    let remaining = sources.length;
    for (const source of sources) {
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        if (--remaining === 0) {
          this.envelopes.delete(gain);
          for (const node of nodes) node.disconnect();
        }
      };
      source.start(t);
      source.stop(end + 0.01);
    }
  }

  private makeRoom(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 1.8);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    const rng = new SeededRng(72819);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        // A short predelay preserves attacks; damped tail stays behind the melody.
        smooth = smooth * 0.65 + (rng.next() * 2 - 1) * 0.35;
        data[i] = i < ctx.sampleRate * 0.025 ? 0 : smooth * Math.exp(-i / (ctx.sampleRate * 0.38));
      }
    }
    return impulse;
  }

  private stopVoices(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const envelope of this.envelopes) {
      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setValueAtTime(envelope.gain.value, now);
      envelope.gain.linearRampToValueAtTime(0, now + 0.03);
    }
    for (const source of this.sources) {
      try { source.stop(now + 0.035); } catch { /* already ended */ }
    }
  }

  dispose(): void {
    if (this.schedulerTimer !== null) clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    this.stopVoices();
    for (const node of this.graph) node.disconnect();
    this.graph = [];
    this.sources.clear();
    this.envelopes.clear();
    this.ctx = null;
    this.out = this.mix = null;
    this.room = null;
    this.impulse = null;
    this.oneShotPlayed = false;
  }
}
