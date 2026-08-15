/**
 * Pure keyboard/mouse action state — single source of truth for key bindings.
 * No DOM dependencies (unit-testable). InputManager feeds browser events into it.
 *
 * Keyboard is the primary, complete control scheme; mouse bindings are optional
 * alternatives on the same actions (never the only path).
 */

export type GameAction =
  | "accelerate"
  | "decelerate"
  | "turnLeft"
  | "turnRight"
  | "climb"
  | "descend"
  | "boost"
  | "fire"
  | "focus"
  | "dodgeLeft"
  | "dodgeRight"
  | "interact" // dragon mode: use flask / consumable
  | "interactGround" // ground mode: use flask / consumable
  | "super"
  | "objectives"
  | "pause"
  | "debug"
  | "lightAttack"
  | "heavyAttack"
  | "block"
  | "jump" // ground dodge
  | "sprint"
  | "lockOn"
  | "recenterCamera"
  | "lookLeft"
  | "lookRight"
  | "lookUp"
  | "lookDown";

export const DEFAULT_BINDINGS: Record<GameAction, string[]> = {
  accelerate: ["KeyW"],
  decelerate: ["KeyS"],
  turnLeft: ["KeyA"],
  turnRight: ["KeyD"],
  climb: ["Space"],
  descend: ["KeyC", "ControlLeft"],
  boost: ["ShiftLeft", "ShiftRight"],
  fire: ["KeyF", "Mouse0"],
  focus: ["Mouse2"],
  dodgeLeft: ["KeyQ"],
  dodgeRight: ["KeyE"],
  interact: ["KeyG"],
  interactGround: ["KeyF"],
  super: ["KeyR"],
  objectives: ["Tab"],
  pause: ["Escape"],
  debug: ["F3"],
  lightAttack: ["KeyJ", "Mouse0"],
  heavyAttack: ["KeyK"],
  block: ["KeyL", "Mouse2"],
  jump: ["Space"],
  sprint: ["ShiftLeft", "ShiftRight"],
  lockOn: ["KeyX"],
  recenterCamera: ["KeyZ"],
  lookLeft: ["ArrowLeft"],
  lookRight: ["ArrowRight"],
  lookUp: ["ArrowUp"],
  lookDown: ["ArrowDown"],
};

/** Keys whose default browser behavior must be suppressed during gameplay. */
export const GAMEPLAY_PREVENT_KEYS = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Tab",
  "F3",
]);

const LOOK_ATTACK_RATE = 9; // smoothing toward held direction (≈0.25s to full)

/** Device-agnostic input state with smoothed keyboard look axes. */
export class InputState {
  private down = new Set<string>();
  private pressedNow = new Set<string>();
  private releasedNow = new Set<string>();

  /** smoothed keyboard look axes, -1..1 (lookYaw + = right, lookPitch + = up) */
  lookYaw = 0;
  lookPitch = 0;
  /** user scaling for keyboard look speed (settings) */
  lookScale = 1;
  /** debug/test mode: gameplay ignores mouse bindings entirely */
  keyboardOnly = false;

  keyDown(code: string): void {
    if (this.down.has(code)) return;
    this.down.add(code);
    this.pressedNow.add(code);
  }

  keyUp(code: string): void {
    this.down.delete(code);
    this.releasedNow.add(code);
  }

  /** clear all active key state (blur / visibility loss / context switch) */
  reset(): void {
    this.down.clear();
    this.pressedNow.clear();
    this.releasedNow.clear();
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  isDownCode(code: string): boolean {
    return this.down.has(code);
  }

  pressedCode(code: string): boolean {
    return this.pressedNow.has(code);
  }

  private bindingActive(codes: string[]): boolean {
    for (const code of codes) {
      if (this.keyboardOnly && code.startsWith("Mouse")) continue;
      if (this.down.has(code)) return true;
    }
    return false;
  }

  isDown(action: GameAction): boolean {
    return this.bindingActive(DEFAULT_BINDINGS[action]);
  }

  pressed(action: GameAction): boolean {
    for (const code of DEFAULT_BINDINGS[action]) {
      if (this.keyboardOnly && code.startsWith("Mouse")) continue;
      if (this.pressedNow.has(code)) return true;
    }
    return false;
  }

  /** raw (unsmoothed) look axis from arrow keys */
  get lookYawRaw(): number {
    return (this.isDownCode("ArrowRight") ? 1 : 0) - (this.isDownCode("ArrowLeft") ? 1 : 0);
  }

  get lookPitchRaw(): number {
    return (this.isDownCode("ArrowUp") ? 1 : 0) - (this.isDownCode("ArrowDown") ? 1 : 0);
  }

  /** frame-rate independent smoothing of keyboard look axes (§40: accelerate smoothly, stop smoothly) */
  update(dt: number): void {
    const k = 1 - Math.exp(-LOOK_ATTACK_RATE * Math.max(0, dt));
    this.lookYaw += (this.lookYawRaw - this.lookYaw) * k;
    this.lookPitch += (this.lookPitchRaw - this.lookPitch) * k;
  }

  endFrame(): void {
    this.pressedNow.clear();
    this.releasedNow.clear();
  }
}
