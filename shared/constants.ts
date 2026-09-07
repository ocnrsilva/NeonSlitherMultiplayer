import { SpecialItemType } from './types';

export const WORLD_WIDTH = 10000;
export const WORLD_HEIGHT = 10000;
export const WORLD_SIZE = 10000;
export const GRID_CELL_SIZE = 500;

export const GAME_TICK_RATE = 20; // 20 updates per second (50ms)
export const SNAPSHOT_RATE = 15; // 15 snapshots per second (~66.6ms)
export const SIMULATION_HERTZ = 60; // 60Hz reference timebase for fluid movement & turning

export const GAME_MAX_PLAYERS = 100;
export const RECONNECTION_GRACE_MS = 30000; // 30 seconds to reconnect
export const MAX_INPUT_RATE_PER_SEC = 35; // Rate limit protection against flooding

export const INITIAL_SNAKE_LENGTH = 10;
export const SEGMENT_DISTANCE = 5;
export const BASE_SPEED = 3.2;
export const BOOST_SPEED = 6.2;
export const SPECIAL_SPEED_MULTIPLIER = 1.8;
export const TURN_SPEED = 0.12;
export const FOOD_COUNT = 3500;
export const AI_COUNT = 30;

export const MAGNET_RADIUS = 250;
export const MAGNET_PULL_STRENGTH = 8;
export const KNIFE_SPEED = 12;
export const KNIFE_MAX_DISTANCE = 700;
export const VALUE_PER_SEGMENT = 6.6667;

export const FOOD_TIERS = {
  NORMAL: { probability: 0.85, value: 1, size: 3, glow: 5 },
  LARGE: { probability: 0.12, value: 5, size: 6, glow: 12 },
  RARE: { probability: 0.03, value: 15, size: 10, glow: 20 },
};

export const SPECIAL_ITEMS_CONFIG: Record<
  SpecialItemType,
  {
    max: number;
    respawnMs: number;
    durationMs?: number;
    label: string;
    color: string;
  }
> = {
  SIZE: {
    max: 15,
    respawnMs: 2 * 60 * 1000,
    label: '🟢',
    color: '#10b981',
  },
  SPEED: {
    max: 20,
    respawnMs: 1 * 60 * 1000,
    durationMs: 30 * 1000,
    label: '⚡',
    color: '#f59e0b',
  },
  ANGEL: {
    max: 11,
    respawnMs: 1 * 60 * 1000,
    durationMs: 15 * 1000,
    label: '😇',
    color: '#60a5fa',
  },
  MAGNET: {
    max: 15,
    respawnMs: 2 * 60 * 1000,
    durationMs: 15 * 1000,
    label: '🧲',
    color: '#f43f5e',
  },
  SCOUTER: {
    max: 13,
    respawnMs: 2 * 60 * 1000,
    durationMs: 40 * 1000,
    label: '🔍',
    color: '#a855f7',
  },
  SLICER: {
    max: 9,
    respawnMs: 1 * 60 * 1000,
    durationMs: 30 * 1000,
    label: '⚔️',
    color: '#94a3b8',
  },
  USURPER: {
    max: 8,
    respawnMs: 1 * 60 * 1000,
    durationMs: 30 * 1000,
    label: '🎭',
    color: '#22d3ee',
  },
  STALKER: {
    max: 6,
    respawnMs: 3 * 60 * 1000,
    durationMs: 25 * 1000,
    label: '👁️',
    color: '#f87171',
  },
};

export const COLORS = [
  '#22c55e',
  '#3b82f6',
  '#ef4444',
  '#eab308',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
  '#f97316',
];

export const NAMES = [
  'Neon Hunter',
  'Swift Viper',
  'Glow Cobra',
  'Light Racer',
  'Grid Runner',
  'Slither King',
  'Dark Naga',
  'Electro Asp',
  'Byte Mamba',
  'Flash Wyrm',
  'Solar Python',
  'Quantum Boa',
  'Cyber Krait',
  'Digital Adder',
  'Neon Taipan',
  'Prism Urutu',
];
