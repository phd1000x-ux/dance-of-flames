import type { AbstractEngine, Scene } from "@babylonjs/core";
import { SceneInstrumentation } from "@babylonjs/core";
import { GameState, StateMachine } from "../core/GameState";
import { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import { SaveSystem, defaultSave, type SaveData, type GameSettings, IndexedDbStorage, MemoryStorage } from "../save/SaveSystem";
import { UpgradeSystem } from "../progression/UpgradeSystem";
import { InputManager } from "../input/InputManager";
import { AudioManager } from "../audio/AudioManager";
import { MusicSystem } from "../audio/MusicSystem";
import type { MusicStateId } from "../audio/MusicComposer";
import { PerformanceGovernor } from "../engine/PerformanceGovernor";
import { detectCapabilities, type EngineInfo } from "../engine/EngineFactory";
import { UIManager } from "../ui/UIManager";
import { MenuShowcase } from "../scenes/MenuShowcase";
import { MissionScene } from "../mission/MissionScene";
import { validateSnapshot, type FinaleSnapshot } from "../mission/blackstone/FinalePatterns";
import { getMission, MISSIONS } from "../data/missions";
import { applyDamageTint } from "../world/DragonMaterials";
import { getRider } from "../data/riders";
import { getDragon } from "../data/dragons";
import type { MissionStats } from "../mission/Scoring";
import { applyDifficulty, type DifficultyId } from "../data/difficulty";
import { scoreMission, rankFor } from "../mission/Scoring";
import { getShopUpgrade } from "../data/upgrades";
import { clamp } from "../core/MathUtils";

export interface GameAppOptions {
  testMode: boolean;
  benchmark: boolean;
}

/** Top-level application: state machine, scenes, save, progression, render loop. */
export class GameApp {
  readonly state = new StateMachine();
  readonly bus = new EventBus<GameEvents>();
  readonly music = new MusicSystem();
  settings!: GameSettings;
  save!: SaveData;
  upgrades!: UpgradeSystem;
  input!: InputManager;
  audio!: AudioManager;
  governor!: PerformanceGovernor;
  ui!: UIManager;
  showcase: MenuShowcase | null = null;
  mission: MissionScene | null = null;
  /** in-memory finale checkpoint — captured at finale beats, offered on DEFEAT retry */
  checkpoint: FinaleSnapshot | null = null;
  rendererName = "…";
  private instrumentation: SceneInstrumentation | null = null;
  private paused = false;
  private debugVisible = false;
  private debugEl: HTMLElement | null = null;
  private lastHudUpdate = 0;
  private frameCount = 0;
  // benchmark
  private benchFrameTimes: number[] = [];
  private benchSeconds = 30;
  private benchStart = 0;
  // pending mission config
  private missionCfg: {
    missionId: string;
    difficulty: DifficultyId;
    riderId: string;
    dragonId: string;
  } | null = null;

  constructor(
    engineInfo: EngineInfo,
    private canvas: HTMLCanvasElement,
    private opts: GameAppOptions
  ) {
    this.engineRef = engineInfo.engine;
    this.engineInfo = engineInfo;
    this.rendererName = engineInfo.renderer;
  }

  get engine(): AbstractEngine {
    return this.engineRef;
  }

  private engineRef: AbstractEngine;
  private engineInfo: EngineInfo;

  get testMode(): boolean {
    return this.opts.testMode;
  }

  async init(): Promise<void> {
    const caps = detectCapabilities();
    console.log("[boot] capabilities:", caps);

    // save
    const storage = caps.indexedDB ? new IndexedDbStorage() : new MemoryStorage();
    const saveSystem = new SaveSystem(storage);
    this.save = await saveSystem.load();
    this.settings = this.save.settings;

    this.upgrades = UpgradeSystem.deserialize({ coins: this.save.coins, levels: this.save.upgrades });
    this.input = new InputManager(this.canvas);
    this.input.testMode = this.opts.testMode;
    this.input.sensitivity = this.settings.mouseSensitivity;
    this.input.invertY = this.settings.invertY;
    this.audio = new AudioManager(this.settings);
    this.governor = new PerformanceGovernor(this.engine, this.settings);
    this.governor.applyPreset(this.settings.graphicsPreset);

    this.ui = new UIManager(document.getElementById("ui-root")!, this.makeUiCallbacks(), this.settings, this.bus);
    this.ui.setRendererInfo(`Renderer: ${this.rendererName} — WebGPU: ${caps.webgpu ? "available" : "unavailable"} — ${caps.hardwareConcurrency} cores`);
    this.ui.hud.setPortrait("D");

    this.wireBus();
    this.buildDebugOverlay();
    // instant pause on Escape (synchronous with the keydown — no frame-delay race
    // where fast key sequences after Esc would be dropped before the pause screen exists)
    this.input.onKeyDown = (code, event) => {
      if (code === "Escape" && this.state.inGameplay && !this.paused) {
        this.setPaused(true);
        // this event opened the pause menu — the menu's own Esc handler must not see it
        event.stopImmediatePropagation();
      }
    };
    this.state.transition(GameState.MENU);
    this.ui.showScreen("main-menu");
    this.ui.setContinueEnabled(this.hasProgress());
    this.openShowcase();

    window.addEventListener("resize", () => this.engine.resize());
    // §19: if pointer lock is lost mid-gameplay (Esc / click outside), fall back to the pause menu
    document.addEventListener("pointerlockchange", () => {
      if (
        !document.pointerLockElement &&
        this.state.inGameplay &&
        !this.paused &&
        !this.opts.testMode &&
        !this.opts.benchmark
      ) {
        this.setPaused(true);
      }
    });
    this.engine.runRenderLoop(() => this.frame());

    (window as any).__APP = this;
  }

  private hasProgress(): boolean {
    return this.save.unlockedMissions.length > 1 || this.save.coins > 0 || Object.keys(this.save.upgrades).length > 0;
  }

  // ---------------- scenes ----------------
  private openShowcase(): void {
    if (!this.showcase) {
      this.showcase = new MenuShowcase(this.engine, this.canvas);
    }
    this.showcase.setDragon(getDragon(this.save.selectedDragon ?? "syrax"), getRider(this.save.selectedRider ?? "rhaenyra"));
    this.showcase.setMode("menu");
  }

  private wireBus(): void {
    this.bus.on("sfx", ({ name, intensity, pan }) => {
      const a = this.audio as any;
      if (typeof a[name] === "function") a[name](intensity, pan);
    });
    this.bus.on("relic-found", () => {
      /* audio handled via sfx relic */
    });
    this.bus.on("dragon-fallen", () => {
      this.music.setState("dragon_fallen");
    });
    this.bus.on("ground-begun", () => {
      this.music.setState("ground");
    });
    this.bus.on("finale-music", (e) => {
      if (e.state === "resolve") {
        this.finaleMusicOverride = false;
        this.updateMusicAndAmbient();
      } else {
        this.finaleMusicOverride = true;
        this.music.setState(e.state);
      }
    });
    this.bus.on("finale-checkpoint", ({ snapshot }) => {
      try {
        this.checkpoint = validateSnapshot(snapshot);
      } catch (e) {
        console.warn("[checkpoint] invalid snapshot ignored", e);
      }
    });
  }

  // ---------------- mission lifecycle ----------------
  async startMission(missionId: string, riderId: string, dragonId: string, difficulty: DifficultyId): Promise<void> {
    this.missionCfg = { missionId, difficulty, riderId, dragonId };
    await this.loadMission();
  }

  /** Load (or reload) the configured mission. With a checkpoint snapshot the
   *  freshly built deterministic mission is restored from it; without one any
   *  previously captured checkpoint is cleared. */
  private async loadMission(snapshot?: FinaleSnapshot): Promise<void> {
    const cfg = this.missionCfg!;
    this.state.transition(GameState.LOADING);
    this.input.resetAllInputs();
    this.finaleMusicOverride = false;
    const loading = document.getElementById("loading-screen")!;
    const fill = document.getElementById("loading-bar-fill")!;
    const status = document.getElementById("loading-status")!;
    loading.classList.remove("hidden");
    fill.style.width = "8%";
    status.textContent = "Loading World…";
    await nextFrame();
    await nextFrame();

    // dispose menu + old mission
    this.mission?.dispose();
    this.mission = null;
    this.showcase?.dispose();
    this.showcase = null;

    const rider = getRider(cfg.riderId);
    const dragon = getDragon(cfg.dragonId);
    const missionDef = getMission(cfg.missionId);
    const difficulty = applyDifficulty(cfg.difficulty);

    fill.style.width = "45%";
    status.textContent = "Loading Dragon…";
    await nextFrame();

    const healLvl = this.upgrades.getLevel("startHeal");
    const mission = new MissionScene({
      engine: this.engine,
      mission: missionDef,
      difficulty,
      rider,
      dragon,
      shopMods: this.upgrades.getStatMods(),
      consumables: { heal: healLvl, fireBoost: this.upgrades.getLevel("fireBoostStart"), armorWard: this.upgrades.getLevel("armorCharmStart") },
      settings: this.settings,
      input: this.input,
      audio: this.audio,
      bus: this.bus,
      onCoins: (delta) => this.upgrades.addCoins(delta),
      onMissionEnd: (victory, stats) => this.endMission(victory, stats),
      particleScale: () => this.governor.particleScale,
    });
    this.mission = mission;
    // checkpoint restore: apply to the deterministic fresh build; on failure
    // fall through as a clean start (never brick the retry)
    let restored = false;
    if (snapshot && mission.finale) {
      try {
        mission.applySnapshot(validateSnapshot(snapshot));
        restored = true;
      } catch (e) {
        console.warn("[checkpoint] restore failed — starting clean", e);
      }
    }
    this.checkpoint = restored ? snapshot! : null;
    this.instrumentation = new SceneInstrumentation(mission.scene);
    this.instrumentation.captureFrameTime = true;

    fill.style.width = "88%";
    status.textContent = "Preparing Battlefield…";
    await nextFrame();

    // persist selection
    this.save.selectedRider = cfg.riderId;
    this.save.selectedDragon = cfg.dragonId;
    this.save.selectedDifficulty = cfg.difficulty;
    this.persistSave();

    fill.style.width = "100%";
    await nextFrame();
    loading.classList.add("hidden");

    this.paused = false;
    this.state.transition(GameState.DRAGON_GAMEPLAY);
    this.ui.showScreen(null);
    this.ui.hud.setPortrait(dragon.name.charAt(0));
    this.audio.unlock();
    if (!this.opts.testMode && !this.opts.benchmark) {
      this.input.requestPointerLock();
    }
  }

  /** test/E2E hook — reload the mission from the captured finale checkpoint */
  restoreCheckpoint(): boolean {
    if (!this.checkpoint) return false;
    void this.loadMission(this.checkpoint);
    return true;
  }

  private endMission(victory: boolean, stats: MissionStats): void {
    this.handleMissionEnd(victory, stats);
  }

  private handleMissionEnd(victory: boolean, stats: MissionStats): void {
    const score = scoreMission(stats);
    const rank = rankFor(score);
    const missionDef = this.missionCfg ? getMission(this.missionCfg.missionId) : MISSIONS[0];
    const coinsEarned = Math.round(
      stats.coinsCollected + (victory ? missionDef.coinBonus + score / 20 : stats.coinsCollected * 0.4)
    );
    this.upgrades.addCoins(coinsEarned);

    if (victory) {
      const idx = MISSIONS.findIndex((m) => m.id === missionDef.id);
      const next = MISSIONS[idx + 1];
      if (next && !this.save.unlockedMissions.includes(next.id)) {
        this.save.unlockedMissions.push(next.id);
      }
      if (idx === MISSIONS.length - 1) this.save.campaignCompleted = true;
      const prevBest = this.save.bestScores[missionDef.id] ?? 0;
      if (score > prevBest) this.save.bestScores[missionDef.id] = score;
      this.audio.victory();
      this.music.setState("victory");
    } else {
      this.audio.defeat();
      this.music.setState("defeat");
    }
    this.save.coins = this.upgrades.coins;
    this.save.upgrades = this.upgrades.serialize().levels;
    this.persistSave();

    this.state.transition(victory ? GameState.VICTORY : GameState.DEFEAT);
    this.input.exitPointerLock();
    this.ui.showResults(victory, stats, score, coinsEarned, !victory && !!this.checkpoint);
    this.ui.showScreen("results");
    console.log(`[mission] ${victory ? "VICTORY" : "DEFEAT"} score=${score} rank=${rank} coins=+${coinsEarned}`);
  }

  private persistSave(): void {
    this.save.coins = this.upgrades.coins;
    this.save.upgrades = this.upgrades.serialize().levels;
    this.save.settings = this.settings;
    const storage = typeof indexedDB !== "undefined" ? new IndexedDbStorage() : new MemoryStorage();
    new SaveSystem(storage).save({ ...this.save });
  }

  // ---------------- UI callbacks ----------------
  private makeUiCallbacks() {
    return {
      onContinue: () => {
        this.populateMissionSelect();
        this.ui.showScreen("mission-select");
      },
      onNewCampaign: () => {
        this.state.transition(GameState.CHARACTER_SELECT);
        this.ui.populateCharacterSelect(this.save);
        this.ui.showScreen("character-select");
        this.showcase?.setMode("select");
        this.showcase?.setDragon(getDragon(this.selectedDragonForShowcase()));
      },
      onBattle: () => {
        this.state.transition(GameState.CHARACTER_SELECT);
        this.ui.populateCharacterSelect(this.save);
        this.ui.showScreen("character-select");
        this.showcase?.setMode("select");
      },
      onSettings: () => {
        this.ui.refreshSettings();
        this.ui.showScreen("settings");
        this.settingsReturnTo = this.state.state;
      },
      onCredits: () => {
        this.state.transition(GameState.CREDITS);
        this.ui.showScreen("credits");
      },
      onSelectionChange: (riderId: string, dragonId: string) => {
        this.showcase?.setDragon(getDragon(dragonId), getRider(riderId));
      },
      onConfirmSelection: (riderId: string, dragonId: string) => {
        this.state.transition(GameState.MISSION_SELECT);
        this.populateMissionSelect();
        this.ui.showScreen("mission-select");
      },
      onStartMission: (missionId: string, difficulty: DifficultyId) => {
        const riderId = this.save.selectedRider ?? "rhaenyra";
        const dragonId = this.save.selectedDragon ?? "syrax";
        // pull latest selection from UI via DOM
        const sel = (window as any).__UI?.getSelection?.();
        this.startMission(missionId, sel?.rider ?? riderId, sel?.dragon ?? dragonId, difficulty);
      },
      onMissionMapBack: () => this.backToMenu(),
      onPause: () => this.setPaused(true),
      onResume: () => this.setPaused(false),
      onRestartMission: () => {
        this.setPaused(false);
        this.loadMission();
      },
      onAbandon: () => {
        this.setPaused(false);
        this.backToMenu();
      },
      onSettingsChange: (s: GameSettings) => {
        this.settings = s;
        this.input.sensitivity = s.mouseSensitivity;
        this.input.invertY = s.invertY;
        this.audio.applySettings();
        this.governor.applyPreset(s.graphicsPreset);
        this.persistSave();
      },
      onShopBuy: (upgradeId: string) => {
        const res = this.upgrades.purchase(upgradeId);
        if (res.ok) {
          this.audio.coin();
          this.persistSave();
        }
        this.ui.populateShop(this.upgrades.coins, this.upgrades.serialize().levels);
      },
      onShopClose: (next: boolean) => {
        if (next) {
          const idx = MISSIONS.findIndex((m) => m.id === this.missionCfg?.missionId);
          const nextM = MISSIONS[Math.min(MISSIONS.length - 1, idx + 1)];
          this.state.transition(GameState.CHARACTER_SELECT);
          this.ui.populateCharacterSelect(this.save);
          this.ui.showScreen("character-select");
          this.openShowcase();
          this.showcase?.setMode("select");
          void nextM;
        } else {
          this.backToMenu();
        }
      },
      onResultsContinue: () => {
        const victory = this.state.state === GameState.VICTORY;
        if (victory) {
          this.state.transition(GameState.SHOP);
          this.ui.populateShop(this.upgrades.coins, this.upgrades.serialize().levels);
          this.ui.showScreen("shop");
        } else {
          this.backToMenu();
        }
      },
      onRetryMission: (fromCheckpoint?: boolean) => {
        if (this.missionCfg) {
          this.setPaused(false);
          this.loadMission(fromCheckpoint ? (this.checkpoint ?? undefined) : undefined);
        } else {
          this.backToMenu();
        }
      },
      onMissionSelect: () => {
        this.mission?.dispose();
        this.mission = null;
        this.input.resetAllInputs();
        this.openShowcase();
        this.state.transition(GameState.MISSION_SELECT);
        this.populateMissionSelect();
        this.ui.showScreen("mission-select");
      },
    };
  }

  private settingsReturnTo: GameState = GameState.MENU;

  private populateMissionSelect(): void {
    this.ui.populateMissionSelect(this.save);
  }

  private selectedDragonForShowcase(): string {
    return this.save.selectedDragon ?? "syrax";
  }

  private musicAmbientTimer = 0;
  // finale-music ("chase"/"boss") holds until "resolve" — adaptive selection must not clobber it
  private finaleMusicOverride = false;

  /** adaptive score state + ambient audio zone from the live mission */
  private updateMusicAndAmbient(): void {
    const m = this.mission;
    if (!m) return;
    // ambient zone by player position (castle missions define a castle center+radius)
    const zone = m.getAmbientZone();
    this.audio.setAmbientZone(zone);

    let target: MusicStateId;
    if (m.missionId === "blackstone" && m.phase !== "ground") {
      target = m.musicIntensity >= 0.8 ? "combat_high" : "castle";
    } else if (m.phase === "ground") {
      target = m.musicIntensity >= 0.8 ? "combat_high" : "ground";
    } else if (m.musicIntensity >= 0.75) {
      target = "combat_high";
    } else if (m.musicIntensity >= 0.35) {
      target = "combat_low";
    } else {
      target = "explore";
    }
    if (!this.finaleMusicOverride) this.music.setState(target);
    this.audio.setBattleIntensity(m.musicIntensity);
    // governor tier ≥ 2: cull far decorative props to protect framerate
    m.world.props.setCullingRadius(this.governor.tier >= 2 ? 380 : 6000);
  }

  private backToMenu(): void {
    this.state.transition(GameState.MENU);
    this.mission?.dispose();
    this.mission = null;
    this.input.resetAllInputs();
    this.simAccumulator = 0;
    this.music.setState("menu");
    this.audio.setAmbientZone("field");
    this.audio.setBattleIntensity(0);
    this.openShowcase();
    this.ui.showScreen("main-menu");
    this.ui.setContinueEnabled(this.hasProgress());
    this.audio.setWind(0);
  }

  setPaused(p: boolean): void {
    if (!this.state.inGameplay && p) return;
    this.paused = p;
    this.input.resetAllInputs(); // §56: no stuck keys across context switches
    this.simAccumulator = 0; // no catch-up backlog across the pause
    if (p) {
      this.state.transition(GameState.PAUSED);
      this.input.exitPointerLock();
      this.ui.showScreen("pause");
      this.audio.setFireLoop(false);
    } else {
      const back = this.mission?.phase === "ground" ? GameState.GROUND_GAMEPLAY : GameState.DRAGON_GAMEPLAY;
      this.state.transition(back);
      this.ui.showScreen(null);
      if (!this.opts.testMode) this.input.requestPointerLock();
    }
  }

  // ---------------- main loop ----------------
  private simAccumulator = 0;

  private frame(): void {
    this.frameCount++;
    const frameMs = this.engine.getDeltaTime();
    this.governor.update(frameMs);

    // input context + smoothed keyboard look axes
    this.input.setContext(this.state.inGameplay && !this.paused ? "gameplay" : "menu");
    this.input.state.lookScale = this.settings.keyboardLookSpeed ?? 1;
    this.input.update(clamp(frameMs / 1000, 0, 0.05));

    // global keys (Escape is owned by the synchronous keydown hook + menu UI)
    if (this.input.pressed("debug")) {
      this.debugVisible = !this.debugVisible;
      this.debugEl?.classList.toggle("visible", this.debugVisible);
    }

    // audio unlock on first interaction
    if (this.frameCount === 30) this.audio.unlock();
    // start the score once audio exists
    if (this.frameCount === 30 && this.audio.musicInput) {
      const ctx = (this.audio as any).ctx as AudioContext;
      this.music.start(ctx, this.audio.musicInput);
    }

    if (this.mission && this.state.inGameplay && !this.paused) {
      // benchmark autopilot
      if (this.opts.benchmark) this.benchmarkPilot();
      // FIXED-TIMESTEP SIMULATION (root fix): the sim is decoupled from the render
      // loop — real frame time accumulates and is consumed in 1/60s substeps.
      // Previously one clamped dt per render frame made sim time run at 10–30% of
      // real time under slow pipelines (software GL), diluting every timing-based
      // behavior and ballooning test durations.
      this.simAccumulator += clamp(frameMs / 1000, 0, 1);
      const SIM_STEP = 1 / 60;
      const maxSteps = this.opts.testMode ? 8 : 5;
      let steps = 0;
      while (this.simAccumulator >= SIM_STEP && steps < maxSteps) {
        this.mission.update(SIM_STEP);
        this.simAccumulator -= SIM_STEP;
        steps++;
      }
      if (steps === maxSteps) this.simAccumulator = 0; // drop backlog (spiral-of-death guard)
      // Edge bookkeeping IMMEDIATELY after the substep batch, only when substeps
      // ran. Together with consume-on-read edges (InputState.pressed) this closes
      // every loss/duplication window: edges arriving later this frame (HUD, render,
      // idle) or on zero-substep frames survive until a substep consumes them.
      this.input.endFrame(steps > 0);
      // adaptive music + ambient zones (~1 Hz) — skipped if the mission just ended
      this.musicAmbientTimer += frameMs;
      if (this.musicAmbientTimer > 1000 && this.state.inGameplay) {
        this.musicAmbientTimer = 0;
        this.updateMusicAndAmbient();
      }
      // phase transitions → game state
      if (this.mission.phase === "dragonDying" && this.state.state === GameState.DRAGON_GAMEPLAY) {
        this.state.transition(GameState.DRAGON_DEATH);
      } else if (this.mission.phase === "ground" && this.state.is(GameState.DRAGON_DEATH, GameState.DRAGON_GAMEPLAY)) {
        this.state.transition(GameState.GROUND_GAMEPLAY);
      } else if (this.mission.phase === "dragon" && this.state.is(GameState.GROUND_GAMEPLAY)) {
        this.state.transition(GameState.DRAGON_GAMEPLAY); // finale remount
      }
      // HUD at ~30Hz
      this.lastHudUpdate += frameMs;
      if (this.lastHudUpdate > 33) {
        this.lastHudUpdate = 0;
        this.updateHud();
      }
      if (this.opts.benchmark) this.benchmarkTick(performance.now());
      if (this.debugVisible) this.updateDebug();
      // testMode: rendering is the bottleneck under software GL — render every
      // other frame so the sim cadence (and thus wall-clock test speed) roughly doubles
      if (!this.opts.testMode || this.frameCount % 2 === 0) {
        this.mission.scene.render();
      }
      return;
    }

    if (this.showcase) {
      this.showcase.render();
    } else if (this.mission) {
      this.mission.scene.render();
    }
    this.input.endFrame();
  }

  private updateHud(): void {
    const m = this.mission;
    if (!m) return;
    const p = m.player;
    const obj = m.tracker.current();
    // live settings → mission systems
    m.dragonCtrl.inputTurnScale = this.settings.keyboardTurnSpeed ?? 1;
    // subtle damage state on the dragon material (soot/darkening as HP drops)
    applyDamageTint(m.rig.materials, p.dragonHp / Math.max(1, p.maxDragonHp));
    this.ui.hud.update({
      mode: m.phase === "ground" ? "ground" : m.phase === "dragonDying" ? "dying" : "dragon",
      dragonHp: p.dragonHp,
      dragonMaxHp: p.maxDragonHp,
      fireFraction: p.fireEnergy.fraction,
      canFire: p.fireEnergy.canFire(),
      superCharge: p.superCharge,
      superReady: p.superCharge >= 100 && p.superCooldown <= 0,
      boost: p.boost,
      riderHp: p.riderHp,
      riderMaxHp: p.maxRiderHp,
      stamina: p.riderStamina,
      maxStamina: p.maxRiderStamina,
      comboIndex: m.riderCtrl ? (m.riderCtrl.attackState === "none" ? 0 : m.riderCtrl.attackState === "heavy" ? 3 : Number(m.riderCtrl.attackState.slice(-1))) : 0,
      blocking: m.riderCtrl?.blocking ?? false,
      coins: this.upgrades.coins,
      objective: obj
        ? {
            description: obj.description,
            progress: obj.progress,
            need: obj.type === "survive" ? obj.seconds ?? 0 : obj.count ?? 1,
            completed: false,
          }
        : { description: "All objectives complete", progress: 1, need: 1, completed: true },
      tutorial: m.currentTutorialLabel(),
      playerX: m.playerPosition().x,
      playerZ: m.playerPosition().z,
      playerYaw: m.phase === "ground" ? m.riderCtrl?.yaw ?? 0 : m.dragonCtrl.yaw,
      lowHp: p.dragonHp / Math.max(1, p.maxDragonHp) < 0.3,
      boosting: m.dragonCtrl.state === "BOOST",
      healCharges: p.healCharges,
      enemies: m.enemies.soldiers.filter((s) => s.state !== "dead").map((s) => ({ x: s.pos.x, z: s.pos.z, role: s.def.role })),
      ballistae: m.enemies.ballistae.filter((b) => !b.dead).map((b) => ({ x: b.pos.x, z: b.pos.z })),
      buildings: m.buildings.buildings.map((b) => ({ x: b.pos.x, z: b.pos.z, collapsed: b.collapsed })),
      loot: m.loot.entities.map((l) => ({ x: l.pos.x, z: l.pos.z })),
      bounds: 760,
      lock: m.getLockScreenPos(),
      objectives: m.tracker.objectives().map((o) => ({
        desc: o.description,
        progress: o.progress,
        need: o.type === "survive" ? o.seconds ?? 0 : o.count ?? 1,
        completed: o.completed,
      })),
    });
  }

  // ---------------- debug overlay ----------------
  private buildDebugOverlay(): void {
    this.debugEl = document.createElement("div");
    this.debugEl.className = "debug-overlay";
    document.body.appendChild(this.debugEl);
  }

  private updateDebug(): void {
    const m = this.mission;
    const fps = this.engine.getFps().toFixed(0);
    const frameMs = this.engine.getDeltaTime().toFixed(1);
    const drawCalls = this.instrumentation?.drawCallsCounter.current.toFixed() ?? "?";
    const activeMeshes = m ? m.scene.getActiveMeshes().length : this.showcase?.scene.getActiveMeshes().length ?? 0;
    const mem = (performance as any).memory ? `${Math.round((performance as any).memory.usedJSHeapSize / 1048576)}MB` : "n/a";
    const gov = this.governor.stats();
    const pos = m ? `${m.playerPosition().x.toFixed(0)}, ${m.playerPosition().y.toFixed(0)}, ${m.playerPosition().z.toFixed(0)}` : "-";
    this.debugEl!.innerHTML =
      `FPS ${fps} (${frameMs}ms)\n` +
      `Renderer ${this.rendererName}\n` +
      `DrawCalls ${drawCalls} ActiveMeshes ${activeMeshes}\n` +
      `NPCs ${m ? m.enemies.aliveSoldierCount() : 0} Projectiles ${m ? m.projectiles.activeCount() : 0}\n` +
      `Quality tier ${gov.tier} scale ${gov.hardwareScaling.toFixed(2)} particles ${gov.particleScale.toFixed(2)}\n` +
      `Mem ${mem}\n` +
      `Player ${pos}\n` +
      `Phase ${m ? m.phase : this.state.state}`;
    if (this.settings.showFps) {
      this.debugEl!.classList.add("visible");
    }
  }

  // ---------------- benchmark ----------------
  startBenchmark(seconds = 30): void {
    this.opts.benchmark = true;
    this.benchSeconds = seconds;
    this.benchStart = performance.now();
    this.benchFrameTimes = [];
    this.input.testMode = true;
    console.log(`[benchmark] starting ${seconds}s stress run`);
  }

  private benchToggleT = 0;
  private benchmarkPilot(): void {
    // scripted flight: circle the battlefield while firing
    const m = this.mission;
    if (!m) return;
    this.benchToggleT += 0.016;
    this.input.injectKeyDown("KeyW");
    if (Math.sin(this.benchToggleT * 0.4) > 0) this.input.injectKeyDown("KeyA");
    else this.input.injectKeyDown("KeyD");
    if (this.benchToggleT % 2 < 1.4) this.input.injectMouse(0, true);
    else this.input.injectMouse(0, false);
    if (this.benchToggleT % 3 < 0.2) this.input.injectKeyDown("ShiftLeft");
    else this.input.injectKeyUp("ShiftLeft");
  }

  private benchmarkTick(now: number): void {
    this.benchFrameTimes.push(this.engine.getDeltaTime());
    const elapsed = (now - this.benchStart) / 1000;
    if (elapsed >= this.benchSeconds) {
      const times = this.benchFrameTimes;
      const sorted = [...times].sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const p5 = sorted[Math.floor(sorted.length * 0.05)];
      const max = sorted[sorted.length - 1];
      const report = {
        renderer: this.rendererName,
        frames: times.length,
        averageFps: Math.round(1000 / avg),
        p5Fps: Math.round(1000 / p5),
        maxFrameMs: max.toFixed(1),
        avgFrameMs: avg.toFixed(2),
        avgNpc: this.mission ? this.mission.enemies.aliveSoldierCount() : 0,
        qualityTier: this.governor.tier,
        hardwareScaling: this.governor.stats().hardwareScaling,
      };
      console.log("[benchmark] RESULT", JSON.stringify(report));
      (window as any).__BENCH = report;
      const overlay = document.createElement("div");
      overlay.className = "bench-overlay";
      overlay.textContent =
        `BENCHMARK RESULT\n\nRenderer: ${report.renderer}\nAverage FPS: ${report.averageFps}\n` +
        `5th percentile FPS: ${report.p5Fps}\nMax frame time: ${report.maxFrameMs}ms\n` +
        `Avg frame time: ${report.avgFrameMs}ms\nActive NPCs: ${report.avgNpc}\nQuality tier: ${report.qualityTier}`;
      document.body.appendChild(overlay);
      this.opts.benchmark = false;
    }
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
