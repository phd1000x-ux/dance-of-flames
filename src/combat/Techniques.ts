/**
 * Shop "techniques": upgrades that reward a way of flying, not a flat stat.
 * Each one pays off a link of the core loop — dive → dodge → strafe → climb.
 * Pure (unit tested); MissionScene applies them.
 */
import { STREAK_WINDOW, streakBonus } from "./FireStreak";

export interface TechniqueLevels {
  /** Stooping Strike — fire burns hotter during a fast dive */
  diveFury: number;
  /** Ember Chain — longer INFERNO window and richer streak payouts */
  emberChain: number;
  /** Close Call — a bolt that narrowly misses refuels fire and super */
  closeCall: number;
}

export const NO_TECHNIQUES: TechniqueLevels = { diveFury: 0, emberChain: 0, closeCall: 0 };

/** pitch > 0 is nose-down (DragonController convention) */
export const DIVE_PITCH = 0.35;
export const DIVE_SPEED_FRACTION = 0.9;
export const DIVE_FURY_PER_LEVEL = 0.25;

export function isStooping(pitch: number, speed: number, maxSpeed: number): boolean {
  return pitch > DIVE_PITCH && speed >= maxSpeed * DIVE_SPEED_FRACTION;
}

/** fire dps multiplier for the current flight state */
export function diveFuryMult(level: number, pitch: number, speed: number, maxSpeed: number): number {
  if (level <= 0 || !isStooping(pitch, speed, maxSpeed)) return 1;
  return 1 + DIVE_FURY_PER_LEVEL * level;
}

export function emberChainWindow(level: number): number {
  return STREAK_WINDOW + 0.5 * Math.max(0, level);
}

export function emberChainBonus(count: number, level: number): number {
  return Math.round(streakBonus(count) * (1 + 0.5 * Math.max(0, level)));
}

/** bolt passed within this distance (m, beyond hull radius) without hitting */
export const CLOSE_CALL_MARGIN = 7;

export function closeCallReward(level: number): { fireFraction: number; super: number } {
  if (level <= 0) return { fireFraction: 0, super: 0 };
  return { fireFraction: 0.3 * level, super: 10 * level };
}
