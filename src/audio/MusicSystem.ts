import { composeBar, stateConfig, type MusicStateId, type NoteEvent } from "./MusicComposer";
import { SeededRng } from "../core/SeededRng";

/**
 * WebAudio renderer for the original cello/violin score.
 * String voices = detuned saw pairs + lowpass + delayed vibrato (bow-like).
 * Adaptive states switch at bar boundaries; stingers suspend the pattern.
 */
export class MusicSystem {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private state: MusicStateId = "menu";
  private pendingState: MusicStateId | null = null;
  private barIndex = 0;
  private seedRng: SeededRng;
  private seed: number;
  private nextBarTime = 0;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private stingerUntil = 0;
  private enabled = true;

  constructor(seed = 20260815) {
    this.seed = seed;
    this.seedRng = new SeededRng(seed);
  }

  start(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(destination);
    this.nextBarTime = ctx.currentTime + 0.15;
    this.schedulerTimer = setInterval(() => this.tick(), 120);
  }

  setState(state: MusicStateId): void {
    if (state === this.state && !this.pendingState) return;
    // state tracking updates immediately (queries/tests read it); audio rendering
    // transitions at bar boundaries for musical continuity
    this.state = state;
    if (stateConfig(state).loop === false) {
      // stingers play immediately over/instead of the current cue
      this.playStinger(state);
      return;
    }
    if (!this.ctx || this.ctx.state !== "running") {
      this.pendingState = null;
      return;
    }
    this.pendingState = state; // applied to the RENDERER at the next bar boundary
  }

  get currentState(): MusicStateId {
    return this.state;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (this.out && this.ctx) {
      this.out.gain.setTargetAtTime(v ? 0.9 : 0, this.ctx.currentTime, 0.4);
    }
  }

  private playStinger(state: MusicStateId): void {
    this.state = state;
    if (!this.ctx || this.ctx.state !== "running") return;
    const bar = composeBar(state, 0, this.seedRng.next() * 1000);
    const t0 = this.ctx.currentTime + 0.05;
    this.stingerUntil = t0 + (bar.beats * 60) / bar.bpm + 1.2;
    this.renderBar(bar, t0);
  }

  private tick(): void {
    if (!this.ctx || !this.out) return;
    const now = this.ctx.currentTime;
    if (now < this.stingerUntil) {
      this.nextBarTime = Math.max(this.nextBarTime, this.stingerUntil);
      return;
    }
    const lookahead = 0.35;
    while (this.nextBarTime < now + lookahead) {
      if (this.pendingState) {
        this.state = this.pendingState;
        this.pendingState = null;
        this.barIndex = 0;
      }
      const bar = composeBar(this.state, this.barIndex, Math.floor(this.seedRng.next() * 10000));
      this.renderBar(bar, this.nextBarTime);
      this.nextBarTime += (bar.beats * 60) / bar.bpm;
      this.barIndex++;
    }
  }

  private renderBar(bar: { bpm: number; beats: number; notes: NoteEvent[] }, t0: number): void {
    const spb = 60 / bar.bpm;
    for (const n of bar.notes) {
      const t = t0 + n.start * spb;
      const dur = n.dur * spb;
      switch (n.voice) {
        case "cello":
          this.playString("cello", n.midi, t, dur, n.vel);
          break;
        case "violin":
          this.playString("violin", n.midi, t, dur, n.vel);
          break;
        case "drum":
          this.playDrum(t, n.vel);
          break;
        case "pad":
          this.playPad(n.midi, t, dur, n.vel);
          break;
      }
    }
  }

  private midiToFreq(m: number): number {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  /** bowed-string approximation */
  private playString(kind: "cello" | "violin", note: number, t: number, dur: number, vel: number): void {
    const ctx = this.ctx!;
    const f = this.midiToFreq(note);
    const isCello = kind === "cello";
    const gain = ctx.createGain();
    const peak = (isCello ? 0.34 : 0.22) * vel * 2.2;
    const atk = Math.min(isCello ? 0.22 : 0.12, dur * 0.35);
    const rel = Math.min(0.3, dur * 0.4);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + atk);
    gain.gain.setValueAtTime(Math.max(0.001, peak), t + Math.max(atk, dur - rel));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(isCello ? 620 : 1500, t);
    filter.frequency.linearRampToValueAtTime(isCello ? 1150 : 2600, t + atk);
    filter.Q.value = 0.8;
    // body resonance
    const body = ctx.createBiquadFilter();
    body.type = "peaking";
    body.frequency.value = isCello ? 180 : 650;
    body.gain.value = 4;
    body.Q.value = 1.2;

    const oscA = ctx.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.value = f;
    oscA.detune.value = (Math.random() - 0.5) * 7;
    const oscB = ctx.createOscillator();
    oscB.type = "sawtooth";
    oscB.frequency.value = f;
    oscB.detune.value = (Math.random() - 0.5) * 7 + (isCello ? -6 : 5);
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(body).connect(gain).connect(this.out!);
    if (isCello) {
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = f;
      const subG = ctx.createGain();
      subG.gain.value = 0.35;
      sub.connect(subG).connect(gain);
      sub.start(t);
      sub.stop(t + dur + rel + 0.1);
    }
    // delayed vibrato (bow settles)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = isCello ? 5.1 : 6.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(f * (isCello ? 0.006 : 0.009), t + Math.min(0.4, dur * 0.5));
    lfo.connect(lfoGain);
    lfoGain.connect(oscA.frequency);
    lfoGain.connect(oscB.frequency);
    lfo.start(t);
    lfo.stop(t + dur + rel + 0.1);
    oscA.start(t);
    oscB.start(t);
    oscA.stop(t + dur + rel + 0.1);
    oscB.stop(t + dur + rel + 0.1);
  }

  private playDrum(t: number, vel: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(88, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private playPad(note: number, t: number, dur: number, vel: number): void {
    const ctx = this.ctx!;
    const f = this.midiToFreq(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1 * vel * 6, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 680;
    for (const det of [-8, 0, 9]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    lp.connect(g).connect(this.out!);
  }

  dispose(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    this.out?.disconnect();
    this.ctx = null;
  }
}
