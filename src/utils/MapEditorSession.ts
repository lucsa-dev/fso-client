import type { BlockConfig } from "@/ui/MapEditorPanel";

const BLOCK_CONFIGS_KEY = "fso.mapEditorBlockConfigs";

/**
 * Persists the map editor's per-texture layer/tool/Block/Estrutural/density
 * memory (see MapEditorPanel's `blockConfigs`) to localStorage, so it
 * survives a page reload instead of resetting to defaults — the Map itself
 * lives on GameScene across editor open/close cycles already; this just
 * mirrors it to disk on top of that.
 */
export const MapEditorSession = {
  load(): Map<number, BlockConfig> {
    try {
      const raw = localStorage.getItem(BLOCK_CONFIGS_KEY);
      if (!raw) {
        return new Map();
      }
      return new Map(JSON.parse(raw) as [number, BlockConfig][]);
    } catch {
      return new Map();
    }
  },

  save(blockConfigs: ReadonlyMap<number, BlockConfig>): void {
    try {
      localStorage.setItem(BLOCK_CONFIGS_KEY, JSON.stringify([...blockConfigs.entries()]));
    } catch {
      // localStorage unavailable (e.g. private browsing) — falls back to in-memory only.
    }
  },
};
