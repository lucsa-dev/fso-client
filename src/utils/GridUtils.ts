import type { GridPosition, WorldPosition } from "@/types/MapTypes";

/**
 * Pure coordinate-space helpers shared by every manager/entity that needs
 * to translate between tile grid space and pixel world space.
 */
export class GridUtils {
  public static tileToWorld(tile: GridPosition, tileSize: number): WorldPosition {
    return {
      x: tile.x * tileSize + tileSize / 2,
      y: tile.y * tileSize + tileSize / 2,
    };
  }

  public static worldToTile(world: WorldPosition, tileSize: number): GridPosition {
    return {
      x: Math.floor(world.x / tileSize),
      y: Math.floor(world.y / tileSize),
    };
  }

  public static toIndex(tile: GridPosition, width: number): number {
    return tile.y * width + tile.x;
  }

  public static fromIndex(index: number, width: number): GridPosition {
    return {
      x: index % width,
      y: Math.floor(index / width),
    };
  }

  public static isInBounds(tile: GridPosition, width: number, height: number): boolean {
    return tile.x >= 0 && tile.y >= 0 && tile.x < width && tile.y < height;
  }

  public static equals(a: GridPosition, b: GridPosition): boolean {
    return a.x === b.x && a.y === b.y;
  }

  public static manhattanDistance(a: GridPosition, b: GridPosition): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * Row-major flat array reshaped into a 2D [y][x] grid. Used because the
   * JSON map format stores layer/collision data flat, but Phaser's
   * tilemap-from-array APIs and the pathfinder both want 2D grids.
   */
  public static toGrid2D<T>(flat: readonly T[], width: number, height: number): T[][] {
    const grid: T[][] = [];
    for (let y = 0; y < height; y++) {
      const row: T[] = new Array(width);
      for (let x = 0; x < width; x++) {
        row[x] = flat[y * width + x] as T;
      }
      grid.push(row);
    }
    return grid;
  }
}
