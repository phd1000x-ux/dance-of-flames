export enum GameState {
  BOOT = "BOOT",
  MENU = "MENU",
  CHARACTER_SELECT = "CHARACTER_SELECT",
  MISSION_SELECT = "MISSION_SELECT",
  LOADING = "LOADING",
  DRAGON_GAMEPLAY = "DRAGON_GAMEPLAY",
  DRAGON_DEATH = "DRAGON_DEATH",
  GROUND_GAMEPLAY = "GROUND_GAMEPLAY",
  VICTORY = "VICTORY",
  DEFEAT = "DEFEAT",
  PAUSED = "PAUSED",
  SHOP = "SHOP",
  CREDITS = "CREDITS",
}

/** Explicit top-level state machine — no scattered booleans. */
export class StateMachine {
  private current: GameState = GameState.BOOT;
  private previous: GameState = GameState.BOOT;
  private listeners = new Map<GameState, Set<() => void>>();

  get state(): GameState {
    return this.current;
  }

  get prevState(): GameState {
    return this.previous;
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.current);
  }

  /** gameplay = dragon or ground sim running */
  get inGameplay(): boolean {
    return (
      this.current === GameState.DRAGON_GAMEPLAY ||
      this.current === GameState.DRAGON_DEATH ||
      this.current === GameState.GROUND_GAMEPLAY
    );
  }

  transition(to: GameState): boolean {
    if (to === this.current) return false;
    this.previous = this.current;
    this.current = to;
    const set = this.listeners.get(to);
    if (set) for (const cb of set) cb();
    return true;
  }

  onEnter(state: GameState, cb: () => void): void {
    if (!this.listeners.has(state)) this.listeners.set(state, new Set());
    this.listeners.get(state)!.add(cb);
  }
}
