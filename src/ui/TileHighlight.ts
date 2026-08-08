import Phaser from "phaser";
import type { GridPosition } from "@/types/MapTypes";
import { DEPTH } from "@/utils/Constants";
import { GridUtils } from "@/utils/GridUtils";

/** Matches the yellow selection border used throughout the map editor UI. */
const HIGHLIGHT_COLOR = 0xffd700;

type HighlightMode = "hidden" | "tiles" | "all";

/** True if both tile lists have the same positions in the same order — lets `showTiles` skip redundant redraws on every pointer move. */
function tileListsEqual(a: readonly GridPosition[], b: readonly GridPosition[]): boolean {
  return a.length === b.length && a.every((tile, index) => GridUtils.equals(tile, b[index]!));
}

/**
 * Draws yellow borders over map tiles for the map editor's hover feedback:
 * one outline per tile in `showTiles` — one per selected texture, so the
 * brush's whole footprint is visible at once — or a border around every
 * tile on the map for the bucket/random tools (they act on the whole map
 * regardless of texture). Redraws are skipped when the requested state
 * already matches what's on screen, since this runs on every pointer move.
 */
export class TileHighlight {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private mode: HighlightMode = "hidden";
  private shownTiles: GridPosition[] | null = null;

  public constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(DEPTH.DEBUG);
  }

  /** Outlines one square per tile in `tiles` (brush tool — the tiles it would paint). */
  public showTiles(tiles: GridPosition[], tileSize: number): void {
    if (this.mode === "tiles" && this.shownTiles && tileListsEqual(this.shownTiles, tiles)) {
      return;
    }
    this.graphics.clear();
    this.graphics.lineStyle(2, HIGHLIGHT_COLOR, 1);
    for (const tile of tiles) {
      this.graphics.strokeRect(tile.x * tileSize, tile.y * tileSize, tileSize, tileSize);
    }
    this.mode = "tiles";
    this.shownTiles = tiles;
  }

  /** Outlines every tile on the map (bucket/random tools — they'd act on the whole map). */
  public showAll(width: number, height: number, tileSize: number): void {
    if (this.mode === "all") {
      return;
    }
    this.graphics.clear();
    this.graphics.lineStyle(2, HIGHLIGHT_COLOR, 1);
    for (let x = 0; x <= width; x++) {
      this.graphics.lineBetween(x * tileSize, 0, x * tileSize, height * tileSize);
    }
    for (let y = 0; y <= height; y++) {
      this.graphics.lineBetween(0, y * tileSize, width * tileSize, y * tileSize);
    }
    this.mode = "all";
    this.shownTiles = null;
  }

  public hide(): void {
    if (this.mode === "hidden") {
      return;
    }
    this.graphics.clear();
    this.mode = "hidden";
    this.shownTiles = null;
  }

  public destroy(): void {
    this.graphics.destroy();
  }
}
