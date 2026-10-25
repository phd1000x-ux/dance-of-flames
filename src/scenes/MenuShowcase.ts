import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  Scene,
  ShadowGenerator,
  UniversalCamera,
  Vector3,
  Viewport,
  MeshBuilder,
  StandardMaterial,
} from "@babylonjs/core";
import type { AbstractEngine } from "@babylonjs/core";
import type { DragonDefinition } from "../data/dragons";
import type { RiderDefinition } from "../data/riders";
import { CharacterModel, loadCharacterAssets, prepareDragon, prepareKnight, anchorDragon, poseMountedKnight, seatKnight } from "../world/CharacterAssets";
import { DragonRig } from "../world/DragonRig";
import { weatheredRock } from "../world/SceneryGeometry";
import { texturedMaterial } from "../world/WorldMaterials";
import { buildSkyAndHorizon } from "../world/Terrain";
import { PostPipeline, postConfigForTier } from "../engine/PostPipeline";

/**
 * Lightweight menu background scene: showcased dragon on a rock spire,
 * drag-to-rotate, slow auto-orbit, drifting clouds.
 */
export class MenuShowcase {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  private rig: DragonRig | null = null;
  private rigDef: DragonDefinition | null = null;
  private riderDef: RiderDefinition | null = null;
  private theta = 0.6;
  private radius = 70;
  private height = 14;
  private autoOrbit = 0.05;
  private t = 0;
  private dragging = false;
  private lastX = 0;
  private post: PostPipeline;
  private imported: { dragon: CharacterModel; knight: CharacterModel } | null = null;
  private generation = 0;
  private mode: "menu" | "select" = "menu";
  private readonly pointerDown = (e: PointerEvent) => this.beginRotation(e.clientX);
  private readonly pointerUp = () => this.endRotation();
  private readonly pointerMove = (e: PointerEvent) => this.rotateTo(e.clientX);

  constructor(private engine: AbstractEngine, private canvas: HTMLCanvasElement, private opts: { postFX?: boolean; characters?: boolean } = {}) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color3(0.09, 0.07, 0.06).toColor4(1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = new Color3(0.16, 0.12, 0.1);
    this.scene.fogDensity = 0.004;

    buildSkyAndHorizon(this.scene, 31337, { silhouette: "cliffs", fogColor: "#2a201a", skyBottom: "#241a14" });

    const sea = MeshBuilder.CreateGround("menuSea", { width: 4000, height: 4000 }, this.scene);
    sea.position.y = -40;
    const seaMat = new StandardMaterial("menuSeaMat", this.scene);
    seaMat.diffuseColor = new Color3(0.08, 0.12, 0.16);
    seaMat.emissiveColor = new Color3(0.03, 0.05, 0.08);
    seaMat.specularColor = new Color3(0.3, 0.35, 0.45);
    sea.material = seaMat;
    sea.freezeWorldMatrix();

    const spire = weatheredRock("spire", 712, this.scene);
    spire.scaling.set(14, 42, 13);
    spire.position.y = -27;
    const spireMat = texturedMaterial(this.scene, "showcaseBasalt", "rock", {
      uScale: 5, vScale: 10, tint: new Color3(0.38, 0.39, 0.4),
    });
    spire.material = spireMat;
    spire.freezeWorldMatrix();

    const hemi = new HemisphericLight("menuHemi", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.85;
    hemi.diffuse = new Color3(0.86, 0.87, 0.92);
    hemi.groundColor = new Color3(0.1, 0.08, 0.07);
    const sun = new DirectionalLight("menuSun", new Vector3(-0.35, -0.75, -0.4), this.scene);
    sun.intensity = 1.5;
    sun.diffuse = new Color3(1.0, 0.82, 0.6);
    const shadows = new ShadowGenerator(512, sun);
    shadows.darkness = 0.4;
    (this.scene as any).__shadows = shadows;

    this.camera = new UniversalCamera("menuCam", new Vector3(30, 12, 30), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.3;
    this.camera.maxZ = 3000;
    this.camera.fov = (50 * Math.PI) / 180;
    this.camera.setTarget(Vector3.Zero());

    canvas.addEventListener("pointerdown", this.pointerDown);
    window.addEventListener("pointerup", this.pointerUp);
    window.addEventListener("pointermove", this.pointerMove);

    this.post = new PostPipeline(this.scene, postConfigForTier(0, opts.postFX !== false));
  }

  setDragon(def: DragonDefinition, rider?: RiderDefinition): void {
    if (rider) this.riderDef = rider;
    if (this.rigDef?.id === def.id && !rider) return;
    const generation = ++this.generation;
    this.imported = null;
    this.rig?.dispose();
    this.rigDef = def;
    this.rig = new DragonRig(this.scene, def, this.riderDef ?? undefined);
    this.rig.root.position.set(0, 9, 0);
    this.rig.root.rotationQuaternion = null;
    this.rig.root.rotation.y = Math.PI * 0.85;
    const shadows = (this.scene as any).__shadows as ShadowGenerator;
    const rig = this.rig;
    const fallbackMeshes = rig.root.getChildMeshes();
    for (const m of fallbackMeshes) shadows?.addShadowCaster(m);
    if (this.opts.characters === false) return;
    void loadCharacterAssets(this.scene).then(containers => {
      if (this.scene.isDisposed || generation !== this.generation || rig.root.isDisposed()) return;
      const dragon = new CharacterModel(containers[0], "showcase-dragon", this.scene);
      const knight = new CharacterModel(containers[1], "showcase-knight", this.scene);
      prepareDragon(dragon, def);
      prepareKnight(knight, this.riderDef?.color);
      dragon.root.parent = rig.root;
      knight.root.parent = rig.root;
      for (const m of fallbackMeshes) m.setEnabled(false);
      for (const m of [...dragon.root.getChildMeshes(), ...knight.root.getChildMeshes()]) shadows?.addShadowCaster(m);
      this.imported = { dragon, knight };
      this.update(0);
    }).catch(error => {
      if (!this.scene.isDisposed) console.warn("Menu character fallback:", error);
    });
  }

  setMode(mode: "menu" | "select"): void {
    this.mode = mode;
    if (mode === "menu" && this.autoOrbit === 0) this.autoOrbit = 0.05;
  }

  beginRotation(clientX: number): void { this.dragging = true; this.lastX = clientX; }
  rotateTo(clientX: number): void {
    if (!this.dragging) return;
    this.theta -= (clientX - this.lastX) * 0.008;
    this.lastX = clientX;
    this.autoOrbit = 0;
  }
  endRotation(): void { this.dragging = false; }

  update(dt: number): void {
    this.t += dt;
    this.theta += this.autoOrbit * dt;
    const scale = this.rigDef?.scale ?? 1;
    const width = this.canvas.clientWidth || this.engine.getRenderWidth();
    const height = this.canvas.clientHeight || this.engine.getRenderHeight();
    // Render the preview into the actual unobscured portion of the UI.
    // Using the viewport also makes the projection fit the center column's aspect ratio.
    if (this.mode === "menu") {
      this.camera.viewport = new Viewport(0.28, 0, 0.72, 1);
    } else {
      // fit the real center column (panels shrink on small windows); fixed widths are the fallback
      const center = document.querySelector(".charselect-center")?.getBoundingClientRect();
      const fits = center && center.width > 40;
      const left = fits ? Math.max(0, center.left) : Math.min(300, width * 0.3);
      const right = fits ? Math.max(0, width - center.right) : Math.min(320, width * 0.3);
      this.camera.viewport = new Viewport(left / width, 0, (width - left - right) / width, 1);
    }
    const aspect = width * this.camera.viewport.width / Math.max(1, height);
    this.radius = (this.mode === "menu" ? 34 : 30) * Math.max(1, scale) * Math.max(1, 0.95 / aspect);
    this.height = this.mode === "menu" ? 22 : 14;
    const x = Math.sin(this.theta) * this.radius;
    const z = Math.cos(this.theta) * this.radius;
    this.camera.position.set(x, this.height, z);
    this.camera.setTarget(new Vector3(0, this.rig ? 9 : 0, 0));
    if (this.imported && this.rig) {
      const { dragon, knight } = this.imported;
      dragon.sample(dt, 0.65);
      anchorDragon(dragon);
      knight.sample(dt);
      poseMountedKnight(knight);
      seatKnight(dragon, knight, this.rig.root, scale);
    }
    this.rig?.animate({
      flapRate: 2.4,
      flapAmp: 0.55,
      sweep: 0.05,
      jawOpen: 0,
      dt,
    });
  }

  render(): void {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    this.update(dt);
    this.scene.render();
  }

  dispose(): void {
    ++this.generation;
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    window.removeEventListener("pointerup", this.pointerUp);
    window.removeEventListener("pointermove", this.pointerMove);
    this.post.dispose();
    this.scene.dispose();
  }
}
