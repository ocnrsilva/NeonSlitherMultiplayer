import { SpecialItemType } from '../shared/types';
import { GAME_MAX_PLAYERS } from '../shared/constants';
import { World } from './World';
import { GameLoop } from './GameLoop';
import { SpawnSystem } from './SpawnSystem';

export type RoomStatus = 'STARTING' | 'RUNNING' | 'EMPTY_GRACE' | 'STOPPING' | 'STOPPED';

export interface RoomStats {
  roomId: string;
  configKey: string;
  status: RoomStatus;
  createdAt: number;
  lastActivityAt: number;
  humanPlayers: number;
  botPlayers: number;
  availableSlots: number;
  uptime: number;
}

export interface RoomConfig {
  roomId: string;
  configKey: string;
  enabledItems?: Record<SpecialItemType, boolean>;
  autoInit?: boolean;
}

export const DEFAULT_ENABLED_ITEMS: Record<SpecialItemType, boolean> = {
  SIZE: true,
  SPEED: true,
  MAGNET: true,
  SCOUTER: true,
  ANGEL: false,
  SLICER: false,
  USURPER: false,
  STALKER: false,
};

export const CANONICAL_SPECIAL_ITEM_TYPES: readonly SpecialItemType[] = [
  'SIZE',
  'SPEED',
  'ANGEL',
  'MAGNET',
  'SCOUTER',
  'SLICER',
  'USURPER',
  'STALKER',
] as const;

export const ROOM_EMPTY_GRACE_MS = 10000;

export function generateConfigKey(enabledItems?: Partial<Record<SpecialItemType, boolean>>): string {
  const merged: Record<SpecialItemType, boolean> = { ...DEFAULT_ENABLED_ITEMS, ...enabledItems };
  return CANONICAL_SPECIAL_ITEM_TYPES.map((type) => `${type}=${merged[type] ? 1 : 0}`).join('|');
}

export class Room {
  public readonly roomId: string;
  public readonly configKey: string;
  public readonly enabledItems: Record<SpecialItemType, boolean>;
  public status: RoomStatus;
  public readonly createdAt: number;
  public lastActivityAt: number;
  public sequence = 0;

  // Instâncias independentes proprietárias da Room
  public world?: World;
  public loop?: GameLoop;
  public spawnSystem?: SpawnSystem;

  // Callbacks opcionais para observação de ticks e snapshots
  public onTickCallback?: (deadPlayers: any[], dt: number, now: number) => void;
  public onSnapshotCallback?: (now: number) => void;
  public onShutdownCallback?: (roomId: string) => void;

  // Timer para período de graça quando o último humano sai
  public emptyGraceTimer: NodeJS.Timeout | null = null;

  // Rastreamento seguro de jogadores humanos em memória
  private humanPlayers = new Set<string>();

  // Contagem de bots (mantida ou consultada do world)
  public botPlayers = 0;

  constructor(config: RoomConfig) {
    this.roomId = config.roomId;
    this.configKey = config.configKey;
    this.enabledItems = config.enabledItems ? { ...config.enabledItems } : { ...DEFAULT_ENABLED_ITEMS };
    this.status = 'STARTING';
    this.createdAt = Date.now();
    this.lastActivityAt = this.createdAt;

    if (config.autoInit !== false) {
      this.initInstances();
    }
  }

  /**
   * Inicializa as instâncias privadas de World, SpawnSystem e GameLoop da Room.
   */
  public initInstances(): void {
    if (!this.world) {
      this.world = new World();
      this.world.syncEnabledItems(this.enabledItems);
    }
    if (!this.spawnSystem) {
      this.spawnSystem = new SpawnSystem();
    }
    if (!this.loop) {
      this.loop = new GameLoop(
        (dt, now) => this.onTick(dt, now),
        (now) => this.onSnapshot(now)
      );
    }
  }

  private onTick(dt: number, now: number): void {
    if (!this.world) return;
    if (this.humanCount === 0) return;
    const { deadPlayers } = this.world.update(dt, now, this.humanCount);
    if (this.onTickCallback) {
      this.onTickCallback(deadPlayers, dt, now);
    }
  }

  private onSnapshot(now: number): void {
    if (this.onSnapshotCallback) {
      this.onSnapshotCallback(now);
    }
  }

  /**
   * Inicia o ciclo de vida da sala e dispara seu GameLoop próprio.
   */
  public start(): void {
    if (this.status === 'RUNNING' || this.status === 'STOPPED' || this.status === 'STOPPING') return;

    if (!this.world || !this.loop || !this.spawnSystem) {
      this.initInstances();
    }

    this.loop!.start();
    this.status = 'RUNNING';
    this.lastActivityAt = Date.now();
    if (this.world && this.humanCount > 0) {
      this.world.maintainAIs(this.humanCount);
    }
  }

  /**
   * Encerramento idempotente da sala.
   * Chamadas consecutivas garantidamente não produzem exceções.
   */
  public shutdown(): void {
    if (this.status === 'STOPPED') return;

    this.status = 'STOPPING';

    if (this.emptyGraceTimer) {
      clearTimeout(this.emptyGraceTimer);
      this.emptyGraceTimer = null;
    }

    if (this.loop) {
      try {
        this.loop.stop();
      } catch {
        // Ignora erros de parada com segurança
      }
      this.loop = undefined;
    }

    if (this.world) {
      try {
        this.world.destroy();
      } catch {
        // Ignora erros com segurança
      }
      this.world = undefined;
    }

    if (this.spawnSystem) {
      try {
        this.spawnSystem.destroy();
      } catch {
        // Ignora erros com segurança
      }
      this.spawnSystem = undefined;
    }

    this.onTickCallback = undefined;
    this.onSnapshotCallback = undefined;
    this.humanPlayers.clear();
    this.botPlayers = 0;
    this.status = 'STOPPED';

    if (this.onShutdownCallback) {
      try {
        this.onShutdownCallback(this.roomId);
      } catch {
        // Ignora erros
      }
      this.onShutdownCallback = undefined;
    }
  }

  public addHuman(playerId: string): void {
    this.cancelEmptyGrace();
    this.humanPlayers.add(playerId);
    this.lastActivityAt = Date.now();
    if (this.status === 'RUNNING' && this.loop && !this.loop.active) {
      this.loop.start();
    }
    if (this.world) {
      this.world.maintainAIs(this.humanCount);
    }
  }

  public removeHuman(playerId: string): void {
    this.humanPlayers.delete(playerId);
    this.lastActivityAt = Date.now();
  }

  public hasHuman(playerId: string): boolean {
    return this.humanPlayers.has(playerId);
  }

  public getHumanPlayerIds(): string[] {
    return Array.from(this.humanPlayers);
  }

  public startEmptyGrace(onExpired: () => void, durationMs = ROOM_EMPTY_GRACE_MS): void {
    if (this.emptyGraceTimer) {
      clearTimeout(this.emptyGraceTimer);
      this.emptyGraceTimer = null;
    }
    this.status = 'EMPTY_GRACE';

    // Interrompe o GameLoop durante EMPTY_GRACE para ZERO consumo de CPU
    if (this.loop) {
      try {
        this.loop.stop();
      } catch {
        // Ignora erros com segurança
      }
    }

    this.emptyGraceTimer = setTimeout(() => {
      this.emptyGraceTimer = null;
      onExpired();
    }, durationMs);
  }

  public cancelEmptyGrace(): void {
    if (this.emptyGraceTimer) {
      clearTimeout(this.emptyGraceTimer);
      this.emptyGraceTimer = null;
    }
    if (this.status === 'EMPTY_GRACE') {
      this.status = 'RUNNING';
      if (this.loop && !this.loop.active) {
        this.loop.start();
      }
    }
  }

  public get humanCount(): number {
    return this.humanPlayers.size;
  }

  public get availableSlots(): number {
    return Math.max(0, GAME_MAX_PLAYERS - this.humanCount);
  }

  /**
   * Retorna métricas observacionais da sala em tempo real.
   */
  public getStats(): RoomStats {
    const now = Date.now();
    const botCount = this.world
      ? this.world.getBotCount()
      : this.botPlayers;

    return {
      roomId: this.roomId,
      configKey: this.configKey,
      status: this.status,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      humanPlayers: this.humanCount,
      botPlayers: botCount,
      availableSlots: this.availableSlots,
      uptime: Math.floor((now - this.createdAt) / 1000),
    };
  }
}
