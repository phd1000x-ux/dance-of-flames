import { describe, expect, it } from "vitest";
import { Color3 } from "@babylonjs/core";
import { excessGlow, loadoutForRole, stanceFor, soldierAttackClip } from "../src/world/SoldierVisuals";
import { BOLT_SPEC, ARROW_SPEC } from "../src/world/ProjectileGeometry";

describe("soldier stand-in stance", () => {
  it("dead and burning override everything", () => {
    expect(stanceFor("dead", "infantry", 5, true)).toBe("dead");
    expect(stanceFor("burning", "archer", 0, false)).toBe("burning");
  });
  it("melee windup and the strike follow-through show the swing", () => {
    expect(stanceFor("meleeWindup", "shield", 0, false)).toBe("swing");
    expect(stanceFor("attack", "spear", 0, true)).toBe("swing");
  });
  it("an approaching attacker runs rather than swinging in place", () => {
    expect(stanceFor("attack", "infantry", 5, false)).toBe("run");
  });
  it("archers draw only while standing", () => {
    expect(stanceFor("aim", "archer", 0, false)).toBe("draw");
    expect(stanceFor("alert", "archer", 2, false)).toBe("walk");
  });
  it("idle / walk / run by ground speed", () => {
    expect(stanceFor("patrol", "infantry", 0.1, false)).toBe("idle");
    expect(stanceFor("patrol", "infantry", 1.5, false)).toBe("walk");
    expect(stanceFor("flee", "infantry", 5, false)).toBe("run");
  });
});

describe("loadouts", () => {
  it("each role carries a readable weapon", () => {
    expect(loadoutForRole("archer").main).toBe("bow");
    expect(loadoutForRole("spear").main).toBe("spear");
    expect(loadoutForRole("shield")).toEqual({ main: "sword", off: "shield" });
    expect(loadoutForRole("commander").main).toBe("greatsword");
  });
});

describe("hit-flash glow for imported armor", () => {
  it("resting emissive contributes nothing (it washed PBR armor out to white)", () => {
    const g = excessGlow({ material: { emissiveColor: new Color3(0.05, 0.05, 0.05) } as any, baseEmissive: new Color3(0.05, 0.05, 0.05) });
    expect(g.r + g.g + g.b).toBe(0);
  });
  it("a red telegraph carries over, softened", () => {
    const g = excessGlow({ material: { emissiveColor: new Color3(0.7, 0.1, 0.05) } as any, baseEmissive: new Color3(0.05, 0.05, 0.05) });
    expect(g.r).toBeGreaterThan(0.1);
    expect(g.r).toBeLessThan(0.2); // brighter painted the dark guard plate solid
    expect(g.g).toBeLessThan(0.05);
  });
});

describe("projectile specs", () => {
  it("ballista bolts are heavier than arrows and barbed", () => {
    expect(BOLT_SPEC.length).toBeGreaterThan(ARROW_SPEC.length * 2);
    expect(BOLT_SPEC.barbs).toBe(true);
  });
});

import { NullEngine, Scene } from "@babylonjs/core";
import { buildShaftMesh, hasVertexColors } from "../src/world/ProjectileGeometry";

describe("buildShaftMesh", () => {
  it("one vertex-colored mesh, spec length along +Z, iron head at the front", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const bolt = buildShaftMesh("bolt", BOLT_SPEC, scene);
    expect(scene.meshes.filter(m => m.name.startsWith("bolt-"))).toHaveLength(0); // parts merged away
    expect(hasVertexColors(bolt)).toBe(true);
    const { minimum, maximum } = bolt.getBoundingInfo().boundingBox;
    expect(maximum.z - minimum.z).toBeCloseTo(BOLT_SPEC.length, 1);
    // the head is the widest-tipped end: vertices at max Z converge to the point
    const pos = bolt.getVerticesData("position")!;
    let tipWidth = 0;
    for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] > maximum.z - 0.01) tipWidth = Math.max(tipWidth, Math.abs(pos[i]));
    expect(tipWidth).toBeLessThan(0.02);
    engine.dispose();
  });
});

describe("soldier mocap swing choice", () => {
  it("heavy hitters cleave, spearmen strike straight, line infantry vary their slash", () => {
    expect(soldierAttackClip("elite", 3)).toBe("heavy");
    expect(soldierAttackClip("commander", 0)).toBe("heavy");
    expect(soldierAttackClip("spear", 7)).toBe("light3");
    const mix = new Set([0, 1, 2, 3, 4, 5].map(id => soldierAttackClip("infantry", id)));
    expect(mix).toEqual(new Set(["light1", "light2", "light3"]));
  });
});
