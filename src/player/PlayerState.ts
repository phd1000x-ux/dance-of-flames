import { DragonDefinition } from "../data/dragons";
import { RiderDefinition } from "../data/riders";
import { computeFinalStats, getStat, type StatBlock, type StatModSource } from "../progression/StatBlock";
import { FireEnergy } from "../combat/DamageCalculator";
import { RELICS } from "../data/items";

export type PlayerMode = "dragon" | "dying" | "ground" | "dead";

export interface TemporaryBuff {
  id: string;
  label: string;
  stat: string;
  mult: number;
  remaining: number;
}

/**
 * Composed player state: dragon stats (base × rider bond × shop × relics × buffs),
 * resources, mission relics, and rider ground-combat state.
 */
export class PlayerState {
  mode: PlayerMode = "dragon";
  readonly dragonDef: DragonDefinition;
  readonly riderDef: RiderDefinition;

  dragonStats: StatBlock;
  dragonHp!: number;
  fireEnergy!: FireEnergy;
  superCharge = 0; // 0..100
  superCooldown = 0;
  boost = 1; // 0..1
  boostRegenLocked = false;

  riderStats: StatBlock;
  riderHp: number;
  riderStamina: number;
  riderAlive = true;

  relicIds: string[] = [];
  private relicMods: StatModSource[] = [];
  private shopMods: StatModSource = {};
  buffs: TemporaryBuff[] = [];
  lifesteal = 0;
  fireBoostTimer = 0;
  armorWardCharges = 0;
  healCharges = 0;
  fireBoostCharges = 0;

  onRelicFound: ((relicId: string) => void) | null = null;

  constructor(
    dragon: DragonDefinition,
    rider: RiderDefinition,
    shopMods: StatModSource
  ) {
    this.dragonDef = dragon;
    this.riderDef = rider;
    this.shopMods = shopMods;
    this.dragonStats = this.composeDragonStats();
    this.recomputeDerived();

    this.riderStats = computeFinalStats(
      {
        riderHp: rider.ground.hp,
        riderArmor: rider.ground.armor,
        swordDamage: rider.ground.swordDamage,
        riderStamina: rider.ground.stamina,
        riderBlock: rider.ground.block,
      },
      [shopMods]
    );
    this.riderHp = getStat(this.riderStats, "riderHp");
    this.riderStamina = getStat(this.riderStats, "riderStamina");
  }

  private recomputeDerived(): void {
    this.dragonHp = getStat(this.dragonStats, "maxHealth");
    this.fireEnergy = new FireEnergy(
      getStat(this.dragonStats, "fireCapacity", 100),
      getStat(this.dragonStats, "fireDrain", 20),
      getStat(this.dragonStats, "fireRecharge", 22),
      1.2
    );
  }

  get maxDragonHp(): number {
    return getStat(this.dragonStats, "maxHealth");
  }
  get maxRiderHp(): number {
    return getStat(this.riderStats, "riderHp");
  }
  get maxRiderStamina(): number {
    return getStat(this.riderStats, "riderStamina");
  }

  addRelic(relicId: string): void {
    if (this.relicIds.includes(relicId)) return;
    const relic = RELICS.find((r) => r.id === relicId);
    if (!relic) return;
    this.relicIds.push(relicId);
    // healFlat is a one-shot flag, not a multiplier — copy so the shared RELICS data stays intact
    const { healFlat, ...mods } = relic.effect as StatModSource & { healFlat?: number };
    this.relicMods.push(mods);
    this.recomputeStatsKeepHp();
    if (healFlat !== undefined) {
      this.dragonHp = Math.min(this.maxDragonHp, this.dragonHp + this.maxDragonHp * healFlat);
    }
    this.onRelicFound?.(relicId);
  }

  /** base × rider bond × shop upgrades × relics × active buffs — the one stat recipe */
  private composeDragonStats(): StatBlock {
    const d = this.dragonDef;
    const baseDragon: StatBlock = {
      maxHealth: d.maxHealth,
      armor: d.armor,
      fireDamage: d.fireDamage,
      fireRange: d.fireRange,
      fireCone: d.fireCone,
      fireCapacity: d.fireCapacity,
      fireDrain: d.fireDrain,
      fireRecharge: d.fireRecharge,
      acceleration: d.acceleration,
      maxSpeed: d.maxSpeed,
      boostSpeed: d.boostSpeed,
      turnRate: d.turnRate,
      climbRate: d.climbRate,
      diveSpeed: d.diveSpeed,
      staggerResistance: d.staggerResistance,
    };
    const buffMods: StatModSource = {};
    for (const b of this.buffs) buffMods[b.stat] = (buffMods[b.stat] ?? 1) * b.mult;
    return computeFinalStats(baseDragon, [this.riderDef.dragonBonus, this.shopMods, ...this.relicMods, buffMods]);
  }

  private recomputeStatsKeepHp(): void {
    this.dragonStats = this.composeDragonStats();
    this.dragonHp = Math.min(this.dragonHp, this.maxDragonHp);
    this.lifesteal = this.relicMods.reduce((acc, m) => acc + ((m as any).lifesteal ?? 0), 0);
  }

  addBuff(buff: TemporaryBuff): void {
    this.buffs.push(buff);
    this.recomputeStatsKeepHp();
  }

  addSuper(amount: number): void {
    const gain = getStat(this.dragonStats, "superGain", 1);
    this.superCharge = Math.min(100, this.superCharge + amount * gain);
  }

  update(dt: number): void {
    // buffs tick
    let dirty = false;
    for (const b of this.buffs) b.remaining -= dt;
    const before = this.buffs.length;
    this.buffs = this.buffs.filter((b) => b.remaining > 0);
    if (this.buffs.length !== before) dirty = true;
    if (this.fireBoostTimer > 0) this.fireBoostTimer -= dt;

    if (this.mode === "dragon") {
      this.fireEnergy.update(dt, false); // firing handled by FireSystem
      this.superCooldown = Math.max(0, this.superCooldown - dt);
      // boost regen
      if (!this.boostRegenLocked) {
        this.boost = Math.min(1, this.boost + dt * this.dragonDef.boostRecharge * 0.55);
      }
    } else if (this.mode === "ground") {
      const regen = 16;
      this.riderStamina = Math.min(this.maxRiderStamina, this.riderStamina + regen * dt);
    }
    if (dirty) this.recomputeStatsKeepHp();
  }

  /** true → dragon just died */
  damageDragon(amount: number): boolean {
    if (this.mode !== "dragon") return false;
    let dmg = amount;
    if (getStat(this.dragonStats, "damageTaken", 1) !== 1) {
      dmg *= getStat(this.dragonStats, "damageTaken", 1);
    }
    this.dragonHp = Math.max(0, this.dragonHp - dmg);
    if (this.dragonHp <= 0) {
      this.mode = "dying";
      return true;
    }
    return false;
  }

  healDragon(fraction: number): void {
    this.dragonHp = Math.min(this.maxDragonHp, this.dragonHp + this.maxDragonHp * fraction);
  }

  healRider(fraction: number): void {
    this.riderHp = Math.min(this.maxRiderHp, this.riderHp + this.maxRiderHp * fraction);
  }

  damageRider(amount: number): boolean {
    if (this.mode !== "ground" || !this.riderAlive) return false;
    this.riderHp = Math.max(0, this.riderHp - amount);
    if (this.riderHp <= 0) {
      this.riderAlive = false;
      return true;
    }
    return false;
  }
}
