import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicSystem } from "../src/audio/MusicSystem";

// Recording WebAudio graph: asserts real scheduling/control contracts, not timbre.
function audioContext() {
  const sources: any[] = [];
  const params = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = () => {
    const n: any = { gain: params(), frequency: params(), detune: params(), Q: params(), pan: params(),
      threshold: params(), knee: params(), ratio: params(), attack: params(), release: params(),
      connect: vi.fn((next) => next), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), setPeriodicWave: vi.fn() };
    return n;
  };
  const room = node();
  const ctx = { currentTime: 0, state: "running", sampleRate: 100,
    createGain: node, createBiquadFilter: node, createDynamicsCompressor: node, createStereoPanner: node,
    createConvolver: () => room, createPeriodicWave: vi.fn(),
    createOscillator: () => { const n = node(); sources.push(n); return n; },
    createBuffer: (channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
  };
  return { ctx: ctx as unknown as AudioContext, sources, room, destination: node() };
}

afterEach(() => vi.useRealTimers());

describe("music renderer lifecycle", () => {
  it("disabled before unlock schedules no sources, enabling starts the current cue", () => {
    vi.useFakeTimers();
    const { ctx, sources, destination } = audioContext();
    const music = new MusicSystem();
    music.setEnabled(false);
    music.setState("explore");
    music.start(ctx, destination);
    vi.advanceTimersByTime(800);
    expect(sources).toHaveLength(0);
    music.setEnabled(true);
    expect(sources.length).toBeGreaterThan(0);
    music.dispose();
  });

  it("disable stops already scheduled voices and clears wet tail without resurrecting them", () => {
    vi.useFakeTimers();
    const { ctx, sources, room, destination } = audioContext();
    const music = new MusicSystem();
    music.start(ctx, destination);
    const scheduled = [...sources];
    expect(scheduled.length).toBeGreaterThan(0);
    music.setEnabled(false);
    for (const source of scheduled) expect(source.stop).toHaveBeenLastCalledWith(0.035);
    expect(room.buffer).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(sources).toHaveLength(scheduled.length);
    music.setEnabled(true);
    expect(room.buffer).not.toBeNull();
    music.dispose();
    const count = sources.length;
    vi.advanceTimersByTime(1000);
    expect(sources).toHaveLength(count);
  });

  it("terminal cues play once even after the timer passes multiple bars", () => {
    vi.useFakeTimers();
    const { ctx, sources, destination } = audioContext();
    const music = new MusicSystem();
    music.setState("victory");
    music.start(ctx, destination);
    const count = sources.length;
    for (let t = 1; t <= 40; t++) {
      (ctx as any).currentTime = t;
      vi.advanceTimersByTime(100);
    }
    expect(sources).toHaveLength(count);
    music.dispose();
  });

  it("resuming a background tab schedules one fresh bar rather than a backlog", () => {
    vi.useFakeTimers();
    const { ctx, sources, destination } = audioContext();
    const music = new MusicSystem();
    music.start(ctx, destination);
    (ctx as any).state = "suspended";
    (ctx as any).currentTime = 120;
    vi.advanceTimersByTime(500);
    const before = sources.length;
    (ctx as any).state = "running";
    vi.advanceTimersByTime(100);
    const fresh = sources.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.length).toBeLessThan(100);
    for (const source of fresh) expect(source.start.mock.calls[0][0]).toBeGreaterThanOrEqual(120);
    music.dispose();
  });

  it("loop transitions wait for a bar boundary while exposing requested state immediately", () => {
    vi.useFakeTimers();
    const { ctx, sources, destination } = audioContext();
    const music = new MusicSystem();
    music.start(ctx, destination);
    const before = sources.length;
    music.setState("combat_high");
    expect(music.currentState).toBe("combat_high");
    (ctx as any).currentTime = 1;
    vi.advanceTimersByTime(100);
    expect(sources).toHaveLength(before);
    (ctx as any).currentTime = 3.6; // first 64 BPM bar ends at 3.83 seconds
    vi.advanceTimersByTime(100);
    expect(sources.length).toBeGreaterThan(before);
    music.dispose();
  });
});
