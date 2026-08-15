import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  DynamicTexture,
} from "@babylonjs/core";
import { SeededRng } from "../core/SeededRng";
import type { TerrainHeightSampler } from "./Terrain";

/**
 * Reusable instanced prop library for battlefield density:
 *  - ~20 prop templates (military / village / castle / environmental / battlefield)
 *  - storytelling CLUSTERS (tent+rack+fire, wagon+crates, ruined house+debris…)
 *  - roads (ribbons following terrain), distant landmarks, smoke columns,
 *    waving banners, circling birds
 * Performance: each template is ONE merged mesh; all placements are instances
 * with frozen world matrices + frustum culling per instance; shared materials.
 */

export interface PropPlacementCtx {
  scene: Scene;
  terrain: TerrainHeightSampler;
  rng: SeededRng;
  density: number; // 0.5 low … 1 high
}

type TemplateId =
  | "tent"
  | "weaponRack"
  | "campfire"
  | "cart"
  | "barrel"
  | "crate"
  | "fence"
  | "haypile"
  | "well"
  | "stall"
  | "barricade"
  | "banner"
  | "brazier"
  | "debris"
  | "deadtree"
  | "bush"
  | "log"
  | "siegeTower"
  | "supplyStack"
  | "burningWagon";

export class PropLibrary {
  private templates = new Map<TemplateId, Mesh>();
  private mats: Record<string, StandardMaterial> = {};
  private glowTex: Texture | null = null;
  /** animated banners + smoke + birds driven per-frame */
  private banners: { node: TransformNode; phase: number }[] = [];
  private birds: { pivot: TransformNode; radius: number; speed: number; phase: number; y: number }[] = [];
  private smokes: ParticleSystem[] = [];
  private propInstances: Mesh[] = [];
  private ctx!: PropPlacementCtx;

  constructor(private scene: Scene) {}

  /** call once per mission before placements */
  begin(ctx: PropPlacementCtx): void {
    this.ctx = ctx;
    const wood = new StandardMaterial("pWood", this.scene);
    wood.diffuseColor = new Color3(0.32, 0.22, 0.13);
    wood.specularColor = new Color3(0.04, 0.03, 0.02);
    const clothMat = new StandardMaterial("pCloth", this.scene);
    clothMat.diffuseColor = new Color3(0.5, 0.32, 0.24);
    clothMat.specularColor = new Color3(0.02, 0.02, 0.02);
    clothMat.backFaceCulling = false;
    const stone = new StandardMaterial("pStone", this.scene);
    stone.diffuseColor = new Color3(0.36, 0.36, 0.34);
    stone.specularColor = new Color3(0.05, 0.05, 0.05);
    const metal = new StandardMaterial("pMetal", this.scene);
    metal.diffuseColor = new Color3(0.42, 0.43, 0.47);
    metal.specularColor = new Color3(0.5, 0.5, 0.55);
    const thatch = new StandardMaterial("pThatch", this.scene);
    thatch.diffuseColor = new Color3(0.55, 0.45, 0.22);
    thatch.specularColor = new Color3(0.04, 0.04, 0.02);
    const ember = new StandardMaterial("pEmber", this.scene);
    ember.diffuseColor = new Color3(0.4, 0.14, 0.03);
    ember.emissiveColor = new Color3(0.9, 0.35, 0.06);
    const charred = new StandardMaterial("pCharred", this.scene);
    charred.diffuseColor = new Color3(0.08, 0.07, 0.06);
    charred.emissiveColor = new Color3(0.15, 0.04, 0.0);
    this.mats = { wood, cloth: clothMat, stone, metal, thatch, ember, charred };
    const dt = new DynamicTexture("propGlow", { width: 64, height: 64 }, this.scene, false);
    const c = dt.getContext() as unknown as CanvasRenderingContext2D;
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,190,90,1)");
    g.addColorStop(1, "rgba(255,100,20,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    dt.update();
    dt.hasAlpha = true;
    this.glowTex = dt;
  }

  private tpl(id: TemplateId): Mesh {
    const cached = this.templates.get(id);
    if (cached) return cached;
    const S = this.scene;
    const m = (mesh: Mesh, mat: string) => {
      mesh.material = this.mats[mat];
      return mesh;
    };
    let mesh: Mesh;
    switch (id) {
      case "tent": {
        const body = MeshBuilder.CreateCylinder("t", { diameterTop: 0, diameterBottom: 2.6, height: 2.2, tessellation: 4 }, S);
        mesh = Mesh.MergeMeshes([m(body, "cloth")]!, true, true, undefined, false, false)!;
        break;
      }
      case "weaponRack": {
        const a = MeshBuilder.CreateBox("a", { width: 0.12, height: 2, depth: 0.12 }, S);
        a.position.set(-0.7, 1, 0);
        a.rotation.z = 0.18;
        const b = MeshBuilder.CreateBox("b", { width: 0.12, height: 2, depth: 0.12 }, S);
        b.position.set(0.7, 1, 0);
        b.rotation.z = -0.18;
        const cross = MeshBuilder.CreateBox("c", { width: 1.7, height: 0.1, depth: 0.1 }, S);
        cross.position.y = 1.4;
        const spear1 = MeshBuilder.CreateCylinder("s1", { diameter: 0.05, height: 2.8, tessellation: 4 }, S);
        spear1.position.set(-0.35, 1.4, 0.05);
        spear1.rotation.z = 0.1;
        const spear2 = MeshBuilder.CreateCylinder("s2", { diameter: 0.05, height: 2.8, tessellation: 4 }, S);
        spear2.position.set(0.3, 1.4, 0.05);
        spear2.rotation.z = -0.08;
        const shield = MeshBuilder.CreateCylinder("sh", { diameter: 0.6, height: 0.08, tessellation: 8 }, S);
        shield.rotation.x = Math.PI / 2;
        shield.position.set(0, 1, 0.12);
        mesh = Mesh.MergeMeshes([m(a, "wood"), m(b, "wood"), m(cross, "wood"), m(spear1, "wood"), m(spear2, "wood"), m(shield, "metal")]!, true, true, undefined, false, false)!;
        break;
      }
      case "campfire": {
        const logs = MeshBuilder.CreateCylinder("l", { diameter: 1.1, height: 0.3, tessellation: 6 }, S);
        m(logs, "wood");
        const glow = MeshBuilder.CreateSphere("g", { diameter: 0.7, segments: 4 }, S);
        glow.position.y = 0.25;
        glow.scaling.y = 0.5;
        m(glow, "ember");
        mesh = Mesh.MergeMeshes([logs, glow], true, true, undefined, false, false)!;
        break;
      }
      case "cart": {
        const bed = MeshBuilder.CreateBox("bed", { width: 1.9, height: 0.5, depth: 1.1 }, S);
        bed.position.y = 0.75;
        m(bed, "wood");
        const side1 = MeshBuilder.CreateBox("s1", { width: 2, height: 0.4, depth: 0.08 }, S);
        side1.position.set(0, 1.05, 0.55);
        m(side1, "wood");
        const side2 = side1.clone("s2");
        side2.position.z = -0.55;
        m(side2, "wood");
        const handle = MeshBuilder.CreateCylinder("h", { diameter: 0.08, height: 1.4, tessellation: 5 }, S);
        handle.rotation.x = Math.PI / 2;
        handle.position.set(0, 0.75, 1.2);
        m(handle, "wood");
        const w1 = MeshBuilder.CreateCylinder("w1", { diameter: 1, height: 0.14, tessellation: 9 }, S);
        w1.rotation.z = Math.PI / 2;
        w1.position.set(-0.95, 0.5, 0);
        m(w1, "wood");
        const w2 = w1.clone("w2");
        w2.position.x = 0.95;
        m(w2, "wood");
        mesh = Mesh.MergeMeshes([bed, side1, side2, handle, w1, w2], true, true, undefined, false, false)!;
        break;
      }
      case "barrel": {
        mesh = MeshBuilder.CreateCylinder("b", { diameterTop: 0.55, diameterBottom: 0.6, height: 0.95, tessellation: 9 }, S);
        m(mesh, "wood");
        break;
      }
      case "crate": {
        mesh = MeshBuilder.CreateBox("c", { size: 0.75 }, S);
        mesh.position.y = 0.1;
        m(mesh, "wood");
        break;
      }
      case "fence": {
        const parts: Mesh[] = [];
        for (let i = -1; i <= 1; i++) {
          const post = MeshBuilder.CreateBox("p", { width: 0.12, height: 1.2, depth: 0.12 }, S);
          post.position.set(i * 1.1, 0.6, 0);
          parts.push(m(post, "wood"));
        }
        const rail1 = MeshBuilder.CreateBox("r1", { width: 2.6, height: 0.12, depth: 0.08 }, S);
        rail1.position.y = 0.95;
        parts.push(m(rail1, "wood"));
        const rail2 = rail1.clone("r2");
        rail2.position.y = 0.5;
        parts.push(m(rail2, "wood"));
        mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
        break;
      }
      case "haypile": {
        mesh = MeshBuilder.CreateSphere("h", { diameterX: 1.7, diameterY: 1, diameterZ: 1.3, segments: 5 }, S);
        mesh.position.y = 0.2;
        m(mesh, "thatch");
        break;
      }
      case "well": {
        const ring = MeshBuilder.CreateCylinder("wr", { diameter: 1.5, height: 0.9, tessellation: 9 }, S);
        m(ring, "stone");
        const roof = MeshBuilder.CreateCylinder("wrf", { diameterTop: 0, diameterBottom: 1.9, height: 0.8, tessellation: 4 }, S);
        roof.position.y = 1.9;
        m(roof, "thatch");
        const p1 = MeshBuilder.CreateBox("wp1", { width: 0.12, height: 1.8, depth: 0.12 }, S);
        p1.position.set(-0.7, 1.3, 0);
        m(p1, "wood");
        const p2 = p1.clone("wp2");
        p2.position.x = 0.7;
        m(p2, "wood");
        mesh = Mesh.MergeMeshes([ring, roof, p1, p2], true, true, undefined, false, false)!;
        break;
      }
      case "stall": {
        const parts: Mesh[] = [];
        for (const [px, pz] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]] as const) {
          const post = MeshBuilder.CreateBox("sp", { width: 0.1, height: 2.2, depth: 0.1 }, S);
          post.position.set(px, 1.1, pz);
          parts.push(m(post, "wood"));
        }
        const roof = MeshBuilder.CreateBox("sr", { width: 2.6, height: 0.1, depth: 2.1 }, S);
        roof.position.y = 2.3;
        parts.push(m(roof, "thatch"));
        const table = MeshBuilder.CreateBox("st", { width: 2.2, height: 0.1, depth: 1, }, S);
        table.position.y = 1;
        parts.push(m(table, "wood"));
        mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
        break;
      }
      case "barricade": {
        const a = MeshBuilder.CreateBox("ba", { width: 2.4, height: 0.18, depth: 0.24 }, S);
        a.rotation.z = 0.6;
        a.position.y = 0.6;
        m(a, "wood");
        const b = MeshBuilder.CreateBox("bb", { width: 2.4, height: 0.18, depth: 0.24 }, S);
        b.rotation.z = -0.6;
        b.position.y = 0.6;
        m(b, "wood");
        mesh = Mesh.MergeMeshes([a, b], true, true, undefined, false, false)!;
        break;
      }
      case "banner": {
        const parts: Mesh[] = [];
        const pole = MeshBuilder.CreateCylinder("bp", { diameter: 0.09, height: 4.2, tessellation: 5 }, S);
        pole.position.y = 2.1;
        parts.push(m(pole, "wood"));
        const flag = MeshBuilder.CreatePlane("bf", { width: 1.05, height: 1.7 }, S);
        flag.position.set(0.55, 3.3, 0);
        parts.push(m(flag, "cloth"));
        mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
        break;
      }
      case "brazier": {
        const bowl = MeshBuilder.CreateCylinder("brb", { diameterTop: 0.8, diameterBottom: 0.35, height: 0.6, tessellation: 8 }, S);
        bowl.position.y = 1;
        m(bowl, "metal");
        const leg = MeshBuilder.CreateCylinder("brl", { diameter: 0.12, height: 1.4, tessellation: 5 }, S);
        leg.position.y = 0.5;
        m(leg, "metal");
        const fire = MeshBuilder.CreateSphere("brf", { diameter: 0.55, segments: 4 }, S);
        fire.position.y = 1.4;
        fire.scaling.y = 1.5;
        m(fire, "ember");
        mesh = Mesh.MergeMeshes([bowl, leg, fire], true, true, undefined, false, false)!;
        break;
      }
      case "debris": {
        const parts: Mesh[] = [];
        for (let i = 0; i < 5; i++) {
          const chunk = MeshBuilder.CreateBox("dc", { width: 0.5, height: 0.3, depth: 0.6 }, S);
          chunk.position.set((i % 3) * 0.5 - 0.5, 0.15 + (i > 2 ? 0.3 : 0), (i * 0.37) % 1.2 - 0.6);
          chunk.rotation.y = i * 1.3;
          parts.push(m(chunk, i % 2 === 0 ? "stone" : "wood"));
        }
        mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
        break;
      }
      case "deadtree": {
        const trunk = MeshBuilder.CreateCylinder("dt", { diameterTop: 0.12, diameterBottom: 0.3, height: 3.4, tessellation: 5 }, S);
        trunk.position.y = 1.7;
        m(trunk, "wood");
        const br1 = MeshBuilder.CreateCylinder("dbr1", { diameterTop: 0.02, diameterBottom: 0.1, height: 1.4, tessellation: 4 }, S);
        br1.position.set(0.4, 2.9, 0);
        br1.rotation.z = -0.7;
        m(br1, "wood");
        const br2 = MeshBuilder.CreateCylinder("dbr2", { diameterTop: 0.02, diameterBottom: 0.08, height: 1.1, tessellation: 4 }, S);
        br2.position.set(-0.35, 2.4, 0.15);
        br2.rotation.z = 0.8;
        m(br2, "wood");
        mesh = Mesh.MergeMeshes([trunk, br1, br2], true, true, undefined, false, false)!;
        break;
      }
      case "bush": {
        const a = MeshBuilder.CreateSphere("ba1", { diameter: 1, segments: 4 }, S);
        a.position.y = 0.4;
        const b = MeshBuilder.CreateSphere("ba2", { diameter: 0.7, segments: 4 }, S);
        b.position.set(0.4, 0.3, 0.2);
        const c = MeshBuilder.CreateSphere("ba3", { diameter: 0.6, segments: 4 }, S);
        c.position.set(-0.35, 0.3, -0.15);
        for (const x of [a, b, c]) m(x, "cloth");
        mesh = Mesh.MergeMeshes([a, b, c], true, true, undefined, false, false)!;
        break;
      }
      case "log": {
        mesh = MeshBuilder.CreateCylinder("lg", { diameter: 0.45, height: 2.4, tessellation: 6 }, S);
        mesh.rotation.z = Math.PI / 2;
        mesh.position.y = 0.25;
        m(mesh, "wood");
        break;
      }
      case "siegeTower": {
        const parts: Mesh[] = [];
        const frame = MeshBuilder.CreateBox("stf", { width: 3, height: 7.5, depth: 2.4 }, S);
        frame.position.y = 3.75;
        parts.push(m(frame, "wood"));
        const top = MeshBuilder.CreateBox("stt", { width: 3.4, height: 0.9, depth: 2.8 }, S);
        top.position.y = 7.9;
        parts.push(m(top, "wood"));
        for (let i = 0; i < 3; i++) {
          const slit = MeshBuilder.CreateBox("sts", { width: 2.2, height: 0.7, depth: 0.15 }, S);
          slit.position.set(0, 1.8 + i * 2.1, 1.25);
          parts.push(m(slit, "charred"));
        }
        const ram = MeshBuilder.CreateCylinder("str", { diameter: 0.4, height: 4.5, tessellation: 6 }, S);
        ram.rotation.x = Math.PI / 2;
        ram.position.set(0, 1.2, 2.2);
        parts.push(m(ram, "metal"));
        mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
        break;
      }
      case "supplyStack": {
        const parts: Mesh[] = [];
        for (let i = 0; i < 6; i++) {
          const b = MeshBuilder.CreateCylinder("ssb", { diameterTop: 0.5, diameterBottom: 0.55, height: 0.9, tessellation: 8 }, S);
          b.position.set((i % 3) * 0.62 - 0.62, 0.45 + Math.floor(i / 3) * 0.92, Math.floor(i / 3) * 0.3);
          parts.push(m(b, "wood"));
        }
        mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
        break;
      }
      case "burningWagon": {
        const parts: Mesh[] = [];
        const bed = MeshBuilder.CreateBox("bwb", { width: 1.9, height: 0.5, depth: 1.1 }, S);
        bed.position.y = 0.7;
        parts.push(m(bed, "charred"));
        const w1 = MeshBuilder.CreateCylinder("bww1", { diameter: 1, height: 0.14, tessellation: 9 }, S);
        w1.rotation.z = Math.PI / 2;
        w1.position.set(-0.95, 0.5, 0);
        parts.push(m(w1, "charred"));
        const w2 = w1.clone("bww2");
        w2.position.x = 0.95;
        parts.push(m(w2, "charred"));
        const flame = MeshBuilder.CreateSphere("bwf", { diameter: 1.2, segments: 4 }, S);
        flame.position.y = 1.3;
        flame.scaling.y = 1.8;
        parts.push(m(flame, "ember"));
        mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
        break;
      }
    }
    mesh.isVisible = false;
    mesh.isPickable = false;
    this.templates.set(id, mesh);
    return mesh;
  }

  /** place one instance; returns it (frozen) */
  place(id: TemplateId, x: number, z: number, opts: { rotY?: number; scale?: number; y?: number } = {}): void {
    const tpl = this.tpl(id);
    const inst = tpl.createInstance(`prop-${id}-${this.propInstances.length}`);
    const y = opts.y ?? this.ctx.terrain.height(x, z);
    inst.position.set(x, y, z);
    inst.rotation.y = opts.rotY ?? this.ctx.rng.range(0, Math.PI * 2);
    const sc = opts.scale ?? this.ctx.rng.range(0.85, 1.2);
    inst.scaling.setAll(sc);
    inst.isPickable = false;
    inst.freezeWorldMatrix();
    this.propInstances.push(inst as unknown as Mesh);
  }

  // ---------- storytelling clusters ----------
  militaryCamp(centerX: number, centerZ: number, tents: number, radius: number): void {
    const { rng } = this.ctx;
    const d = this.ctx.density;
    for (let i = 0; i < Math.ceil(tents * d); i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(radius * 0.15, radius);
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;
      this.place("tent", x, z);
      // tent story: rack + fire nearby
      if (rng.chance(0.5)) this.place("weaponRack", x + rng.range(2, 4), z + rng.range(-2, 2));
      if (rng.chance(0.4)) this.place("campfire", x + rng.range(-4, -2), z + rng.range(-3, 3));
      if (rng.chance(0.3)) this.place("supplyStack", x + rng.range(3, 6), z + rng.range(3, 6));
    }
    this.place("banner", centerX, centerZ);
    if (rng.chance(0.7)) this.place("banner", centerX + rng.range(-radius, radius) * 0.7, centerZ + rng.range(-radius, radius) * 0.7);
  }

  villageCluster(centerX: number, centerZ: number, houses: number, radius: number): void {
    const { rng } = this.ctx;
    const d = this.ctx.density;
    for (let i = 0; i < Math.ceil(houses * d); i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(radius * 0.2, radius);
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;
      // yard story: fence + hay + cart or well
      if (rng.chance(0.55)) this.place("fence", x + rng.range(-6, 6), z + rng.range(-6, 6), { rotY: rng.range(0, Math.PI) });
      if (rng.chance(0.4)) this.place("haypile", x + rng.range(3, 7), z + rng.range(-4, 4));
      if (rng.chance(0.3)) this.place("cart", x + rng.range(-7, -3), z + rng.range(-4, 4));
      if (rng.chance(0.25)) this.place("crate", x + rng.range(2, 5), z + rng.range(2, 5));
      if (rng.chance(0.2)) this.place("barrel", x + rng.range(2, 6), z + rng.range(-5, -2));
    }
    this.place("well", centerX, centerZ);
    if (rng.chance(0.8)) this.place("stall", centerX + rng.range(-8, 8), centerZ + rng.range(-8, 8));
  }

  battlefieldDebris(centerX: number, centerZ: number, count: number, radius: number): void {
    const { rng } = this.ctx;
    const d = this.ctx.density;
    for (let i = 0; i < Math.ceil(count * d); i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, radius);
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;
      const roll = rng.next();
      if (roll < 0.25) this.place("debris", x, z);
      else if (roll < 0.45) this.place("barricade", x, z, { rotY: rng.range(0, Math.PI) });
      else if (roll < 0.6) this.place("supplyStack", x, z);
      else if (roll < 0.72) this.place("log", x, z);
      else if (roll < 0.85) this.place("crate", x, z);
    }
    if (rng.chance(0.7)) {
      const bx = centerX + rng.range(-radius * 0.5, radius * 0.5);
      const bz = centerZ + rng.range(-radius * 0.5, radius * 0.5);
      this.place("burningWagon", bx, bz);
      this.addSmokeColumn(bx, bz, 0.7);
    }
  }

  castleCourtyard(centerX: number, centerZ: number, radius: number): void {
    const { rng } = this.ctx;
    const d = this.ctx.density;
    const n = Math.ceil(14 * d);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(radius * 0.15, radius * 0.85);
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;
      const roll = rng.next();
      if (roll < 0.2) this.place("weaponRack", x, z);
      else if (roll < 0.4) this.place("supplyStack", x, z);
      else if (roll < 0.55) this.place("brazier", x, z);
      else if (roll < 0.7) this.place("cart", x, z);
      else if (roll < 0.85) this.place("crate", x, z);
      else this.place("barrel", x, z);
    }
    this.addBannersRing(centerX, centerZ, radius, 6);
  }

  vegetationPatch(centerX: number, centerZ: number, count: number, radius: number): void {
    const { rng } = this.ctx;
    const d = this.ctx.density;
    for (let i = 0; i < Math.ceil(count * d); i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, radius);
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;
      const roll = rng.next();
      if (roll < 0.6) this.place("bush", x, z);
      else if (roll < 0.8) this.place("deadtree", x, z);
      else this.place("log", x, z);
    }
  }

  // ---------- roads ----------
  road(points: { x: number; z: number }[], width = 4): Mesh {
    const path = points.map((p) => new Vector3(p.x, this.ctx.terrain.height(p.x, p.z) + 0.12, p.z));
    // interpolate for terrain following
    const dense: Vector3[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const steps = Math.max(2, Math.ceil(Vector3.Distance(a, b) / 12));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        dense.push(new Vector3(x, this.ctx.terrain.height(x, z) + 0.12, z));
      }
    }
    dense.push(path[path.length - 1]);
    const ribbon = MeshBuilder.CreateRibbon("road", { pathArray: [dense, dense], closeArray: false }, this.scene);
    // widen: use two offset paths
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    for (let i = 0; i < dense.length; i++) {
      const prev = dense[Math.max(0, i - 1)];
      const next = dense[Math.min(dense.length - 1, i + 1)];
      const dir = next.subtract(prev).normalize();
      const side = new Vector3(dir.z, 0, -dir.x).scale(width / 2);
      const l = dense[i].add(side);
      const r = dense[i].subtract(side);
      left.push(new Vector3(l.x, this.ctx.terrain.height(l.x, l.z) + 0.1, l.z));
      right.push(new Vector3(r.x, this.ctx.terrain.height(r.x, r.z) + 0.1, r.z));
    }
    ribbon.dispose();
    const roadMesh = MeshBuilder.CreateRibbon("road", { pathArray: [left, right], closeArray: false }, this.scene);
    const mat = new StandardMaterial("roadMat", this.scene);
    mat.diffuseColor = new Color3(0.3, 0.25, 0.18);
    mat.specularColor = new Color3(0.01, 0.01, 0.01);
    roadMesh.material = mat;
    roadMesh.isPickable = false;
    roadMesh.receiveShadows = true;
    roadMesh.freezeWorldMatrix();
    return roadMesh;
  }

  // ---------- landmarks & ambience ----------
  distantLandmarks(): void {
    const { rng } = this.ctx;
    const mat = new StandardMaterial("landmarkMat", this.scene);
    mat.diffuseColor = new Color3(0.22, 0.21, 0.2);
    mat.emissiveColor = new Color3(0.05, 0.05, 0.05);
    mat.specularColor = Color3.Black();
    // ruined towers + distant village blocks on the horizon ring
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const dist = rng.range(880, 1050);
      const x = Math.cos(a) * dist;
      const z = Math.sin(a) * dist;
      if (rng.chance(0.5)) {
        const tower = MeshBuilder.CreateCylinder(`lm-t${i}`, { diameterTop: rng.range(1, 4), diameterBottom: rng.range(6, 9), height: rng.range(26, 44), tessellation: 6 }, this.scene);
        tower.position.set(x, this.ctx.terrain.height(x, z) + rng.range(20, 34), z);
        tower.material = mat;
        tower.isPickable = false;
        tower.freezeWorldMatrix();
      } else {
        for (let h = 0; h < rng.int(3, 6); h++) {
          const house = MeshBuilder.CreateBox(`lm-h${i}-${h}`, { width: rng.range(6, 12), height: rng.range(5, 9), depth: rng.range(6, 12) }, this.scene);
          house.position.set(x + rng.range(-24, 24), this.ctx.terrain.height(x, z) + rng.range(16, 26), z + rng.range(-24, 24));
          house.material = mat;
          house.isPickable = false;
          house.freezeWorldMatrix();
        }
      }
    }
  }

  addSmokeColumn(x: number, z: number, scale = 1): void {
    const ps = new ParticleSystem(`smokeCol-${x|0}-${z|0}`, 90, this.scene);
    ps.particleTexture = this.glowTex!;
    const y = this.ctx.terrain.height(x, z) + 2;
    ps.emitter = new Vector3(x, y, z);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minSize = 3 * scale;
    ps.maxSize = 9 * scale;
    ps.minLifeTime = 2.6;
    ps.maxLifeTime = 5;
    ps.emitRate = 9;
    ps.gravity = new Vector3(0.4, 3.2, 0);
    ps.direction1 = new Vector3(-0.4, 1, -0.4);
    ps.direction2 = new Vector3(0.4, 1.6, 0.4);
    ps.minEmitPower = 0.6;
    ps.maxEmitPower = 1.4;
    ps.color1 = new Color4(0.1, 0.09, 0.08, 0.5);
    ps.color2 = new Color4(0.16, 0.14, 0.13, 0.45);
    ps.colorDead = new Color4(0.2, 0.19, 0.18, 0);
    ps.start();
    this.smokes.push(ps);
  }

  addBannersRing(centerX: number, centerZ: number, radius: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = centerX + Math.cos(a) * radius;
      const z = centerZ + Math.sin(a) * radius;
      this.place("banner", x, z, { rotY: a });
      const inst = this.propInstances[this.propInstances.length - 1];
      this.banners.push({ node: inst, phase: a * 3 });
    }
  }

  addBirds(centerX: number, centerZ: number, y: number, count = 5): void {
    const pivot = new TransformNode(`birds-${centerX|0}`, this.scene);
    pivot.position.set(centerX, y, centerZ);
    const birdMat = new StandardMaterial("birdMat", this.scene);
    birdMat.diffuseColor = new Color3(0.08, 0.08, 0.09);
    birdMat.emissiveColor = new Color3(0.02, 0.02, 0.02);
    for (let i = 0; i < count; i++) {
      const wing1 = MeshBuilder.CreateBox(`bw1-${i}`, { width: 0.9, height: 0.04, depth: 0.25 }, this.scene);
      wing1.position.x = -0.45;
      wing1.rotation.z = 0.3;
      const wing2 = MeshBuilder.CreateBox(`bw2-${i}`, { width: 0.9, height: 0.04, depth: 0.25 }, this.scene);
      wing2.position.x = 0.45;
      wing2.rotation.z = -0.3;
      const bird = Mesh.MergeMeshes([wing1, wing2], true, true, undefined, false, false)!;
      bird.material = birdMat;
      const holder = new TransformNode(`birdh-${i}`, this.scene);
      holder.parent = pivot;
      const a = (i / count) * Math.PI * 2;
      holder.position.set(Math.cos(a) * (12 + i * 3), i * 1.5, Math.sin(a) * (12 + i * 3));
      bird.parent = holder;
    }
    this.birds.push({ pivot, radius: 20, speed: 0.12 + this.ctx.rng.range(0, 0.08), phase: this.ctx.rng.range(0, Math.PI * 2), y });
  }

  /** per-frame ambient animation (banners + birds); call from the scene loop */
  update(dt: number): void {
    const t = performance.now() / 1000;
    for (const b of this.banners) {
      b.node.rotation.y = Math.sin(t * 1.4 + b.phase) * 0.22 + (b.node.rotation.y % (Math.PI * 2));
    }
    for (const b of this.birds) {
      b.pivot.rotation.y += b.speed * dt;
      b.pivot.position.y = b.y + Math.sin(t * 0.4 + b.phase) * 2;
    }
  }

  /** governor tier ≥2: hide far decorative instances to save fill/culling cost */
  setCullingRadius(radius: number): void {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const cx = cam.position.x;
    const cz = cam.position.z;
    const r2 = radius * radius;
    for (const inst of this.propInstances) {
      const dx = inst.position.x - cx;
      const dz = inst.position.z - cz;
      inst.setEnabled(dx * dx + dz * dz < r2);
    }
  }

  get instanceCount(): number {
    return this.propInstances.length;
  }

  dispose(): void {
    for (const ps of this.smokes) ps.dispose();
    for (const t of this.templates.values()) t.dispose();
    this.templates.clear();
    this.propInstances = [];
    this.banners = [];
    this.birds = [];
    this.smokes = [];
    for (const m of Object.values(this.mats)) m.dispose();
    this.glowTex?.dispose();
  }
}
