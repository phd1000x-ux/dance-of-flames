import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { TerrainHeightSampler } from "./Terrain";
import type { SeededRng } from "../core/SeededRng";

export function tierFor(dist: number): 0 | 1 | 2 {
  if (dist < 120) return 0;
  if (dist < 300) return 1;
  return 2;
}

export function shouldLookUp(dragonPos: { x: number; y: number; z: number }, pairPos: { x: number; z: number }, alt: number): boolean {
  if (alt > 40) return false;
  const dx = dragonPos.x - pairPos.x;
  const dz = dragonPos.z - pairPos.z;
  return dx * dx + dz * dz < 60 * 60;
}

export function pairPhase(t: number, seed: number): { swayA: number; swayB: number; lunge: number } {
  const p = t * 2.2 + seed * 1.7;
  return {
    swayA: Math.sin(p),
    swayB: Math.sin(p + Math.PI * 0.9),
    lunge: Math.sin(p * 0.5 + seed),
  };
}

interface Pair {
  root: TransformNode;
  a: { body: TransformNode; arm: Mesh };
  b: { body: TransformNode; arm: Mesh };
  seed: number;
  tier: 0 | 1 | 2;
  lookUp: boolean;
  animT: number;
  updateBudget: number;
  deathAt: number;
  fallen: boolean;
}

/** Visual-only battlefield: paired duelists animating a fight loop. No damage/AI/collision. */
export class AmbientBattle {
  private pairs: Pair[] = [];
  private matA: StandardMaterial;
  private matB: StandardMaterial;

  constructor(private scene: Scene, private terrain: TerrainHeightSampler, private rng: SeededRng) {
    this.matA = new StandardMaterial("amb-faction-a", scene);
    this.matA.diffuseColor = new Color3(0.3, 0.26, 0.2);
    this.matB = new StandardMaterial("amb-faction-b", scene);
    this.matB.diffuseColor = new Color3(0.2, 0.23, 0.28);
  }

  spawn(anchors: { x: number; z: number; r: number; pairs: number }[]): void {
    for (const an of anchors) {
      for (let i = 0; i < an.pairs; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const rr = this.rng.range(an.r * 0.2, an.r);
        const x = an.x + Math.cos(a) * rr;
        const z = an.z + Math.sin(a) * rr;
        this.pairs.push(this.makePair(x, z, this.rng.range(0, Math.PI * 2)));
      }
    }
  }

  private makePair(x: number, z: number, yaw: number): Pair {
    const root = new TransformNode(`ambpair-${this.pairs.length}`, this.scene);
    root.position.set(x, this.terrain.height(x, z), z);
    root.rotation.y = yaw;
    const mk = (mat: StandardMaterial, offX: number) => {
      const body = new TransformNode(`ambfig`, this.scene);
      body.parent = root;
      body.position.set(offX, 0, 0);
      const parts: Mesh[] = [];
      const torso = MeshBuilder.CreateCapsule("amb-t", { height: 1.7, radius: 0.3, tessellation: 6 }, this.scene);
      torso.position.y = 1.0;
      parts.push(torso);
      const head = MeshBuilder.CreateSphere("amb-h", { diameter: 0.42, segments: 4 }, this.scene);
      head.position.y = 2.0;
      parts.push(head);
      const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
      merged.material = mat;
      merged.parent = body;
      merged.isPickable = false;
      const arm = MeshBuilder.CreateBox("amb-arm", { width: 0.12, height: 0.9, depth: 0.12 }, this.scene);
      arm.material = mat;
      arm.parent = body;
      arm.position.set(0.1, 1.35, 0.3);
      arm.isPickable = false;
      return { body, arm };
    };
    return {
      root,
      a: mk(this.matA, -0.9),
      b: mk(this.matB, 0.9),
      seed: this.rng.range(0, 100),
      tier: 2,
      lookUp: false,
      animT: this.rng.range(0, 10),
      updateBudget: 0,
      deathAt: this.rng.range(20, 40),
      fallen: false,
    };
  }

  update(dt: number, cameraPos: Vector3, dragonPos: Vector3, dragonAlt: number): void {
    for (const p of this.pairs) {
      const dx = p.root.position.x - cameraPos.x;
      const dz = p.root.position.z - cameraPos.z;
      p.tier = tierFor(Math.hypot(dx, dz));
      p.updateBudget -= dt;
      if (p.tier === 2) continue;
      const step = p.tier === 0 ? dt : 0;
      if (p.tier === 1 && p.updateBudget > 0) continue;
      if (p.tier === 1) p.updateBudget = 0.1;
      const d = step || 0.1;
      p.animT += d;
      p.deathAt -= d;
      if (p.deathAt <= 0 && !p.fallen) {
        p.fallen = true;
        p.b.body.rotation.x = Math.PI / 2;
        p.b.body.position.y = 0.4;
      }
      if (p.deathAt <= -6) {
        p.fallen = false;
        p.b.body.rotation.x = 0;
        p.b.body.position.y = 0;
        p.deathAt = this.rng.range(20, 40);
      }
      p.lookUp = shouldLookUp(dragonPos, p.root.position, dragonAlt);
      const ph = pairPhase(p.animT, p.seed);
      if (p.lookUp) {
        p.a.body.rotation.x = -0.55;
        p.b.body.rotation.x = p.fallen ? Math.PI / 2 : -0.55;
      } else {
        p.a.body.rotation.x = ph.swayA * 0.12;
        p.a.body.rotation.z = ph.swayA * 0.1;
        p.b.body.rotation.x = p.fallen ? Math.PI / 2 : ph.swayB * 0.12;
        p.b.body.rotation.z = ph.swayB * 0.1;
        p.a.body.position.z = ph.lunge * 0.35;
        p.b.body.position.z = -ph.lunge * 0.35;
        p.a.arm.rotation.x = Math.max(0, ph.swayA) * -1.4;
        p.b.arm.rotation.x = p.fallen ? 0 : Math.max(0, ph.swayB) * -1.4;
      }
    }
  }

  pairCount(): number {
    return this.pairs.length;
  }

  tierHistogram(): number[] {
    const h = [0, 0, 0];
    for (const p of this.pairs) h[p.tier]++;
    return h;
  }

  dispose(): void {
    for (const p of this.pairs) p.root.dispose(false, true);
    this.pairs = [];
    this.matA.dispose();
    this.matB.dispose();
  }
}
