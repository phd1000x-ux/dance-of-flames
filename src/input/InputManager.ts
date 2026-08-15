import { GAMEPLAY_PREVENT_KEYS, InputState } from "./InputState";
import type { GameAction } from "./InputState";

export type { GameAction } from "./InputState";
export { DEFAULT_BINDINGS, InputState } from "./InputState";

export type InputContext = "menu" | "gameplay";

/**
 * Browser input front-end: DOM events → InputState (pure) → gameplay consumers.
 * Keyboard is the complete primary scheme; mouse remains an optional alternative.
 */
export class InputManager {
  readonly state = new InputState();
  mouseDX = 0;
  mouseDY = 0;
  /** non-destructive per-frame totals (cleared at endFrame) — for tutorials/stats */
  frameMouseDX = 0;
  frameMouseDY = 0;
  wheel = 0;
  pointerLocked = false;
  /** test/E2E mode: synthetic input injection without real devices */
  testMode = false;
  sensitivity = 1;
  invertY = false;
  /** menu vs gameplay: controls browser-key suppression policy */
  context: InputContext = "menu";
  /** §44 debug mode: prove the game is playable with zero mouse input */
  keyboardOnly = false;
  /** synchronous keydown hook (e.g. instant pause — no frame-delay race) */
  onKeyDown: ((code: string, event: KeyboardEvent) => void) | null = null;

  private keyDownHandler = (e: KeyboardEvent) => {
    // always suppress Tab/F3 focus-stealing; suppress scroll keys only during gameplay
    if (this.context === "gameplay") {
      if (GAMEPLAY_PREVENT_KEYS.has(e.code)) e.preventDefault();
    } else if (e.code === "Tab" || e.code === "F3") {
      e.preventDefault();
    }
    if (e.repeat) return;
    this.state.keyDown(e.code);
    this.onKeyDown?.(e.code, e);
  };
  private keyUpHandler = (e: KeyboardEvent) => {
    this.state.keyUp(e.code);
  };
  private mouseDownHandler = (e: MouseEvent) => {
    this.state.keyDown(`Mouse${e.button}`);
  };
  private mouseUpHandler = (e: MouseEvent) => {
    this.state.keyUp(`Mouse${e.button}`);
  };
  private mouseMoveHandler = (e: MouseEvent) => {
    if (this.pointerLocked || this.testMode || e.buttons !== 0 || this.freeMouse) {
      this.mouseDX += e.movementX ?? 0;
      this.mouseDY += e.movementY ?? 0;
      this.frameMouseDX += e.movementX ?? 0;
      this.frameMouseDY += e.movementY ?? 0;
    }
  };
  private wheelHandler = (e: WheelEvent) => {
    this.wheel += e.deltaY;
  };
  private blurHandler = () => {
    this.resetAllInputs();
  };
  private visibilityHandler = () => {
    if (document.hidden) this.resetAllInputs();
  };
  private pointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  /** allow cursor-based camera steering in menus without pointer lock */
  freeMouse = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private rawMoveHandler = (e: MouseEvent) => {
    if (!this.freeMouse || this.pointerLocked || this.testMode) return;
    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.mouseDX += dx;
    this.mouseDY += dy;
  };

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.keyDownHandler);
    window.addEventListener("keyup", this.keyUpHandler);
    window.addEventListener("mousedown", this.mouseDownHandler);
    window.addEventListener("mouseup", this.mouseUpHandler);
    window.addEventListener("mousemove", this.mouseMoveHandler);
    window.addEventListener("mousemove", this.rawMoveHandler);
    window.addEventListener("wheel", this.wheelHandler, { passive: true });
    window.addEventListener("blur", this.blurHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
    document.addEventListener("pointerlockchange", this.pointerLockChange);
  }

  setContext(ctx: InputContext): void {
    if (this.context !== ctx) {
      this.context = ctx;
      this.resetAllInputs();
    }
  }

  /** §56 stuck-key safety: clear everything */
  resetAllInputs(): void {
    this.state.reset();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.frameMouseDX = 0;
    this.frameMouseDY = 0;
    this.wheel = 0;
  }

  requestPointerLock(): void {
    if (this.testMode || this.pointerLocked) return;
    this.canvas.requestPointerLock?.();
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(action: GameAction): boolean {
    return this.state.isDown(action);
  }

  isDownCode(code: string): boolean {
    return this.state.isDownCode(code);
  }

  pressed(action: GameAction): boolean {
    return this.state.pressed(action);
  }

  pressedCode(code: string): boolean {
    return this.state.pressedCode(code);
  }

  /** smoothed keyboard look axes (updated via update(dt)) */
  get lookYaw(): number {
    return this.state.lookYaw * this.state.lookScale;
  }
  get lookPitch(): number {
    return this.state.lookPitch * this.state.lookScale;
  }

  update(dt: number): void {
    this.state.keyboardOnly = this.keyboardOnly;
    this.state.update(dt);
  }

  /** consume mouse delta (applies sensitivity & invert-Y), returns radians-ish units */
  consumeMouse(): { dx: number; dy: number } {
    if (this.keyboardOnly) {
      this.mouseDX = 0;
      this.mouseDY = 0;
      return { dx: 0, dy: 0 };
    }
    const dx = (this.mouseDX / 900) * this.sensitivity;
    const dy = (this.mouseDY / 900) * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  endFrame(simRanThisFrame = true): void {
    this.state.endFrame(simRanThisFrame);
    this.wheel = 0;
    this.frameMouseDX = 0;
    this.frameMouseDY = 0;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.keyDownHandler);
    window.removeEventListener("keyup", this.keyUpHandler);
    window.removeEventListener("mousedown", this.mouseDownHandler);
    window.removeEventListener("mouseup", this.mouseUpHandler);
    window.removeEventListener("mousemove", this.mouseMoveHandler);
    window.removeEventListener("mousemove", this.rawMoveHandler);
    window.removeEventListener("wheel", this.wheelHandler);
    window.removeEventListener("blur", this.blurHandler);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    document.removeEventListener("pointerlockchange", this.pointerLockChange);
  }

  // ---- test injection API ----
  injectKeyDown(code: string): void {
    this.state.keyDown(code);
  }
  injectKeyUp(code: string): void {
    this.state.keyUp(code);
  }
  injectMouse(button: number, down: boolean): void {
    const code = `Mouse${button}`;
    if (down) this.state.keyDown(code);
    else this.state.keyUp(code);
  }
  injectMouseMove(dx: number, dy: number): void {
    if (this.keyboardOnly) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
    this.frameMouseDX += dx;
    this.frameMouseDY += dy;
  }
}
