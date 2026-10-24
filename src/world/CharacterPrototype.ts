import { Color3, Matrix, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { MissionScene } from "../mission/MissionScene";
import { CharacterModel, loadCharacterAssets, prepareDragon, prepareKnight, anchorDragon } from "./CharacterAssets";

export async function installCharacterVisuals(mission: MissionScene, options: { debugPanel?: boolean } = {}): Promise<void> {
  const scene = mission.scene;
  const originalDragonMeshes = mission.rig.root.getChildMeshes();
  const containers = await loadCharacterAssets(scene);
  if (scene.isDisposed) return;
  const dragon = new CharacterModel(containers[0], "prototype-dragon", scene);
  const mounted = new CharacterModel(containers[1], "prototype-mounted-knight", scene);
  const ground = new CharacterModel(containers[1], "prototype-ground-knight", scene);
  const scale = mission.player.dragonDef.scale;
  prepareDragon(dragon, mission.player.dragonDef);
  dragon.root.parent = mission.rig.root;
  for (const knight of [mounted, ground]) prepareKnight(knight, mission.player.riderDef.color);
  const groundStandOffset = ground.root.position.clone();
  mounted.root.parent = mission.rig.root;
  mounted.root.position.set(0, 0.1 * scale, 0.6 * scale);
  ground.root.setEnabled(false);

  for (const mesh of [...dragon.root.getChildMeshes(), ...mounted.root.getChildMeshes(), ...ground.root.getChildMeshes()]) {
    mission.world.shadows?.addShadowCaster(mesh);
  }

  let enabled = true;
  let walkPhase = 0;
  let lastFigure: TransformNode | null = null;
  let originalGroundMeshes: ReturnType<TransformNode["getChildMeshes"]> = [];
  let sword: TransformNode | null = null;
  let simulatedTime = 0;
  let lastGroundPosition: Vector3 | null = null;
  const flightClip = dragon.clips[0];
  const head = dragon.node("fireBreath.") ?? dragon.node("head.");
  const originalHeadPosition = mission.rig.headTip.position.clone();
  const originalHeadParent = mission.rig.headTip.parent;
  const prototypeFraming = { distance: 26 * scale, height: 9 * scale, lookAhead: 6 * scale, minDistance: 26 * scale };

  function setEnabled(value: boolean): void {
    enabled = value;
    mission.dragonCam.visualFraming = value ? prototypeFraming : null;
    if (mission.phase === "dragon") mission.dragonCam.reset(mission.dragonCtrl);
    for (const mesh of originalDragonMeshes) mesh.setEnabled(!value);
    // Do not re-enable the original rider after dismounting.
    mission.rig.setRiderVisible(mission.phase === "dragon");
    if (value) for (const mesh of originalDragonMeshes) mesh.setEnabled(false);
    for (const mesh of originalGroundMeshes) mesh.setEnabled(!value);
    dragon.root.setEnabled(value);
    mounted.root.setEnabled(value && mission.phase === "dragon");
    ground.root.setEnabled(value && mission.phase === "ground");
    if (value && head) {
      mission.rig.headTip.parent = head;
      mission.rig.headTip.position.setAll(0);
    } else {
      mission.rig.headTip.parent = originalHeadParent;
      mission.rig.headTip.position.copyFrom(originalHeadPosition);
    }
  }

  function update(dt: number): void {
    simulatedTime += dt;
    const ctrl = mission.riderCtrl;
    const inGround = mission.phase === "ground" && ctrl !== null;
    if (ctrl && ctrl.figure.root !== lastFigure) {
      lastFigure = ctrl.figure.root;
      lastGroundPosition = ctrl.pos.clone();
      originalGroundMeshes = ctrl.figure.root.getChildMeshes();
      // Put the visual below the existing roll/death pivot, preserving all combat logic.
      ground.root.parent = ctrl.figure.body;
      ground.root.position.copyFrom(groundStandOffset);
      if (sword) sword.dispose();
      const wrist = ground.node("R_wrist_");
      if (wrist) {
        sword = new TransformNode("prototype-sword", scene);
        sword.parent = wrist;
        const units = 1 / ground.root.scaling.x;
        sword.scaling.setAll(units);
        sword.rotation.x = Math.PI / 2;
        const metal = new StandardMaterial("prototype-sword-metal", scene);
        metal.diffuseColor = new Color3(0.56, 0.6, 0.66);
        metal.specularColor = new Color3(0.9, 0.9, 0.95);
        sword.onDisposeObservable.addOnce(() => metal.dispose(false, false));
        const blade = MeshBuilder.CreateBox("prototype-blade", { width: 0.055, height: 0.9, depth: 0.025 }, scene);
        blade.parent = sword; blade.position.y = 0.47; blade.material = metal;
        const guard = MeshBuilder.CreateBox("prototype-guard", { width: 0.23, height: 0.04, depth: 0.06 }, scene);
        guard.parent = sword; guard.material = metal;
      }
      setEnabled(enabled);
    }
    if (!enabled) return;
    mounted.root.setEnabled(!inGround && mission.phase !== "ended");
    ground.root.setEnabled(inGround);
    dragon.sample(dt, mission.dragonCtrl.state === "BOOST" ? 1.25 : 0.8);
    // The source clip includes authored root translation. Keep locomotion owned
    // by DragonController rather than letting the mesh drift away from its rider/camera.
    anchorDragon(dragon);
    // Flight is authored; mouth opening is an additive combat pose.
    dragon.pose("jaw_01.", 0.24 * mission.dragonCtrl.jawOpen);
    mounted.sample(dt);
    mounted.pose("L_leg_", -1.05, 0, -0.32);
    mounted.pose("R_leg_", -1.05, 0, 0.32);
    mounted.pose("L_knee_", 1.25); mounted.pose("R_knee_", 1.25);
    mounted.pose("L_arm_", -0.65); mounted.pose("R_arm_", -0.65);
    mounted.root.rotation.x = 0.14 + (mission.dragonCtrl.state === "BOOST" ? 0.18 : 0);
    mounted.root.rotation.z = -mission.dragonCtrl.roll * 0.35;
    const seat = dragon.node("spine_03.");
    const riderHips = mounted.node("hips_");
    if (seat && riderHips) {
      const inverseFlight = Matrix.Invert(mission.rig.root.computeWorldMatrix(true));
      seat.computeWorldMatrix(true); riderHips.computeWorldMatrix(true);
      const desired = Vector3.TransformCoordinates(seat.getAbsolutePosition(), inverseFlight).add(new Vector3(0, 0.65 * scale, 0));
      const actual = Vector3.TransformCoordinates(riderHips.getAbsolutePosition(), inverseFlight);
      mounted.root.position.addInPlace(desired.subtract(actual));
    }
    if (!ctrl || !inGround) return;
    ground.sample(dt);
    // RiderController's public speed is not populated; derive motion from simulation positions.
    const speed = dt > 0 && lastGroundPosition ? Vector3.Distance(ctrl.pos, lastGroundPosition) / dt : 0;
    lastGroundPosition = ctrl.pos.clone();
    const moving = speed > 0.2 && ctrl.dodgeTimer <= 0;
    walkPhase += dt * (moving ? 5 + speed * 1.1 : 0);
    const stride = moving ? Math.min(0.72, speed * 0.11) : 0;
    const swing = Math.sin(walkPhase) * stride;
    ground.pose("L_leg_", swing); ground.pose("R_leg_", -swing);
    ground.pose("L_knee_", Math.max(0, -Math.sin(walkPhase)) * stride * 1.4);
    ground.pose("R_knee_", Math.max(0, Math.sin(walkPhase)) * stride * 1.4);
    ground.pose("L_arm_", -swing * 0.55); ground.pose("R_arm_", swing * 0.35);
    ground.pose("spine_", moving ? 0.08 : 0, Math.sin(walkPhase) * stride * 0.14);
    if (ctrl.attackState !== "none") {
      const duration = ctrl.attackState === "heavy" ? 0.62 : 0.34;
      const t = Math.max(0, Math.min(1, 1 - ctrl.attackTimer / duration));
      const windup = t < 0.28 ? t / 0.28 : Math.max(0, (1 - t) / 0.72);
      const strike = Math.sin(Math.max(0, (t - 0.22) / 0.78) * Math.PI);
      const side = ctrl.attackState === "light2" ? -1 : 1;
      ground.pose("chest_", -0.12 * strike, side * (0.5 * windup - 0.8 * strike));
      ground.pose("R_arm_", -1.6 * windup + 1.1 * strike, 0, -0.35 * side);
      ground.pose("R_elbow_", -0.65 * windup);
    } else if (ctrl.blocking) {
      ground.pose("L_arm_", -1.05, 0.3); ground.pose("L_elbow_", -0.8);
      ground.pose("R_arm_", -0.9); ground.pose("R_elbow_", -0.5);
    }
  }

  // Remount disposes the controller figure: detach the reusable imported visual first.
  const originalRemount = mission.remountDragon.bind(mission);
  mission.remountDragon = () => {
    ground.root.parent = null;
    ground.root.setEnabled(false);
    originalRemount();
    lastFigure = null;
    originalGroundMeshes = [];
  };

  setEnabled(true);
  const originalUpdate = mission.update.bind(mission);
  mission.update = dt => { originalUpdate(dt); update(dt); };
  update(0);

  scene.onDisposeObservable.addOnce(() => {
    for (const model of [dragon, mounted, ground]) if (!model.root.isDisposed()) model.root.dispose(false, false);
  });
  if (!options.debugPanel) return;
  const panel = document.createElement("aside");
  panel.id = "character-prototype-panel";
  panel.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:1000;max-width:min(430px,calc(100vw - 32px));padding:12px 16px;background:#14171bea;color:#e9e5da;border:1px solid #837451;border-radius:6px;font:13px/1.6 system-ui";
  panel.innerHTML = `<strong>캐릭터 시제품 · D2 + R2</strong><div>드래곤: 원본 비행 / 기수: 원본 대기 + 임시 관절 동작</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"><button type="button" data-action="ground">지상에서 확인</button><button type="button" data-action="flight">비행으로 복귀</button><button type="button" data-action="compare">기존 캐릭터 비교</button></div><div>비행 WASD · Space/C · F / 지상 WASD · J/K · L · Space</div><details><summary>무료 에셋 및 제작자</summary><a href="https://sketchfab.com/3d-models/animated-dragon-three-motion-loops-eca98cf6cd084c1596cecf716e110c29" target="_blank" rel="noopener" style="color:#e3c78e">Dragon — LasquetiSpice</a><br><a href="https://sketchfab.com/3d-models/strong-knight-9d912e0fedb44b619fbd2a083bbf174f" target="_blank" rel="noopener" style="color:#e3c78e">Strong Knight — DJMaesen</a><br>CC BY 4.0 · Objaverse 공개 배포본 · 크기/방향/관절 동작 수정</details><div role="status" id="prototype-status">외형과 움직임 확인용. 최종 애니메이션은 아닙니다.</div>`;
  for (const button of panel.querySelectorAll("button")) {
    button.style.cssText = "padding:7px 10px;cursor:pointer;background:#343a40;color:#fff;border:1px solid #777;border-radius:4px;font:inherit";
    button.addEventListener("click", () => {
      const status = panel.querySelector<HTMLElement>("#prototype-status")!;
      if (button.dataset.action === "compare") {
        setEnabled(!enabled);
        button.textContent = enabled ? "기존 캐릭터 비교" : "새 캐릭터 보기";
      } else if (button.dataset.action === "ground" && mission.phase === "dragon") {
        const p = mission.dragonCtrl.pos.clone();
        // A clear, level location beside the training village, with the same terrain grounding.
        p.y = mission.world.terrain.heightAt(p.x, p.z);
        mission.scriptedDismount(p); update(0);
        status.textContent = "J/K 공격 · L 방어 · Space 회피 · 비행으로 복귀 가능";
      } else if (button.dataset.action === "flight" && mission.phase === "ground" && mission.player.dragonHp > 0) {
        // Keep the imported knight alive when the disposable controller figure is released.
        ground.root.parent = null; ground.root.setEnabled(false);
        mission.remountDragon();
        mission.dragonCtrl.pos.y = mission.world.terrain.heightAt(mission.dragonCtrl.pos.x, mission.dragonCtrl.pos.z) + 45;
        mission.dragonCam.reset(mission.dragonCtrl);
        lastFigure = null; originalGroundMeshes = []; update(0);
        status.textContent = "WASD 비행 · Space/C 고도 · F 화염";
      }
      button.blur();
    });
  }
  document.body.append(panel);
  // Panel clicks are UI actions, not sword/fire input or mouse steering.
  for (const event of ["mousedown", "mousemove", "wheel"]) {
    panel.addEventListener(event, e => e.stopPropagation());
  }
  (window as any).__CHARACTER_PROTOTYPE = {
    dragon, mounted, ground, mission, setEnabled,
    get enabled() { return enabled; },
    get simulatedTime() { return simulatedTime; },
    clips: { dragon: flightClip?.name, knight: ground.clips[0]?.name },
  };
  scene.onDisposeObservable.addOnce(() => {
    panel.remove();
    for (const model of [dragon, mounted, ground]) if (!model.root.isDisposed()) model.root.dispose(false, false);

    delete (window as any).__CHARACTER_PROTOTYPE;
  });
}

/** Backwards-compatible opt-in comparison tools. */
export function installCharacterPrototype(mission: MissionScene): Promise<void> {
  return installCharacterVisuals(mission, { debugPanel: true });
}
