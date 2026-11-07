import Phaser from "phaser";
import type { MapData, MapCoord, GridPosition, MobTypeDef } from "@/types/MapTypes";
import type { GameSceneData } from "@/types/GameTypes";
import { Direction } from "@/types/GameTypes";
import { ATTACK_COOLDOWN_MS, BOTTOM_BAR_HEIGHT_PX, DEBUG_TOGGLE_KEY, DEFAULT_MOB_SKIN, DEFAULT_PLAYER_SKIN, DEPTH, GATEWAY_WS_URL, isMobSkinId, isPlayerSkinId, MAP_CACHE_KEY, MAP_TRANSITION_DURATION_MS, MAP_TRANSITION_FADE_ALPHA, maxHpForLevel, maxXpForLevel, MOB_DRAG_DATA_TYPE, resolveMobSize, SAVE_MAP_ENDPOINT, SCENE_KEYS, mapDataUrl, type PlayerSkinId } from "@/utils/Constants";
import { PlayerSession } from "@/utils/PlayerSession";
import { MapEditorSession } from "@/utils/MapEditorSession";
import { MapManager } from "@/managers/MapManager";
import { PathfindingManager } from "@/managers/PathfindingManager";
import { CameraManager } from "@/managers/CameraManager";
import { InputManager } from "@/managers/InputManager";
import { Player } from "@/entities/Player";
import { Mob } from "@/entities/Mob";
import { DebugOverlay } from "@/ui/DebugOverlay";
import { LockedBlocksOverlay } from "@/ui/LockedBlocksOverlay";
import { SettingsMenu } from "@/ui/SettingsMenu";
import { MapEditorPanel, MAP_EDITOR_PANEL_WIDTH_PX, getAlternatingTileIndices, type BlockConfig } from "@/ui/MapEditorPanel";
import { SavingIndicator } from "@/ui/SavingIndicator";
import { TileHighlight } from "@/ui/TileHighlight";
import { DestinationMarker } from "@/ui/DestinationMarker";
import { BottomBar } from "@/ui/BottomBar";
import { GridUtils } from "@/utils/GridUtils";
import { MapFactory } from "@/utils/MapFactory";
import { network } from "@/network/Network";
import { NetworkEventType } from "@/types/NetworkTypes";
import type {
  ChatMessagePayload,
  ErrorPayload,
  JoinAcceptedPayload,
  MobDamagedPayload,
  MobDiedPayload,
  MobMovedPayload,
  MobSpawnedPayload,
  PlayerDamagedPayload,
  PlayerHealedPayload,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  PlayerMovedPayload,
  PlayerRespawnedPayload,
} from "@/types/NetworkTypes";

/**
 * Composition root for a single play session. Owns no gameplay logic
 * itself — it wires managers/entities together and mediates the one
 * cross-cutting flow the spec calls out explicitly:
 *
 *   click -> InputManager -> GameScene -> PathfindingManager -> Player
 *   arrow key (held) -> InputManager -> GameScene -> Player (single tile step)
 */
const DIRECTION_DELTAS: Record<Direction, GridPosition> = {
  [Direction.North]: { x: 0, y: -1 },
  [Direction.South]: { x: 0, y: 1 },
  [Direction.East]: { x: 1, y: 0 },
  [Direction.West]: { x: -1, y: 0 },
};

export class GameScene extends Phaser.Scene {
  private mapManager!: MapManager;
  private pathfindingManager!: PathfindingManager;
  private cameraManager!: CameraManager;
  private inputManager!: InputManager;
  private player!: Player;
  private debugOverlay!: DebugOverlay;
  private lockedBlocksOverlay!: LockedBlocksOverlay;
  private settingsMenu!: SettingsMenu;
  private bottomBar!: BottomBar;
  /** Mirrors BottomBar's collapsed state so setGameAreaInsetForBars knows whether to reserve space for it. */
  private bottomBarCollapsed = true;
  private tileHighlight!: TileHighlight;
  private destinationMarker!: DestinationMarker;
  private savingIndicator!: SavingIndicator;
  private mapEditorPanel: MapEditorPanel | null = null;
  /** Per-texture layer/tool/Block/density memory, kept here (not on the panel) so it survives the panel being destroyed and recreated on every toggle/Save. */
  private readonly mapEditorBlockConfigs: Map<number, BlockConfig> = MapEditorSession.load();
  private characterName = "";
  private characterSkin: PlayerSkinId = DEFAULT_PLAYER_SKIN;
  /** True while the player is walking a path started by a tile click; arrow keys always preempt it (see `update`). */
  private isFollowingClickPath = false;
  /**
   * Latest click/drag target waiting to be routed to. Applied the moment
   * the player is next idle between tiles (see `applyPendingDestination`)
   * rather than instantly, so a fast mouse drag never cuts a step short —
   * every step always starts from a grid-aligned tile, same as keyboard
   * movement, which keeps it from ever reading as diagonal.
   */
  private pendingClickDestination: GridPosition | null = null;
  /**
   * Set alongside `pendingClickDestination` when the raw click landed
   * outside the current map's bounds — the signal that this click means
   * "cross into the neighbor map that way", not just "walk to the edge".
   * Moved into `activeCrossDirection` once the path for it actually starts
   * (see `applyPendingDestination`), and consumed by `onPathComplete` once
   * the player reaches the map edge in that direction.
   */
  private pendingClickCrossDirection: Direction | null = null;
  private activeCrossDirection: Direction | null = null;
  /** Server-assigned spawn id of the mob a mouse click is currently following/attacking, if any — cleared by any arrow key, Space, or a click that isn't on a mob (see `update`, `handleTileClick`). */
  private attackTargetMobId: string | null = null;
  /** Whether the player was already in melee range of `attackTargetMobId` as of last frame — mirrors `wasAttackHeldLastFrame`'s "just engaged" role so the first auto-attack on reaching range lands instantly instead of waiting a full cooldown (see `updateAttackMode`). */
  private wasChasingInRangeLastFrame = false;
  /** Server-assigned spawn id of the mob currently under the pointer, if any — drives its yellow hover glow (see `setHoveredMob`). */
  private hoveredMobId: string | null = null;

  /** Position of the currently-loaded map within the world's map grid (not a tile position). */
  private currentMapCoord: MapCoord = { x: 0, y: 0 };
  private readonly mapDataCache = new Map<string, MapData>();
  private isTransitioningMap = false;

  /** Other players present on the current map, keyed by the server-assigned player id. Driven entirely by network events — never by local pathfinding (see Player's class doc). */
  private readonly remotePlayers = new Map<string, Player>();
  /** Mobs present on the current map, keyed by their server-assigned spawn id. Purely a playback of server state — see Mob's class doc. */
  private readonly mobs = new Map<string, Mob>();
  /** Mirrors `mobs`' keys to the MobTypeDef id each spawn was created from — looked up on MobDied to resolve the killed mob's XP reward (see `handleMobDied`), since the payload only carries the spawn id. */
  private readonly mobTypeIdBySpawnId = new Map<string, string>();
  /**
   * Every live mob id currently seeded from a given MobSpawnDef, keyed by
   * that spawn's id — a mobId is never equal to its spawnId (the server
   * mints `${spawnId}#${instanceSeq}`; see fso_web_server's
   * `nextMobInstanceID`), and MobTypeDef.spawnCount can seed several
   * instances from one spawn, so this is the only way to find "every live
   * mob this placed spawn owns" (used by `freezeMobsForEditor` and
   * `destroyMobVisual`). Mirrored by `spawnIdByMobId` for O(1) cleanup.
   */
  private readonly mobIdsBySpawnId = new Map<string, Set<string>>();
  /** Reverse of `mobIdsBySpawnId` — the spawnId a given live mobId was seeded from, so `handleMobDied` can remove it from that spawn's set without a scan. */
  private readonly spawnIdByMobId = new Map<string, string>();
  /** Local-only preview sprites for mob spawns just dropped in the map editor, not yet real server-driven mobs, keyed by the same spawn id as their MobSpawnDef (see `spawnMobEditorPreview`). */
  private readonly mobEditorPreviews = new Map<string, Mob>();
  /** True while the map editor panel is open — pins every live mob to its MobSpawnDef tile and ignores further MobMoved broadcasts, so the Mobs tab's eraser can find and remove them (see `freezeMobsForEditor`). */
  private mobMovementFrozenForEditor = false;
  /** Server-assigned id for this session's own player, learned from JoinAccepted — used to ignore echoes of our own join/move broadcasts. */
  private localPlayerId: string | null = null;
  /** `this.time.now` timestamp of the last AttackRequest sent — throttles space-held attack requests to ATTACK_COOLDOWN_MS client-side (the server enforces the real cooldown independently; see PlayerState.LastAttackAt). */
  private lastAttackSentAt = -Infinity;
  /** Whether the attack key was held as of last frame — see `sendAttackRequestIfDue`'s "just pressed" check. */
  private wasAttackHeldLastFrame = false;

  /**
   * Network event handlers, bound once per GameScene instance (stable
   * identity so wireNetwork/unwireNetwork's on/off pairs actually match —
   * the `network` singleton outlives any one scene, so unregistering on
   * shutdown is what keeps a later relogin from double-handling events).
   */
  private readonly handleNetworkConnected = (): void => {
    this.sendJoinRequest();
  };

  private readonly handleJoinAccepted = (payload: JoinAcceptedPayload): void => {
    this.localPlayerId = payload.playerId;
    payload.players.forEach((p) => this.spawnRemotePlayer(p));
    payload.mobs.forEach((m) => this.spawnMob(m));
  };

  private readonly handlePlayerJoined = (payload: PlayerJoinedPayload): void => {
    this.spawnRemotePlayer(payload);
  };

  private readonly handlePlayerMoved = (payload: PlayerMovedPayload): void => {
    if (payload.playerId === this.localPlayerId) {
      return;
    }
    this.remotePlayers.get(payload.playerId)?.applyRemoteMove({ x: payload.x, y: payload.y });
  };

  private readonly handlePlayerLeft = (payload: PlayerLeftPayload): void => {
    const remote = this.remotePlayers.get(payload.playerId);
    if (!remote) {
      return;
    }
    remote.destroy();
    this.remotePlayers.delete(payload.playerId);
  };

  /** A mob was added to the current map after the fact (map re-saved while its zone was already running) — reuses spawnMob's own no-op-if-already-present guard, same as a roster entry from JoinAccepted. */
  private readonly handleMobSpawned = (payload: MobSpawnedPayload): void => {
    this.spawnMob(payload);
  };

  private readonly handleMobMoved = (payload: MobMovedPayload): void => {
    if (this.mobMovementFrozenForEditor) {
      return;
    }
    this.mobs.get(payload.mobId)?.applyRemoteMove({ x: payload.x, y: payload.y });
  };

  private readonly handleMobDamaged = (payload: MobDamagedPayload): void => {
    this.mobs.get(payload.mobId)?.setHp(payload.hp, payload.maxHp);
  };

  private readonly handleMobDied = (payload: MobDiedPayload): void => {
    const mob = this.mobs.get(payload.mobId);
    if (!mob) {
      return;
    }
    if (payload.killerId === this.localPlayerId) {
      this.grantMobKillXp(payload.mobId);
    }
    if (this.attackTargetMobId === payload.mobId) {
      this.clearAttackMode();
    }
    if (this.hoveredMobId === payload.mobId) {
      this.setHoveredMob(null);
    }
    mob.destroy();
    this.mobs.delete(payload.mobId);
    this.mobTypeIdBySpawnId.delete(payload.mobId);
    this.untrackMobSpawnMembership(payload.mobId);
  };

  /** Removes `mobId` from `mobIdsBySpawnId`/`spawnIdByMobId` — shared cleanup between a natural death (`handleMobDied`) and the map editor's eraser (`destroyMobVisual`), which also tears down a mob without waiting for a MobDied broadcast. */
  private untrackMobSpawnMembership(mobId: string): void {
    const spawnId = this.spawnIdByMobId.get(mobId);
    this.spawnIdByMobId.delete(mobId);
    if (spawnId) {
      this.mobIdsBySpawnId.get(spawnId)?.delete(mobId);
    }
  }

  /** Awards this player's own MobTypeDef.xp reward for the mob it just killed — resolved from the local map catalog rather than the server, which tracks no XP/level state of its own (see JoinRequestPayload.level's doc comment). */
  private grantMobKillXp(mobId: string): void {
    const typeId = this.mobTypeIdBySpawnId.get(mobId);
    const mobType = typeId ? this.mapManager.getMobTypes().find((t) => t.id === typeId) : undefined;
    if (mobType) {
      this.player.gainXp(mobType.xp);
    }
  }

  /** A mob's attack landed on a player — updates HP for the local player only; remote players don't render an HP bar (only mobs do, per the spec), so there's nothing visual to update for them yet. */
  private readonly handlePlayerDamaged = (payload: PlayerDamagedPayload): void => {
    if (payload.playerId !== this.localPlayerId) {
      return;
    }
    this.player.applyServerHp(payload.hp, payload.maxHp);
  };

  /**
   * A player's HP reached 0 from mob damage — the server has already
   * teleported them to the map's spawn point and refilled HP; this applies
   * that and clears XP progress, the same way `handlePlayerDeath` applies a
   * client-noticed death, but driven by the server instead of
   * `Player.takeDamage` hitting 0 locally.
   */
  private readonly handlePlayerRespawned = (payload: PlayerRespawnedPayload): void => {
    if (payload.playerId !== this.localPlayerId) {
      this.remotePlayers.get(payload.playerId)?.teleportTo(payload.tile);
      return;
    }

    this.isFollowingClickPath = false;
    this.pendingClickDestination = null;
    this.pendingClickCrossDirection = null;
    this.activeCrossDirection = null;
    this.destinationMarker.hide();

    this.player.teleportTo(payload.tile);
    this.player.applyServerHp(payload.hp, payload.maxHp);
    this.player.resetXp();
    this.savePosition(payload.tile);
  };

  /** The server's passive regen ticker healed this player 1 HP (see fso_web_server's MapCell.tickRegen) — applied the same way mob damage is, just healing instead of hurting. */
  private readonly handlePlayerHealed = (payload: PlayerHealedPayload): void => {
    if (payload.playerId !== this.localPlayerId) {
      return;
    }
    this.player.applyServerHp(payload.hp, payload.maxHp);
  };

  private readonly handleNetworkChatMessage = (payload: ChatMessagePayload): void => {
    this.bottomBar.appendMessage(this.resolvePlayerName(payload.playerId), payload.message);
  };

  private readonly handleNetworkError = (payload: ErrorPayload): void => {
    console.warn("GameScene: server reported an error:", payload.message);
    // The gateway enforces one active session per account (see
    // fso_web_server's Hub.claimCharacter) — a login elsewhere disconnects
    // us right after this, so send the player back to the login screen
    // instead of leaving them stuck on a dead connection.
    if (payload.code === "session_replaced") {
      PlayerSession.clear();
      this.scene.start(SCENE_KEYS.LOGIN, { message: payload.message });
    }
  };

  public constructor() {
    super(SCENE_KEYS.GAME);
  }

  public init(data: GameSceneData): void {
    this.characterName = data.characterName ?? PlayerSession.getCharacterName();
    this.characterSkin = data.skin ?? PlayerSession.getCharacterSkin();
    // Matches PlayerSession's last saved position whenever there is one — see BootScene's
    // resolveStartingMap, which already loaded this coordinate's data into MAP_CACHE_KEY.
    this.currentMapCoord = data.startMapCoord ?? { x: 0, y: 0 };
  }

  public create(): void {
    const mapData = this.cache.json.get(MAP_CACHE_KEY) as MapData;
    this.mapDataCache.set(this.mapCoordKey(this.currentMapCoord), mapData);

    this.mapManager = new MapManager(this, mapData);
    this.syncAlternatingTiles();
    this.pathfindingManager = new PathfindingManager();
    this.cameraManager = new CameraManager(this);
    this.inputManager = new InputManager(this, this.mapManager.tileSize);

    const savedPosition = PlayerSession.getLastPosition();
    const resumesOnStartingMap = savedPosition !== null && this.mapCoordKey(savedPosition.mapCoord) === this.mapCoordKey(this.currentMapCoord);
    const initialSpawnTile = resumesOnStartingMap
      ? (this.mapManager.isWalkable(savedPosition.tile) ? savedPosition.tile : (this.mapManager.findNearestWalkable(savedPosition.tile) ?? this.mapManager.spawnPoint))
      : this.mapManager.spawnPoint;

    const initialLevel = PlayerSession.getLevel();
    this.player = new Player(
      this,
      initialSpawnTile,
      this.mapManager.tileSize,
      this.characterName,
      this.characterSkin,
      {
        hp: PlayerSession.getHp(),
        maxHp: maxHpForLevel(initialLevel),
        xp: PlayerSession.getXp(),
        maxXp: maxXpForLevel(initialLevel),
        level: initialLevel,
      },
      true,
    );
    this.player.setOnStepComplete((tile) => {
      this.savePosition(tile);
      network.send(NetworkEventType.MoveRequest, { tile });
      this.applyPendingDestination();
    });
    this.player.setOnPathComplete(() => {
      this.isFollowingClickPath = false;
      this.destinationMarker.hide();

      const crossDirection = this.activeCrossDirection;
      this.activeCrossDirection = null;
      if (crossDirection && this.isAtMapEdge(crossDirection)) {
        void this.crossMapBorder(crossDirection);
      }
    });
    this.player.setOnHpChanged((hp, maxHp) => {
      PlayerSession.setHp(hp);
      this.bottomBar.updateHp(hp, maxHp);
    });
    this.player.setOnXpChanged((xp, maxXp) => {
      PlayerSession.setXp(xp);
      PlayerSession.setLevel(this.player.getLevel());
      this.bottomBar.updateXp(xp, maxXp);
    });
    this.player.setOnDeath(() => this.handlePlayerDeath());
    this.savePosition(initialSpawnTile);

    this.debugOverlay = new DebugOverlay(this, this.mapManager.width, this.mapManager.height, this.mapManager.getWalkableGrid());
    this.lockedBlocksOverlay = new LockedBlocksOverlay(this, this.mapManager.width, this.mapManager.height, this.mapManager.getWalkableGrid());

    this.cameraManager.setWorldBounds(this.mapManager.worldWidthPx, this.mapManager.worldHeightPx);
    this.cameraManager.follow(this.player.sprite);

    this.inputManager.setOnTileClick((tile) => this.handleTileClick(tile));
    this.inputManager.setOnTilePaint((tile, isDrag) => this.handleTilePaint(tile, isDrag));

    this.input.keyboard?.on(`keydown-${DEBUG_TOGGLE_KEY}`, () => this.debugOverlay.toggle());

    // Ctrl/Cmd+Z undoes the map editor's last edit; only active while the editor panel is open so it never fights browser/OS undo elsewhere.
    this.input.keyboard?.on("keydown-Z", (event: KeyboardEvent) => {
      if (!this.mapEditorPanel || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      this.handleMapEditorUndo();
    });

    this.tileHighlight = new TileHighlight(this);
    this.destinationMarker = new DestinationMarker(this);
    this.inputManager.setOnTileHover((tile) => this.handleTileHover(tile));
    this.inputManager.setOnPointerLeave(() => {
      this.tileHighlight.hide();
      this.setHoveredMob(null);
    });

    this.settingsMenu = new SettingsMenu(
      () => this.handleLogout(),
      () => this.toggleMapEditor(),
      () => this.cameraManager.zoomIn(),
      () => this.cameraManager.zoomOut(),
    );
    this.bottomBar = new BottomBar(
      (message) => this.handleChatSubmit(message),
      (collapsed) => {
        this.bottomBarCollapsed = collapsed;
        this.setGameAreaInsetForBars(true);
        this.mapEditorPanel?.setBottomInset(collapsed ? 0 : BOTTOM_BAR_HEIGHT_PX);
      },
    );
    this.bottomBar.updateHp(this.player.getHp(), this.player.getMaxHp());
    this.bottomBar.updateXp(this.player.getXp(), this.player.getMaxXp());
    this.savingIndicator = new SavingIndicator();
    this.setGameAreaInsetForBars(true);

    this.wireNetwork();
    network.connect(GATEWAY_WS_URL);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unwireNetwork();
      this.clearRemotePlayers();
      this.clearMobs();
      this.clearMobEditorPreviews();
      this.settingsMenu.destroy();
      this.bottomBar.destroy();
      this.mapEditorPanel?.destroy();
      this.tileHighlight.destroy();
      this.destinationMarker.destroy();
      this.savingIndicator.destroy();
      this.setGameAreaOpenForEditor(false);
      this.setGameAreaInsetForBars(false);
    });
  }

  /** Remembers where the player is so a reload resumes from here (see PlayerSession). */
  private savePosition(tile: GridPosition): void {
    PlayerSession.setLastPosition(this.currentMapCoord, tile);
  }

  /**
   * Fired once by Player.setOnDeath when HP hits 0 (see `takeDamage`) —
   * sends the player back to the current map's spawn point, refills HP, and
   * clears XP progress toward the current level.
   * Cancels any in-progress click-path/cross-map state the same way
   * onPathComplete would, since death can land mid-stride once mob damage
   * is wired in. Unlike a map-to-map crossing (`playMapTransition`), this
   * never changes `currentMapCoord` or re-sends a join request — it's just
   * a teleport within the same map, so a plain MoveRequest is enough to
   * keep other clients in sync.
   */
  private handlePlayerDeath(): void {
    const spawnTile = this.mapManager.spawnPoint;
    this.isFollowingClickPath = false;
    this.pendingClickDestination = null;
    this.pendingClickCrossDirection = null;
    this.activeCrossDirection = null;
    this.destinationMarker.hide();

    this.player.teleportTo(spawnTile);
    this.player.respawn();
    this.player.resetXp();
    this.savePosition(spawnTile);
    network.send(NetworkEventType.MoveRequest, { tile: spawnTile });
  }

  /** Forwards a submitted chat message to the gateway; the server re-broadcasts it (scoped to the current map) as a ChatMessage event, including back to us. */
  private handleChatSubmit(message: string): void {
    network.send(NetworkEventType.ChatMessage, { playerId: this.characterName, message });
  }

  /** ChatMessage broadcasts only carry the server-assigned playerId, not a display name — resolve it against ourselves and the current roster. */
  private resolvePlayerName(playerId: string): string {
    if (playerId === this.localPlayerId) {
      return this.characterName;
    }
    return this.remotePlayers.get(playerId)?.sprite.name ?? playerId;
  }

  /** Registers this scene's network event handlers. Paired with unwireNetwork, called on shutdown — the `network` singleton outlives the scene, so handlers must be explicitly unregistered or a later relogin would double-handle every event. */
  private wireNetwork(): void {
    network.on(NetworkEventType.Connected, this.handleNetworkConnected);
    network.on(NetworkEventType.JoinAccepted, this.handleJoinAccepted);
    network.on(NetworkEventType.PlayerJoined, this.handlePlayerJoined);
    network.on(NetworkEventType.PlayerMoved, this.handlePlayerMoved);
    network.on(NetworkEventType.PlayerLeft, this.handlePlayerLeft);
    network.on(NetworkEventType.MobSpawned, this.handleMobSpawned);
    network.on(NetworkEventType.MobMoved, this.handleMobMoved);
    network.on(NetworkEventType.MobDamaged, this.handleMobDamaged);
    network.on(NetworkEventType.MobDied, this.handleMobDied);
    network.on(NetworkEventType.PlayerDamaged, this.handlePlayerDamaged);
    network.on(NetworkEventType.PlayerRespawned, this.handlePlayerRespawned);
    network.on(NetworkEventType.PlayerHealed, this.handlePlayerHealed);
    network.on(NetworkEventType.ChatMessage, this.handleNetworkChatMessage);
    network.on(NetworkEventType.Error, this.handleNetworkError);
  }

  private unwireNetwork(): void {
    network.off(NetworkEventType.Connected, this.handleNetworkConnected);
    network.off(NetworkEventType.JoinAccepted, this.handleJoinAccepted);
    network.off(NetworkEventType.PlayerJoined, this.handlePlayerJoined);
    network.off(NetworkEventType.PlayerMoved, this.handlePlayerMoved);
    network.off(NetworkEventType.PlayerLeft, this.handlePlayerLeft);
    network.off(NetworkEventType.MobSpawned, this.handleMobSpawned);
    network.off(NetworkEventType.MobMoved, this.handleMobMoved);
    network.off(NetworkEventType.MobDamaged, this.handleMobDamaged);
    network.off(NetworkEventType.MobDied, this.handleMobDied);
    network.off(NetworkEventType.PlayerDamaged, this.handlePlayerDamaged);
    network.off(NetworkEventType.PlayerRespawned, this.handlePlayerRespawned);
    network.off(NetworkEventType.PlayerHealed, this.handlePlayerHealed);
    network.off(NetworkEventType.ChatMessage, this.handleNetworkChatMessage);
    network.off(NetworkEventType.Error, this.handleNetworkError);
    network.disconnect();
  }

  /** Tells the gateway which map/tile this session's player occupies — sent once the socket connects, and again on every MapCoord crossing (see crossMapBorder). */
  private sendJoinRequest(): void {
    network.send(NetworkEventType.JoinRequest, {
      characterName: this.characterName,
      skin: this.characterSkin,
      mapCoord: this.currentMapCoord,
      tile: this.player.getCurrentTile(),
      level: this.player.getLevel(),
      hp: this.player.getHp(),
    });
  }

  /** Spawns a network-driven Player for a roster entry or PlayerJoined broadcast — a no-op for our own id (self-echo) or one we already have. */
  private spawnRemotePlayer(payload: PlayerJoinedPayload): void {
    if (payload.playerId === this.localPlayerId || this.remotePlayers.has(payload.playerId)) {
      return;
    }
    const skin = isPlayerSkinId(payload.skin) ? payload.skin : DEFAULT_PLAYER_SKIN;
    const remote = new Player(this, { x: payload.x, y: payload.y }, this.mapManager.tileSize, payload.name, skin);
    // Unlike the local player (see Player.advance()'s comment), remote steps
    // arrive as discrete, asynchronous network messages rather than
    // synchronous re-issues from the input loop, so it's safe to settle
    // idle the moment a remote player's queue drains — otherwise nothing
    // ever resets their walk animation once they stop.
    remote.setOnPathComplete(() => remote.settleIdle());
    this.remotePlayers.set(payload.playerId, remote);
  }

  /** Tears down every remote player — called before requesting a join on a new map, since a fresh roster is about to replace them. */
  private clearRemotePlayers(): void {
    this.remotePlayers.forEach((remote) => remote.destroy());
    this.remotePlayers.clear();
  }

  /** Spawns a server-driven Mob for a JoinAccepted roster entry — a no-op if we already have this mob id (shouldn't happen; mobs never re-announce themselves after the initial roster). */
  private spawnMob(payload: MobSpawnedPayload): void {
    if (this.mobs.has(payload.mobId)) {
      return;
    }
    const skin = isMobSkinId(payload.skin) ? payload.skin : DEFAULT_MOB_SKIN;
    const mobType = this.mapManager.getMobTypes().find((t) => t.id === payload.typeId);
    const mob = new Mob(this, { x: payload.x, y: payload.y }, this.mapManager.tileSize, payload.name, skin, resolveMobSize(mobType?.size), {
      hp: payload.hp,
      maxHp: payload.maxHp,
    });
    this.mobs.set(payload.mobId, mob);
    this.mobTypeIdBySpawnId.set(payload.mobId, payload.typeId);
    this.spawnIdByMobId.set(payload.mobId, payload.spawnId);
    const siblings = this.mobIdsBySpawnId.get(payload.spawnId);
    if (siblings) {
      siblings.add(payload.mobId);
    } else {
      this.mobIdsBySpawnId.set(payload.spawnId, new Set([payload.mobId]));
    }

    // A mob catalog reload (see fso_web_server's ZoneCmdReloadMobs) can
    // spawn fresh instances while the editor is already open — without
    // this they'd render moving/duplicated until the next open/close
    // cycle, defeating freezeMobsForEditor's whole point.
    if (this.mobMovementFrozenForEditor) {
      const spawn = this.mapManager.getMobSpawns().find((s) => s.id === payload.spawnId);
      if (spawn) {
        this.freezeSpawnForEditor(payload.spawnId, spawn.tile);
      }
    }
  }

  /** Tears down every mob — called before requesting a join on a new map, since a fresh roster is about to replace them (mobs are map-resident; see spawnMob). */
  private clearMobs(): void {
    this.mobs.forEach((mob) => mob.destroy());
    this.mobs.clear();
    this.mobTypeIdBySpawnId.clear();
    this.mobIdsBySpawnId.clear();
    this.spawnIdByMobId.clear();
    this.clearAttackMode();
    this.hoveredMobId = null;
  }

  /** Forgets the remembered character and drops the player back on the login screen. */
  private handleLogout(): void {
    PlayerSession.clear();
    this.scene.start(SCENE_KEYS.LOGIN);
  }

  /**
   * Opens or closes the map editor side panel. While it's open, click-to-move
   * is suppressed so clicks in the palette/popup don't route the player —
   * arrow-key movement is unaffected.
   */
  private toggleMapEditor(): void {
    if (this.mapEditorPanel) {
      this.closeMapEditor();
    } else {
      this.mapEditorPanel = new MapEditorPanel(
        () => this.handleSaveMap(),
        this.mapEditorBlockConfigs,
        () => {
          MapEditorSession.save(this.mapEditorBlockConfigs);
          this.syncAlternatingTiles();
        },
        this.bottomBarCollapsed ? 0 : BOTTOM_BAR_HEIGHT_PX,
        () => this.closeMapEditor(),
        this.mapManager.getMapData().mobTypes,
        this.mapManager.getMapData().mobSpawns,
        (removedSpawnIds) => this.handleMobSpawnsRemoved(removedSpawnIds),
      );
      this.inputManager.setClickEnabled(false);
      this.lockedBlocksOverlay.setVisible(true);
      this.setGameAreaOpenForEditor(true);
      this.setMobDropZoneEnabled(true);
      this.freezeMobsForEditor();
    }
  }

  /**
   * Pins one live instance of every placed MobSpawnDef to its tile and stops
   * applying further MobMoved broadcasts — called when the map editor opens.
   * Without this, a mob's AI keeps wandering it away from the tile the Mobs
   * tab's eraser checks (`MapManager.findMobSpawnAtTile` only ever matches
   * the spawn's fixed tile), so it can be seen but never clicked to remove.
   *
   * A spawn whose MobTypeDef.spawnCount is above 1 has several live
   * instances (see `mobIdsBySpawnId`'s doc) scattered around the spawn tile
   * by the server's own AI — the editor only ever shows one, hiding the
   * rest, so what's on screen always matches "one placed mob = one visible,
   * clickable sprite" regardless of how many actually live server-side.
   */
  private freezeMobsForEditor(): void {
    this.mobMovementFrozenForEditor = true;
    for (const spawn of this.mapManager.getMobSpawns()) {
      this.freezeSpawnForEditor(spawn.id, spawn.tile);
    }
  }

  /** Pins one live instance of `spawnId` to `tile` and hides every other live instance it owns — the per-spawn work `freezeMobsForEditor` does for every placed spawn at once, also reused by `spawnMob` for instances that appear after the editor is already open. */
  private freezeSpawnForEditor(spawnId: string, tile: GridPosition): void {
    const instanceIds = this.mobIdsBySpawnId.get(spawnId);
    if (!instanceIds || instanceIds.size === 0) {
      return;
    }
    const [primaryId, ...extraIds] = [...instanceIds];
    if (!primaryId) {
      return;
    }
    this.mobs.get(primaryId)?.freezeAtTile(tile);
    for (const extraId of extraIds) {
      this.mobs.get(extraId)?.setVisible(false);
    }
  }

  /** Undoes `freezeMobsForEditor` — resumes applying MobMoved broadcasts and re-shows every mob hidden as a spawn-count duplicate. Called when the map editor closes. */
  private unfreezeMobsForEditor(): void {
    this.mobMovementFrozenForEditor = false;
    this.mobs.forEach((mob) => mob.setVisible(true));
  }

  /** Refreshes the live map's blinking tiles (see MapManager's blink timer) from whichever textures are currently marked Alternar — called after every block-config change and whenever a fresh MapManager is built, so the effect stays in sync with the editor's checkboxes even while the panel is closed. */
  private syncAlternatingTiles(): void {
    this.mapManager.setAlternatingTileIndices(getAlternatingTileIndices(this.mapEditorBlockConfigs));
  }

  /** Closes the map editor panel, if open — used both by its toggle button and by Save (see `handleSaveMap`). */
  private closeMapEditor(): void {
    this.mapEditorPanel?.destroy();
    this.mapEditorPanel = null;
    this.inputManager.setClickEnabled(true);
    this.tileHighlight.hide();
    this.lockedBlocksOverlay.setVisible(false);
    this.setGameAreaOpenForEditor(false);
    this.setMobDropZoneEnabled(false);
    this.unfreezeMobsForEditor();
  }

  /**
   * Wires (or unwires) the game canvas's parent as an HTML5 drag-and-drop
   * target for the Mobs tab's list rows (see MapEditorPanel.createMobTypeRow)
   * — dropping one places a MobSpawnDef at the tile under the cursor. Only
   * active while the editor is open, mirroring `inputManager.setClickEnabled`.
   */
  private setMobDropZoneEnabled(enabled: boolean): void {
    const gameContainer = document.getElementById("app");
    if (!gameContainer) {
      return;
    }
    if (enabled) {
      gameContainer.addEventListener("dragover", this.handleCanvasDragOver);
      gameContainer.addEventListener("drop", this.handleCanvasDrop);
    } else {
      gameContainer.removeEventListener("dragover", this.handleCanvasDragOver);
      gameContainer.removeEventListener("drop", this.handleCanvasDrop);
    }
  }

  /** A dragover must call preventDefault for the element to become a valid drop target at all — see MDN's HTML5 DnD docs. */
  private readonly handleCanvasDragOver = (event: DragEvent): void => {
    event.preventDefault();
  };

  /**
   * Drops a mob type from the editor's list onto the tile under the cursor:
   * appends a MobSpawnDef to the live map data (persisted on the next Save,
   * same as painted tiles) and shows an immediate local-only preview sprite
   * — the mob doesn't actually exist server-side (and so isn't visible to
   * other players) until the map is saved and that map's MapCell is
   * (re)created from it.
   */
  private readonly handleCanvasDrop = (event: DragEvent): void => {
    event.preventDefault();
    const mobTypeId = event.dataTransfer?.getData(MOB_DRAG_DATA_TYPE);
    if (!mobTypeId) {
      return;
    }

    const mobType = this.mapManager.getMobTypes().find((type) => type.id === mobTypeId);
    if (!mobType) {
      return;
    }

    const tile = this.clientPointToTile(event.clientX, event.clientY);
    if (!tile || !GridUtils.isInBounds(tile, this.mapManager.width, this.mapManager.height)) {
      return;
    }

    const spawnId = crypto.randomUUID();
    this.mapManager.addMobSpawn({ id: spawnId, mobTypeId, tile });
    this.spawnMobEditorPreview(spawnId, mobType, tile);
  };

  /** Converts a DOM pointer event's viewport coordinates to a map tile, accounting for the canvas's own scaling and the camera's current scroll/zoom. Returns null if the point isn't over the game canvas at all. */
  private clientPointToTile(clientX: number, clientY: number): GridPosition | null {
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;
    const worldPoint = this.cameras.main.getWorldPoint(canvasX, canvasY);
    return GridUtils.worldToTile({ x: worldPoint.x, y: worldPoint.y }, this.mapManager.tileSize);
  }

  /** Local-only visual for a just-placed mob spawn — not server-driven (see `handleCanvasDrop`'s doc). Tracked separately from `mobs` (which is exclusively server-driven) so it can't be confused with a real spawned instance, keyed by the same id as its MobSpawnDef so the eraser (see `handleMobErase`) and mob-type deletion (see `handleMobSpawnsRemoved`) can find and destroy it again, and cleared whenever the map itself is torn down/reloaded (see `clearMobEditorPreviews`). */
  private spawnMobEditorPreview(spawnId: string, mobType: MobTypeDef, tile: GridPosition): void {
    const skin = isMobSkinId(mobType.skin) ? mobType.skin : DEFAULT_MOB_SKIN;
    const preview = new Mob(this, tile, this.mapManager.tileSize, mobType.name, skin, resolveMobSize(mobType.size), { hp: mobType.maxHp, maxHp: mobType.maxHp });
    this.mobEditorPreviews.set(spawnId, preview);
  }

  /** Tears down every map-editor placement preview — called whenever the current map is torn down/reloaded, same as `clearMobs`, since a preview only ever makes sense for the map it was dropped on. */
  private clearMobEditorPreviews(): void {
    this.mobEditorPreviews.forEach((preview) => preview.destroy());
    this.mobEditorPreviews.clear();
  }

  /**
   * Destroys every on-screen sprite `spawnId` currently has — an unsaved
   * editor preview, and/or every live server-driven mob instance it seeded
   * (see `mobIdsBySpawnId`'s doc for why that can be more than one: a mobId
   * is never equal to its spawnId, and MobTypeDef.spawnCount can seed
   * several instances from one placed spawn — all of them need tearing down,
   * not just a `this.mobs.get(spawnId)` lookup that could never hit). Shared
   * by the Mobs tab's eraser (`handleMobErase`, one spawn at a time) and by
   * deleting a mob type from the list (`handleMobSpawnsRemoved`, every spawn
   * of that type at once). Only removes the local visual — the actual
   * persisted removal (and the broadcast that removes it for other players
   * too) happens on Save, via the server's own reload_mobs diff, same as
   * every other unsaved editor change.
   */
  private destroyMobVisual(spawnId: string): void {
    this.mobEditorPreviews.get(spawnId)?.destroy();
    this.mobEditorPreviews.delete(spawnId);

    const instanceIds = this.mobIdsBySpawnId.get(spawnId);
    if (!instanceIds) {
      return;
    }
    for (const mobId of [...instanceIds]) {
      const liveMob = this.mobs.get(mobId);
      if (liveMob) {
        liveMob.destroy();
        this.mobs.delete(mobId);
        this.mobTypeIdBySpawnId.delete(mobId);
      }
      this.spawnIdByMobId.delete(mobId);
    }
    this.mobIdsBySpawnId.delete(spawnId);
  }

  /**
   * The Mobs tab's eraser: removes whichever mob spawn sits on `tile`, both
   * from the live map data (so the removal survives a Save, same as any
   * other unsaved edit) and from the screen (see `destroyMobVisual`). A
   * no-op if `tile` has no mob on it. See `handleTilePaint`'s Mobs-tab
   * branch for when this fires instead of the ordinary texture eraser.
   */
  private handleMobErase(tile: GridPosition): void {
    const spawn = this.mapManager.findMobSpawnAtTile(tile);
    if (!spawn) {
      return;
    }
    this.mapManager.removeMobSpawn(spawn.id);
    this.destroyMobVisual(spawn.id);
  }

  /** Every spawn id a mob-type deletion just removed from the live map data (see MapEditorPanel's `onMobSpawnsRemoved`) — tears down each one's on-screen sprite the same way the eraser does for a single spawn. */
  private handleMobSpawnsRemoved(removedSpawnIds: string[]): void {
    removedSpawnIds.forEach((spawnId) => this.destroyMobVisual(spawnId));
  }

  /**
   * Shrinks or restores the game canvas's parent, and insets the chat bar's
   * right edge to match, so the map editor panel docks beside them instead
   * of overlapping — otherwise the brush could never reach whatever the
   * panel was covering, and the chat bar would sit on top of its Save
   * button (both are fixed-position elements outside the canvas).
   *
   * In RESIZE scale mode, Phaser re-derives the canvas size from its own
   * `parentSize` cache rather than from any width passed to `scale.resize()`
   * (that call is for `NONE` mode) — normally that cache is refreshed by a
   * background poll (`resizeInterval`, 500ms) or a native window resize, so
   * without a nudge the canvas would visibly lag behind the panel by up to
   * half a second. `getParentBounds()` forces that cache to re-measure the
   * parent immediately, and `refresh()` re-derives the canvas size from it.
   */
  private setGameAreaOpenForEditor(open: boolean): void {
    const gameContainer = document.getElementById("app");
    if (gameContainer) {
      gameContainer.style.width = open ? `calc(100% - ${MAP_EDITOR_PANEL_WIDTH_PX}px)` : "100%";
    }
    this.bottomBar.setRightInset(open ? MAP_EDITOR_PANEL_WIDTH_PX : 0);
    this.scale.getParentBounds();
    this.scale.refresh();
  }

  /**
   * Insets the game canvas's parent from the bottom of the viewport by the
   * bottom bar's height, so the canvas — and the map it renders — sits
   * above it instead of underneath. The settings menu is just a floating
   * gear icon, not a full-width bar, so it doesn't need a matching top
   * inset. Uses `top`/`bottom` rather than padding: `#app` is a
   * fixed-position element, and Phaser's RESIZE mode sizes the canvas off
   * its `clientHeight`, which includes padding — padding would leave the
   * canvas the full unindented height and just shift it down, still
   * overlapping the bottom bar. Mounted once alongside the bars in
   * `create()` and cleared on shutdown; see `setGameAreaOpenForEditor` for
   * the analogous horizontal inset used by the map editor panel.
   */
  private setGameAreaInsetForBars(active: boolean): void {
    const gameContainer = document.getElementById("app");
    if (gameContainer) {
      gameContainer.style.bottom = active && !this.bottomBarCollapsed ? `${BOTTOM_BAR_HEIGHT_PX}px` : "0";
    }
    this.scale.getParentBounds();
    this.scale.refresh();
  }

  /**
   * Drives the map editor's hover feedback: while any selected texture
   * paints with the brush, outlines one tile per selected texture, each
   * shifted by that texture's `gridOffsetX`/`gridOffsetY` — the same
   * row/column layout the textures have in the palette itself — so the
   * user can see exactly where each one will land. Whole-map outline when
   * the selection is bucket/random only, since those act on the whole
   * thing regardless of texture.
   */
  private handleTileHover(tile: GridPosition): void {
    const panel = this.mapEditorPanel;
    const mode = panel?.getHoverHighlightMode() ?? "hidden";

    if (mode === "tiles" && GridUtils.isInBounds(tile, this.mapManager.width, this.mapManager.height)) {
      const tiles = panel!.getSelectedPaints().map((paint) => ({ x: tile.x + paint.gridOffsetX, y: tile.y + paint.gridOffsetY }));
      this.tileHighlight.showTiles(tiles, this.mapManager.tileSize);
      return;
    }

    if (mode === "all") {
      this.tileHighlight.showAll(this.mapManager.width, this.mapManager.height, this.mapManager.tileSize);
      return;
    }

    this.tileHighlight.hide();

    if (panel) {
      this.setHoveredMob(null);
      return;
    }
    this.setHoveredMob(this.findMobEntryAtWorldPoint(this.pointerWorldPoint()));
  }

  /** Pointer's current position translated into world space — used for pixel-accurate mob hit-testing (see `findMobEntryAtWorldPoint`) alongside the tile-quantized position `InputManager` already hands GameScene for movement/painting. */
  private pointerWorldPoint(): Phaser.Math.Vector2 {
    const pointer = this.input.activePointer;
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
  }

  /**
   * Linear scan over live mobs for whichever one's actual rendered bounds
   * contain `point` — small per-map mob counts make this cheap. Hit-tests
   * against the sprite's visual bounds rather than matching grid tiles
   * (see Mob.containsWorldPoint's doc comment for why tile-matching left
   * hover/click selection visibly offset from the art).
   */
  private findMobEntryAtWorldPoint(point: Phaser.Math.Vector2): [string, Mob] | null {
    for (const entry of this.mobs) {
      if (entry[1].containsWorldPoint(point.x, point.y)) {
        return entry;
      }
    }
    return null;
  }

  /** Moves the yellow hover glow (see Mob.setHighlighted) from whichever mob had it to `entry`'s mob, if any. No-op if the hovered mob hasn't changed. */
  private setHoveredMob(entry: [string, Mob] | null): void {
    const nextId = entry?.[0] ?? null;
    if (this.hoveredMobId === nextId) {
      return;
    }
    if (this.hoveredMobId) {
      this.mobs.get(this.hoveredMobId)?.setHighlighted(false);
    }
    this.hoveredMobId = nextId;
    entry?.[1].setHighlighted(true);
  }

  /**
   * Applies every selected texture near the tile under the cursor — fires
   * once per click and again for every new tile the pointer drags across
   * while held (see InputManager.setOnTilePaint). Each selected texture
   * acts according to its own remembered tool: a brush-tool texture paints
   * the tile at `tile` shifted by its own `gridOffsetX`/`gridOffsetY` (see
   * MapEditorPanel.getSelectedPaints — that's what keeps a multi-texture
   * stamp laid out the same way the textures sit in the palette), on click
   * or drag; a bucket-tool texture ignores which tile was clicked and
   * floods its whole layer instead, only on an actual click — a drag
   * doesn't keep re-flooding on every tile it crosses. Random-tool textures
   * behave like the bucket (whole-map, click-only) but scatter across a
   * fraction of tiles instead of filling every one — all of them share one
   * dice roll per anchor position (see MapManager.randomFillLayers), so a
   * multi-texture random stamp keeps its pieces' relative position intact
   * instead of each texture landing independently. All of a single
   * click/drag step's edits share one undo snapshot.
   */
  private handleTilePaint(tile: GridPosition, isDrag: boolean): void {
    if (!this.mapEditorPanel) {
      return;
    }

    if (this.mapEditorPanel.getActiveTab() === "mobs") {
      if (this.mapEditorPanel.isEraserSelected()) {
        this.handleMobErase(tile);
      }
      return;
    }

    const paints = this.mapEditorPanel.getSelectedPaints();
    if (paints.length === 0) {
      return;
    }

    const stampedPaints = paints.map((paint) => ({
      paint,
      stampTile: { x: tile.x + paint.gridOffsetX, y: tile.y + paint.gridOffsetY },
    }));

    const hasAction = stampedPaints.some(({ paint, stampTile }) => {
      if (paint.tool === "brush") {
        return GridUtils.isInBounds(stampTile, this.mapManager.width, this.mapManager.height);
      }
      return (paint.tool === "bucket" || paint.tool === "random") && !isDrag;
    });
    if (!hasAction) {
      return;
    }

    if (!isDrag) {
      this.mapManager.pushHistorySnapshot();
    }

    stampedPaints.forEach(({ paint, stampTile }) => {
      if (paint.tool === "brush" && GridUtils.isInBounds(stampTile, this.mapManager.width, this.mapManager.height)) {
        this.mapManager.paintTile(stampTile, paint.layerIndex, paint.tileIndex, paint.blocked);
        if (paint.autoBorder) {
          this.mapManager.applyBrushBorder(stampTile, paint.layerIndex, paint.tileIndex, paint.blocked);
        }
      } else if (paint.tool === "bucket" && !isDrag) {
        this.mapManager.fillLayer(paint.layerIndex, paint.tileIndex, paint.blocked);
      }
    });

    const randomPaints = paints.filter((paint) => paint.tool === "random");
    if (randomPaints.length > 0 && !isDrag) {
      this.mapManager.randomFillLayers(
        randomPaints.map((paint) => ({
          layerIndex: paint.layerIndex,
          tileIndex: paint.tileIndex,
          blocked: paint.blocked,
          gridOffsetX: paint.gridOffsetX,
          gridOffsetY: paint.gridOffsetY,
        })),
        randomPaints[0]!.randomDensity,
        this.mapEditorPanel!.getStructuralTileIndices(),
      );
    }

    this.lockedBlocksOverlay.refresh(this.mapManager.getWalkableGrid());
  }

  /** Undoes the map editor's last discrete edit (a brush stroke, bucket fill, or random fill) — see MapManager.undo. No-op if there's nothing to undo. */
  private handleMapEditorUndo(): void {
    if (this.mapManager.undo()) {
      this.lockedBlocksOverlay.refresh(this.mapManager.getWalkableGrid());
    }
  }

  /**
   * Arrow keys and the action key (space) are both highest-priority input: a
   * held direction, or space, always wins over an in-progress click-to-move
   * path, cancelling it and handing control to the keyboard on the spot.
   * Mid-tile keyboard steps are still left to finish their tween
   * (`player.isMoving()` below) so a held key doesn't yank the sprite off its
   * current step. Space takes priority over movement — holding it attacks in
   * place, facing whichever direction the player last faced, even if an
   * arrow key is also held.
   */
  public update(): void {
    if (this.isTransitioningMap) {
      return;
    }

    const direction = this.inputManager.getHeldDirection();
    const isAttackHeld = this.inputManager.isActionHeld();

    if ((direction || isAttackHeld) && (this.isFollowingClickPath || this.attackTargetMobId !== null)) {
      this.player.stopMovement();
      this.isFollowingClickPath = false;
      this.pendingClickDestination = null;
      this.pendingClickCrossDirection = null;
      this.activeCrossDirection = null;
      this.destinationMarker.hide();
      this.clearAttackMode();
    }

    if (this.player.isMoving()) {
      return;
    }

    if (isAttackHeld) {
      this.player.playAttack();
      this.sendAttackRequestIfDue(!this.wasAttackHeldLastFrame);
      this.wasAttackHeldLastFrame = true;
    } else if (direction) {
      this.handleDirectionMove(direction);
      this.wasAttackHeldLastFrame = false;
    } else if (this.attackTargetMobId) {
      this.updateAttackMode();
      this.wasAttackHeldLastFrame = false;
    } else {
      this.player.settleIdle();
      this.wasAttackHeldLastFrame = false;
    }
  }

  /**
   * Sends AttackRequest the instant an attack is first engaged — held Space
   * just pressed, or a mouse-driven chase just reaching melee range — so the
   * very first hit always lands on contact, per the mob system spec. Then
   * again every ATTACK_COOLDOWN_MS while the attack continues. The server
   * enforces the real 1 attack/second cooldown independently (see
   * PlayerState.LastAttackAt) — this is only client-side pacing to avoid
   * flooding it with a request every frame. Shared between manual (Space)
   * and mouse-driven auto-attack (see `updateAttackMode`) since the two are
   * mutually exclusive on any given frame (Space preempts attack mode, see
   * `update`).
   */
  private sendAttackRequestIfDue(justEngaged: boolean): void {
    if (justEngaged || this.time.now - this.lastAttackSentAt >= ATTACK_COOLDOWN_MS) {
      this.lastAttackSentAt = this.time.now;
      network.send(NetworkEventType.AttackRequest, {});
    }
  }

  /**
   * Chases and auto-attacks `attackTargetMobId` — called once per idle frame
   * while mouse-driven attack mode is active (see `update`). Faces and
   * attacks in place once in melee range; otherwise re-pathfinds one step
   * closer every idle tick, so the chase naturally re-routes as the
   * server-driven mob wanders without needing its own stale-path tracking.
   */
  private updateAttackMode(): void {
    const mob = this.attackTargetMobId ? this.mobs.get(this.attackTargetMobId) : undefined;
    if (!mob) {
      this.clearAttackMode();
      this.player.settleIdle();
      return;
    }

    const playerTile = this.player.getCurrentTile();
    const mobTile = mob.getCurrentTile();

    if (this.isAdjacentForAttack(playerTile, mobTile, mob.getAttackRangeTiles())) {
      if (!GridUtils.equals(playerTile, mobTile)) {
        this.player.faceDirection(this.directionBetween(playerTile, mobTile));
      }
      this.player.playAttack();
      this.sendAttackRequestIfDue(!this.wasChasingInRangeLastFrame);
      this.wasChasingInRangeLastFrame = true;
      return;
    }
    this.wasChasingInRangeLastFrame = false;

    const nextTile = this.nextStepTowardMob(playerTile, mobTile);
    if (nextTile) {
      this.player.followPath([nextTile]);
    } else {
      this.player.settleIdle();
    }
  }

  /**
   * True if `a` and `b` are the same tile, or share a row/column within
   * `rangeTiles` of each other — mirrors the server's melee range
   * (fso_web_server's zoneserver.inAttackRange: the attacker's own tile or
   * up to `rangeTiles` tiles ahead in their facing direction, see
   * mobAttackRangeTiles). Only meaningful once `faceDirection` below has
   * pointed the player straight at `b`, same as the server facing itself
   * toward its own target before checking range.
   */
  private isAdjacentForAttack(a: GridPosition, b: GridPosition, rangeTiles: number): boolean {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx === 0 && dy === 0) {
      return true;
    }
    if (dx === 0) {
      return Math.abs(dy) <= rangeTiles;
    }
    if (dy === 0) {
      return Math.abs(dx) <= rangeTiles;
    }
    return false;
  }

  /** Cardinal direction from `from` toward `to` — same dx/dy priority as Mob's/Player's private `directionBetween`. */
  private directionBetween(from: GridPosition, to: GridPosition): Direction {
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

  /**
   * The first step of the shortest path from `playerTile` to whichever
   * walkable tile orthogonally adjacent to `mobTile` is closest — the next
   * move in the mouse-driven chase, or null if no adjacent tile is reachable
   * at all (e.g. the mob is walled off).
   */
  private nextStepTowardMob(playerTile: GridPosition, mobTile: GridPosition): GridPosition | null {
    const grid = this.mapManager.getWalkableGrid();
    let bestPath: GridPosition[] | null = null;

    for (const delta of Object.values(DIRECTION_DELTAS)) {
      const candidate: GridPosition = { x: mobTile.x + delta.x, y: mobTile.y + delta.y };
      if (!GridUtils.isInBounds(candidate, this.mapManager.width, this.mapManager.height) || !this.mapManager.isWalkable(candidate)) {
        continue;
      }
      const path = this.pathfindingManager.findPath(playerTile, candidate, grid);
      if (path && path.length > 0 && (!bestPath || path.length < bestPath.length)) {
        bestPath = path;
      }
    }

    return bestPath && bestPath.length > 0 ? bestPath[0]! : null;
  }

  /** Starts (or retargets) mouse-driven attack-follow mode on `mobId` — cancels any in-progress click-to-move path the same way arrow keys/Space already do (see `update`). */
  private enterAttackMode(mobId: string): void {
    this.player.stopMovement();
    this.isFollowingClickPath = false;
    this.pendingClickDestination = null;
    this.pendingClickCrossDirection = null;
    this.activeCrossDirection = null;
    this.destinationMarker.hide();

    this.attackTargetMobId = mobId;
    this.wasChasingInRangeLastFrame = false;
  }

  /** Ends mouse-driven attack-follow mode, if active. */
  private clearAttackMode(): void {
    this.attackTargetMobId = null;
    this.wasChasingInRangeLastFrame = false;
  }

  /**
   * Resolves a click (or a drag crossing into a new tile) into a
   * destination and queues it. Blocked-tile clicks fall back to the
   * nearest reachable tile; if nothing reachable exists nearby, the click
   * is silently ignored per the movement spec. Doesn't route immediately
   * while the player is mid-step — `applyPendingDestination` picks it up
   * the moment the current tile finishes, so a drag never cuts a step
   * short (see `pendingClickDestination`).
   *
   * The camera never scrolls past `cameraManager.setWorldBounds`, so there
   * is no visible space beyond the map to click into — the only way a
   * click can mean "cross to the neighbor map" is by landing on the
   * outermost walkable row/column itself. `getEdgeCrossDirection` reads
   * that intent off the resolved destination, so `onPathComplete` can
   * continue the crossing once the player actually reaches that edge —
   * the same border-crossing arrow keys already trigger, just reachable by
   * click now too.
   */
  private handleTileClick(clickedTile: GridPosition): void {
    const mobEntry = this.findMobEntryAtWorldPoint(this.pointerWorldPoint());
    if (mobEntry) {
      this.enterAttackMode(mobEntry[0]);
      return;
    }
    this.clearAttackMode();

    const destination = this.mapManager.findNearestWalkable(clickedTile);
    if (!destination) {
      return;
    }

    this.destinationMarker.show(destination, this.mapManager.tileSize);
    this.pendingClickDestination = destination;
    this.pendingClickCrossDirection = this.getEdgeCrossDirection(destination, clickedTile);

    if (!this.player.isMoving()) {
      this.applyPendingDestination();
    }
  }

  /** Routes to the queued click/drag destination, if any, from wherever the player currently stands. */
  private applyPendingDestination(): void {
    const destination = this.pendingClickDestination;
    if (!destination) {
      return;
    }
    this.pendingClickDestination = null;
    const crossDirection = this.pendingClickCrossDirection;
    this.pendingClickCrossDirection = null;

    const path = this.pathfindingManager.findPath(this.player.getCurrentTile(), destination, this.mapManager.getWalkableGrid());
    if (!path || path.length === 0) {
      this.destinationMarker.hide();
      // Already standing on the destination — e.g. a second click on the
      // edge tile the player is already at — so there's no path to walk,
      // but the crossing intent still applies immediately.
      if (crossDirection && this.isAtMapEdge(crossDirection)) {
        void this.crossMapBorder(crossDirection);
      }
      return;
    }

    if (this.debugOverlay.isVisible()) {
      this.debugOverlay.showPath(path);
    }

    this.isFollowingClickPath = true;
    this.activeCrossDirection = crossDirection;
    this.player.followPath(path);
  }

  /**
   * Which edge, if any, a click means "cross here" for — null for a
   * destination that isn't on the map's outer ring. A destination in a
   * corner (on the outer ring for both axes) is disambiguated by how far
   * the raw click leaned past that edge — beyond the map's bounds if the
   * viewport happens to show empty space past it, or simply further from
   * center if the click landed in-bounds like an ordinary edge click.
   */
  private getEdgeCrossDirection(destination: GridPosition, clickedTile: GridPosition): Direction | null {
    const xCandidate = destination.x === 0 ? Direction.West : destination.x === this.mapManager.width - 1 ? Direction.East : null;
    const yCandidate = destination.y === 0 ? Direction.North : destination.y === this.mapManager.height - 1 ? Direction.South : null;

    if (!xCandidate) {
      return yCandidate;
    }
    if (!yCandidate) {
      return xCandidate;
    }

    const overX = clickedTile.x < 0 ? -clickedTile.x : Math.max(0, clickedTile.x - (this.mapManager.width - 1));
    const overY = clickedTile.y < 0 ? -clickedTile.y : Math.max(0, clickedTile.y - (this.mapManager.height - 1));
    return overX >= overY ? xCandidate : yCandidate;
  }

  /** True if the player's current tile sits on the map edge that `direction` would cross. */
  private isAtMapEdge(direction: Direction): boolean {
    const tile = this.player.getCurrentTile();
    switch (direction) {
      case Direction.East:
        return tile.x === this.mapManager.width - 1;
      case Direction.West:
        return tile.x === 0;
      case Direction.South:
        return tile.y === this.mapManager.height - 1;
      case Direction.North:
        return tile.y === 0;
    }
  }

  /**
   * Steps the player one tile in the held arrow-key direction. Blocked
   * tiles don't move the player, but still turn them to face the
   * attempted direction.
   */
  private handleDirectionMove(direction: Direction): void {
    const delta = DIRECTION_DELTAS[direction];
    const currentTile = this.player.getCurrentTile();
    const nextTile: GridPosition = { x: currentTile.x + delta.x, y: currentTile.y + delta.y };

    if (!GridUtils.isInBounds(nextTile, this.mapManager.width, this.mapManager.height)) {
      this.player.faceDirection(direction);
      void this.crossMapBorder(direction);
      return;
    }

    if (!this.mapManager.isWalkable(nextTile)) {
      this.player.faceDirection(direction);
      return;
    }

    this.player.followPath([nextTile]);
  }

  /**
   * Walking off the edge of the current map loads the neighboring map in
   * that direction and drops the player at the mirrored entry point: same
   * row when crossing a side edge, same column when crossing top/bottom.
   * If no map exists yet for that grid slot, an empty grass map is
   * generated on the fly.
   */
  private async crossMapBorder(direction: Direction): Promise<void> {
    if (this.isTransitioningMap) {
      return;
    }
    this.isTransitioningMap = true;

    try {
      const delta = DIRECTION_DELTAS[direction];
      const neighborCoord: MapCoord = { x: this.currentMapCoord.x + delta.x, y: this.currentMapCoord.y + delta.y };
      const exitTile = this.player.getCurrentTile();

      const mapData = await this.loadMapData(neighborCoord);
      const entryTile = this.computeEntryTile(direction, exitTile, mapData);

      await this.playMapTransition(direction, mapData, neighborCoord, entryTile);
    } finally {
      this.isTransitioningMap = false;
    }
  }

  /**
   * Slides from the outgoing map into the incoming one: the new map's tile
   * layers are placed flush against the edge the player is crossing (in the
   * same world space as the current map, not its own), the camera's bounds
   * are widened to cover both, and the camera + player pan across the seam
   * together as a locked unit. Since the player stays fixed on screen while
   * the world scrolls underneath, the incoming map visually emerges from
   * the screen edge in the direction of travel — the side opposite the
   * player — while the outgoing map recedes off the other side.
   */
  private async playMapTransition(direction: Direction, newMapData: MapData, newCoord: MapCoord, entryTile: GridPosition): Promise<void> {
    const outgoingMap = this.mapManager;
    const incomingMap = new MapManager(this, newMapData);
    incomingMap.setAlternatingTileIndices(getAlternatingTileIndices(this.mapEditorBlockConfigs));

    const outgoingW = outgoingMap.worldWidthPx;
    const outgoingH = outgoingMap.worldHeightPx;
    const incomingW = incomingMap.worldWidthPx;
    const incomingH = incomingMap.worldHeightPx;

    // Place the incoming map's layers flush against the edge being crossed,
    // in the outgoing map's world space, so the two sit side by side.
    const axisDelta = DIRECTION_DELTAS[direction];
    const offsetX = axisDelta.x > 0 ? outgoingW : axisDelta.x < 0 ? -incomingW : 0;
    const offsetY = axisDelta.y > 0 ? outgoingH : axisDelta.y < 0 ? -incomingH : 0;
    incomingMap.setLayerOffset(offsetX, offsetY);

    // Camera bounds must cover the union of both maps' rects while both are visible.
    const boundsX = Math.min(0, offsetX);
    const boundsY = Math.min(0, offsetY);
    const boundsW = Math.max(outgoingW, offsetX + incomingW) - boundsX;
    const boundsH = Math.max(outgoingH, offsetY + incomingH) - boundsY;
    this.cameraManager.setWorldBoundsRect(boundsX, boundsY, boundsW, boundsH);
    this.cameraManager.stopFollow();

    const exitTile = this.player.getCurrentTile();
    const exitWorldPos = GridUtils.tileToWorld(exitTile, outgoingMap.tileSize);
    const entryWorldPos = GridUtils.tileToWorld(entryTile, incomingMap.tileSize);
    const panDx = offsetX + entryWorldPos.x - exitWorldPos.x;
    const panDy = offsetY + entryWorldPos.y - exitWorldPos.y;

    await Promise.all([
      this.cameraManager.tweenScrollBy(this, panDx, panDy, MAP_TRANSITION_DURATION_MS),
      this.player.panBy(panDx, panDy, direction, MAP_TRANSITION_DURATION_MS),
      this.playTransitionDimPulse(),
    ]);

    // Rebase everything into the incoming map's own (0, 0) coordinate space, keeping the view stable.
    outgoingMap.destroy();
    this.debugOverlay.destroy();
    this.lockedBlocksOverlay.destroy();

    incomingMap.setLayerOffset(0, 0);
    this.cameraManager.shiftScroll(-offsetX, -offsetY);

    this.mapManager = incomingMap;
    this.currentMapCoord = newCoord;

    const spawnTile = this.mapManager.isWalkable(entryTile)
      ? entryTile
      : (this.mapManager.findNearestWalkable(entryTile) ?? this.mapManager.spawnPoint);
    this.player.teleportTo(spawnTile);
    this.savePosition(spawnTile);
    this.clearRemotePlayers();
    this.clearMobs();
    this.clearMobEditorPreviews();
    this.sendJoinRequest();

    this.debugOverlay = new DebugOverlay(this, this.mapManager.width, this.mapManager.height, this.mapManager.getWalkableGrid());
    this.lockedBlocksOverlay = new LockedBlocksOverlay(this, this.mapManager.width, this.mapManager.height, this.mapManager.getWalkableGrid());
    this.lockedBlocksOverlay.setVisible(this.mapEditorPanel !== null);

    this.cameraManager.setWorldBounds(this.mapManager.worldWidthPx, this.mapManager.worldHeightPx);
    this.cameraManager.follow(this.player.sprite);
  }

  /**
   * Dims the screen with a soft black pulse — down to `MAP_TRANSITION_FADE_ALPHA`
   * and back to clear — timed to the crossing's full duration. Screen-fixed
   * (unaffected by the camera pan underneath it) and cleared up on its own,
   * so this softens the cut without hiding the slide itself.
   */
  private playTransitionDimPulse(): Promise<void> {
    const cam = this.cameras.main;
    const dimmer = this.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0);
    dimmer.setOrigin(0, 0);
    dimmer.setScrollFactor(0);
    dimmer.setDepth(DEPTH.TRANSITION_FADE);

    return new Promise((resolve) => {
      this.tweens.add({
        targets: dimmer,
        alpha: MAP_TRANSITION_FADE_ALPHA,
        duration: MAP_TRANSITION_DURATION_MS / 2,
        ease: Phaser.Math.Easing.Sine.InOut,
        yoyo: true,
        onComplete: () => {
          dimmer.destroy();
          resolve();
        },
      });
    });
  }

  /** Mirrors the exit tile onto the opposite edge of the destination map. */
  private computeEntryTile(direction: Direction, exitTile: GridPosition, mapData: MapData): GridPosition {
    const lastX = mapData.width - 1;
    const lastY = mapData.height - 1;
    const clampedX = Phaser.Math.Clamp(exitTile.x, 0, lastX);
    const clampedY = Phaser.Math.Clamp(exitTile.y, 0, lastY);

    switch (direction) {
      case Direction.East:
        return { x: 0, y: clampedY };
      case Direction.West:
        return { x: lastX, y: clampedY };
      case Direction.South:
        return { x: clampedX, y: 0 };
      case Direction.North:
        return { x: clampedX, y: lastY };
    }
  }

  /** Returns cached map data for a grid slot, fetching it or generating an empty map on first visit. */
  private async loadMapData(coord: MapCoord): Promise<MapData> {
    const key = this.mapCoordKey(coord);
    const cached = this.mapDataCache.get(key);
    if (cached) {
      return cached;
    }

    const mapData = await this.fetchMapData(coord);
    this.mapDataCache.set(key, mapData);
    return mapData;
  }

  private async fetchMapData(coord: MapCoord): Promise<MapData> {
    try {
      const response = await fetch(mapDataUrl(coord.x, coord.y));
      if (response.ok) {
        return (await response.json()) as MapData;
      }
    } catch {
      // Falls through to generation below — gateway/Postgres unreachable is treated the same as "not found".
    }

    const mapData = MapFactory.createEmptyGrassMap();
    void this.saveMapData(coord, mapData);
    return mapData;
  }

  /**
   * Persists the current map's live (possibly just-painted) state via the
   * map editor's Save button — shows the "Salvando..." banner for the
   * duration of the write, then closes the editor panel once it settles.
   */
  private handleSaveMap(): void {
    this.savingIndicator.show();
    void this.saveMapData(this.currentMapCoord, this.mapManager.getMapData()).then(() => {
      this.savingIndicator.hide();
      // Every mob placed this session just became real server-side (the
      // save's reload_mobs round trip seeds it and broadcasts MobSpawned —
      // see spawnMob). Without this, the local-only preview sprite lingers
      // forever alongside the real one: duplicate mobs at save, and a ghost
      // that isn't in mobIdsBySpawnId so the eraser/freeze logic never finds
      // it again.
      this.clearMobEditorPreviews();
      this.closeMapEditor();
    });
  }

  /**
   * Persists a map to Postgres via the fso_web_server gateway (see
   * internal/mapstore) — used both to persist a freshly generated map (so
   * the next visit to that world-grid slot loads the same data instead of
   * generating a new one) and to save the map editor's painted edits.
   * Best-effort: if the gateway isn't running, failures here are silently
   * ignored.
   */
  private async saveMapData(coord: MapCoord, mapData: MapData): Promise<void> {
    try {
      const response = await fetch(SAVE_MAP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: coord.x, y: coord.y, mapData }),
      });
      if (!response.ok) {
        // Surfaced only to the console, not the player — the map still works locally either way, same as the network-error case below — but a silent HTTP failure here otherwise looks identical to a successful save (see SavingIndicator's doc comment) and is worth knowing about while developing.
        console.error(`GameScene: saving map (${coord.x},${coord.y}) failed with HTTP ${response.status}.`);
      }
    } catch {
      // No dev server endpoint available (e.g. production build) — the map still works, just isn't persisted.
    }
  }

  private mapCoordKey(coord: MapCoord): string {
    return `${coord.x},${coord.y}`;
  }
}
