import type { GridPosition, MapCoord } from "@/types/MapTypes";
import { DEFAULT_PLAYER_SKIN, isPlayerSkinId, PLAYER_MAX_HP, type PlayerSkinId } from "@/utils/Constants";

const CHARACTER_NAME_KEY = "fso.characterName";
const CHARACTER_SKIN_KEY = "fso.characterSkin";
const LAST_POSITION_KEY = "fso.lastPosition";
const HP_KEY = "fso.hp";
const XP_KEY = "fso.xp";
const LEVEL_KEY = "fso.level";

interface LastPosition {
  mapCoord: MapCoord;
  tile: GridPosition;
}

/**
 * Holds the current character name and last known map/tile position,
 * persisted to localStorage so a returning player is remembered across
 * reloads, auto-enters the game (see BootScene), and resumes exactly where
 * they left off (see GameScene). Cleared on explicit logout. Set only after
 * the credentials are verified against the backend — see LoginScene and
 * internal/accountstore.
 */
class PlayerSessionStore {
  private characterName: string | null = PlayerSessionStore.readStoredName();
  private characterSkin: PlayerSkinId = PlayerSessionStore.readStoredSkin();
  private lastPosition: LastPosition | null = PlayerSessionStore.readStoredPosition();
  private hp: number = PlayerSessionStore.readStoredStat(HP_KEY, PLAYER_MAX_HP);
  private xp: number = PlayerSessionStore.readStoredStat(XP_KEY, 0);
  private level: number = PlayerSessionStore.readStoredStat(LEVEL_KEY, 0);

  private static readStoredName(): string | null {
    try {
      return localStorage.getItem(CHARACTER_NAME_KEY);
    } catch {
      return null;
    }
  }

  private static readStoredSkin(): PlayerSkinId {
    try {
      const raw = localStorage.getItem(CHARACTER_SKIN_KEY);
      return raw !== null && isPlayerSkinId(raw) ? raw : DEFAULT_PLAYER_SKIN;
    } catch {
      return DEFAULT_PLAYER_SKIN;
    }
  }

  private static readStoredPosition(): LastPosition | null {
    try {
      const raw = localStorage.getItem(LAST_POSITION_KEY);
      return raw ? (JSON.parse(raw) as LastPosition) : null;
    } catch {
      return null;
    }
  }

  /** A freshly created character has no stored HP/XP yet — `fallback` is what a brand-new character starts with (see PLAYER_MAX_HP/PLAYER_MAX_XP). */
  private static readStoredStat(key: string, fallback: number): number {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw !== null ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  public hasCharacterName(): boolean {
    return this.characterName !== null;
  }

  public setCharacterName(name: string): void {
    this.characterName = name;
    try {
      localStorage.setItem(CHARACTER_NAME_KEY, name);
    } catch {
      // localStorage unavailable (e.g. private browsing) — falls back to in-memory only.
    }
  }

  public getCharacterName(): string {
    if (!this.characterName) {
      throw new Error("PlayerSession: characterName accessed before it was set.");
    }
    return this.characterName;
  }

  /** Set from LoginScene's response — see fso_web_server's accountstore, which persists whatever skin RegisterScene sent at account creation. */
  public setCharacterSkin(skin: PlayerSkinId): void {
    this.characterSkin = skin;
    try {
      localStorage.setItem(CHARACTER_SKIN_KEY, skin);
    } catch {
      // localStorage unavailable (e.g. private browsing) — falls back to in-memory only.
    }
  }

  /** Falls back to DEFAULT_PLAYER_SKIN rather than throwing — unlike characterName, a missing skin is a safe, recoverable default, not a sign this was accessed too early. */
  public getCharacterSkin(): PlayerSkinId {
    return this.characterSkin;
  }

  public getLastPosition(): LastPosition | null {
    return this.lastPosition;
  }

  public setLastPosition(mapCoord: MapCoord, tile: GridPosition): void {
    this.lastPosition = { mapCoord, tile };
    try {
      localStorage.setItem(LAST_POSITION_KEY, JSON.stringify(this.lastPosition));
    } catch {
      // ignore
    }
  }

  /** Falls back to PLAYER_MAX_HP (a fresh character's starting HP) rather than throwing — same reasoning as getCharacterSkin. */
  public getHp(): number {
    return this.hp;
  }

  public setHp(hp: number): void {
    this.hp = hp;
    try {
      localStorage.setItem(HP_KEY, String(hp));
    } catch {
      // ignore
    }
  }

  /** Falls back to 0 (a fresh character's starting XP) rather than throwing — same reasoning as getCharacterSkin. */
  public getXp(): number {
    return this.xp;
  }

  public setXp(xp: number): void {
    this.xp = xp;
    try {
      localStorage.setItem(XP_KEY, String(xp));
    } catch {
      // ignore
    }
  }

  /** Falls back to 0 (a fresh character's starting level) rather than throwing — same reasoning as getCharacterSkin. */
  public getLevel(): number {
    return this.level;
  }

  public setLevel(level: number): void {
    this.level = level;
    try {
      localStorage.setItem(LEVEL_KEY, String(level));
    } catch {
      // ignore
    }
  }

  public clear(): void {
    this.characterName = null;
    this.characterSkin = DEFAULT_PLAYER_SKIN;
    this.lastPosition = null;
    this.hp = PLAYER_MAX_HP;
    this.xp = 0;
    this.level = 0;
    try {
      localStorage.removeItem(CHARACTER_NAME_KEY);
      localStorage.removeItem(CHARACTER_SKIN_KEY);
      localStorage.removeItem(LAST_POSITION_KEY);
      localStorage.removeItem(HP_KEY);
      localStorage.removeItem(XP_KEY);
      localStorage.removeItem(LEVEL_KEY);
    } catch {
      // ignore
    }
  }
}

export const PlayerSession = new PlayerSessionStore();
