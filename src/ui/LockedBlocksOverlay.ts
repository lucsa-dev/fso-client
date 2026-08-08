import Phaser from "phaser";
import { DEPTH, TILE_SIZE } from "@/utils/Constants";

const MASK_COLOR = 0xff0000;
const MASK_ALPHA = 0.1;
const ICON_COLOR = 0xf2e9d0;
const ICON_KEYHOLE_COLOR = 0x2a2016;

/**
 * Red 20%-opacity mask with a padlock icon, drawn over every non-walkable
 * (locked) tile. Purely a visual aid for the map editor — hidden by default
 * and only toggled visible while the editor panel is open.
 */
export class LockedBlocksOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly width: number;
  private readonly height: number;

  public constructor(scene: Phaser.Scene, width: number, height: number, walkableGrid: readonly boolean[][]) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(DEPTH.MAP_EDITOR_OVERLAY);
    this.graphics.setVisible(false);
    this.width = width;
    this.height = height;
    this.draw(width, height, walkableGrid);
  }

  public setVisible(visible: boolean): void {
    this.graphics.setVisible(visible);
  }

  /** Redraws against a freshly-updated walkable grid — used after the map editor paints a tile's Block flag. */
  public refresh(walkableGrid: readonly boolean[][]): void {
    this.graphics.clear();
    this.draw(this.width, this.height, walkableGrid);
  }

  /** Destroys the Phaser graphics object this overlay created. Call before swapping in a new map. */
  public destroy(): void {
    this.graphics.destroy();
  }

  private draw(width: number, height: number, walkableGrid: readonly boolean[][]): void {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const walkable = walkableGrid[y]?.[x] ?? false;
        if (walkable) {
          continue;
        }

        const left = x * TILE_SIZE;
        const top = y * TILE_SIZE;
        this.graphics.fillStyle(MASK_COLOR, MASK_ALPHA);
        this.graphics.fillRect(left, top, TILE_SIZE, TILE_SIZE);
        this.drawLockIcon(left + TILE_SIZE / 2, top + TILE_SIZE / 2);
      }
    }
  }

  /** Simple vector padlock: an arced shackle over a rounded body, centered on the tile. */
  private drawLockIcon(cx: number, cy: number): void {
    const bodyWidth = TILE_SIZE * 0.34;
    const bodyHeight = TILE_SIZE * 0.26;
    const bodyTop = cy - bodyHeight * 0.15;
    const shackleRadius = bodyWidth / 2;
    const shackleThickness = Math.max(2, TILE_SIZE * 0.045);

    this.graphics.lineStyle(shackleThickness, ICON_COLOR, 0.95);
    this.graphics.beginPath();
    this.graphics.arc(cx, bodyTop, shackleRadius, Math.PI, 0, false);
    this.graphics.strokePath();

    this.graphics.fillStyle(ICON_COLOR, 0.95);
    this.graphics.fillRoundedRect(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight, 3);

    this.graphics.fillStyle(ICON_KEYHOLE_COLOR, 0.9);
    this.graphics.fillCircle(cx, bodyTop + bodyHeight * 0.45, TILE_SIZE * 0.035);
  }
}
