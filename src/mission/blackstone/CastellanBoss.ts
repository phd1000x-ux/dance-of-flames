import { Color3, Vector3 } from "@babylonjs/core";
import type { GameEventBus } from "../../core/Events";
import type { EnemyManager, Soldier } from "../../ai/EnemyManager";
import { ballisticDir } from "../../ai/EnemyManager";
import type { ProjectileSystem } from "../../combat/ProjectileSystem";
import { CastellanDuel, selectCastellanPattern, type CastellanPattern } from "./CastellanDuel";

/** Ground-boss puppet layer driving the claimed commander soldier. */
export class CastellanBoss {
  readonly duel: CastellanDuel;
  private pattern: CastellanPattern | null = null;
  private patternT = 0;
  private swingIndex = 0;
  private swingStruck = false;
  private playerPos = new Vector3();

  constructor(private s: Soldier, private enemies: EnemyManager, private projectiles: ProjectileSystem, private bus: GameEventBus) {
    this.duel = new CastellanDuel(s.maxHp);
  }

  get alive(): boolean {
    return this.s.state !== "dead";
  }

  get hp(): number {
    return this.s.hp;
  }

  get transitioned(): boolean {
    return this.duel.transitioned;
  }

  /** checkpoint restore: force the one-shot transition state without the duel */
  markTransitioned(): void {
    this.duel.markTransitioned();
  }

  get hpFrac(): number {
    return this.s.maxHp > 0 ? this.s.hp / this.s.maxHp : 0;
  }

  setHp(n: number): void {
    this.s.hp = Math.max(1, Math.min(this.s.maxHp, n));
    if (n > this.duel.floor) this.duel.restoreHp(this.s.hp);
  }

  update(dt: number, playerPos: Vector3, playerMode: "dragon" | "ground"): void {
    void playerMode;
    const s = this.s;
    if (s.state === "dead") return;
    // invariant: applyFireDamage can ignite the puppeted commander — never play the generic burning-frenzy AI
    if (s.state === "burning") {
      s.state = "alert";
      s.burnTime = 0;
    }
    this.playerPos.copyFrom(playerPos);
    // clamp: any damage source that dipped the puppet below the floor
    if (!this.duel.transitioned && s.hp <= this.duel.floor) {
      s.hp = this.duel.floor;
      this.duel.markTransitioned();
    } else if (s.hp < this.duel.floor) {
      s.hp = this.duel.floor;
    }
    const dist = Vector3.Distance(s.pos, playerPos);
    // face the player
    const want = Math.atan2(playerPos.x - s.pos.x, playerPos.z - s.pos.z);
    let dy = want - s.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    s.yaw += dy * Math.min(1, dt * 6);

    if (!this.pattern) {
      if (s.cooldown > 0) {
        s.cooldown -= dt;
        return;
      }
      this.pattern = selectCastellanPattern(Math.random, dist, null, this.duel.shouldReinforce());
      this.patternT = 0;
      this.swingIndex = 0;
      this.swingStruck = false;
      if (this.pattern === "reinforce") this.doReinforce();
      return;
    }
    this.patternT += dt;
    switch (this.pattern) {
      case "combo":
        this.runMeleeSwing(0.55 + this.swingIndex * 0.15, 22 + this.swingIndex * 8, dist, false);
        break;
      case "shieldBreaker":
        this.runMeleeSwing(0.9, 40, dist, true);
        break;
      case "javelin":
        this.runJavelin();
        break;
      case "reinforce":
        this.pattern = null; // handled instantly
        return;
    }
    if (this.patternT > 2.4) {
      this.pattern = null;
      s.cooldown = 0.8;
      s.material.emissiveColor.copyFrom(s.baseEmissive);
    }
  }

  private runMeleeSwing(windup: number, dmg: number, dist: number, unblockable: boolean): void {
    const s = this.s;
    const telegraph = unblockable ? new Color3(0.85, 0.45, 0.05) : new Color3(0.7, 0.1, 0.05);
    if (this.patternT < windup) {
      s.material.emissiveColor = telegraph; // animation + visual telegraph channels
      s.state = "meleeWindup";
      return;
    }
    if (!this.swingStruck) {
      this.swingStruck = true;
      this.swingIndex++;
      if (dist < s.def.range + 1.4) {
        const from = Vector3.Normalize(this.playerPos.subtract(s.pos));
        this.enemies.onMeleeHitRider?.(dmg, from.x, from.z);
        this.bus.emit("sfx", { name: "swordSwing" });
      }
      if (this.pattern === "combo" && this.swingIndex < 3) {
        this.patternT = 0; // next swing of the combo — longer windup, heavier hit
        this.swingStruck = false;
      }
    }
  }

  private runJavelin(): void {
    const s = this.s;
    if (this.patternT < 0.7) {
      s.material.emissiveColor = new Color3(0.6, 0.5, 0.1);
      s.state = "aim";
      return;
    }
    if (this.swingIndex === 0) {
      this.swingIndex = 1;
      const origin = s.pos.add(new Vector3(0, 1.9, 0));
      const dir = ballisticDir(origin, this.playerPos.add(new Vector3(0, 1, 0)), 28);
      if (dir) this.projectiles.spawn("spear", origin, dir, 28, 26, 0.05);
      this.bus.emit("sfx", { name: "ballistaFire" });
    }
  }

  private doReinforce(): void {
    this.duel.reinforceFired = true;
    const base = this.s.pos;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const p = new Vector3(base.x + Math.cos(a) * 10, base.y, base.z + Math.sin(a) * 10);
      const s = this.enemies.spawnSoldier("swordsman", p);
      s.state = "alert";
    }
    this.bus.emit("sfx", { name: "roar" });
    this.pattern = null;
    this.s.cooldown = 1.2;
  }
}
