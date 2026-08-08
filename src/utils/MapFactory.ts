import type { MapData } from "@/types/MapTypes";
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, EMPTY_TILE_INDEX, TILE_SIZE } from "@/utils/Constants";
import { TextureFactory } from "@/utils/TextureFactory";

/**
 * Builds map data procedurally, for cases where no hand-authored JSON
 * exists on disk. Used when the player walks off the edge of the world
 * into a map slot nobody has designed yet.
 */
export class MapFactory {
  /** A fully walkable map covered in plain grass, no objects or collisions. */
  public static createEmptyGrassMap(
    width = DEFAULT_MAP_WIDTH,
    height = DEFAULT_MAP_HEIGHT,
    tileSize = TILE_SIZE,
  ): MapData {
    const tileCount = width * height;

    return {
      width,
      height,
      tileSize,
      spawnPoint: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
      layers: [
        {
          name: "ground",
          data: new Array(tileCount).fill(TextureFactory.TILE_INDEX.GRASS),
        },
        {
          name: "objects",
          data: new Array(tileCount).fill(EMPTY_TILE_INDEX),
        },
      ],
      collisions: new Array(tileCount).fill(false),
      mobTypes: [],
      mobSpawns: [],
    };
  }
}
