export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** In-memory storage for tests and fallback. */
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
}

/** Minimal IndexedDB key-value storage. */
export class IndexedDbStorage implements KeyValueStorage {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private dbName = "dance-of-flames", private storeName = "saves") {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.db;
  }

  async get(key: string): Promise<string | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async set(key: string, value: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export interface GameSettings {
  graphicsPreset: "low" | "medium" | "high" | "auto";
  cameraShake: number; // 0..1
  motionBlur: boolean;
  mouseSensitivity: number; // 0.5..2
  invertY: boolean;
  masterVolume: number; // 0..1
  effectsVolume: number; // 0..1
  musicVolume: number; // 0..1
  showFps: boolean;
  keyboardLookSpeed: number; // 0.4..2 arrow-key look multiplier
  keyboardTurnSpeed: number; // 0.5..1.5 A/D + arrow turn multiplier
  targetAssist: number; // 0..1 soft aim assist strength
}

export function defaultSettings(): GameSettings {
  return {
    graphicsPreset: "auto",
    cameraShake: 1,
    motionBlur: false,
    mouseSensitivity: 1,
    invertY: false,
    masterVolume: 0.8,
    effectsVolume: 0.9,
    musicVolume: 0.65,
    showFps: false,
    keyboardLookSpeed: 1,
    keyboardTurnSpeed: 1,
    targetAssist: 0.5,
  };
}

export const CURRENT_SAVE_VERSION = 1;
export const SAVE_KEY = "dof-save";

export interface SaveData {
  version: number;
  coins: number;
  upgrades: Record<string, number>;
  unlockedMissions: string[];
  selectedRider: string | null;
  selectedDragon: string | null;
  selectedDifficulty: string;
  settings: GameSettings;
  bestScores: Record<string, number>;
  campaignCompleted: boolean;
}

export function defaultSave(): SaveData {
  return {
    version: CURRENT_SAVE_VERSION,
    coins: 0,
    upgrades: {},
    unlockedMissions: ["dragonstone"],
    selectedRider: null,
    selectedDragon: null,
    selectedDifficulty: "normal",
    settings: defaultSettings(),
    bestScores: {},
    campaignCompleted: false,
  };
}

/** Versioned save with migration + best-score merging. */
export class SaveSystem {
  constructor(private storage: KeyValueStorage) {}

  async load(): Promise<SaveData> {
    let raw: string | null = null;
    try {
      raw = await this.storage.get(SAVE_KEY);
    } catch (e) {
      console.warn("[save] storage read failed, using defaults", e);
    }
    if (!raw) return defaultSave();
    try {
      const parsed = JSON.parse(raw);
      return this.migrate(parsed);
    } catch (e) {
      console.warn("[save] corrupted save, using defaults", e);
      return defaultSave();
    }
  }

  async save(data: SaveData): Promise<void> {
    // keep best scores monotonically increasing
    try {
      const prevRaw = await this.storage.get(SAVE_KEY);
      if (prevRaw) {
        const prev = JSON.parse(prevRaw) as SaveData;
        if (prev?.bestScores) {
          for (const [k, v] of Object.entries(prev.bestScores)) {
            if ((data.bestScores[k] ?? 0) < v) data.bestScores[k] = v;
          }
        }
      }
    } catch {
      /* best-effort */
    }
    const out = { ...data, version: CURRENT_SAVE_VERSION };
    try {
      await this.storage.set(SAVE_KEY, JSON.stringify(out));
    } catch (e) {
      console.warn("[save] storage write failed", e);
    }
  }

  private migrate(data: any): SaveData {
    const base = defaultSave();
    if (!data || typeof data !== "object") return base;
    if (data.version === 0) {
      // v0 had placeholder mission ids — reset progression, keep coins
      data = { ...data, unlockedMissions: ["dragonstone"], upgrades: {} };
    }
    return {
      version: CURRENT_SAVE_VERSION,
      coins: typeof data.coins === "number" ? data.coins : base.coins,
      upgrades: data.upgrades ?? base.upgrades,
      unlockedMissions: Array.isArray(data.unlockedMissions) && data.unlockedMissions.length
        ? data.unlockedMissions
        : base.unlockedMissions,
      selectedRider: data.selectedRider ?? base.selectedRider,
      selectedDragon: data.selectedDragon ?? base.selectedDragon,
      selectedDifficulty: data.selectedDifficulty ?? base.selectedDifficulty,
      settings: { ...base.settings, ...(data.settings ?? {}) },
      bestScores: data.bestScores ?? base.bestScores,
      campaignCompleted: !!data.campaignCompleted,
    };
  }
}
