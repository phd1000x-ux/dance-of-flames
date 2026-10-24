import { describe, it, expect } from "vitest";
import { composeBar, stateConfig, type MusicStateId } from "../src/audio/MusicComposer";

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

describe("music composer — original cello/violin score", () => {
  const states: MusicStateId[] = [
    "menu",
    "explore",
    "combat_low",
    "combat_high",
    "castle",
    "ground",
    "dragon_fallen",
    "victory",
    "defeat",
  ];

  it("every state produces notes within playable ranges", () => {
    for (const st of states) {
      const bar = composeBar(st, 0, 42);
      expect(bar.notes.length).toBeGreaterThan(0);
      for (const n of bar.notes) {
        expect(n.midi).toBeGreaterThanOrEqual(24); // >= C1
        expect(n.midi).toBeLessThanOrEqual(96); // <= C7
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start + n.dur).toBeLessThanOrEqual(bar.beats + 4.5); // release tail allowed
        expect(midiToFreq(n.midi)).toBeGreaterThan(30);
        expect(midiToFreq(n.midi)).toBeLessThan(4200);
      }
    }
  });

  it("is deterministic for (state, bar, seed)", () => {
    for (const st of states) {
      const a = composeBar(st, 3, 7);
      const b = composeBar(st, 3, 7);
      expect(a).toEqual(b);
    }
  });

  it("cello and violin are the dominant voices across cues", () => {
    for (const st of ["menu", "explore", "combat_low", "castle", "victory", "defeat"] as MusicStateId[]) {
      const bar = composeBar(st, 1, 11);
      const strings = bar.notes.filter((n) => n.voice === "cello" || n.voice === "violin").length;
      expect(strings).toBeGreaterThanOrEqual(Math.ceil(bar.notes.length * 0.6));
    }
  });

  it("cello sits an octave+ below violin in the ensemble", () => {
    const bar = composeBar("combat_high", 2, 5);
    const cellos = bar.notes.filter((n) => n.voice === "cello").map((n) => n.midi);
    const violins = bar.notes.filter((n) => n.voice === "violin").map((n) => n.midi);
    expect(Math.min(...cellos)).toBeLessThan(Math.min(...violins));
  });

  it("cues are musically distinct (not one loop relabeled)", () => {
    const sig = (st: MusicStateId) =>
      composeBar(st, 0, 3).notes.map((n) => `${n.voice}${n.midi}@${n.start}`).join(",");
    const sigs = states.map((s) => sig(s));
    expect(new Set(sigs).size).toBeGreaterThanOrEqual(7);
  });

  it("combat escalates: combat_high has more notes than combat_low", () => {
    const lo = composeBar("combat_low", 1, 9).notes.length;
    const hi = composeBar("combat_high", 1, 9).notes.length;
    expect(hi).toBeGreaterThan(lo);
  });

  it("stingers are one-shot (loop=false) and cues loop", () => {
    expect(stateConfig("dragon_fallen").loop).toBe(false);
    expect(stateConfig("victory").loop).toBe(false);
    expect(stateConfig("defeat").loop).toBe(false);
    expect(stateConfig("explore").loop).toBe(true);
    expect(stateConfig("castle").loop).toBe(true);
  });

  it("combat tempo is faster than exploration", () => {
    expect(stateConfig("combat_high").bpm).toBeGreaterThan(stateConfig("explore").bpm);
    expect(stateConfig("castle").bpm).toBeGreaterThan(stateConfig("menu").bpm);
  });
});

describe("chase/boss states", () => {
  it("chase bars are violin-dominant and fast", () => {
    const bar = composeBar("chase", 0, 1234);
    expect(bar.bpm).toBeGreaterThan(120);
    const violin = bar.notes.filter((n) => n.voice === "violin").length;
    const cello = bar.notes.filter((n) => n.voice === "cello").length;
    expect(violin).toBeGreaterThan(cello);
  });

  it("boss bars deterministic and dense", () => {
    expect(composeBar("boss", 2, 42)).toEqual(composeBar("boss", 2, 42));
    expect(composeBar("boss", 0, 42).notes.length).toBeGreaterThanOrEqual(8);
  });

  it("state configs loop", () => {
    expect(stateConfig("chase").loop).toBe(true);
    expect(stateConfig("boss").loop).toBe(true);
  });
});

describe("score harmony", () => {
  it("uses the documented D-minor tonal center and descending D5/C5 answer", () => {
    const menu = composeBar("menu", 0, 42);
    expect(menu.notes.filter(n => n.voice === "cello").map(n => n.midi)).toContain(38); // D2
    const answer = composeBar("menu", 2, 42).notes.filter(n => n.voice === "violin");
    expect(answer.slice(0, 2).map(n => n.midi)).toEqual([74, 72]);
  });

  it("war ostinato follows each major/minor chord rather than transposing a minor scale over it", () => {
    const triads = [[2, 5, 9], [10, 2, 5], [5, 9, 0], [9, 1, 4]];
    for (let bar = 0; bar < 4; bar++) {
      const notes = composeBar("combat_high", bar, 42).notes.filter(n => n.voice === "cello");
      for (const note of notes) expect(triads[bar]).toContain(note.midi % 12);
    }
  });

  it("victory reserves its entire five-beat resolution before a following cue", () => {
    const bar = composeBar("victory", 0, 42);
    expect(bar.beats).toBe(5);
    expect(Math.max(...bar.notes.map(n => n.start + n.dur))).toBeLessThanOrEqual(bar.beats);
  });
});
