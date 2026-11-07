/** Pixel size of a single tile, both on screen and in map JSON. */
export const TILE_SIZE = 64;

/** Height of the fixed bottom bar (chat + sky widget + inventory) — the game canvas insets from the bottom of the viewport by this much while GameScene is active (see GameScene, BottomBar). */
export const BOTTOM_BAR_HEIGHT_PX = 160;

/** Width of the sky widget column within the bottom bar — reserved space for a future day/night sun-and-moon indicator (see SkyWidget). */
export const SKY_WIDGET_WIDTH_PX = 32;

/** Width of the inventory column within the bottom bar — reserved space for the future HP/SP/XP bars and item slot grid (see InventoryPanel). */
export const INVENTORY_PANEL_WIDTH_PX = 260;

/** How many numbered layer slots the map editor exposes (also caps how many render layers a map can grow to). */
export const MAX_PAINT_LAYERS = 5;

/** Maximum number of past edits the map editor's undo (Ctrl+Z) can step back through — see MapManager's undo stack. */
export const MAX_UNDO_HISTORY = 20;

/**
 * 0-based paint-layer index the player renders at ("layer 2" in the
 * editor's 1-based numbering). Paint layers below this index draw under
 * the player; from this index up, they draw over the player — see
 * MapManager's depth assignment, which reserves this slot for DEPTH.PLAYER
 * instead of handing it to a layer.
 */
export const PLAYER_LAYER_INDEX = 2;

/** Render depth ordering. Higher draws on top. Paint layers occupy 0..MAX_PAINT_LAYERS (skipping PLAYER_LAYER_INDEX, reserved below) — see MapManager. */
export const DEPTH = {
  PLAYER: PLAYER_LAYER_INDEX,
  // Above every paint layer (max depth MAX_PAINT_LAYERS, per MapManager.layerDepth), not just above
  // the player sprite — a name/HP/XP label must never sit under a layer like tree canopies or roofs.
  PLAYER_NAME: MAX_PAINT_LAYERS + 0.5,
  MAP_EDITOR_OVERLAY: MAX_PAINT_LAYERS + 1,
  TRANSITION_FADE: 50,
  DEBUG: 100,
} as const;

/** Milliseconds it takes the player to walk across exactly one tile. */
export const PLAYER_TILE_MOVE_DURATION_MS = 220;

/** Milliseconds the camera/player take to slide across the seam when crossing from one map to the next. */
export const MAP_TRANSITION_DURATION_MS = 450;

/** Peak darkness (0 = invisible, 1 = opaque black) of the dim pulse that softens a map crossing. */
export const MAP_TRANSITION_FADE_ALPHA = 0.35;

/**
 * Layout of the player spritesheet: a 4-column grid of 244x280 frames.
 * Each row is a 4-frame walk cycle for one facing direction (column 0 is a
 * dedicated standing/idle pose, not part of the walk cycle's motion — the
 * character always rests on it between steps). The canvas is 976x1103, but
 * only the top 3 rows (down, side, up) hold art; Phaser's spritesheet
 * slicer floors 1103/280 = 3 rows, so the blank remainder below is never
 * turned into frames.
 */
export const PLAYER_SPRITE = {
  FRAME_WIDTH: 244,
  FRAME_HEIGHT: 280,
  COLUMNS: 4,
} as const;

/**
 * Every character skin the client has a spritesheet and animations for. Each
 * `id` doubles as both the Phaser texture key it's loaded under (see
 * BootScene) and the value persisted with the account (see RegisterScene,
 * fso_web_server's accountstore) — picked once at registration and echoed
 * back on every login (LoginScene) so GameScene knows which one to render.
 */
export const PLAYER_SKINS = [
  { id: "player", label: "Skin 1" },
  { id: "player1", label: "Skin 2" },
] as const;

export type PlayerSkinId = (typeof PLAYER_SKINS)[number]["id"];

export const DEFAULT_PLAYER_SKIN: PlayerSkinId = PLAYER_SKINS[0].id;

/** True if `value` is one of PLAYER_SKINS' ids — narrows an arbitrary string (e.g. from a network/HTTP response) down to PlayerSkinId. */
export function isPlayerSkinId(value: string): value is PlayerSkinId {
  return PLAYER_SKINS.some((skin) => skin.id === value);
}

/**
 * Tied to tile-move timing rather than a fixed number, so the walk cycle
 * stays in sync with actual movement speed. The full 4-frame cycle is
 * spread across two tile crossings (2 * PLAYER_TILE_MOVE_DURATION_MS) —
 * chained steps in the same direction don't reset the animation (see
 * Player.advance()/settleIdle()), so the cycle keeps flowing across steps
 * instead of needing to finish within a single one.
 */
export const PLAYER_WALK_FRAME_RATE = (PLAYER_SPRITE.COLUMNS * 1000) / (2 * PLAYER_TILE_MOVE_DURATION_MS);

/**
 * The spritesheet's automatic slicing (see BootScene's `load.spritesheet`)
 * only yields 3 full rows / 12 frames (indices 0-11): with frameHeight 280
 * and a 1103px-tall source image, Phaser floors 1103/280 down to 3 rows and
 * drops the partial remainder — see PLAYER_SPRITE's doc comment. That
 * remainder isn't blank, though: it holds one bonus frame (row 4, column 1)
 * that the art doesn't fit anywhere else. BootScene adds it back in by hand
 * as a named frame under this key so animations can reference it. Used as
 * the "lunge" pose for a side-facing attack (see PLAYER_ATTACK_FRAMES) —
 * there's no dedicated attack row in the art, so the side attack alternates
 * between this and the side row's idle frame instead.
 */
export const PLAYER_ATTACK_EXTRA_FRAME = {
  KEY: "attack-side-extra",
  Y: PLAYER_SPRITE.FRAME_HEIGHT * 3,
  /** Actual remaining pixel height below the 3 full rows (1103 - 3*280). */
  HEIGHT: 263,
} as const;

/** A facing category for the attack animation — "side" covers both west and east (mirrored via flipX, same as the walk cycle's side row). */
export type PlayerAttackDirection = "front" | "back" | "side";

/**
 * Frame indices for each attack direction's 2-frame flipbook, reusing the
 * existing walk-cycle art rather than needing dedicated attack frames:
 * front/back alternate each row's first walk frame (column 2) with its idle
 * frame (column 1); side alternates the bonus row-4 lunge frame
 * (PLAYER_ATTACK_EXTRA_FRAME) with the side row's idle frame. Numbers are
 * texture frame indices (0-based); PLAYER_ATTACK_EXTRA_FRAME.KEY stands in
 * for the one frame that isn't part of the auto-sliced 0-11 range.
 */
export const PLAYER_ATTACK_FRAMES: Record<PlayerAttackDirection, [number | string, number | string]> = {
  front: [1, 0],
  back: [9, 8],
  side: [PLAYER_ATTACK_EXTRA_FRAME.KEY, 4],
};

/**
 * One full attack cycle (2 frames) per second, per the spec — independent of
 * PLAYER_WALK_FRAME_RATE, which is tied to tile-move timing instead.
 */
export const PLAYER_ATTACK_FRAME_RATE = 2;

/** A level-0 character's max/starting HP — see Player's `takeDamage`/`respawn`/`gainXp`. */
export const PLAYER_MAX_HP = 20;

/** A level-0 character's max XP — see Player's `gainXp`. Doubles every level (see `maxXpForLevel`). */
export const PLAYER_MAX_XP = 30;

/** Max-HP bonus granted per level — mirrors fso_web_server's PlayerHPPerLevel. */
export const PLAYER_HP_PER_LEVEL = 1;

/** A player's max HP at a given level (level 0 -> PLAYER_MAX_HP, level 1 -> PLAYER_MAX_HP + 1, ...) — see Player's `gainXp` and JoinRequestPayload.level. */
export function maxHpForLevel(level: number): number {
  return PLAYER_MAX_HP + level * PLAYER_HP_PER_LEVEL;
}

/** A player's max XP at a given level — doubles every level, starting from PLAYER_MAX_XP at level 0 — see Player's `gainXp`. */
export function maxXpForLevel(level: number): number {
  return PLAYER_MAX_XP * 2 ** level;
}

/** Every skin needs its own copy — same reasoning as playerWalkAnimKey. */
export function playerAttackAnimKey(skin: PlayerSkinId, direction: PlayerAttackDirection): string {
  return `${skin}-attack-${direction}`;
}

/** Scales the ~244x275 source frame down to roughly one tile wide. */
export const PLAYER_DISPLAY_SCALE = 0.26;

/** Anchor point within the frame used as the character's "feet" for tile alignment. */
export const PLAYER_ORIGIN = { x: 0.5, y: 0.9 } as const;

/** Style for the character-name label drawn above the sprite's head. */
export const PLAYER_NAME_LABEL = {
  OFFSET_ABOVE_HEAD_PX: 6,
  FONT_SIZE: "12px",
  COLOR: "#ffffff",
  STROKE_COLOR: "#000000",
  STROKE_THICKNESS: 3,
} as const;

/**
 * Geometry/colors for the thin red HP bar drawn above the local player's
 * head, right below the name label — same visual language as MOB_HP_BAR
 * (below), just for the player. Never carries numbers; the exact HP value
 * lives in BottomBar's inventory panel for players who want it.
 */
export const PLAYER_HP_BAR = {
  WIDTH_PX: 36,
  HEIGHT_PX: 4,
  OFFSET_ABOVE_HEAD_PX: 20,
  BACKGROUND_COLOR: 0x3a1414,
  FILL_COLOR: 0xd22c2c,
} as const;

/** Same idea as PLAYER_HP_BAR, stacked directly above it — mobs have no XP concept, so this one's player-only. */
export const PLAYER_XP_BAR = {
  WIDTH_PX: 36,
  HEIGHT_PX: 3,
  GAP_ABOVE_HP_BAR_PX: 2,
  BACKGROUND_COLOR: 0x163212,
  FILL_COLOR: 0x3aa832,
} as const;

/**
 * Every mob skin the client has art for, keyed by the same id persisted in a
 * map's MobTypeDef.skin (see fso_web_server's mapdata.MobTypeDef). "static"
 * skins (rato.png) are a single top-down pose with no walk cycle — only
 * flipped horizontally to face east/west; "animated" skins (kuka.png) are
 * drawn to the exact same grid as PLAYER_SPRITE and reuse Player's
 * walk/attack row math verbatim, just loaded under their own texture key.
 */
export type MobSkinPattern = "static" | "animated";

export const MOB_SKINS = [
  { id: "rato", label: "Rato", pattern: "static" as MobSkinPattern },
  { id: "kuka", label: "Kuka", pattern: "animated" as MobSkinPattern },
] as const;

export type MobSkinId = (typeof MOB_SKINS)[number]["id"];

export const DEFAULT_MOB_SKIN: MobSkinId = MOB_SKINS[0].id;

/** True if `value` is one of MOB_SKINS' ids — narrows an arbitrary string (e.g. from a network payload) down to MobSkinId. */
export function isMobSkinId(value: string): value is MobSkinId {
  return MOB_SKINS.some((skin) => skin.id === value);
}

export function getMobSkinPattern(skin: MobSkinId): MobSkinPattern {
  return MOB_SKINS.find((entry) => entry.id === skin)!.pattern;
}

/** Native pixel size of rato.png's single static pose — see MOB_SKINS. */
export const MOB_STATIC_FRAME = { WIDTH: 128, HEIGHT: 128 } as const;

/** Scales rato.png's 128x128 frame down to roughly one tile wide, matching PLAYER_DISPLAY_SCALE's intent for kuka.png (which reuses PLAYER_SPRITE/PLAYER_DISPLAY_SCALE directly — same sheet layout as the player). */
export const MOB_STATIC_DISPLAY_SCALE = TILE_SIZE / MOB_STATIC_FRAME.WIDTH;

/** Milliseconds a mob takes to walk across one tile — server ticks mob AI at roughly this cadence (see fso_web_server's zoneserver.MapCell mob ticker); kept as its own constant rather than reusing PLAYER_TILE_MOVE_DURATION_MS since mob and player pacing are independent by design. */
export const MOB_TILE_MOVE_DURATION_MS = 400;

/** Same reasoning as PLAYER_WALK_FRAME_RATE, tied to MOB_TILE_MOVE_DURATION_MS instead — only meaningful for "animated"-pattern skins (see MOB_SKINS). */
export const MOB_WALK_FRAME_RATE = (PLAYER_SPRITE.COLUMNS * 1000) / (2 * MOB_TILE_MOVE_DURATION_MS);

/** Style for the mob name label — same shape as PLAYER_NAME_LABEL. */
export const MOB_NAME_LABEL = {
  OFFSET_ABOVE_HEAD_PX: 6,
  FONT_SIZE: "12px",
  COLOR: "#ffcccc",
  STROKE_COLOR: "#000000",
  STROKE_THICKNESS: 3,
} as const;

/** Geometry/colors for the red HP bar drawn above a mob's head, below its name label. */
export const MOB_HP_BAR = {
  WIDTH_PX: 36,
  HEIGHT_PX: 4,
  OFFSET_ABOVE_HEAD_PX: 20,
  BACKGROUND_COLOR: 0x3a1414,
  FILL_COLOR: 0xd22c2c,
} as const;

/**
 * Yellow hover-highlight glow for a moused-over mob (see Mob.setHighlighted),
 * drawn via Phaser's postFX Glow pipeline — respects the sprite's alpha
 * channel, so it hugs the mob's actual drawn silhouette instead of a bounding
 * box. Same yellow as TileHighlight/DestinationMarker's tile-square outlines
 * (see TileHighlight's HIGHLIGHT_COLOR), for a consistent selection color
 * across the map editor and combat.
 */
export const MOB_HOVER_GLOW = {
  COLOR: 0xffd700,
  OUTER_STRENGTH: 3,
  INNER_STRENGTH: 0,
} as const;

/** Every skin needs its own copy of each walk/attack animation — same reasoning as playerWalkAnimKey. Only meaningful for "animated"-pattern skins (see MOB_SKINS). */
export function mobWalkAnimKey(skin: MobSkinId, row: PlayerWalkRow): string {
  return `mob-${skin}-walk-${row}`;
}

export function mobAttackAnimKey(skin: MobSkinId, direction: PlayerAttackDirection): string {
  return `mob-${skin}-attack-${direction}`;
}

/** HTML5 drag-and-drop `dataTransfer` key carrying a MobTypeDef id — set by a draggable row in the map editor's Mobs tab list (MapEditorPanel), read by GameScene's drop handler on the game canvas. */
export const MOB_DRAG_DATA_TYPE = "application/x-fso-mob-type-id";

/** Fixed combat numbers from the mob system spec: a player's hit always removes this much mob HP; both a player's and a mob's attack can land at most once per this cooldown, with the very first hit on contact landing immediately (no cooldown wait) — see fso_web_server's zoneserver.MapCell.Attack/tickMobs. */
export const PLAYER_ATTACK_DAMAGE = 5;
export const ATTACK_COOLDOWN_MS = 1000;
/** An attack lands if the target is on the attacker's own tile or up to `mobAttackRangeTiles(mobType.size)` tiles ahead in their facing direction — 1 tile at the default size (see MOB_SIZE_DEFAULT). */
export const ATTACK_RANGE_TILES = 1;

/** MobTypeDef.size bounds/default/slider-step, in tiles/blocks — "de 1/4 de bloco até 5 blocos" per the mob size spec. */
export const MOB_SIZE_MIN = 0.25;
export const MOB_SIZE_MAX = 5;
export const MOB_SIZE_DEFAULT = 1;
export const MOB_SIZE_STEP = 0.25;

/** MobTypeDef.size, defaulting to MOB_SIZE_DEFAULT for maps saved before the field existed — mirrors fso_web_server's zoneserver.mobSize's zero-defaulting exactly. */
export function resolveMobSize(size: number | undefined): number {
  return size && size > 0 ? size : MOB_SIZE_DEFAULT;
}

/**
 * Converts a mob's size (a size×size tile footprint centered on its own
 * tile) into how many tiles straight ahead its melee reaches — mirrors
 * fso_web_server's zoneserver.mobAttackRangeTiles exactly (same formula),
 * used client-side only for the mouse-driven chase's "stop and swing" check
 * (see GameScene's `isAdjacentForAttack`); the server is the sole authority
 * on whether a hit actually lands.
 */
export function mobAttackRangeTiles(size: number): number {
  const clamped = Math.max(1, size);
  return Math.floor((clamped - 1) / 2) + 1;
}

/** Camera follow smoothing factor (0 = instant snap, 1 = never catches up). */
export const CAMERA_LERP = 0.12;

export const CAMERA_ZOOM = 1.5;

/** Bounds and step for the settings menu's zoom in/out buttons (see CameraManager, SettingsMenu). */
export const CAMERA_ZOOM_MIN = 0.75;
export const CAMERA_ZOOM_MAX = 3;
export const CAMERA_ZOOM_STEP = 0.25;

/** Value used in a layer's flat data array to mean "no tile placed here". */
export const EMPTY_TILE_INDEX = -1;

export const SCENE_KEYS = {
  BOOT: "BootScene",
  LOGIN: "LoginScene",
  REGISTER: "RegisterScene",
  SETTINGS: "SettingsScene",
  GAME: "GameScene",
} as const;

export const TEXTURE_KEYS = {
  TILESET: "tileset",
} as const;

export const ASSET_PATHS = {
  STARTER_MAP: "/assets/maps/starter.json",
} as const;

/** Dimensions used for procedurally generated (empty) neighbor maps, matching the starter map's grid. */
export const DEFAULT_MAP_WIDTH = 64;
export const DEFAULT_MAP_HEIGHT = 64;

/** Dev-only: the fso_web_server gateway's host — matches whatever host the client itself was loaded from, so it also works when reached over the LAN by IP instead of localhost. */
const GATEWAY_HOST =
  typeof window !== "undefined" ? window.location.hostname : "localhost";

/** Dev-only: the fso_web_server gateway's HTTP origin (see fso_web_server/cmd/gateway). */
export const GATEWAY_HTTP_URL = `http://${GATEWAY_HOST}:8081`;

/** Where a non-starter map's JSON is fetched from, keyed by its position in the world map grid — see fso_web_server's GET /maps/{x}/{y} (internal/mapstore). */
export function mapDataUrl(x: number, y: number): string {
  return `${GATEWAY_HTTP_URL}/maps/${x}/${y}`;
}

/** The gateway's POST /maps endpoint, persisting a map to Postgres (internal/mapstore). */
export const SAVE_MAP_ENDPOINT = `${GATEWAY_HTTP_URL}/maps`;

/** The gateway's POST /accounts endpoint — RegisterScene's account creation, persisted to Postgres (internal/accountstore). */
export const CREATE_ACCOUNT_ENDPOINT = `${GATEWAY_HTTP_URL}/accounts`;

/** The gateway's POST /accounts/login endpoint — LoginScene's credential check (internal/accountstore). */
export const LOGIN_ENDPOINT = `${GATEWAY_HTTP_URL}/accounts/login`;

/** Dev-only: the fso_web_server gateway's WebSocket endpoint (see fso_web_server/cmd/gateway). */
export const GATEWAY_WS_URL = `ws://${GATEWAY_HOST}:8081/ws`;

/** A walk-cycle row within the player spritesheet, by facing — see PLAYER_SPRITE's doc comment for the row layout. */
export type PlayerWalkRow = "down" | "side" | "up";

/** Every skin needs its own copy of each walk animation — Phaser bakes the texture key into an animation's frame data, so `player`'s and `player1`'s "walk down" can't share one key. See Player.createAnimations. */
export function playerWalkAnimKey(skin: PlayerSkinId, row: PlayerWalkRow): string {
  return `${skin}-walk-${row}`;
}

export const MAP_CACHE_KEY = "starter-map";

/** Local-storage-free, in-memory session key namespace (reserved for future use). */
export const DEBUG_TOGGLE_KEY = "F1";
