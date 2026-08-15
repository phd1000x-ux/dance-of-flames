import { describe, it, expect } from "vitest";
import { InputState, DEFAULT_BINDINGS } from "../src/input/InputState";
import { MANUAL_SECTIONS, formatBinding } from "../src/data/manual";

describe("InputState — action bindings", () => {
  it("KeyW → accelerate", () => {
    const s = new InputState();
    s.keyDown("KeyW");
    expect(s.isDown("accelerate")).toBe(true);
  });

  it("KeyA → turnLeft, KeyD → turnRight", () => {
    const s = new InputState();
    s.keyDown("KeyA");
    expect(s.isDown("turnLeft")).toBe(true);
    expect(s.isDown("turnRight")).toBe(false);
    s.keyUp("KeyA");
    s.keyDown("KeyD");
    expect(s.isDown("turnLeft")).toBe(false);
    expect(s.isDown("turnRight")).toBe(true);
  });

  it("Space → climb", () => {
    const s = new InputState();
    s.keyDown("Space");
    expect(s.isDown("climb")).toBe(true);
  });

  it("KeyC → descend", () => {
    const s = new InputState();
    s.keyDown("KeyC");
    expect(s.isDown("descend")).toBe(true);
  });

  it("KeyF → fire", () => {
    const s = new InputState();
    s.keyDown("KeyF");
    expect(s.isDown("fire")).toBe(true);
    expect(s.pressed("fire")).toBe(true);
  });

  it("arrow keys drive keyboard look axes", () => {
    const s = new InputState();
    s.keyDown("ArrowLeft");
    expect(s.isDown("lookLeft")).toBe(true);
    expect(s.lookYawRaw).toBe(-1);
    s.keyUp("ArrowLeft");
    s.keyDown("ArrowRight");
    expect(s.lookYawRaw).toBe(1);
    s.keyUp("ArrowRight");
    s.keyDown("ArrowUp");
    expect(s.isDown("lookUp")).toBe(true);
    expect(s.lookPitchRaw).toBe(1);
    s.keyUp("ArrowUp");
    s.keyDown("ArrowDown");
    expect(s.lookPitchRaw).toBe(-1);
    expect(s.lookYawRaw).toBe(0);
  });

  it("combat keys bind to their actions", () => {
    const s = new InputState();
    s.keyDown("KeyR");
    expect(s.isDown("super")).toBe(true);
    s.keyUp("KeyR");
    s.keyDown("KeyX");
    expect(s.isDown("lockOn")).toBe(true);
    s.keyUp("KeyX");
    s.keyDown("KeyZ");
    expect(s.isDown("recenterCamera")).toBe(true);
    s.keyUp("KeyZ");
    s.keyDown("KeyQ");
    expect(s.isDown("dodgeLeft")).toBe(true);
    s.keyUp("KeyQ");
    s.keyDown("KeyE");
    expect(s.isDown("dodgeRight")).toBe(true);
  });

  it("ground combat keys bind to their actions", () => {
    const s = new InputState();
    s.keyDown("KeyJ");
    expect(s.isDown("lightAttack")).toBe(true);
    s.keyUp("KeyJ");
    s.keyDown("KeyK");
    expect(s.isDown("heavyAttack")).toBe(true);
    s.keyUp("KeyK");
    s.keyDown("KeyL");
    expect(s.isDown("block")).toBe(true);
    s.keyUp("KeyL");
    s.keyDown("Space");
    expect(s.isDown("jump")).toBe(true);
  });

  it("input clears correctly on keyup", () => {
    const s = new InputState();
    s.keyDown("KeyW");
    s.keyDown("KeyF");
    expect(s.isDown("accelerate")).toBe(true);
    expect(s.isDown("fire")).toBe(true);
    s.keyUp("KeyW");
    s.keyUp("KeyF");
    expect(s.isDown("accelerate")).toBe(false);
    expect(s.isDown("fire")).toBe(false);
  });

  it("pressed() is frame-scoped and cleared by endFrame()", () => {
    const s = new InputState();
    s.keyDown("KeyF");
    expect(s.pressed("fire")).toBe(true);
    s.endFrame();
    expect(s.pressed("fire")).toBe(false);
    expect(s.isDown("fire")).toBe(true); // still held
    s.keyUp("KeyF");
    expect(s.isDown("fire")).toBe(false);
  });
});

describe("InputState — simultaneous keys (§46)", () => {
  it("W + A produces accelerate + turnLeft", () => {
    const s = new InputState();
    s.keyDown("KeyW");
    s.keyDown("KeyA");
    expect(s.isDown("accelerate")).toBe(true);
    expect(s.isDown("turnLeft")).toBe(true);
  });

  it("W + Shift + F produces accelerate + boost + fire", () => {
    const s = new InputState();
    s.keyDown("KeyW");
    s.keyDown("ShiftLeft");
    s.keyDown("KeyF");
    expect(s.isDown("accelerate")).toBe(true);
    expect(s.isDown("boost")).toBe(true);
    expect(s.isDown("fire")).toBe(true);
  });

  it("W + D + Space produces forward + right turn + climb", () => {
    const s = new InputState();
    s.keyDown("KeyW");
    s.keyDown("KeyD");
    s.keyDown("Space");
    expect(s.isDown("accelerate")).toBe(true);
    expect(s.isDown("turnRight")).toBe(true);
    expect(s.isDown("climb")).toBe(true);
  });
});

describe("InputState — look smoothing & reset safety", () => {
  it("look axes converge smoothly with update(dt) and return to zero on release", () => {
    const s = new InputState();
    s.keyDown("ArrowRight");
    for (let i = 0; i < 30; i++) s.update(1 / 60);
    expect(s.lookYaw).toBeGreaterThan(0.9);
    s.keyUp("ArrowRight");
    for (let i = 0; i < 30; i++) s.update(1 / 60);
    expect(Math.abs(s.lookYaw)).toBeLessThan(0.05);
  });

  it("reset() clears all active state (stuck-key safety)", () => {
    const s = new InputState();
    s.keyDown("KeyW");
    s.keyDown("KeyF");
    s.keyDown("Space");
    s.update(1 / 60);
    s.reset();
    expect(s.isDown("accelerate")).toBe(false);
    expect(s.isDown("fire")).toBe(false);
    expect(s.isDown("climb")).toBe(false);
    expect(s.lookYaw).toBe(0);
    expect(s.lookPitch).toBe(0);
  });

  it("keyboardOnly mode ignores mouse bindings but keeps keyboard ones", () => {
    const s = new InputState();
    s.keyboardOnly = true;
    s.keyDown("Mouse0");
    expect(s.isDown("fire")).toBe(false);
    s.keyDown("KeyF");
    expect(s.isDown("fire")).toBe(true);
  });
});

describe("manual accuracy (§50) — displayed keys match actual bindings", () => {
  it("every manual entry with a linked action matches its primary binding", () => {
    for (const section of MANUAL_SECTIONS) {
      for (const entry of section.entries) {
        if (!entry.action) continue;
        expect(formatBinding(entry.action)).toBeTruthy();
      }
    }
  });

  it("core bindings are the documented keys", () => {
    expect(DEFAULT_BINDINGS.accelerate).toContain("KeyW");
    expect(DEFAULT_BINDINGS.decelerate).toContain("KeyS");
    expect(DEFAULT_BINDINGS.turnLeft).toContain("KeyA");
    expect(DEFAULT_BINDINGS.turnRight).toContain("KeyD");
    expect(DEFAULT_BINDINGS.climb).toContain("Space");
    expect(DEFAULT_BINDINGS.descend).toContain("KeyC");
    expect(DEFAULT_BINDINGS.boost).toContain("ShiftLeft");
    expect(DEFAULT_BINDINGS.dodgeLeft).toContain("KeyQ");
    expect(DEFAULT_BINDINGS.dodgeRight).toContain("KeyE");
    expect(DEFAULT_BINDINGS.fire).toContain("KeyF");
    expect(DEFAULT_BINDINGS.fire).toContain("Mouse0"); // mouse remains an alternative
    expect(DEFAULT_BINDINGS.super).toContain("KeyR");
    expect(DEFAULT_BINDINGS.lockOn).toContain("KeyX");
    expect(DEFAULT_BINDINGS.recenterCamera).toContain("KeyZ");
    expect(DEFAULT_BINDINGS.lightAttack).toContain("KeyJ");
    expect(DEFAULT_BINDINGS.heavyAttack).toContain("KeyK");
    expect(DEFAULT_BINDINGS.block).toContain("KeyL");
    expect(DEFAULT_BINDINGS.objectives).toContain("Tab");
  });

  it("manual has four sections covering flight, combat, ground, and menus", () => {
    expect(MANUAL_SECTIONS.map((s) => s.id)).toEqual(["flight", "combat", "ground", "menu"]);
    for (const s of MANUAL_SECTIONS) expect(s.entries.length).toBeGreaterThan(3);
  });

  it("formatBinding renders human-readable key names", () => {
    expect(formatBinding("accelerate")).toBe("W");
    expect(formatBinding("boost")).toBe("Shift");
    expect(formatBinding("lookLeft")).toBe("Arrow Left");
    expect(formatBinding("recenterCamera")).toBe("Z");
  });
});
