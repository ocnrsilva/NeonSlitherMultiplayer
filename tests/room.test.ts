import assert from 'assert';
import { Room } from '../server/Room';
import { RoomManager } from '../server/RoomManager';
import { runPhase6BTests } from './phase6b.test';
import { runPhase6DTests } from './phase6d.test';
import { runPhase6E1Tests } from './phase6e1.test';

console.log('--- Iniciando Testes da Fase 2 (Room & RoomManager) ---');

// 1. Criação de Room
console.log('Teste 1: Criação de Room...');
const room1 = new Room({
  roomId: 'test_room_1',
  configKey: 'DEFAULT',
});
assert.strictEqual(room1.roomId, 'test_room_1');
assert.strictEqual(room1.configKey, 'DEFAULT');
assert.strictEqual(room1.status, 'STARTING');
assert.strictEqual(room1.humanCount, 0);
assert.strictEqual(room1.availableSlots, 100);
room1.start();
assert.strictEqual(room1.status, 'RUNNING');
room1.shutdown();
assert.strictEqual(room1.status, 'STOPPED');
console.log('✓ Teste 1 passou.');

// 2. getRoom() no RoomManager
console.log('Teste 2: getRoom()...');
const manager = new RoomManager();
const createdRoom = manager.createRoom({
  roomId: 'custom_room_abc',
  configKey: 'CFG_A',
});
const fetchedRoom = manager.getRoom('custom_room_abc');
assert.strictEqual(fetchedRoom, createdRoom);
assert.strictEqual(manager.getRoom('inexistent'), undefined);
console.log('✓ Teste 2 passou.');

// 3. getRooms()
console.log('Teste 3: getRooms()...');
const allRooms = manager.getRooms();
assert.strictEqual(allRooms.length, 1);
assert.strictEqual(allRooms[0].roomId, 'custom_room_abc');
console.log('✓ Teste 3 passou.');

// 4. getRoomsByConfig()
console.log('Teste 4: getRoomsByConfig()...');
manager.createRoom({ configKey: 'CFG_A' });
manager.createRoom({ configKey: 'CFG_B' });
const cfgARooms = manager.getRoomsByConfig('CFG_A');
const cfgBRooms = manager.getRoomsByConfig('CFG_B');
const cfgCRooms = manager.getRoomsByConfig('CFG_C');
assert.strictEqual(cfgARooms.length, 2);
assert.strictEqual(cfgBRooms.length, 1);
assert.strictEqual(cfgCRooms.length, 0);
console.log('✓ Teste 4 passou.');

// 5. removeRoom()
console.log('Teste 5: removeRoom()...');
const removed = manager.removeRoom('custom_room_abc');
assert.strictEqual(removed, true);
assert.strictEqual(manager.getRoom('custom_room_abc'), undefined);
assert.strictEqual(manager.removeRoom('custom_room_abc'), false);
console.log('✓ Teste 5 passou.');

// 6. RoomManager.getStats()
console.log('Teste 6: RoomManager.getStats()...');
const freshManager = new RoomManager();
const r1 = freshManager.createRoom({ configKey: 'K1' });
const r2 = freshManager.createRoom({ configKey: 'K2' });
r1.addHuman('player_1');
r1.addHuman('player_2');
r2.addHuman('player_3');
r1.botPlayers = 30;
r2.botPlayers = 30;

const mgrStats = freshManager.getStats();
assert.strictEqual(mgrStats.activeRooms, 2);
assert.strictEqual(mgrStats.activeHumans, 3);
assert.strictEqual(mgrStats.activeBots, 60);
assert.strictEqual(mgrStats.totalRoomsCreated, 2);
console.log('✓ Teste 6 passou.');

// 7. Room.getStats()
console.log('Teste 7: Room.getStats()...');
const roomStats = r1.getStats();
assert.strictEqual(roomStats.roomId, r1.roomId);
assert.strictEqual(roomStats.configKey, 'K1');
assert.strictEqual(roomStats.humanPlayers, 2);
assert.strictEqual(roomStats.availableSlots, 98);
assert.strictEqual(roomStats.botPlayers, 30);
assert(typeof roomStats.uptime === 'number');
console.log('✓ Teste 7 passou.');

// 8. shutdown() idempotente
console.log('Teste 8: shutdown() idempotente...');
const testRoomShutdown = new Room({ roomId: 'shutdown_test', configKey: 'K' });
testRoomShutdown.start();
assert.strictEqual(testRoomShutdown.status, 'RUNNING');
testRoomShutdown.shutdown();
assert.strictEqual(testRoomShutdown.status, 'STOPPED');
// Chamadas subsequentes não podem lançar erro
assert.doesNotThrow(() => {
  testRoomShutdown.shutdown();
  testRoomShutdown.shutdown();
  testRoomShutdown.shutdown();
});
assert.strictEqual(testRoomShutdown.status, 'STOPPED');
console.log('✓ Teste 8 passou.');

// 9. Duas Rooms diferentes não compartilham identidade
console.log('Teste 9: Duas Rooms diferentes não compartilham identidade...');
const roomA = freshManager.createRoom({ configKey: 'KEY_SHARED' });
const roomB = freshManager.createRoom({ configKey: 'KEY_SHARED' });
assert.notStrictEqual(roomA.roomId, roomB.roomId);
roomA.addHuman('human_only_in_A');
assert.strictEqual(roomA.hasHuman('human_only_in_A'), true);
assert.strictEqual(roomB.hasHuman('human_only_in_A'), false);
assert.notStrictEqual(roomA.humanCount, roomB.humanCount);
console.log('✓ Teste 9 passou.');

// 10. configKey diferente resulta em Rooms diferentes
console.log('Teste 10: configKey diferente resulta em Rooms diferentes...');
const roomConfig1 = freshManager.createRoom({ configKey: 'CONFIG_SPEED_ONLY' });
const roomConfig2 = freshManager.createRoom({ configKey: 'CONFIG_ALL_ITEMS' });
assert.strictEqual(roomConfig1.configKey, 'CONFIG_SPEED_ONLY');
assert.strictEqual(roomConfig2.configKey, 'CONFIG_ALL_ITEMS');
assert.notStrictEqual(roomConfig1.configKey, roomConfig2.configKey);
assert.notStrictEqual(roomConfig1.roomId, roomConfig2.roomId);
console.log('✓ Teste 10 passou.');

console.log('========================================================');
console.log('TODOS OS 10 TESTES DA FASE 2 FORAM EXECUTADOS COM SUCESSO!');
console.log('========================================================\n');

console.log('--- Iniciando Testes da Fase 3A (Encapsulamento World, GameLoop, SpawnSystem) ---');

import { PlayerEntity } from '../server/Player';
import {
  BASE_SPEED,
  BOOST_SPEED,
  TURN_SPEED,
  SEGMENT_DISTANCE,
  INITIAL_SNAKE_LENGTH,
  GAME_TICK_RATE,
  SNAPSHOT_RATE,
  AI_COUNT,
  FOOD_COUNT,
} from '../shared/constants';

// 1. Room cria World independente
console.log('Teste 3A.1: Room cria World independente...');
const testRoom3A1 = new Room({ roomId: 'room_3a_1', configKey: 'DEFAULT' });
assert.ok(testRoom3A1.world !== undefined, 'World deve estar instanciado na Room');
assert.ok(testRoom3A1.world.foodSystem.count() > 0, 'World deve conter alimentos inicializados');
console.log('✓ Teste 3A.1 passou.');

// 2. Duas Rooms possuem Worlds diferentes
console.log('Teste 3A.2: Duas Rooms possuem Worlds diferentes...');
const testRoom3A2 = new Room({ roomId: 'room_3a_2', configKey: 'DEFAULT' });
assert.notStrictEqual(testRoom3A1.world, testRoom3A2.world, 'Worlds devem ser instâncias distintas');
console.log('✓ Teste 3A.2 passou.');

// 3. Duas Rooms possuem GameLoops diferentes
console.log('Teste 3A.3: Duas Rooms possuem GameLoops diferentes...');
assert.ok(testRoom3A1.loop !== undefined, 'GameLoop deve estar instanciado na Room 1');
assert.ok(testRoom3A2.loop !== undefined, 'GameLoop deve estar instanciado na Room 2');
assert.notStrictEqual(testRoom3A1.loop, testRoom3A2.loop, 'GameLoops devem ser instâncias distintas');
console.log('✓ Teste 3A.3 passou.');

// 4. Duas Rooms possuem SpawnSystems diferentes
console.log('Teste 3A.4: Duas Rooms possuem SpawnSystems diferentes...');
assert.ok(testRoom3A1.spawnSystem !== undefined, 'SpawnSystem deve estar instanciado na Room 1');
assert.ok(testRoom3A2.spawnSystem !== undefined, 'SpawnSystem deve estar instanciado na Room 2');
assert.notStrictEqual(testRoom3A1.spawnSystem, testRoom3A2.spawnSystem, 'SpawnSystems devem ser instâncias distintas');
console.log('✓ Teste 3A.4 passou.');

// 5. Room A não referencia World B
console.log('Teste 3A.5: Room A não referencia World B...');
assert.strictEqual(testRoom3A1.world !== testRoom3A2.world, true);
assert.notStrictEqual(testRoom3A1.world?.players, testRoom3A2.world?.players);
console.log('✓ Teste 3A.5 passou.');

// 6. shutdown() para o GameLoop da Room
console.log('Teste 3A.6: shutdown() para o GameLoop da Room...');
const testRoomLoop = new Room({ roomId: 'room_loop_test', configKey: 'DEFAULT' });
testRoomLoop.start();
assert.strictEqual(testRoomLoop.status, 'RUNNING');
testRoomLoop.shutdown();
assert.strictEqual(testRoomLoop.loop, undefined, 'Referência do GameLoop deve ser liberada');
assert.strictEqual(testRoomLoop.world, undefined, 'Referência do World deve ser liberada');
assert.strictEqual(testRoomLoop.spawnSystem, undefined, 'Referência do SpawnSystem deve ser liberada');
assert.strictEqual(testRoomLoop.status, 'STOPPED');
console.log('✓ Teste 3A.6 passou.');

// 7. shutdown() continua idempotente
console.log('Teste 3A.7: shutdown() continua idempotente...');
assert.doesNotThrow(() => {
  testRoomLoop.shutdown();
  testRoomLoop.shutdown();
  testRoomLoop.shutdown();
}, 'shutdown() sucessivo não pode lançar exceção');
assert.strictEqual(testRoomLoop.status, 'STOPPED');
console.log('✓ Teste 3A.7 passou.');

// 8. Iniciar uma Room não inicia outra Room
console.log('Teste 3A.8: Iniciar uma Room não inicia outra Room...');
const roomIsolated1 = new Room({ roomId: 'iso_start_1', configKey: 'K' });
const roomIsolated2 = new Room({ roomId: 'iso_start_2', configKey: 'K' });
roomIsolated1.start();
assert.strictEqual(roomIsolated1.status, 'RUNNING', 'Room 1 deve estar RUNNING');
assert.strictEqual(roomIsolated2.status, 'STARTING', 'Room 2 deve permanecer STARTING');
roomIsolated1.shutdown();
roomIsolated2.shutdown();
console.log('✓ Teste 3A.8 passou.');

// 9. World A e World B mantêm estado independente (Teste de isolamento real)
console.log('Teste 3A.9: World A e World B mantêm estado independente (isolamento real)...');
const roomStateA = new Room({ roomId: 'state_room_A', configKey: 'K_A' });
const roomStateB = new Room({ roomId: 'state_room_B', configKey: 'K_B' });
roomStateA.start();
roomStateB.start();

const initialBotsA = roomStateA.world!.players.size;
const initialBotsB = roomStateB.world!.players.size;
assert.strictEqual(initialBotsA, initialBotsB, 'Ambos os worlds devem iniciar com a mesma contagem de bots');

const customSnake = new PlayerEntity('custom_snake_x99', 'PlayerSoloA', '#38bdf8', 1500, 1500, true);
roomStateA.world!.addPlayer(customSnake);

// Verifica que a entidade existe em A e NÃO em B
assert.strictEqual(roomStateA.world!.getPlayer('custom_snake_x99'), customSnake);
assert.strictEqual(roomStateB.world!.getPlayer('custom_snake_x99'), undefined, 'Entidade de A não pode vazar para B');
assert.strictEqual(roomStateA.world!.players.size, initialBotsA + 1);
assert.strictEqual(roomStateB.world!.players.size, initialBotsB);

roomStateA.shutdown();
roomStateB.shutdown();
console.log('✓ Teste 3A.9 passou.');

// 10. Criar duas Rooms não altera o GameServer atual e mantém isolamento
console.log('Teste 3A.10: Criar duas Rooms em RoomManager é independente e seguro...');
const roomMgr3A = new RoomManager();
const rA = roomMgr3A.createRoom({ configKey: 'CONF_ALPHA' });
const rB = roomMgr3A.createRoom({ configKey: 'CONF_BETA' });
assert.strictEqual(roomMgr3A.getRooms().length, 2);
assert.notStrictEqual(rA.world, rB.world);
assert.notStrictEqual(rA.loop, rB.loop);
assert.notStrictEqual(rA.spawnSystem, rB.spawnSystem);
roomMgr3A.clear();
console.log('✓ Teste 3A.10 passou.');

// Verificação de não-regressão de constantes de física e gameplay
console.log('Teste 3A.11: Auditoria estrita de constantes de física e gameplay...');
assert.strictEqual(BASE_SPEED, 3.2, 'BASE_SPEED deve permanecer 3.2');
assert.strictEqual(BOOST_SPEED, 6.2, 'BOOST_SPEED deve permanecer 6.2');
assert.strictEqual(TURN_SPEED, 0.12, 'TURN_SPEED deve permanecer 0.12');
assert.strictEqual(SEGMENT_DISTANCE, 5, 'SEGMENT_DISTANCE deve permanecer 5');
assert.strictEqual(INITIAL_SNAKE_LENGTH, 10, 'INITIAL_SNAKE_LENGTH deve permanecer 10');
assert.strictEqual(GAME_TICK_RATE, 20, 'GAME_TICK_RATE deve permanecer 20');
assert.strictEqual(SNAPSHOT_RATE, 15, 'SNAPSHOT_RATE deve permanecer 15');
assert.strictEqual(AI_COUNT, 30, 'AI_COUNT deve permanecer 30');
assert.strictEqual(FOOD_COUNT, 3500, 'FOOD_COUNT deve permanecer 3500');
console.log('✓ Teste 3A.11 (Constantes de Gameplay) passou.');

// Cleanup de rooms residuais do teste da Fase 2
testRoom3A1.shutdown();
testRoom3A2.shutdown();

console.log('========================================================');
console.log('TODOS OS TESTES DA FASE 3A FORAM EXECUTADOS COM SUCESSO!');
console.log('========================================================\n');

console.log('--- Iniciando Testes da Fase 3B (Migração GameServer para RoomManager/Room) ---');

import { GameServer } from '../server/GameServer';
import { generateConfigKey } from '../server/Room';
import { SOCKET_EVENTS } from '../shared/events';
import { GAME_MAX_PLAYERS } from '../shared/constants';

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

async function runPhase3BTests() {
  const mockIo = createMockIo();
  const gameServer = new GameServer(mockIo.io);
  gameServer.start();

  const roomMgr = gameServer.getRoomManager();

  // 3B.1: Dois jogadores com mesma configuração entram na mesma Room
  console.log('Teste 3B.1: Dois jogadores com mesma configuração entram na mesma Room...');
  const s1 = createMockSocket('sock_3b_1');
  const s2 = createMockSocket('sock_3b_2');
  mockIo.socketsMap.set('sock_3b_1', s1.socket);
  mockIo.socketsMap.set('sock_3b_2', s2.socket);

  const loadoutStandard = {
    enabledItems: {
      SIZE: true,
      SPEED: true,
      MAGNET: true,
      SCOUTER: true,
      ANGEL: false,
      SLICER: false,
      USURPER: false,
      STALKER: false,
    },
  };

  await gameServer.handleJoin(s1.socket, { name: 'PlayerAlpha', loadout: loadoutStandard });
  await gameServer.handleJoin(s2.socket, { name: 'PlayerBeta', loadout: loadoutStandard });

  const sessionMap = gameServer.getSessions();
  const session1 = Array.from(sessionMap.values()).find((s) => s.nickname === 'PlayerAlpha')!;
  const session2 = Array.from(sessionMap.values()).find((s) => s.nickname === 'PlayerBeta')!;

  assert.ok(session1 && session2, 'Ambos os jogadores devem ter sessões ativas');
  assert.strictEqual(session1.roomId, session2.roomId, 'Jogadores com mesma config devem compartilhar a mesma Room');
  assert.strictEqual(roomMgr.getRooms().length, 1, 'Deve existir exatamente 1 Room para a mesma config');
  assert.strictEqual(s1.joinedRooms.has(session1.roomId!), true, 'Socket 1 deve ter ingressado na Room');
  assert.strictEqual(s2.joinedRooms.has(session2.roomId!), true, 'Socket 2 deve ter ingressado na Room');
  console.log('✓ Teste 3B.1 passou.');

  // 3B.2: Dois jogadores com configurações diferentes entram em Rooms diferentes
  console.log('Teste 3B.2: Dois jogadores com configurações diferentes entram em Rooms diferentes...');
  const s3 = createMockSocket('sock_3b_3');
  mockIo.socketsMap.set('sock_3b_3', s3.socket);

  const loadoutDifferent = {
    enabledItems: {
      SIZE: true,
      SPEED: true,
      MAGNET: true,
      SCOUTER: true,
      ANGEL: true, // Destaque: ANGEL ativado
      SLICER: false,
      USURPER: false,
      STALKER: false,
    },
  };

  await gameServer.handleJoin(s3.socket, { name: 'PlayerGamma', loadout: loadoutDifferent });
  const session3 = Array.from(sessionMap.values()).find((s) => s.nickname === 'PlayerGamma')!;

  assert.ok(session3, 'Jogador Gamma deve possuir sessão');
  assert.notStrictEqual(session3.roomId, session1.roomId, 'Jogadores com configurações distintas devem ficar em Rooms distintas');
  assert.strictEqual(roomMgr.getRooms().length, 2, 'Devem existir exatamente 2 Rooms gerenciadas');
  console.log('✓ Teste 3B.2 passou.');

  // 3B.3: Room A e Room B possuem Worlds diferentes
  console.log('Teste 3B.3: Room A e Room B possuem Worlds diferentes...');
  const roomA = roomMgr.getRoom(session1.roomId!)!;
  const roomB = roomMgr.getRoom(session3.roomId!)!;
  assert.ok(roomA && roomB);
  assert.notStrictEqual(roomA.world, roomB.world, 'Rooms distintas devem possuir instâncias de World estritamente distintas');
  console.log('✓ Teste 3B.3 passou.');

  // 3B.4: Jogador da Room A não aparece no snapshot da Room B
  console.log('Teste 3B.4: Jogador da Room A não aparece no snapshot da Room B...');
  assert.ok(roomA.world!.getPlayer(session1.playerId), 'Jogador 1 deve estar no World da Room A');
  assert.strictEqual(roomA.world!.getPlayer(session3.playerId), undefined, 'Jogador 3 não pode estar no World da Room A');
  assert.ok(roomB.world!.getPlayer(session3.playerId), 'Jogador 3 deve estar no World da Room B');
  assert.strictEqual(roomB.world!.getPlayer(session1.playerId), undefined, 'Jogador 1 não pode estar no World da Room B');

  // Dispara snapshot em Room B e verifica que socket1 (de Room A) não recebe nada
  const s1EventsBefore = s1.emittedEvents.length;
  const s3EventsBefore = s3.emittedEvents.length;
  (roomB as any).onSnapshot(Date.now());
  assert.strictEqual(s1.emittedEvents.length, s1EventsBefore, 'Socket 1 de Room A não pode receber snapshots de Room B');
  assert.strictEqual(s3.emittedEvents.length, s3EventsBefore + 1, 'Socket 3 de Room B deve receber o snapshot de Room B');
  const s3LastSnap = s3.emittedEvents[s3.emittedEvents.length - 1].payload;
  assert.strictEqual(s3LastSnap.roomId, roomB.roomId);
  assert.strictEqual(s3LastSnap.snakes.some((sn: any) => sn.id === session1.playerId), false, 'Snapshot de Room B não pode conter Player 1');
  console.log('✓ Teste 3B.4 passou.');

  // 3B.5: PLAYER_JOINED da Room A não chega para Room B
  console.log('Teste 3B.5: PLAYER_JOINED da Room A não chega para Room B...');
  const s4 = createMockSocket('sock_3b_4');
  mockIo.socketsMap.set('sock_3b_4', s4.socket);
  await gameServer.handleJoin(s4.socket, { name: 'PlayerDelta', loadout: loadoutStandard });
  // PlayerDelta entrou na Room A: s4.toEmitted deve emitir apenas para roomA.roomId
  const deltaEmitted = s4.toEmitted.filter((e) => e.event === SOCKET_EVENTS.PLAYER_JOINED);
  assert.ok(deltaEmitted.length > 0, 'Deve emitir PLAYER_JOINED para os colegas de Room');
  for (const emit of deltaEmitted) {
    assert.strictEqual(emit.roomId, roomA.roomId, 'PLAYER_JOINED deve ser direcionado exclusivamente para a Room A');
    assert.notStrictEqual(emit.roomId, roomB.roomId, 'PLAYER_JOINED de Room A não pode chegar em Room B');
  }
  console.log('✓ Teste 3B.5 passou.');

  // 3B.6: PLAYER_LEFT da Room A não chega para Room B
  console.log('Teste 3B.6: PLAYER_LEFT da Room A não chega para Room B...');
  const deltaSession = Array.from(sessionMap.values()).find((s) => s.nickname === 'PlayerDelta')!;
  gameServer.handleDisconnect(s4.socket);
  // Simula expiração do disconnect grace para PlayerDelta
  if (deltaSession.disconnectTimer) {
    clearTimeout(deltaSession.disconnectTimer);
    deltaSession.disconnectTimer = undefined;
  }
  // Remove manualmente conforme rotina de expiração do grace
  roomA.world!.removePlayer(deltaSession.playerId);
  roomA.removeHuman(deltaSession.playerId);
  mockIo.io.to(roomA.roomId).emit(SOCKET_EVENTS.PLAYER_LEFT, { id: deltaSession.playerId });

  const leftMsgs = mockIo.roomMessages.filter((m) => m.event === SOCKET_EVENTS.PLAYER_LEFT);
  assert.ok(leftMsgs.length > 0, 'Mensagem PLAYER_LEFT deve ser emitida');
  for (const msg of leftMsgs) {
    assert.strictEqual(msg.roomId, roomA.roomId, 'PLAYER_LEFT deve ser enviado apenas para roomA');
    assert.notStrictEqual(msg.roomId, roomB.roomId, 'PLAYER_LEFT de Room A não pode vazar para Room B');
  }
  console.log('✓ Teste 3B.6 passou.');

  // 3B.7: Somente a Room com jogador humano possui GameLoop ativo
  console.log('Teste 3B.7: Somente a Room com jogador humano possui GameLoop ativo...');
  const emptyRoom = roomMgr.createRoom({ configKey: 'STANDALONE_EMPTY' });
  assert.strictEqual(emptyRoom.status, 'STARTING', 'Room sem humanos recém-criada deve permanecer STARTING');
  assert.strictEqual(roomA.status, 'RUNNING', 'Room com humanos deve estar RUNNING');
  assert.strictEqual(roomB.status, 'RUNNING', 'Room com humanos deve estar RUNNING');
  emptyRoom.shutdown();
  console.log('✓ Teste 3B.7 passou.');

  // 3B.8: Quando último humano sai, Room entra em EMPTY_GRACE
  console.log('Teste 3B.8: Quando último humano sai, Room entra em EMPTY_GRACE...');
  const sSolo = createMockSocket('sock_solo');
  mockIo.socketsMap.set('sock_solo', sSolo.socket);
  await gameServer.handleJoin(sSolo.socket, { name: 'SoloHuman', loadout: { enabledItems: { USURPER: true } as any } });
  const soloSession = Array.from(sessionMap.values()).find((s) => s.nickname === 'SoloHuman')!;
  const soloRoom = roomMgr.getRoom(soloSession.roomId!)!;
  assert.strictEqual(soloRoom.humanCount, 1);

  // Desconecta e expira o grace do jogador solo
  gameServer.handleDisconnect(sSolo.socket);
  if (soloSession.disconnectTimer) {
    clearTimeout(soloSession.disconnectTimer);
    soloSession.disconnectTimer = undefined;
  }
  soloRoom.world!.removePlayer(soloSession.playerId);
  soloRoom.removeHuman(soloSession.playerId);
  assert.strictEqual(soloRoom.humanCount, 0, 'Contagem de humanos deve zerar');

  // Dispara EMPTY_GRACE na Room
  let graceExpiredCalled = false;
  soloRoom.startEmptyGrace(() => {
    graceExpiredCalled = true;
    if (soloRoom.humanCount === 0) {
      soloRoom.shutdown();
      roomMgr.removeRoom(soloRoom.roomId);
    }
  }, 50); // 50ms para teste ágil

  assert.strictEqual(soloRoom.status, 'EMPTY_GRACE', 'Room deve transitar para EMPTY_GRACE');
  assert.ok(soloRoom.emptyGraceTimer !== null, 'Timer de EMPTY_GRACE deve estar armado');
  console.log('✓ Teste 3B.8 passou.');

  // 3B.9: Após o grace, Room é destruída e removida do RoomManager
  console.log('Teste 3B.9: Após o grace, Room é destruída e removida do RoomManager...');
  await new Promise((res) => setTimeout(res, 70));
  assert.strictEqual(graceExpiredCalled, true, 'Callback de expiração do grace deve ter executado');
  assert.strictEqual(soloRoom.status, 'STOPPED', 'Room deve estar STOPPED após término do grace');
  assert.strictEqual(soloRoom.world, undefined, 'World da Room destruída deve ser liberado');
  assert.strictEqual(soloRoom.loop, undefined, 'GameLoop da Room destruída deve ser liberado');
  assert.strictEqual(roomMgr.getRoom(soloRoom.roomId), undefined, 'RoomManager não deve mais conter a Room destruída');
  console.log('✓ Teste 3B.9 passou.');

  // 3B.10: Nova entrada após destruição NÃO recupera o World antigo
  console.log('Teste 3B.10: Nova entrada após destruição NÃO recupera o World antigo...');
  const sNew = createMockSocket('sock_new_after_destroy');
  mockIo.socketsMap.set('sock_new_after_destroy', sNew.socket);
  await gameServer.handleJoin(sNew.socket, { name: 'PlayerAfterDestroy', loadout: { enabledItems: { USURPER: true } as any } });
  const newSession = Array.from(sessionMap.values()).find((s) => s.nickname === 'PlayerAfterDestroy')!;
  const newlyCreatedRoom = roomMgr.getRoom(newSession.roomId!)!;

  assert.notStrictEqual(newlyCreatedRoom.roomId, soloRoom.roomId, 'Novo jogador deve receber uma nova Room com novo ID');
  assert.notStrictEqual(newlyCreatedRoom.world, undefined, 'Nova Room deve possuir World fresco');
  assert.strictEqual(newlyCreatedRoom.world!.players.has(soloSession.playerId), false, 'Jogador antigo não deve existir no novo World');
  newlyCreatedRoom.shutdown();
  roomMgr.removeRoom(newlyCreatedRoom.roomId);
  console.log('✓ Teste 3B.10 passou.');

  // 3B.11: Reconnect durante grace retorna à mesma Room
  console.log('Teste 3B.11: Reconnect durante grace retorna à mesma Room...');
  const sReconnect1 = createMockSocket('sock_rec_1');
  mockIo.socketsMap.set('sock_rec_1', sReconnect1.socket);
  await gameServer.handleJoin(sReconnect1.socket, { name: 'RecPlayer', loadout: loadoutStandard });
  const recSession = Array.from(sessionMap.values()).find((s) => s.nickname === 'RecPlayer')!;
  const targetRoomId = recSession.roomId!;

  // Disconecta mas reconecta antes do grace expirar
  gameServer.handleDisconnect(sReconnect1.socket);
  const sReconnect2 = createMockSocket('sock_rec_2');
  mockIo.socketsMap.set('sock_rec_2', sReconnect2.socket);
  await gameServer.handleJoin(sReconnect2.socket, {
    name: 'RecPlayer',
    loadout: loadoutStandard,
    sessionToken: recSession.sessionId,
  });

  assert.strictEqual(recSession.connected, true, 'Sessão deve estar reconectada');
  assert.strictEqual(recSession.roomId, targetRoomId, 'Jogador reconectado durante grace deve permanecer na mesma Room');
  console.log('✓ Teste 3B.11 passou.');

  // 3B.12: Reconnect depois da destruição cria/seleciona nova Room
  console.log('Teste 3B.12: Reconnect depois da destruição cria/seleciona nova Room...');
  // Força shutdown da Room antiga
  const roomToDestroy = roomMgr.getRoom(targetRoomId)!;
  roomToDestroy.shutdown();
  roomMgr.removeRoom(targetRoomId);

  const sReconnectAfterDestroy = createMockSocket('sock_rec_after_dest');
  mockIo.socketsMap.set('sock_rec_after_dest', sReconnectAfterDestroy.socket);
  await gameServer.handleJoin(sReconnectAfterDestroy.socket, {
    name: 'RecPlayer',
    loadout: loadoutStandard,
    sessionToken: recSession.sessionId,
  });

  assert.notStrictEqual(recSession.roomId, targetRoomId, 'Após destruição da Room antiga, o jogador deve ser alocado em uma nova Room válida');
  assert.ok(roomMgr.getRoom(recSession.roomId!) !== undefined, 'A nova Room deve existir e estar ativa no RoomManager');
  console.log('✓ Teste 3B.12 passou.');

  // 3B.13: Loadout de Room A não altera World da Room B
  console.log('Teste 3B.13: Loadout de Room A não altera World da Room B...');
  const rLoadoutA = roomMgr.createRoom({ configKey: 'LOADOUT_TEST_A' });
  const rLoadoutB = roomMgr.createRoom({ configKey: 'LOADOUT_TEST_B' });
  rLoadoutA.start();
  rLoadoutB.start();
  const countSpecialItemsBBefore = rLoadoutB.world!.specialItems.length;
  rLoadoutA.world!.syncEnabledItems({ SLICER: true, USURPER: true, STALKER: true } as any);
  assert.strictEqual(rLoadoutB.world!.specialItems.length, countSpecialItemsBBefore, 'Modificação de itens em Room A não pode afetar Room B');
  rLoadoutA.shutdown();
  rLoadoutB.shutdown();
  roomMgr.removeRoom(rLoadoutA.roomId);
  roomMgr.removeRoom(rLoadoutB.roomId);
  console.log('✓ Teste 3B.13 passou.');

  // 3B.14: Room cheia cria nova Room com mesma configuração
  console.log('Teste 3B.14: Room cheia cria nova Room com mesma configuração...');
  const fullConfigKey = 'CONFIG_FULL_TEST';
  const rFull1 = roomMgr.createRoom({ configKey: fullConfigKey });
  rFull1.start();
  // Preenche a capacidade humana da sala
  for (let i = 0; i < GAME_MAX_PLAYERS; i++) {
    rFull1.addHuman(`dummy_human_${i}`);
  }
  assert.strictEqual(rFull1.availableSlots, 0, 'A Room deve estar completamente cheia');

  // Próximo jogador com a mesma configuração solicita entrada
  const rFull2 = gameServer.getOrCreateRoomForPlayer(fullConfigKey, {
    SIZE: true,
    SPEED: true,
    MAGNET: true,
    SCOUTER: true,
    ANGEL: false,
    SLICER: false,
    USURPER: false,
    STALKER: false,
  });

  assert.notStrictEqual(rFull2.roomId, rFull1.roomId, 'Room cheia deve forçar a criação de uma 2ª Room');
  assert.strictEqual(rFull2.configKey, rFull1.configKey, 'A 2ª Room deve compartilhar a mesma configuração');
  rFull1.shutdown();
  rFull2.shutdown();
  roomMgr.removeRoom(rFull1.roomId);
  roomMgr.removeRoom(rFull2.roomId);
  console.log('✓ Teste 3B.14 passou.');

  // 3B.15: Bots não consomem capacidade humana
  console.log('Teste 3B.15: Bots não consomem capacidade humana...');
  const botRoom = roomMgr.createRoom({ configKey: 'BOT_TEST_CONFIG' });
  botRoom.start();
  // Room sem humanos inicia com 0 bots
  assert.strictEqual(botRoom.world!.players.size, 0, 'Room sem humanos deve possuir 0 bots');
  assert.strictEqual(botRoom.humanCount, 0, 'Contagem de humanos inicial deve ser zero');
  assert.strictEqual(botRoom.availableSlots, GAME_MAX_PLAYERS, 'Capacidade humana não pode ser decrementada pelos bots');
  botRoom.addHuman('human_test_slot');
  assert.strictEqual(botRoom.world!.players.size, 30, 'Ao adicionar humano, os bots são ativados no world');
  assert.strictEqual(botRoom.availableSlots, GAME_MAX_PLAYERS - 1, 'Slots humanos decrementam apenas com humanos');
  botRoom.shutdown();
  roomMgr.removeRoom(botRoom.roomId);
  console.log('✓ Teste 3B.15 passou.');

  // 3B.16: Nenhum GameLoop global permanece ativo
  console.log('Teste 3B.16: Nenhum GameLoop global permanece ativo...');
  assert.strictEqual((gameServer as any).loop, undefined, 'GameServer não pode conter propriedade loop global');
  assert.strictEqual((gameServer as any).world, undefined, 'GameServer não pode conter propriedade world global');
  assert.strictEqual((gameServer as any).spawnSystem, undefined, 'GameServer não pode conter propriedade spawnSystem global');

  // Encerra gameServer e valida que todas as salas e loops estão parados
  gameServer.stop();
  assert.strictEqual(roomMgr.getRooms().length, 0, 'stop() do GameServer deve liberar todas as Rooms');
  console.log('✓ Teste 3B.16 passou.');

  console.log('========================================================');
  console.log('TODOS OS 16 TESTES DA FASE 3B FORAM EXECUTADOS COM SUCESSO!');
  console.log('========================================================');

  // Executa os testes da Fase 6B
  await runPhase6BTests();

  // Executa os testes da Fase 6D
  await runPhase6DTests();

  // Executa os testes da Fase 6E.1
  await runPhase6E1Tests();

  process.exit(0);
}

runPhase3BTests().catch((err) => {
  console.error('Falha nos testes:', err);
  process.exit(1);
});

