import Phaser from "phaser";
import type { GridPosition } from "@/types/MapTypes";
import { DEPTH, TILE_SIZE } from "@/utils/Constants";
import { GridUtils } from "@/utils/GridUtils";

/**
 * Optional visual debug layer: grid lines, tile coordinates, blocked tiles,
 * the current path, and the click destination. Entirely additive — never
 * touched by gameplay logic, so it can be deleted without side effects.
 */
export class DebugOverlay {
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;
  private readonly walkableGrid: readonly boolean[][];

  private readonly staticGraphics: Phaser.GameObjects.Graphics;
  private readonly pathGraphics: Phaser.GameObjects.Graphics;
  private readonly coordTexts: Phaser.GameObjects.Text[] = [];
  private visible = false;

  public constructor(scene: Phaser.Scene, width: number, height: number, walkableGrid: readonly boolean[][]) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.walkableGrid = walkableGrid;

    this.staticGraphics = scene.add.graphics();
    this.staticGraphics.setDepth(DEPTH.DEBUG);
    this.staticGraphics.setVisible(false);

    this.pathGraphics = scene.add.graphics();
    this.pathGraphics.setDepth(DEPTH.DEBUG);
    this.pathGraphics.setVisible(false);

    this.drawStaticLayer();
  }

  public toggle(): void {
    this.visible = !this.visible;
    this.staticGraphics.setVisible(this.visible);
    this.pathGraphics.setVisible(this.visible);
    this.coordTexts.forEach((text) => text.setVisible(this.visible));
  }

  public isVisible(): boolean {
    return this.visible;
  }

  /** Destroys every Phaser object this overlay created. Call before swapping in a new map. */
  public destroy(): void {
    this.staticGraphics.destroy();
    this.pathGraphics.destroy();
    this.coordTexts.forEach((text) => text.destroy());
    this.coordTexts.length = 0;
  }

  /** Draws the current computed path and its final destination tile, replacing any previous one. */
  public showPath(path: GridPosition[]): void {
    this.pathGraphics.clear();
    this.pathGraphics.lineStyle(2, 0xffff00, 0.9);
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      if (!from || !to) {
        continue;
      }
      const a = GridUtils.tileToWorld(from, TILE_SIZE);
      const b = GridUtils.tileToWorld(to, TILE_SIZE);
      this.pathGraphics.lineBetween(a.x, a.y, b.x, b.y);
    }

    const destination = path[path.length - 1];
    if (destination) {
      const world = GridUtils.tileToWorld(destination, TILE_SIZE);
      this.pathGraphics.fillStyle(0xffff00, 0.5);
      this.pathGraphics.fillCircle(world.x, world.y, TILE_SIZE * 0.2);
    }
  }

  private drawStaticLayer(): void {
    this.staticGraphics.lineStyle(1, 0xffffff, 0.15);
    for (let x = 0; x <= this.width; x++) {
      this.staticGraphics.lineBetween(x * TILE_SIZE, 0, x * TILE_SIZE, this.height * TILE_SIZE);
    }
    for (let y = 0; y <= this.height; y++) {
      this.staticGraphics.lineBetween(0, y * TILE_SIZE, this.width * TILE_SIZE, y * TILE_SIZE);
    }

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const walkable = this.walkableGrid[y]?.[x] ?? false;
        if (!walkable) {
          this.staticGraphics.fillStyle(0xff0000, 0.25);
          this.staticGraphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }

        const text = this.scene.add.text(x * TILE_SIZE + 2, y * TILE_SIZE + 2, `${x},${y}`, {
          fontSize: "10px",
          color: "#ffffff",
        });
        text.setDepth(DEPTH.DEBUG);
        text.setVisible(false);
        text.setAlpha(0.6);
        this.coordTexts.push(text);
      }
    }
  }
}
