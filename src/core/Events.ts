import type { MissionStats } from "../mission/Scoring";
import type { EventBus } from "./EventBus";

export type GameEventBus = EventBus<GameEvents>;

export interface GameEvents {
  "enemy-killed": { type: string; pos: { x: number; y: number; z: number }; byFire: boolean };
  "building-destroyed": { tag: string; pos: { x: number; y: number; z: number } };
  "relic-found": { relicId: string };
  "loot-collected": { kind: string; value: number };
  "coins-changed": { total: number; delta: number };
  "player-damaged": { amount: number; dirX: number; dirZ: number; source: string };
  "objective-updated": { description: string; progress: number; need: number; completed: boolean; hint?: string };
  "mission-complete": { victory: boolean; stats: MissionStats };
  "dragon-death-start": { pos: { x: number; y: number; z: number } };
  "ground-mode-start": { pos: { x: number; y: number; z: number } };
  "super-ready": Record<string, never>;
  "super-used": Record<string, never>;
  "tutorial-advanced": { step: string };
  "bounds-warning": { distance: number };
  "hit-enemy": { killed: boolean };
  "melee-hit-rider": { amount: number };
  sfx: { name: string };
  "thunder": Record<string, never>;
}
