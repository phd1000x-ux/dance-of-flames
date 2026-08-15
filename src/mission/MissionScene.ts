import {
  Scene,
  Vector3,
  Color3,
  MeshBuilder,
  StandardMaterial,
  GlowLayer,
} from "@babylonjs/core";
import type { AbstractEngine } from "@babylonjs/core";
import type { MissionDefinition } from "../data/missions";
import type { RiderDefinition } from "../data/riders";
import type { DragonDefinition } from "../data/dragons";
import type { DifficultyDef } from "../data/difficulty";
import type { GameSettings } from "../save/SaveSystem";
import type { InputManager } from "../input/InputManager";
import type { AudioManager } from "../audio/AudioManager";
import { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import { SeededRng } from "../core/SeededRng";
import { WorldBuilder } from "../world/WorldBuilder";
import { EffectsLibrary } from "../world/EffectsLibrary";
import { DragonRig } from "../world/DragonRig";
import { SoldierFactory } from "../world/SoldierFactory";
import { PlayerState } from "../player/PlayerState";
import { DragonController } from "../player/DragonController";
import { RiderController } from "../player/RiderController";
import { DragonCamera, GroundCamera } from "../camera/GameCameras";
import { FireSystem } from "../combat/FireSystem";
import { ProjectileSystem } from "../combat/ProjectileSystem";
import { EnemyManager, type CombatContext, type Soldier } from "../ai/EnemyManager";
import { BuildingSystem } from "../world/BuildingSystem";
import { LootSystem } from "../world/LootSystem";
import { ObjectiveTracker } from "./Objectives";
import { emptyStats, type MissionStats } from "./Scoring";
import { getRelic } from "../data/items";
import { clamp } from "../core/MathUtils";

export interface MissionSceneDeps {
  engine: AbstractEngine;
  mission: MissionDefinition;
  difficulty: DifficultyDef;
  rider: RiderDefinition;
  dragon: DragonDefinition;
  shopMods: Record<string, number>;
  consumables: { heal: number; fireBoost: number; armorWard: number };
  settings: GameSettings;
  input: InputManager;
  audio: AudioManager;
  bus: EventBus<GameEvents>;
  onCoins: (delta: number) => void;
  onMissionEnd: (victory: boolean, stats: MissionStats) => void;
  particleScale: () => number;
}

export type MissionPhase = "dragon" | "dragonDying" | "ground" | "ended";

/**
 * Full mission runtime: world, player, AI, combat, loot, objectives,
 * dragon-death → ground conversion, tutorial, stats.
 */
export class MissionScene {
  readonly scene: Scene;
  readonly world: ReturnType<WorldBuilder["build"]>;
  readonly player: PlayerState;
  readonly rig: DragonRig;
  readonly dragonCtrl: DragonController;
  riderCtrl: RiderController | null = null;
  readonly dragonCam: DragonCamera;
  readonly groundCam: GroundCamera;
  readonly fire: FireSystem;
  readonly projectiles: ProjectileSystem;
  readonly enemies: EnemyManager;
  readonly buildings: BuildingSystem;
  readonly loot: LootSystem;
  readonly tracker: ObjectiveTracker;
  readonly stats: MissionStats = emptyStats();
  readonly rng: SeededRng;
  phase: MissionPhase = "dragon";
  time = 0;

  // tutorial
  tutorialStep = -1;
  private tutorialProgress = 0;
  private tutorialSteps = [
    { label: "[W] — Accelerate", key: "accelerate", need: 1.2 },
    { label: "[A / D] — Turn Dragon", key: "turn", need: 1.0 },
    { label: "[ARROW KEYS] — Aim", key: "look", need: 0.8 },
    { label: "[F] — Breathe Fire", key: "fire", need: 0.8 },
    { label: "[SHIFT] — Boost", key: "boost", need: 0.8 },
  ];

  // dragon target lock (X)
  lockTargetPos: Vector3 | null = null;
  lockTargetKind: string | null = null;
  private lockSoldier: Soldier | null = null;
  private lockBallista: import("../ai/EnemyManager").BallistaEntity | null = null;
  private lockBuilding: import("../world/BuildingSystem").BuildingEntity | null = null;
  objectivesOpen = false;

  private deathLandTimer = 0;
  private ended = false;
  private glow: GlowLayer;
  private shakeListener: ((pos: Vector3, strength: number) => void) | null = null;

  constructor(private deps: MissionSceneDeps) {
    const d = deps;
    this.scene = new Scene(d.engine);
    this.rng = new SeededRng(d.mission.seed + 17);

    const builder = new WorldBuilder(this.scene);
    this.world = builder.build(d.mission);

    this.player = new PlayerState(d.dragon, d.rider, d.shopMods);
    this.player.healCharges = d.consumables.heal;
    this.player.fireBoostCharges = d.consumables.fireBoost;
    this.player.armorWardCharges = d.consumables.armorWard;

    this.rig = new DragonRig(this.scene, d.dragon);
    for (const m of this.rig.root.getChildMeshes()) {
      this.world.shadows?.addShadowCaster(m);
    }
    this.dragonCtrl = new DragonController(this.player, this.rig, this.world.terrain, d.bus, 760);
    this.dragonCtrl.inputTurnScale = d.settings.keyboardTurnSpeed ?? 1;
    this.dragonCtrl.spawn(d.mission.id === "kingslanding"
      ? new Vector3(-80, 140, -420)
      : this.worldLayout.playerStart.clone(), this.worldLayout.playerStartYaw);
    if (d.mission.id === "kingslanding") {
      this.dragonCtrl.yaw = Math.PI * 0.02; // face the wall
    }

    const effects = new EffectsLibrary(this.scene);
    this.dragonCam = new DragonCamera(this.scene, d.settings, this.world.terrain);
    this.groundCam = new GroundCamera(this.scene, this.world.terrain);
    this.dragonCam.reset(this.dragonCtrl);

    this.fire = new FireSystem(this.scene, this.player, this.dragonCtrl, this.rig, effects, d.bus);
    this.projectiles = new ProjectileSystem(this.scene, this.world.terrain, effects, d.bus);

    this.enemies = new EnemyManager(this.scene, this.world.terrain, this.projectiles, d.bus, d.difficulty, d.mission.seed);
    this.enemies.spawnFromLayout(this.worldLayout);

    this.buildings = new BuildingSystem(this.scene, this.world.terrain, effects, d.bus, this.rng, this.world.shadows);
    this.buildings.spawnFromLayout(this.worldLayout);

    this.loot = new LootSystem(this.scene, d.bus, d.mission.seed);

    this.tracker = new ObjectiveTracker(d.mission.objectives);

    this.glow = new GlowLayer("glow", this.scene, { mainTextureSamples: 1 });
    this.glow.intensity = 0.55;

    if (d.mission.environment.rain) {
      effects.createRain(() => this.activeCamera().position);
    }

    this.wireSystems();
    this.wireEvents();

    if (d.mission.tutorial) {
      this.tutorialStep = 0;
    }
  }

  get worldLayout() {
    return this.world.layout;
  }

  private wireSystems(): void {
    const d = this.deps;
    // fire → damage
    this.fire.onFireHit = (origin, dir, range, halfAngle, dps, dt) => {
      this.enemies.applyFireDamage(origin, dir, range, halfAngle, dps, dt);
      this.buildings.applyFireDamage(origin, dir, range, halfAngle, dps, dt);
      // lifesteal relic
      if (this.player.lifesteal > 0) {
        this.player.healDragon(dps * dt * this.player.lifesteal * 0.01);
      }
    };
    this.fire.onBeamFire = (origin, dir) => {
      // super beam: massive damage in a long line
      this.enemies.applyFireDamage(origin, dir, 170, 0.22, 600, 1);
      this.buildings.applyFireDamage(origin, dir, 170, 0.28, 900, 1);
      this.dragonCam.addShake(0.5);
    };

    // enemies death → loot + score
    this.enemies.onSoldierDeath = (s, byFire) => {
      void byFire;
      this.loot.rollDeathLoot(s.pos, this.deps.difficulty.healDropRate);
    };
    this.enemies.onMeleeHitRider = (damage, fromX, fromZ) => {
      if (!this.riderCtrl) return;
      const from = new Vector3(fromX, 0, fromZ).normalize();
      const res = this.riderCtrl.takeHit(damage, from, "melee");
      if (res.applied > 0) {
        this.stats.damageTaken += res.applied;
        this.deps.bus.emit("player-damaged", { amount: res.applied, dirX: fromX, dirZ: fromZ, source: "melee" });
      }
      if (res.parried && this.riderCtrl.lockTarget) {
        // parry staggers nearby enemies (simplify: stagger target)
        for (const e of this.enemies.getGroundEnemies()) {
          if (Vector3.Distance(e.pos, this.riderCtrl.pos) < 6) e.staggered = 1.0;
        }
      }
    };

    // buildings
    this.buildings.onDestroyed = (b) => {
      this.stats.buildingsDestroyed++;
      this.player.addSuper(12);
      // building coin bonus
      for (let i = 0; i < 3; i++) {
        this.loot.spawn("coin", 2, b.pos.subtract(new Vector3(0, b.size.h / 2, 0)));
      }
      // objectives
      this.tracker.notifyBuildingDestroyed(b.tag);
      if (b.relicId) this.tracker.notifyBuildingDestroyed("relic-building");
      this.tracker.notifyBuildingDestroyed("any");
    };
    this.buildings.onRelicReveal = (b) => {
      if (b.relicId) {
        this.player.addRelic(b.relicId);
        this.stats.relicsFound++;
        this.player.addSuper(30);
        this.deps.bus.emit("relic-found", { relicId: b.relicId });
        this.deps.audio.relic();
      }
    };
    this.shakeListener = (pos, strength) => {
      const pp = this.playerPosition();
      const dist = Vector3.Distance(pp, pos);
      const shake = clamp(strength * (1 - dist / 120), 0, 1);
      if (shake > 0.02) this.dragonCam.addShake(shake);
    };
    this.buildings.onShakeRequest = this.shakeListener;

    // loot collection
    this.loot.onCollect = (e) => {
      if (e.kind === "coin") {
        this.stats.coinsCollected += e.value;
        this.deps.onCoins(e.value);
        this.deps.audio.coin();
      } else if (e.kind === "healSmall" || e.kind === "healLarge") {
        if (this.phase === "ground") {
          this.player.healRider(e.value);
        } else {
          this.player.healDragon(e.value);
        }
        this.deps.audio.heal();
      } else if (e.kind === "buff") {
        this.player.addBuff({
          id: `buff-${this.time}`,
          label: "Dragon Fury",
          stat: "fireDamage",
          mult: 1.5,
          remaining: 30,
        });
        this.player.fireBoostTimer = 30;
        this.deps.audio.heal();
      }
    };

    // rider melee wiring
    this.player.onRelicFound = (relicId) => {
      const relic = getRelic(relicId);
      void relic;
    };

    this.tracker.onObjectiveComplete((o) => {
      this.deps.audio.objective();
      this.emitObjective();
    });
  }

  private wireEvents(): void {
    const d = this.deps;
    d.bus.on("enemy-killed", (p) => {
      this.stats.kills++;
      this.player.addSuper(5);
      this.tracker.notifyKill(p.type);
    });
    d.bus.on("player-damaged", (p) => {
      this.stats.damageTaken += p.amount;
    });
  }

  private emitObjective(): void {
    const cur = this.tracker.current();
    if (!cur) {
      this.deps.bus.emit("objective-updated", {
        description: "All objectives complete",
        progress: 1,
        need: 1,
        completed: true,
      });
      return;
    }
    const need = cur.type === "survive" ? cur.seconds ?? 0 : cur.count ?? 1;
    this.deps.bus.emit("objective-updated", {
      description: cur.description,
      progress: cur.progress,
      need,
      completed: false,
      hint: cur.hint,
    });
  }

  activeCamera() {
    return this.phase === "ground" ? this.groundCam.camera : this.dragonCam.camera;
  }

  playerPosition(): Vector3 {
    if (this.phase === "ground" && this.riderCtrl) return this.riderCtrl.pos;
    return this.dragonCtrl.pos;
  }

  update(dt: number): void {
    if (this.ended) return;
    const d = this.deps;
    this.time += dt;
    this.stats.timeSeconds = this.time;

    // projectile collision targets
    this.projectiles.playerMode = this.phase === "ground" ? "ground" : "dragon";
    this.projectiles.dragonPos = this.dragonCtrl.pos;
    this.projectiles.dragonForward = this.dragonCtrl.forward;
    this.projectiles.dragonRadius = this.player.dragonDef.hitRadius * 0.92;
    this.projectiles.riderPos = this.riderCtrl ? this.riderCtrl.pos : null;
    this.projectiles.invulnerable = this.dragonCtrl.invulnerable > 0 || (this.riderCtrl?.invulnerable ?? 0) > 0;
    this.projectiles.onPlayerHit = (damage, sx, sz, kind) => {
      if (this.phase === "ground") return; // rider arrows handled via melee path
      const stagger = kind === "bolt" ? 0.7 : 0.12;
      const died = this.player.damageDragon(damage);
      d.bus.emit("player-damaged", { amount: damage, dirX: sx, dirZ: sz, source: kind });
      d.audio.playerHurt();
      this.dragonCam.addShake(kind === "bolt" ? 0.8 : 0.15);
      if (died) this.beginDragonDeath();
      else if (stagger > 0.4) this.dragonCtrl.enterStagger(stagger);
    };

    // player resource updates
    this.player.update(dt);

    // super charge passive + ready ping
    this.player.addSuper(dt * 1.2);
    if (this.player.superCharge >= 100 && this.player.superCooldown <= 0) {
      d.bus.emit("super-ready", {});
    }

    const ctx: CombatContext = {
      playerMode: this.phase === "ground" ? "ground" : "dragon",
      dragonPos: this.dragonCtrl.pos,
      dragonSpeed: this.dragonCtrl.speed,
      dragonForward: this.dragonCtrl.forward,
      dragonAltitude: this.dragonCtrl.pos.y - this.world.terrain.heightAt(this.dragonCtrl.pos.x, this.dragonCtrl.pos.z),
      riderPos: this.riderCtrl ? this.riderCtrl.pos : null,
      riderFwd: this.riderCtrl ? new Vector3(Math.sin(this.riderCtrl.yaw), 0, Math.cos(this.riderCtrl.yaw)) : null,
      riderInvulnerable: (this.riderCtrl?.invulnerable ?? 0) > 0,
      time: this.time,
    };

    if (this.phase === "dragon") {
      // target lock toggle (X) + validation
      this.updateDragonLock(d);
      // aim direction with soft assist / lock magnetism
      this.fire.aimDir = this.getFireAimDir();
      this.dragonCtrl.update(dt, d.input, d.input.isDown("fire") && this.player.fireEnergy.canFire());
      // Z recenter (level flight)
      if (d.input.pressed("recenterCamera")) this.dragonCtrl.startRecenter();
      // consumables (G)
      if (d.input.pressed("interact")) this.useConsumable();
      // super with not-ready feedback (R)
      if (d.input.pressed("super") && !(this.player.superCharge >= 100 && this.player.superCooldown <= 0)) {
        d.bus.emit("hud-hint", { text: "SUPER CHARGE NOT READY" });
      }
      this.fire.update(dt, d.input.isDown("fire"), d.input.pressed("super"), d.particleScale());
      // audio ambience by speed
      d.audio.setWind(clamp(this.dragonCtrl.speed / 60, 0.1, 1));
      d.audio.setFireLoop(this.fire.firing);
      // loot magnet toward dragon
      this.loot.update(dt, this.dragonCtrl.pos, 42, 10);
      this.stats.dragonSurvived = true;
    } else if (this.phase === "dragonDying") {
      this.clearLock();
      this.dragonCtrl.update(dt, d.input, false);
      this.fire.update(dt, false, false, d.particleScale());
      d.audio.setFireLoop(false);
      this.deathLandTimer += dt;
      if (this.dragonCtrl.landed || this.deathLandTimer > 4.2) {
        this.spawnRider();
      }
    } else if (this.phase === "ground" && this.riderCtrl) {
      const groundEnemies = this.enemies
        .getGroundEnemies()
        .map((s) => ({ pos: s.pos, yaw: s.yaw, hp: s.hp, alive: true, isShielded: s.def.role === "shield", staggered: s.staggered }));
      this.riderCtrl.update(dt, d.input, this.groundCam, groundEnemies);
      // Z recenter for ground camera
      if (d.input.pressed("recenterCamera")) this.groundCam.startRecenter();
      this.groundCam.update(dt, this.riderCtrl.pos, this.riderCtrl.yaw, d.input, d.settings, this.riderCtrl.lockTarget ? this.riderCtrl.lockTarget.pos : null);
      // rider melee hit callback wiring
      if (this.riderCtrl.onHitCallback === null) {
        this.riderCtrl.onHitCallback = (fwd, range, arc, dmg, heavy) => {
          const res = this.enemies.applyMeleeHit(this.riderCtrl!.pos, fwd, range, arc, dmg, heavy);
          if (res.hit) {
            d.audio.swordHit();
            d.bus.emit("hit-enemy", { killed: false });
          } else if (res.blocked) {
            d.audio.swordHit();
          }
        };
      }
      // interact: F (ground) or G
      if (d.input.pressed("interactGround") || d.input.pressed("interact")) this.useConsumable();
      d.audio.setWind(0.1);
      this.loot.update(dt, this.riderCtrl.pos, 5, 2.2);
      if (!this.riderCtrl.alive) {
        this.endMission(false);
        return;
      }
    }

    // Tab objectives overlay
    if (d.input.pressed("objectives")) {
      this.objectivesOpen = !this.objectivesOpen;
      d.bus.emit("toggle-objectives", { visible: this.objectivesOpen });
    }

    // world systems
    this.enemies.update(dt, ctx);
    this.buildings.update(dt);
    this.projectiles.update(dt);
    this.tracker.update(dt);

    // camera
    if (this.phase !== "ground") {
      this.dragonCam.update(dt, this.dragonCtrl, d.input, this.lockTargetPos);
    }

    // tutorial progression
    if (this.tutorialStep >= 0) this.updateTutorial(dt);

    // objective broadcast (throttled by HUD subscription — emit each frame is fine, HUD diffs)
    this.emitObjective();

    // victory check
    if (this.tracker.allCompleted()) {
      this.endMission(true);
    }
  }

  private useConsumable(): void {
    if (this.player.healCharges > 0) {
      this.player.healCharges--;
      if (this.phase === "ground") this.player.healRider(0.35);
      else this.player.healDragon(0.3);
      this.deps.audio.heal();
    } else if (this.player.fireBoostCharges > 0 && this.phase === "dragon") {
      this.player.fireBoostCharges--;
      this.player.fireBoostTimer = 25;
      this.deps.audio.superCharge();
    } else if (this.player.armorWardCharges > 0) {
      this.player.armorWardCharges--;
      this.player.addBuff({ id: `ward-${this.time}`, label: "Armor Ward", stat: "armor", mult: 1.4, remaining: 30 });
    }
  }

  private beginDragonDeath(): void {
    if (this.phase !== "dragon") return;
    this.phase = "dragonDying";
    this.stats.dragonSurvived = false;
    this.player.mode = "dying";
    this.deathLandTimer = 0;
    this.deps.audio.roar(true);
    this.deps.audio.setFireLoop(false);
    this.deps.bus.emit("dragon-death-start", {
      pos: { x: this.dragonCtrl.pos.x, y: this.dragonCtrl.pos.y, z: this.dragonCtrl.pos.z },
    });
    this.dragonCam.addShake(0.7);
  }

  private spawnRider(): void {
    this.phase = "ground";
    this.player.mode = "ground";
    this.rig.setRiderVisible(false);
    // crash effects
    const crashPos = this.dragonCtrl.pos;
    this.deps.audio.explosion();
    this.deps.audio.buildingCollapse();
    this.dragonCam.addShake(1.0);

    // find flat ground near crash site
    let spawn = crashPos.clone();
    for (let i = 0; i < 30; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(8, 34);
      const x = crashPos.x + Math.cos(a) * r;
      const z = crashPos.z + Math.sin(a) * r;
      if (this.world.terrain.isFlat(x, z, 3)) {
        spawn = new Vector3(x, 0, z);
        break;
      }
    }
    const factory = new SoldierFactory(this.scene);
    const figure = factory.createRiderFigure(this.deps.rider);
    for (const m of figure.root.getChildMeshes()) {
      this.world.shadows?.addShadowCaster(m);
    }
    this.riderCtrl = new RiderController(this.player, figure, this.world.terrain, this.deps.bus);
    this.riderCtrl.spawn(spawn, this.dragonCtrl.yaw);
    this.groundCam.yaw = this.riderCtrl.yaw;
    this.groundCam.pitch = 0.15;
    this.groundCam.reset(this.riderCtrl.pos);

    // convert objectives so the mission remains completable
    this.tracker.convertToGround();
    this.deps.bus.emit("ground-mode-start", { pos: { x: spawn.x, y: spawn.y, z: spawn.z } });
  }

  private updateTutorial(dt: number): void {
    const step = this.tutorialSteps[this.tutorialStep];
    if (!step) {
      this.tutorialStep = -1;
      return;
    }
    const input = this.deps.input;
    let contribution = 0;
    switch (step.key) {
      case "accelerate":
        contribution = input.isDown("accelerate") ? dt : 0;
        break;
      case "turn":
        contribution = input.isDown("turnLeft") || input.isDown("turnRight") ? dt : 0;
        break;
      case "look":
        contribution =
          input.isDown("lookLeft") || input.isDown("lookRight") || input.isDown("lookUp") || input.isDown("lookDown")
            ? dt
            : Math.abs(input.frameMouseDX) + Math.abs(input.frameMouseDY) > 30
              ? dt
              : 0;
        break;
      case "fire":
        contribution = input.isDown("fire") ? dt : 0;
        break;
      case "boost":
        contribution = input.isDown("boost") ? dt : 0;
        break;
    }
    this.tutorialProgress += contribution;
    if (this.tutorialProgress >= step.need) {
      this.tutorialStep++;
      this.tutorialProgress = 0;
      this.deps.bus.emit("tutorial-advanced", {
        step: this.tutorialStep < this.tutorialSteps.length ? this.tutorialSteps[this.tutorialStep].label : "done",
      });
      if (this.tutorialStep >= this.tutorialSteps.length) this.tutorialStep = -1;
    }
  }

  // ---------------- target lock (X) ----------------

  private updateDragonLock(d: MissionSceneDeps): void {
    // invalidate dead/collapsed targets
    if (this.lockTargetPos) {
      const invalid =
        (this.lockSoldier && this.lockSoldier.state === "dead") ||
        (this.lockBallista && this.lockBallista.dead) ||
        (this.lockBuilding && this.lockBuilding.collapsed) ||
        (!this.lockSoldier && !this.lockBallista && !this.lockBuilding);
      if (invalid) {
        this.clearLock();
      } else {
        const src = this.lockSoldier ? this.lockSoldier.pos : this.lockBallista ? this.lockBallista.pos : this.lockBuilding!.pos;
        this.lockTargetPos.copyFrom(src);
      }
    }
    if (d.input.pressed("lockOn")) {
      if (this.lockTargetPos) {
        this.clearLock();
      } else {
        this.acquireLock();
      }
      d.bus.emit("target-lock-changed", { locked: !!this.lockTargetPos, kind: this.lockTargetKind });
    }
  }

  private clearLock(): void {
    this.lockTargetPos = null;
    this.lockTargetKind = null;
    this.lockSoldier = null;
    this.lockBallista = null;
    this.lockBuilding = null;
  }

  private acquireLock(): void {
    const origin = this.dragonCtrl.pos;
    const fwd = this.dragonCtrl.forward;
    let bestPos: Vector3 | null = null;
    let bestScore = Infinity;
    let bestKind = "";
    let bestSoldier: Soldier | null = null;
    let bestBallista: import("../ai/EnemyManager").BallistaEntity | null = null;
    let bestBuilding: import("../world/BuildingSystem").BuildingEntity | null = null;
    const consider = (
      pos: Vector3,
      prio: number,
      kind: string,
      maxDist = 420
    ) => {
      const v = pos.subtract(origin);
      const dist = v.length();
      if (dist > maxDist || dist < 4) return;
      const cosA = Vector3.Dot(v.scale(1 / dist), fwd);
      if (cosA < Math.cos(0.75)) return; // must be roughly in front
      const angle = Math.acos(Math.min(1, cosA));
      const score = angle * 2.2 + dist / maxDist - prio;
      if (score < bestScore) {
        bestScore = score;
        bestPos = pos.clone();
        bestKind = kind;
        bestSoldier = null;
        bestBallista = null;
        bestBuilding = null;
      }
    };
    for (const s of this.enemies.soldiers) {
      if (s.state === "dead") continue;
      const prio = s.def.role === "commander" ? 0.45 : s.def.role === "elite" ? 0.4 : s.def.role === "archer" ? 0.15 : 0;
      consider(s.pos, prio, s.def.name);
      if (bestKind === s.def.name && bestSoldier === null && Vector3.DistanceSquared(s.pos, bestPos ?? origin) < 1) {
        bestSoldier = s;
      }
    }
    for (const b of this.enemies.ballistae) {
      if (!b.dead) consider(b.pos, 0.5, "Ballista");
      if (bestKind === "Ballista" && bestBallista === null && Vector3.DistanceSquared(b.pos, bestPos ?? origin) < 1) {
        bestBallista = b;
      }
    }
    for (const b of this.buildings.buildings) {
      if (!b.collapsed) consider(b.pos, 0.1, "Structure", 300);
      if (bestKind === "Structure" && bestBuilding === null && Vector3.DistanceSquared(b.pos, bestPos ?? origin) < 4) {
        bestBuilding = b;
      }
    }
    if (bestPos) {
      this.clearLock();
      this.lockTargetPos = bestPos;
      this.lockTargetKind = bestKind;
      this.lockSoldier = bestSoldier;
      this.lockBallista = bestBallista;
      this.lockBuilding = bestBuilding;
      this.deps.audio.uiClick();
    } else {
      this.deps.bus.emit("hud-hint", { text: "NO TARGET" });
    }
  }

  /** fire direction with soft target assist + lock magnetism (keyboard-friendly aiming) */
  private getFireAimDir(): Vector3 | null {
    const base = this.dragonCtrl.forward;
    const head = this.rig.headTip.getAbsolutePosition();
    const stats = this.player.dragonStats;
    const cone = stats.fireCone ?? 0.34;
    const assist = clamp(this.deps.settings.targetAssist ?? 0.5, 0, 1);

    // locked target: strong magnetism toward it
    if (this.lockTargetPos) {
      const to = this.lockTargetPos.subtract(head);
      const dist = to.length();
      if (dist > 1) {
        const cosA = Vector3.Dot(to.scale(1 / dist), base);
        if (cosA > Math.cos(cone * 2.5)) {
          return Vector3.Normalize(Vector3.Lerp(base, to.scale(1 / dist), 0.85));
        }
      }
      return null;
    }
    if (assist <= 0.01) return null;

    // soft assist: nearest target close to the nose
    let bestPos: Vector3 | null = null;
    let bestScore = Infinity;
    const origin = this.dragonCtrl.pos;
    for (const s of this.enemies.soldiers) {
      if (s.state === "dead") continue;
      const v = s.pos.subtract(origin);
      const dist = v.length();
      if (dist > 160 || dist < 4) continue;
      const cosA = Vector3.Dot(v.scale(1 / dist), base);
      if (cosA > Math.cos(cone * 0.8)) {
        const score = Math.acos(Math.min(1, cosA)) + dist / 300;
        if (score < bestScore) {
          bestScore = score;
          bestPos = s.pos;
        }
      }
    }
    if (!bestPos) return null;
    const to = Vector3.Normalize(bestPos.subtract(head));
    return Vector3.Normalize(Vector3.Lerp(base, to, 0.5 * assist));
  }

  /** lock indicator world position (dragon lock or rider lock) projected to canvas CSS px */
  getLockScreenPos(): { x: number; y: number; kind: string } | null {
    const world = this.phase === "ground" ? (this.riderCtrl?.lockTarget ? this.riderCtrl.lockTarget.pos : null) : this.lockTargetPos;
    if (!world) return null;
    const cam = this.activeCamera();
    const canvas = this.deps.engine.getRenderingCanvas();
    if (!canvas) return null;
    const view = cam.getViewMatrix();
    const p = Vector3.TransformCoordinates(world, view);
    if (p.z < 1) return null; // behind camera
    const ndcX = p.x / (p.z * Math.tan(cam.fov / 2) * (canvas.clientWidth / canvas.clientHeight));
    const ndcY = p.y / (p.z * Math.tan(cam.fov / 2));
    if (Math.abs(ndcX) > 1.15 || Math.abs(ndcY) > 1.15) return null;
    return {
      x: (ndcX * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - (ndcY * 0.5 + 0.5)) * canvas.clientHeight,
      kind: this.phase === "ground" ? "Enemy" : this.lockTargetKind ?? "Target",
    };
  }

  currentTutorialLabel(): string | null {
    if (this.tutorialStep < 0) return null;
    return this.tutorialSteps[this.tutorialStep]?.label ?? null;
  }

  private endMission(victory: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = "ended";
    this.deps.audio.setFireLoop(false);
    this.deps.audio.setWind(0);
    this.deps.onMissionEnd(victory, this.stats);
  }

  /** force mission end (test hooks) */
  forceEnd(victory: boolean): void {
    this.endMission(victory);
  }

  getMinimapData() {
    return {
      player: { x: this.playerPosition().x, z: this.playerPosition().z, yaw: this.phase === "ground" ? this.riderCtrl?.yaw ?? 0 : this.dragonCtrl.yaw },
      enemies: this.enemies.soldiers
        .filter((s) => s.state !== "dead")
        .map((s) => ({ x: s.pos.x, z: s.pos.z, role: s.def.role })),
      ballistae: this.enemies.ballistae.filter((b) => !b.dead).map((b) => ({ x: b.pos.x, z: b.pos.z })),
      buildings: this.buildings.buildings.map((b) => ({ x: b.pos.x, z: b.pos.z, collapsed: b.collapsed })),
      loot: this.loot.entities.map((l) => ({ x: l.pos.x, z: l.pos.z })),
      bounds: 760,
    };
  }

  dispose(): void {
    this.enemies.disposeAll();
    this.buildings.disposeAll();
    this.loot.dispose();
    this.projectiles.dispose();
    this.glow.dispose();
    this.scene.dispose();
  }

  // ---- test helpers ----
  testKillNearestSoldier(byFire = true): Soldier | null {
    let best: Soldier | null = null;
    let bestD = Infinity;
    for (const s of this.enemies.soldiers) {
      if (s.state === "dead") continue;
      const d = Vector3.Distance(s.pos, this.playerPosition());
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) this.enemies.damageSoldier(best, 9999, byFire);
    return best;
  }

  testDamageDragon(amount: number): void {
    const died = this.player.damageDragon(amount);
    if (died) this.beginDragonDeath();
  }

  testCollapseNearestBuilding(): void {
    const b = this.buildings.buildings.find((x) => !x.collapsed);
    if (b) this.buildings.damageBuilding(b, b.maxHp + 1);
  }

  testCollapseBuildingWithTag(tag: string): void {
    const b = this.buildings.buildings.find((x) => !x.collapsed && x.tag === tag);
    if (b) this.buildings.damageBuilding(b, b.maxHp + 1);
  }
}
