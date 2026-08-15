import { RIDERS, type RiderDefinition } from "../data/riders";
import { DRAGONS, type DragonDefinition } from "../data/dragons";
import { MISSIONS, type MissionDefinition } from "../data/missions";
import { DIFFICULTIES, type DifficultyId } from "../data/difficulty";
import { SHOP_UPGRADES, type ShopUpgradeDef } from "../data/upgrades";
import { MANUAL_SECTIONS } from "../data/manual";
import type { GameSettings, SaveData } from "../save/SaveSystem";
import type { MissionStats } from "../mission/Scoring";
import { rankFor } from "../mission/Scoring";
import { HudController } from "./HudController";

export interface UiCallbacks {
  onContinue(): void;
  onNewCampaign(): void;
  onBattle(): void;
  onSettings(): void;
  onCredits(): void;
  onSelectionChange(riderId: string, dragonId: string): void;
  onConfirmSelection(riderId: string, dragonId: string): void;
  onStartMission(missionId: string, difficulty: DifficultyId): void;
  onMissionMapBack(): void;
  onPause(): void;
  onResume(): void;
  onRestartMission(): void;
  onAbandon(): void;
  onSettingsChange(settings: GameSettings): void;
  onShopBuy(upgradeId: string): void;
  onShopClose(nextMission: boolean): void;
  onResultsContinue(): void;
}

/** Builds & manages all DOM screens (menus, shop, pause, results, settings). */
export class UIManager {
  private screens = new Map<string, HTMLElement>();
  hud: HudController;
  private selectedRider = "rhaenyra";
  private selectedDragon = "syrax";
  private selectedMission = "dragonstone";
  private selectedDifficulty: DifficultyId = "normal";
  private rendererInfo = "…";

  constructor(
    private root: HTMLElement,
    private cb: UiCallbacks,
    private settings: GameSettings,
    bus: any
  ) {
    this.buildScreens();
    this.hud = new HudController(root, bus, settings);
    window.addEventListener("keydown", this.menuKeyHandler);
  }

  private buildScreens(): void {
    this.makeScreen("main-menu", () => this.buildMainMenu());
    this.makeScreen("character-select", () => this.buildCharacterSelect());
    this.makeScreen("mission-select", () => this.buildMissionSelect());
    this.makeScreen("shop", () => this.buildShop());
    this.makeScreen("pause", () => this.buildPause());
    this.makeScreen("results", () => this.buildResults());
    this.makeScreen("settings", () => this.buildSettings());
    this.makeScreen("credits", () => this.buildCredits());
    this.makeScreen("manual", () => this.buildManual());
  }

  private makeScreen(id: string, build: () => HTMLElement): void {
    const screen = document.createElement("div");
    screen.className = "screen";
    screen.id = `screen-${id}`;
    screen.appendChild(build());
    this.root.appendChild(screen);
    this.screens.set(id, screen);
  }

  showScreen(id: string | null): void {
    this.activeScreenId = id;
    for (const [k, el] of this.screens) {
      el.classList.toggle("visible", k === id);
    }
    this.hud.show(id === null);
    if (id) {
      this.kbGroup = 0;
      this.kbIndex = 0;
      this.applyFocus();
    } else {
      this.clearKbFocus();
    }
  }

  /** currently visible screen id (null during gameplay) — used for input routing */
  getActiveScreen(): string | null {
    return this.activeScreenId;
  }

  // ---------------- keyboard menu navigation ----------------
  private activeScreenId: string | null = null;
  private kbGroup = 0;
  private kbIndex = 0;
  private focusedEl: HTMLElement | null = null;
  private manualTab = 0;
  private manualReturnTo = "main-menu";

  private menuKeyHandler = (e: KeyboardEvent) => {
    if (!this.activeScreenId) return;
    const code = e.code;
    const isUp = code === "KeyW" || code === "ArrowUp";
    const isDown = code === "KeyS" || code === "ArrowDown";
    const isLeft = code === "KeyA" || code === "ArrowLeft";
    const isRight = code === "KeyD" || code === "ArrowRight";
    const isConfirm = code === "Enter" || code === "NumpadEnter" || code === "Space";
    const isBack = code === "Escape";
    if (!isUp && !isDown && !isLeft && !isRight && !isConfirm && !isBack) return;
    e.preventDefault();
    if (this.activeScreenId === "manual") {
      this.manualKey(isLeft, isRight, isUp || isDown ? (isUp ? -1 : 1) : 0, isConfirm, isBack);
      return;
    }
    if (isBack) {
      this.navSound();
      this.navBack();
      return;
    }
    if (isConfirm) {
      this.activateFocused();
      return;
    }
    if (isUp) this.move(-1);
    if (isDown) this.move(1);
    if (isLeft) this.adjust(-1);
    if (isRight) this.adjust(1);
  };

  private focusGroupsFor(id: string): HTMLElement[][] {
    const s = this.screens.get(id);
    if (!s) return [];
    const q = (sel: string) => Array.from(s.querySelectorAll(sel)) as HTMLElement[];
    const enabled = (els: HTMLElement[]) => els.filter((el) => !(el as HTMLButtonElement).disabled);
    switch (id) {
      case "main-menu":
        return [enabled(q(".menu-btn"))];
      case "character-select":
        return [
          q("#rider-list .roster-item"),
          q("#dragon-list .roster-item"),
          enabled(q(".charselect-actions .btn")),
        ];
      case "mission-select":
        return [
          q(".map-marker:not(.locked)"),
          [...q("#difficulty-picker .btn"), ...enabled(q(".charselect-actions .btn"))],
        ];
      case "shop":
        return [enabled(q(".shop-item .btn")), enabled(q(".shop-header [data-act]"))];
      case "pause":
      case "results":
      case "credits":
        return [enabled(q(".modal-btns .btn"))];
      case "settings":
        return [q(".setting-row"), enabled(q(".settings-panel [data-act='back']"))];
      default:
        return [];
    }
  }

  private applyFocus(): void {
    const groups = this.focusGroupsFor(this.activeScreenId ?? "");
    if (!groups.length) {
      this.clearKbFocus();
      return;
    }
    this.kbGroup = Math.min(this.kbGroup, groups.length - 1);
    const g = groups[this.kbGroup];
    if (!g.length) return;
    this.kbIndex = Math.max(0, Math.min(this.kbIndex, g.length - 1));
    const el = g[this.kbIndex];
    if (el === this.focusedEl) return;
    this.clearKbFocus();
    this.focusedEl = el;
    el.classList.add("kb-focused");
    el.scrollIntoView({ block: "nearest" });
    this.navSound();
  }

  private clearKbFocus(): void {
    this.focusedEl?.classList.remove("kb-focused");
    this.focusedEl = null;
  }

  private applyFocusIfActive(id: string): void {
    if (this.activeScreenId === id) this.applyFocus();
  }

  private move(dir: 1 | -1): void {
    const groups = this.focusGroupsFor(this.activeScreenId ?? "");
    const g = groups[this.kbGroup];
    if (!g || !g.length) return;
    this.kbIndex = (this.kbIndex + dir + g.length) % g.length;
    this.applyFocus();
  }

  private adjust(dir: 1 | -1): void {
    const id = this.activeScreenId;
    if (!id) return;
    if (id === "settings") {
      this.adjustSettingRow(dir);
      return;
    }
    if (id === "mission-select" && this.focusedEl?.closest("#difficulty-picker")) {
      // difficulty picker: A/D cycles the difficulty directly
      const s = this.screens.get("mission-select");
      const btns = Array.from(s?.querySelectorAll("#difficulty-picker .btn") ?? []) as HTMLElement[];
      const idx = btns.indexOf(this.focusedEl);
      const next = btns[Math.max(0, Math.min(btns.length - 1, (idx < 0 ? 0 : idx) + dir))];
      next?.click();
      return;
    }
    // multi-panel screens: A/D switches panel group
    const groups = this.focusGroupsFor(id);
    if (groups.length > 1) {
      this.kbGroup = (this.kbGroup + dir + groups.length) % groups.length;
      this.kbIndex = 0;
      this.applyFocus();
    }
  }

  private activateFocused(): void {
    const el = this.focusedEl;
    if (!el) return;
    this.click();
    if (el.classList.contains("setting-row")) {
      const toggle = el.querySelector(".toggle-btn") as HTMLElement | null;
      toggle?.click();
      return;
    }
    el.click();
  }

  private adjustSettingRow(dir: 1 | -1): void {
    const row = this.focusedEl;
    if (!row || !row.classList.contains("setting-row")) return;
    const range = row.querySelector("input[type='range']") as HTMLInputElement | null;
    if (range) {
      const step = parseFloat(range.step) || 0.1;
      range.value = String(Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), parseFloat(range.value) + step * dir)));
      range.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const select = row.querySelector("select") as HTMLSelectElement | null;
    if (select) {
      select.selectedIndex = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + dir));
      select.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const toggle = row.querySelector(".toggle-btn") as HTMLElement | null;
    toggle?.click();
  }

  private navBack(): void {
    switch (this.activeScreenId) {
      case "character-select":
      case "mission-select":
      case "credits":
        (window as any).__UI?.goBack?.();
        break;
      case "settings":
        (window as any).__UI?.settingsBack?.();
        break;
      case "manual":
        this.manualBack();
        break;
      case "pause":
        this.cb.onResume();
        break;
      case "shop":
        this.cb.onShopClose(false);
        break;
      default:
        break;
    }
  }

  private navSound(): void {
    (window as any).__UI?.onUiSound?.();
  }

  setRendererInfo(info: string): void {
    this.rendererInfo = info;
    const el = document.querySelector("#renderer-info");
    if (el) el.textContent = info;
  }

  // ---------------- main menu ----------------
  private buildMainMenu(): HTMLElement {
    const d = this.el("div", "main-menu");
    d.innerHTML = `
      <div class="game-title">DANCE OF FLAMES</div>
      <div class="game-subtitle">DRAGONRIDER</div>
      <button class="menu-btn" data-act="continue">CONTINUE</button>
      <button class="menu-btn" data-act="new">NEW CAMPAIGN</button>
      <button class="menu-btn" data-act="battle">BATTLE</button>
      <button class="menu-btn" data-act="manual">MANUAL</button>
      <button class="menu-btn" data-act="settings">SETTINGS</button>
      <button class="menu-btn" data-act="credits">CREDITS</button>
      <div class="menu-kb-hint"><span class="key">W / S</span> NAVIGATE &nbsp;&nbsp; <span class="key">ENTER</span> SELECT</div>
      <div class="menu-footer">A fan-made battle simulator inspired by the world of Westeros.<br>All assets procedural &amp; original.</div>`;
    d.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!t) return;
      this.click();
      switch (t.dataset.act) {
        case "continue": this.cb.onContinue(); break;
        case "new": this.cb.onNewCampaign(); break;
        case "battle": this.cb.onBattle(); break;
        case "manual": this.showManual("main-menu"); break;
        case "settings": this.cb.onSettings(); break;
        case "credits": this.cb.onCredits(); break;
      }
    });
    return d;
  }

  setContinueEnabled(enabled: boolean): void {
    const btn = this.screens.get("main-menu")?.querySelector('[data-act="continue"]') as HTMLButtonElement | null;
    if (btn) btn.disabled = !enabled;
    // if keyboard focus was on CONTINUE, move it to the next enabled item
    this.applyFocusIfActive("main-menu");
  }

  // ---------------- character select ----------------
  private buildCharacterSelect(): HTMLElement {
    const d = this.el("div", "");
    d.innerHTML = `
      <div class="charselect-layout">
        <div class="panel">
          <div class="panel-title">CHOOSE RIDER</div>
          <div class="rider-list" id="rider-list"></div>
        </div>
        <div class="charselect-center">
          <div class="drag-hint">DRAG TO ROTATE — dragon shown at true scale</div>
        </div>
        <div class="panel">
          <div class="panel-title" id="cs-dragon-name">SYRAX</div>
          <div class="section-label">DRAGON</div>
          <div class="dragon-list" id="dragon-list"></div>
          <div class="section-label" style="margin-top:14px">BATTLE STATS</div>
          <div class="stat-rows" id="cs-stats"></div>
          <div class="charselect-name" id="cs-rider-name" style="margin-top:14px"></div>
          <div class="charselect-epithet" id="cs-rider-epithet"></div>
          <div class="charselect-desc" id="cs-desc"></div>
          <div class="charselect-actions">
            <button class="btn ghost" data-act="back">BACK</button>
            <button class="btn" data-act="confirm">CONFIRM</button>
          </div>
        </div>
      </div>`;
    d.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!t) return;
      this.click();
      if (t.dataset.act === "back") historyBack();
      else if (t.dataset.act === "confirm") this.cb.onConfirmSelection(this.selectedRider, this.selectedDragon);
      function historyBack() {
        (window as any).__UI?.goBack?.();
      }
    });
    return d;
  }

  populateCharacterSelect(save: SaveData | null): void {
    if (save?.selectedRider) this.selectedRider = save.selectedRider;
    if (save?.selectedDragon) this.selectedDragon = save.selectedDragon;
    this.rebuildRiderList();
    this.rebuildDragonList();
    this.updateCharSelectDetails();
  }

  private rebuildRiderList(): void {
    const list = this.screens.get("character-select")?.querySelector("#rider-list") as HTMLElement;
    if (!list) return;
    list.innerHTML = "";
    for (const r of RIDERS) {
      const item = this.el("div", `roster-item ${r.id === this.selectedRider ? "selected" : ""}`);
      item.dataset.rider = r.id;
      const bonded = DRAGONS.find((x) => x.id === r.bondedDragonId);
      item.innerHTML = `
        <div class="roster-sigil">${r.name.charAt(0)}</div>
        <div>
          <div class="roster-name">${r.name}</div>
          <div class="roster-sub">${r.title}</div>
        </div>
        ${this.selectedDragon === r.bondedDragonId ? '<span class="bonded-badge">BONDED</span>' : ""}`;
      item.addEventListener("click", () => {
        this.click();
        this.selectedRider = r.id;
        this.selectedDragon = r.bondedDragonId;
        this.rebuildRiderList();
        this.rebuildDragonList();
        this.updateCharSelectDetails();
        this.cb.onSelectionChange(this.selectedRider, this.selectedDragon);
      });
      list.appendChild(item);
    }
  }

  private rebuildDragonList(): void {
    const list = this.screens.get("character-select")?.querySelector("#dragon-list") as HTMLElement;
    if (!list) return;
    list.innerHTML = "";
    for (const dg of DRAGONS) {
      const item = this.el("div", `roster-item ${dg.id === this.selectedDragon ? "selected" : ""}`);
      item.dataset.dragon = dg.id;
      const bondedTo = RIDERS.find((r) => r.bondedDragonId === dg.id);
      item.innerHTML = `
        <div class="roster-sigil" style="background:${dg.bodyColor}22;border-color:${dg.bodyColor};color:${dg.bodyColor}">${dg.name.charAt(0)}</div>
        <div>
          <div class="roster-name">${dg.name}</div>
          <div class="roster-sub">${dg.epithet}</div>
        </div>
        ${bondedTo && bondedTo.id === this.selectedRider ? '<span class="bonded-badge">BONDED</span>' : ""}`;
      item.addEventListener("click", () => {
        this.click();
        this.selectedDragon = dg.id;
        this.rebuildDragonList();
        this.rebuildRiderList();
        this.updateCharSelectDetails();
        this.cb.onSelectionChange(this.selectedRider, this.selectedDragon);
      });
      list.appendChild(item);
    }
  }

  private updateCharSelectDetails(): void {
    const screen = this.screens.get("character-select");
    if (!screen) return;
    const dragon = DRAGONS.find((x) => x.id === this.selectedDragon) ?? DRAGONS[0];
    const rider = RIDERS.find((x) => x.id === this.selectedRider) ?? RIDERS[0];
    (screen.querySelector("#cs-dragon-name") as HTMLElement).textContent = dragon.name.toUpperCase();
    (screen.querySelector("#cs-rider-name") as HTMLElement).textContent = rider.name;
    (screen.querySelector("#cs-rider-epithet") as HTMLElement).textContent = rider.title;
    (screen.querySelector("#cs-desc") as HTMLElement).textContent = dragon.description;

    const maxHp = Math.max(...DRAGONS.map((x) => x.maxHealth));
    const maxFire = Math.max(...DRAGONS.map((x) => x.fireDamage));
    const maxSpeed = Math.max(...DRAGONS.map((x) => x.maxSpeed));
    const maxArmor = Math.max(...DRAGONS.map((x) => x.armor));
    const maxTurn = Math.max(...DRAGONS.map((x) => x.turnRate));
    const bars: [string, number][] = [
      ["HEALTH", dragon.maxHealth / maxHp],
      ["FIRE", dragon.fireDamage / maxFire],
      ["SPEED", dragon.maxSpeed / maxSpeed],
      ["ARMOR", dragon.armor / maxArmor],
      ["AGILITY", dragon.turnRate / maxTurn],
    ];
    const stats = screen.querySelector("#cs-stats") as HTMLElement;
    stats.innerHTML = bars
      .map(
        ([label, v]) => `
        <div class="stat-row">
          <div class="stat-label">${label}</div>
          <div class="stat-bar"><div class="stat-fill" style="width:${Math.round(v * 100)}%"></div></div>
        </div>`
      )
      .join("");
  }

  // ---------------- mission select ----------------
  private buildMissionSelect(): HTMLElement {
    const d = this.el("div", "");
    const markers: Record<string, { x: number; y: number }> = {
      dragonstone: { x: 72, y: 68 },
      riverlands: { x: 44, y: 48 },
      harrenhal: { x: 40, y: 33 },
      kingslanding: { x: 58, y: 66 },
    };
    d.innerHTML = `
      <div class="mission-layout">
        <div class="map-panel" id="map-panel">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M18,8 L48,4 78,12 92,30 84,52 90,74 66,96 34,92 8,70 6,38 Z"
              fill="#c2b088" stroke="#8a7648" stroke-width="0.8"/>
            <path d="M30,20 L52,14 74,22 82,36 72,44 54,40 38,46 26,36 Z" fill="#a8b088" opacity="0.7"/>
            <path d="M20,60 L40,56 58,62 70,74 52,84 30,80 Z" fill="#9aa8b8" opacity="0.6"/>
            <path d="M14,38 L24,32 36,40 30,50 18,48 Z" fill="#8a9a78" opacity="0.5"/>
          </svg>
          ${MISSIONS.map((m) => {
            const p = markers[m.id];
            return `<div class="map-marker" data-mission="${m.id}" style="left:${p.x}%;top:${p.y}%">
              <div class="marker-label">${m.location.toUpperCase()}</div>
              <div class="marker-pin"></div>
            </div>`;
          }).join("")}
        </div>
        <div class="panel mission-details" id="mission-details"></div>
      </div>`;
    d.addEventListener("click", (e) => {
      const mk = (e.target as HTMLElement).closest("[data-mission]") as HTMLElement | null;
      if (mk) {
        this.click();
        this.selectedMission = mk.dataset.mission!;
        this.refreshMissionDetails(unlockedRef, bestRef);
        return;
      }
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!t) return;
      this.click();
      if (t.dataset.act === "back") (window as any).__UI?.goBack?.();
      if (t.dataset.act === "start") {
        const locked = !unlockedRef.includes(this.selectedMission);
        if (!locked) this.cb.onStartMission(this.selectedMission, this.selectedDifficulty);
      }
    });
    // refs refreshed by populate
    let unlockedRef: string[] = ["dragonstone"];
    let bestRef: Record<string, number> = {};
    (this as any)._missionRefs = {
      set: (unlocked: string[], best: Record<string, number>) => {
        unlockedRef = unlocked;
        bestRef = best;
      },
    };
    return d;
  }

  populateMissionSelect(save: SaveData): void {
    const refs = (this as any)._missionRefs;
    refs?.set(save.unlockedMissions, save.bestScores);
    this.selectedDifficulty = (save.selectedDifficulty as DifficultyId) ?? "normal";
    this.refreshMissionDetails(save.unlockedMissions, save.bestScores);
    this.applyFocusIfActive("mission-select");
  }

  private refreshMissionDetails(unlocked: string[], best: Record<string, number>): void {
    const screen = this.screens.get("mission-select");
    if (!screen) return;
    // marker locked styling
    screen.querySelectorAll(".map-marker").forEach((mk) => {
      const id = (mk as HTMLElement).dataset.mission!;
      mk.classList.toggle("selected", id === this.selectedMission);
      mk.classList.toggle("locked", !unlocked.includes(id));
    });
    const m = MISSIONS.find((x) => x.id === this.selectedMission) ?? MISSIONS[0];
    const locked = !unlocked.includes(m.id);
    const bestScore = best[m.id];
    const details = screen.querySelector("#mission-details") as HTMLElement;
    details.innerHTML = `
      <div class="panel-title">${m.name.toUpperCase()}</div>
      <div class="desc">${m.description}</div>
      <div class="mission-meta">
        <div class="row"><span>Enemy Strength</span><span>${"◆".repeat(Math.min(5, Math.round(m.enemyPower * 2)))}</span></div>
        <div class="row"><span>Recommended Power</span><span>${m.recommendedPower}</span></div>
        <div class="row"><span>Reward</span><span>${m.coinBonus} + loot</span></div>
        <div class="row"><span>Best Score</span><span>${bestScore ?? "—"}</span></div>
      </div>
      <div class="section-label">DIFFICULTY</div>
      <div class="difficulty-picker" id="difficulty-picker">
        ${DIFFICULTIES.map(
          (df) => `<button class="btn ${df.id === this.selectedDifficulty ? "active" : ""}" data-diff="${df.id}">${df.label}</button>`
        ).join("")}
      </div>
      <div class="desc" id="diff-desc">${DIFFICULTIES.find((x) => x.id === this.selectedDifficulty)?.description ?? ""}</div>
      <div class="charselect-actions">
        <button class="btn ghost" data-act="back">BACK</button>
        <button class="btn" data-act="start" ${locked ? "disabled" : ""}>${locked ? "LOCKED" : "LAUNCH"}</button>
      </div>`;
    details.querySelectorAll("[data-diff]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.click();
        this.selectedDifficulty = (btn as HTMLElement).dataset.diff as DifficultyId;
        this.refreshMissionDetails(unlocked, best);
      });
    });
  }

  // ---------------- shop ----------------
  private buildShop(): HTMLElement {
    const d = this.el("div", "");
    d.innerHTML = `
      <div class="shop-layout panel" id="shop-layout">
        <div class="shop-header">
          <div class="panel-title" style="border:none;margin:0">ARMORY &amp; DRAGON LORE</div>
          <div class="shop-coins" id="shop-coins">0</div>
        </div>
        <div class="shop-col" id="shop-dragon"></div>
        <div class="shop-col" id="shop-rider"></div>
        <div class="shop-col" id="shop-consumable"></div>
        <div class="shop-header">
          <button class="btn ghost" data-act="menu">MAIN MENU</button>
          <button class="btn" data-act="next">NEXT MISSION</button>
        </div>
      </div>`;
    d.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!t) return;
      this.click();
      if (t.dataset.act === "buy") this.cb.onShopBuy(t.dataset.id!);
      if (t.dataset.act === "menu") this.cb.onShopClose(false);
      if (t.dataset.act === "next") this.cb.onShopClose(true);
    });
    return d;
  }

  populateShop(coins: number, levels: Record<string, number>): void {
    const screen = this.screens.get("shop");
    if (!screen) return;
    (screen.querySelector("#shop-coins") as HTMLElement).innerHTML =
      `<span class="coin-icon"></span>${coins}`;
    const cats: ShopUpgradeDef["category"][] = ["dragon", "rider", "consumable"];
    for (const cat of cats) {
      const col = screen.querySelector(`#shop-${cat}`) as HTMLElement;
      col.innerHTML = `<div class="section-label">${cat.toUpperCase()}</div>`;
      for (const u of SHOP_UPGRADES.filter((x) => x.category === cat)) {
        const lvl = levels[u.id] ?? 0;
        const maxed = lvl >= u.maxLevel;
        const price = maxed ? 0 : u.prices[lvl];
        const item = this.el("div", "shop-item");
        item.innerHTML = `
          <div>
            <div class="si-name">${u.name}</div>
            <div class="si-desc">${u.description}</div>
            <div class="si-level">${"◆".repeat(lvl)}${"◇".repeat(u.maxLevel - lvl)} <span style="color:var(--parchment-dark)">Lv ${lvl}/${u.maxLevel}</span></div>
          </div>
          ${maxed
            ? '<button class="btn" disabled>MAX</button>'
            : `<button class="btn" data-act="buy" data-id="${u.id}" ${coins < price ? "disabled" : ""}>${price}</button>`}`;
        col.appendChild(item);
      }
    }
    // re-apply keyboard focus after the DOM rebuild (keep position)
    this.applyFocusIfActive("shop");
  }

  // ---------------- pause ----------------
  private buildPause(): HTMLElement {
    const d = this.el("div", "");
    d.innerHTML = `
      <div class="modal-center"><div class="panel">
        <div class="panel-title">PAUSED</div>
        <div class="modal-btns">
          <button class="btn" data-act="resume">RESUME</button>
          <button class="btn ghost" data-act="controls">CONTROLS</button>
          <button class="btn ghost" data-act="settings">SETTINGS</button>
          <button class="btn ghost" data-act="restart">RESTART MISSION</button>
          <button class="btn danger" data-act="abandon">ABANDON MISSION</button>
        </div>
      </div></div>`;
    d.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!t) return;
      this.click();
      switch (t.dataset.act) {
        case "resume": this.cb.onResume(); break;
        case "controls": this.showManual("pause"); break;
        case "settings": this.cb.onSettings(); break;
        case "restart": this.cb.onRestartMission(); break;
        case "abandon": this.cb.onAbandon(); break;
      }
    });
    return d;
  }

  // ---------------- manual (single source: data/manual.ts) ----------------
  private buildManual(): HTMLElement {
    const d = this.el("div", "");
    d.innerHTML = `
      <div class="manual-screen"><div class="panel manual-panel">
        <div class="panel-title">MANUAL</div>
        <div class="manual-tabs" id="manual-tabs"></div>
        <div class="manual-content" id="manual-content"></div>
        <div class="modal-btns"><button class="btn" data-act="manual-back">BACK</button></div>
        <div class="manual-hint">[ A / D ] — SWITCH SECTION&nbsp;&nbsp;[ W / S ] — SCROLL&nbsp;&nbsp;[ ESC ] — BACK</div>
      </div></div>`;
    d.addEventListener("click", (e) => {
      const back = (e.target as HTMLElement).closest("[data-act='manual-back']");
      if (back) {
        this.click();
        this.manualBack();
        return;
      }
      const tab = (e.target as HTMLElement).closest(".manual-tab") as HTMLElement | null;
      if (tab?.dataset.tab !== undefined) {
        this.click();
        this.setManualTab(Number(tab.dataset.tab));
      }
    });
    return d;
  }

  showManual(returnTo: string): void {
    this.manualReturnTo = returnTo;
    this.renderManualTabs();
    this.setManualTab(0);
    this.showScreen("manual");
  }

  manualBack(): void {
    this.showScreen(this.manualReturnTo);
  }

  private manualKey(left: boolean, right: boolean, scroll: number, confirm: boolean, back: boolean): void {
    if (back || confirm) {
      this.click();
      this.manualBack();
      return;
    }
    if (left) this.setManualTab(this.manualTab - 1);
    if (right) this.setManualTab(this.manualTab + 1);
    if (scroll !== 0) {
      const content = this.screens.get("manual")?.querySelector("#manual-content") as HTMLElement | null;
      if (content) content.scrollTop += scroll * 60;
    }
  }

  private renderManualTabs(): void {
    const tabs = this.screens.get("manual")?.querySelector("#manual-tabs") as HTMLElement;
    if (!tabs) return;
    tabs.innerHTML = MANUAL_SECTIONS.map(
      (s, i) => `<button class="manual-tab" data-tab="${i}">${s.tab}</button>`
    ).join("");
  }

  private setManualTab(i: number): void {
    this.manualTab = ((i % MANUAL_SECTIONS.length) + MANUAL_SECTIONS.length) % MANUAL_SECTIONS.length;
    const sec = MANUAL_SECTIONS[this.manualTab];
    const screen = this.screens.get("manual");
    if (!screen) return;
    screen.querySelectorAll(".manual-tab").forEach((t, idx) => {
      (t as HTMLElement).classList.toggle("active", idx === this.manualTab);
    });
    const content = screen.querySelector("#manual-content") as HTMLElement;
    content.innerHTML = `
      <div class="manual-intro">${sec.intro ?? ""}</div>
      <div style="font-family:var(--font-title);font-size:17px;letter-spacing:4px;color:var(--gold);margin-bottom:8px;">${sec.title}</div>
      ${sec.entries
        .map(
          (en) =>
            `<div class="man-row"><span class="man-keys">${en.keys}</span><span class="man-label">${en.label}</span></div>`
        )
        .join("")}
      ${
        sec.footer
          ? `<div class="manual-footer">${sec.footer.map((f) => `<p>${f}</p>`).join("")}</div>`
          : ""
      }`;
    content.scrollTop = 0;
  }

  // ---------------- results ----------------
  private buildResults(): HTMLElement {
    const d = this.el("div", "");
    d.innerHTML = `
      <div class="modal-center"><div class="panel" id="results-panel">
        <div class="panel-title victory-title" id="results-title">VICTORY</div>
        <div class="rank-badge" id="results-rank">S</div>
        <div class="results-stats" id="results-stats"></div>
        <div class="modal-btns">
          <button class="btn" data-act="continue">CONTINUE</button>
        </div>
      </div></div>`;
    d.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!t) return;
      this.click();
      if (t.dataset.act === "continue") this.cb.onResultsContinue();
    });
    return d;
  }

  showResults(victory: boolean, stats: MissionStats, score: number, coinsEarned: number): void {
    const screen = this.screens.get("results");
    if (!screen) return;
    const rank = victory ? rankFor(score) : "—";
    (screen.querySelector("#results-title") as HTMLElement).textContent = victory ? "VICTORY" : "DEFEAT";
    (screen.querySelector("#results-title") as HTMLElement).className = `panel-title ${victory ? "victory-title" : "defeat-title"}`;
    (screen.querySelector("#results-rank") as HTMLElement).textContent = victory ? rank : "";
    const rows: [string, string][] = [
      ["Enemies Defeated", String(stats.kills)],
      ["Buildings Destroyed", String(stats.buildingsDestroyed)],
      ["Coins Collected", String(stats.coinsCollected)],
      ["Hidden Relics Found", String(stats.relicsFound)],
      ["Damage Taken", String(Math.round(stats.damageTaken))],
      ["Dragon Survived", stats.dragonSurvived ? "Yes" : "Fallen"],
      ["Completion Time", `${Math.floor(stats.timeSeconds / 60)}:${String(Math.floor(stats.timeSeconds % 60)).padStart(2, "0")}`],
      ["Score", victory ? String(score) : "—"],
      ["Coins Earned", `+${coinsEarned}`],
    ];
    (screen.querySelector("#results-stats") as HTMLElement).innerHTML = rows
      .map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`)
      .join("");
  }

  // ---------------- settings ----------------
  private buildSettings(): HTMLElement {
    const d = this.el("div", "");
    d.innerHTML = `
      <div class="modal-center"><div class="panel settings-panel">
        <div class="panel-title">SETTINGS</div>
        <div class="setting-row">
          <label>Graphics Preset</label>
          <select id="set-preset">
            <option value="low">LOW</option>
            <option value="medium">MEDIUM</option>
            <option value="high">HIGH</option>
            <option value="auto">AUTO (dynamic)</option>
          </select>
        </div>
        <div class="setting-row"><label>Camera Shake</label>
          <input type="range" id="set-shake" min="0" max="1" step="0.1"> <span class="setting-value" id="set-shake-v"></span></div>
        <div class="setting-row"><label>Speed Blur</label><button class="btn ghost toggle-btn" id="set-blur">OFF</button></div>
        <div class="setting-row"><label>Mouse Sensitivity</label>
          <input type="range" id="set-sens" min="0.4" max="2" step="0.1"> <span class="setting-value" id="set-sens-v"></span></div>
        <div class="setting-row"><label>Invert Y</label><button class="btn ghost toggle-btn" id="set-invert">OFF</button></div>
        <div class="setting-row"><label>Master Volume</label>
          <input type="range" id="set-master" min="0" max="1" step="0.05"> <span class="setting-value" id="set-master-v"></span></div>
        <div class="setting-row"><label>Effects Volume</label>
          <input type="range" id="set-fx" min="0" max="1" step="0.05"> <span class="setting-value" id="set-fx-v"></span></div>
        <div class="setting-row"><label>Show FPS</label><button class="btn ghost toggle-btn" id="set-fps">OFF</button></div>
        <div class="setting-row"><label>Keyboard Look Speed</label>
          <input type="range" id="set-kblook" min="0.4" max="2" step="0.1"> <span class="setting-value" id="set-kblook-v"></span></div>
        <div class="setting-row"><label>Keyboard Turn Speed</label>
          <input type="range" id="set-kbturn" min="0.5" max="1.5" step="0.05"> <span class="setting-value" id="set-kbturn-v"></span></div>
        <div class="setting-row"><label>Target Assist</label>
          <input type="range" id="set-assist" min="0" max="1" step="0.1"> <span class="setting-value" id="set-assist-v"></span></div>
        <div class="renderer-info" id="renderer-info">${this.rendererInfo}</div>
        <div class="modal-btns"><button class="btn" data-act="back">BACK</button></div>
      </div></div>`;

    const s = this.settings;
    d.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (t?.dataset.act === "back") {
        this.click();
        (window as any).__UI?.settingsBack?.();
        return;
      }
      // toggles
      if ((e.target as HTMLElement).id) {
        const id = (e.target as HTMLElement).id;
        if (id === "set-blur") {
          s.motionBlur = !s.motionBlur;
          this.refreshSettings();
          this.cb.onSettingsChange(s);
        } else if (id === "set-invert") {
          s.invertY = !s.invertY;
          this.refreshSettings();
          this.cb.onSettingsChange(s);
        } else if (id === "set-fps") {
          s.showFps = !s.showFps;
          this.refreshSettings();
          this.cb.onSettingsChange(s);
        }
      }
    });
    d.addEventListener("input", (e) => {
      const el = e.target as HTMLElement;
      switch (el.id) {
        case "set-preset":
          s.graphicsPreset = (el as HTMLSelectElement).value as GameSettings["graphicsPreset"];
          break;
        case "set-shake":
          s.cameraShake = parseFloat((el as HTMLInputElement).value);
          break;
        case "set-sens":
          s.mouseSensitivity = parseFloat((el as HTMLInputElement).value);
          break;
        case "set-master":
          s.masterVolume = parseFloat((el as HTMLInputElement).value);
          break;
        case "set-fx":
          s.effectsVolume = parseFloat((el as HTMLInputElement).value);
          break;
        case "set-kblook":
          s.keyboardLookSpeed = parseFloat((el as HTMLInputElement).value);
          break;
        case "set-kbturn":
          s.keyboardTurnSpeed = parseFloat((el as HTMLInputElement).value);
          break;
        case "set-assist":
          s.targetAssist = parseFloat((el as HTMLInputElement).value);
          break;
        default:
          return;
      }
      this.refreshSettings();
      this.cb.onSettingsChange(s);
    });
    (this as any)._settingsDom = d;
    return d;
  }

  refreshSettings(): void {
    const d = (this as any)._settingsDom as HTMLElement;
    if (!d) return;
    const s = this.settings;
    (d.querySelector("#set-preset") as HTMLSelectElement).value = s.graphicsPreset;
    const shake = d.querySelector("#set-shake") as HTMLInputElement;
    shake.value = String(s.cameraShake);
    (d.querySelector("#set-shake-v") as HTMLElement).textContent = String(Math.round(s.cameraShake * 100)) + "%";
    const sens = d.querySelector("#set-sens") as HTMLInputElement;
    sens.value = String(s.mouseSensitivity);
    (d.querySelector("#set-sens-v") as HTMLElement).textContent = s.mouseSensitivity.toFixed(1);
    (d.querySelector("#set-blur") as HTMLElement).textContent = s.motionBlur ? "ON" : "OFF";
    (d.querySelector("#set-blur") as HTMLElement).className = `btn ghost toggle-btn ${s.motionBlur ? "on" : ""}`;
    (d.querySelector("#set-invert") as HTMLElement).textContent = s.invertY ? "ON" : "OFF";
    (d.querySelector("#set-invert") as HTMLElement).className = `btn ghost toggle-btn ${s.invertY ? "on" : ""}`;
    const master = d.querySelector("#set-master") as HTMLInputElement;
    master.value = String(s.masterVolume);
    (d.querySelector("#set-master-v") as HTMLElement).textContent = String(Math.round(s.masterVolume * 100)) + "%";
    const fx = d.querySelector("#set-fx") as HTMLInputElement;
    fx.value = String(s.effectsVolume);
    (d.querySelector("#set-fx-v") as HTMLElement).textContent = String(Math.round(s.effectsVolume * 100)) + "%";
    (d.querySelector("#set-fps") as HTMLElement).textContent = s.showFps ? "ON" : "OFF";
    (d.querySelector("#set-fps") as HTMLElement).className = `btn ghost toggle-btn ${s.showFps ? "on" : ""}`;
    const kblook = d.querySelector("#set-kblook") as HTMLInputElement;
    kblook.value = String(s.keyboardLookSpeed ?? 1);
    (d.querySelector("#set-kblook-v") as HTMLElement).textContent = (s.keyboardLookSpeed ?? 1).toFixed(1);
    const kbturn = d.querySelector("#set-kbturn") as HTMLInputElement;
    kbturn.value = String(s.keyboardTurnSpeed ?? 1);
    (d.querySelector("#set-kbturn-v") as HTMLElement).textContent = (s.keyboardTurnSpeed ?? 1).toFixed(2);
    const assist = d.querySelector("#set-assist") as HTMLInputElement;
    assist.value = String(s.targetAssist ?? 0.5);
    (d.querySelector("#set-assist-v") as HTMLElement).textContent = String(Math.round((s.targetAssist ?? 0.5) * 100)) + "%";
  }

  // ---------------- credits ----------------
  private buildCredits(): HTMLElement {
    const d = this.el("div", "");
    d.innerHTML = `
      <div class="modal-center"><div class="panel credits-panel">
        <div class="panel-title">CREDITS</div>
        <p>DANCE OF FLAMES: DRAGONRIDER</p>
        <p>A fan-made 3D browser action game inspired by the world and lore of
        <i>House of the Dragon</i>. Not affiliated with HBO or George R. R. Martin.</p>
        <p>All 3D models, textures, sounds and music are procedurally generated at runtime.<br>
        No copyrighted assets are used.</p>
        <p>Built with TypeScript, Babylon.js (WebGPU / WebGL2), Vite &amp; WebAudio.</p>
        <div class="modal-btns"><button class="btn" data-act="back">BACK</button></div>
      </div></div>`;
    d.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-act='back']")) {
        this.click();
        (window as any).__UI?.goBack?.();
      }
    });
    return d;
  }

  private click(): void {
    (window as any).__UI?.onUiClick?.();
    (window as any).__UI?.onUiSound?.();
  }

  private el(tag: string, cls: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = cls;
    return e;
  }
}

export type { RiderDefinition, DragonDefinition, MissionDefinition };
