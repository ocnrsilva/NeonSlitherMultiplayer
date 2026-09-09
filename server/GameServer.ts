import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import {
  SOCKET_EVENTS,
  GameJoinPayload,
  PlayerInputPayload,
  GameInitPayload,
  GameStateSnapshotPayload,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  PlayerDeathPayload,
} from '../shared/events';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  GAME_TICK_RATE,
  SNAPSHOT_RATE,
  RECONNECTION_GRACE_MS,
  MAX_INPUT_RATE_PER_SEC,
} from '../shared/constants';
import { SpecialItemType } from '../shared/types';
import { Room, generateConfigKey, DEFAULT_ENABLED_ITEMS } from './Room';
import { RoomManager } from './RoomManager';
import { PlayerEntity } from './Player';
import { cacheGet, cacheSet, cacheDel } from './redis/redisClient';
import { recordMatchCompletion } from './db/prisma';

export interface ClientSession {
  sessionId: string;
  playerId: string;
  socketId: string;
  nickname: string;
  roomId?: string;
  connected: boolean;
  disconnectTimer?: NodeJS.Timeout;
  inputCountThisSec: number;
  lastInputSecReset: number;
  lastRespawnAt?: number;
}

export class GameServer {
  private io: Server;
  private roomManager: RoomManager;
  private sessions = new Map<string, ClientSession>(); // sessionId -> ClientSession
  private socketToSession = new Map<string, string>(); // socketId -> sessionId

  constructor(io: Server) {
    this.io = io;
    this.roomManager = new RoomManager();
    this.setupSocketEvents();
  }

  /**
   * Obtém a instância de RoomManager para testes e observabilidade.
   */
  public getRoomManager(): RoomManager {
    return this.roomManager;
  }

  /**
   * Obtém o mapa de sessões ativas para testes e observabilidade.
   */
  public getSessions(): Map<string, ClientSession> {
    return this.sessions;
  }

  public start(): void {
    // Rooms iniciam seus loops sob demanda quando jogadores entram.
    console.log('[GameServer] GameServer iniciado com arquitetura isolada RoomManager.');
  }

  public stop(): void {
    for (const session of this.sessions.values()) {
      if (session.disconnectTimer) {
        clearTimeout(session.disconnectTimer);
        session.disconnectTimer = undefined;
      }
    }
    this.roomManager.clear();
    this.sessions.clear();
    this.socketToSession.clear();
  }

  private setupRoomCallbacks(room: Room): void {
    room.onTickCallback = (deadPlayers, dt, now) => {
      this.onRoomTick(room, deadPlayers, dt, now);
    };

    room.onSnapshotCallback = (now) => {
      this.onRoomSnapshot(room, now);
    };
  }

  public getOrCreateRoomForPlayer(
    configKey: string,
    enabledItems: Record<SpecialItemType, boolean>
  ): Room | null {
    const candidates = this.roomManager.getRoomsByConfig(configKey);
    for (const r of candidates) {
      if (r.status !== 'STOPPED' && r.status !== 'STOPPING' && r.availableSlots > 0) {
        return r;
      }
    }

    const room = this.roomManager.createRoom({ configKey, enabledItems });
    if (!room) {
      return null;
    }
    this.setupRoomCallbacks(room);
    return room;
  }

  private setupSocketEvents(): void {
    this.io.on('connection', (socket: Socket) => {
      // Handle join
      socket.on(SOCKET_EVENTS.GAME_JOIN, async (rawPayload: unknown) => {
        try {
          const payload = this.validateJoinPayload(rawPayload);
          await this.handleJoin(socket, payload);
        } catch (err: any) {
          socket.emit(SOCKET_EVENTS.GAME_ERROR, {
            code: 'INVALID_JOIN_PAYLOAD',
            message: err.message || 'Dados de entrada inválidos',
          });
        }
      });

      // Handle player input
      socket.on(SOCKET_EVENTS.PLAYER_INPUT, (rawPayload: unknown) => {
        try {
          const sessionId = this.socketToSession.get(socket.id);
          if (!sessionId) return;

          const session = this.sessions.get(sessionId);
          if (!session || !session.roomId) return;

          // Rate limit inputs (max 35 per second)
          const now = Date.now();
          if (now - session.lastInputSecReset > 1000) {
            session.lastInputSecReset = now;
            session.inputCountThisSec = 0;
          }
          session.inputCountThisSec++;
          if (session.inputCountThisSec > MAX_INPUT_RATE_PER_SEC) {
            return; // Throttle excessive packets
          }

          const payload = this.validateInputPayload(rawPayload);
          const room = this.roomManager.getRoom(session.roomId);
          if (room && room.world) {
            const player = room.world.getPlayer(session.playerId);
            if (player) {
              player.queueInput(payload.sequence, payload.direction, payload.boost);
            }
          }
        } catch {
          // Ignore malformed input packets safely
        }
      });

      // Handle respawn
      socket.on(SOCKET_EVENTS.PLAYER_RESPAWN, async (rawPayload: unknown) => {
        try {
          const sessionId = this.socketToSession.get(socket.id);
          if (!sessionId) return;
          const session = this.sessions.get(sessionId);
          if (!session) return;

          await this.handleRespawn(socket, session, rawPayload);
        } catch (err: any) {
          socket.emit(SOCKET_EVENTS.GAME_ERROR, {
            code: 'RESPAWN_FAILED',
            message: err.message || 'Falha ao renascer',
          });
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private sanitizeNickname(rawName: unknown): string {
    if (typeof rawName !== 'string') return 'Player' + Math.floor(Math.random() * 1000);
    // Remove control characters (including \n, \r, \t, \0) and HTML tags, then trim and limit length to 15
    const withoutControl = rawName.replace(/[\x00-\x1F\x7F]/g, '');
    const clean = withoutControl.replace(/<[^>]*>?/gm, '').trim().substring(0, 15);
    return clean.length > 0 ? clean : 'Player' + Math.floor(Math.random() * 1000);
  }

  private validateJoinPayload(raw: any): GameJoinPayload {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Payload deve ser um objeto');
    }
    const name = this.sanitizeNickname(raw.name);

    // Validate loadout if provided
    let loadout: any = undefined;
    if (raw.loadout && typeof raw.loadout === 'object' && raw.loadout.enabledItems && typeof raw.loadout.enabledItems === 'object') {
      const validKeys: SpecialItemType[] = ['SIZE', 'SPEED', 'ANGEL', 'MAGNET', 'SCOUTER', 'SLICER', 'USURPER', 'STALKER'];
      const sanitizedEnabled: Record<SpecialItemType, boolean> = {
        SIZE: true,
        SPEED: true,
        MAGNET: true,
        SCOUTER: true,
        ANGEL: false,
        SLICER: false,
        USURPER: false,
        STALKER: false,
      };
      for (const k of validKeys) {
        if (typeof raw.loadout.enabledItems[k] === 'boolean') {
          sanitizedEnabled[k] = raw.loadout.enabledItems[k];
        }
      }
      loadout = { enabledItems: sanitizedEnabled };
    }

    const sessionToken = typeof raw.sessionToken === 'string' && raw.sessionToken.length > 5 ? raw.sessionToken : undefined;

    return { name, loadout, sessionToken };
  }

  private validateInputPayload(raw: any): PlayerInputPayload {
    if (!raw || typeof raw !== 'object') throw new Error('Input inválido');
    const sequence = typeof raw.sequence === 'number' ? raw.sequence : 0;
    const direction = typeof raw.direction === 'number' && !isNaN(raw.direction) ? raw.direction : 0;
    const boost = Boolean(raw.boost);
    return { sequence, direction, boost };
  }

  public async handleJoin(socket: Socket, payload: GameJoinPayload): Promise<void> {
    let session: ClientSession | undefined;
    let room: Room | undefined;

    const validKeys: SpecialItemType[] = ['SIZE', 'SPEED', 'ANGEL', 'MAGNET', 'SCOUTER', 'SLICER', 'USURPER', 'STALKER'];
    const sanitizedEnabled: Record<SpecialItemType, boolean> = {
      ...DEFAULT_ENABLED_ITEMS,
    };
    if (payload.loadout?.enabledItems) {
      for (const k of validKeys) {
        if (typeof payload.loadout.enabledItems[k] === 'boolean') {
          sanitizedEnabled[k] = payload.loadout.enabledItems[k];
        }
      }
    }
    const configKey = generateConfigKey(sanitizedEnabled);

    // 1. Check reconnection with existing session token
    if (payload.sessionToken) {
      let existing = this.sessions.get(payload.sessionToken);

      // If not in local server memory, query Redis for session state
      if (!existing) {
        try {
          const cachedJson = await cacheGet(`session:${payload.sessionToken}`);
          if (cachedJson) {
            const data = JSON.parse(cachedJson);
            if (data && data.playerId) {
              existing = {
                sessionId: payload.sessionToken,
                playerId: data.playerId,
                socketId: socket.id,
                nickname: data.nickname || payload.name,
                roomId: data.roomId,
                connected: true,
                inputCountThisSec: 0,
                lastInputSecReset: Date.now(),
              };
              this.sessions.set(payload.sessionToken, existing);
            }
          }
        } catch (err) {
          console.warn('[GameServer] Failed to query Redis session:', err);
        }
      }

      if (existing) {
        session = existing;
        if (session.disconnectTimer) {
          clearTimeout(session.disconnectTimer);
          session.disconnectTimer = undefined;
        }
        session.connected = true;
        session.socketId = socket.id;
        this.socketToSession.set(socket.id, session.sessionId);

        // Check if existing room is still valid and has the matching config
        if (session.roomId) {
          const existingRoom = this.roomManager.getRoom(session.roomId);
          if (
            existingRoom &&
            existingRoom.status !== 'STOPPED' &&
            existingRoom.status !== 'STOPPING' &&
            existingRoom.configKey === configKey
          ) {
            room = existingRoom;
          }
        }
      }
    }

    // 2. If room not found from valid reconnect, assign or create room for this configKey
    if (!room) {
      const assignedRoom = this.getOrCreateRoomForPlayer(configKey, sanitizedEnabled);
      if (!assignedRoom) {
        socket.emit(SOCKET_EVENTS.GAME_ERROR, {
          code: 'ROOM_LIMIT_REACHED',
          message: 'Servidor temporariamente lotado. Tente novamente em instantes.',
        });
        return;
      }
      room = assignedRoom;
    }

    // 3. Create new session if not reconnecting
    if (!session) {
      const sessionId = crypto.randomBytes(24).toString('hex');
      const playerId = `p_${crypto.randomBytes(6).toString('hex')}`;
      session = {
        sessionId,
        playerId,
        socketId: socket.id,
        nickname: payload.name,
        connected: true,
        inputCountThisSec: 0,
        lastInputSecReset: Date.now(),
      };

      this.sessions.set(sessionId, session);
      this.socketToSession.set(socket.id, sessionId);
    }

    // Bind room to session
    session.roomId = room.roomId;

    // Cache session in Redis with 30 minutes TTL
    await cacheSet(
      `session:${session.sessionId}`,
      JSON.stringify({
        playerId: session.playerId,
        nickname: session.nickname,
        roomId: room.roomId,
        createdAt: Date.now(),
      }),
      1800
    );

    // Cancel empty grace if room was pending termination
    room.cancelEmptyGrace();

    // Start room loop when human player enters
    if (room.status !== 'RUNNING') {
      room.start();
    }

    // Join socket to Socket.IO native room
    socket.join(room.roomId);

    // Register human in room
    room.addHuman(session.playerId);

    // Check if player snake already exists in the room's world
    const world = room.world!;
    const spawnSystem = room.spawnSystem!;
    let player = world.getPlayer(session.playerId);

    if (!player || player.data.length <= 0) {
      const spawn = spawnSystem.findSafeSpawn(Array.from(world.players.values()));
      const color = spawnSystem.getRandomColor();
      player = new PlayerEntity(
        session.playerId,
        session.nickname,
        color,
        spawn.x,
        spawn.y,
        true,
        payload.loadout,
        session.sessionId
      );
      world.addPlayer(player);
    } else if (payload.loadout) {
      player.data.loadout = payload.loadout;
    }

    // Send init to client with roomId
    const initPayload: GameInitPayload = {
      playerId: player.data.id,
      sessionToken: session.sessionId,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      tickRate: GAME_TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      color: player.data.color,
      roomId: room.roomId,
    };
    socket.emit(SOCKET_EVENTS.GAME_INIT, initPayload);

    // Notify other players in the same Room only
    const joinedPayload: PlayerJoinedPayload = {
      id: player.data.id,
      name: player.data.name,
    };
    socket.to(room.roomId).emit(SOCKET_EVENTS.PLAYER_JOINED, joinedPayload);
  }

  public async handleRespawn(socket: Socket, session: ClientSession, rawPayload: any): Promise<void> {
    const now = Date.now();
    if (session.lastRespawnAt && now - session.lastRespawnAt < 500) {
      return; // Cooldown ativo: ignora flood de respawn
    }
    session.lastRespawnAt = now;

    const payload = this.validateJoinPayload(rawPayload);
    session.nickname = payload.name;

    let room = session.roomId ? this.roomManager.getRoom(session.roomId) : undefined;
    if (!room || room.status === 'STOPPED' || room.status === 'STOPPING') {
      // Room foi destruída; ingressa em uma nova Room apropriada
      await this.handleJoin(socket, payload);
      return;
    }

    const spawn = room.spawnSystem!.findSafeSpawn(Array.from(room.world!.players.values()));
    const color = room.spawnSystem!.getRandomColor();

    const player = new PlayerEntity(
      session.playerId,
      session.nickname,
      color,
      spawn.x,
      spawn.y,
      true,
      payload.loadout,
      session.sessionId
    );
    room.world!.addPlayer(player);

    const initPayload: GameInitPayload = {
      playerId: player.data.id,
      sessionToken: session.sessionId,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      tickRate: GAME_TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      color: player.data.color,
      roomId: room.roomId,
    };
    socket.emit(SOCKET_EVENTS.GAME_INIT, initPayload);
  }

  public handleDisconnect(socket: Socket): void {
    const sessionId = this.socketToSession.get(socket.id);
    if (!sessionId) return;

    this.socketToSession.delete(socket.id);
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.connected = false;
    console.log(`[GameServer] Player disconnected (grace period started): ${session.nickname}`);

    // Allow 30 seconds reconnection grace period
    session.disconnectTimer = setTimeout(async () => {
      if (!session.connected) {
        console.log(`[GameServer] Player expired after grace period: ${session.nickname}`);
        const roomId = session.roomId;
        if (roomId) {
          const room = this.roomManager.getRoom(roomId);
          if (room && room.world) {
            room.world.removePlayer(session.playerId);
            room.removeHuman(session.playerId);

            // Emite PLAYER_LEFT somente para os membros daquela Room
            const leftPayload: PlayerLeftPayload = { id: session.playerId };
            this.io.to(room.roomId).emit(SOCKET_EVENTS.PLAYER_LEFT, leftPayload);

            // Se o último humano saiu, inicia EMPTY_GRACE na Room
            if (room.humanCount === 0) {
              room.startEmptyGrace(() => {
                if (room.humanCount === 0) {
                  console.log(`[GameServer] Room ${room.roomId} expirou após EMPTY_GRACE. Executando shutdown.`);
                  room.shutdown();
                  this.roomManager.removeRoom(room.roomId);
                }
              });
            }
          }
        }

        this.sessions.delete(sessionId);
        await cacheDel(`session:${sessionId}`);
      }
    }, RECONNECTION_GRACE_MS);
  }

  private onRoomTick(room: Room, deadPlayers: any[], _dt: number, now: number): void {
    // Emit death events and save to DB
    for (const dead of deadPlayers) {
      if (dead.player.data.isPlayer) {
        const session = this.sessions.get(dead.player.data.sessionId || '');
        if (session && session.connected) {
          const socket = this.io.sockets.sockets.get(session.socketId);
          if (socket) {
            const deathPayload: PlayerDeathPayload = {
              score: Math.floor(dead.player.data.score),
              killerId: dead.killerId,
              reason: dead.reason,
            };
            socket.emit(SOCKET_EVENTS.PLAYER_DEATH, deathPayload);
          }
        }

        // Persist score to database asynchronously
        recordMatchCompletion({
          serverName: process.env.GAME_SERVER_NAME || 'neon-slither-01',
          nickname: dead.player.data.name,
          finalScore: Math.floor(dead.player.data.score),
          durationSec: Math.max(1, Math.floor((now - dead.player.data.invincibilityEndTime) / 1000)),
          loadoutUsed: dead.player.data.loadout,
        }).catch(() => {});
      }
    }
  }

  private onRoomSnapshot(room: Room, now: number): void {
    if (!room.world) return;
    room.sequence++;

    const world = room.world;
    const leaderboard = world.getLeaderboard();

    // Extrai snapshots apenas do World da Room
    const snakeSnapshots = Array.from(world.players.values()).map((p) => p.toSnapshot());
    const specialItemSnapshots = world.specialItems.map((item) => ({
      id: item.id,
      x: Math.round(item.x),
      y: Math.round(item.y),
      type: item.type,
      isAvailable: item.isAvailable,
    }));
    const knifeSnapshots = world.knives.map((k) => ({
      id: k.id,
      x: Math.round(k.x),
      y: Math.round(k.y),
      angle: Number(k.angle.toFixed(2)),
      ownerId: k.ownerId,
    }));

    // Envia snapshot direcionado exclusivamente para jogadores conectados a esta Room
    for (const session of this.sessions.values()) {
      if (session.roomId !== room.roomId || !session.connected) continue;
      const socket = this.io.sockets.sockets.get(session.socketId);
      if (!socket) continue;

      const playerEntity = world.getPlayer(session.playerId);
      const playerSnapshot = playerEntity ? playerEntity.toSnapshot() : null;

      // Area-of-interest for food: 4500px around head
      let foods = world.foodSystem.getAll().slice(0, 500).map((f) => ({
        x: Math.round(f.x),
        y: Math.round(f.y),
        size: f.size,
        color: f.color,
        value: f.value,
      }));

      if (playerEntity && playerEntity.data.segments[0]) {
        const head = playerEntity.data.segments[0];
        const aoi = 4500;
        foods = world.foodSystem.getSnapshotsInArea(
          head.x - aoi,
          head.y - aoi,
          head.x + aoi,
          head.y + aoi,
          head.x,
          head.y,
          2000
        );
      }

      const payload: GameStateSnapshotPayload = {
        sequence: room.sequence,
        timestamp: now,
        roomId: room.roomId,
        player: playerSnapshot,
        snakes: snakeSnapshots,
        foods,
        specialItems: specialItemSnapshots,
        knives: knifeSnapshots,
        leaderboard,
      };

      socket.emit(SOCKET_EVENTS.GAME_STATE, payload);
    }
  }
}
