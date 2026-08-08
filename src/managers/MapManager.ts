import Phaser from "phaser";
import type { GridPosition, MapData, MapLayerData, MobSpawnDef, MobTypeDef } from "@/types/MapTypes";
import { GridUtils } from "@/utils/GridUtils";
import { EMPTY_TILE_INDEX, MAX_PAINT_LAYERS, MAX_UNDO_HISTORY, PLAYER_LAYER_INDEX, TEXTURE_KEYS } from "@/utils/Constants";
import {
  BRUSH_BORDER_LAYER_INDEX,
  findPaintableTilesetForTileIndex,
  getBrushBorderTileIndex,
  getPaintableTilesetMeta,
  isBrushTilesetKey,
  type BrushBorderKind,
} from "@/utils/TilesetCatalog";

/** A point-in-time copy of every layer's tile data plus the collision grid, pushed onto the undo stack before a discrete edit is applied. */
interface MapSnapshot {
  layers: number[][];
  collisions: boolean[];
}

/**
 * Owns the tilemap: builds Phaser render layers from JSON data and exposes
 * a pure walkability grid that other systems (pathfinding, movement
 * validation) can query without touching Phaser at all.
 *
 * A layer's render depth is purely its position in `mapData.layers` — the
 * map editor's numbered slots (1-5) map 1:1 to array indices, so a higher
 * slot number always draws on top of a lower one. The player sprite sits
 * at PLAYER_LAYER_INDEX (see Constants): layers below that index draw
 * under the player, layers from it up draw over the player.
 */
/** How often (ms) blinking tiles (see MapManager's `alternatingTileIndices`) toggle between visible and invisible — 1s on, 1s off, per the map editor's "Alternar" flag. */
const BLINK_INTERVAL_MS = 1000;

export class MapManager {
  private readonly scene: Phaser.Scene;
  private readonly mapData: MapData;
  private tilemap!: Phaser.Tilemaps.Tilemap;
  private walkableGrid: boolean[][] = [];
  private readonly layers: Phaser.Tilemaps.TilemapLayer[] = [];
  private readonly tilesets: Phaser.Tilemaps.Tileset[] = [];
  private readonly undoStack: MapSnapshot[] = [];
  private blinkTimer!: Phaser.Time.TimerEvent;
  private blinkVisible = true;
  private alternatingTileIndices: ReadonlySet<number> = new Set();

  public constructor(scene: Phaser.Scene, mapData: MapData) {
    this.scene = scene;
    this.mapData = mapData;
    // Maps saved before the mob system existed (e.g. the bundled starter.json) won't have these fields yet.
    this.mapData.mobTypes ??= [];
    this.mapData.mobSpawns ??= [];
    this.build();
    this.blinkTimer = this.scene.time.addEvent({
      delay: BLINK_INTERVAL_MS,
      loop: true,
      callback: () => this.toggleBlink(),
    });
  }

  /**
   * Tells this map which tile indices are marked Alternar (the map editor's
   * "Alternar" checkbox — see MapEditorPanel's `getAlternatingTileIndices`)
   * so its blink timer knows which painted tiles to toggle visible/invisible.
   * Applies immediately at the current blink phase rather than waiting for
   * the next tick, so a texture just marked Alternar snaps into whatever
   * on/off phase every other blinking tile is already in.
   */
  public setAlternatingTileIndices(indices: ReadonlySet<number>): void {
    // A texture dropped from the set (e.g. its Alternar checkbox just got
    // unchecked) needs its tiles explicitly restored — `applyBlinkVisibility`
    // below only ever touches tiles matching the *current* set, so a tile
    // that's mid-blink-off when it drops out would otherwise stay invisible
    // forever with nothing left to toggle it back.
    const removed = [...this.alternatingTileIndices].filter((tileIndex) => !indices.has(tileIndex));
    this.alternatingTileIndices = indices;
    if (removed.length > 0) {
      const removedIndices = new Set(removed);
      for (const layer of this.layers) {
        layer.forEachTile((tile) => {
          if (removedIndices.has(tile.index)) {
            tile.visible = true;
          }
        });
      }
    }
    this.applyBlinkVisibility();
  }

  private toggleBlink(): void {
    this.blinkVisible = !this.blinkVisible;
    this.applyBlinkVisibility();
  }

  /** Shows/hides every currently-painted tile whose index is marked Alternar, across every layer, to match `blinkVisible`. Purely a render toggle — collision and the underlying `mapData` tile index are untouched, so a blinked-out tile still occupies its cell, just invisible. */
  private applyBlinkVisibility(): void {
    if (this.alternatingTileIndices.size === 0) {
      return;
    }
    for (const layer of this.layers) {
      layer.forEachTile((tile) => {
        if (this.alternatingTileIndices.has(tile.index)) {
          tile.visible = this.blinkVisible;
        }
      });
    }
  }

  public get width(): number {
    return this.mapData.width;
  }

  public get height(): number {
    return this.mapData.height;
  }

  public get tileSize(): number {
    return this.mapData.tileSize;
  }

  public get spawnPoint(): GridPosition {
    return this.mapData.spawnPoint;
  }

  public get worldWidthPx(): number {
    return this.mapData.width * this.mapData.tileSize;
  }

  public get worldHeightPx(): number {
    return this.mapData.height * this.mapData.tileSize;
  }

  /** Read-only 2D grid, [y][x], true = walkable. Safe to hand to PathfindingManager. */
  public getWalkableGrid(): readonly boolean[][] {
    return this.walkableGrid;
  }

  public isWalkable(tile: GridPosition): boolean {
    if (!GridUtils.isInBounds(tile, this.mapData.width, this.mapData.height)) {
      return false;
    }
    return this.walkableGrid[tile.y]?.[tile.x] === true;
  }

  /**
   * Finds the nearest walkable tile to `target`, searching outward in
   * expanding rings. Used when a click lands on a blocked tile so we can
   * still route as close as possible, per the "nearest valid path" rule.
   */
  public findNearestWalkable(target: GridPosition, maxRadius = 6): GridPosition | null {
    if (this.isWalkable(target)) {
      return target;
    }

    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
            continue;
          }
          const candidate: GridPosition = { x: target.x + dx, y: target.y + dy };
          if (this.isWalkable(candidate)) {
            return candidate;
          }
        }
      }
    }
    return null;
  }

  /** Tears down the Phaser tilemap layers this instance created. Call before swapping in a new map. */
  public destroy(): void {
    this.blinkTimer.remove();
    this.tilemap.destroy();
  }

  /**
   * Repositions every render layer this map owns to a pixel offset from its
   * native (0, 0) origin. Used to place a just-loaded neighbor map flush
   * against the edge of the current one during the crossing transition, and
   * to rebase it back to (0, 0) once the transition finishes.
   */
  public setLayerOffset(x: number, y: number): void {
    this.layers.forEach((layer) => layer.setPosition(x, y));
  }

  /**
   * Paints a single tile into the given layer (0-based, matching the map
   * editor's slot number minus one). If the map doesn't have that many
   * layers yet, blank ones are created up to it — this is how a map grows
   * from its original 2 layers up to MAX_PAINT_LAYERS as the editor paints
   * into previously-unused slots. Mutates `mapData` in place so the caller
   * (GameScene's map cache) always sees the latest painted state.
   *
   * `blocked` always overwrites the tile's collision state, regardless of
   * which layer it was painted on — collision is a single map-wide flag
   * per tile, not per layer, so painting a new texture with the Block flag
   * off un-blocks a previously-blocked tile, and on blocks it.
   */
  public paintTile(tile: GridPosition, layerIndex: number, tileIndex: number, blocked: boolean): void {
    this.ensureLayerExists(layerIndex);

    const flatIndex = GridUtils.toIndex(tile, this.mapData.width);
    this.mapData.layers[layerIndex]!.data[flatIndex] = tileIndex;
    this.layers[layerIndex]!.putTileAt(tileIndex, tile.x, tile.y);

    this.mapData.collisions[flatIndex] = blocked;
    this.walkableGrid[tile.y]![tile.x] = !blocked;
  }

  /** The tile index at `tile` on `layerIndex`, or EMPTY_TILE_INDEX if out of bounds or that layer doesn't exist yet. */
  private getTileIndexAt(tile: GridPosition, layerIndex: number): number {
    if (!GridUtils.isInBounds(tile, this.mapData.width, this.mapData.height)) {
      return EMPTY_TILE_INDEX;
    }
    const layer = this.mapData.layers[layerIndex];
    if (!layer) {
      return EMPTY_TILE_INDEX;
    }
    return layer.data[GridUtils.toIndex(tile, this.mapData.width)] ?? EMPTY_TILE_INDEX;
  }

  /**
   * Keeps a "Pincéis" (brush) texture's border in sync as the player paints
   * its fill tile — the whole point of that tab (see MapEditorPanel's
   * "Pincéis" tab doc): the artist only ever selects one plain fill
   * texture, and the matching corner/edge art from the same tileset image
   * is stamped in automatically around it, the way RPG Maker autotiles
   * work. GameScene only calls this for a paint whose texture was selected
   * via the "Pincéis" tab (`SelectedPaint.autoBorder`) — the very same fill
   * block can also be painted as an ordinary block straight from the main
   * editor palette, in which case it paints alone, with no border, and this
   * is never called for it. Also a no-op for any tile that isn't an "M"
   * tileset's fill block, as a defensive fallback.
   *
   * Handles any orthogonally-connected blob of `fillTileIndex`, not just
   * solid rectangles — a hollow one (a frame with a hole) gets the concave
   * "inner corner" art at the hole's corners, not just the outer corners of
   * its silhouette. Every empty cell in the blob's bounding box (padded by
   * one tile on every side) is (re)classified from its 8 neighbors — see
   * `classifyBrushBorderCell` — and either painted with the matching
   * corner/edge tile or cleared, so shapes this border art genuinely can't
   * represent (T-junctions, single-tile-wide gaps) degrade to a plain gap
   * rather than a guessed-wrong tile.
   *
   * Re-running this after every brush stroke that changes the blob's shape
   * reclassifies the whole padded area from scratch each time, so tiles
   * that used to be a corner/edge but are now interior (the blob grew over
   * them) or no longer apply (a hole got painted over) never linger. That
   * reclassification is what actually clears them — fill and border paint
   * to different layers (see below), so the fill write alone never touches
   * whatever border tile used to occupy that same cell.
   *
   * `layerIndex` locates the fill blob only (the layer its own paint calls
   * used — always `BRUSH_FILL_LAYER_INDEX`, see MapEditorPanel's layer lock
   * for brush blocks). The border itself always paints on the fixed
   * `BRUSH_BORDER_LAYER_INDEX`, independent of that, so it can never end up
   * sharing the fill's layer — which is exactly why a cell the blob grows
   * into doesn't automatically clear whatever border tile used to sit
   * there; painting the new fill tile is a write to a different layer, and
   * without this reclassification pass the (now stale) border tile would
   * keep drawing on top of it.
   */
  public applyBrushBorder(centerTile: GridPosition, layerIndex: number, fillTileIndex: number, blocked: boolean): void {
    const meta = findPaintableTilesetForTileIndex(fillTileIndex);
    if (!meta || !isBrushTilesetKey(meta.key)) {
      return;
    }
    if (this.getTileIndexAt(centerTile, layerIndex) !== fillTileIndex) {
      return;
    }

    const { minRow, maxRow, minCol, maxCol } = this.findFillBlobBounds(centerTile, layerIndex, fillTileIndex);
    const isFill = (row: number, col: number): boolean => this.getTileIndexAt({ x: col, y: row }, layerIndex) === fillTileIndex;

    for (let row = minRow - 1; row <= maxRow + 1; row++) {
      for (let col = minCol - 1; col <= maxCol + 1; col++) {
        const target: GridPosition = { x: col, y: row };
        if (!GridUtils.isInBounds(target, this.mapData.width, this.mapData.height)) {
          continue;
        }
        // A cell the blob just grew into is fill on its own layer now, but
        // may still hold a stale border tile on this one — clear it here so
        // that leftover never keeps drawing on top of the fresh fill tile.
        if (isFill(row, col)) {
          this.paintTile(target, BRUSH_BORDER_LAYER_INDEX, EMPTY_TILE_INDEX, blocked);
          continue;
        }
        const kind = this.classifyBrushBorderCell(row, col, minRow, minCol, isFill);
        const tileIndex = kind === undefined ? undefined : getBrushBorderTileIndex(fillTileIndex, kind);
        this.paintTile(target, BRUSH_BORDER_LAYER_INDEX, tileIndex ?? EMPTY_TILE_INDEX, blocked);
      }
    }
  }

  /**
   * What border tile (if any) belongs at an empty cell, from the 8-neighbor
   * pattern of fill around it: exactly one orthogonal neighbor is a
   * straight edge; zero orthogonal neighbors but one diagonal is an outer
   * (convex) corner of the blob's silhouette; two adjacent orthogonal
   * neighbors *and* their shared diagonal is an inner (concave) corner —
   * fill wrapping around a notch, e.g. the corner of a hole. Anything else
   * (opposite orthogonal pairs, 3+ neighbors, an adjacent pair whose
   * diagonal doesn't match) has no tile in this set — a T-junction or
   * single-tile gap — so it's left undecorated rather than guessed.
   * `minRow`/`minCol` only seed the edge tiles' alternating A/B variant so
   * a straight run doesn't look stamped from one repeated tile.
   */
  private classifyBrushBorderCell(
    row: number,
    col: number,
    minRow: number,
    minCol: number,
    isFill: (row: number, col: number) => boolean,
  ): BrushBorderKind | undefined {
    const n = isFill(row - 1, col);
    const s = isFill(row + 1, col);
    const e = isFill(row, col + 1);
    const w = isFill(row, col - 1);
    const ne = isFill(row - 1, col + 1);
    const nw = isFill(row - 1, col - 1);
    const se = isFill(row + 1, col + 1);
    const sw = isFill(row + 1, col - 1);
    const orthoCount = Number(n) + Number(s) + Number(e) + Number(w);

    if (orthoCount === 0) {
      if (se && !ne && !nw && !sw) return "topLeftCorner";
      if (sw && !nw && !ne && !se) return "topRightCorner";
      if (ne && !se && !sw && !nw) return "bottomLeftCorner";
      if (nw && !ne && !sw && !se) return "bottomRightCorner";
      return undefined;
    }
    if (orthoCount === 1) {
      const topAlternate = (col - minCol) % 2 === 0;
      const sideAlternate = (row - minRow) % 2 === 0;
      if (s) return topAlternate ? "topEdgeA" : "topEdgeB";
      if (n) return topAlternate ? "bottomEdgeA" : "bottomEdgeB";
      if (e) return sideAlternate ? "leftEdgeA" : "leftEdgeB";
      return sideAlternate ? "rightEdgeA" : "rightEdgeB";
    }
    if (orthoCount === 2) {
      if (n && w) return nw ? "innerTopLeft" : undefined;
      if (n && e) return ne ? "innerTopRight" : undefined;
      if (s && w) return sw ? "innerBottomLeft" : undefined;
      if (s && e) return se ? "innerBottomRight" : undefined;
      return undefined;
    }
    return undefined;
  }

  /** BFS over the 4-connected run of `fillTileIndex` cells on `layerIndex` containing `centerTile`, returning its bounding box — the area `applyBrushBorder` needs to (re)decorate. Caller guarantees `centerTile` itself is part of the run. */
  private findFillBlobBounds(
    centerTile: GridPosition,
    layerIndex: number,
    fillTileIndex: number,
  ): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
    const visited = new Set<string>();
    const key = (tile: GridPosition): string => `${tile.x},${tile.y}`;
    const queue: GridPosition[] = [centerTile];
    visited.add(key(centerTile));

    let minRow = centerTile.y;
    let maxRow = centerTile.y;
    let minCol = centerTile.x;
    let maxCol = centerTile.x;

    const deltas: GridPosition[] = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    while (queue.length > 0) {
      const current = queue.pop()!;
      minRow = Math.min(minRow, current.y);
      maxRow = Math.max(maxRow, current.y);
      minCol = Math.min(minCol, current.x);
      maxCol = Math.max(maxCol, current.x);

      for (const delta of deltas) {
        const next: GridPosition = { x: current.x + delta.x, y: current.y + delta.y };
        if (visited.has(key(next))) {
          continue;
        }
        if (this.getTileIndexAt(next, layerIndex) !== fillTileIndex) {
          continue;
        }
        visited.add(key(next));
        queue.push(next);
      }
    }

    return { minRow, maxRow, minCol, maxCol };
  }

  /**
   * Fills every tile of the given layer with one texture — the bucket
   * tool. `TilemapLayer.fill()` only recolors tiles that already exist, so
   * previously-empty cells (most of a freshly grown layer) would be
   * skipped; `putTileAt` per cell creates them instead, guaranteeing every
   * tile actually ends up painted regardless of what was there before.
   * Also sets every tile's collision state to `blocked` — see `paintTile`.
   */
  public fillLayer(layerIndex: number, tileIndex: number, blocked: boolean): void {
    this.ensureLayerExists(layerIndex);

    this.mapData.layers[layerIndex]!.data.fill(tileIndex);
    this.mapData.collisions.fill(blocked);

    const layer = this.layers[layerIndex]!;
    for (let y = 0; y < this.mapData.height; y++) {
      for (let x = 0; x < this.mapData.width; x++) {
        layer.putTileAt(tileIndex, x, y);
        this.walkableGrid[y]![x] = !blocked;
      }
    }
  }

  /**
   * Scatters a stamp — one or more textures, each at a fixed
   * `gridOffsetX`/`gridOffsetY` relative to the others — across a random
   * fraction of the map: the random tool. One shared dice roll per anchor
   * position (probability `density`, 0-1) decides whether the *whole* stamp
   * lands there, so a multi-texture stamp (e.g. a tree's top and bottom
   * halves) keeps every entry's relative position intact instead of each
   * texture being scattered independently — which is what a separate roll
   * per entry would do. Anchor positions that don't hit the roll are left
   * exactly as they were, so this can be layered on top of existing content
   * instead of replacing it outright the way `fillLayer` does.
   *
   * A winning roll only actually places the stamp if *every* entry can
   * legally land: its target cell must fall inside the map, must not
   * already hold a texture on that same `layerIndex` (an occupied layer
   * cell is left untouched rather than overwritten), and must not sit above
   * a texture marked Estrutural on any layer at or below `layerIndex` (see
   * `structuralTileIndices`) — since a higher slot always draws over a
   * lower one, painting there would visually bury that structural texture.
   * A structural texture on a layer *above* `layerIndex` doesn't block the
   * fill: that layer keeps drawing on top regardless of what a lower layer
   * does underneath it. If any single entry fails this check, the entire
   * stamp is skipped for that anchor — never placed half-finished with
   * some pieces missing.
   */
  public randomFillLayers(
    entries: ReadonlyArray<{
      layerIndex: number;
      tileIndex: number;
      blocked: boolean;
      gridOffsetX: number;
      gridOffsetY: number;
    }>,
    density: number,
    structuralTileIndices: ReadonlySet<number>,
  ): void {
    for (const entry of entries) {
      this.ensureLayerExists(entry.layerIndex);
    }

    for (let y = 0; y < this.mapData.height; y++) {
      for (let x = 0; x < this.mapData.width; x++) {
        if (Math.random() >= density) {
          continue;
        }

        const placements = entries.map((entry) => ({
          entry,
          target: { x: x + entry.gridOffsetX, y: y + entry.gridOffsetY },
        }));

        const canPlaceWholeStamp = placements.every(({ entry, target }) => {
          if (!GridUtils.isInBounds(target, this.mapData.width, this.mapData.height)) {
            return false;
          }
          const flatIndex = GridUtils.toIndex(target, this.mapData.width);
          if (this.mapData.layers[entry.layerIndex]!.data[flatIndex] !== EMPTY_TILE_INDEX) {
            return false;
          }
          return !this.hasStructuralTileAtOrBelow(flatIndex, entry.layerIndex, structuralTileIndices);
        });
        if (!canPlaceWholeStamp) {
          continue;
        }

        for (const { entry, target } of placements) {
          const flatIndex = GridUtils.toIndex(target, this.mapData.width);
          this.mapData.layers[entry.layerIndex]!.data[flatIndex] = entry.tileIndex;
          this.layers[entry.layerIndex]!.putTileAt(entry.tileIndex, target.x, target.y);
          this.mapData.collisions[flatIndex] = entry.blocked;
          this.walkableGrid[target.y]![target.x] = !entry.blocked;
        }
      }
    }
  }

  /** True if any existing layer from 0 up to (and including) `layerIndex` holds a texture marked Estrutural at `flatIndex`. */
  private hasStructuralTileAtOrBelow(flatIndex: number, layerIndex: number, structuralTileIndices: ReadonlySet<number>): boolean {
    const lastLayerIndex = Math.min(layerIndex, this.mapData.layers.length - 1);
    for (let l = 0; l <= lastLayerIndex; l++) {
      if (structuralTileIndices.has(this.mapData.layers[l]!.data[flatIndex]!)) {
        return true;
      }
    }
    return false;
  }

  /** The live map data backing this manager — reflects every `paintTile`/`fillLayer` call. Used to persist the map via Save. */
  public getMapData(): MapData {
    return this.mapData;
  }

  public getMobTypes(): readonly MobTypeDef[] {
    return this.mapData.mobTypes;
  }

  public getMobSpawns(): readonly MobSpawnDef[] {
    return this.mapData.mobSpawns;
  }

  public setMobTypes(mobTypes: MobTypeDef[]): void {
    this.mapData.mobTypes = mobTypes;
  }

  /** Appends one placed mob instance — used when a mob type is dragged onto the canvas in the map editor. */
  public addMobSpawn(spawn: MobSpawnDef): void {
    this.mapData.mobSpawns.push(spawn);
  }

  /** The placed mob instance sitting on `tile`, if any — used by the Mobs tab's eraser to find what a click landed on. */
  public findMobSpawnAtTile(tile: GridPosition): MobSpawnDef | undefined {
    return this.mapData.mobSpawns.find((spawn) => spawn.tile.x === tile.x && spawn.tile.y === tile.y);
  }

  /** Removes one placed mob instance by id — a no-op if it's already gone. Used by the Mobs tab's eraser (single spawn) and by deleting a mob type from the list (every spawn of that type). */
  public removeMobSpawn(id: string): void {
    const index = this.mapData.mobSpawns.findIndex((spawn) => spawn.id === id);
    if (index !== -1) {
      this.mapData.mobSpawns.splice(index, 1);
    }
  }

  /**
   * Snapshots the current layer/collision state so a later `undo()` can
   * restore it. Call once per discrete edit — a full brush stroke, one
   * bucket fill, one random fill — not once per tile, otherwise a single
   * drag would burn through the whole undo budget by itself. Keeps at most
   * MAX_UNDO_HISTORY snapshots, discarding the oldest once full.
   */
  public pushHistorySnapshot(): void {
    this.undoStack.push({
      layers: this.mapData.layers.map((layer) => [...layer.data]),
      collisions: [...this.mapData.collisions],
    });
    if (this.undoStack.length > MAX_UNDO_HISTORY) {
      this.undoStack.shift();
    }
  }

  /**
   * Restores the most recent snapshot pushed by `pushHistorySnapshot`,
   * re-rendering every affected tile and recomputing walkability. A layer
   * that didn't exist yet at snapshot time (grown afterwards by the edit
   * being undone) is cleared back to empty rather than removed, since an
   * all-empty layer is visually and functionally identical to no layer.
   * Returns false with no effect if there's nothing left to undo.
   */
  public undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      return false;
    }

    for (let layerIndex = 0; layerIndex < this.layers.length; layerIndex++) {
      const data = snapshot.layers[layerIndex] ?? new Array(this.mapData.width * this.mapData.height).fill(EMPTY_TILE_INDEX);
      this.mapData.layers[layerIndex]!.data = data;
      this.restoreLayerTiles(layerIndex, data);
    }

    this.mapData.collisions = snapshot.collisions;
    this.walkableGrid = GridUtils.toGrid2D(
      this.mapData.collisions.map((blocked) => !blocked),
      this.mapData.width,
      this.mapData.height,
    );

    return true;
  }

  /** Repaints every cell of one render layer from a flat tile-data array — used to redraw a layer restored by `undo`. */
  private restoreLayerTiles(layerIndex: number, data: number[]): void {
    const layer = this.layers[layerIndex]!;
    for (let y = 0; y < this.mapData.height; y++) {
      for (let x = 0; x < this.mapData.width; x++) {
        layer.putTileAt(data[y * this.mapData.width + x] ?? EMPTY_TILE_INDEX, x, y);
      }
    }
  }

  /** Grows the map up to (and including) `layerIndex`, creating blank layers as needed — see `paintTile`/`fillLayer`. */
  private ensureLayerExists(layerIndex: number): void {
    while (this.layers.length <= layerIndex) {
      this.addLayer({
        name: `layer-${this.layers.length + 1}`,
        data: new Array(this.mapData.width * this.mapData.height).fill(EMPTY_TILE_INDEX),
      });
    }
  }

  private build(): void {
    this.walkableGrid = GridUtils.toGrid2D(
      this.mapData.collisions.map((blocked) => !blocked),
      this.mapData.width,
      this.mapData.height,
    );

    this.tilemap = this.scene.make.tilemap({
      tileWidth: this.mapData.tileSize,
      tileHeight: this.mapData.tileSize,
      width: this.mapData.width,
      height: this.mapData.height,
    });

    const placeholderTileset = this.tilemap.addTilesetImage(
      TEXTURE_KEYS.TILESET,
      TEXTURE_KEYS.TILESET,
      this.mapData.tileSize,
      this.mapData.tileSize,
      0,
      0,
      0,
    );
    if (!placeholderTileset) {
      throw new Error("MapManager: failed to register tileset image with Phaser tilemap.");
    }
    this.tilesets.push(placeholderTileset);

    for (const paintable of getPaintableTilesetMeta()) {
      const tileset = this.tilemap.addTilesetImage(
        paintable.key,
        paintable.key,
        this.mapData.tileSize,
        this.mapData.tileSize,
        0,
        0,
        paintable.firstGid,
      );
      if (!tileset) {
        throw new Error(`MapManager: failed to register paintable tileset "${paintable.key}".`);
      }
      this.tilesets.push(tileset);
    }

    for (const layerData of this.mapData.layers.slice(0, MAX_PAINT_LAYERS)) {
      this.createLayer(layerData);
    }
  }

  /** Adds a brand-new layer to both `mapData.layers` and the live tilemap — used when painting grows a map past its current layer count. */
  private addLayer(layerData: MapLayerData): void {
    this.mapData.layers.push(layerData);
    this.createLayer(layerData);
  }

  private createLayer(layerData: MapLayerData): void {
    const layer = this.tilemap.createBlankLayer(layerData.name, this.tilesets, 0, 0);
    if (!layer) {
      throw new Error(`MapManager: failed to create layer "${layerData.name}".`);
    }

    for (let y = 0; y < this.mapData.height; y++) {
      for (let x = 0; x < this.mapData.width; x++) {
        const tileIndex = layerData.data[y * this.mapData.width + x] ?? EMPTY_TILE_INDEX;
        if (tileIndex === EMPTY_TILE_INDEX) {
          continue;
        }
        layer.putTileAt(tileIndex, x, y);
      }
    }

    layer.setDepth(this.layerDepth(this.layers.length));
    this.layers.push(layer);
  }

  /** A layer's render depth, with a gap left at PLAYER_LAYER_INDEX so the player sprite can sit between layers instead of always on top of (or under) all of them. */
  private layerDepth(layerIndex: number): number {
    return layerIndex < PLAYER_LAYER_INDEX ? layerIndex : layerIndex + 1;
  }
}
