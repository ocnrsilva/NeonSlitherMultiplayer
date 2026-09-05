import {
  SnakeSnapshot,
  FoodSnapshot,
  SpecialItemSnapshot,
  KnifeSnapshot,
  LeaderboardEntry,
  PlayerLoadoutConfig,
} from './types';

// CLIENT -> SERVIDOR
export interface GameJoinPayload {
  name: string;
  loadout?: PlayerLoadoutConfig;
  sessionToken?: string;
}

export interface PlayerInputPayload {
  sequence: number;
  direction: number; // angle in radians
  boost: boolean;
}

export interface PlayerRespawnPayload {
  name: string;
  loadout?: PlayerLoadoutConfig;
}

// SERVIDOR -> CLIENTE
export interface GameInitPayload {
  playerId: string;
  sessionToken: string;
  worldWidth: number;
  worldHeight: number;
  tickRate: number;
  snapshotRate: number;
  color: string;
}

export interface GameStateSnapshotPayload {
  sequence: number;
  timestamp: number;
  player: SnakeSnapshot | null;
  snakes: SnakeSnapshot[];
  foods: FoodSnapshot[];
  specialItems: SpecialItemSnapshot[];
  knives: KnifeSnapshot[];
  leaderboard: LeaderboardEntry[];
}

export interface PlayerJoinedPayload {
  id: string;
  name: string;
}

export interface PlayerLeftPayload {
  id: string;
}

export interface PlayerDeathPayload {
  score: number;
  killerId?: string;
  killerName?: string;
  reason: 'COLLISION' | 'BORDER' | 'STALKER' | 'KNIFE';
}

export interface GameErrorPayload {
  code: string;
  message: string;
}

// Socket event name dictionary
export const SOCKET_EVENTS = {
  // Client -> Server
  GAME_JOIN: 'game:join',
  PLAYER_INPUT: 'player:input',
  PLAYER_RESPAWN: 'player:respawn',

  // Server -> Client
  GAME_INIT: 'game:init',
  GAME_STATE: 'game:state',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  PLAYER_DEATH: 'player:death',
  GAME_ERROR: 'game:error',
} as const;
