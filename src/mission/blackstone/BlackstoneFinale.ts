import { Vector3 } from "@babylonjs/core";
import type { MissionScene, MissionSceneDeps } from "../MissionScene";
import type { GameEventBus } from "../../core/Events";
import { PhaseMachine, type FinalePhase } from "./FinalePhases";
import { CastellanBoss } from "./CastellanBoss";
import { WarDragon } from "./WarDragon";
import { SpireBreaker } from "./SpireBreaker";
import { RETURN_HP, assaultBand, assaultProfile, bandChanged, type AssaultBand } from "./FinalePatterns";

const STAGE_BUDGET: Partial<Record<FinalePhase, number>> = {
  TRANSITION: 7,
  REVEAL: 9,
  MOUNT: 6,
  REMOUNT: 8,
  RETURN: 12,
  FINAL_STAGGER: 30,
  FINAL_CRASH: 8,
};

/** staged-finale thresholds (fractions of vharax maxHp) */
const STAGGER_HP = 0.1;
/** horizontal distance (m) to the spire within which FINAL_STAGGER may begin */
const SPIRE_ZONE = 80;
/** wall-clock seconds in RETURN before the boss hard-steers toward the spire */
const RETURN_HARD_STEER_S = 12;

export class BlackstoneFinale {
  readonly phases = new PhaseMachine();
  private castellan: CastellanBoss | null = null;
  private vharax: WarDragon | null = null;
  private stageStartedAt = 0;
  private stageT = 0;
  private shortCircuited = false;
  private courtyardDone = false;
  private chaseLoopNeeded = 1;
  private breaker: SpireBreaker | null = null;
  private staggerHintShown = false;
  private hardSteering = false;
  // final assault (bs-final survive window)
  private assaultOn = false;
  private assaultBand: AssaultBand | null = null;
  private assaultPollT = 0;

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

    // dragon died mid-finale → resolve silently (tracker splices event objectives);
    // AWAIT_LANDING included — a crash-landing dying dragon must not trigger the dismount
    if ((m.phase === "dragonDying") && !this.phases.isTerminal() && this.phases.current !== "INACTIVE") {
      this.vharax?.flee();
      this.phases.transition("RESOLVED");
    }

    this.updateFinalAssault(dt);

    switch (this.phases.current) {
      case "INACTIVE": {
        const cur = m.tracker.current();
        if (cur?.id === "bs-castellan") {
          this.courtyardDone = true;
        }
        if (this.courtyardDone) {
          const claimed = this.mission.enemies.claimCommander();
          if (!claimed) {
            if (!this.shortCircuited) this.shortCircuit();
            return;
          }
          this.castellan = new CastellanBoss(claimed, m.enemies, m.projectiles, this.deps.bus);
          this.phases.transition("AWAIT_LANDING");
          this.deps.bus.emit("hud-hint", { text: "LAND IN THE COURTYARD — FACE THE CASTELLAN" });
        }
        break;
      }
      case "AWAIT_LANDING": {
        const c = m.dragonCtrl;
        const alt = c.pos.y - m.world.terrain.heightAt(c.pos.x, c.pos.z);
        if (m.phase === "dragon" && alt < 4 && c.speed < 12) {
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
          this.deps.bus.emit("finale-boss", { show: true, name: "THE CASTELLAN", hpFrac: this.castellan.hpFrac });
          if (this.castellan.duel.transitioned) {
            this.mission.tracker.notifyEvent("castellan-transition");
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
        if (!this.vharax) {
          this.phases.transition("RESOLVED");
          this.deps.bus.emit("finale-boss", { show: false });
          break;
        }
        const v = this.vharax!;
        this.updateVharax(dt);
        // defensive un-strand: a fled/gone Vharax can never finish the loop —
        // chase-complete is a legal edge, so resolve rather than dead-ending the chain
        if (v.state === "FLEEING" || v.state === "GONE") {
          this.mission.tracker.notifyEvent("chase-complete");
          this.setStage("RESOLVED");
          break;
        }
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
        if (!this.vharax) {
          this.phases.transition("RESOLVED");
          this.deps.bus.emit("finale-boss", { show: false });
          break;
        }
        this.updateVharax(dt);
        const v = this.vharax!;
        this.deps.bus.emit("finale-boss", { show: true, name: "VHARAX — WAR DRAGON OF BLACKSTONE", hpFrac: Math.max(0, (v.hp - v.floor) / (v.maxHp - v.floor)) });
        // staged finale: at 25% he breaks off and returns to the citadel
        // (primary trigger is the WarDragon.onHpFloor callback; this poll is the
        // fallback for a floor crossed while still in CHASE)
        if (v.hp <= v.maxHp * RETURN_HP) this.enterReturn();
        break;
      }
      case "RETURN": {
        if (!this.vharax) {
          this.phases.transition("RESOLVED");
          this.deps.bus.emit("finale-boss", { show: false });
          break;
        }
        const v = this.vharax!;
        this.updateVharax(dt);
        this.deps.bus.emit("finale-boss", { show: true, name: "VHARAX — WAR DRAGON OF BLACKSTONE", hpFrac: Math.max(0, (v.hp - v.floor) / (v.maxHp - v.floor)) });
        if (v.hp > v.maxHp * STAGGER_HP) break;
        const spire = this.mission.worldLayout.spireCrownTop;
        if (!spire || Math.hypot(v.pos.x - spire.x, v.pos.z - spire.z) < SPIRE_ZONE) {
          this.prepStagger();
          this.setStage("FINAL_STAGGER");
          break;
        }
        // at the floor but out of zone: past 12 s wall-clock, hard-steer toward
        // the spire waypoint (teleport-free, reuses the chase machinery at ~40 m/s)
        if (!this.hardSteering && this.stageRealSeconds() > RETURN_HARD_STEER_S) {
          this.hardSteering = true;
          v.startChase(v.pos);
          v.chasePathIndex = 1; // CHASE_PATH[1] — the spire
        }
        break;
      }
      case "FINAL_STAGGER": {
        if (!this.vharax) {
          this.phases.transition("RESOLVED");
          this.deps.bus.emit("finale-boss", { show: false });
          break;
        }
        // wounded death-spiral at the spire top — the finishing blow routes
        // through applyFire (→ beginCrashSequence); the stage budget force-begins
        this.updateVharax(dt);
        const v = this.vharax!;
        this.deps.bus.emit("finale-boss", { show: true, name: "VHARAX — WAR DRAGON OF BLACKSTONE", hpFrac: Math.max(0, (v.hp - v.floor) / (v.maxHp - v.floor)) });
        break;
      }
      case "FINAL_CRASH": {
        const breaker = this.breaker;
        if (!breaker || breaker.update(dt)) {
          this.breaker = null;
          this.resolveVharaxEvents();
          this.setStage("RESOLVED");
        }
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

  /**
   * Final assault driver — runs while bs-final (survive the counterattack) is the
   * current objective. Long war horn once at assault start, profile refresh +
   * short horn stab on each escalation band. Band polling uses the objective's
   * own progress (sim seconds survived) so a checkpoint-restored assault resumes
   * at the right intensity. Stands down when the objective completes or converts.
   */
  private updateFinalAssault(dt: number): void {
    const m = this.mission;
    const cur = m.tracker.current();
    if (!this.assaultOn) {
      if (cur?.id === "bs-final" && cur.type === "survive") {
        this.assaultOn = true;
        this.assaultPollT = 0;
        this.assaultBand = assaultBand(cur.progress, cur.seconds ?? 75);
        m.enemies.setAssault(true, assaultProfile(this.assaultBand));
        this.deps.bus.emit("sfx", { name: "warHorn" });
      }
      return;
    }
    if (!cur || cur.id !== "bs-final") {
      this.assaultOn = false;
      m.enemies.setAssault(false);
      return;
    }
    this.assaultPollT += dt;
    if (this.assaultPollT < 1) return; // poll band once per sim second
    this.assaultPollT = 0;
    if (bandChanged(this.assaultBand, cur.progress, cur.seconds ?? 75)) {
      this.assaultBand = assaultBand(cur.progress, cur.seconds ?? 75);
      m.enemies.setAssault(true, assaultProfile(this.assaultBand));
      this.deps.bus.emit("sfx", { name: "warHornShort" });
    }
  }

  applyFire(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): void {    const hit = this.vharax?.applyFire(origin, dir, range, halfAngle, dps, dt) ?? false;
    // the finishing blow: first fire hit in FINAL_STAGGER begins the crash choreography
    if (hit && this.phases.current === "FINAL_STAGGER" && this.beginCrashSequence()) {
      this.setStage("FINAL_CRASH");
    }
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
      DUEL_AIR: "RETURN",
      RETURN: "FINAL_STAGGER",
      FINAL_STAGGER: "FINAL_CRASH",
      FINAL_CRASH: "RESOLVED",
    };
    let to = next[cur];
    if (!to) return false;
    // perform mandatory side effects so skipped states are consistent
    switch (cur) {
      case "AWAIT_LANDING":
        this.forceLand();
        this.mission.scriptedDismount(this.mission.dragonCtrl.pos.add(new Vector3(3, 0, 3)));
        break;
      case "TRANSITION":
        this.revealVharax();
        break;
      case "REMOUNT":
        this.mission.remountDragon();
        this.vharax?.startChase(new Vector3(0, 75, -95));
        break;
      case "CHASE":
        this.vharax?.startDuel();
        this.mission.tracker.notifyEvent("chase-complete");
        break;
      case "DUEL_AIR": {
        const v = this.vharax;
        if (v) {
          v.hp = Math.min(v.hp, v.maxHp * RETURN_HP);
          v.startReturn();
        }
        break;
      }
      case "RETURN": {
        const v = this.vharax;
        if (v) v.hp = Math.min(v.hp, v.maxHp * STAGGER_HP);
        this.prepStagger();
        break;
      }
      case "FINAL_STAGGER":
        // breaker-optional: no crown (checkpoint-restore path) → straight to RESOLVED
        if (!this.beginCrashSequence()) {
          this.resolveVharaxEvents();
          to = "RESOLVED";
        }
        break;
      case "FINAL_CRASH":
        this.breaker?.finish();
        this.resolveVharaxEvents();
        break;
    }
    return this.phases.transition(to);
  }

  private revealVharax(): void {
    if (!this.vharax) {
      this.vharax = new WarDragon(this.mission.scene, this.mission.effects, this.deps.bus);
      this.vharax.onSweepHitPlayer = (dps, dt) => {
        const died = this.mission.player.damageDragon(dps * dt);
        if (died) this.mission.beginDragonDeathPublic();
      };
      this.vharax.onHpFloor = () => {
        // 0.25×max crossed while dueling → he breaks off toward the citadel
        if (this.phases.current === "DUEL_AIR") this.enterReturn();
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

  private enterReturn(): void {
    const v = this.vharax;
    if (!v || !this.setStage("RETURN")) return;
    v.startReturn();
    this.deps.bus.emit("finale-subtitle", { text: "HE RETURNS TO THE CITADEL", ms: 2500 });
  }

  /** FINAL_STAGGER entry side effects (organic + forced) — no transition inside */
  private prepStagger(): void {
    const top = this.mission.worldLayout.spireCrownTop;
    if (top) this.vharax?.startStagger(top);
    if (!this.staggerHintShown) {
      this.staggerHintShown = true;
      this.deps.bus.emit("hud-hint", { text: "FINISH THE CASTELLAN" });
    }
  }

  /** begins the authored crash choreography + slow-mo; false when the spire crown is unavailable */
  private beginCrashSequence(): boolean {
    const crown = this.mission.worldLayout.spireCrownMesh;
    const top = this.mission.worldLayout.spireCrownTop;
    const v = this.vharax;
    if (!crown || !top || !v) return false;
    // crown center sits 9 m above the base top (18 m tall cone)
    const spireBaseTop = new Vector3(top.x, top.y - 9, top.z);
    this.breaker = new SpireBreaker(this.mission.effects, this.deps.bus, (s) => this.mission.dragonCam.addShake(s));
    this.breaker.begin(crown, spireBaseTop, v.rig.root);
    this.mission.slowmoT = Math.max(this.mission.slowmoT, 1.0);
    return true;
  }

  private resolveVharaxEvents(): void {
    this.mission.tracker.notifyEvent("vharax-resolved");
    this.deps.bus.emit("finale-boss", { show: false });
    this.deps.bus.emit("finale-music", { state: "resolve" });
  }

  private shortCircuit(): void {
    this.shortCircuited = true;
    const t = this.mission.tracker;
    t.notifyEvent("castellan-transition");
    t.notifyEvent("chase-complete");
    t.notifyEvent("vharax-resolved");
    this.vharax?.flee();
    this.deps.bus.emit("finale-music", { state: "resolve" });
    this.phases.transition("RESOLVED");
    this.deps.bus.emit("finale-boss", { show: false });
  }

  private setStage(p: FinalePhase): boolean {
    if (!this.phases.transition(p)) return false;
    this.stageT = 0;
    this.stageStartedAt = performance.now();
    return true;
  }

  private stageRealSeconds(): number {
    return (performance.now() - this.stageStartedAt) / 1000;
  }
}

const CHASE_LOOPS = 1;
