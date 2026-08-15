import { Engine, WebGPUEngine, type AbstractEngine } from "@babylonjs/core";

export interface EngineInfo {
  renderer: "WebGPU" | "WebGL2";
  engine: AbstractEngine;
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineInfo> {
  // Try WebGPU first (Chrome on M1 supports it), fall back to WebGL2.
  const gpuAvailable = typeof navigator !== "undefined" && "gpu" in navigator;
  if (gpuAvailable) {
    try {
      const supported = await WebGPUEngine.IsSupportedAsync;
      if (supported) {
        const engine = new WebGPUEngine(canvas, {
          antialias: true,
          stencil: true,
          powerPreference: "high-performance",
        });
        await engine.initAsync();
        return { renderer: "WebGPU", engine };
      }
    } catch (e) {
      console.warn("[engine] WebGPU init failed, falling back to WebGL2:", e);
    }
  }
  const engine = new Engine(canvas, true, {
    stencil: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
  return { renderer: "WebGL2", engine };
}

export interface CapabilityReport {
  webgpu: boolean;
  webgl2: boolean;
  viewport: { w: number; h: number };
  indexedDB: boolean;
  audioContext: boolean;
  hardwareConcurrency: number;
  deviceMemoryGB: number | null;
}

export function detectCapabilities(): CapabilityReport {
  let webgl2 = false;
  try {
    const c = document.createElement("canvas");
    webgl2 = !!c.getContext("webgl2");
  } catch {
    webgl2 = false;
  }
  return {
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    webgl2,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    indexedDB: typeof indexedDB !== "undefined",
    audioContext: typeof (window as any).AudioContext !== "undefined" || typeof (window as any).webkitAudioContext !== "undefined",
    hardwareConcurrency: navigator.hardwareConcurrency ?? 4,
    deviceMemoryGB: (navigator as any).deviceMemory ?? null,
  };
}
