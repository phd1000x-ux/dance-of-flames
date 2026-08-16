import { Vector3 } from "@babylonjs/core";
import type { MissionScene, MissionSceneDeps } from "../MissionScene";
import type { GameEventBus } from "../../core/Events";
import { PhaseMachine, type FinalePhase } from "./FinalePhases";
import { CastellanBoss } from "./CastellanBoss";
import { WarDragon } from "./WarDragon";

const STAGE_BUDGET: Partial<Record<FinalePhase, number>> = {
  TRANSITION: 7,
  REVEAL: 9,
  MOUNT: 6,
  REMOUNT: 8,
};

export class BlackstoneFinale {
  readonly phases = new PhaseMachine();
  private castellan: CastellanBoss | null = null;
  private vharax: WarDragon | null = null;
  private stageStartedAt = 0;
  private stageT = 0;
  private shortCircuited = false;
  private courtyardDone = false;
  private chaseLoopNeeded = 1;

  constructor(private mission: MissionScene, private deps: MissionSceneDeps) {}

  get phase(): FinalePhase {
    return this.phases.current;
  }

  get warDragon(): WarDragon | null {
    return this.vharax;
  }

  update(dt: number): void {
    const m = this.mission;
    this.stageT += dt;

    // castellan death short-circuit — any time, any chain position
    if (!this.shortCircuited && this.castellan && !this.castellan.alive) {
      this.shortCircuit();
    }

    // dragon died mid-finale → resolve silently (tracker splices event objectives)
    if ((m.phase === "dragonDying") && !this.phases.isTerminal() && this.phases.current !== "INACTIVE" && this.phases.current !== "AWAIT_LANDING") {
      this.vharax?.flee();
      this.phases.transition("RESOLVED");
    }

    switch (this.phases.current) {
      case "INACTIVE": {
        const cur = m.tracker.current();
        if (cur?.id === "bs-castellan") {
          this.courtyardDone = true;
        }
        if (this.courtyardDone) {
          this.castellan = new CastellanBoss(this.claimCastellan(), m.enemies, m.projectiles, this.deps.bus);
          this.phases.transition("AWAIT_LANDING");
          this.deps.bus.emit("hud-hint", { text: "LAND IN THE COURTYARD — FACE THE CASTELLAN" });
        }
        break;
      }
      case "AWAIT_LANDING": {
        const c = m.dragonCtrl;
        const alt = c.pos.y - m.world.terrain.heightAt(c.pos.x, c.pos.z);
        if (alt < 4 && c.speed < 12) {
          const spawn = c.pos.add(new Vector3(Math.sin(c.yaw + Math.PI / 2) * 6, 0, Math.cos(c.yaw + Math.PI / 2) * 6));
          m.scriptedDismount(spawn);
          this.setStage("DUEL_GROUND");
          this.deps.bus.emit("finale-music", { state: "boss" });
          this.deps.bus.emit("finale-boss", { show: true, name: "THE CASTELLAN", hpFrac: 1 });
        }
        break;
      }
      case "DUEL_GROUND": {
        if (this.castellan && m.riderCtrl) {
          this.castellan.update(dt, m.riderCtrl.pos, "ground");
          this.deps.bus.emit("finale-boss", { show: true, name: "THE CASTELLAN", hpFrac: this.castellan.duel.hp / this.castellan.duel.maxHp });
          if (this.castellan.duel.transitioned) {
            this.setStage("TRANSITION");
            this.mission.slowmoT = Math.max(this.mission.slowmoT, 0.5);
            this.deps.bus.emit("finale-subtitle", { text: "You came here riding a dragon.", ms: 2600 });
          }
        }
        break;
      }
      case "TRANSITION": {
        if (this.stageT > 2.8) {
          this.deps.bus.emit("finale-subtitle", { text: "Did you think you were the only one?", ms: 3000 });
          this.setStage("REVEAL");
          this.revealVharax();
        }
        break;
      }
      case "REVEAL": {
        if (this.stageT > 4.5) {
          this.setStage("MOUNT");
        }
        break;
      }
      case "MOUNT": {
        if (this.stageT > 2.8) {
          this.setStage("REMOUNT");
        }
        break;
      }
      case "REMOUNT": {
        if (this.stageT > 1.2 && m.phase === "ground") {
          m.remountDragon();
          this.vharax?.startChase(new Vector3(0, 75, -95));
          this.chaseLoopNeeded = CHASE_LOOPS;
          this.setStage("CHASE");
          this.deps.bus.emit("finale-music", { state: "chase" });
          this.deps.bus.emit("finale-subtitle", { text: "PURSUE THE CASTELLAN", ms: 2400 });
        }
        break;
      }
      case "CHASE": {
        const v = this.vharax!;
        this.updateVharax(dt);
        if (v.chasePathIndex === 0 && this.stageT > 4) {
          this.chaseLoopNeeded--;
          if (this.chaseLoopNeeded <= 0) {
            v.startDuel();
            this.setStage("DUEL_AIR");
            this.deps.bus.emit("finale-music", { state: "boss" });
            this.deps.bus.emit("finale-boss", { show: true, name: "VHARAX — WAR DRAGON OF BLACKSTONE", hpFrac: 1 });
            this.mission.tracker.notifyEvent("chase-complete");
          }
        }
        break;
      }
      case "DUEL_AIR": {
        this.updateVharax(dt);
        const v = this.vharax!;
        this.deps.bus.emit("finale-boss", { show: true, name: "VHARAX — WAR DRAGON OF BLACKSTONE", hpFrac: Math.max(0, (v.hp - v.floor) / (v.maxHp - v.floor)) });
        break;
      }
      case "RESOLVED": {
        this.deps.bus.emit("finale-boss", { show: false });
        break;
      }
    }

    // wall-clock bound per staged phase (slow-pipeline safety)
    const budget = STAGE_BUDGET[this.phases.current];
    if (budget !== undefined && this.stageRealSeconds() > budget * 1.8) {
      this.forceAdvance();
    }
  }

  applyFire(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): void {
    this.vharax?.applyFire(origin, dir, range, halfAngle, dps, dt);
  }

  setCastellanHp(n: number): void {
    this.castellan?.setHp(n);
  }

  damageWarDragon(n: number): void {
    const v = this.vharax;
    if (!v) return;
    v.hp = Math.max(v.floor, v.hp - n);
  }

  forceLand(): void {
    if (this.phases.current !== "AWAIT_LANDING") return;
    const c = this.mission.dragonCtrl;
    c.pos.y = this.mission.world.terrain.heightAt(c.pos.x, c.pos.z) + 2;
    c.speed = 0;
  }

  skipTo(p: FinalePhase): boolean {
    if (this.phases.current === p) return true;
    while (this.phases.current !== p && !this.phases.isTerminal()) {
      if (!this.forceAdvance()) return false;
    }
    return this.phases.current === p;
  }

  private forceAdvance(): boolean {
    const cur = this.phases.current;
    const next: Partial<Record<FinalePhase, FinalePhase>> = {
      AWAIT_LANDING: "DUEL_GROUND",
      DUEL_GROUND: "TRANSITION",
      TRANSITION: "REVEAL",
      REVEAL: "MOUNT",
      MOUNT: "REMOUNT",
      REMOUNT: "CHASE",
      CHASE: "DUEL_AIR",
      DUEL_AIR: "RESOLVED",
    };
    const to = next[cur];
    if (!to) return false;
    // perform mandatory side effects so skipped states are consistent
    switch (cur) {
      case "AWAIT_LANDING":
        this.forceLand();
        this.mission.scriptedDismount(this.mission.dragonCtrl.pos.add(new Vector3(3, 0, 3)));
        break;
      case "REMOUNT":
        this.mission.remountDragon();
        this.vharax?.startChase(new Vector3(0, 75, -95));
        break;
      case "CHASE":
        this.vharax?.startDuel();
        this.mission.tracker.notifyEvent("chase-complete");
        break;
      case "DUEL_AIR":
        this.vharax?.flee();
        this.mission.tracker.notifyEvent("vharax-resolved");
        break;
    }
    return this.phases.transition(to);
  }

  private claimCastellan() {
    const c = this.mission.enemies.claimCommander();
    if (!c) throw new Error("[finale] blackstone mission has no commander to claim");
    return c;
  }

  private revealVharax(): void {
    if (!this.vharax) {
      this.vharax = new WarDragon(this.mission.scene, this.mission.effects, this.deps.bus);
      this.vharax.onSweepHitPlayer = (dps, dt) => {
        const died = this.mission.player.damageDragon(dps * dt);
        if (died) this.mission.beginDragonDeathPublic();
      };
      this.vharax.onResolved = () => {
        this.mission.tracker.notifyEvent("vharax-resolved");
        this.deps.bus.emit("finale-music", { state: "resolve" });
        this.deps.bus.emit("finale-boss", { show: false });
      };
    }
    this.vharax.startChase(new Vector3(0, 8, -120));
    this.deps.bus.emit("sfx", { name: "deepRoar" });
    this.mission.dragonCam.addShake(1.0);
  }

  private updateVharax(dt: number): void {
    const m = this.mission;
    this.vharax?.update(dt, m.dragonCtrl.pos, m.player.mode === "dragon", m.world.terrain.heightAt(this.vharax.pos.x, this.vharax.pos.z));
  }

  private shortCircuit(): void {
    this.shortCircuited = true;
    const t = this.mission.tracker;
    t.notifyEvent("castellan-transition");
    t.notifyEvent("chase-complete");
    t.notifyEvent("vharax-resolved");
    this.vharax?.flee();
    this.phases.transition("RESOLVED");
    this.deps.bus.emit("finale-boss", { show: false });
  }

  private setStage(p: FinalePhase): void {
    if (!this.phases.transition(p)) return;
    this.stageT = 0;
    this.stageStartedAt = performance.now();
  }

  private stageRealSeconds(): number {
    return (performance.now() - this.stageStartedAt) / 1000;
  }
}

const CHASE_LOOPS = 1;
