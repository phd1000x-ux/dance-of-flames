import { describe, expect, it } from "vitest";
import { gearForRole } from "../src/world/RoleGear";

describe("role gear silhouettes", () => {
  it("every soldier role wears something that sets it apart", () => {
    for (const role of ["infantry", "archer", "spear", "shield", "elite", "commander"] as const) {
      const g = gearForRole(role);
      expect(g.tabard || g.cape || g.plume || g.quiver).toBe(true);
    }
  });
  it("archers carry a quiver; elites and commanders a cape", () => {
    expect(gearForRole("archer").quiver).toBe(true);
    expect(gearForRole("elite").cape).toBe(true);
    expect(gearForRole("infantry").cape).toBe(false);
  });
});
