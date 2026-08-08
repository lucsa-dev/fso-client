import Phaser from "phaser";
import { TEXTURE_KEYS, TILE_SIZE } from "@/utils/Constants";

/**
 * Generates placeholder art at runtime for pieces that don't have real
 * source assets yet (currently just the tileset). Real art — like the
 * player spritesheet — is loaded normally via the Phaser loader instead.
 */
export class TextureFactory {
  /** Tile indices within the generated tileset, left to right. */
  public static readonly TILE_INDEX = {
    GRASS: 0,
    PATH: 1,
    WATER: 2,
    TREE: 3,
  } as const;

  /**
   * How many tile indices the placeholder tileset occupies (gids 0..N-1).
   * Real paintable tilesets (see TilesetCatalog) start their own gid ranges
   * right after this, so both can coexist on the same tilemap.
   */
  public static readonly PLACEHOLDER_TILE_COUNT = 4;

  public static generateAll(scene: Phaser.Scene): void {
    TextureFactory.generateTileset(scene);
  }

  private static generateTileset(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEYS.TILESET)) {
      return;
    }

    const tileColors = [0x3a7d34, 0x8a7346, 0x2f6f8f, 0x1f4d1f];
    const graphics = scene.make.graphics({ x: 0, y: 0 });

    tileColors.forEach((color, index) => {
      const offsetX = index * TILE_SIZE;
      graphics.fillStyle(color, 1);
      graphics.fillRect(offsetX, 0, TILE_SIZE, TILE_SIZE);
      graphics.lineStyle(1, 0x000000, 0.25);
      graphics.strokeRect(offsetX, 0, TILE_SIZE, TILE_SIZE);
    });

    graphics.generateTexture(TEXTURE_KEYS.TILESET, TILE_SIZE * tileColors.length, TILE_SIZE);
    graphics.destroy();
  }
}
