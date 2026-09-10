import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | null = null;
let isPrismaConnected = false;

export async function initPrisma(timeoutMs = 5000): Promise<boolean> {
  const isProd = process.env.NODE_ENV === 'production';
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    if (isProd) {
      console.error('[Prisma] CRITICAL: DATABASE_URL is not set in production.');
      throw new Error('[Prisma] DATABASE_URL is mandatory in production. Refusing to start.');
    }
    console.warn('[Prisma] DATABASE_URL not configured. Running in offline/development mode.');
    return true;
  }

  console.log('[Prisma] Connecting to PostgreSQL database...');
  const client = getPrismaClient();
  if (!client) {
    if (isProd) {
      throw new Error('[Prisma] Failed to initialize PrismaClient in production.');
    }
    return false;
  }

  try {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`[Prisma] Connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const checkPromise = (async () => {
      await client.$connect();
      await client.$queryRaw`SELECT 1`;
      isPrismaConnected = true;
      console.log('[Prisma] Connected to PostgreSQL database.');
      return true;
    })();

    await Promise.race([checkPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);
    return true;
  } catch (err: unknown) {
    isPrismaConnected = false;
    const msg = err instanceof Error ? err.message : String(err);
    if (isProd) {
      console.error(`[Prisma] CRITICAL: Failed to connect to PostgreSQL in production: ${msg}`);
      throw new Error(`[Prisma] Failed to connect to PostgreSQL in production: ${msg}`);
    } else {
      console.warn(`[Prisma] Database connection deferred in development: ${msg}`);
      return false;
    }
  }
}

export function getPrismaClient(): PrismaClient | null {
  if (prismaInstance) return prismaInstance;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Prisma] CRITICAL: DATABASE_URL is not set in production.');
    } else {
      console.warn('[Prisma] DATABASE_URL not configured. Running in offline/development mode.');
    }
    return null;
  }

  try {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Prisma] Error initializing PrismaClient:', message);
    return null;
  }

  return prismaInstance;
}

export async function isPrismaHealthy(): Promise<boolean> {
  const client = getPrismaClient();
  if (!client) return false;
  try {
    await client.$queryRaw`SELECT 1`;
    isPrismaConnected = true;
    return true;
  } catch (err: unknown) {
    isPrismaConnected = false;
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    try {
      await prismaInstance.$disconnect();
    } catch {
      // Ignore on exit
    }
    prismaInstance = null;
    isPrismaConnected = false;
  }
}

export async function recordMatchCompletion(data: {
  serverName: string;
  nickname: string;
  finalScore: number;
  durationSec: number;
  loadoutUsed?: unknown;
}): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma || !isPrismaConnected) return;

  try {
    await prisma.$transaction(async (tx) => {
      let user = await tx.user.findFirst({
        where: { nickname: data.nickname },
      });

      if (!user) {
        user = await tx.user.create({
          data: { nickname: data.nickname },
        });
      }

      await tx.scoreHistory.create({
        data: {
          userId: user.id,
          nickname: data.nickname,
          score: data.finalScore,
          survivalSec: data.durationSec,
        },
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Prisma] Failed to record match score:', msg);
  }
}
