import type { AbstractEngine, Scene } from "@babylonjs/core";
import type { GameSettings } from "../save/SaveSystem";

export type QualityTier = 0 | 1 | 2 | 3; // 0 = best, 3 = most reduced

export interface GovernorStats {
  avgFps: number;
  avgFrameMs: number;
  tier: QualityTier;
  hardwareScaling: number;
  particleScale: number;
  shadowsEnabled: boolean;
}

/**
 * Dynamic quality manager. Measures frame time and steps quality tiers
 * gradually (never abruptly) in both directions.
 */
export class PerformanceGovernor {
  private frameTimes: number[] = [];
  private lastChange = 0;
  private cooldownMs = 4000;
  tier: QualityTier = 0;
  enabled = true;

  particleScale = 1;
  shadowsEnabled = true;
  private baseParticleScale = 1;

  constructor(
    private engine: AbstractEngine,
    private settings: GameSettings
  ) {
    this.applyPreset(settings.graphicsPreset);
  }

  applyPreset(preset: GameSettings["graphicsPreset"]): void {
    this.settings.graphicsPreset = preset;
    this.enabled = preset === "auto";
    switch (preset) {
      case "low":
        this.setTier(3, false);
        break;
      case "medium":
        this.setTier(2, false);
        break;
      case "high":
        this.setTier(0, false);
        break;
      case "auto":
        this.setTier(1, false); // start slightly conservative, governor adjusts
        break;
    }
  }

  private setTier(tier: QualityTier, animate = true): void {
    this.tier = tier;
    this.baseParticleScale = [1, 0.85, 0.6, 0.38][tier];
    this.shadowsEnabled = tier < 2;
    const scaling = [1, 1, 1.25, 1.5][tier];
    this.engine.setHardwareScalingLevel(scaling);
    if (!animate) this.cooldown();
  }

  private cooldown(): void {
    this.lastChange = performance.now();
    this.cooldownMs = 4000;
  }

  /** Called once per frame with dt in ms. */
  update(frameMs: number): void {
    if (!this.enabled) {
      this.frameTimes.length = 0;
      return;
    }
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.particleScale = this.baseParticleScale;

    const now = performance.now();
    if (this.frameTimes.length < 90 || now - this.lastChange < this.cooldownMs) return;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)];
    const median = sorted[Math.floor(sorted.length * 0.5)];

    // downgrade if 5th percentile is bad (sustained stutter), median bad, or both
    const wantDown = (p5 > 40 && median > 20) || median > 33;
    const wantUp = p5 < 22 && median < 15;

    if (wantDown && this.tier < 3) {
      this.setTier((this.tier + 1) as QualityTier);
      this.cooldown();
      this.frameTimes.length = 0;
    } else if (wantUp && this.tier > 0) {
      this.setTier((this.tier - 1) as QualityTier);
      this.cooldownMs = 6000; // slower to upgrade — avoid oscillation
      this.frameTimes.length = 0;
    }
  }

  stats(): GovernorStats {
    const n = this.frameTimes.length;
    const avg = n ? this.frameTimes.reduce((a, b) => a + b, 0) / n : 0;
    return {
      avgFps: avg > 0 ? 1000 / avg : 0,
      avgFrameMs: avg,
      tier: this.tier,
      hardwareScaling: this.engine.getHardwareScalingLevel(),
      particleScale: this.particleScale,
      shadowsEnabled: this.shadowsEnabled,
    };
  }
}

export function configureSceneQuality(scene: Scene, shadows: boolean): void {
  // reserved for finer scene-level tweaks driven by governor tier
  void scene;
  void shadows;
}
