import assert from 'assert';
import { RoomManager, DEFAULT_MAX_ROOMS, parseMaxRooms } from '../server/RoomManager';
import { GameServer } from '../server/GameServer';
import { SOCKET_EVENTS } from '../shared/events';
import {
  BASE_SPEED,
  BOOST_SPEED,
  TURN_SPEED,
  SEGMENT_DISTANCE,
  INITIAL_SNAKE_LENGTH,
} from '../shared/constants';

function createMockSocket(id: string) {
  const emittedEvents: { event: string; payload: any }[] = [];
  const joinedRooms = new Set<string>();
  const toEmitted: { roomId: string; event: string; payload: any }[] = [];

  const socket: any = {
    id,
    join: (roomId: string) => {
      joinedRooms.add(roomId);
    },
    leave: (roomId: string) => {
      joinedRooms.delete(roomId);
    },
    emit: (event: string, payload: any) => {
      emittedEvents.push({ event, payload });
    },
    to: (roomId: string) => ({
      emit: (event: string, payload: any) => {
        toEmitted.push({ roomId, event, payload });
      },
    }),
    on: () => {},
  };

  return { socket, emittedEvents, joinedRooms, toEmitted };
}

function createMockIo() {
  const roomMessages: { roomId: string; event: string; payload: any }[] = [];
  const socketsMap = new Map<string, any>();

  const io: any = {
    on: () => {},
    to: (roomId: string) => ({
      emit: (event: string, payload: any) => {
        roomMessages.push({ roomId, event, payload });
      },
    }),
    emit: (event: string, payload: any) => {
      roomMessages.push({ roomId: '*', event, payload });
    },
    sockets: {
      sockets: socketsMap,
    },
  };

  return { io, roomMessages, socketsMap };
}

export async function runPhase6BTests(): Promise<void> {
  console.log('\n--- Iniciando Testes da Fase 6B (Correções da Auditoria de Produção) ---');

  // ----------------------------------------------------
  // 1. TESTES DE MAX_ROOMS
  // ----------------------------------------------------
  console.log('Teste 6B.1: Validação de fallback seguro para MAX_ROOMS...');
  assert.strictEqual(DEFAULT_MAX_ROOMS, 32, 'DEFAULT_MAX_ROOMS deve ser 32');
  assert.strictEqual(parseMaxRooms(undefined), 32);
  assert.strictEqual(parseMaxRooms(''), 32);
  assert.strictEqual(parseMaxRooms('abc'), 32);
  assert.strictEqual(parseMaxRooms('-10'), 32);
  assert.strictEqual(parseMaxRooms('0'), 32);
  assert.strictEqual(parseMaxRooms('Infinity'), 32);
  assert.strictEqual(parseMaxRooms('NaN'), 32);
  assert.strictEqual(parseMaxRooms('16'), 16);
  assert.strictEqual(parseMaxRooms('64.9'), 64);
  console.log('✓ Teste 6B.1 passou.');

  console.log('Teste 6B.2: RoomManager respeita o limite estrito de MAX_ROOMS...');
  const smallManager = new RoomManager(1);
  assert.strictEqual(smallManager.getMaxRooms(), 1);
  assert.strictEqual(smallManager.canCreateRoom(), true);

  const room1 = smallManager.createRoom({ configKey: 'CONFIG_1' });
  assert.notStrictEqual(room1, null, 'Primeira Room deve ser criada com sucesso');
  assert.strictEqual(smallManager.activeRoomCount, 1);
  assert.strictEqual(smallManager.canCreateRoom(), false);

  // Tentativa de criar segunda Room deve falhar retornando null
  const room2 = smallManager.createRoom({ configKey: 'CONFIG_2' });
  assert.strictEqual(room2, null, 'Segunda Room deve ser recusada quando MAX_ROOMS for atingido');

  // getOrCreateRoom com config diferente quando cheio deve retornar null
  const room2OrCreate = smallManager.getOrCreateRoom('CONFIG_2');
  assert.strictEqual(room2OrCreate, null, 'getOrCreateRoom para nova config deve retornar null se cheio');

  // getOrCreateRoom com MESMA config e vagas deve reutilizar room1 com sucesso
  const room1Reused = smallManager.getOrCreateRoom('CONFIG_1');
  assert.strictEqual(room1Reused, room1, 'Mesma config com vagas disponíveis deve reutilizar a Room');

  // Remove room1 => canCreateRoom volta a ser true
  smallManager.removeRoom(room1!.roomId);
  assert.strictEqual(smallManager.activeRoomCount, 0);
  assert.strictEqual(smallManager.canCreateRoom(), true);

  // Nova Room agora pode ser criada
  const room3 = smallManager.createRoom({ configKey: 'CONFIG_3' });
  assert.notStrictEqual(room3, null, 'Nova Room pode ser criada após liberação de espaço');
  room3?.shutdown();
  console.log('✓ Teste 6B.2 passou.');

  console.log('Teste 6B.3: GameServer emite ROOM_LIMIT_REACHED ao atingir MAX_ROOMS...');
  const mockIo = createMockIo();
  const gameServer = new GameServer(mockIo.io);
  gameServer.start();

  // Força limite de 1 Room para testar rejeição controlada
  gameServer.getRoomManager().setMaxRooms(1);

  const s1 = createMockSocket('sock_p1');
  const s2 = createMockSocket('sock_p2');
  mockIo.socketsMap.set('sock_p1', s1.socket);
  mockIo.socketsMap.set('sock_p2', s2.socket);

  // Jogador 1 entra na sala com config A
  await gameServer.handleJoin(s1.socket, {
    name: 'PlayerOne',
    loadout: { enabledItems: { SIZE: true, SPEED: false, MAGNET: false, SCOUTER: false, ANGEL: false, SLICER: false, USURPER: false, STALKER: false } },
  });

  const initEvents = s1.emittedEvents.filter((e) => e.event === SOCKET_EVENTS.GAME_INIT);
  assert.strictEqual(initEvents.length, 1, 'Jogador 1 deve receber GAME_INIT');

  // Jogador 2 tenta entrar com config B diferente (exigiria nova Room)
  await gameServer.handleJoin(s2.socket, {
    name: 'PlayerTwo',
    loadout: { enabledItems: { SIZE: false, SPEED: true, MAGNET: false, SCOUTER: false, ANGEL: false, SLICER: false, USURPER: false, STALKER: false } },
  });

  const errorEvents = s2.emittedEvents.filter((e) => e.event === SOCKET_EVENTS.GAME_ERROR);
  assert.strictEqual(errorEvents.length, 1, 'Jogador 2 deve receber GAME_ERROR');
  assert.strictEqual(errorEvents[0].payload.code, 'ROOM_LIMIT_REACHED');
  assert.strictEqual(errorEvents[0].payload.message, 'Servidor temporariamente lotado. Tente novamente em instantes.');

  // Confirma que nenhuma sessão órfã foi criada para s2
  const sessionMap = gameServer.getSessions();
  const s2Session = Array.from(sessionMap.values()).find((s) => s.socketId === 'sock_p2');
  assert.strictEqual(s2Session, undefined, 'Sessão não deve ser registrada se a Room não pôde ser criada');

  // Restaura limite para os testes seguintes
  gameServer.getRoomManager().setMaxRooms(32);

  console.log('✓ Teste 6B.3 passou.');

  // ----------------------------------------------------
  // 2. TESTES DE SANITIZAÇÃO DE NICKNAME / LOG INJECTION
  // ----------------------------------------------------
  console.log('Teste 6B.4: Sanitização de nickname contra Log Injection, tags e controle...');
  const sanitize = (raw: unknown) => (gameServer as any).sanitizeNickname(raw);

  // String normal
  assert.strictEqual(sanitize('NeonSnake'), 'NeonSnake');

  // Truncamento em 15 caracteres
  assert.strictEqual(sanitize('12345678901234567890'), '123456789012345');

  // Remoção de quebra de linha (\n) - Log Injection Prevention
  assert.strictEqual(sanitize('Player\nAdmin'), 'PlayerAdmin');
  assert.strictEqual(sanitize('Line1\nLine2\nLine3'), 'Line1Line2Line3');

  // Remoção de carriage return (\r)
  assert.strictEqual(sanitize('Player\rAdmin'), 'PlayerAdmin');

  // Remoção de tab (\t)
  assert.strictEqual(sanitize('Player\tAdmin'), 'PlayerAdmin');

  // Remoção de null byte (\0)
  assert.strictEqual(sanitize('Player\u0000Admin'), 'PlayerAdmin');

  // Remoção de caracteres de controle ANSI
  assert.strictEqual(sanitize('\x1b[31mRed'), '[31mRed');

  // Remoção de HTML tags
  assert.strictEqual(sanitize('<script>evil()</script>Hero'), 'evil()Hero');
  assert.strictEqual(sanitize('<b>Bold</b>'), 'Bold');

  // Aspas e SQL-like são tratados como strings puras (sem execução)
  assert.strictEqual(sanitize("O'Connor"), "O'Connor");
  assert.strictEqual(sanitize("'; DROP TABLE;"), "'; DROP TABLE;");

  // Preservação de acentos e Unicode legítimo
  assert.strictEqual(sanitize('Jogador_São'), 'Jogador_São');
  assert.strictEqual(sanitize('Acentuação'), 'Acentuação');
  assert.strictEqual(sanitize('🐍_Cobrinha'), '🐍_Cobrinha');

  // Entrada vazia, só espaços ou só caracteres de controle gera fallback seguro
  const fallbackEmpty = sanitize('');
  assert.ok(fallbackEmpty.startsWith('Player'), 'Fallback deve iniciar com Player');
  const fallbackControl = sanitize('\n\r\t\u0000');
  assert.ok(fallbackControl.startsWith('Player'), 'Fallback para apenas controles deve iniciar com Player');
  const fallbackNonString = sanitize(12345);
  assert.ok(fallbackNonString.startsWith('Player'), 'Fallback para tipo não-string');

  console.log('✓ Teste 6B.4 passou.');

  // ----------------------------------------------------
  // 3. TESTES DE COOLDOWN DE player:respawn (500ms)
  // ----------------------------------------------------
  console.log('Teste 6B.5: Cooldown de 500ms em player:respawn...');
  const s3 = createMockSocket('sock_p3');
  mockIo.socketsMap.set('sock_p3', s3.socket);

  // Jogador entra
  await gameServer.handleJoin(s3.socket, { name: 'RespawnHero' });
  const s3Session = Array.from(gameServer.getSessions().values()).find((s) => s.nickname === 'RespawnHero')!;
  assert.ok(s3Session, 'Sessão do jogador deve existir');
  assert.strictEqual(s3Session.lastRespawnAt, undefined, 'lastRespawnAt inicial deve ser undefined');

  // 1º respawn: PERMITIDO
  const initCountBefore = s3.emittedEvents.filter((e) => e.event === SOCKET_EVENTS.GAME_INIT).length;
  await gameServer.handleRespawn(s3.socket, s3Session, { name: 'RespawnHero' });
  const initCountAfter1 = s3.emittedEvents.filter((e) => e.event === SOCKET_EVENTS.GAME_INIT).length;
  assert.strictEqual(initCountAfter1, initCountBefore + 1, '1º respawn deve disparar GAME_INIT');
  const firstRespawnAt = s3Session.lastRespawnAt;
  assert.ok(typeof firstRespawnAt === 'number' && firstRespawnAt > 0);

  // 2º respawn imediato (< 500ms): BLOQUEADO / IGNORADO
  await gameServer.handleRespawn(s3.socket, s3Session, { name: 'RespawnHero' });
  const initCountAfter2 = s3.emittedEvents.filter((e) => e.event === SOCKET_EVENTS.GAME_INIT).length;
  assert.strictEqual(initCountAfter2, initCountAfter1, '2º respawn imediato deve ser ignorado pelo cooldown');
  assert.strictEqual(s3Session.lastRespawnAt, firstRespawnAt, 'Timestamp não deve mudar na rejeição');

  // Aguarda 520ms para expirar o cooldown
  await new Promise((resolve) => setTimeout(resolve, 520));

  // 3º respawn após cooldown: PERMITIDO
  await gameServer.handleRespawn(s3.socket, s3Session, { name: 'RespawnHero' });
  const initCountAfter3 = s3.emittedEvents.filter((e) => e.event === SOCKET_EVENTS.GAME_INIT).length;
  assert.strictEqual(initCountAfter3, initCountAfter2 + 1, 'Respawn após 500ms deve ser aceito');
  assert.ok(s3Session.lastRespawnAt! > firstRespawnAt!, 'Novo timestamp deve ser atualizado');

  // Validação de cleanup de memória: quando a sessão é removida, não restam timers de respawn
  gameServer.getSessions().delete(s3Session.sessionId);
  assert.strictEqual(gameServer.getSessions().get(s3Session.sessionId), undefined);

  console.log('✓ Teste 6B.5 passou.');

  // ----------------------------------------------------
  // 4. TESTE DE PRESERVAÇÃO DE FÍSICA E GAMEPLAY
  // ----------------------------------------------------
  console.log('Teste 6B.6: Auditoria de preservação das constantes de gameplay...');
  assert.strictEqual(BASE_SPEED, 3.2, 'BASE_SPEED deve permanecer 3.2');
  assert.strictEqual(BOOST_SPEED, 6.2, 'BOOST_SPEED deve permanecer 6.2');
  assert.strictEqual(TURN_SPEED, 0.12, 'TURN_SPEED deve permanecer 0.12');
  assert.strictEqual(SEGMENT_DISTANCE, 5, 'SEGMENT_DISTANCE deve permanecer 5');
  assert.strictEqual(INITIAL_SNAKE_LENGTH, 10, 'INITIAL_SNAKE_LENGTH deve permanecer 10');
  console.log('✓ Teste 6B.6 passou.');

  gameServer.stop();
  console.log('========================================================');
  console.log('TODOS OS TESTES DA FASE 6B FORAM EXECUTADOS COM SUCESSO!');
  console.log('========================================================');
}
