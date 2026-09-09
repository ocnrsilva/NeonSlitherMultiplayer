import assert from 'assert';
import { Room, RoomConfig, DEFAULT_ENABLED_ITEMS } from '../server/Room';
import { RoomManager } from '../server/RoomManager';
import { GameServer } from '../server/GameServer';
import { GameLoop } from '../server/GameLoop';
import { SpawnSystem } from '../server/SpawnSystem';
import { World } from '../server/World';

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

export async function runPhase6DTests() {
  console.log('\n--- Iniciando Testes da Fase 6D (Lifecycle Rigoroso & Zero Bots Sem Humanos) ---');

  const mockIo = createMockIo();
  const gameServer = new GameServer(mockIo.io as any);
  const roomMgr = (gameServer as any).roomManager;

  // =========================================================================
  // TESTE 01: Servidor sem jogadores
  // Esperado: 0 Rooms, 0 GameLoops, 0 bots
  // =========================================================================
  console.log('TESTE 01: Servidor sem jogadores...');
  assert.strictEqual(roomMgr.getRooms().length, 0, 'Servidor sem jogadores não deve ter Rooms');
  assert.strictEqual(roomMgr.activeRoomCount, 0, 'activeRoomCount deve ser 0');
  const statsInit = roomMgr.getStats();
  assert.strictEqual(statsInit.activeRooms, 0, 'activeRooms deve ser 0');
  assert.strictEqual(statsInit.activeBots, 0, 'activeBots deve ser 0');
  assert.strictEqual(statsInit.activeHumans, 0, 'activeHumans deve ser 0');
  console.log('✓ TESTE 01 passou.');

  // =========================================================================
  // TESTE 02: Primeiro jogador cria Room
  // Esperado: 1 Room, status RUNNING, GameLoop ativo, bots ativos
  // =========================================================================
  console.log('TESTE 02: Primeiro jogador cria Room...');
  const s1 = createMockSocket('sock_p1');
  mockIo.socketsMap.set(s1.socket.id, s1.socket);

  await gameServer.handleJoin(s1.socket, {
    name: 'PlayerOne',
    loadout: { enabledItems: DEFAULT_ENABLED_ITEMS },
  });

  assert.strictEqual(roomMgr.getRooms().length, 1, 'Deve existir exatamente 1 Room após entrada do primeiro jogador');
  const room1 = roomMgr.getRooms()[0];
  assert.strictEqual(room1.status, 'RUNNING', 'Status da Room deve ser RUNNING');
  assert.strictEqual(room1.loop?.active, true, 'GameLoop deve estar ativo');
  assert.strictEqual(room1.humanCount, 1, 'Room deve possuir exatamente 1 humano');
  assert.strictEqual(room1.world?.getBotCount(), 30, 'Room com humano deve possuir 30 bots ativos no World');
  console.log('✓ TESTE 02 passou.');

  // =========================================================================
  // TESTE 03: Segundo jogador entra
  // Esperado: Mesma Room, 2 humanos, 30 bots
  // =========================================================================
  console.log('TESTE 03: Segundo jogador entra...');
  const s2 = createMockSocket('sock_p2');
  mockIo.socketsMap.set(s2.socket.id, s2.socket);

  await gameServer.handleJoin(s2.socket, {
    name: 'PlayerTwo',
    loadout: { enabledItems: DEFAULT_ENABLED_ITEMS },
  });

  assert.strictEqual(roomMgr.getRooms().length, 1, 'Segundo jogador com mesma configuração deve entrar na mesma Room');
  assert.strictEqual(room1.humanCount, 2, 'Room deve possuir 2 jogadores humanos');
  assert.strictEqual(room1.world?.getBotCount(), 30, 'Contagem de bots deve permanecer em 30');
  assert.strictEqual(room1.status, 'RUNNING', 'Room deve continuar RUNNING');
  console.log('✓ TESTE 03 passou.');

  // =========================================================================
  // TESTE 04: Primeiro jogador sai
  // Esperado: Room continua RUNNING porque ainda existe outro humano
  // =========================================================================
  console.log('TESTE 04: Primeiro jogador sai...');
  const session1 = Array.from((gameServer as any).sessions.values()).find(
    (s: any) => s.nickname === 'PlayerOne'
  ) as any;
  assert.ok(session1, 'Sessão do Jogador 1 deve existir');

  // Simula desconexão e expiração do Jogador 1
  gameServer.handleDisconnect(s1.socket);
  if (session1.disconnectTimer) {
    clearTimeout(session1.disconnectTimer);
    session1.disconnectTimer = null;
  }
  // Executa remoção direta do jogador 1 da Room
  room1.world?.removePlayer(session1.playerId);
  room1.removeHuman(session1.playerId);

  assert.strictEqual(room1.humanCount, 1, 'Room deve ter 1 humano restante');
  assert.strictEqual(room1.status, 'RUNNING', 'Room deve continuar RUNNING com 1 humano restante');
  assert.strictEqual(room1.loop?.active, true, 'GameLoop deve continuar ativo');
  assert.strictEqual(room1.world?.getBotCount(), 30, 'Bots devem continuar ativos');
  console.log('✓ TESTE 04 passou.');

  // =========================================================================
  // TESTE 05: Último jogador sai
  // Esperado: Room -> EMPTY_GRACE, GameLoop pausado (0 CPU)
  // =========================================================================
  console.log('TESTE 05: Último jogador sai...');
  const session2 = Array.from((gameServer as any).sessions.values()).find(
    (s: any) => s.nickname === 'PlayerTwo'
  ) as any;
  assert.ok(session2, 'Sessão do Jogador 2 deve existir');

  room1.world?.removePlayer(session2.playerId);
  room1.removeHuman(session2.playerId);

  let graceExpiredTriggered = false;
  room1.startEmptyGrace(() => {
    graceExpiredTriggered = true;
    room1.shutdown();
    roomMgr.removeRoom(room1.roomId);
  }, 100);

  assert.strictEqual(room1.humanCount, 0, 'Room não possui mais humanos');
  assert.strictEqual(room1.status, 'EMPTY_GRACE', 'Room deve estar no status EMPTY_GRACE');
  assert.strictEqual(room1.loop?.active, false, 'GameLoop deve estar parado durante EMPTY_GRACE para ZERO consumo de CPU');
  console.log('✓ TESTE 05 passou.');

  // =========================================================================
  // TESTE 06: Nenhuma nova Room é criada durante EMPTY_GRACE
  // Esperado: Reutiliza a Room existente que está em EMPTY_GRACE
  // =========================================================================
  console.log('TESTE 06: Nenhuma nova Room é criada durante EMPTY_GRACE...');
  const existingCandidate = roomMgr.getOrCreateRoom(room1.configKey, room1.enabledItems);
  assert.strictEqual(existingCandidate?.roomId, room1.roomId, 'Deve reutilizar a Room em EMPTY_GRACE sem criar nova Room');
  assert.strictEqual(roomMgr.getRooms().length, 1, 'Total de Rooms deve permanecer 1');
  console.log('✓ TESTE 06 passou.');

  // =========================================================================
  // TESTE 07: Reconexão durante grace
  // Esperado: Mesma Room, retoma RUNNING e GameLoop
  // =========================================================================
  console.log('TESTE 07: Reconexão durante grace...');
  room1.addHuman(session2.playerId);
  assert.strictEqual(room1.status, 'RUNNING', 'Room deve retornar ao status RUNNING');
  assert.strictEqual(room1.loop?.active, true, 'GameLoop deve ser retomado com sucesso');
  assert.strictEqual(room1.world?.getBotCount(), 30, 'Bots devem estar disponíveis para a partida');
  console.log('✓ TESTE 07 passou.');

  // =========================================================================
  // TESTE 08: Grace expira
  // Esperado: Room destruída
  // =========================================================================
  console.log('TESTE 08: Grace expira...');
  // Remove novamente o humano e deixa o grace expirar
  room1.removeHuman(session2.playerId);
  room1.startEmptyGrace(() => {
    graceExpiredTriggered = true;
    room1.shutdown();
    roomMgr.removeRoom(room1.roomId);
  }, 30);

  await new Promise((res) => setTimeout(res, 50));
  assert.strictEqual(graceExpiredTriggered, true, 'Callback de expiração do grace deve ter executado');
  assert.strictEqual(room1.status, 'STOPPED', 'Room deve ter status STOPPED após expiração');
  console.log('✓ TESTE 08 passou.');

  // =========================================================================
  // TESTE 09: Após shutdown: bots === 0
  // =========================================================================
  console.log('TESTE 09: Após shutdown: bots === 0...');
  assert.strictEqual(room1.getStats().botPlayers, 0, 'Após shutdown a contagem de bots deve ser 0');
  assert.strictEqual(room1.world, undefined, 'World deve ser liberado após shutdown');
  console.log('✓ TESTE 09 passou.');

  // =========================================================================
  // TESTE 10: Após shutdown: GameLoop parado
  // =========================================================================
  console.log('TESTE 10: Após shutdown: GameLoop parado...');
  assert.strictEqual(room1.loop, undefined, 'GameLoop deve ser descartado após shutdown');
  console.log('✓ TESTE 10 passou.');

  // =========================================================================
  // TESTE 11: Após shutdown: SpawnSystem parado/destruído
  // =========================================================================
  console.log('TESTE 11: Após shutdown: SpawnSystem parado/destruído...');
  assert.strictEqual(room1.spawnSystem, undefined, 'SpawnSystem deve ser descartado após shutdown');
  console.log('✓ TESTE 11 passou.');

  // =========================================================================
  // TESTE 12: RoomManager remove a Room
  // =========================================================================
  console.log('TESTE 12: RoomManager remove a Room...');
  assert.strictEqual(roomMgr.getRoom(room1.roomId), undefined, 'Room não pode mais constar no RoomManager');
  assert.strictEqual(roomMgr.getRooms().length, 0, 'RoomManager não deve conter nenhuma Room ativa');
  console.log('✓ TESTE 12 passou.');

  // =========================================================================
  // TESTE 13: Novo jogador depois do shutdown cria nova Room
  // =========================================================================
  console.log('TESTE 13: Novo jogador depois do shutdown cria nova Room...');
  const sNew = createMockSocket('sock_fresh');
  mockIo.socketsMap.set(sNew.socket.id, sNew.socket);
  await gameServer.handleJoin(sNew.socket, {
    name: 'FreshPlayer',
    loadout: { enabledItems: DEFAULT_ENABLED_ITEMS },
  });

  const freshRoom = roomMgr.getRooms()[0];
  assert.ok(freshRoom, 'Uma nova Room deve ser criada');
  assert.notStrictEqual(freshRoom.roomId, room1.roomId, 'A nova Room deve possuir ID diferente da Room destruída');
  assert.strictEqual(freshRoom.status, 'RUNNING', 'A nova Room deve estar RUNNING');
  assert.strictEqual(freshRoom.humanCount, 1, 'A nova Room deve ter 1 humano');
  assert.strictEqual(freshRoom.world?.getBotCount(), 30, 'A nova Room deve ter seus 30 bots próprios');
  console.log('✓ TESTE 13 passou.');

  // =========================================================================
  // TESTE 14: Configurações diferentes criam Rooms separadas
  // =========================================================================
  console.log('TESTE 14: Configurações diferentes criam Rooms separadas...');
  const customLoadout = { ...DEFAULT_ENABLED_ITEMS, SLICER: true, USURPER: true };
  const sCustom = createMockSocket('sock_custom_cfg');
  mockIo.socketsMap.set(sCustom.socket.id, sCustom.socket);
  await gameServer.handleJoin(sCustom.socket, {
    name: 'CustomPlayer',
    loadout: { enabledItems: customLoadout },
  });

  assert.strictEqual(roomMgr.getRooms().length, 2, 'Dois jogadores com configs diferentes devem ocupar 2 Rooms distintas');
  const roomCustom = roomMgr.getRooms().find((r) => r.roomId !== freshRoom.roomId)!;
  assert.ok(roomCustom, 'Segunda Room deve existir');
  assert.notStrictEqual(roomCustom.configKey, freshRoom.configKey, 'ConfigKeys devem ser distintas');
  console.log('✓ TESTE 14 passou.');

  // =========================================================================
  // TESTE 15: Room X vazia não interfere na Room Y
  // =========================================================================
  console.log('TESTE 15: Room X vazia não interfere na Room Y...');
  // Encerra freshRoom (Room X)
  freshRoom.shutdown();
  roomMgr.removeRoom(freshRoom.roomId);

  assert.strictEqual(roomMgr.getRooms().length, 1, 'Apenas Room Y deve restar');
  assert.strictEqual(roomCustom.status, 'RUNNING', 'Room Y deve continuar RUNNING');
  assert.strictEqual(roomCustom.loop?.active, true, 'GameLoop de Room Y deve continuar ativo');
  assert.strictEqual(roomCustom.humanCount, 1, 'HumanCount de Room Y não é alterado');
  assert.strictEqual(roomCustom.world?.getBotCount(), 30, 'Bots de Room Y continuam operando normalmente');
  console.log('✓ TESTE 15 passou.');

  // Limpa Room Y para os próximos testes
  roomCustom.shutdown();
  roomMgr.removeRoom(roomCustom.roomId);

  // =========================================================================
  // TESTE 16: MAX_ROOMS continua funcionando
  // =========================================================================
  console.log('TESTE 16: MAX_ROOMS continua funcionando...');
  const originalLimit = roomMgr.getMaxRooms();
  roomMgr.setMaxRooms(2);

  const rA = roomMgr.createRoom({ configKey: 'LIMIT_TEST_A' });
  const rB = roomMgr.createRoom({ configKey: 'LIMIT_TEST_B' });
  const rC = roomMgr.createRoom({ configKey: 'LIMIT_TEST_C' });

  assert.ok(rA, 'Room A deve ser criada');
  assert.ok(rB, 'Room B deve ser criada');
  assert.strictEqual(rC, null, 'Room C não pode ser criada além de MAX_ROOMS=2');

  // Ao desligar Room A, deve permitir nova criação
  rA!.shutdown();
  roomMgr.removeRoom(rA!.roomId);
  const rCNew = roomMgr.createRoom({ configKey: 'LIMIT_TEST_C' });
  assert.ok(rCNew, 'Após remoção de Room A, nova criação deve ser autorizada');

  rB!.shutdown();
  rCNew!.shutdown();
  roomMgr.removeRoom(rB!.roomId);
  roomMgr.removeRoom(rCNew!.roomId);
  roomMgr.setMaxRooms(originalLimit);
  console.log('✓ TESTE 16 passou.');

  // =========================================================================
  // TESTE 17: start() duplicado não cria múltiplos loops
  // =========================================================================
  console.log('TESTE 17: start() duplicado não cria múltiplos loops...');
  const testLoopRoom = new Room({ roomId: 'idempotent_loop_room', configKey: 'TEST' });
  testLoopRoom.start();
  const loopInstance1 = testLoopRoom.loop;
  assert.strictEqual(loopInstance1?.active, true, 'Loop deve estar ativo');

  testLoopRoom.start();
  testLoopRoom.start();
  assert.strictEqual(testLoopRoom.loop, loopInstance1, 'start() subsequente não recria instância do loop');
  assert.strictEqual(testLoopRoom.loop?.active, true, 'Loop permanece ativo sem duplicatas');
  testLoopRoom.shutdown();
  console.log('✓ TESTE 17 passou.');

  // =========================================================================
  // TESTE 18: stop() duplicado não gera erro
  // =========================================================================
  console.log('TESTE 18: stop() duplicado não gera erro...');
  const standaloneLoop = new GameLoop(() => {}, () => {});
  standaloneLoop.start();
  assert.strictEqual(standaloneLoop.active, true);
  standaloneLoop.stop();
  assert.strictEqual(standaloneLoop.active, false);

  // Múltiplos stop() consecutivos
  assert.doesNotThrow(() => {
    standaloneLoop.stop();
    standaloneLoop.stop();
    standaloneLoop.stop();
  }, 'Múltiplos stop() não devem lançar exceções');
  console.log('✓ TESTE 18 passou.');

  // =========================================================================
  // TESTE 19: shutdown() duplicado não gera erro
  // =========================================================================
  console.log('TESTE 19: shutdown() duplicado não gera erro...');
  const testShutdownRoom = new Room({ roomId: 'idempotent_shutdown_room', configKey: 'TEST' });
  testShutdownRoom.start();
  testShutdownRoom.shutdown();
  assert.strictEqual(testShutdownRoom.status, 'STOPPED');

  assert.doesNotThrow(() => {
    testShutdownRoom.shutdown();
    testShutdownRoom.shutdown();
    testShutdownRoom.shutdown();
  }, 'Múltiplos shutdown() não devem lançar exceções');
  assert.strictEqual(testShutdownRoom.status, 'STOPPED');
  console.log('✓ TESTE 19 passou.');

  // =========================================================================
  // TESTE 20: Nenhum timer continua ativo após shutdown
  // =========================================================================
  console.log('TESTE 20: Nenhum timer continua ativo após shutdown...');
  const timerRoom = new Room({ roomId: 'timer_test_room', configKey: 'TEST' });
  timerRoom.start();
  timerRoom.startEmptyGrace(() => {}, 5000);
  assert.ok(timerRoom.emptyGraceTimer !== null, 'emptyGraceTimer deve estar configurado');

  timerRoom.shutdown();
  assert.strictEqual(timerRoom.emptyGraceTimer, null, 'emptyGraceTimer deve ser cancelado e limpo');
  assert.strictEqual(timerRoom.loop, undefined, 'Loop deve ser descartado');
  assert.strictEqual(timerRoom.world, undefined, 'World deve ser descartado');
  console.log('✓ TESTE 20 passou.');

  // Encerra servidor de teste
  gameServer.stop();

  console.log('========================================================');
  console.log('TODOS OS 20 TESTES DA FASE 6D FORAM EXECUTADOS COM SUCESSO!');
  console.log('========================================================\n');
}
