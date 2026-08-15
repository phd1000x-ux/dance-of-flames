import { InstancedMesh, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { makeBuffTemplate, makeCoinTemplate, makeHealTemplate } from "./EffectsLibrary";
import { SeededRng } from "../core/SeededRng";
import { coinValue, rollLoot } from "../loot/LootTables";
import type { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import { clamp, damp } from "../core/MathUtils";

export interface LootEntity {
  kind: "coin" | "healSmall" | "healLarge" | "buff";
  value: number;
  pos: Vector3;
  mesh: InstancedMesh;
  life: number;
  collected: boolean;
  spin: number;
  magnetized: boolean;
}

/** Battlefield loot: coins w/ magnetic attraction, healing flasks, rare buffs. Instant use. */
export class LootSystem {
  entities: LootEntity[] = [];
  onCollect: ((e: LootEntity) => void) | null = null;
  private coinTpl: Mesh;
  private healTpl: Mesh;
  private buffTpl: Mesh;
  private rng: SeededRng;

  constructor(
    private scene: Scene,
    private bus: EventBus<GameEvents>,
    seed: number
  ) {
    this.rng = new SeededRng(seed + 777);
    this.coinTpl = makeCoinTemplate(scene);
    this.healTpl = makeHealTemplate(scene);
    this.buffTpl = makeBuffTemplate(scene);
    void scene;
  }

  /** death loot roll (section 32 probabilities, difficulty-scaled healing) */
  rollDeathLoot(pos: Vector3, healMod: number, coinMod = 1): void {
    const roll = rollLoot(this.rng, { healMod, coinMod });
    if (roll.kind === "none") return;
    if (roll.kind === "coin") {
      this.spawn("coin", coinValue(this.rng), pos);
    } else if (roll.kind === "healSmall") {
      this.spawn("healSmall", 0.2, pos);
    } else if (roll.kind === "healLarge") {
      this.spawn("healLarge", 0.35, pos);
    } else {
      this.spawn("buff", 1, pos);
    }
  }

  spawn(kind: LootEntity["kind"], value: number, pos: Vector3): void {
    if (this.entities.length > 220) {
      // recycle oldest
      const old = this.entities.shift();
      old?.mesh.dispose();
    }
    const tpl = kind === "coin" ? this.coinTpl : kind === "buff" ? this.buffTpl : this.healTpl;
    const mesh = tpl.createInstance(`loot${this.entities.length}`);
    mesh.position.set(pos.x + this.rng.range(-0.8, 0.8), pos.y + 0.6, pos.z + this.rng.range(-0.8, 0.8));
    mesh.rotation.set(Math.PI / 2.4, 0, this.rng.range(0, 3));
    mesh.isPickable = false;
    this.entities.push({
      kind,
      value,
      pos: mesh.position.clone(),
      mesh: mesh as InstancedMesh,
      life: 45,
      collected: false,
      spin: this.rng.range(0, Math.PI * 2),
      magnetized: false,
    });
  }

  /** @param attractRadius generous for airborne dragon (magnet), tight for rider */
  update(dt: number, attractPos: Vector3, attractRadius: number, collectRadius: number): void {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.life -= dt;
      e.spin += dt * 4;
      if (e.life <= 0) {
        e.mesh.dispose();
        this.entities.splice(i, 1);
        continue;
      }
      const d = Vector3.Distance(e.pos, attractPos);
      if (d < attractRadius) {
        e.magnetized = true;
      }
      if (e.magnetized) {
        // accelerate toward player
        const dir = attractPos.subtract(e.pos);
        const pull = clamp(30 / Math.max(1.5, d), 2, 20) * dt * 10;
        e.pos.addInPlace(dir.scale(Math.min(1, pull / Math.max(0.01, dir.length())) * 18 * dt * 3));
        e.mesh.position.copyFrom(e.pos);
      } else {
        // bob
        e.mesh.position.y = e.pos.y + Math.sin(e.spin) * 0.15 + 0.5;
      }
      e.mesh.rotation.y = e.spin;
      if (e.kind === "coin") e.mesh.rotation.z = e.spin * 1.5;

      if (d < collectRadius) {
        e.collected = true;
        this.onCollect?.(e);
        this.bus.emit("loot-collected", { kind: e.kind, value: e.value });
        e.mesh.dispose();
        this.entities.splice(i, 1);
      }
    }
  }

  disposeAll(): void {
    for (const e of this.entities) e.mesh.dispose();
    this.entities = [];
  }

  dispose(): void {
    this.disposeAll();
    this.coinTpl.dispose();
    this.healTpl.dispose();
    this.buffTpl.dispose();
  }
}
