import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  Scene,
  ShadowGenerator,
  UniversalCamera,
  Vector3,
  MeshBuilder,
  StandardMaterial,
} from "@babylonjs/core";
import type { AbstractEngine } from "@babylonjs/core";
import type { DragonDefinition } from "../data/dragons";
import type { RiderDefinition } from "../data/riders";
import { DragonRig } from "../world/DragonRig";
import { buildSkyAndHorizon } from "../world/Terrain";

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

  constructor(private engine: AbstractEngine, canvas: HTMLCanvasElement) {
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

    const spire = MeshBuilder.CreateCylinder("spire", { diameterTop: 14, diameterBottom: 34, height: 46, tessellation: 7 }, this.scene);
    spire.position.y = -18;
    const spireMat = new StandardMaterial("spireMat", this.scene);
    spireMat.diffuseColor = new Color3(0.24, 0.22, 0.2);
    spireMat.emissiveColor = new Color3(0.05, 0.045, 0.04);
    spire.material = spireMat;
    spire.freezeWorldMatrix();

    const hemi = new HemisphericLight("menuHemi", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.5;
    hemi.diffuse = new Color3(0.7, 0.65, 0.6);
    hemi.groundColor = new Color3(0.1, 0.08, 0.07);
    const sun = new DirectionalLight("menuSun", new Vector3(-0.35, -0.75, -0.4), this.scene);
    sun.intensity = 1.0;
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

    canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener("pointerup", () => (this.dragging = false));
    window.addEventListener("pointermove", (e) => {
      if (this.dragging) {
        this.theta -= (e.clientX - this.lastX) * 0.008;
        this.lastX = e.clientX;
        this.autoOrbit = 0;
      }
    });
  }

  setDragon(def: DragonDefinition, rider?: RiderDefinition): void {
    if (rider) this.riderDef = rider;
    if (this.rigDef?.id === def.id && !rider) return;
    this.rig?.dispose();
    this.rigDef = def;
    this.rig = new DragonRig(this.scene, def, this.riderDef ?? undefined);
    this.rig.root.position.set(0, 9, 0);
    this.rig.root.rotationQuaternion = null;
    this.rig.root.rotation.y = Math.PI * 0.85;
    const shadows = (this.scene as any).__shadows as ShadowGenerator;
    for (const m of this.rig.root.getChildMeshes()) shadows?.addShadowCaster(m);
  }

  setMode(mode: "menu" | "select"): void {
    if (mode === "menu") {
      this.radius = 85;
      this.height = 26;
      if (this.autoOrbit === 0) this.autoOrbit = 0.05;
    } else {
      this.radius = 26;
      this.height = 7.5;
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.theta += this.autoOrbit * dt;
    const x = Math.sin(this.theta) * this.radius;
    const z = Math.cos(this.theta) * this.radius;
    this.camera.position.set(x, this.height, z);
    this.camera.setTarget(new Vector3(0, this.rig ? 6.5 : 0, 0));
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
    this.scene.dispose();
  }
}
