import { DEFAULT_BINDINGS, type GameAction } from "../input/InputState";

export interface ManualEntry {
  keys: string;
  label: string;
  /** linked action — the manual-accuracy test verifies keys match the binding */
  action?: GameAction;
  note?: string;
}

export interface ManualSection {
  id: string;
  tab: string;
  title: string;
  intro?: string;
  entries: ManualEntry[];
  footer?: string[];
}

/** Primary binding formatted for display ("KeyW" → "W", "ShiftLeft" → "Shift"). */
export function formatBinding(action: GameAction): string {
  const primary = DEFAULT_BINDINGS[action][0]
    .replace(/^Key/, "")
    .replace(/^Arrow/, "Arrow ")
    .replace(/^Digit/, "")
    .replace("ShiftLeft", "Shift")
    .replace("ShiftRight", "Shift")
    .replace("ControlLeft", "Ctrl")
    .replace("Space", "Space");
  return primary;
}

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: "flight",
    tab: "FLIGHT",
    title: "DRAGON FLIGHT",
    intro: "The dragon is fully controllable with the keyboard alone — no mouse required.",
    entries: [
      { keys: "W", label: "Accelerate / Fly Forward", action: "accelerate" },
      { keys: "S", label: "Decelerate / Air Brake", action: "decelerate" },
      { keys: "A / D", label: "Turn Dragon (bank left / right)", action: "turnLeft" },
      { keys: "Arrow Keys", label: "Look / Aim", action: "lookLeft" },
      { keys: "Space", label: "Climb", action: "climb" },
      { keys: "C", label: "Descend", action: "descend" },
      { keys: "Shift", label: "Boost", action: "boost" },
      { keys: "Q / E", label: "Dodge Left / Right", action: "dodgeLeft" },
      { keys: "Z", label: "Recenter Camera (level flight)", action: "recenterCamera" },
      { keys: "G", label: "Use Healing Flask / Consumable", action: "interact" },
    ],
  },
  {
    id: "combat",
    tab: "COMBAT",
    title: "DRAGON COMBAT",
    intro:
      "Aim with the Arrow Keys. A center-screen reticle plus soft target assist keeps keyboard aiming practical — you never need pixel-perfect aim.",
    entries: [
      { keys: "Arrow Keys", label: "Aim / Look", action: "lookLeft" },
      { keys: "F", label: "Fire Breath (hold)", action: "fire" },
      { keys: "R", label: "Super Charge Attack", action: "super" },
      { keys: "X", label: "Target Lock On / Off", action: "lockOn" },
      { keys: "Tab", label: "Mission Objectives", action: "objectives" },
      { keys: "Esc", label: "Pause Menu", action: "pause" },
    ],
    footer: [
      "FIRE GAUGE — the orange bar bottom-center drains while breathing fire and recharges when you stop. After a full depletion it must recover 20% before reigniting.",
      "BOOST — the blue bar drains while holding Shift and refills when released.",
      "SUPER CHARGE — the pulsing bar fills through combat and destruction. When it reads SUPER READY, press R to unleash a devastating fire beam.",
      "TARGET LOCK — press X toward enemies near your reticle: a gold bracket marks the target, the camera leans toward it, and your fire bends slightly to hit it. X again unlocks; dead targets release automatically.",
    ],
  },
  {
    id: "ground",
    tab: "GROUND",
    title: "GROUND COMBAT",
    intro:
      "If your dragon falls you keep fighting on foot. These keys are keyboard-native (mouse alternatives remain).",
    entries: [
      { keys: "W / A / S / D", label: "Move", action: "accelerate" },
      { keys: "Arrow Keys", label: "Camera / Aim", action: "lookLeft" },
      { keys: "J", label: "Light Attack (3-hit combo)", action: "lightAttack" },
      { keys: "K", label: "Heavy Attack (breaks shields)", action: "heavyAttack" },
      { keys: "L", label: "Block / Parry (tap = parry)", action: "block" },
      { keys: "Space", label: "Dodge Roll", action: "jump" },
      { keys: "Shift", label: "Sprint", action: "sprint" },
      { keys: "F", label: "Interact / Use Flask", action: "interactGround" },
      { keys: "X", label: "Target Lock On / Off", action: "lockOn" },
      { keys: "Z", label: "Recenter Camera", action: "recenterCamera" },
      { keys: "Esc", label: "Pause Menu", action: "pause" },
    ],
    footer: [
      "PARRY — block within the first instant of an enemy swing (their blade flashes red) to negate all damage and stagger nearby foes.",
      "SHIELD SOLDIERS shrug off light attacks from the front — hit them with K, or dodge behind them.",
    ],
  },
  {
    id: "menu",
    tab: "MENU",
    title: "MENU CONTROLS",
    intro: "Every screen — menus, shop, settings, manual, pause — works with the keyboard alone.",
    entries: [
      { keys: "W / Arrow Up", label: "Previous Item" },
      { keys: "S / Arrow Down", label: "Next Item" },
      { keys: "A / D / Arrow Left / Right", label: "Previous / Next Option or Panel" },
      { keys: "Enter / Space", label: "Select" },
      { keys: "Esc", label: "Back" },
    ],
  },
];

export function getManualSection(id: string): ManualSection {
  return MANUAL_SECTIONS.find((s) => s.id === id) ?? MANUAL_SECTIONS[0];
}
