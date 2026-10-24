import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractEngine } from "@babylonjs/core";
import { PerformanceGovernor } from "../src/engine/PerformanceGovernor";
import { defaultSettings } from "../src/save/SaveSystem";

afterEach(() => vi.restoreAllMocks());

describe("adaptive quality under sustained slow frames", () => {
  it("reduces quality when the slow tail exceeds 40ms even with some fast frames", () => {
    const time = vi.spyOn(performance, "now").mockReturnValue(0);
    const engine = { setHardwareScalingLevel: vi.fn(), getHardwareScalingLevel: () => 1 } as unknown as AbstractEngine;
    const governor = new PerformanceGovernor(engine, defaultSettings());
    time.mockReturnValue(5000);
    for (const ms of [...Array(10).fill(10), ...Array(50).fill(25), ...Array(30).fill(45)]) governor.update(ms);
    expect(governor.tier).toBe(2);
  });
});
