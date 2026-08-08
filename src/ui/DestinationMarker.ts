import Phaser from "phaser";
import type { GridPosition } from "@/types/MapTypes";
import { DEPTH } from "@/utils/Constants";
import { GridUtils } from "@/utils/GridUtils";

/** Matches the yellow selection border used throughout the map editor UI. */
const HIGHLIGHT_COLOR = 0xffd700;

/**
 * Outlines the tile a click-to-move path is currently walking toward, in
 * yellow, until the player arrives or a new destination is clicked. Owns
 * its own Graphics layer, separate from TileHighlight's hover feedback,
 * since that one redraws (and would erase this) on every pointer move.
 */
export class DestinationMarker {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private shownTile: GridPosition | null = null;

  public constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(DEPTH.DEBUG);
  }

  public show(tile: GridPosition, tileSize: number): void {
    if (this.shownTile && GridUtils.equals(this.shownTile, tile)) {
      return;
    }
    this.graphics.clear();
    this.graphics.lineStyle(2, HIGHLIGHT_COLOR, 1);
    this.graphics.strokeRect(tile.x * tileSize, tile.y * tileSize, tileSize, tileSize);
    this.shownTile = tile;
  }

  public hide(): void {
    if (!this.shownTile) {
      return;
    }
    this.graphics.clear();
    this.shownTile = null;
  }

  public destroy(): void {
    this.graphics.destroy();
  }
}
