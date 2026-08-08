import Phaser from "phaser";
import playerSpriteUrl from "@/assets/sprites/player.png";
import player1SpriteUrl from "@/assets/sprites/player1.png";
import ratoSpriteUrl from "@/assets/mobs/rato.png";
import kukaSpriteUrl from "@/assets/mobs/kuka.png";
import { ASSET_PATHS, MAP_CACHE_KEY, MOB_SKINS, PLAYER_ATTACK_EXTRA_FRAME, PLAYER_SKINS, PLAYER_SPRITE, SCENE_KEYS, mapDataUrl } from "@/utils/Constants";
import { TextureFactory } from "@/utils/TextureFactory";
import { preparePaintableTileset } from "@/utils/TilesetCatalog";
import { Player } from "@/entities/Player";
import { Mob } from "@/entities/Mob";
import { PlayerSession } from "@/utils/PlayerSession";
import { MapFactory } from "@/utils/MapFactory";
import type { GameSceneData } from "@/types/GameTypes";
import type { MapCoord, MapData } from "@/types/MapTypes";

/** Every skin's source image, keyed by the same id it's registered under as a Phaser texture (see PLAYER_SKINS). Add a new skin's PNG here alongside a new entry in PLAYER_SKINS. */
const PLAYER_SKIN_URLS: Record<string, string> = {
  player: playerSpriteUrl,
  player1: player1SpriteUrl,
};

/** Every mob skin's source image, keyed the same way as PLAYER_SKIN_URLS — see MOB_SKINS. */
const MOB_SKIN_URLS: Record<string, string> = {
  rato: ratoSpriteUrl,
  kuka: kukaSpriteUrl,
};

/**
 * First scene to run. Loads real art (currently the player spritesheets,
 * one per skin in PLAYER_SKINS), generates placeholder art for anything
 * without real source assets yet, builds the map editor's paintable
 * tileset atlas, and preloads the map JSON before handing off to either the
 * game (if a character name is already remembered) or the login screen.
 * Nothing here is gameplay logic.
 */
export class BootScene extends Phaser.Scene {
  public constructor() {
    super(SCENE_KEYS.BOOT);
  }

  public preload(): void {
    this.load.json(MAP_CACHE_KEY, ASSET_PATHS.STARTER_MAP);
    for (const skin of PLAYER_SKINS) {
      this.load.spritesheet(skin.id, PLAYER_SKIN_URLS[skin.id]!, {
        frameWidth: PLAYER_SPRITE.FRAME_WIDTH,
        frameHeight: PLAYER_SPRITE.FRAME_HEIGHT,
      });
    }
    for (const skin of MOB_SKINS) {
      const url = MOB_SKIN_URLS[skin.id]!;
      if (skin.pattern === "animated") {
        // Same sheet layout as the player skins (see Mob's class doc) — reuses PLAYER_SPRITE's frame size.
        this.load.spritesheet(skin.id, url, {
          frameWidth: PLAYER_SPRITE.FRAME_WIDTH,
          frameHeight: PLAYER_SPRITE.FRAME_HEIGHT,
        });
      } else {
        // A single static pose, not a spritesheet — see Mob's class doc.
        this.load.image(skin.id, url);
      }
    }
  }

  public async create(): Promise<void> {
    TextureFactory.generateAll(this);
    this.addAttackExtraFrames();
    Player.createAnimations(this);
    Mob.createAnimations(this);

    // Must finish before any MapManager is built (it registers these tilesets synchronously).
    await preparePaintableTileset(this);

    // Loads whichever map the player will actually start on (their last saved position, if
    // any) into MAP_CACHE_KEY *before* GameScene exists, so it builds the player directly at
    // their remembered spot instead of first painting them on (0, 0) and only then redirecting
    // once the real map data shows up (see resolveStartingMap's doc comment).
    const startMapCoord = await this.resolveStartingMap();

    this.hideLoadingScreen();

    if (PlayerSession.hasCharacterName()) {
      const sceneData: GameSceneData = {
        characterName: PlayerSession.getCharacterName(),
        skin: PlayerSession.getCharacterSkin(),
        startMapCoord,
      };
      this.scene.start(SCENE_KEYS.GAME, sceneData);
    } else {
      this.scene.start(SCENE_KEYS.LOGIN);
    }
  }

  /**
   * Registers the one bonus attack-pose frame each skin's spritesheet carries
   * below its 3 auto-sliced rows — see PLAYER_ATTACK_EXTRA_FRAME's doc
   * comment for why Phaser's own slicer never produces it on its own.
   */
  private addAttackExtraFrames(): void {
    for (const skin of PLAYER_SKINS) {
      this.textures.get(skin.id).add(
        PLAYER_ATTACK_EXTRA_FRAME.KEY,
        0,
        0,
        PLAYER_ATTACK_EXTRA_FRAME.Y,
        PLAYER_SPRITE.FRAME_WIDTH,
        PLAYER_ATTACK_EXTRA_FRAME.HEIGHT,
      );
    }
  }

  /** Removes the static "Carregando..." overlay from index.html now that every asset needed to render is in place. */
  private hideLoadingScreen(): void {
    document.getElementById("loading-screen")?.remove();
  }

  /**
   * Picks which world-grid map to put in MAP_CACHE_KEY for GameScene's first paint, and
   * returns its coordinate. A returning player resumes on whatever map they were last on
   * (PlayerSession, restored from localStorage) rather than always (0, 0) — GameScene used to
   * start on (0, 0) unconditionally and only swap to the saved map once it had asynchronously
   * fetched it, which visibly flashed the player onto the wrong map (and briefly told the
   * gateway they'd joined it) on every reload. Loading the right map up front here removes
   * that flash entirely.
   */
  private async resolveStartingMap(): Promise<MapCoord> {
    const target = PlayerSession.getLastPosition()?.mapCoord ?? { x: 0, y: 0 };

    // (0, 0) is preloaded from the bundled starter.json in preload() for a fast, offline-safe
    // first paint — just prefer the Postgres-saved version (map editor edits) if it exists.
    if (target.x === 0 && target.y === 0) {
      try {
        const response = await fetch(mapDataUrl(0, 0));
        if (response.ok) {
          const mapData = (await response.json()) as MapData;
          this.cache.json.add(MAP_CACHE_KEY, mapData);
        }
      } catch {
        // Gateway/Postgres unreachable, or nothing saved yet — the bundled starter.json stays in the cache as-is.
      }
      return target;
    }

    // Any other coordinate has no bundled fallback — fetch it from the same gateway every
    // other map coordinate is persisted to (mirrors GameScene.fetchMapData's own fallback).
    let mapData: MapData;
    try {
      const response = await fetch(mapDataUrl(target.x, target.y));
      mapData = response.ok ? ((await response.json()) as MapData) : MapFactory.createEmptyGrassMap();
    } catch {
      mapData = MapFactory.createEmptyGrassMap();
    }
    this.cache.json.add(MAP_CACHE_KEY, mapData);
    return target;
  }
}
