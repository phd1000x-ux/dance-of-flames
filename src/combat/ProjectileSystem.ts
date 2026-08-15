import { Mesh, MeshBuilder, Scene, StandardMaterial, Color3, Vector3, type AbstractMesh } from "@babylonjs/core";
import type { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import type { Terrain } from "../world/Terrain";
import type { EffectsLibrary } from "../world/EffectsLibrary";

interface Projectile {
  active: boolean;
  kind: "arrow" | "bolt" | "spear";
  pos: Vector3;
  vel: Vector3;
  damage: number;
  life: number;
  mesh: AbstractMesh;
  whistled: boolean;
  owner: "enemy";
}

/**
 * Pooled projectile system (enemy arrows, ballista bolts, thrown spears).
 * Custom arcade collision — no physics engine needed.
 */
export class ProjectileSystem {
  private pool: Projectile[] = [];
  private arrowTpl: Mesh;
  private boltTpl: Mesh;

  /** set by mission scene: current player collision targets */
  dragonPos: Vector3 | null = null;
  dragonRadius = 4;
  dragonBackOffset = new Vector3(0, 0, 0);
  dragonForward = new Vector3(0, 0, 1);
  riderPos: Vector3 | null = null;
  playerMode: "dragon" | "ground" = "dragon";
  invulnerable = false;
  onPlayerHit: ((damage: number, sourceX: number, sourceZ: number, kind: string) => void) | null = null;

  constructor(
    private scene: Scene,
    private terrain: Terrain,
    private effects: EffectsLibrary,
    private bus: EventBus<GameEvents>
  ) {
    this.arrowTpl = MeshBuilder.CreateBox("arrowTpl", { width: 0.05, height: 0.05, depth: 1.1 }, scene);
    const arrowMat = new StandardMaterial("arrowMat", scene);
    arrowMat.diffuseColor = new Color3(0.45, 0.3, 0.15);
    arrowMat.emissiveColor = new Color3(0.1, 0.06, 0.02);
    this.arrowTpl.material = arrowMat;
    this.arrowTpl.isVisible = false;
    this.arrowTpl.isPickable = false;

    this.boltTpl = MeshBuilder.CreateBox("boltTpl", { width: 0.2, height: 0.2, depth: 2.4 }, scene);
    const boltMat = new StandardMaterial("boltMat", scene);
    boltMat.diffuseColor = new Color3(0.2, 0.2, 0.22);
    boltMat.emissiveColor = new Color3(0.25, 0.1, 0.02);
    this.boltTpl.material = boltMat;
    this.boltTpl.isVisible = false;
    this.boltTpl.isPickable = false;

    for (let i = 0; i < 90; i++) {
      const isBolt = i >= 78;
      const tpl = isBolt ? this.boltTpl : this.arrowTpl;
      const mesh = tpl.createInstance(`proj${i}`);
      mesh.isVisible = false;
      mesh.isPickable = false;
      this.pool.push({
        active: false,
        kind: isBolt ? "bolt" : "arrow",
        pos: new Vector3(),
        vel: new Vector3(),
        damage: 0,
        life: 0,
        mesh,
        whistled: false,
        owner: "enemy",
      });
    }
  }

  spawn(kind: "arrow" | "bolt" | "spear", origin: Vector3, dir: Vector3, speed: number, damage: number, spread = 0): void {
    const p = this.pool.find((x) => !x.active && (kind === "bolt" ? x.kind === "bolt" : x.kind !== "bolt"));
    if (!p) return;
    const d = dir.clone().normalize();
    if (spread > 0) {
      d.x += (Math.random() - 0.5) * spread;
      d.y += (Math.random() - 0.5) * spread * 0.6;
      d.z += (Math.random() - 0.5) * spread;
      d.normalize();
    }
    p.active = true;
    p.pos.copyFrom(origin);
    p.vel.copyFrom(d.scale(speed));
    p.damage = damage;
    p.life = kind === "bolt" ? 5 : 4;
    p.whistled = false;
    p.mesh.isVisible = true;
    p.mesh.position.copyFrom(origin);
  }

  activeCount(): number {
    return this.pool.filter((p) => p.active).length;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      p.vel.y -= 9.8 * dt;
      p.pos.addInPlace(p.vel.scale(dt));
      p.mesh.position.copyFrom(p.pos);
      // orient along velocity
      if (p.vel.lengthSquared() > 0.001) {
        const dir = Vector3.Normalize(p.vel);
        p.mesh.rotation.set(Math.asin(-dir.y), Math.atan2(dir.x, dir.z), 0);
      }
      if (p.life <= 0) {
        this.kill(p);
        continue;
      }
      // terrain hit
      if (p.pos.y < this.terrain.heightAt(p.pos.x, p.pos.z)) {
        if (p.kind === "bolt") {
          this.effects.explosion(p.pos, 1.1, [0.8, 0.4, 0.2]);
          this.bus.emit("sfx", { name: "explosion" });
        }
        this.kill(p);
        continue;
      }
      // player collision
      if (this.playerMode === "dragon" && this.dragonPos) {
        // two-sphere capsule approximation along dragon body
        const r = this.dragonRadius;
        const c1 = this.dragonPos;
        const c2 = this.dragonPos.subtract(this.dragonForward.scale(3.2 * (r / 4)));
        if (this.distToSegment(p.pos, c1, c2) < r) {
          if (!this.invulnerable) {
            this.onPlayerHit?.(p.damage, p.vel.x, p.vel.z, p.kind);
            if (p.kind === "bolt") {
              this.effects.explosion(p.pos, 1.4, [1, 0.5, 0.2]);
            }
            this.bus.emit("sfx", { name: "arrowHit" });
            this.kill(p);
            continue;
          }
        } else if (!p.whistled && Vector3.Distance(p.pos, this.dragonPos) < 9 + r) {
          p.whistled = true;
          if (p.kind === "arrow") this.bus.emit("sfx", { name: "arrowWhistle" });
        }
      } else if (this.playerMode === "ground" && this.riderPos) {
        const riderCenter = this.riderPos.add(new Vector3(0, 1.1, 0));
        if (Vector3.Distance(p.pos, riderCenter) < 1.0) {
          if (!this.invulnerable) {
            this.onPlayerHit?.(p.damage, p.vel.x, p.vel.z, p.kind);
            this.bus.emit("sfx", { name: "arrowHit" });
            this.kill(p);
            continue;
          }
        }
      }
    }
  }

  private kill(p: Projectile): void {
    p.active = false;
    p.mesh.isVisible = false;
  }

  private distToSegment(p: Vector3, a: Vector3, b: Vector3): number {
    const ab = b.subtract(a);
    const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / ab.lengthSquared()));
    const closest = a.add(ab.scale(t));
    return Vector3.Distance(p, closest);
  }

  dispose(): void {
    for (const p of this.pool) p.mesh.dispose();
    this.arrowTpl.dispose();
    this.boltTpl.dispose();
    void this.scene;
  }
}
