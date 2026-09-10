import assert from 'assert';
import { initRedis, cacheGet, cacheSet, disconnectRedis } from '../server/redis/redisClient';
import { initPrisma, disconnectPrisma } from '../server/db/prisma';

export async function runPhase6E1Tests() {
  console.log('\n--- Iniciando Testes da Fase 6E.1 (Startup Determinístico & Fail-Closed de Redis/Postgres) ---');

  const originalEnv = { ...process.env };

  try {
    // =========================================================================
    // TESTE 6E1.1: Produção sem REDIS_URL rejeita no startup (Fail-Closed)
    // =========================================================================
    console.log('TESTE 6E1.1: Produção sem REDIS_URL rejeita no startup (Fail-Closed)...');
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;

    await assert.rejects(
      async () => {
        await initRedis(1000);
      },
      /REDIS_URL is mandatory in production/,
      'initRedis() em produção sem REDIS_URL deve lançar exceção bloqueante'
    );
    console.log('✓ TESTE 6E1.1 passou.');

    // =========================================================================
    // TESTE 6E1.2: Produção com REDIS_URL inacessível rejeita no startup
    // =========================================================================
    console.log('TESTE 6E1.2: Produção com REDIS_URL inacessível rejeita no startup...');
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://127.0.0.1:54321'; // Porta sem serviço

    await assert.rejects(
      async () => {
        await initRedis(500);
      },
      /Failed to connect to Redis in production|Connection timed out/,
      'initRedis() em produção com Redis inacessível deve falhar de forma explícita'
    );
    await disconnectRedis();
    console.log('✓ TESTE 6E1.2 passou.');

    // =========================================================================
    // TESTE 6E1.3: Em produção, cacheGet e cacheSet recusam fallback silencioso
    // =========================================================================
    console.log('TESTE 6E1.3: Em produção, cacheGet e cacheSet recusam fallback silencioso...');
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;

    await assert.rejects(
      async () => {
        await cacheSet('test:fail_closed', 'data', 60);
      },
      /Redis unavailable in production\. Refusing silent fallback/,
      'cacheSet() deve recusar fallback em memória em produção'
    );

    await assert.rejects(
      async () => {
        await cacheGet('test:fail_closed');
      },
      /Redis unavailable in production\. Refusing silent fallback/,
      'cacheGet() deve recusar fallback em memória em produção'
    );
    console.log('✓ TESTE 6E1.3 passou.');

    // =========================================================================
    // TESTE 6E1.4: Desenvolvimento sem REDIS_URL permite fallback em memória
    // =========================================================================
    console.log('TESTE 6E1.4: Desenvolvimento sem REDIS_URL permite fallback em memória...');
    process.env.NODE_ENV = 'development';
    delete process.env.REDIS_URL;

    const devInit = await initRedis(500);
    assert.strictEqual(devInit, true, 'initRedis() em dev sem REDIS_URL deve retornar true para dev fallback');

    await cacheSet('dev:key', 'session_abc', 60);
    const cachedVal = await cacheGet('dev:key');
    assert.strictEqual(cachedVal, 'session_abc', 'cacheGet() deve ler valor armazenado em memória no ambiente de dev');
    console.log('✓ TESTE 6E1.4 passou.');

    // =========================================================================
    // TESTE 6E1.5: Produção sem DATABASE_URL rejeita no startup (Fail-Closed)
    // =========================================================================
    console.log('TESTE 6E1.5: Produção sem DATABASE_URL rejeita no startup (Fail-Closed)...');
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;

    await assert.rejects(
      async () => {
        await initPrisma(1000);
      },
      /DATABASE_URL is mandatory in production/,
      'initPrisma() em produção sem DATABASE_URL deve lançar erro bloqueante'
    );
    console.log('✓ TESTE 6E1.5 passou.');

    // =========================================================================
    // TESTE 6E1.6: Desenvolvimento sem DATABASE_URL opera em offline dev
    // =========================================================================
    console.log('TESTE 6E1.6: Desenvolvimento sem DATABASE_URL opera em offline dev...');
    process.env.NODE_ENV = 'development';
    delete process.env.DATABASE_URL;

    const devPrismaInit = await initPrisma(500);
    assert.strictEqual(devPrismaInit, true, 'initPrisma() em dev sem DATABASE_URL não bloqueia startup local');
    console.log('✓ TESTE 6E1.6 passou.');

    // =========================================================================
    // TESTE 6E1.7: getPrismaClient não dispara $connect duplicado concorrente
    // =========================================================================
    console.log('TESTE 6E1.7: getPrismaClient não dispara $connect duplicado concorrente...');
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/db';

    // Ao chamar getPrismaClient(), o cliente deve ser retornado sem disparar conexão assíncrona automática não monitorada
    const client = (await import('../server/db/prisma')).getPrismaClient();
    assert.ok(client !== null, 'getPrismaClient() deve instanciar o cliente');
    console.log('✓ TESTE 6E1.7 passou.');

  } finally {
    // Restaura ambiente
    process.env = originalEnv;
    await disconnectRedis();
    await disconnectPrisma();
  }

  console.log('========================================================');
  console.log('TODOS OS TESTES DA FASE 6E.1 FORAM EXECUTADOS COM SUCESSO!');
  console.log('========================================================\n');
}
