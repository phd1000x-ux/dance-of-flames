import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { MissionDefinition } from "../data/missions";
import { SeededRng } from "../core/SeededRng";
import { Terrain, buildSkyAndHorizon } from "./Terrain";
import type { BuildingKind } from "./BuildingFactory";
import { PropLibrary } from "./PropLibrary";
import { CastleBuilder, type CastleAabb } from "./CastleBuilder";

export interface BuildingPlacement {
  kind: BuildingKind;
  tag: string;
  pos: Vector3;
  rotY: number;
  relicId?: string;
  variant?: string;
  hpFraction?: number;
}

export interface SquadPlacement {
  type: "swordsman" | "archer" | "spearman" | "shieldman" | "elite";
  count: number;
  center: Vector3;
  radius: number;
}

export interface BallistaPlacement {
  pos: Vector3;
  yaw: number;
}

export interface AmbientZonePlacement {
  center: Vector3;
  radiusSq: number;
}

export interface WorldLayout {
  buildings: BuildingPlacement[];
  squads: SquadPlacement[];
  ballistae: BallistaPlacement[];
  commanderPos: Vector3 | null;
  playerStart: Vector3;
  playerStartYaw: number;
  /** ambient audio zones */
  castleZone: { center: Vector3; radiusSq: number } | null;
  villageZones: AmbientZonePlacement[];
  /** static castle wall collision for ground mode */
  castleAabbs: CastleAabb[];
}

export interface WorldContext {
  terrain: Terrain;
  sun: DirectionalLight;
  hemi: HemisphericLight;
  shadows: ShadowGenerator | null;
  layout: WorldLayout;
  props: PropLibrary;
}

/**
 * Builds the full mission environment: terrain, sky, fog, lights, props,
 * and generates the data-driven battlefield layout from the mission seed.
 */
export class WorldBuilder {
  constructor(private scene: Scene) {}

  build(def: MissionDefinition, density = 1): WorldContext {
    const env = def.environment;
    const rng = new SeededRng(def.seed);

    this.scene.clearColor = Color3.FromHexString(env.skyBottom).toColor4(1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = Color3.FromHexString(env.fogColor);
    this.scene.fogDensity = env.fogDensity;
    this.scene.ambientColor = new Color3(0.3, 0.3, 0.32);

    const terrain = new Terrain(this.scene, def.seed, env.waterLevel, {
      groundColor: env.groundColor,
      accentColor: env.groundAccent,
    });

    buildSkyAndHorizon(this.scene, def.seed, { silhouette: env.silhouette, fogColor: env.fogColor, skyBottom: env.skyBottom });

    // lighting
    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = (env.ambient ?? 0.55) * 0.9;
    hemi.diffuse = Color3.Lerp(Color3.FromHexString(env.skyTop), new Color3(1, 1, 1), 0.4);
    hemi.groundColor = Color3.FromHexString(env.groundColor).scale(0.5);

    const sun = new DirectionalLight("sun", new Vector3(...env.sunDirection), this.scene);
    sun.intensity = 1.15;
    sun.diffuse = Color3.FromHexString(env.sunColor);
    sun.specular = Color3.FromHexString(env.sunColor).scale(0.5);

    const shadows = new ShadowGenerator(1024, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.darkness = 0.35;
    shadows.bias = 0.01;
    terrain.mesh.receiveShadows = true;

    if (env.waterLevel !== undefined) {
      this.buildWater(env.waterLevel, env.waterColor ?? "#2c4a5c");
    }
    if (env.rain) {
      // rain is attached by MissionScene (needs camera follow target)
    }
    this.buildProps(def, rng, terrain);

    // ---- prop library: reusable density system ----
    const props = new PropLibrary(this.scene);
    props.begin({ scene: this.scene, terrain: terrain.sampler, rng, density });

    const layout = this.generateLayout(def, rng, terrain, props);
    this.decorate(def, rng, props, layout);

    return { terrain, sun, hemi, shadows, layout, props };
  }

  private buildWater(level: number, color: string): void {
    const water = MeshBuilder.CreateGround("water", { width: 4000, height: 4000, subdivisions: 1 }, this.scene);
    water.position.y = level;
    const mat = new StandardMaterial("waterMat", this.scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = new Color3(0.5, 0.55, 0.6);
    mat.emissiveColor = Color3.FromHexString(color).scale(0.25);
    mat.alpha = 0.88;
    water.material = mat;
    water.isPickable = false;
    water.freezeWorldMatrix();
  }

  private buildProps(def: MissionDefinition, rng: SeededRng, terrain: Terrain): void {
    const env = def.environment;

    if ((env.treeCount ?? 0) > 0) {
      const trunk = MeshBuilder.CreateCylinder("treeTrunk", { diameterTop: 0.28, diameterBottom: 0.5, height: 3.2, tessellation: 5 }, this.scene);
      const crown = MeshBuilder.CreateCylinder("treeCrown", { diameterTop: 0, diameterBottom: 3.6, height: 5.4, tessellation: 6 }, this.scene);
      crown.position.y = 3.8;
      const template = Mesh.MergeMeshes([trunk, crown], true, true, undefined, false, false)!;
      const mat = new StandardMaterial("treeMat", this.scene);
      const tc = Color3.FromHexString(env.treeColor ?? "#2a4a2e");
      mat.diffuseColor = tc;
      mat.emissiveColor = tc.scale(0.08);
      template.material = mat;
      template.isVisible = false;
      template.isPickable = false;
      const count = env.treeCount!;
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(120, 680);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const inst = template.createInstance(`tree${i}`);
        inst.position.set(x, terrain.heightAt(x, z) - 0.2, z);
        inst.rotation.y = rng.range(0, Math.PI * 2);
        const s = rng.range(0.7, 1.6);
        inst.scaling.setAll(s);
        inst.isPickable = false;
        inst.freezeWorldMatrix();
      }
    }

    if ((env.rockCount ?? 0) > 0) {
      const template = MeshBuilder.CreatePolyhedron("rockTpl", { type: 3, size: 1.4 }, this.scene);
      const mat = new StandardMaterial("rockMat", this.scene);
      const rc = Color3.FromHexString(env.groundAccent).scale(0.85);
      mat.diffuseColor = rc;
      mat.emissiveColor = rc.scale(0.1);
      template.material = mat;
      template.isVisible = false;
      template.isPickable = false;
      for (let i = 0; i < env.rockCount!; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(60, 700);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const inst = template.createInstance(`rock${i}`);
        inst.position.set(x, terrain.heightAt(x, z) - 0.3, z);
        inst.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
        inst.scaling.setAll(rng.range(0.5, 2.2));
        inst.isPickable = false;
        inst.freezeWorldMatrix();
      }
    }
  }

  /** Data-driven battlefield layout generated from the mission seed. */
  private generateLayout(def: MissionDefinition, rng: SeededRng, terrain: Terrain, props: PropLibrary): WorldLayout {
    const buildings: BuildingPlacement[] = [];
    const squads: SquadPlacement[] = [];
    const ballistae: BallistaPlacement[] = [];
    let commanderPos: Vector3 | null = null;
    let castleZone: { center: Vector3; radiusSq: number } | null = null;
    const villageZones: AmbientZonePlacement[] = [];
    let castleAabbs: CastleAabb[] = [];
    let playerStart = new Vector3(-380, 150, -380);
    let playerStartYaw = Math.PI / 4;

    const findFlat = (cx: number, cz: number, spread: number, size: number): Vector3 => {
      for (let tries = 0; tries < 24; tries++) {
        const x = cx + rng.range(-spread, spread);
        const z = cz + rng.range(-spread, spread);
        if (terrain.isFlat(x, z, size)) return new Vector3(x, terrain.heightAt(x, z), z);
      }
      return new Vector3(cx, terrain.heightAt(cx, cz), cz);
    };

    const placeBuildingGroup = (
      kind: BuildingKind,
      tag: string,
      count: number,
      zone: { cx: number; cz: number; spread: number },
      relicIds: string[] = []
    ) => {
      for (let i = 0; i < count; i++) {
        const pos = findFlat(zone.cx, zone.cz, zone.spread, kind === "fort" || kind === "wall" ? 12 : 6);
        buildings.push({
          kind,
          tag,
          pos,
          rotY: rng.range(0, Math.PI * 2),
          relicId: i < relicIds.length ? relicIds[i] : undefined,
        });
      }
    };

    // ---- per-mission zones ----
    switch (def.id) {
      case "dragonstone": {
        placeBuildingGroup("house", "house", 4, { cx: 170, cz: 60, spread: 60 }, []);
        placeBuildingGroup("tower", "watchtower", 1, { cx: 260, cz: -140, spread: 20 }, ["dragonfireCore"]);
        squads.push({ type: "archer", count: 6, center: new Vector3(170, 0, 60), radius: 55 });
        squads.push({ type: "swordsman", count: 6, center: new Vector3(170, 0, 60), radius: 60 });
        squads.push({ type: "spearman", count: 2, center: new Vector3(260, 0, -140), radius: 25 });
        break;
      }
      case "riverlands": {
        placeBuildingGroup("barracks", "supply", 2, { cx: 120, cz: 150, spread: 40 }, ["windriderSpurs"]);
        placeBuildingGroup("house", "village", 5, { cx: -180, cz: 80, spread: 80 }, []);
        placeBuildingGroup("tower", "watchtower", 2, { cx: 0, cz: -220, spread: 90 }, ["obsidianScale"]);
        squads.push({ type: "archer", count: 14, center: new Vector3(-180, 0, 80), radius: 90 });
        squads.push({ type: "swordsman", count: 8, center: new Vector3(120, 0, 150), radius: 70 });
        squads.push({ type: "spearman", count: 6, center: new Vector3(0, 0, -220), radius: 80 });
        squads.push({ type: "shieldman", count: 6, center: new Vector3(120, 0, 150), radius: 60 });
        squads.push({ type: "elite", count: 1, center: new Vector3(120, 0, 150), radius: 30 });
        ballistae.push(
          { pos: findFlat(-60, -40, 15, 4), yaw: 0 },
          { pos: findFlat(240, 60, 15, 4), yaw: Math.PI }
        );
        commanderPos = findFlat(120, 150, 30, 3);
        break;
      }
      case "harrenhal": {
        placeBuildingGroup("fort", "keep", 1, { cx: 0, cz: 0, spread: 0 }, ["dragonheartEssence", "valyrianSaddle"]);
        placeBuildingGroup("house", "ruin", 5, { cx: -40, cz: 120, spread: 90 }, []);
        placeBuildingGroup("barracks", "camp", 2, { cx: 200, cz: -160, spread: 50 }, ["emberCapacitor"]);
        squads.push({ type: "archer", count: 18, center: new Vector3(0, 0, 0), radius: 110 });
        squads.push({ type: "swordsman", count: 18, center: new Vector3(-40, 0, 120), radius: 90 });
        squads.push({ type: "spearman", count: 8, center: new Vector3(200, 0, -160), radius: 60 });
        squads.push({ type: "shieldman", count: 10, center: new Vector3(100, 0, 100), radius: 80 });
        squads.push({ type: "elite", count: 3, center: new Vector3(0, 0, 0), radius: 80 });
        ballistae.push(
          { pos: findFlat(-260, -180, 20, 4), yaw: Math.PI / 4 },
          { pos: findFlat(260, -160, 20, 4), yaw: -Math.PI / 4 },
          { pos: findFlat(-240, 200, 20, 4), yaw: (Math.PI * 3) / 4 },
          { pos: findFlat(250, 210, 20, 4), yaw: (-Math.PI * 3) / 4 }
        );
        break;
      }
      case "kingslanding": {
        placeBuildingGroup("wall", "wall", 3, { cx: 0, cz: 260, spread: 40 }, []);
        placeBuildingGroup("tower", "wallTower", 4, { cx: 0, cz: 262, spread: 120 }, ["stormWings"]);
        placeBuildingGroup("gate", "gatehouse", 2, { cx: 0, cz: 240, spread: 26 }, ["ancientFlameGland", "bloodfireHeart"]);
        squads.push({ type: "archer", count: 22, center: new Vector3(0, 0, 250), radius: 140 });
        squads.push({ type: "swordsman", count: 16, center: new Vector3(0, 0, 120), radius: 130 });
        squads.push({ type: "spearman", count: 10, center: new Vector3(0, 0, 250), radius: 120 });
        squads.push({ type: "shieldman", count: 12, center: new Vector3(0, 0, 200), radius: 120 });
        squads.push({ type: "elite", count: 4, center: new Vector3(0, 0, 300), radius: 80 });
        ballistae.push(
          { pos: findFlat(-180, 300, 15, 4), yaw: Math.PI },
          { pos: findFlat(180, 300, 15, 4), yaw: Math.PI },
          { pos: findFlat(0, 340, 15, 4), yaw: Math.PI },
          { pos: findFlat(-300, 100, 15, 4), yaw: Math.PI / 2 },
          { pos: findFlat(300, 100, 15, 4), yaw: -Math.PI / 2 }
        );
        commanderPos = findFlat(0, 320, 20, 3);
        break;
      }
      case "blackstone": {
        // THE BLACKSTONE CITADEL — the castle IS the mission
        const castle = new CastleBuilder(this.scene, terrain.sampler, rng);
        const res = castle.build(0, 0, props);
        buildings.push(...res.buildingPlacements);
        castleAabbs = res.wallAabbs;
        castleZone = { center: res.center, radiusSq: res.radius * res.radius };
        // defenders: wall archers, courtyard infantry + elites, castellan at the keep gate
        squads.push({ type: "archer", count: 12, center: new Vector3(0, 0, 80), radius: 95 });
        squads.push({ type: "archer", count: 8, center: new Vector3(0, 0, -80), radius: 95 });
        squads.push({ type: "swordsman", count: 12, center: new Vector3(0, 0, 20), radius: 45 });
        squads.push({ type: "shieldman", count: 8, center: new Vector3(-40, 0, 40), radius: 30 });
        squads.push({ type: "spearman", count: 8, center: new Vector3(40, 0, 40), radius: 30 });
        squads.push({ type: "elite", count: 5, center: new Vector3(0, 0, 0), radius: 30 });
        // ballistae: 4 on wall towers (artillery crowns at +42, N wall-walk +21, NW corner tower crown +38) + 2 courtyard
        ballistae.push(
          { pos: new Vector3(0, terrain.heightAt(0, -110) + 21, -104), yaw: Math.PI },
          { pos: new Vector3(-110, terrain.heightAt(-110, 0) + 42, 0), yaw: -Math.PI / 2 },
          { pos: new Vector3(110, terrain.heightAt(110, 0) + 42, 0), yaw: Math.PI / 2 },
          { pos: new Vector3(-110, terrain.heightAt(-110, -110) + 38, -110), yaw: (Math.PI * 3) / 4 },
          { pos: new Vector3(60, terrain.heightAt(60, 60), 60), yaw: Math.PI },
          { pos: new Vector3(-60, terrain.heightAt(-60, 60), 60), yaw: Math.PI }
        );
        commanderPos = new Vector3(0, terrain.heightAt(0, 22), 22); // at the keep gate
        playerStart = new Vector3(-60, 170, -420);
        playerStartYaw = Math.PI * 0.06;
        break;
      }
      default:
        break;
    }

    // difficulty scales enemy counts
    void def;

    return {
      buildings,
      squads,
      ballistae,
      commanderPos,
      playerStart,
      playerStartYaw,
      castleZone,
      villageZones,
      castleAabbs,
    };
  }

  /**
   * Environmental density pass: roads between POIs, prop clusters, ambient
   * landmarks, smoke and birds — storytelling rather than uniform clutter.
   */
  private decorate(def: MissionDefinition, rng: SeededRng, props: PropLibrary, layout: WorldLayout): void {
    const pois: { x: number; z: number; kind: "village" | "camp" | "battle" | "castle" }[] = [];

    // derive POIs from the mission layout
    for (const b of layout.buildings) {
      if (b.tag === "village" || b.tag === "house") pois.push({ x: b.pos.x, z: b.pos.z, kind: "village" });
      else if (b.tag === "supply" || b.tag === "camp" || b.tag === "barracks") pois.push({ x: b.pos.x, z: b.pos.z, kind: "camp" });
      else if (b.tag === "keep" || b.tag === "gatehouse") pois.push({ x: b.pos.x, z: b.pos.z, kind: "castle" });
    }
    if (pois.length === 0) pois.push({ x: 150, z: 60, kind: "village" });

    for (const p of pois) {
      if (p.kind === "village") {
        props.villageCluster(p.x, p.z, 6, 34);
        layout.villageZones.push({ center: new Vector3(p.x, 0, p.z), radiusSq: 55 * 55 });
      } else if (p.kind === "camp") {
        props.militaryCamp(p.x, p.z, 6, 26);
      }
    }

    // battlefield debris between POIs + at squad hotspots
    for (const s of layout.squads.slice(0, 3)) {
      props.battlefieldDebris(s.center.x, s.center.z, 6, s.radius * 0.8);
    }

    // roads connecting the first POIs to each other
    for (let i = 0; i < Math.min(pois.length - 1, 3); i++) {
      const a = pois[i];
      const b = pois[i + 1];
      const mid = { x: (a.x + b.x) / 2 + rng.range(-40, 40), z: (a.z + b.z) / 2 + rng.range(-40, 40) };
      props.road([a, mid, b], 4);
    }
    // approach road to the castle gate for ground continuation
    if (def.id === "blackstone") {
      props.road([
        { x: 0, z: 118 },
        { x: 6, z: 190 },
        { x: -20, z: 280 },
      ], 5);
    }

    // vegetation patches (denser near forests)
    for (let i = 0; i < 10; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(140, 640);
      props.vegetationPatch(Math.cos(a) * r, Math.sin(a) * r, rng.int(3, 8), rng.range(8, 26));
    }

    // ambient landmarks + smoke + birds
    props.distantLandmarks();
    const smokeCount = def.id === "blackstone" ? 4 : 3;
    for (let i = 0; i < smokeCount; i++) {
      const p = pois[rng.int(0, pois.length - 1)];
      props.addSmokeColumn(p.x + rng.range(-30, 30), p.z + rng.range(-30, 30), rng.range(0.8, 1.4));
    }
    props.addBirds(rng.range(-300, 300), rng.range(-300, 300), rng.range(90, 150), 5);
    if (rng.chance(0.5)) props.addBirds(rng.range(200, 500), rng.range(-400, -200), rng.range(110, 170), 4);
  }
}
