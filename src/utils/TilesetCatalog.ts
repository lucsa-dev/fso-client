import Phaser from "phaser";
import { TextureFactory } from "@/utils/TextureFactory";
import { TILE_SIZE } from "@/utils/Constants";

/**
 * Discovers every tileset source image under assets/tilesets at build time
 * and slices each one into TILE_PX x TILE_PX blocks for the map editor's
 * palette. Dropping a new tileset PNG into that folder makes it show up
 * automatically — nothing else needs to change.
 *
 * The same discovery also drives the *paintable* side: each block gets a
 * `globalTileIndex`, a Phaser tile index the map's tilemap can actually
 * render. Indices start right after the placeholder tileset's own range
 * (see TextureFactory.PLACEHOLDER_TILE_COUNT) and are assigned in the same
 * deterministic order the palette displays swatches in, so "block N in the
 * UI" and "tile index N on the map" always agree — see preparePaintableTileset.
 */

/** Pixel size of one block within a raw tileset source image (not the in-map render size — see TILE_SIZE in Constants). */
export const TILESET_BLOCK_PX = 32;

/** Tileset source filenames starting with this (e.g. "M1.png") belong to the map editor's "Pincéis" tab instead of its main palette — see `isBrushTilesetKey`, MapEditorPanel.populatePalette. */
const BRUSH_TILESET_PREFIX = "M";

/** True for a tileset key (the source PNG's filename, without extension) that belongs to the "Pincéis" tab rather than the main map editor palette. */
export function isBrushTilesetKey(tilesetKey: string): boolean {
  return tilesetKey.startsWith(BRUSH_TILESET_PREFIX);
}

/** Zero-indexed (row, col) of the single block exposed in the "Pincéis" tab for each "M" tileset — see MapEditorPanel.populatePalette. The border ring tiles below are laid out in the same source image relative to this one. */
export const BRUSH_FILL_BLOCK = { row: 4, col: 2 } as const;

/** Layer a brush tileset's fill block (line 5, column 3, 1-indexed) always paints on, regardless of whatever slot is selected in the map editor UI — see MapEditorPanel's layer lock for brush blocks. */
export const BRUSH_FILL_LAYER_INDEX = 0;

/** Layer every brush border-ring tile always paints on, independent of the fill block's own layer — see MapManager.applyBrushBorder. */
export const BRUSH_BORDER_LAYER_INDEX = 1;

/**
 * The border roles an "M" tileset image provides around its fill block: two
 * alternating variants per straight edge (so a run doesn't look like it's
 * stamped from one repeated tile), the four outer (convex) corners of a
 * filled blob's silhouette, and the four inner (concave) corners needed
 * where a blob curves inward on itself — e.g. the corners of a hole in a
 * hollow shape, where fill wraps around on two adjacent sides plus their
 * shared diagonal. See `MapManager`'s brush-border cell classifier for how a
 * given empty cell's 8 neighbors decide which of these applies.
 */
export type BrushBorderKind =
  | "topLeftCorner"
  | "topRightCorner"
  | "bottomLeftCorner"
  | "bottomRightCorner"
  | "innerTopLeft"
  | "innerTopRight"
  | "innerBottomLeft"
  | "innerBottomRight"
  | "topEdgeA"
  | "topEdgeB"
  | "bottomEdgeA"
  | "bottomEdgeB"
  | "leftEdgeA"
  | "leftEdgeB"
  | "rightEdgeA"
  | "rightEdgeB";

/** Fixed (row, col) of each border role within an "M" tileset's own image — the same for every "M" tileset, since they all share this layout. */
const BRUSH_BORDER_BLOCKS: Record<BrushBorderKind, { row: number; col: number }> = {
  topLeftCorner: { row: 4, col: 0 },
  topRightCorner: { row: 4, col: 1 },
  bottomLeftCorner: { row: 5, col: 0 },
  bottomRightCorner: { row: 5, col: 1 },
  innerTopLeft: { row: 0, col: 0 },
  innerTopRight: { row: 0, col: 3 },
  innerBottomLeft: { row: 3, col: 0 },
  innerBottomRight: { row: 3, col: 3 },
  topEdgeA: { row: 3, col: 1 },
  topEdgeB: { row: 3, col: 2 },
  bottomEdgeA: { row: 0, col: 1 },
  bottomEdgeB: { row: 0, col: 2 },
  leftEdgeA: { row: 2, col: 3 },
  leftEdgeB: { row: 1, col: 3 },
  rightEdgeA: { row: 1, col: 0 },
  rightEdgeB: { row: 2, col: 0 },
};

/** The paintable tileset a `globalTileIndex` belongs to (its gid falls within that tileset's own range), or undefined if it's out of range of every discovered tileset. */
export function findPaintableTilesetForTileIndex(tileIndex: number): PaintableTileset | undefined {
  return getPaintableTilesetMeta().find(
    (meta) => tileIndex >= meta.firstGid && tileIndex < meta.firstGid + meta.columns * meta.rows,
  );
}

/**
 * Given the `globalTileIndex` of an "M" tileset's fill block, resolves the
 * tile index of one of its border-ring roles — same tileset image, fixed
 * (row, col) per `BRUSH_BORDER_BLOCKS`. Returns undefined if `fillTileIndex`
 * isn't recognized as belonging to any discovered tileset.
 */
export function getBrushBorderTileIndex(fillTileIndex: number, kind: BrushBorderKind): number | undefined {
  const meta = findPaintableTilesetForTileIndex(fillTileIndex);
  if (!meta) {
    return undefined;
  }
  const block = BRUSH_BORDER_BLOCKS[kind];
  return meta.firstGid + block.row * meta.columns + block.col;
}

export interface TilesetBlock {
  tilesetKey: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  col: number;
  row: number;
  /** Phaser tile index this block renders as once painted onto a map layer. */
  globalTileIndex: number;
}

/** A tileset image ready to be registered with a Phaser tilemap. */
export interface PaintableTileset {
  key: string;
  firstGid: number;
  columns: number;
  rows: number;
}

interface TilesetSource {
  tilesetKey: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  columns: number;
  rows: number;
  firstGid: number;
}

const tilesetUrls = import.meta.glob<string>("../assets/tilesets/*.png", {
  eager: true,
  import: "default",
  query: "?url",
});

/** Cached once `preparePaintableTileset` has run — see its docstring. */
let paintableTilesetMeta: PaintableTileset[] | null = null;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`TilesetCatalog: failed to load image "${url}".`));
    image.src = url;
  });
}

/**
 * Enumerates every tileset PNG in a fixed, deterministic order (sorted by
 * path) and computes each one's gid range. Both the DOM palette
 * (`loadTilesetBlocks`) and the runtime paintable atlas
 * (`preparePaintableTileset`) build off this same list, so their indices
 * can never drift apart.
 */
async function discoverTilesetSources(): Promise<TilesetSource[]> {
  const entries = Object.entries(tilesetUrls).sort(([a], [b]) => a.localeCompare(b));

  let nextGid = TextureFactory.PLACEHOLDER_TILE_COUNT;
  const sources: TilesetSource[] = [];

  for (const [path, imageUrl] of entries) {
    const tilesetKey = path.split("/").pop()!.replace(/\.png$/, "");
    const image = await loadImage(imageUrl);
    const columns = Math.floor(image.naturalWidth / TILESET_BLOCK_PX);
    const rows = Math.floor(image.naturalHeight / TILESET_BLOCK_PX);

    sources.push({
      tilesetKey,
      imageUrl,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      columns,
      rows,
      firstGid: nextGid,
    });
    nextGid += columns * rows;
  }

  return sources;
}

/** Loads every tileset image and slices it into its individual blocks, each tagged with its paintable tile index. */
export async function loadTilesetBlocks(): Promise<TilesetBlock[]> {
  const sources = await discoverTilesetSources();

  const blocks: TilesetBlock[] = [];
  for (const source of sources) {
    for (let row = 0; row < source.rows; row++) {
      for (let col = 0; col < source.columns; col++) {
        blocks.push({
          tilesetKey: source.tilesetKey,
          imageUrl: source.imageUrl,
          imageWidth: source.imageWidth,
          imageHeight: source.imageHeight,
          col,
          row,
          globalTileIndex: source.firstGid + row * source.columns + col,
        });
      }
    }
  }
  return blocks;
}

/**
 * Builds a paintable Phaser texture for every discovered tileset image —
 * the source art is authored at TILESET_BLOCK_PX (32px) but the map's grid
 * cells are TILE_SIZE (64px), so each image is redrawn onto an offscreen
 * canvas at 2x with smoothing disabled (keeps pixel art crisp, matching the
 * palette swatches' `image-rendering: pixelated`) before being registered
 * as a texture. Idempotent — safe to call once at boot. Must complete
 * before any MapManager is constructed, since MapManager registers these
 * tilesets synchronously via `getPaintableTilesetMeta()`.
 */
export async function preparePaintableTileset(scene: Phaser.Scene): Promise<void> {
  const sources = await discoverTilesetSources();
  const scale = TILE_SIZE / TILESET_BLOCK_PX;

  for (const source of sources) {
    if (!scene.textures.exists(source.tilesetKey)) {
      const image = await loadImage(source.imageUrl);
      const canvas = document.createElement("canvas");
      canvas.width = source.imageWidth * scale;
      canvas.height = source.imageHeight * scale;

      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      scene.textures.addCanvas(source.tilesetKey, canvas);
    }
  }

  paintableTilesetMeta = sources.map((source) => ({
    key: source.tilesetKey,
    firstGid: source.firstGid,
    columns: source.columns,
    rows: source.rows,
  }));
}

/** Metadata for every paintable tileset, ready for `Tilemap.addTilesetImage`. Populated by `preparePaintableTileset` — empty until then. */
export function getPaintableTilesetMeta(): PaintableTileset[] {
  return paintableTilesetMeta ?? [];
}
