import type { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import type { GameSettings } from "../save/SaveSystem";
import { RELICS } from "../data/items";
import { worldToMap, arrowRotation } from "./MinimapMath";

export interface HudSnapshot {
  mode: "dragon" | "dying" | "ground";
  dragonHp: number;
  dragonMaxHp: number;
  fireFraction: number;
  canFire: boolean;
  superCharge: number;
  superReady: boolean;
  boost: number;
  riderHp: number;
  riderMaxHp: number;
  stamina: number;
  maxStamina: number;
  comboIndex: number; // 0..3
  blocking: boolean;
  coins: number;
  objective: { description: string; progress: number; need: number; completed: boolean; hint?: string } | null;
  tutorial: string | null;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  lowHp: boolean;
  boosting: boolean;
  healCharges: number;
  enemies: { x: number; z: number; role: string }[];
  ballistae: { x: number; z: number }[];
  buildings: { x: number; z: number; collapsed: boolean }[];
  loot: { x: number; z: number }[];
  bounds: number;
  lock: { x: number; y: number; kind: string } | null;
  objectives: { desc: string; progress: number; need: number; completed: boolean }[];
}

/** DOM-based gameplay HUD: dragon mode, ground mode, minimap, toasts, indicators. */
export class HudController {
  private root: HTMLElement;
  private hudDragon!: HTMLElement;
  private hudGround!: HTMLElement;
  private reticle!: HTMLElement;
  private hpFill!: HTMLElement;
  private hpLabel!: HTMLElement;
  private fireFill!: HTMLElement;
  private superFill!: HTMLElement;
  private superLabel!: HTMLElement;
  private boostFill!: HTMLElement;
  private riderHpFill!: HTMLElement;
  private staminaFill!: HTMLElement;
  private comboPips: HTMLElement[] = [];
  private coinsEl!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private objectiveCount!: HTMLElement;
  private objectiveHint!: HTMLElement;
  private tutorialEl!: HTMLElement;
  private minimap!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private relicToast!: HTMLElement;
  private vignette!: HTMLElement;
  private speedLines!: HTMLElement;
  private dmgDirContainer!: HTMLElement;
  private hitmarker!: HTMLElement;
  private healChargesEl!: HTMLElement;
  private lockBracket!: HTMLElement;
  private lockKindEl!: HTMLElement;
  private hudHint!: HTMLElement;
  private objectivesPanel!: HTMLElement;
  private objectivesList!: HTMLElement;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private fallenOverlay!: HTMLElement;
  private fallenTimer: ReturnType<typeof setTimeout> | null = null;
  private bossBar!: HTMLElement;
  private bossName!: HTMLElement;
  private bossFill!: HTMLElement;
  private subtitleBar!: HTMLElement;
  private subtitleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private parent: HTMLElement,
    private bus: EventBus<GameEvents>,
    private settings: GameSettings
  ) {
    this.root = this.el("div", "hud hidden");
    this.build();
    this.parent.appendChild(this.root);
    this.wire();
  }

  private el(tag: string, cls: string, html = ""): HTMLElement {
    const e = document.createElement(tag);
    e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  private build(): void {
    // ---- dragon mode HUD ----
    this.hudDragon = this.el("div", "hud-dragon");
    this.hudDragon.appendChild(this.buildReticle());

    const bl = this.el("div", "hud-bottom-left");
    bl.innerHTML = `
      <div class="hud-portrait" id="hud-portrait">S</div>
      <div class="bars">
        <div class="bar-row"><div class="bar-label"><span>DRAGON</span><span id="hp-label">1000/1000</span></div>
          <div class="bar"><div class="fill hp" id="hp-fill" style="width:100%"></div></div>
        </div>
        <div class="bar-row"><div class="bar-label"><span>BOOST</span><span></span></div>
          <div class="bar"><div class="fill boost" id="boost-fill" style="width:100%"></div></div>
        </div>
        <div class="bar-row"><div class="bar-label"><span>FLASKS [E]</span><span id="heal-charges">0</span></div>
        </div>
      </div>`;
    this.hudDragon.appendChild(bl);

    const bc = this.el("div", "hud-bottom-center");
    bc.innerHTML = `
      <div class="bar"><div class="fill fire" id="fire-fill" style="width:100%"></div></div>
      <div class="super-label" id="super-label">SUPER CHARGE</div>
      <div class="bar super-charging" id="super-bar"><div class="fill super" id="super-fill" style="width:0%"></div></div>`;
    this.hudDragon.appendChild(bc);

    const tr = this.el("div", "hud-top-right");
    const mm = document.createElement("canvas");
    mm.id = "minimap";
    mm.width = 176;
    mm.height = 176;
    tr.appendChild(mm);
    this.hudDragon.appendChild(tr);
    this.minimap = mm;
    this.minimapCtx = mm.getContext("2d")!;

    this.coinsEl = this.el("div", "hud-coins", `<span class="coin-icon"></span><span id="coin-count">0</span>`);
    this.hudDragon.appendChild(this.coinsEl);

    // ---- ground mode HUD ----
    this.hudGround = this.el("div", "hud-ground");
    const gbl = this.el("div", "hud-bottom-left");
    gbl.innerHTML = `
      <div class="hud-portrait" id="hud-portrait-g">R</div>
      <div class="bars">
        <div class="bar-row"><div class="bar-label"><span>RIDER</span><span id="rhp-label">200/200</span></div>
          <div class="bar"><div class="fill hp ally" id="rider-hp-fill" style="width:100%"></div></div>
        </div>
        <div class="bar-row"><div class="bar-label"><span>STAMINA</span><span></span></div>
          <div class="bar"><div class="fill stamina" id="stamina-fill" style="width:100%"></div></div>
        </div>
      </div>`;
    this.hudGround.appendChild(gbl);
    const gtr = this.el("div", "hud-top-right");
    const gmm = document.createElement("canvas");
    gmm.id = "minimap-ground";
    gmm.width = 176;
    gmm.height = 176;
    gtr.appendChild(gmm);
    this.hudGround.appendChild(gtr);
    const comboWrap = this.el("div", "combo-pips");
    for (let i = 0; i < 3; i++) {
      const pip = this.el("div", "combo-pip");
      comboWrap.appendChild(pip);
      this.comboPips.push(pip);
    }
    this.hudGround.appendChild(comboWrap);

    // shared
    const tc = this.el("div", "hud-top-center");
    tc.innerHTML = `
      <div class="objective-banner"><span id="objective-text">—</span><span class="obj-count" id="objective-count"></span></div>
      <div class="objective-hint" id="objective-hint"></div>`;
    this.root.appendChild(tc);

    this.tutorialEl = this.el("div", "tutorial-prompt", "");
    this.tutorialEl.style.display = "none";
    this.root.appendChild(this.tutorialEl);

    this.relicToast = this.el("div", "relic-toast", `
      <div class="rt-title">HIDDEN RELIC FOUND</div>
      <div class="rt-name">—</div>
      <div class="rt-effect">—</div>`);
    this.root.appendChild(this.relicToast);

    this.dmgDirContainer = this.el("div", "damage-dir");
    this.root.appendChild(this.dmgDirContainer);
    this.hitmarker = this.el("div", "hitmarker");
    this.root.appendChild(this.hitmarker);

    // target lock bracket (X)
    this.lockBracket = this.el("div", "lock-bracket", `<span class="lb-corner lb-tl"></span><span class="lb-corner lb-tr"></span><span class="lb-corner lb-bl"></span><span class="lb-corner lb-br"></span><span class="lb-kind"></span>`);
    this.lockBracket.style.display = "none";
    this.root.appendChild(this.lockBracket);
    this.lockKindEl = this.lockBracket.querySelector(".lb-kind") as HTMLElement;

    // transient gameplay hint (e.g. SUPER CHARGE NOT READY)
    this.hudHint = this.el("div", "hud-hint", "");
    this.hudHint.style.display = "none";
    this.root.appendChild(this.hudHint);

    // Tab objectives panel
    this.objectivesPanel = this.el("div", "objectives-panel", `
      <div class="op-title">MISSION OBJECTIVES</div>
      <div class="op-list" id="op-list"></div>
      <div class="op-hint">[ TAB ] — CLOSE</div>`);
    this.objectivesPanel.style.display = "none";
    this.root.appendChild(this.objectivesPanel);
    this.objectivesList = this.objectivesPanel.querySelector("#op-list") as HTMLElement;

    // DRAGON FALLEN cinematic transition overlay (Bug B)
    this.fallenOverlay = this.el("div", "dragon-fallen-overlay", `
      <div class="df-vignette"></div>
      <div class="df-content">
        <div class="df-title">DRAGON FALLEN</div>
        <div class="df-sub">Your dragon has fallen.</div>
        <div class="df-cta">CONTINUE THE BATTLE ON FOOT</div>
      </div>`);
    this.fallenOverlay.style.display = "none";
    this.parent.appendChild(this.fallenOverlay);

    // finale boss bar + cinematic subtitles
    this.bossBar = this.el("div", "boss-bar", `
      <div class="bb-name">—</div>
      <div class="bb-track"><div class="bb-fill"></div></div>`);
    this.bossBar.style.display = "none";
    this.parent.appendChild(this.bossBar);
    this.bossName = this.bossBar.querySelector(".bb-name") as HTMLElement;
    this.bossFill = this.bossBar.querySelector(".bb-fill") as HTMLElement;

    this.subtitleBar = this.el("div", "finale-subtitle", "");
    this.subtitleBar.style.display = "none";
    this.parent.appendChild(this.subtitleBar);

    this.root.appendChild(this.hudDragon);
    this.root.appendChild(this.hudGround);

    this.vignette = this.el("div", "low-hp-vignette");
    this.parent.appendChild(this.vignette);
    this.speedLines = this.el("div", "speed-lines");
    this.parent.appendChild(this.speedLines);
  }

  private buildReticle(): HTMLElement {
    const r = this.el("div", "reticle");
    r.innerHTML = `<div class="ret-arm top"></div><div class="ret-arm bottom"></div>
      <div class="ret-arm left"></div><div class="ret-arm right"></div><div class="ret-center"></div>`;
    return r;
  }

  private wire(): void {
    this.bus.on("player-damaged", (p) => {
      this.showDamageDirection(p.dirX, p.dirZ);
      this.flashHitmarker(false);
    });
    this.bus.on("hit-enemy", () => this.flashHitmarker(true));
    this.bus.on("relic-found", (e) => this.showRelicToast(e.relicId));
    this.bus.on("hud-hint", (e) => this.showHint(e.text));
    this.bus.on("toggle-objectives", (e) => {
      this.objectivesPanel.style.display = e.visible ? "block" : "none";
    });
    this.bus.on("dragon-fallen", () => this.showFallenTransition());
    this.bus.on("ground-begun", () => this.hideFallenTransition());
    this.bus.on("finale-boss", (e) => {
      this.bossBar.style.display = e.show ? "block" : "none";
      if (e.show) {
        this.bossName.textContent = e.name ?? "—";
        this.bossFill.style.width = `${Math.max(0, Math.min(1, e.hpFrac ?? 1)) * 100}%`;
      }
    });
    this.bus.on("finale-subtitle", (e) => {
      this.subtitleBar.textContent = e.text;
      this.subtitleBar.style.display = "block";
      if (this.subtitleTimer) clearTimeout(this.subtitleTimer);
      this.subtitleTimer = setTimeout(() => {
        this.subtitleBar.style.display = "none";
        this.subtitleTimer = null;
      }, e.ms);
    });
  }

  /** Bug B: DRAGON FALLEN cinematic transition (~2.6s) into ground combat */
  private showFallenTransition(): void {
    this.fallenOverlay.style.display = "block";
    // restart CSS animations
    this.fallenOverlay.classList.remove("show");
    void this.fallenOverlay.offsetWidth;
    this.fallenOverlay.classList.add("show");
    if (this.fallenTimer) clearTimeout(this.fallenTimer);
    this.fallenTimer = setTimeout(() => this.hideFallenTransition(), 2600);
  }

  private hideFallenTransition(): void {
    if (this.fallenTimer) {
      clearTimeout(this.fallenTimer);
      this.fallenTimer = null;
    }
    this.fallenOverlay.classList.remove("show");
    this.fallenOverlay.style.display = "none";
  }

  private showHint(text: string): void {
    this.hudHint.textContent = text;
    this.hudHint.style.display = "block";
    this.hudHint.classList.add("show");
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.hudHint.classList.remove("show");
      this.hudHint.style.display = "none";
    }, 1300);
  }

  show(v: boolean): void {
    this.root.classList.toggle("hidden", !v);
    if (!v) {
      this.vignette.style.opacity = "0";
      this.speedLines.style.opacity = "0";
      this.hideFallenTransition();
    }
  }

  setPortrait(letter: string): void {
    const p1 = this.root.querySelector("#hud-portrait") as HTMLElement;
    const p2 = this.root.querySelector("#hud-portrait-g") as HTMLElement;
    if (p1) p1.textContent = letter;
    if (p2) p2.textContent = letter;
  }

  update(s: HudSnapshot): void {
    const dragonMode = s.mode === "dragon" || s.mode === "dying";
    this.hudDragon.style.display = dragonMode ? "block" : "none";
    this.hudGround.style.display = s.mode === "ground" ? "block" : "none";

    if (dragonMode) {
      const hpPct = Math.max(0, (s.dragonHp / Math.max(1, s.dragonMaxHp)) * 100);
      const hpFill = this.root.querySelector("#hp-fill") as HTMLElement;
      hpFill.style.width = `${hpPct}%`;
      (this.root.querySelector("#hp-label") as HTMLElement).textContent = `${Math.ceil(s.dragonHp)}/${Math.ceil(s.dragonMaxHp)}`;
      (this.root.querySelector("#fire-fill") as HTMLElement).style.width = `${s.fireFraction * 100}%`;
      (this.root.querySelector("#boost-fill") as HTMLElement).style.width = `${s.boost * 100}%`;
      const superFill = this.root.querySelector("#super-fill") as HTMLElement;
      superFill.style.width = `${s.superCharge}%`;
      const superLabel = this.root.querySelector("#super-label") as HTMLElement;
      superLabel.textContent = s.superReady ? "SUPER READY — [R]" : "SUPER CHARGE";
      superLabel.className = `super-label ${s.superReady ? "ready" : ""}`;
      const superBar = this.root.querySelector("#super-bar") as HTMLElement;
      superBar.className = `bar ${s.superReady ? "super-charging" : ""}`;
      (this.root.querySelector("#heal-charges") as HTMLElement).textContent = String(s.healCharges);
      const ret = this.root.querySelector(".reticle") as HTMLElement;
      ret.className = `reticle ${s.superReady ? "super-ready" : ""}`;
      ret.style.opacity = s.mode === "dying" ? "0.3" : "1";
      this.vignette.style.opacity = hpPct < 30 ? String(0.35 + (1 - hpPct / 30) * 0.5) : "0";
      this.speedLines.style.opacity = s.boosting && this.settings.motionBlur ? "0.8" : "0";
      this.drawMinimap(s, this.minimapCtx);
    } else {
      const hpPct = Math.max(0, (s.riderHp / Math.max(1, s.riderMaxHp)) * 100);
      (this.root.querySelector("#rider-hp-fill") as HTMLElement).style.width = `${hpPct}%`;
      (this.root.querySelector("#rhp-label") as HTMLElement).textContent = `${Math.ceil(s.riderHp)}/${Math.ceil(s.riderMaxHp)}`;
      (this.root.querySelector("#stamina-fill") as HTMLElement).style.width = `${(s.stamina / Math.max(1, s.maxStamina)) * 100}%`;
      for (let i = 0; i < this.comboPips.length; i++) {
        this.comboPips[i].className = `combo-pip ${i < s.comboIndex ? "lit" : ""}`;
      }
      this.vignette.style.opacity = hpPct < 30 ? String(0.35 + (1 - hpPct / 30) * 0.5) : "0";
      const gmm = this.root.querySelector("#minimap-ground") as HTMLCanvasElement;
      const ctx = gmm.getContext("2d");
      if (ctx) this.drawMinimap(s, ctx);
    }

    (this.root.querySelector("#coin-count") as HTMLElement).textContent = String(s.coins);

    const objText = this.root.querySelector("#objective-text") as HTMLElement;
    const objCount = this.root.querySelector("#objective-count") as HTMLElement;
    const objHint = this.root.querySelector("#objective-hint") as HTMLElement;
    if (s.objective) {
      objText.textContent = s.objective.completed ? "MISSION COMPLETE" : s.objective.description;
      objCount.textContent = s.objective.completed
        ? ""
        : `${Math.floor(s.objective.progress)}/${s.objective.need}`;
      objHint.textContent = s.objective.hint ?? "";
    } else {
      objText.textContent = "—";
      objCount.textContent = "";
      objHint.textContent = "";
    }

    if (s.tutorial) {
      this.tutorialEl.style.display = "block";
      this.tutorialEl.innerHTML = s.tutorial.replace(/\[(.+?)\]/g, '<span class="key">$1</span>');
    } else {
      this.tutorialEl.style.display = "none";
    }

    // target lock bracket
    if (s.lock) {
      this.lockBracket.style.display = "block";
      this.lockBracket.style.left = `${s.lock.x - 34}px`;
      this.lockBracket.style.top = `${s.lock.y - 34}px`;
      this.lockKindEl.textContent = s.lock.kind.toUpperCase();
    } else {
      this.lockBracket.style.display = "none";
    }

    // objectives panel (Tab)
    if (this.objectivesPanel.style.display === "block") {
      this.objectivesList.innerHTML = s.objectives
        .map(
          (o) =>
            `<div class="op-row ${o.completed ? "done" : ""}"><span class="op-check">${o.completed ? "✓" : "○"}</span><span class="op-desc">${o.desc}</span><span class="op-count">${o.completed ? "" : `${Math.floor(o.progress)}/${o.need}`}</span></div>`
        )
        .join("");
    }
  }

  private drawMinimap(s: HudSnapshot, ctx: CanvasRenderingContext2D): void {
    const size = 176;
    const worldSize = s.bounds * 2 + 200;
    // single source of truth: src/ui/MinimapMath.ts (North=-Z up, East=+X right)
    const toMap = (x: number, z: number) => worldToMap(x, z, size, worldSize);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(20, 14, 8, 0.6)";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();

    // north indicator (map is NORTH-UP: fixed map, rotating player arrow)
    ctx.save();
    ctx.fillStyle = "rgba(240, 207, 142, 0.85)";
    ctx.font = "bold 10px Georgia";
    ctx.textAlign = "center";
    ctx.fillText("N", size / 2, 11);
    ctx.beginPath();
    ctx.moveTo(size / 2 - 3, 14);
    ctx.lineTo(size / 2 + 3, 14);
    ctx.lineTo(size / 2, 19);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // buildings
    for (const b of s.buildings) {
      const p = toMap(b.x, b.z);
      ctx.fillStyle = b.collapsed ? "rgba(90,70,50,0.6)" : "rgba(190,180,150,0.75)";
      ctx.fillRect(p.mx - 1.5, p.my - 1.5, 3, 3);
    }
    // loot (gold dots)
    ctx.fillStyle = "rgba(240,207,142,0.9)";
    for (const l of s.loot) {
      const p = toMap(l.x, l.z);
      ctx.fillRect(p.mx - 1, p.my - 1, 2, 2);
    }
    // enemies
    for (const e of s.enemies) {
      const p = toMap(e.x, e.z);
      if (e.role === "elite" || e.role === "commander") {
        ctx.fillStyle = "#e05050";
        ctx.beginPath();
        ctx.arc(p.mx, p.my, 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.role === "archer") {
        ctx.fillStyle = "rgba(220,120,80,0.9)";
        ctx.fillRect(p.mx - 1, p.my - 1, 2, 2);
      } else {
        ctx.fillStyle = "rgba(200,80,60,0.8)";
        ctx.fillRect(p.mx - 1, p.my - 1, 2, 2);
      }
    }
    // ballistae: distinct diamond shape (not color-only)
    for (const b of s.ballistae) {
      const p = toMap(b.x, b.z);
      ctx.fillStyle = "#ffb347";
      ctx.save();
      ctx.translate(p.mx, p.my);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2.5, -2.5, 5, 5);
      ctx.restore();
    }
    // player arrow
    const pp = toMap(s.playerX, s.playerZ);
    ctx.save();
    ctx.translate(pp.mx, pp.my);
    ctx.rotate(arrowRotation(s.playerYaw));
    ctx.fillStyle = "#7ac8f0";
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private showDamageDirection(dirX: number, dirZ: number): void {
    // rotate arrow toward incoming direction relative to screen (approx: use minimap north)
    const angle = Math.atan2(dirX, dirZ);
    const arrow = this.el("div", "arrow");
    arrow.style.transform = `translate(-50%,-50%) rotate(${angle}rad) translateY(-70px)`;
    this.dmgDirContainer.appendChild(arrow);
    setTimeout(() => arrow.remove(), 1000);
  }

  private flashHitmarker(onEnemy: boolean): void {
    if (!onEnemy) {
      this.hitmarker.style.borderColor = "rgba(220,60,60,0.9)";
    } else {
      this.hitmarker.style.borderColor = "rgba(255,220,150,0.9)";
    }
    this.hitmarker.classList.remove("show");
    void this.hitmarker.offsetWidth; // restart animation
    this.hitmarker.classList.add("show");
  }

  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  showRelicToast(relicId: string): void {
    const relic = RELICS.find((r) => r.id === relicId);
    if (!relic) return;
    this.relicToast.querySelector(".rt-name")!.textContent = relic.name;
    this.relicToast.querySelector(".rt-effect")!.textContent = relic.announce;
    this.relicToast.classList.add("show");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.relicToast.classList.remove("show"), 2800);
  }
}
