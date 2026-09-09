import { v4 as uuidv4 } from 'uuid';
import { Room, RoomConfig } from './Room';
import { SpecialItemType } from '../shared/types';

export const DEFAULT_MAX_ROOMS = 32;

export function parseMaxRooms(envVal?: string): number {
  if (!envVal) return DEFAULT_MAX_ROOMS;
  const parsed = Number(envVal);
  if (isNaN(parsed) || !isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_ROOMS;
  }
  return Math.floor(parsed);
}

export interface RoomManagerStats {
  activeRooms: number;
  activeHumans: number;
  activeBots: number;
  totalRoomsCreated: number;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private totalRoomsCreated = 0;
  private maxRooms: number;

  constructor(maxRooms?: number) {
    if (typeof maxRooms === 'number' && isFinite(maxRooms) && maxRooms > 0) {
      this.maxRooms = Math.floor(maxRooms);
    } else {
      this.maxRooms = parseMaxRooms(process.env.MAX_ROOMS);
    }
  }

  public getMaxRooms(): number {
    return this.maxRooms;
  }

  public setMaxRooms(limit: number): void {
    if (isFinite(limit) && limit > 0) {
      this.maxRooms = Math.floor(limit);
    }
  }

  public get activeRoomCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) {
      if (room.status !== 'STOPPED') {
        count++;
      }
    }
    return count;
  }

  public canCreateRoom(): boolean {
    return this.activeRoomCount < this.maxRooms;
  }

  /**
   * Obtém uma Room existente pelo seu ID.
   */
  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Lista todas as Rooms gerenciadas no momento.
   */
  public getRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Localiza todas as Rooms associadas a uma configKey específica.
   */
  public getRoomsByConfig(configKey: string): Room[] {
    const result: Room[] = [];
    for (const room of this.rooms.values()) {
      if (room.configKey === configKey) {
        result.push(room);
      }
    }
    return result;
  }

  /**
   * Cria e registra uma nova Room na memória se não atingir MAX_ROOMS.
   * Retorna null caso o limite global de Rooms tenha sido alcançado.
   */
  public createRoom(config: {
    configKey: string;
    enabledItems?: Record<SpecialItemType, boolean>;
    roomId?: string;
  }): Room | null {
    if (!this.canCreateRoom()) {
      return null;
    }

    const roomId = config.roomId || `room_${uuidv4().substring(0, 8)}`;
    const roomConfig: RoomConfig = {
      roomId,
      configKey: config.configKey,
      enabledItems: config.enabledItems,
    };

    const room = new Room(roomConfig);
    room.onShutdownCallback = (id) => {
      this.rooms.delete(id);
    };
    this.rooms.set(roomId, room);
    this.totalRoomsCreated++;
    return room;
  }

  /**
   * Remove uma Room e executa seu shutdown idempotente.
   */
  public removeRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    this.rooms.delete(roomId);
    room.shutdown();
    return true;
  }

  /**
   * Obtém uma Room ativa com slots disponíveis para a dada configKey,
   * ou cria uma nova se nenhuma estiver disponível e o limite não tiver sido atingido.
   */
  public getOrCreateRoom(
    configKey: string,
    enabledItems?: Record<SpecialItemType, boolean>
  ): Room | null {
    const candidates = this.getRoomsByConfig(configKey);
    for (const room of candidates) {
      if (room.status !== 'STOPPED' && room.status !== 'STOPPING' && room.availableSlots > 0) {
        return room;
      }
    }
    return this.createRoom({ configKey, enabledItems });
  }

  /**
   * Retorna métricas observacionais consolidadas de todas as Rooms em memória.
   */
  public getStats(): RoomManagerStats {
    let activeHumans = 0;
    let activeBots = 0;
    let activeRooms = 0;

    for (const room of this.rooms.values()) {
      if (room.status !== 'STOPPED' && room.status !== 'STOPPING') {
        activeRooms++;
        activeHumans += room.humanCount;
        activeBots += room.getStats().botPlayers;
      }
    }

    return {
      activeRooms,
      activeHumans,
      activeBots,
      totalRoomsCreated: this.totalRoomsCreated,
    };
  }

  /**
   * Limpa todas as Rooms (para testes e encerramento seguro).
   */
  public clear(): void {
    for (const room of this.rooms.values()) {
      room.shutdown();
    }
    this.rooms.clear();
  }
}
