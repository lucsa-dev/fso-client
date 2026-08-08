import Phaser from "phaser";
import type { GridPosition } from "@/types/MapTypes";
import { Direction } from "@/types/GameTypes";
import {
  DEFAULT_PLAYER_SKIN,
  DEPTH,
  PLAYER_ATTACK_FRAME_RATE,
  PLAYER_ATTACK_FRAMES,
  PLAYER_DISPLAY_SCALE,
  PLAYER_HP_BAR,
  PLAYER_MAX_HP,
  PLAYER_MAX_XP,
  PLAYER_NAME_LABEL,
  PLAYER_ORIGIN,
  PLAYER_SKINS,
  PLAYER_SPRITE,
  PLAYER_TILE_MOVE_DURATION_MS,
  PLAYER_WALK_FRAME_RATE,
  PLAYER_XP_BAR,
  playerAttackAnimKey,
  playerWalkAnimKey,
  type PlayerAttackDirection,
  type PlayerSkinId,
  type PlayerWalkRow,
} from "@/utils/Constants";
import { GridUtils } from "@/utils/GridUtils";

interface DirectionVisual {
  /** Row index (0-based) within the spritesheet for this direction's walk cycle. */
  row: number;
  walkRow: PlayerWalkRow;
  flipX: boolean;
}

/** Starting HP/XP/level for a newly constructed Player — see the constructor's `stats` param. */
export interface PlayerStats {
  hp: number;
  maxHp: number;
  xp: number;
  maxXp: number;
  level: number;
}

/**
 * Represents the local player's visual presence and tile-by-tile movement
 * playback. Player NEVER computes its own route — GameScene asks
 * PathfindingManager for a path and hands it to `followPath()`. This keeps
 * movement logic reusable later for remote players driven by network
 * snapshots instead of local pathfinding.
 *
 * The source spritesheet only draws three facings — down, one side view,
 * and up — so "east" is produced by horizontally flipping the same
 * side-view row rather than needing a fourth, mirrored row in the art.
 */
export class Player {
  private static readonly DOWN_ROW = 0;
  private static readonly SIDE_ROW = 1;
  private static readonly UP_ROW = 2;

  private static readonly DIRECTION_VISUALS: Record<Direction, DirectionVisual> = {
    [Direction.South]: { row: Player.DOWN_ROW, walkRow: "down", flipX: false },
    [Direction.West]: { row: Player.SIDE_ROW, walkRow: "side", flipX: false },
    [Direction.East]: { row: Player.SIDE_ROW, walkRow: "side", flipX: true },
    [Direction.North]: { row: Player.UP_ROW, walkRow: "up", flipX: false },
  };

  /** Same facing-to-flipX pattern as DIRECTION_VISUALS, but naming the attack flipbook (see PLAYER_ATTACK_FRAMES) each direction plays instead of a walk row. */
  private static readonly ATTACK_DIRECTION_VISUALS: Record<Direction, { attackDirection: PlayerAttackDirection; flipX: boolean }> = {
    [Direction.South]: { attackDirection: "front", flipX: false },
    [Direction.West]: { attackDirection: "side", flipX: false },
    [Direction.East]: { attackDirection: "side", flipX: true },
    [Direction.North]: { attackDirection: "back", flipX: false },
  };

  /**
   * Creates every skin's walk-cycle animations once (each skin needs its
   * own copy — see `playerWalkAnimKey`'s doc comment). Safe to call
   * multiple times; assumes every skin in PLAYER_SKINS has already been
   * loaded as a spritesheet under its own id (see BootScene).
   */
  public static createAnimations(scene: Phaser.Scene): void {
    const rows: { walkRow: PlayerWalkRow; row: number }[] = [
      { walkRow: "down", row: Player.DOWN_ROW },
      { walkRow: "side", row: Player.SIDE_ROW },
      { walkRow: "up", row: Player.UP_ROW },
    ];

    for (const skin of PLAYER_SKINS) {
      for (const { walkRow, row } of rows) {
        const key = playerWalkAnimKey(skin.id, walkRow);
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
          frameRate: PLAYER_WALK_FRAME_RATE,
          repeat: -1,
        });
      }

      const attackDirections: PlayerAttackDirection[] = ["front", "back", "side"];
      for (const attackDirection of attackDirections) {
        const key = playerAttackAnimKey(skin.id, attackDirection);
        if (scene.anims.exists(key)) {
          continue;
        }
        const [first, second] = PLAYER_ATTACK_FRAMES[attackDirection];
        scene.anims.create({
          key,
          frames: [
            { key: skin.id, frame: first },
            { key: skin.id, frame: second },
          ],
          frameRate: PLAYER_ATTACK_FRAME_RATE,
          repeat: -1,
        });
      }
    }
  }

  public readonly sprite: Phaser.GameObjects.Sprite;

  private readonly scene: Phaser.Scene;
  private readonly tileSize: number;
  private readonly skin: PlayerSkinId;
  private readonly characterName: string;
  /** True only for the local player (see GameScene's `new Player(...)` call) — the only one whose real level the client knows, since the server never reports other players' levels (see JoinAcceptedPayload/PlayerJoinedPayload). */
  private readonly showLevel: boolean;
  private readonly nameLabel: Phaser.GameObjects.Text;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  private readonly xpBarBg: Phaser.GameObjects.Rectangle;
  private readonly xpBarFill: Phaser.GameObjects.Rectangle;
  private currentTile: GridPosition;
  private currentDirection: Direction = Direction.South;
  private pathQueue: GridPosition[] = [];
  /** Tile the in-flight tween is currently heading to, if any — see `applyRemoteMove`. */
  private activeTargetTile: GridPosition | null = null;
  private activeTween: Phaser.Tweens.Tween | null = null;
  private onStepComplete: ((tile: GridPosition) => void) | null = null;
  private onPathComplete: (() => void) | null = null;
  private hp: number;
  private maxHp: number;
  private xp: number;
  private maxXp: number;
  private level: number;
  private onHpChanged: ((hp: number, maxHp: number) => void) | null = null;
  private onXpChanged: ((xp: number, maxXp: number) => void) | null = null;
  private onDeath: (() => void) | null = null;

  public constructor(
    scene: Phaser.Scene,
    spawnTile: GridPosition,
    tileSize: number,
    characterName: string,
    skin: PlayerSkinId = DEFAULT_PLAYER_SKIN,
    stats: PlayerStats = { hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, xp: 0, maxXp: PLAYER_MAX_XP, level: 0 },
    showLevel = false,
  ) {
    this.scene = scene;
    this.tileSize = tileSize;
    this.skin = skin;
    this.characterName = characterName;
    this.showLevel = showLevel;
    this.currentTile = spawnTile;
    this.hp = stats.hp;
    this.maxHp = stats.maxHp;
    this.xp = stats.xp;
    this.maxXp = stats.maxXp;
    this.level = stats.level;

    const worldPos = GridUtils.tileToWorld(spawnTile, tileSize);
    this.sprite = scene.add.sprite(worldPos.x, worldPos.y, skin, Player.DOWN_ROW * PLAYER_SPRITE.COLUMNS);
    this.sprite.setName(characterName);
    this.sprite.setOrigin(PLAYER_ORIGIN.x, PLAYER_ORIGIN.y);
    this.sprite.setScale(PLAYER_DISPLAY_SCALE);
    this.sprite.setDepth(DEPTH.PLAYER);

    this.nameLabel = scene.add.text(worldPos.x, worldPos.y, this.nameLabelText(), {
      fontSize: PLAYER_NAME_LABEL.FONT_SIZE,
      color: PLAYER_NAME_LABEL.COLOR,
      stroke: PLAYER_NAME_LABEL.STROKE_COLOR,
      strokeThickness: PLAYER_NAME_LABEL.STROKE_THICKNESS,
    });
    this.nameLabel.setOrigin(0.5, 1);
    this.nameLabel.setDepth(DEPTH.PLAYER_NAME);

    this.hpBarBg = scene.add.rectangle(worldPos.x, worldPos.y, PLAYER_HP_BAR.WIDTH_PX, PLAYER_HP_BAR.HEIGHT_PX, PLAYER_HP_BAR.BACKGROUND_COLOR);
    this.hpBarBg.setOrigin(0.5, 1);
    this.hpBarBg.setDepth(DEPTH.PLAYER_NAME);

    this.hpBarFill = scene.add.rectangle(worldPos.x, worldPos.y, PLAYER_HP_BAR.WIDTH_PX, PLAYER_HP_BAR.HEIGHT_PX, PLAYER_HP_BAR.FILL_COLOR);
    this.hpBarFill.setOrigin(0, 1);
    this.hpBarFill.setDepth(DEPTH.PLAYER_NAME);

    this.xpBarBg = scene.add.rectangle(worldPos.x, worldPos.y, PLAYER_XP_BAR.WIDTH_PX, PLAYER_XP_BAR.HEIGHT_PX, PLAYER_XP_BAR.BACKGROUND_COLOR);
    this.xpBarBg.setOrigin(0.5, 1);
    this.xpBarBg.setDepth(DEPTH.PLAYER_NAME);

    this.xpBarFill = scene.add.rectangle(worldPos.x, worldPos.y, PLAYER_XP_BAR.WIDTH_PX, PLAYER_XP_BAR.HEIGHT_PX, PLAYER_XP_BAR.FILL_COLOR);
    this.xpBarFill.setOrigin(0, 1);
    this.xpBarFill.setDepth(DEPTH.PLAYER_NAME);

    this.syncOverlayPositions();
    this.redrawHpBar();
    this.redrawXpBar();
  }

  public getCurrentTile(): GridPosition {
    return this.currentTile;
  }

  public getHp(): number {
    return this.hp;
  }

  public getMaxHp(): number {
    return this.maxHp;
  }

  public getXp(): number {
    return this.xp;
  }

  public getMaxXp(): number {
    return this.maxXp;
  }

  /** Reported on every JoinRequest so the server can size PlayerState.MaxHP consistently with `maxHpForLevel` (see GameScene.sendJoinRequest) — the zone tracks no XP/level state of its own. */
  public getLevel(): number {
    return this.level;
  }

  /** Fired whenever HP changes (damage, respawn) — the HUD uses this to redraw its bar. */
  public setOnHpChanged(handler: (hp: number, maxHp: number) => void): void {
    this.onHpChanged = handler;
  }

  /** Fired whenever XP changes (gainXp) — the HUD uses this to redraw its bar. */
  public setOnXpChanged(handler: (xp: number, maxXp: number) => void): void {
    this.onXpChanged = handler;
  }

  /** Fired once when HP reaches 0 from `takeDamage` — the caller (GameScene) is responsible for teleporting back to the map's spawn point and calling `respawn()` to refill HP; Player itself has no notion of a map. */
  public setOnDeath(handler: () => void): void {
    this.onDeath = handler;
  }

  /** Subtracts `amount` from HP, clamped at 0, and fires `onDeath` the moment it first hits 0 — never re-fires from further damage while already at 0. */
  public takeDamage(amount: number): void {
    if (this.hp <= 0) {
      return;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.redrawHpBar();
    this.onHpChanged?.(this.hp, this.maxHp);
    if (this.hp === 0) {
      this.onDeath?.();
    }
  }

  /**
   * Adds `amount` to XP. Reaching `maxXp` levels up — possibly more than
   * once for one large reward — carrying any remainder into the next
   * level's bar rather than discarding it. Each level doubles the XP needed
   * for the next one and grants +1 max HP, healing by the same amount
   * immediately (see PLAYER_HP_PER_LEVEL).
   */
  public gainXp(amount: number): void {
    this.xp += amount;
    while (this.xp >= this.maxXp) {
      this.xp -= this.maxXp;
      this.level += 1;
      this.nameLabel.setText(this.nameLabelText());
      this.maxXp *= 2;
      this.maxHp += 1;
      this.hp = Math.min(this.maxHp, this.hp + 1);
      this.redrawHpBar();
      this.onHpChanged?.(this.hp, this.maxHp);
    }
    this.redrawXpBar();
    this.onXpChanged?.(this.xp, this.maxXp);
  }

  /** Refills HP back to full after death — call alongside teleporting back to the spawn point (see `setOnDeath`'s doc comment). Does not touch XP. */
  public respawn(): void {
    this.hp = this.maxHp;
    this.redrawHpBar();
    this.onHpChanged?.(this.hp, this.maxHp);
  }

  /** Clears XP progress toward the current level after death — call alongside `respawn()`. Does not touch level/maxXp, so the bar simply restarts empty at the same level. */
  public resetXp(): void {
    this.xp = 0;
    this.redrawXpBar();
    this.onXpChanged?.(this.xp, this.maxXp);
  }

  /**
   * Sets HP straight from a server-authoritative update (see
   * NetworkTypes.ts's PlayerDamagedPayload/PlayerRespawnedPayload) — unlike
   * `takeDamage`, never fires `onDeath`: mob damage is server-authoritative,
   * so a death is always accompanied by its own PlayerRespawned broadcast
   * (tile + refilled HP together), which GameScene applies directly rather
   * than relying on this class's own death-teleport flow.
   */
  public applyServerHp(hp: number, maxHp: number): void {
    this.hp = hp;
    this.maxHp = maxHp;
    this.redrawHpBar();
    this.onHpChanged?.(this.hp, this.maxHp);
  }

  /** Tears down this player's sprite, name label, and stat bars — used for remote players leaving a map. */
  public destroy(): void {
    this.activeTween?.stop();
    this.sprite.destroy();
    this.nameLabel.destroy();
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    this.xpBarBg.destroy();
    this.xpBarFill.destroy();
  }

  public isMoving(): boolean {
    return this.pathQueue.length > 0 || this.activeTween !== null;
  }

  /** Turns the player to face a direction in place, without moving — used when a step is blocked. */
  public faceDirection(direction: Direction): void {
    this.currentDirection = direction;
    this.showIdleFrame();
  }

  /** Fired every time the player finishes crossing into a new tile. */
  public setOnStepComplete(handler: (tile: GridPosition) => void): void {
    this.onStepComplete = handler;
  }

  /** Fired once the entire path has been walked. */
  public setOnPathComplete(handler: () => void): void {
    this.onPathComplete = handler;
  }

  /**
   * Replaces any in-progress route with a new one and starts walking it
   * immediately, one tile at a time.
   */
  public followPath(path: GridPosition[]): void {
    this.stopMovement();
    this.pathQueue = [...path];
    this.advance();
  }

  /**
   * Cancels any in-flight tween and snaps back to `currentTile`'s exact
   * grid position — a tween stopped mid-flight leaves the sprite at
   * whatever fractional pixel it had reached, and the next step would tween
   * from that off-grid point straight to a tile center, reading as a
   * diagonal slide even though both tiles are orthogonal neighbors of
   * `currentTile`. Snapping guarantees every subsequent step starts from a
   * grid-aligned point, so it's always a straight horizontal or vertical
   * line, same as keyboard movement.
   */
  public stopMovement(): void {
    if (this.activeTween) {
      this.activeTween.stop();
      this.activeTween = null;
      const worldPos = GridUtils.tileToWorld(this.currentTile, this.tileSize);
      this.sprite.setPosition(worldPos.x, worldPos.y);
      this.syncOverlayPositions();
    }
    this.pathQueue = [];
    this.activeTargetTile = null;
  }

  /** Instantly repositions the player with no walk animation — used for map-to-map transitions. */
  public teleportTo(tile: GridPosition): void {
    this.stopMovement();
    this.currentTile = tile;

    const worldPos = GridUtils.tileToWorld(tile, this.tileSize);
    this.sprite.setPosition(worldPos.x, worldPos.y);
    this.syncOverlayPositions();
    this.showIdleFrame();
  }

  /**
   * Walks a fixed pixel delta rather than to a specific tile — used only
   * during a map-crossing transition, where the sprite has to travel
   * through world space that belongs to neither the outgoing nor the
   * incoming map's own tile grid. Does not touch `currentTile`; the caller
   * is responsible for reconciling tile state once the transition lands.
   */
  public panBy(dx: number, dy: number, direction: Direction, duration: number): Promise<void> {
    return new Promise((resolve) => {
      this.stopMovement();
      this.playWalkAnimation(direction);

      this.activeTween = this.scene.tweens.add({
        targets: this.sprite,
        x: this.sprite.x + dx,
        y: this.sprite.y + dy,
        duration,
        ease: Phaser.Math.Easing.Cubic.InOut,
        onUpdate: () => this.syncOverlayPositions(),
        onComplete: () => {
          this.activeTween = null;
          this.showIdleFrame();
          resolve();
        },
      });
    });
  }

  private advance(): void {
    const nextTile = this.pathQueue.shift();
    if (!nextTile) {
      this.activeTargetTile = null;
      // Deliberately doesn't freeze the sprite on the idle frame here: a
      // held arrow key re-issues followPath() with the next single-tile
      // step immediately after this one, and resetting mid-cycle on every
      // such handoff would chop the walk animation down to whatever
      // fraction of a cycle fits in one tile crossing (see
      // PLAYER_WALK_FRAME_RATE). GameScene calls settleIdle() once it
      // confirms, a frame later, that no further step is coming.
      this.onPathComplete?.();
      return;
    }

    this.activeTargetTile = nextTile;
    const direction = Player.directionBetween(this.currentTile, nextTile);
    this.playWalkAnimation(direction);

    const destination = GridUtils.tileToWorld(nextTile, this.tileSize);

    this.activeTween = this.scene.tweens.add({
      targets: this.sprite,
      x: destination.x,
      y: destination.y,
      duration: PLAYER_TILE_MOVE_DURATION_MS,
      ease: Phaser.Math.Easing.Linear,
      onUpdate: () => this.syncOverlayPositions(),
      onComplete: () => {
        this.currentTile = nextTile;
        this.activeTween = null;
        this.onStepComplete?.(nextTile);
        // onStepComplete may itself call followPath() (e.g. GameScene applying
        // a destination the player dragged to mid-step), which starts a new
        // tween synchronously. Don't stomp on it with our own advance().
        if (!this.activeTween) {
          this.advance();
        }
      },
    });
  }

  /**
   * Applies a network position update for a remote player. The gateway can
   * re-broadcast a player's tile as a heartbeat even when they haven't
   * moved, and successive real steps can arrive close enough together to
   * beat a tile crossing's tween duration. Naively feeding every message
   * through `followPath()` would restart the in-flight tween from
   * `currentTile` each time — snapping the sprite backward mid-stride and
   * reading as rapid back-and-forth jitter — and a heartbeat for a tile the
   * player already occupies would keep replaying the walk animation
   * forever, since nothing else ever calls `settleIdle()` for a remote
   * player. Duplicates of the settled tile or the tile already being
   * headed to are dropped; genuinely new tiles are queued behind the
   * current tween instead of interrupting it.
   */
  public applyRemoteMove(tile: GridPosition): void {
    if (this.isSettledAt(tile) || this.isHeadingTo(tile)) {
      return;
    }
    if (this.isMoving()) {
      this.pathQueue.push(tile);
    } else {
      this.followPath([tile]);
    }
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

  /** Keeps the name label and HP/XP bars stacked above the sprite's head as it moves — HP bar closest to the head, XP bar above it, name on top, same layering Mob uses for its name/HP bar. */
  private syncOverlayPositions(): void {
    const headY = this.sprite.y - this.sprite.displayHeight * PLAYER_ORIGIN.y;
    const hpBarY = headY - PLAYER_HP_BAR.OFFSET_ABOVE_HEAD_PX;
    const xpBarY = hpBarY - PLAYER_HP_BAR.HEIGHT_PX - PLAYER_XP_BAR.GAP_ABOVE_HP_BAR_PX;

    this.hpBarBg.setPosition(this.sprite.x, hpBarY);
    this.hpBarFill.setPosition(this.sprite.x - PLAYER_HP_BAR.WIDTH_PX / 2, hpBarY);
    this.xpBarBg.setPosition(this.sprite.x, xpBarY);
    this.xpBarFill.setPosition(this.sprite.x - PLAYER_XP_BAR.WIDTH_PX / 2, xpBarY);
    this.nameLabel.setPosition(this.sprite.x, xpBarY - PLAYER_XP_BAR.HEIGHT_PX - PLAYER_NAME_LABEL.OFFSET_ABOVE_HEAD_PX);
  }

  /** "Lvl 3 Name" for the local player, plain "Name" for everyone else — see `showLevel`'s doc comment. */
  private nameLabelText(): string {
    return this.showLevel ? `Lvl ${this.level} ${this.characterName}` : this.characterName;
  }

  /** Redraws the HP bar's fill width from current hp/maxHp — same sizing math as Mob.setHp. */
  private redrawHpBar(): void {
    const fraction = this.maxHp > 0 ? Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1) : 0;
    this.hpBarFill.setSize(PLAYER_HP_BAR.WIDTH_PX * fraction, PLAYER_HP_BAR.HEIGHT_PX);
  }

  /** Redraws the XP bar's fill width from current xp/maxXp. */
  private redrawXpBar(): void {
    const fraction = this.maxXp > 0 ? Phaser.Math.Clamp(this.xp / this.maxXp, 0, 1) : 0;
    this.xpBarFill.setSize(PLAYER_XP_BAR.WIDTH_PX * fraction, PLAYER_XP_BAR.HEIGHT_PX);
  }

  private playWalkAnimation(direction: Direction): void {
    this.currentDirection = direction;
    const visual = Player.DIRECTION_VISUALS[direction];
    this.sprite.setFlipX(visual.flipX);
    this.sprite.anims.play(playerWalkAnimKey(this.skin, visual.walkRow), true);
  }

  /**
   * Plays (or keeps playing) the attack flipbook facing the player's current
   * direction — call every frame the action key is held, same as
   * playWalkAnimation; `anims.play(key, true)` no-ops if it's already the
   * playing animation, so holding the key just lets it keep looping. Since
   * the attack anim loops forever (repeat: -1) rather than completing on its
   * own, releasing the key relies on the caller falling back to
   * `settleIdle()` (see GameScene.update) to freeze it back on an idle
   * frame, same as it already does for the walk cycle.
   */
  public playAttack(): void {
    const visual = Player.ATTACK_DIRECTION_VISUALS[this.currentDirection];
    this.sprite.setFlipX(visual.flipX);
    this.sprite.anims.play(playerAttackAnimKey(this.skin, visual.attackDirection), true);
  }

  private showIdleFrame(): void {
    const visual = Player.DIRECTION_VISUALS[this.currentDirection];
    this.sprite.anims.stop();
    this.sprite.setFlipX(visual.flipX);
    this.sprite.setFrame(visual.row * PLAYER_SPRITE.COLUMNS);
  }

  /**
   * Freezes the sprite on its idle frame once movement has genuinely
   * stopped. Call this — not the private idle reset baked into `advance()`
   * — from the input loop, only after confirming no further step is
   * about to be queued (e.g. the held key was released); see `advance()`
   * for why chained steps must not trigger this themselves.
   */
  public settleIdle(): void {
    if (!this.sprite.anims.isPlaying) {
      return;
    }
    this.showIdleFrame();
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
