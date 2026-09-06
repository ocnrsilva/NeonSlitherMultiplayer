import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | null = null;
let isPrismaConnected = false;

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

    prismaInstance
      .$connect()
      .then(() => {
        isPrismaConnected = true;
        console.log('[Prisma] Connected to PostgreSQL database.');
      })
      .catch((err: Error) => {
        isPrismaConnected = false;
        if (process.env.NODE_ENV === 'production') {
          console.error('[Prisma] CRITICAL: Failed to connect to PostgreSQL in production:', err.message);
        } else {
          console.warn('[Prisma] Database connection deferred in development:', err.message);
        }
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
