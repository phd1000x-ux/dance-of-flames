export interface Hittable {
  hp: number;
  maxHp: number;
}

/**
 * Armor mitigation: reduction = armor / (armor + 100).
 * armor 0 → full damage, armor 100 → 50%, huge armor → asymptotically 99%.
 * Always at least 1 damage so nothing is fully invulnerable.
 */
export function mitigateDamage(base: number, armor: number): number {
  const reduction = armor / (armor + 100);
  return Math.max(1, base * (1 - reduction));
}

export function applyDamage(e: Hittable, amount: number): { died: boolean; applied: number } {
  if (e.hp <= 0) return { died: false, applied: 0 };
  const before = e.hp;
  e.hp = Math.max(0, e.hp - amount);
  return { died: before > 0 && e.hp === 0, applied: before - e.hp };
}

export function healEntity(e: Hittable, flat = 0, fractionOfMax = 0): void {
  e.hp = Math.min(e.maxHp, e.hp + flat + e.maxHp * fractionOfMax);
}

/**
 * Fire breath resource. Drains while firing, recharges after a delay.
 * After a full depletion, refire is locked until 20% recovery.
 */
export class FireEnergy {
  current: number;
  private depleted = false;
  private timeSinceFiring = Infinity;

  constructor(
    public capacity: number,
    public drainPerSec: number,
    public rechargePerSec: number,
    public rechargeDelay: number
  ) {
    this.current = capacity;
  }

  /** @returns whether fire was actually emitted this frame */
  update(dt: number, wantFire: boolean): boolean {
    const firing = wantFire && this.canFire();
    if (firing) {
      this.current -= this.drainPerSec * dt;
      if (this.current <= 0) {
        this.current = 0;
        this.depleted = true;
      }
      this.timeSinceFiring = 0;
    } else {
      const prev = this.timeSinceFiring;
      this.timeSinceFiring += dt;
      if (this.timeSinceFiring >= this.rechargeDelay) {
        // only recharge for the portion of dt beyond the delay
        const effective = prev >= this.rechargeDelay ? dt : this.timeSinceFiring - this.rechargeDelay;
        this.current = Math.min(this.capacity, this.current + this.rechargePerSec * effective);
        if (this.depleted && this.current >= this.capacity * 0.2) {
          this.depleted = false;
        }
      }
    }
    return firing;
  }

  canFire(): boolean {
    if (this.depleted) return this.current >= this.capacity * 0.2;
    return this.current > 0;
  }

  get fraction(): number {
    return this.current / this.capacity;
  }
}
