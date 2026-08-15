import {
  Color4,
  DynamicTexture,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  Mesh,
  MeshBuilder,
  Color3,
} from "@babylonjs/core";
import { SeededRng } from "../core/SeededRng";

/** Shared procedural textures + particle effect factories (pooled, GPU-cheap). */
export class EffectsLibrary {
  private glowTex: Texture | null = null;
  private smokeTex: Texture | null = null;
  private rng = new SeededRng(4242);
  particleBudget = 1; // scaled by PerformanceGovernor

  constructor(private scene: Scene) {}

  radialTexture(name: string, inner: string, outer: string): Texture {
    const size = 128;
    const dt = new DynamicTexture(name, { width: size, height: size }, this.scene, false);
    const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.4, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    dt.update();
    dt.hasAlpha = true;
    return dt;
  }

  glow(): Texture {
    if (!this.glowTex) {
      this.glowTex = this.radialTexture("glowTex", "rgba(255,255,255,1)", "rgba(255,255,255,0)");
    }
    return this.glowTex;
  }

  smoke(): Texture {
    if (!this.smokeTex) {
      this.smokeTex = this.radialTexture("smokeTex", "rgba(180,180,180,0.9)", "rgba(120,120,120,0)");
    }
    return this.smokeTex;
  }

  private applyBudget(ps: ParticleSystem): void {
    // capacity is fixed at construction; scaling happens through emitRate multipliers
    void ps;
  }

  /** Dragon fire breath stream. Emitter is a Vector3 updated per frame by FireSystem. */
  createFireStream(name: string, fireColor: string): ParticleSystem {
    const ps = new ParticleSystem(name, 900, this.scene);
    ps.particleTexture = this.glow();
    ps.emitter = new Vector3(0, 0, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.minSize = 1.2;
    ps.maxSize = 3.2;
    ps.minLifeTime = 0.18;
    ps.maxLifeTime = 0.4;
    ps.emitRate = 0; // controlled by FireSystem
    ps.gravity = new Vector3(0, 2.2, 0);
    ps.direction1 = new Vector3(-0.2, -0.1, 0.8);
    ps.direction2 = new Vector3(0.2, 0.1, 1.2);
    ps.minEmitPower = 26;
    ps.maxEmitPower = 42;
    const c = Color3.FromHexString(fireColor);
    ps.color1 = new Color4(1, 0.95, 0.6, 1);
    ps.color2 = new Color4(c.r, c.g * 0.7, c.b * 0.4, 1);
    ps.colorDead = new Color4(0.45, 0.1, 0.02, 0);
    ps.updateSpeed = 0.016;
    this.applyBudget(ps);
    return ps;
  }

  createEmbers(name: string): ParticleSystem {
    const ps = new ParticleSystem(name, 260, this.scene);
    ps.particleTexture = this.glow();
    ps.emitter = new Vector3(0, 0, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.minSize = 0.12;
    ps.maxSize = 0.4;
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.4;
    ps.emitRate = 0;
    ps.gravity = new Vector3(0, -3.5, 0);
    ps.direction1 = new Vector3(-1.5, 0.5, 0.3);
    ps.direction2 = new Vector3(1.5, 2, 1.5);
    ps.minEmitPower = 4;
    ps.maxEmitPower = 14;
    ps.color1 = new Color4(1, 0.7, 0.2, 1);
    ps.color2 = new Color4(1, 0.4, 0.05, 1);
    ps.colorDead = new Color4(0.3, 0.05, 0, 0);
    this.applyBudget(ps);
    return ps;
  }

  createSmokeColumn(name: string): ParticleSystem {
    const ps = new ParticleSystem(name, 220, this.scene);
    ps.particleTexture = this.smoke();
    ps.emitter = new Vector3(0, 0, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minSize = 2.5;
    ps.maxSize = 8;
    ps.minLifeTime = 1.6;
    ps.maxLifeTime = 3.2;
    ps.emitRate = 0;
    ps.gravity = new Vector3(0, 2.4, 0);
    ps.direction1 = new Vector3(-0.7, 1.4, -0.7);
    ps.direction2 = new Vector3(0.7, 2.6, 0.7);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 3;
    ps.color1 = new Color4(0.14, 0.12, 0.11, 0.5);
    ps.color2 = new Color4(0.2, 0.18, 0.16, 0.42);
    ps.colorDead = new Color4(0.25, 0.24, 0.23, 0);
    this.applyBudget(ps);
    return ps;
  }

  private burstPool: { ps: ParticleSystem; until: number }[] = [];

  /** One-shot explosion burst at world position (pooled). */
  explosion(pos: Vector3, scale = 1, color: [number, number, number] = [1, 0.55, 0.15]): void {
    let entry = this.burstPool.find((b) => performance.now() > b.until);
    if (!entry && this.burstPool.length < 6) {
      const ps = new ParticleSystem(`burst${this.burstPool.length}`, 240, this.scene);
      ps.particleTexture = this.glow();
      ps.emitter = new Vector3(0, 0, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.manualEmitCount = 0;
      ps.minSize = 0.7 * scale;
      ps.maxSize = 3.4 * scale;
      ps.minLifeTime = 0.25;
      ps.maxLifeTime = 0.85;
      ps.gravity = new Vector3(0, -4, 0);
      ps.direction1 = new Vector3(-1, -0.3, -1).scaleInPlace(9 * scale);
      ps.direction2 = new Vector3(1, 1.4, 1).scaleInPlace(9 * scale);
      ps.minEmitPower = 0.6;
      ps.maxEmitPower = 1;
      ps.color1 = new Color4(1, 0.9, 0.4, 1);
      ps.color2 = new Color4(color[0], color[1], color[2], 1);
      ps.colorDead = new Color4(0.25, 0.06, 0.01, 0);
      this.applyBudget(ps);
      entry = { ps, until: 0 };
      this.burstPool.push(entry);
    }
    if (entry) {
      (entry.ps.emitter as Vector3).copyFrom(pos);
      entry.ps.manualEmitCount = Math.floor(70 * this.particleBudget * scale);
      entry.until = performance.now() + 1200;
    }
  }

  /** Dust cloud for building collapse. */
  dust(pos: Vector3, scale = 1): void {
    const ps = new ParticleSystem("dust", 160, this.scene);
    ps.particleTexture = this.smoke();
    ps.emitter = pos.clone();
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.manualEmitCount = Math.floor(90 * this.particleBudget * scale);
    ps.minSize = 2 * scale;
    ps.maxSize = 9 * scale;
    ps.minLifeTime = 1.2;
    ps.maxLifeTime = 2.8;
    ps.gravity = new Vector3(0, 1.2, 0);
    ps.direction1 = new Vector3(-1, 0.1, -1).scaleInPlace(7 * scale);
    ps.direction2 = new Vector3(1, 0.9, 1).scaleInPlace(7 * scale);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1;
    ps.color1 = new Color4(0.42, 0.38, 0.32, 0.55);
    ps.color2 = new Color4(0.3, 0.27, 0.23, 0.45);
    ps.colorDead = new Color4(0.35, 0.33, 0.3, 0);
    ps.disposeOnStop = true;
    ps.stop();
    ps.start();
    setTimeout(() => ps.stop(), 80);
  }

  /** Rain that follows the camera (Harrenhal). */
  createRain(followTarget: () => Vector3): ParticleSystem {
    const ps = new ParticleSystem("rain", 900, this.scene);
    ps.particleTexture = this.smoke();
    ps.emitter = new Vector3(0, 0, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minSize = 0.06;
    ps.maxSize = 0.1;
    ps.minLifeTime = 1.1;
    ps.maxLifeTime = 1.3;
    ps.emitRate = 800;
    ps.gravity = new Vector3(-2, -55, 0);
    ps.direction1 = new Vector3(0, -1, 0);
    ps.direction2 = new Vector3(0, -1, 0);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 1;
    ps.minInitialRotation = -0.35;
    ps.maxInitialRotation = -0.3;
    ps.color1 = new Color4(0.7, 0.78, 0.85, 0.4);
    ps.color2 = new Color4(0.6, 0.7, 0.8, 0.35);
    ps.colorDead = new Color4(0.5, 0.6, 0.7, 0);
    this.scene.onBeforeRenderObservable.add(() => {
      const t = followTarget();
      (ps.emitter as Vector3).set(t.x, t.y + 30, t.z);
      ps.maxEmitBox = new Vector3(40, 0, 40);
      ps.minEmitBox = new Vector3(-40, 0, -40);
    });
    this.applyBudget(ps);
    return ps;
  }
}

/** Small glowing pickup visuals helpers. */
export function makeCoinTemplate(scene: Scene): Mesh {
  const coin = MeshBuilder.CreateCylinder("coinTpl", { diameter: 0.55, height: 0.09, tessellation: 12 }, scene);
  const mat = new StandardMaterial("coinMat", scene);
  mat.diffuseColor = new Color3(0.95, 0.75, 0.25);
  mat.emissiveColor = new Color3(0.5, 0.36, 0.08);
  mat.specularColor = new Color3(1, 0.9, 0.6);
  coin.material = mat;
  coin.isVisible = false;
  coin.isPickable = false;
  return coin;
}

export function makeHealTemplate(scene: Scene): Mesh {
  const body = MeshBuilder.CreateSphere("healTpl", { diameter: 0.5, segments: 6 }, scene);
  const neck = MeshBuilder.CreateCylinder("healNeck", { diameter: 0.16, height: 0.22, tessellation: 6 }, scene);
  neck.position.y = 0.3;
  const merged = Mesh.MergeMeshes([body, neck], true, true, undefined, false, false)!;
  const mat = new StandardMaterial("healMat", scene);
  mat.diffuseColor = new Color3(0.75, 0.12, 0.12);
  mat.emissiveColor = new Color3(0.4, 0.04, 0.04);
  mat.specularColor = new Color3(0.8, 0.6, 0.6);
  merged.material = mat;
  merged.isVisible = false;
  merged.isPickable = false;
  return merged;
}

export function makeBuffTemplate(scene: Scene): Mesh {
  const m = MeshBuilder.CreatePolyhedron("buffTpl", { type: 1, size: 0.32 }, scene);
  const mat = new StandardMaterial("buffMat", scene);
  mat.diffuseColor = new Color3(0.9, 0.5, 0.1);
  mat.emissiveColor = new Color3(0.55, 0.25, 0.02);
  m.material = mat;
  m.isVisible = false;
  m.isPickable = false;
  return m;
}
