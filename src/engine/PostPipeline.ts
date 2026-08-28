import {
  Color4,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  Scene,
} from "@babylonjs/core";
import type { QualityTier } from "./PerformanceGovernor";

export interface PostConfig {
  fxaa: boolean;
  imageProcessing: boolean;
  toneMapping: boolean;
  vignette: boolean;
}

/** Tier → post-processing config. Tier 2/3 (upscaled) keep only cheap FXAA. */
export function postConfigForTier(tier: QualityTier, enabled: boolean): PostConfig {
  if (!enabled) return { fxaa: false, imageProcessing: false, toneMapping: false, vignette: false };
  const full = tier <= 1;
  return { fxaa: true, imageProcessing: full, toneMapping: full, vignette: full };
}

/**
 * Per-scene post-processing: FXAA always (engine MSAA already on, but governor
 * tiers 2/3 render upscaled where FXAA recovers edges), mild image processing
 * at good tiers. One pipeline per scene; dispose() with the owner.
 */
export class PostPipeline {
  readonly pipeline: DefaultRenderingPipeline;
  private enabled: boolean;

  constructor(scene: Scene, cfg: PostConfig) {
    this.enabled = cfg.fxaa || cfg.imageProcessing;
    this.pipeline = new DefaultRenderingPipeline("postfx", true, scene, scene.cameras);
    this.pipeline.samples = 1; // MSAA handled by engine backbuffer; post chain stays cheap
    this.apply(cfg);
  }

  apply(cfg: PostConfig): void {
    const p = this.pipeline;
    const ip = p.imageProcessing;
    p.fxaaEnabled = cfg.fxaa;
    p.imageProcessingEnabled = cfg.imageProcessing;
    ip.contrast = 1.06;
    ip.exposure = 1.0;
    ip.toneMappingEnabled = cfg.toneMapping;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.vignetteEnabled = cfg.vignette;
    ip.vignetteWeight = 1.5;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  }

  /** runtime governor tier change — no-op safe when pipeline disabled */
  applyTier(tier: QualityTier): void {
    this.apply(postConfigForTier(tier, this.enabled));
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}
