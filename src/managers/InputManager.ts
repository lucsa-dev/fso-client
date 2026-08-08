import Phaser from "phaser";
import type { GridPosition } from "@/types/MapTypes";
import { Direction } from "@/types/GameTypes";
import { GridUtils } from "@/utils/GridUtils";

export type TileClickHandler = (tile: GridPosition) => void;
export type TileHoverHandler = (tile: GridPosition) => void;
export type TilePaintHandler = (tile: GridPosition, isDrag: boolean) => void;

/**
 * Translates raw pointer and keyboard input into tile-grid intents. This is
 * the ONLY class that knows about Phaser's input events — everything
 * downstream (GameScene, Player) only ever deals in GridPosition/Direction,
 * so swapping input schemes later (e.g. touch gestures) means touching just
 * this file.
 */
export class InputManager {
  private readonly scene: Phaser.Scene;
  private readonly tileSize: number;
  private readonly cursorKeys?: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly actionKey?: Phaser.Input.Keyboard.Key;
  private onTileClick: TileClickHandler | null = null;
  private onTileHover: TileHoverHandler | null = null;
  private onTilePaint: TilePaintHandler | null = null;
  private onPointerLeave: (() => void) | null = null;
  private clickEnabled = true;
  /** Tile the pointer was last over during the current button-held drag; used to fire onTileClick again only when the drag crosses into a new tile, not on every pixel of mouse movement. */
  private lastDragTile: GridPosition | null = null;
  /** Tile the pointer last painted during the current button-held drag; used to fire onTilePaint again only when the drag crosses into a new tile, not on every pointermove — otherwise painting a texture with autoBorder re-runs its blob BFS, and the map editor's locked-tile overlay does a full-map redraw, dozens of times a second while the pointer sits over one tile. */
  private lastPaintTile: GridPosition | null = null;

  public constructor(scene: Phaser.Scene, tileSize: number) {
    this.scene = scene;
    this.tileSize = tileSize;
    this.cursorKeys = this.scene.input.keyboard?.createCursorKeys();
    this.actionKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.bindEvents();
  }

  public setOnTileClick(handler: TileClickHandler): void {
    this.onTileClick = handler;
  }

  /** Fires with the tile under the pointer on every move over the game canvas. */
  public setOnTileHover(handler: TileHoverHandler): void {
    this.onTileHover = handler;
  }

  /**
   * Fires with the clicked tile on pointer down (`isDrag` false), and again
   * with every new tile the pointer enters while the button stays held
   * (`isDrag` true) — the map editor's click-to-paint and drag-to-paint
   * behavior. Independent of `clickEnabled` since it's meant to work
   * precisely when click-to-move is suppressed (i.e. while the map editor
   * panel is open).
   */
  public setOnTilePaint(handler: TilePaintHandler): void {
    this.onTilePaint = handler;
  }

  /** Fires when the pointer leaves the game canvas entirely. */
  public setOnPointerLeave(handler: () => void): void {
    this.onPointerLeave = handler;
  }

  /** Click-to-move is suppressed while this is false (e.g. the map editor panel is open); arrow keys keep working regardless. */
  public setClickEnabled(enabled: boolean): void {
    this.clickEnabled = enabled;
  }

  /** Currently held arrow key, if any. Null when none is pressed. */
  public getHeldDirection(): Direction | null {
    if (!this.cursorKeys) {
      return null;
    }
    if (this.cursorKeys.left.isDown) {
      return Direction.West;
    }
    if (this.cursorKeys.right.isDown) {
      return Direction.East;
    }
    if (this.cursorKeys.up.isDown) {
      return Direction.North;
    }
    if (this.cursorKeys.down.isDown) {
      return Direction.South;
    }
    return null;
  }

  /** True while the action key (space) is held down. */
  public isActionHeld(): boolean {
    return this.actionKey?.isDown ?? false;
  }

  private bindEvents(): void {
    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);
    this.scene.input.on(Phaser.Input.Events.GAME_OUT, this.handleGameOut, this);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const tile = this.pointerToTile(pointer);
    this.lastDragTile = tile;
    this.lastPaintTile = tile;
    if (this.onTileClick && this.clickEnabled) {
      this.onTileClick(tile);
    }
    this.onTilePaint?.(tile, false);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const tile = this.pointerToTile(pointer);
    this.onTileHover?.(tile);
    if (!pointer.isDown) {
      return;
    }

    if (this.onTilePaint && (!this.lastPaintTile || !GridUtils.equals(tile, this.lastPaintTile))) {
      this.lastPaintTile = tile;
      this.onTilePaint(tile, true);
    }

    if (this.onTileClick && this.clickEnabled && (!this.lastDragTile || !GridUtils.equals(tile, this.lastDragTile))) {
      this.lastDragTile = tile;
      this.onTileClick(tile);
    }
  }

  private handleGameOut(): void {
    this.onPointerLeave?.();
  }

  private pointerToTile(pointer: Phaser.Input.Pointer): GridPosition {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return GridUtils.worldToTile({ x: worldPoint.x, y: worldPoint.y }, this.tileSize);
  }

  public destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);
    this.scene.input.off(Phaser.Input.Events.GAME_OUT, this.handleGameOut, this);
  }
}
