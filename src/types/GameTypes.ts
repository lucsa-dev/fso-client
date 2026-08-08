import type { PlayerSkinId } from "@/utils/Constants";
import type { MapCoord } from "@/types/MapTypes";

export enum Direction {
  North = "north",
  South = "south",
  East = "east",
  West = "west",
}

/**
 * Scene-transition payload passed from LoginScene/BootScene into GameScene.
 */
export interface GameSceneData {
  characterName: string;
  skin: PlayerSkinId;
  /**
   * Which world-grid map BootScene already loaded into MAP_CACHE_KEY —
   * matches PlayerSession's last saved position when there is one, so
   * GameScene.create() builds the player directly at their remembered
   * spot instead of flashing onto (0, 0) first. Omitted from LoginScene's
   * fresh-login handoff, where there's no saved position to resume.
   */
  startMapCoord?: MapCoord;
}
