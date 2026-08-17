import { createEngine } from "./engine/EngineFactory";
import { GameApp } from "./app/GameApp";
import { GameState } from "./core/GameState";
import { getDragon } from "./data/dragons";
import { getRider } from "./data/riders";
import { rankFor, scoreMission } from "./mission/Scoring";

const params = new URLSearchParams(location.search);
const testMode = params.get("test") === "1";
const benchmark = params.get("benchmark") === "1";
/** §44 keyboard-only proof mode: gameplay ignores all mouse input */
const keyboardOnly = params.get("keyboardOnly") === "1";

async function boot(): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const { engine, renderer } = await createEngine(canvas);
  console.log(`[boot] renderer: ${renderer} (WebGPU ${"gpu" in navigator ? "available" : "unavailable"})`);

  const app = new GameApp({ engine, renderer }, canvas, { testMode, benchmark });
  if (keyboardOnly) {
    app.input.keyboardOnly = true;
    console.log("[boot] keyboard-only test mode active — mouse gameplay input disabled");
  }
  await app.init();

  // ---- global UI service locator used by screens for navigation ----
  (window as any).__UI = {
    goBack: () => {
      const st = app.state;
      switch (st.state) {
        case GameState.CHARACTER_SELECT:
        case GameState.CREDITS:
          st.transition(GameState.MENU);
          app.ui.showScreen("main-menu");
          app.showcase?.setMode("menu");
          break;
        case GameState.MISSION_SELECT:
          st.transition(GameState.CHARACTER_SELECT);
          app.ui.populateCharacterSelect(app.save);
          app.ui.showScreen("character-select");
          app.showcase?.setMode("select");
          break;
        default:
          break;
      }
    },
    settingsBack: () => {
      // return to whichever screen opened settings
      const anyUi = app.ui as any;
      const returnTo = app.state.state === GameState.PAUSED ? "pause" : "main-menu";
      app.ui.showScreen(returnTo);
      void anyUi;
    },
    onUiClick: () => app.audio.unlock(),
    onUiSound: () => app.audio.uiMove(),
    getSelection: () => {
      const selRider = document.querySelector("#rider-list .roster-item.selected") as HTMLElement | null;
      const selDragon = document.querySelector("#dragon-list .roster-item.selected") as HTMLElement | null;
      return {
        rider: selRider?.dataset.rider ?? app.save.selectedRider ?? "rhaenyra",
        dragon: selDragon?.dataset.dragon ?? app.save.selectedDragon ?? "syrax",
      };
    },
  };

  // ---- test/E2E API ----
  if (testMode || benchmark) {
    (window as any).__GAME = {
      app,
      get state() {
        return app.state.state;
      },
      get renderer() {
        return app.rendererName;
      },
      get mission() {
        return app.mission;
      },
      get player() {
        return app.mission?.player ?? null;
      },
      get coins() {
        return app.upgrades.coins;
      },
      fps: () => app.engine.getFps(),
      api: {
        async startMission(riderId = "rhaenyra", dragonId = "syrax", missionId = "dragonstone", difficulty = "normal") {
          await app.startMission(missionId, riderId, dragonId, difficulty as any);
          return app.mission !== null;
        },
        damageDragon(n: number) {
          app.mission?.testDamageDragon(n);
        },
        setDragonHp(n: number) {
          const p = app.mission?.player;
          if (p) p.dragonHp = n;
        },
        killNearestEnemy() {
          return app.mission?.testKillNearestSoldier(true) ?? null;
        },
        collapseNearestBuilding() {
          app.mission?.testCollapseNearestBuilding();
        },
        collapseBuildingWithTag(tag: string) {
          app.mission?.testCollapseBuildingWithTag(tag);
        },
        collapseBuildingsWithTag(tag: string, n: number) {
          app.mission?.testCollapseBuildingsWithTag(tag, n);
        },
        killBallistae(n: number) {
          app.mission?.testKillBallistae(n);
        },
        killByType(type: string, n: number) {
          app.mission?.testKillByType(type, n);
        },
        getObjective() {
          const cur = app.mission?.tracker.current();
          return cur ? { description: cur.description, progress: cur.progress, need: cur.count ?? cur.seconds } : null;
        },
        getHudNumbers() {
          const q = (sel: string) => (document.querySelector(sel) as HTMLElement)?.textContent ?? "";
          return {
            coins: q("#coin-count"),
            hpLabel: q("#hp-label"),
            objective: q("#objective-text"),
            riderHpLabel: q("#rhp-label"),
          };
        },
        key(code: string, down: boolean) {
          if (down) app.input.injectKeyDown(code);
          else app.input.injectKeyUp(code);
        },
        mouse(button: number, down: boolean) {
          app.input.injectMouse(button, down);
        },
        mouseMove(dx: number, dy: number) {
          app.input.injectMouseMove(dx, dy);
        },
        forceVictory() {
          app.mission?.forceEnd(true);
        },
        setCastellanHp(n: number) {
          app.mission?.finale?.setCastellanHp(n);
        },
        damageWarDragon(n: number) {
          app.mission?.finale?.damageWarDragon(n);
        },
        getFinale() {
          const f = app.mission?.finale;
          if (!f) return null;
          return {
            phase: f.phase,
            vharax: f.warDragon
              ? { hp: f.warDragon.hp, maxHp: f.warDragon.maxHp, state: f.warDragon.state, pos: { x: f.warDragon.pos.x, y: f.warDragon.pos.y, z: f.warDragon.pos.z } }
              : null,
            crashDetached: f.crashDetached,
            slowmoSeen: f.slowmoSeen,
            warHorns: f.warHornCount,
            crownY: app.mission?.worldLayout.spireCrownMesh?.position.y ?? null,
          };
        },
        assaultInfo() {
          const m = app.mission;
          const f = m?.finale;
          if (!m || !f) return null;
          return { ...f.assaultState, soldiers: m.enemies.aliveSoldierCount() };
        },
        checkpoint() {
          return app.checkpoint;
        },
        restoreCheckpoint() {
          return app.restoreCheckpoint();
        },
        forceLand() {
          app.mission?.finale?.forceLand();
        },
        setFinalePhase(p: string) {
          return app.mission?.finale?.skipTo(p as any) ?? false;
        },
        getBuildingStates() {
          const m = app.mission;
          if (!m) return [];
          return m.buildings.buildings.map((b) => ({
            tag: b.tag,
            hp: Math.round(b.hp),
            maxHp: b.maxHp,
            state: b.visualState,
            collapsed: b.collapsed,
          }));
        },
        getAmbientPairs() {
          const amb = app.mission?.ambient;
          if (!amb) return null;
          return { count: amb.pairCount(), tiers: amb.tierHistogram() };
        },
        triggerVolley() {
          return app.mission?.enemies.forceVolley() ?? false;
        },
      },
    };
  }

  // autostart for tests
  if (params.get("autostart") === "1") {
    const rider = params.get("rider") ?? "rhaenyra";
    const dragon = params.get("dragon") ?? "syrax";
    const mission = params.get("mission") ?? "dragonstone";
    const difficulty = params.get("difficulty") ?? "normal";
    await app.startMission(mission, rider, dragon, difficulty as any);
  } else if (benchmark) {
    const seconds = Number(params.get("seconds") ?? 30);
    await app.startMission(params.get("mission") ?? "riverlands", "daemon", "caraxes", "normal");
    // wait for mission to exist, then start measuring
    setTimeout(() => app.startBenchmark(seconds), 1000);
  }

  // hide initial loading screen
  const ls = document.getElementById("loading-screen");
  if (ls) {
    ls.classList.add("hidden");
  }

  void getDragon;
  void getRider;
  void rankFor;
  void scoreMission;
}

boot().catch((e) => {
  console.error("[boot] fatal", e);
  const ls = document.getElementById("loading-status");
  if (ls) ls.textContent = "Boot failed — see console";
});
