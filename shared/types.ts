export interface Point {
  x: number;
  y: number;
}

export interface TrailParticle {
  x: number;
  y: number;
  color: string;
  life: number;
  size: number;
}

export type SpecialItemType =
  | 'SIZE'
  | 'SPEED'
  | 'ANGEL'
  | 'MAGNET'
  | 'SCOUTER'
  | 'SLICER'
  | 'USURPER'
  | 'STALKER';

export interface PlayerLoadoutConfig {
  enabledItems: Record<SpecialItemType, boolean>;
}

export interface Knife {
  id: string;
  x: number;
  y: number;
  angle: number;
  ownerId: string;
  speed: number;
  distanceTravelled: number;
}

export interface SpecialItem {
  id: string;
  x: number;
  y: number;
  type: SpecialItemType;
  respawnAt?: number;
  isAvailable: boolean;
}

export interface Snake {
  id: string;
  sessionId?: string;
  name: string;
  color: string;
  segments: Point[];
  angle: number;
  targetAngle: number;
  speed: number;
  length: number;
  isPlayer: boolean;
  score: number;
  isBoosting: boolean;
  powerupInventory: Record<SpecialItemType, number>;
  speedBoostEndTime: number;
  invincibilityEndTime: number;
  magnetEndTime: number;
  scouterEndTime: number;
  slicerEndTime: number;
  usurperEndTime: number;
  stalkerEndTime: number;
  lastKnifeTime: number;
  lastInputSequence?: number;
  lastInputTime?: number;
  isDisconnected?: boolean;
  disconnectedAt?: number;
  loadout?: PlayerLoadoutConfig;
}

export interface Food {
  id?: string;
  x: number;
  y: number;
  size: number;
  color: string;
  value: number;
}

export interface GameState {
  player: Snake | null;
  snakes: Snake[];
  foods: Food[];
  specialItems: SpecialItem[];
  trails: TrailParticle[];
  knives: Knife[];
  worldSize: number;
  isGameOver: boolean;
}

export interface LeaderboardEntry {
  id?: string;
  name: string;
  score: number;
  isPlayer: boolean;
}

// Compact snapshots sent over network
export interface SnakeSnapshot {
  id: string;
  name: string;
  color: string;
  segments: Point[];
  angle: number;
  speed: number;
  length: number;
  isPlayer: boolean;
  score: number;
  isBoosting: boolean;
  powerupInventory: Record<SpecialItemType, number>;
  speedBoostEndTime: number;
  invincibilityEndTime: number;
  magnetEndTime: number;
  scouterEndTime: number;
  slicerEndTime: number;
  usurperEndTime: number;
  stalkerEndTime: number;
}

export interface FoodSnapshot {
  x: number;
  y: number;
  size: number;
  color: string;
  value: number;
}

export interface SpecialItemSnapshot {
  id: string;
  x: number;
  y: number;
  type: SpecialItemType;
  isAvailable: boolean;
}

export interface KnifeSnapshot {
  id: string;
  x: number;
  y: number;
  angle: number;
  ownerId: string;
}
