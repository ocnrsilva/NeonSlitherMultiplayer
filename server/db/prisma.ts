let prismaInstance: any = null;
let isPrismaConnected = false;

export function getPrismaClient(): any {
  if (prismaInstance) return prismaInstance;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return null;
  }

  try {
    // Dynamically load PrismaClient if available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/client');
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    prismaInstance
      .$connect()
      .then(() => {
        isPrismaConnected = true;
        console.log('[Prisma] Connected to PostgreSQL database.');
      })
      .catch((err: any) => {
        console.warn('[Prisma] Database connection deferred:', err.message);
        isPrismaConnected = false;
      });
  } catch (err: any) {
    console.warn('[Prisma] PrismaClient deferred or unavailable in this environment:', err?.message);
    return null;
  }

  return prismaInstance;
}

export async function recordMatchCompletion(data: {
  serverName: string;
  nickname: string;
  finalScore: number;
  durationSec: number;
  loadoutUsed?: any;
}): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma || !isPrismaConnected) return;

  try {
    await prisma.$transaction(async (tx: any) => {
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
  } catch (err: any) {
    console.warn('[Prisma] Failed to record match score:', err.message);
  }
}
