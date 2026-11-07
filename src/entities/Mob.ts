import Phaser from "phaser";
import type { GridPosition } from "@/types/MapTypes";
import { Direction } from "@/types/GameTypes";
import {
  DEPTH,
  MOB_HOVER_GLOW,
  MOB_HP_BAR,
  MOB_NAME_LABEL,
  MOB_SKINS,
  MOB_STATIC_DISPLAY_SCALE,
  MOB_TILE_MOVE_DURATION_MS,
  MOB_WALK_FRAME_RATE,
  mobAttackRangeTiles,
  PLAYER_DISPLAY_SCALE,
  PLAYER_ORIGIN,
  PLAYER_SPRITE,
  getMobSkinPattern,
  mobWalkAnimKey,
  type MobSkinId,
  type PlayerWalkRow,
} from "@/utils/Constants";
import { GridUtils } from "@/utils/GridUtils";

interface DirectionVisual {
  row: number;
  walkRow: PlayerWalkRow;
  flipX: boolean;
}

export interface MobStats {
  hp: number;
  maxHp: number;
}

/**
 * A server-driven mob instance — purely a playback of state the zone
 * broadcasts (position, HP, death); see fso_web_server's zoneserver.MobState
 * for where the actual AI/combat decisions are made. Never computes its own
 * movement or targeting, same spirit as remote Players (see Player's class
 * doc) — `applyRemoteMove` is the only way its tile ever changes.
 *
 * Two rendering patterns, keyed off MOB_SKINS: "animated" skins (kuka) reuse
 * the exact same spritesheet grid and walk-row math as Player; "static"
 * skins (rato) are a single top-down pose with no walk cycle — rotated to
 * face the movement direction instead, per the mob system spec.
 */
export class Mob {
  private static readonly DOWN_ROW = 0;
  private static readonly SIDE_ROW = 1;
  private static readonly UP_ROW = 2;

  private static readonly DIRECTION_VISUALS: Record<Direction, DirectionVisual> = {
    [Direction.South]: { row: Mob.DOWN_ROW, walkRow: "down", flipX: false },
    [Direction.West]: { row: Mob.SIDE_ROW, walkRow: "side", flipX: false },
    [Direction.East]: { row: Mob.SIDE_ROW, walkRow: "side", flipX: true },
    [Direction.North]: { row: Mob.UP_ROW, walkRow: "up", flipX: false },
  };

  /**
   * A "static" skin's single frame is a top-down pose drawn facing north
   * (head up) — see rato.png — so facing is done by rotating the sprite to
   * match the movement direction rather than flipping it (flipX can't turn
   * a top-down asset to face north/south, and only mirrors east/west).
   */
  private static readonly STATIC_ANGLE_DEG: Record<Direction, number> = {
    [Direction.North]: 0,
    [Direction.East]: 90,
    [Direction.South]: 180,
    [Direction.West]: 270,
  };

  /**
   * Creates every "animated"-pattern mob skin's walk-cycle animations once —
   * mirrors Player.createAnimations exactly (same sheet layout), just under
   * the mob's own texture key and a MOB_WALK_FRAME_RATE tied to mob
   * movement pacing instead of the player's. "static" skins have no
   * animation to create.
   */
  public static createAnimations(scene: Phaser.Scene): void {
    const rows: { walkRow: PlayerWalkRow; row: number }[] = [
      { walkRow: "down", row: Mob.DOWN_ROW },
      { walkRow: "side", row: Mob.SIDE_ROW },
      { walkRow: "up", row: Mob.UP_ROW },
    ];

    for (const skin of MOB_SKINS) {
      if (skin.pattern !== "animated") {
        continue;
      }
      for (const { walkRow, row } of rows) {
        const key = mobWalkAnimKey(skin.id, walkRow);
        if (scene.anims.exists(key)) {
          continue;
        }
        const start = row * PLAYER_SPRITE.COLUMNS;
        scene.anims.create({
          key,
          frames: scene.anims.generateFrameNumbers(skin.id, {
            start,
            end: start + PLAYER_SPRITE.COLUMNS - 1,
          }),
          frameRate: MOB_WALK_FRAME_RATE,
          repeat: -1,
        });
      }
    }
  }

  public readonly sprite: Phaser.GameObjects.Sprite;

  private readonly scene: Phaser.Scene;
  private readonly tileSize: number;
  private readonly skin: MobSkinId;
  private readonly size: number;
  private readonly pattern: "static" | "animated";
  private readonly nameLabel: Phaser.GameObjects.Text;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  private currentTile: GridPosition;
  private currentDirection: Direction = Direction.South;
  private pathQueue: GridPosition[] = [];
  private activeTargetTile: GridPosition | null = null;
  private activeTween: Phaser.Tweens.Tween | null = null;
  private maxHp: number;
  private glowFx: Phaser.FX.Glow | null = null;

  public constructor(
    scene: Phaser.Scene,
    spawnTile: GridPosition,
    tileSize: number,
    name: string,
    skin: MobSkinId,
    size: number,
    stats: MobStats,
  ) {
    this.scene = scene;
    this.tileSize = tileSize;
    this.skin = skin;
    this.size = size;
    this.pattern = getMobSkinPattern(skin);
    this.currentTile = spawnTile;
    this.maxHp = stats.maxHp;

    const worldPos = GridUtils.tileToWorld(spawnTile, tileSize);
    const initialFrame = this.pattern === "animated" ? Mob.DOWN_ROW * PLAYER_SPRITE.COLUMNS : undefined;
    this.sprite = scene.add.sprite(worldPos.x, worldPos.y, skin, initialFrame);
    this.sprite.setName(name);
    this.sprite.setOrigin(PLAYER_ORIGIN.x, PLAYER_ORIGIN.y);
    this.sprite.setScale((this.pattern === "animated" ? PLAYER_DISPLAY_SCALE : MOB_STATIC_DISPLAY_SCALE) * size);
    this.sprite.setDepth(DEPTH.PLAYER);

    this.nameLabel = scene.add.text(worldPos.x, worldPos.y, name, {
      fontSize: MOB_NAME_LABEL.FONT_SIZE,
      color: MOB_NAME_LABEL.COLOR,
      stroke: MOB_NAME_LABEL.STROKE_COLOR,
      strokeThickness: MOB_NAME_LABEL.STROKE_THICKNESS,
    });
    this.nameLabel.setOrigin(0.5, 1);
    this.nameLabel.setDepth(DEPTH.PLAYER_NAME);

    this.hpBarBg = scene.add.rectangle(worldPos.x, worldPos.y, MOB_HP_BAR.WIDTH_PX, MOB_HP_BAR.HEIGHT_PX, MOB_HP_BAR.BACKGROUND_COLOR);
    this.hpBarBg.setOrigin(0.5, 1);
    this.hpBarBg.setDepth(DEPTH.PLAYER_NAME);

    this.hpBarFill = scene.add.rectangle(worldPos.x, worldPos.y, MOB_HP_BAR.WIDTH_PX, MOB_HP_BAR.HEIGHT_PX, MOB_HP_BAR.FILL_COLOR);
    this.hpBarFill.setOrigin(0, 1);
    this.hpBarFill.setDepth(DEPTH.PLAYER_NAME);

    this.syncOverlayPositions();
    this.setHp(stats.hp, stats.maxHp);
    this.showIdleFrame();
  }

  public getCurrentTile(): GridPosition {
    return this.currentTile;
  }

  /** How many tiles ahead this mob's melee reaches (see mobAttackRangeTiles) — used by GameScene's mouse-driven chase to know when to stop and swing instead of always requiring the attacker's own tile or one tile ahead. */
  public getAttackRangeTiles(): number {
    return mobAttackRangeTiles(this.size);
  }

  /**
   * True if a world-space point falls within this mob's actual rendered
   * bounds. Used for mouse hover/click hit-testing instead of comparing
   * grid tiles: PLAYER_ORIGIN anchors the sprite near its feet and the
   * frame's display height comfortably exceeds one tile, so the sprite's
   * head renders into the tile row above `currentTile` while a swath of
   * empty ground below its feet still sits inside `currentTile` — matching
   * on the logical tile square left the hoverable area visibly shifted
   * down from the art (unselectable head, selectable empty ground below
   * the feet).
   */
  public containsWorldPoint(worldX: number, worldY: number): boolean {
    return this.sprite.getBounds().contains(worldX, worldY);
  }

  /**
   * Toggles the yellow hover-highlight glow (see GameScene's mob-hover
   * tracking). Uses postFX so the outline hugs the sprite's actual drawn
   * pixels — only available under the WebGL renderer, a no-op silently
   * skipped otherwise (see MOB_HOVER_GLOW's doc comment).
   */
  public setHighlighted(active: boolean): void {
    if (active) {
      if (!this.glowFx) {
        this.glowFx = this.sprite.postFX?.addGlow(MOB_HOVER_GLOW.COLOR, MOB_HOVER_GLOW.OUTER_STRENGTH, MOB_HOVER_GLOW.INNER_STRENGTH, false) ?? null;
      }
      return;
    }
    if (this.glowFx) {
      this.sprite.postFX?.remove(this.glowFx);
      this.glowFx = null;
    }
  }

  /**
   * Shows/hides the sprite, name label, and HP bar together — used to hide a
   * MobTypeDef.spawnCount duplicate while the map editor is open (see
   * GameScene's `freezeMobsForEditor`), since the editor only ever shows one
   * clickable instance per placed spawn.
   */
  public setVisible(visible: boolean): void {
    this.sprite.setVisible(visible);
    this.nameLabel.setVisible(visible);
    this.hpBarBg.setVisible(visible);
    this.hpBarFill.setVisible(visible);
  }

  /** Redraws the red HP bar's fill width — called on every MobDamaged broadcast (see GameScene.handleMobDamaged). */
  public setHp(hp: number, maxHp: number): void {
    this.maxHp = maxHp;
    const fraction = this.maxHp > 0 ? Phaser.Math.Clamp(hp / this.maxHp, 0, 1) : 0;
    this.hpBarFill.setSize(MOB_HP_BAR.WIDTH_PX * fraction, MOB_HP_BAR.HEIGHT_PX);
  }

  public isMoving(): boolean {
    return this.pathQueue.length > 0 || this.activeTween !== null;
  }

  /**
   * Cancels any in-flight tween/queued path and snaps the sprite straight to
   * `tile` — used to pin a live server-driven mob to its MobSpawnDef tile
   * while the map editor is open (see GameScene's `freezeMobsForEditor`), so
   * it visually sits exactly where the Mobs tab's eraser looks for it
   * (`MapManager.findMobSpawnAtTile` matches on the spawn's fixed tile, not
   * wherever the mob's AI has since wandered to).
   */
  public freezeAtTile(tile: GridPosition): void {
    this.activeTween?.stop();
    this.activeTween = null;
    this.pathQueue = [];
    this.activeTargetTile = null;
    this.currentTile = tile;
    const worldPos = GridUtils.tileToWorld(tile, this.tileSize);
    this.sprite.setPosition(worldPos.x, worldPos.y);
    this.syncOverlayPositions();
    this.showIdleFrame();
  }

  /**
   * Applies a server position update. Same de-duplication/queueing shape as
   * Player.applyRemoteMove — see its doc comment for why naively tweening
   * every message would jitter: the server's mob AI ticker can re-publish a
   * mob's tile as a heartbeat-ish event even when adjacent ticks don't move
   * it, and successive real steps can arrive faster than one tile crossing's
   * tween duration.
   *
   * While the tab is backgrounded, Phaser's own game loop pauses (so queued
   * tweens never drain) but the WebSocket keeps delivering moves, which
   * would otherwise pile up in `pathQueue` and then replay back-to-back at
   * full speed once the tab regains focus, reading as the mob suddenly
   * sprinting. Snapping straight to each update instead keeps state in sync
   * with zero backlog; normal tweened movement resumes on the next update
   * once the tab is visible again.
   */
  public applyRemoteMove(tile: GridPosition): void {
    if (this.isSettledAt(tile) || this.isHeadingTo(tile)) {
      return;
    }
    if (document.hidden) {
      this.freezeAtTile(tile);
      return;
    }
    if (this.isMoving()) {
      this.pathQueue.push(tile);
    } else {
      this.pathQueue = [tile];
      this.advance();
    }
  }

  /** Tears down this mob's sprite, name label, and HP bar — used on MobDied or leaving the map. */
  public destroy(): void {
    this.activeTween?.stop();
    this.sprite.destroy();
    this.nameLabel.destroy();
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
  }

  private isSettledAt(tile: GridPosition): boolean {
    return !this.isMoving() && GridUtils.equals(this.currentTile, tile);
  }

  private isHeadingTo(tile: GridPosition): boolean {
    if (this.activeTargetTile && GridUtils.equals(this.activeTargetTile, tile)) {
      return true;
    }
    const lastQueued = this.pathQueue[this.pathQueue.length - 1];
    return lastQueued !== undefined && GridUtils.equals(lastQueued, tile);
  }

  private advance(): void {
    const nextTile = this.pathQueue.shift();
    if (!nextTile) {
      this.activeTargetTile = null;
      this.showIdleFrame();
      return;
    }

    this.activeTargetTile = nextTile;
    const direction = Mob.directionBetween(this.currentTile, nextTile);
    this.playWalkAnimation(direction);

    const destination = GridUtils.tileToWorld(nextTile, this.tileSize);

    this.activeTween = this.scene.tweens.add({
      targets: this.sprite,
      x: destination.x,
      y: destination.y,
      duration: MOB_TILE_MOVE_DURATION_MS,
      ease: Phaser.Math.Easing.Linear,
      onUpdate: () => this.syncOverlayPositions(),
      onComplete: () => {
        this.currentTile = nextTile;
        this.activeTween = null;
        this.advance();
      },
    });
  }

  private playWalkAnimation(direction: Direction): void {
    this.currentDirection = direction;
    if (this.pattern === "static") {
      this.sprite.setAngle(Mob.STATIC_ANGLE_DEG[direction]);
      return;
    }
    const visual = Mob.DIRECTION_VISUALS[direction];
    this.sprite.setFlipX(visual.flipX);
    this.sprite.anims.play(mobWalkAnimKey(this.skin, visual.walkRow), true);
  }

  private showIdleFrame(): void {
    if (this.pattern === "static") {
      this.sprite.setAngle(Mob.STATIC_ANGLE_DEG[this.currentDirection]);
      return;
    }
    const visual = Mob.DIRECTION_VISUALS[this.currentDirection];
    this.sprite.anims.stop();
    this.sprite.setFlipX(visual.flipX);
    this.sprite.setFrame(visual.row * PLAYER_SPRITE.COLUMNS);
  }

  /** Keeps the name label and HP bar stacked above the sprite's head as it moves — name on top, HP bar just below it, per the mob system spec. */
  private syncOverlayPositions(): void {
    const headY = this.sprite.y - this.sprite.displayHeight * PLAYER_ORIGIN.y;
    const barY = headY - MOB_HP_BAR.OFFSET_ABOVE_HEAD_PX;
    this.hpBarBg.setPosition(this.sprite.x, barY);
    this.hpBarFill.setPosition(this.sprite.x - MOB_HP_BAR.WIDTH_PX / 2, barY);
    this.nameLabel.setPosition(this.sprite.x, barY - MOB_HP_BAR.HEIGHT_PX - MOB_NAME_LABEL.OFFSET_ABOVE_HEAD_PX);
  }

  private static directionBetween(from: GridPosition, to: GridPosition): Direction {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx > 0) {
      return Direction.East;
    }
    if (dx < 0) {
      return Direction.West;
    }
    return dy > 0 ? Direction.South : Direction.North;
  }
}
