import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioManager } from "../src/audio/AudioManager";
import { defaultSettings } from "../src/save/SaveSystem";

function installAudio() {
  const buffers: any[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = () => ({ gain: param(), frequency: param(), Q: param(), playbackRate: param(),
    connect: vi.fn((n) => n), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() });
  class FakeContext {
    currentTime = 0;
    sampleRate = 100;
    state = "running";
    destination = node();
    close = vi.fn();
    createGain = node;
    createBiquadFilter = node;
    createOscillator = node;
    createBufferSource() { const n = node(); buffers.push(n); return n; }
    createBuffer(channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  }
  vi.stubGlobal("window", { AudioContext: FakeContext });
  return buffers;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("audio bus and loop lifecycle", () => {
  it("a disabled preference survives unlock, impacts, and settings changes without altering volume", () => {
    vi.useFakeTimers();
    installAudio();
    const settings = defaultSettings();
    settings.musicVolume = 0.43;
    settings.musicEnabled = false;
    const audio = new AudioManager(settings);
    audio.unlock();
    expect(audio.audioContext).not.toBeNull();
    const gain = (audio.musicInput as GainNode).gain;
    expect(gain.value).toBe(0);
    audio.impactDuck();
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1.6, 0.5);
    settings.musicEnabled = true;
    audio.applySettings();
    expect(gain.cancelScheduledValues).toHaveBeenLastCalledWith(0);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0.43, 0, 0.012);
    expect(settings.musicVolume).toBe(0.43);
    audio.dispose();
  });

  it("stops all three fire sources on release rather than leaving two silent loops running", () => {
    vi.useFakeTimers();
    const buffers = installAudio();
    const audio = new AudioManager(defaultSettings());
    audio.unlock();
    const before = buffers.length;
    audio.setFireLoop(true);
    const fire = buffers.slice(before);
    expect(fire).toHaveLength(3);
    audio.setFireLoop(false);
    vi.advanceTimersByTime(500);
    for (const source of fire) {
      expect(source.stop).toHaveBeenCalledOnce();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
    audio.dispose();
  });

  it("initializes the field ambience and plays zone details when fire is inactive", () => {
    vi.useFakeTimers();
    const buffers = installAudio();
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const audio = new AudioManager(defaultSettings());
    audio.unlock();
    const field = (audio as any).zoneGains.field.gain;
    expect(field.setTargetAtTime).toHaveBeenCalledWith(0.05, 0, 0.9);
    audio.setAmbientZone("castle");
    const before = buffers.length;
    vi.advanceTimersByTime(1600);
    expect(buffers.length).toBeGreaterThan(before);
    audio.dispose();
  });
});
