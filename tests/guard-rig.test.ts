import { describe, expect, it } from "vitest";
import guardRig from "../src/data/guard-rig.json";
import guardAnims from "../public/character-prototype/guard-anims.json";
import knightAnims from "../public/character-prototype/knight-anims.json";

describe("soldier guard rig", () => {
  it("bakes the same bone set as the hero's clips, so KnightClipPlayer drives both", () => {
    expect(guardAnims.bones).toEqual(knightAnims.bones);
    expect(Object.keys(guardAnims.clips).sort()).toEqual(Object.keys(knightAnims.clips).sort());
  });
  it("aliases every baked bone plus the hand joints fistGrip and HeldWeapon need", () => {
    const aliases = guardRig.aliases as Record<string, string>;
    for (const b of [...guardAnims.bones, "L_middle1_", "L_thumb1_", "R_middle1_", "R_thumb1_"]) {
      expect(aliases[b], b).toBeTruthy();
    }
  });
});
