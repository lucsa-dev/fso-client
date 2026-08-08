/**
 * Message contracts for the gateway WebSocket connection (see
 * src/network/Network.ts). Mirrors fso_web_server's internal/protocol
 * package — keep the two in sync when either side's payloads change.
 */

import type { MapCoord } from "@/types/MapTypes";
import type { PlayerSkinId } from "@/utils/Constants";

export enum NetworkEventType {
  Connected = "connected",
  Disconnected = "disconnected",
  JoinRequest = "join_request",
  JoinAccepted = "join_accepted",
  /** Client -> server only: "I finished stepping onto this tile." The
   * server-authoritative broadcast of that step (to everyone on the map,
   * including the sender) comes back as PlayerMoved instead. */
  MoveRequest = "move_request",
  PlayerMoved = "player_moved",
  PlayerJoined = "player_joined",
  PlayerLeft = "player_left",
  ChatMessage = "chat_message",
  Error = "error",

  /** Client -> server only: "I pressed the attack key right now." The server resolves the target and broadcasts whatever it caused (MobDamaged/MobDied/PlayerDamaged/...). */
  AttackRequest = "attack_request",
  /** A mob appeared for clients already on its map, after the fact — distinct from JoinAccepted's mob roster (which only a *joining* client gets). Fired when a saved map's mob catalog changes while its zone is already running (see fso_web_server's ZoneCmdReloadMobs). */
  MobSpawned = "mob_spawned",
  MobMoved = "mob_moved",
  MobDamaged = "mob_damaged",
  MobDied = "mob_died",
  PlayerDamaged = "player_damaged",
  /** Broadcast once a damaged player's HP reaches 0 — distinct from PlayerMoved so it's never dropped as a self-echo (see PlayerMoved's doc above). */
  PlayerRespawned = "player_respawned",
  /** Broadcast whenever a player's HP ticks up on its own (1 HP every 2s while below max — see fso_web_server's MapCell.tickRegen). Same payload shape as PlayerDamaged; applied through the same Player.applyServerHp. */
  PlayerHealed = "player_healed",
}

export interface NetworkMessage<TPayload = unknown> {
  type: NetworkEventType;
  payload: TPayload;
  timestamp: number;
}

export interface JoinRequestPayload {
  characterName: string;
  skin: PlayerSkinId;
  mapCoord: MapCoord;
  tile: { x: number; y: number };
  /** Current character level (see Player.getLevel) — the zone has no persistent XP/level state of its own, so this is reported on every join purely to size PlayerState.MaxHP consistently with the client's own HP bar. */
  level: number;
}

export interface JoinAcceptedPayload {
  playerId: string;
  tile: { x: number; y: number };
  players: PlayerJoinedPayload[];
  mobs: MobSpawnedPayload[];
}

export interface MoveRequestPayload {
  tile: { x: number; y: number };
}

export interface PlayerMovedPayload {
  playerId: string;
  x: number;
  y: number;
  mapCoord: MapCoord;
}

export interface PlayerJoinedPayload {
  playerId: string;
  name: string;
  /** Untyped string, not PlayerSkinId — this crosses the network from another client's own JoinRequest, so it must be narrowed (see GameScene.spawnRemotePlayer) rather than trusted outright. */
  skin: string;
  x: number;
  y: number;
  mapCoord: MapCoord;
}

export interface PlayerLeftPayload {
  playerId: string;
}

export interface ChatMessagePayload {
  playerId: string;
  message: string;
}

export interface ErrorPayload {
  message: string;
  /** Stable machine-readable reason, e.g. "session_replaced" — see fso_web_server's ErrorPayload.Code. Only some errors set this; branch on it, not on message. */
  code?: string;
}

/** One live mob instance — sent as part of JoinAcceptedPayload.mobs. */
export interface MobSpawnedPayload {
  mobId: string;
  /** The originating MobSpawnDef's id — several mobIds can share one spawnId when MobTypeDef.spawnCount > 1 (see GameScene's `mobIdsBySpawnId`). */
  spawnId: string;
  typeId: string;
  name: string;
  /** Untyped string, not MobSkinId — see PlayerJoinedPayload's skin field for why this must be narrowed (GameScene.spawnMob) rather than trusted outright. */
  skin: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  mapCoord: MapCoord;
}

export interface MobMovedPayload {
  mobId: string;
  x: number;
  y: number;
  mapCoord: MapCoord;
}

export interface MobDamagedPayload {
  mobId: string;
  hp: number;
  maxHp: number;
  mapCoord: MapCoord;
}

export interface MobDiedPayload {
  mobId: string;
  /** The player whose attack landed the killing blow — absent when the mob was removed some other way (e.g. deleted from the map editor's catalog). Only this player's client grants the MobTypeDef.xp reward (see GameScene.handleMobDied). */
  killerId?: string;
  mapCoord: MapCoord;
}

export interface PlayerDamagedPayload {
  playerId: string;
  hp: number;
  maxHp: number;
  mapCoord: MapCoord;
}

export interface PlayerRespawnedPayload {
  playerId: string;
  tile: { x: number; y: number };
  hp: number;
  maxHp: number;
  mapCoord: MapCoord;
}

/** Same shape as PlayerDamagedPayload, reused for PlayerHealed — see NetworkEventType.PlayerHealed's doc comment. */
export type PlayerHealedPayload = PlayerDamagedPayload;

export type NetworkEventHandler<TPayload = unknown> = (payload: TPayload) => void;
