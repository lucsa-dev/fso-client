/**
 * Grid-space coordinate (tile units, not pixels).
 */
export interface GridPosition {
  x: number;
  y: number;
}

/**
 * World-space coordinate (pixel units).
 */
export interface WorldPosition {
  x: number;
  y: number;
}

/**
 * Identifies one map within the world's map grid (not a tile position).
 * The starting map is always (0, 0); neighbors are offset by 1 per side.
 */
export interface MapCoord {
  x: number;
  y: number;
}

/**
 * A single renderable layer of the map. `data` is a flat, row-major array
 * of tile indices with length `width * height`. A value of -1 means "no
 * tile" (used to leave gaps). A layer's depth is purely its position within
 * `MapData.layers` — later entries always draw on top of earlier ones (see
 * the map editor's numbered layer slots).
 */
export interface MapLayerData {
  name: string;
  data: number[];
}

/** "agressividade" options for a mob type — see MobTypeDef. */
export type MobAggressiveness = "pacifico" | "neutro" | "agressivo";

/**
 * One mob "type" created via the map editor's Mobs tab — a reusable
 * template (name/skin/stats/behavior), not a placed instance (see
 * MobSpawnDef). Mirrors MobTypeDef in fso_web_server's internal/mapdata.
 */
export interface MobTypeDef {
  id: string;
  name: string;
  /** See MOB_SKINS in Constants.ts (e.g. "rato"/"kuka"). */
  skin: string;
  /** 1-100 slider value — HP a hit from this mob removes from a player. */
  strength: number;
  aggressiveness: MobAggressiveness;
  maxHp: number;
  /** Becomes a Chebyshev-distance radius around a placed spawn's tile once dropped on the map (see fso_web_server's zoneserver.MobState) — this is the mob's "região protegida". */
  defendedTiles: number;
  /** Sprite scale in tiles/blocks (0.25 = 1/4 block, 5 = five blocks) — see MOB_SIZE_MIN/MAX in Constants.ts. Also drives melee attack reach (see ATTACK_RANGE_TILES's doc and fso_web_server's mobAttackRangeTiles), so a giant mob reaches farther and can be hit from farther away, per the mob system spec. */
  size: number;
  /** XP a player's Player.gainXp receives for killing an instance of this type (see GameScene.handleMobDied). */
  xp: number;
  /** Seconds after being killed before one instance of this type reappears (see fso_web_server's zoneserver.scheduleRespawn). */
  respawnSeconds: number;
  /** How many live instances of this type each placed spawn keeps up within its região protegida (defendedTiles) — see fso_web_server's zoneserver.buildMobs. */
  spawnCount: number;
}

/**
 * Places one instance of a MobTypeDef at a tile on this map — created by
 * dragging a mob type from the editor's list onto the canvas. Mirrors
 * MobSpawnDef in fso_web_server's internal/mapdata.
 */
export interface MobSpawnDef {
  id: string;
  mobTypeId: string;
  tile: GridPosition;
}

/**
 * The full map definition as loaded from JSON. Everything about map
 * dimensions and content is data-driven — nothing is hardcoded.
 */
export interface MapData {
  width: number;
  height: number;
  tileSize: number;
  spawnPoint: GridPosition;
  layers: MapLayerData[];
  /** Flat, row-major array of length width * height. true = blocked. */
  collisions: boolean[];
  mobTypes: MobTypeDef[];
  mobSpawns: MobSpawnDef[];
}
