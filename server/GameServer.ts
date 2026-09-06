import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  SOCKET_EVENTS,
  GameJoinPayload,
  PlayerInputPayload,
  PlayerRespawnPayload,
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
import { World } from './World';
import { GameLoop } from './GameLoop';
import { PlayerEntity } from './Player';
import { SpawnSystem } from './SpawnSystem';
import { cacheGet, cacheSet, cacheDel } from './redis/redisClient';
import { recordMatchCompletion } from './db/prisma';

interface ClientSession {
  sessionId: string;
  playerId: string;
  socketId: string;
  nickname: string;
  connected: boolean;
  disconnectTimer?: NodeJS.Timeout;
  inputCountThisSec: number;
  lastInputSecReset: number;
}

export class GameServer {
  private io: Server;
  private world: World;
  private loop: GameLoop;
  private spawnSystem: SpawnSystem;
  private sessions = new Map<string, ClientSession>(); // sessionId -> ClientSession
  private socketToSession = new Map<string, string>(); // socketId -> sessionId
  private serverSequence = 0;

  constructor(io: Server) {
    this.io = io;
    this.world = new World();
    this.spawnSystem = new SpawnSystem();

    // Setup centralized game loop
    this.loop = new GameLoop(
      (dt, now) => this.onTick(dt, now),
      (now) => this.onSnapshot(now)
    );

    this.setupSocketEvents();
  }

  public start(): void {
    this.loop.start();
  }

  public stop(): void {
    this.loop.stop();
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
          if (!session) return;

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
          const player = this.world.getPlayer(session.playerId);
          if (player) {
            player.queueInput(payload.sequence, payload.direction, payload.boost);
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
    // Remove HTML tags and special characters, limit length to 15
    const clean = rawName.replace(/<[^>]*>?/gm, '').trim().substring(0, 15);
    return clean.length > 0 ? clean : 'Player' + Math.floor(Math.random() * 1000);
  }

  private validateJoinPayload(raw: any): GameJoinPayload {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Payload deve ser um objeto');
    }
    const name = this.sanitizeNickname(raw.name);

    // Validate loadout if provided
    let loadout: any = undefined;
    if (raw.loadout && typeof raw.loadout.enabledItems === 'object') {
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

  private async handleJoin(socket: Socket, payload: GameJoinPayload): Promise<void> {
    let session: ClientSession | undefined;

    // Check reconnection with existing session token
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
        console.log(`[GameServer] Player reconnected successfully: ${session.nickname} (${session.playerId})`);
      }
    }

    // Create new session if not reconnecting
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

      // Cache session in Redis with 30 minutes TTL
      await cacheSet(
        `session:${sessionId}`,
        JSON.stringify({ playerId, nickname: payload.name, createdAt: Date.now() }),
        1800
      );
    }

    // Check if player snake already exists in the world
    let player = this.world.getPlayer(session.playerId);
    if (!player) {
      const spawn = this.spawnSystem.findSafeSpawn(Array.from(this.world.players.values()));
      const color = this.spawnSystem.getRandomColor();
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
      this.world.addPlayer(player);
    }

    // Send init to client
    const initPayload: GameInitPayload = {
      playerId: player.data.id,
      sessionToken: session.sessionId,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      tickRate: GAME_TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      color: player.data.color,
    };
    socket.emit(SOCKET_EVENTS.GAME_INIT, initPayload);

    // Notify other players
    const joinedPayload: PlayerJoinedPayload = {
      id: player.data.id,
      name: player.data.name,
    };
    socket.broadcast.emit(SOCKET_EVENTS.PLAYER_JOINED, joinedPayload);
  }

  private async handleRespawn(socket: Socket, session: ClientSession, rawPayload: any): Promise<void> {
    const payload = this.validateJoinPayload(rawPayload);
    session.nickname = payload.name;

    const spawn = this.spawnSystem.findSafeSpawn(Array.from(this.world.players.values()));
    const color = this.spawnSystem.getRandomColor();

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
    this.world.addPlayer(player);

    const initPayload: GameInitPayload = {
      playerId: player.data.id,
      sessionToken: session.sessionId,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      tickRate: GAME_TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      color: player.data.color,
    };
    socket.emit(SOCKET_EVENTS.GAME_INIT, initPayload);
  }

  private handleDisconnect(socket: Socket): void {
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
        this.world.removePlayer(session.playerId);
        this.sessions.delete(sessionId);
        await cacheDel(`session:${sessionId}`);

        const leftPayload: PlayerLeftPayload = { id: session.playerId };
        this.io.emit(SOCKET_EVENTS.PLAYER_LEFT, leftPayload);
      }
    }, RECONNECTION_GRACE_MS);
  }

  private onTick(dt: number, now: number): void {
    const { deadPlayers } = this.world.update(dt, now);

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

  private onSnapshot(now: number): void {
    this.serverSequence++;
    const leaderboard = this.world.getLeaderboard();

    // Pre-extract all snake snapshots
    const snakeSnapshots = Array.from(this.world.players.values()).map((p) => p.toSnapshot());
    const specialItemSnapshots = this.world.specialItems.map((item) => ({
      id: item.id,
      x: Math.round(item.x),
      y: Math.round(item.y),
      type: item.type,
      isAvailable: item.isAvailable,
    }));
    const knifeSnapshots = this.world.knives.map((k) => ({
      id: k.id,
      x: Math.round(k.x),
      y: Math.round(k.y),
      angle: Number(k.angle.toFixed(2)),
      ownerId: k.ownerId,
    }));

    // Send optimized viewport/nearby food for each connected player
    for (const session of this.sessions.values()) {
      if (!session.connected) continue;
      const socket = this.io.sockets.sockets.get(session.socketId);
      if (!socket) continue;

      const playerEntity = this.world.getPlayer(session.playerId);
      const playerSnapshot = playerEntity ? playerEntity.toSnapshot() : null;

      // Area-of-interest for food: 1800px around head
      let foods = this.world.foodSystem.getAll().slice(0, 150).map((f) => ({
        x: Math.round(f.x),
        y: Math.round(f.y),
        size: f.size,
        color: f.color,
        value: f.value,
      }));

      if (playerEntity && playerEntity.data.segments[0]) {
        const head = playerEntity.data.segments[0];
        const aoi = 1600;
        foods = this.world.foodSystem.getSnapshotsInArea(
          head.x - aoi,
          head.y - aoi,
          head.x + aoi,
          head.y + aoi,
          180
        );
      }

      const payload: GameStateSnapshotPayload = {
        sequence: this.serverSequence,
        timestamp: now,
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
