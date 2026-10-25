import { Color3, GlowLayer, Mesh, Vector3, type Material, PBRMaterial, StandardMaterial } from "@babylonjs/core";
import { addCastellanRegalia } from "./CastellanRegalia";
import { addRoleGear } from "./RoleGear";
import type { MissionScene } from "../mission/MissionScene";
import type { Soldier, SoldierState } from "../ai/EnemyManager";
import type { EnemyDefinition } from "../data/enemies";
import { CharacterModel, HeldWeapon, loadCharacterAssets, loadGuardAsset, prepareGuard, prepareKnight, tintCharacter, type WeaponKind } from "./CharacterAssets";
import guardRig from "../data/guard-rig.json";
import { swingPose } from "./CharacterPrototype";
import { KnightClipPlayer, loadKnightClips, type KnightClipData } from "./KnightClips";

type Role = EnemyDefinition["role"];

/** Which held props each role carries (main hand first). */
export function loadoutForRole(role: Role): { main: WeaponKind; off?: WeaponKind } {
  switch (role) {
    case "archer": return { main: "bow" };
    case "spear": return { main: "spear" };
    case "shield": return { main: "sword", off: "shield" };
    case "elite":
    case "commander": return { main: "greatsword" };
    default: return { main: "sword" };
  }
}

/** which mocap swing a soldier uses: heavy hitters cleave, others vary by id (unit tested) */
export function soldierAttackClip(role: Role, id: number): "light1" | "light2" | "light3" | "heavy" {
  if (role === "elite" || role === "commander") return "heavy";
  if (role === "spear") return "light3"; // high straight strike reads as a thrust
  return (["light1", "light2", "light3"] as const)[id % 3];
}

export type Stance = "idle" | "walk" | "run" | "draw" | "swing" | "burning" | "dead";

/** Pure state → stance mapping (unit tested). speed is ground speed in m/s. */
export function stanceFor(state: SoldierState, role: Role, speed: number, swinging: boolean): Stance {
  if (state === "dead") return "dead";
  if (state === "burning") return "burning";
  if (swinging || state === "meleeWindup") return "swing";
  if (role === "archer" && (state === "aim" || state === "alert" || state === "attack") && speed < 0.5) return "draw";
  if (speed > 3.2) return "run";
  if (speed > 0.35) return "walk";
  return "idle";
}

/** Max animated stand-ins at once; everyone else keeps the cheap merged mesh. */
const CAP = 40; // past this the old procedural figure shows (read as "robots" at 55m+)
/** Only soldiers this close to the player get a stand-in. */
const RANGE = 85;
const FOLLOW_THROUGH = 0.32;

interface Puppet {
  defId: string;
  model: CharacterModel;
  main: HeldWeapon;
  off: HeldWeapon | null;
  materials: Material[];
  soldier: Soldier | null;
  lastPos: Vector3;
  speed: number;
  walkPhase: number;
  lastState: SoldierState | null;
  follow: number;
  /** Mixamo mocap driver (null → code poses fallback) */
  clips: KnightClipPlayer | null;
  baseY: number;
  lastHp: number;
}

/** procedural emissive above its resting value, softened for PBR (unit tested) */
export function excessGlow(s: Pick<Soldier, "material" | "baseEmissive">): Color3 {
  const e = s.material.emissiveColor;
  const b = s.baseEmissive;
  return new Color3(Math.max(0, e.r - b.r), Math.max(0, e.g - b.g), Math.max(0, e.b - b.b)).scale(0.2); // dark metallic guard plate shows almost only emissive: 0.32 painted the Castellan solid yellow
}

/**
 * Spearmen carry the guard model's own spear (hidden by prepareGuard, since it
 * rides a free bone rather than the hand) in place of the procedural haft: it is
 * re-parented under the hand-held weapon node, its long axis on +Y and its
 * length/centre matched to the procedural spear the grip poses were tuned for.
 */
function useGuardSpear(model: CharacterModel, weapon: HeldWeapon): void {
  const spear = model.root.getChildMeshes().find(m => /Spear/i.test(m.material?.name ?? ""));
  if (!spear) return;
  const box = spear.getBoundingInfo().boundingBox;
  const s = 2.6 / Math.max(1e-6, box.extendSize.y * 2);
  spear.parent = weapon.node;
  spear.rotationQuaternion = null;
  spear.rotation.setAll(0);
  spear.scaling.setAll(s);
  spear.position.set(-box.center.x * s, 0.6 - box.center.y * s, -box.center.z * s);
  spear.setEnabled(true);
  for (const m of weapon.node.getChildMeshes()) if (m !== spear && /-(haft|point)$/.test(m.name)) m.dispose();
}

function emissiveOf(mat: Material): Color3 | null {
  if (mat instanceof PBRMaterial || mat instanceof StandardMaterial) return mat.emissiveColor;
  return null;
}

/**
 * Animated stand-ins for the nearest soldiers: the same imported knight as the
 * player (one art style across the battlefield), tinted to each enemy type's
 * team color, carrying role weapons and driven by code poses from the existing
 * soldier AI state. Gameplay (positions, hits, timing) stays in EnemyManager.
 */
export async function installSoldierVisuals(mission: MissionScene): Promise<void> {
  const scene = mission.scene;
  // soldiers wear the Armored Guard Knight so they never read as copies of the hero;
  // if it fails to load they fall back to the hero's knight and its clips
  const guard = await loadGuardAsset(scene).catch(() => null);
  if (scene.isDisposed) return;
  const body = guard ?? (await loadCharacterAssets(scene))[1];
  if (scene.isDisposed) return;
  const aliases: Record<string, string> = guard ? guardRig.aliases : {};
  // mocap baked onto the soldier rig; without it soldiers keep the code-authored poses
  const clipData: KnightClipData | null = await loadKnightClips(scene, guard ? "/character-prototype/guard-anims.json" : undefined).catch(() => null);
  if (scene.isDisposed) return;
  const pools = new Map<string, Puppet[]>();
  let created = 0;
  let serial = 0;

  function createPuppet(def: EnemyDefinition): Puppet {
    const id = serial++;
    created++;
    const model = new CharacterModel(body, `soldier-puppet-${id}`, scene, aliases);
    if (guard) prepareGuard(model); else prepareKnight(model);
    // soldiers stand a little shorter than the protagonist (2.05m)
    const k = (1.88 * def.scale) / 2.05;
    model.root.scaling.scaleInPlace(k);
    model.root.position.y *= k;
    tintCharacter(model, def.color, def.role === "elite" || def.role === "commander" ? 0.95 : 0.85);
    // front-lit polished plate mirrored the bright sky and washed the team color out
    for (const mat of new Set(model.root.getChildMeshes().map(x => x.material)))
      if (mat instanceof PBRMaterial) mat.environmentIntensity = 0.4;
    const loadout = loadoutForRole(def.role);
    const main = new HeldWeapon(model, loadout.main, `soldier-puppet-${id}-main`, scene, loadout.main === "bow" ? "L_wrist_" : "R_wrist_");
    const off = loadout.off ? new HeldWeapon(model, loadout.off, `soldier-puppet-${id}-off`, scene, "L_wrist_") : null;
    // mocap fists hold a hilt/haft/bow grip out of the thumb side
    if (clipData) main.fistGrip(loadout.main === "bow" ? "L" : "R");
    const clips = clipData ? new KnightClipPlayer(model, clipData, main, (id * 0.618) % 1) : null;
    const meshes = model.root.getChildMeshes();
    for (const m of meshes) m.receiveShadows = true;
    const materials = [...new Set(meshes.map(m => m.material).filter((m): m is Material => !!m))];
    // after the material list: the windup/hurt glow must not repaint the crown and cape
    // only the Castellan wears the crown — earlier commanders are his field officers
    if (def.role === "commander" && mission.missionId === "blackstone") addCastellanRegalia(model, scene);
    else if (guard) addRoleGear(model, def.role, def.color, scene);
    if (guard && loadout.main === "spear") useGuardSpear(model, main);
    // the telegraph is a tint on the armor, not a light source: kept out of the
    // GlowLayer, whose bloom washed whole (dark-armored) soldiers solid red/yellow
    const glow = scene.effectLayers.find((l): l is GlowLayer => l instanceof GlowLayer);
    for (const m of model.root.getChildMeshes()) if (m instanceof Mesh) glow?.addExcludedMesh(m);
    model.root.setEnabled(false);
    const p: Puppet = { defId: def.id, model, main, off, materials, soldier: null, lastPos: new Vector3(), speed: 0, walkPhase: 0, lastState: null, follow: 0, clips, baseY: model.root.position.y, lastHp: Infinity };
    if (!pools.has(def.id)) pools.set(def.id, []);
    pools.get(def.id)!.push(p);
    return p;
  }

  // prewarm for the roster actually present, so assignment never instantiates mid-fight
  const present = new Map<string, EnemyDefinition>();
  for (const s of mission.enemies.soldiers) present.set(s.def.id, s.def);
  for (const def of present.values()) for (let i = 0; i < (def.role === "commander" ? 1 : 3); i++) createPuppet(def);

  const assigned = new Map<Soldier, Puppet>();

  function release(s: Soldier): void {
    const p = assigned.get(s);
    if (!p) return;
    assigned.delete(s);
    p.soldier = null;
    p.model.root.parent = null;
    p.model.root.setEnabled(false);
    if (!s.root.isDisposed()) s.mesh.setEnabled(true);
  }

  function acquire(s: Soldier): void {
    const pool = pools.get(s.def.id) ?? [];
    let p = pool.find(x => !x.soldier) ?? null;
    if (!p) {
      // pools are per enemy type: once the budget is spent, recycle an idle puppet
      // of another type instead of leaving the old procedural figure on screen
      if (created >= CAP + 10) {
        for (const [id, other] of pools) {
          const i = other.findIndex(x => !x.soldier);
          if (i < 0 || id === s.def.id) continue;
          const victim = other.splice(i, 1)[0];
          victim.model.root.dispose(false, false);
          // per-puppet material clones go too; textures stay shared with the asset container
          for (const mat of victim.materials) mat.dispose(false, false);
          created--;
          break;
        }
      }
      if (created < CAP + 10) p = createPuppet(s.def);
    }
    if (!p) return;
    p.soldier = s;
    p.model.root.parent = s.root;
    p.model.root.position.x = 0;
    p.model.root.position.z = 0;
    p.model.root.rotation.setAll(0);
    p.model.root.setEnabled(true);
    p.lastPos.copyFrom(s.pos);
    p.speed = 0;
    p.lastState = s.state;
    p.follow = 0;
    p.lastHp = s.hp;
    s.mesh.setEnabled(false);
    assigned.set(s, p);
  }

  /** mocap path: clips do the body; weapons and the archer's draw layer on top */
  function animateClips(s: Soldier, p: Puppet, stance: Stance, dt: number): void {
    const m = p.model;
    const clips = p.clips!;
    const yaw = s.root.rotation.y;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(fwd.z, 0, -fwd.x);
    const heavy = s.def.role === "elite" || s.def.role === "commander";
    const windup = heavy ? 0.8 : 0.55;
    const swinging = stance === "swing";
    const t = !swinging ? 0 : s.state === "meleeWindup"
      ? 0.47 * Math.min(1, s.stateTime / windup)
      : 0.47 + 0.53 * (1 - p.follow / FOLLOW_THROUGH);
    const hurt = s.hp < p.lastHp - 0.5;
    p.lastHp = s.hp;
    m.sample(dt);
    clips.update({
      dt, speed: stance === "draw" ? 0 : p.speed, direction: 1, yaw,
      attack: swinging ? soldierAttackClip(s.def.role, s.id) : "none",
      attackT: t, contactT: 0.47,
      blocking: false, dodging: false,
      alive: stance !== "dead", hurt, burning: stance === "burning",
      driveWeapon: false,
    });
    const parentScale = s.root.absoluteScaling.y || 1;
    m.root.position.y = p.baseY + clips.rootOffsetY / parentScale;
    m.root.rotation.x = 0;

    let aim = 0;
    let aimDir: Vector3 | null = null;
    if (stance === "draw") {
      // no bow mocap: layer the draw over the idle clip
      m.pose("chest_", 0, -0.35);
      m.pose("L_arm_", 1.2, 0, -0.2);
      m.pose("R_arm_", 1.0, 0, 0.55); m.pose("R_elbow_", 1.1);
      aimDir = new Vector3(0, 1, 0).add(right.scale(-0.15));
      aim = 1;
    } else if (s.def.role === "spear" && stance !== "dead") {
      // point first during the strike, carried upright otherwise
      aimDir = swinging ? fwd.add(new Vector3(0, -0.08, 0)) : new Vector3(0, 1, 0).add(fwd.scale(0.15));
      aim = 1;
    }
    p.main.aim(aim, dt, aimDir, s.def.role === "archer" ? "L_arm_" : "R_arm_", s.def.role === "archer" ? "L_wrist_" : "R_wrist_");
  }

  function animate(s: Soldier, p: Puppet, dt: number): void {
    const m = p.model;
    const moved = Vector3.Distance(s.pos, p.lastPos);
    p.lastPos.copyFrom(s.pos);
    if (dt > 0) p.speed += (moved / dt - p.speed) * Math.min(1, dt * 8);
    // the strike lands on the meleeWindup → attack transition: play the follow-through
    if (p.lastState === "meleeWindup" && s.state === "attack") p.follow = FOLLOW_THROUGH;
    p.lastState = s.state;
    p.follow = Math.max(0, p.follow - dt);
    const stance = stanceFor(s.state, s.def.role, p.speed, p.follow > 0);
    if (p.clips) {
      animateClips(s, p, stance, dt);
      applyGlow(s, p, stance);
      return;
    }

    m.sample(dt);
    const fwd = new Vector3(Math.sin(s.root.rotation.y), 0, Math.cos(s.root.rotation.y));
    const right = new Vector3(fwd.z, 0, -fwd.x);
    let aim = 0;
    let aimDir: Vector3 | null = null;

    if (stance === "walk" || stance === "run" || stance === "burning") {
      const run = stance !== "walk";
      p.walkPhase += dt * (run ? 11 : 5 + p.speed * 1.1);
      const stride = run ? 0.72 : Math.min(0.6, p.speed * 0.2);
      const swing = Math.sin(p.walkPhase) * stride;
      m.pose("L_leg_", swing); m.pose("R_leg_", -swing);
      m.pose("L_knee_", Math.max(0, -Math.sin(p.walkPhase)) * stride * 1.4);
      m.pose("R_knee_", Math.max(0, Math.sin(p.walkPhase)) * stride * 1.4);
      m.pose("spine_", run ? 0.18 : 0.06, Math.sin(p.walkPhase) * stride * 0.14);
      if (stance === "burning") {
        // arms thrown up, flailing
        const f = Math.sin(p.walkPhase * 1.7);
        m.pose("L_arm_", 0.3, 0, 1.7 + 0.4 * f); m.pose("R_arm_", 0.3, 0, -1.7 + 0.4 * f);
      } else {
        m.pose("L_arm_", -swing * 0.55); m.pose("R_arm_", swing * 0.35);
      }
    }

    if (stance === "swing") {
      const windup = s.def.role === "elite" || s.def.role === "commander" ? 0.8 : 0.55;
      const t = s.state === "meleeWindup"
        ? 0.47 * Math.min(1, s.stateTime / windup)
        : 0.47 + 0.53 * (1 - p.follow / FOLLOW_THROUGH);
      const attack = s.def.role === "spear" ? "thrust" : s.def.role === "elite" || s.def.role === "commander" ? "heavy" : "light1";
      const sp = swingPose(attack, t);
      m.pose("spine_", sp.lean * 0.5, sp.twist * 0.4);
      m.pose("chest_", sp.lean * 0.5, sp.twist * 0.6);
      m.pose("R_arm_", sp.armX, 0, sp.armZ);
      if (s.def.role === "spear") {
        m.pose("L_arm_", sp.armX * 0.8, 0, 0.5); // both hands on the haft
        aimDir = fwd.add(new Vector3(0, -0.05, 0));
      } else if (p.off) {
        m.pose("L_arm_", 0.9, 0, 0.4); // shield up while striking
      }
      aim = 1;
    } else if (stance === "draw") {
      // bow arm extended toward the target, string hand drawn to the cheek
      m.pose("chest_", 0, -0.35);
      m.pose("L_arm_", 1.45, 0, -0.2);
      m.pose("R_arm_", 1.25, 0, 0.55); m.pose("R_elbow_", -1.3);
      aimDir = new Vector3(0, 1, 0).add(right.scale(-0.15));
      aim = 1;
    } else if (s.def.role === "spear" && stance !== "dead") {
      // spear carried upright
      aimDir = new Vector3(0, 1, 0).add(fwd.scale(0.15));
      aim = 1;
    }
    if (p.off && stance !== "swing" && stance !== "dead" && stance !== "burning") {
      m.pose("L_arm_", 0.55, 0, 0.35); // shield carried in front
    }
    p.main.aim(aim, dt, aimDir, s.def.role === "archer" ? "L_arm_" : "R_arm_", s.def.role === "archer" ? "L_wrist_" : "R_wrist_");

    // death: reuse the procedural soldier's fall angle and sink
    m.root.rotation.x = stance === "dead" ? s.mesh.rotation.x : 0;
    applyGlow(s, p, stance);
  }

  // Only the hit-flash / telegraph EXCESS over the procedural base glow carries
  // over: even the base 0.05 emissive washes the imported PBR armor out to white.
  function applyGlow(s: Soldier, p: Puppet, stance: Stance): void {
    const glow = stance === "burning"
      ? new Color3(0.5, 0.17, 0.03).scale(0.75 + 0.25 * Math.sin(performance.now() * 0.012))
      : stance === "dead" ? Color3.Black() : excessGlow(s);
    for (const mat of p.materials) emissiveOf(mat)?.copyFrom(glow);
  }

  let reassignT = 0;
  function update(dt: number): void {
    const focus = mission.phase === "ground" && mission.riderCtrl ? mission.riderCtrl.pos : mission.dragonCtrl.pos;
    reassignT -= dt;
    if (reassignT <= 0) {
      reassignT = 0.25;
      const ranked = mission.enemies.soldiers
        .filter(s => !s.root.isDisposed() && s.root.isEnabled())
        .map(s => ({ s, d: Vector3.DistanceSquared(s.pos, focus) }))
        .filter(x => x.d < RANGE * RANGE)
        .sort((a, b) => a.d - b.d);
      const keep = new Set(ranked.slice(0, CAP).map(x => x.s));
      // hysteresis: an already-animated soldier keeps its stand-in a little longer
      for (const x of ranked.slice(CAP, CAP + 4)) if (assigned.has(x.s)) keep.add(x.s);
      for (const s of [...assigned.keys()]) if (!keep.has(s)) release(s);
      for (const s of keep) if (!assigned.has(s)) acquire(s);
    }
    for (const [s, p] of assigned) {
      if (s.root.isDisposed() || !s.root.isEnabled()) { release(s); continue; }
      animate(s, p, dt);
    }
  }

  // animate on the scaled sim step so hit-stop / death slow-mo apply
  const originalUpdate = mission.update.bind(mission);
  mission.update = dt => { originalUpdate(dt); update(mission.lastSimDt); };

  (window as any).__SOLDIER_VISUALS = {
    get assigned() { return assigned.size; },
    get created() { return created; },
    puppets: () => [...assigned].map(([s, p]) => ({ id: s.id, role: s.def.role, state: s.state, visible: p.model.root.isEnabled(), procedural: s.mesh.isEnabled(), mocap: p.clips !== null })),
  };
  scene.onDisposeObservable.addOnce(() => {
    for (const pool of pools.values()) for (const p of pool) if (!p.model.root.isDisposed()) p.model.root.dispose(false, false);
    delete (window as any).__SOLDIER_VISUALS;
  });
}
