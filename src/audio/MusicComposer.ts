import { SeededRng } from "../core/SeededRng";

/**
 * ORIGINAL dark-fantasy score data — composed for this project.
 * Key: D minor. Instrumentation: cello + violin (core), frame drum, low pad.
 * All motifs, chord progressions and rhythms below are original work; no
 * copyrighted themes are referenced or derived from.
 *
 * Pure module (no AudioContext) so the composition is unit-testable.
 */

export type MusicStateId =
  | "menu"
  | "explore"
  | "combat_low"
  | "combat_high"
  | "castle"
  | "ground"
  | "dragon_fallen"
  | "victory"
  | "defeat"
  | "chase"
  | "boss";

export interface NoteEvent {
  voice: "cello" | "violin" | "drum" | "pad";
  midi: number; // MIDI note number
  start: number; // beats from bar start
  dur: number; // beats
  vel: number; // 0..1
}

export interface BarPlan {
  bpm: number;
  beats: number;
  notes: NoteEvent[];
}

/** D natural minor pitch classes relative to D */
const PC = { D: 0, E: 2, F: 3, G: 5, A: 7, Bb: 8, C: 10, Cs: 11 };

const midi = (octave: number, semis: number) => 12 * (octave + 1) + semis; // midi(2,0)=D2=38

/** original harmonic vocabulary (i – VI – III – VII / i – iv – VI – V) */
const PROGRESSIONS: number[][][] = [
  // [chord semitone stacks from root D]
  [
    [PC.D, PC.F, PC.A],
    [PC.Bb - 12 + 12, PC.D, PC.F], // Bb
    [PC.F, PC.A, PC.C],
    [PC.A, PC.Cs, PC.E],
  ],
  [
    [PC.D, PC.F, PC.A],
    [PC.G, PC.Bb, PC.D],
    [PC.Bb, PC.D, PC.F],
    [PC.A, PC.Cs, PC.E],
  ],
];

/** THE FLAME MOTIF (original): A4 F4 E4 D4 — falling, tragic-noble */
const MOTIF_FLAME: [number, number][] = [
  [midi(4, PC.A), 1.5],
  [midi(4, PC.F), 0.5],
  [midi(4, PC.E), 0.5],
  [midi(4, PC.D), 1.5],
];
/** inversion answer: D5 C5 A4 F4 */
const MOTIF_ANSWER: [number, number][] = [
  [midi(5, PC.D), 1],
  [midi(5, PC.C), 0.5],
  [midi(4, PC.A), 0.5],
  [midi(4, PC.F), 2],
];
/** war ostinato (cello): D D A D D C D D Bb... original rhythm-cell */
const OSTINATO: [number, number][] = [
  [midi(2, PC.D), 0.5],
  [midi(2, PC.D), 0.5],
  [midi(2, PC.A), 0.5],
  [midi(3, PC.D), 0.5],
  [midi(2, PC.D), 0.5],
  [midi(2, PC.D), 0.5],
  [midi(3, PC.C), 0.5],
  [midi(3, PC.Bb), 0.5],
];

const STATE_CONFIG: Record<
  MusicStateId,
  { bpm: number; loop: boolean; intensity: number }
> = {
  menu: { bpm: 64, loop: true, intensity: 0.2 },
  explore: { bpm: 72, loop: true, intensity: 0.3 },
  combat_low: { bpm: 96, loop: true, intensity: 0.55 },
  combat_high: { bpm: 122, loop: true, intensity: 0.85 },
  castle: { bpm: 104, loop: true, intensity: 0.7 },
  ground: { bpm: 108, loop: true, intensity: 0.65 },
  dragon_fallen: { bpm: 60, loop: false, intensity: 1 },
  victory: { bpm: 84, loop: false, intensity: 0.8 },
  defeat: { bpm: 56, loop: false, intensity: 0.9 },
  chase: { bpm: 132, loop: true, intensity: 0.9 },
  boss: { bpm: 116, loop: true, intensity: 0.95 },
};

export function stateConfig(id: MusicStateId) {
  return STATE_CONFIG[id];
}

/**
 * Compose one bar (4 beats) for a state. Deterministic per (state, barIndex, seed).
 */
export function composeBar(state: MusicStateId, barIndex: number, seed: number): BarPlan {
  const rng = new SeededRng(seed * 7919 + barIndex * 131 + state.length * 17);
  const cfg = STATE_CONFIG[state];
  const notes: NoteEvent[] = [];
  const chord = PROGRESSIONS[barIndex % 2][barIndex % 4];
  const root = midi(2, chord[0]);

  switch (state) {
    case "menu": {
      // solo cello flame motif, then violin harmony enters on later bars
      const motif = barIndex % 4 < 2 ? MOTIF_FLAME : MOTIF_ANSWER;
      let t = 0;
      for (const [m, d] of motif) {
        notes.push({ voice: "cello", midi: m - 12, start: t, dur: d, vel: 0.5 });
        if (barIndex % 4 >= 1) {
          notes.push({ voice: "violin", midi: m, start: t, dur: d, vel: 0.18 });
        }
        t += d;
      }
      if (barIndex % 4 === 3) notes.push({ voice: "pad", midi: root, start: 0, dur: 4, vel: 0.12 });
      break;
    }
    case "explore": {
      // long cello roots + sparse high violin
      notes.push({ voice: "cello", midi: root, start: 0, dur: 4, vel: 0.34 });
      if (barIndex % 2 === 0) {
        notes.push({ voice: "violin", midi: midi(4, chord[2]), start: 0.5, dur: 3, vel: 0.14 });
      } else if (rng.chance(0.7)) {
        const m = rng.pick([MOTIF_FLAME, MOTIF_ANSWER]);
        let t = 1;
        for (const [note, d] of m.slice(0, 2)) {
          notes.push({ voice: "violin", midi: note, start: t, dur: d, vel: 0.16 });
          t += d;
        }
      }
      break;
    }
    case "combat_low": {
      // cello ostinato + frame drum on 1 & 3 + violin long tones
      let t = 0;
      for (const [m, d] of OSTINATO) {
        notes.push({ voice: "cello", midi: m, start: t, dur: d * 0.92, vel: 0.4 });
        t += d;
      }
      notes.push({ voice: "drum", midi: 36, start: 0, dur: 0.3, vel: 0.5 });
      notes.push({ voice: "drum", midi: 36, start: 2, dur: 0.3, vel: 0.42 });
      notes.push({ voice: "violin", midi: midi(4, chord[1]), start: 0, dur: 4, vel: 0.12 });
      break;
    }
    case "combat_high": {
      // denser: ostinato + violin 16th figure + drums on every beat
      let t = 0;
      for (const [m, d] of OSTINATO) {
        notes.push({ voice: "cello", midi: m, start: t, dur: d * 0.85, vel: 0.48 });
        t += d;
      }
      for (let i = 0; i < 8; i++) {
        const deg = chord[i % chord.length];
        notes.push({ voice: "violin", midi: midi(5, deg), start: i * 0.5, dur: 0.42, vel: i % 2 === 0 ? 0.2 : 0.12 });
      }
      for (let b = 0; b < 4; b++) notes.push({ voice: "drum", midi: 36, start: b, dur: 0.25, vel: b % 2 === 0 ? 0.6 : 0.4 });
      notes.push({ voice: "pad", midi: root, start: 0, dur: 4, vel: 0.1 });
      break;
    }
    case "castle": {
      // assault cue: ostinato + low pad swell + phase melody (later bars) + martial drums
      let t = 0;
      for (const [m, d] of OSTINATO) {
        notes.push({ voice: "cello", midi: m - 0, start: t, dur: d * 0.9, vel: 0.5 });
        t += d;
      }
      notes.push({ voice: "pad", midi: root, start: 0, dur: 4, vel: 0.16 });
      notes.push({ voice: "drum", midi: 36, start: 0, dur: 0.3, vel: 0.55 });
      notes.push({ voice: "drum", midi: 36, start: 1.5, dur: 0.25, vel: 0.35 });
      notes.push({ voice: "drum", midi: 36, start: 2, dur: 0.3, vel: 0.55 });
      if (barIndex % 4 >= 2) {
        // breach phase: violin melody enters
        let tt = 0;
        for (const [m, d] of MOTIF_FLAME) {
          notes.push({ voice: "violin", midi: m + (barIndex % 4 === 3 ? 2 : 0), start: tt, dur: d * 0.9, vel: 0.22 });
          tt += d;
        }
      }
      break;
    }
    case "ground": {
      // staccato cello pulse + drums + tense violin sustain
      for (let i = 0; i < 8; i += 2) {
        notes.push({ voice: "cello", midi: root + (i === 4 ? 7 : 0), start: i * 0.5, dur: 0.4, vel: 0.42 });
      }
      notes.push({ voice: "drum", midi: 36, start: 0, dur: 0.3, vel: 0.5 });
      notes.push({ voice: "drum", midi: 36, start: 2.5, dur: 0.25, vel: 0.4 });
      notes.push({ voice: "violin", midi: midi(4, chord[2]), start: 0, dur: 4, vel: 0.14 });
      break;
    }
    case "dragon_fallen": {
      // one-shot stinger: low cello drop + descending violin phrase
      notes.push({ voice: "cello", midi: midi(2, PC.D), start: 0, dur: 3, vel: 0.6 });
      notes.push({ voice: "cello", midi: midi(1, PC.A), start: 1, dur: 3, vel: 0.45 });
      let t = 0.5;
      for (const m of [midi(4, PC.F), midi(4, PC.E), midi(4, PC.D), midi(3, PC.A)]) {
        notes.push({ voice: "violin", midi: m, start: t, dur: 0.8, vel: 0.3 });
        t += 0.75;
      }
      notes.push({ voice: "drum", midi: 36, start: 0, dur: 0.5, vel: 0.7 });
      break;
    }
    case "victory": {
      // D major lift: cello arpeggio + violin ascent
      const VEL = 0.5;
      let t = 0;
      for (const [m, d] of [
        [midi(2, PC.D), 1],
        [midi(2, PC.A), 1],
        [midi(3, PC.D), 1],
        [midi(3, PC.F) + 1, 1],
      ] as [number, number][]) {
        notes.push({ voice: "cello", midi: m, start: t, dur: d, vel: VEL });
        t += d;
      }
      t = 0;
      for (const [m, d] of [
        [midi(5, PC.D), 1],
        [midi(5, PC.E), 1],
        [midi(5, PC.F) + 1, 1], // F# — D major third
        [midi(5, PC.A), 2],
      ] as [number, number][]) {
        notes.push({ voice: "violin", midi: m, start: t, dur: d, vel: 0.32 });
        t += d;
      }
      break;
    }
    case "defeat": {
      // unresolved low cluster, fading
      notes.push({ voice: "cello", midi: midi(1, PC.D), start: 0, dur: 4, vel: 0.5 });
      notes.push({ voice: "cello", midi: midi(2, PC.Bb) - 1, start: 0.5, dur: 3.5, vel: 0.3 }); // Ab against D — unresolved tritone
      notes.push({ voice: "violin", midi: midi(4, PC.Bb), start: 1, dur: 3, vel: 0.16 });
      break;
    }
    case "chase": {
      // fast violin ostinato over pounding cello roots
      for (let i = 0; i < 16; i++) {
        notes.push({ voice: "violin", midi: midi(5, chord[i % chord.length]), start: i * 0.25, dur: 0.22, vel: i % 4 === 0 ? 0.26 : 0.15 });
      }
      for (const b of [0, 1, 2, 3]) {
        notes.push({ voice: "cello", midi: root, start: b, dur: 0.9, vel: 0.4 });
        notes.push({ voice: "drum", midi: 36, start: b, dur: 0.2, vel: 0.6 });
        notes.push({ voice: "drum", midi: 36, start: b + 0.5, dur: 0.15, vel: 0.35 });
      }
      break;
    }
    case "boss": {
      // aggressive interplay: cello ostinato vs violin stabs a fifth above
      let t = 0;
      for (const [m, d] of OSTINATO) {
        notes.push({ voice: "cello", midi: m - 5, start: t, dur: d * 0.9, vel: 0.5 });
        t += d;
      }
      for (let i = 0; i < 8; i++) {
        notes.push({ voice: "violin", midi: midi(4, chord[i % chord.length]) + 7, start: i * 0.5 + 0.25, dur: 0.3, vel: 0.22 });
      }
      for (const b of [0, 2]) notes.push({ voice: "drum", midi: 36, start: b, dur: 0.4, vel: 0.65 });
      notes.push({ voice: "pad", midi: root - 12, start: 0, dur: 4, vel: 0.12 });
      break;
    }
  }
  return { bpm: cfg.bpm, beats: 4, notes };
}
