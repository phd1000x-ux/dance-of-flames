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
  | "dodge"
  | "interact"
  | "super"
  | "objectives"
  | "pause"
  | "debug"
  | "lightAttack"
  | "heavyAttack"
  | "block"
  | "jump" // shared with dodge on ground
  | "sprint"
  | "lockOn";

export const DEFAULT_BINDINGS: Record<GameAction, string[]> = {
  accelerate: ["KeyW"],
  decelerate: ["KeyS"],
  turnLeft: ["KeyA"],
  turnRight: ["KeyD"],
  climb: ["Space"],
  descend: ["ControlLeft", "KeyC"],
  boost: ["ShiftLeft", "ShiftRight"],
  fire: ["Mouse0"],
  focus: ["Mouse2"],
  dodge: ["KeyQ"],
  interact: ["KeyE"],
  super: ["KeyR"],
  objectives: ["Tab"],
  pause: ["Escape"],
  debug: ["F3"],
  lightAttack: ["Mouse0"],
  heavyAttack: ["KeyQ"],
  block: ["Mouse2"],
  jump: ["Space"],
  sprint: ["ShiftLeft", "ShiftRight"],
  lockOn: ["KeyF"],
};

/** Accumulates mouse deltas (works with or without pointer lock). */
export class InputManager {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  pointerLocked = false;
  /** test/E2E mode: synthetic input injection without real devices */
  testMode = false;
  sensitivity = 1;
  invertY = false;

  private keyDownHandler = (e: KeyboardEvent) => {
    if (e.code === "Tab" || e.code === "F3") e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressedThisFrame.add(e.code);
  };
  private keyUpHandler = (e: KeyboardEvent) => {
    this.down.delete(e.code);
    this.releasedThisFrame.add(e.code);
  };
  private mouseDownHandler = (e: MouseEvent) => {
    const code = `Mouse${e.button}`;
    this.down.add(code);
    this.pressedThisFrame.add(code);
  };
  private mouseUpHandler = (e: MouseEvent) => {
    const code = `Mouse${e.button}`;
    this.down.delete(code);
    this.releasedThisFrame.add(code);
  };
  private mouseMoveHandler = (e: MouseEvent) => {
    if (this.pointerLocked || this.testMode || e.buttons !== 0 || this.freeMouse) {
      this.mouseDX += e.movementX ?? 0;
      this.mouseDY += e.movementY ?? 0;
    }
  };
  private wheelHandler = (e: WheelEvent) => {
    this.wheel += e.deltaY;
  };
  private blurHandler = () => {
    this.down.clear();
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

  constructor(private canvas: HTMLCanvasElement, private target: HTMLElement = window as any) {
    window.addEventListener("keydown", this.keyDownHandler);
    window.addEventListener("keyup", this.keyUpHandler);
    window.addEventListener("mousedown", this.mouseDownHandler);
    window.addEventListener("mouseup", this.mouseUpHandler);
    window.addEventListener("mousemove", this.mouseMoveHandler);
    window.addEventListener("mousemove", this.rawMoveHandler);
    window.addEventListener("wheel", this.wheelHandler, { passive: true });
    window.addEventListener("blur", this.blurHandler);
    document.addEventListener("pointerlockchange", this.pointerLockChange);
  }

  requestPointerLock(): void {
    if (this.testMode || this.pointerLocked) return;
    this.canvas.requestPointerLock?.();
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(action: GameAction): boolean {
    for (const code of DEFAULT_BINDINGS[action]) {
      if (this.down.has(code)) return true;
    }
    return false;
  }

  isDownCode(code: string): boolean {
    return this.down.has(code);
  }

  pressed(action: GameAction): boolean {
    for (const code of DEFAULT_BINDINGS[action]) {
      if (this.pressedThisFrame.has(code)) return true;
    }
    return false;
  }

  pressedCode(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** consume mouse delta (applies sensitivity & invert-Y), returns radians-ish units */
  consumeMouse(): { dx: number; dy: number } {
    const dx = (this.mouseDX / 900) * this.sensitivity;
    const dy = (this.mouseDY / 900) * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.wheel = 0;
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
    document.removeEventListener("pointerlockchange", this.pointerLockChange);
  }

  // ---- test injection API ----
  injectKeyDown(code: string): void {
    this.down.add(code);
    this.pressedThisFrame.add(code);
  }
  injectKeyUp(code: string): void {
    this.down.delete(code);
    this.releasedThisFrame.add(code);
  }
  injectMouse(button: number, down: boolean): void {
    const code = `Mouse${button}`;
    if (down) {
      this.down.add(code);
      this.pressedThisFrame.add(code);
    } else {
      this.down.delete(code);
      this.releasedThisFrame.add(code);
    }
  }
  injectMouseMove(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }
}
