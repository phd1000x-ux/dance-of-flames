import { describe, expect, it } from "vitest";
import type { KnightClipData } from "../src/world/KnightClips";
import raw from "../public/character-prototype/knight-anims.json";

const data = raw as unknown as KnightClipData;
const ROLES = ["idle", "walk", "run", "slash1", "slash2", "slash3", "heavy", "block", "roll", "hit", "death"];

describe("baked Mixamo clips", () => {
  it("ships every clip the ground knight plays", () => {
    for (const r of ROLES) expect(data.clips[r], r).toBeDefined();
    expect(data.bones).toContain("R_wrist_");
    expect(data.hipHeight).toBeGreaterThan(0);
  });

  it("stores one unit quaternion per bone per frame", () => {
    for (const [name, c] of Object.entries(data.clips)) {
      expect(c.q.length, name).toBe(c.frames * data.bones.length * 4);
      expect(c.hipsY.length, name).toBe(c.frames);
      for (let i = 0; i < c.q.length; i += 4) {
        expect(Math.abs(Math.hypot(c.q[i], c.q[i + 1], c.q[i + 2], c.q[i + 3]) - 1)).toBeLessThan(2e-3);
      }
    }
  });

  it("attack clips have a wind-up before and follow-through after contact", () => {
    for (const r of ["slash1", "slash2", "slash3", "heavy"]) {
      const c = data.clips[r];
      expect(c.start).toBeLessThan(c.contact);
      expect(c.end).toBeGreaterThan(c.contact);
      expect(c.end).toBeLessThan(c.frames);
    }
  });

  it("locomotion loops close: last frame ≈ first frame", () => {
    const n = data.bones.length;
    for (const r of ["idle", "walk", "run"]) {
      const c = data.clips[r];
      let worst = 0;
      for (let b = 0; b < n; b++) {
        const a = b * 4, z = ((c.frames - 1) * n + b) * 4;
        const dot = Math.abs(c.q[a] * c.q[z] + c.q[a + 1] * c.q[z + 1] + c.q[a + 2] * c.q[z + 2] + c.q[a + 3] * c.q[z + 3]);
        worst = Math.max(worst, 2 * Math.acos(Math.min(1, dot)));
      }
      expect(worst, r).toBeLessThan(0.2);
    }
  });
});
