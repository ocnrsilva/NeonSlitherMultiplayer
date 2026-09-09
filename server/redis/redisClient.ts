import Redis from 'ioredis';

let redisInstance: Redis | null = null;
let isRedisAvailable = false;
const memoryStore = new Map<string, { value: string; expiresAt: number }>();

export async function initRedis(timeoutMs = 5000): Promise<boolean> {
  const isProd = process.env.NODE_ENV === 'production';
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    if (isProd) {
      console.error('[Redis] CRITICAL: REDIS_URL is mandatory in production. No silent fallback permitted.');
      throw new Error('[Redis] REDIS_URL is mandatory in production. Refusing to start.');
    }
    console.warn('[Redis] No REDIS_URL configured; using in-memory store for development session caching.');
    return true;
  }

  console.log('[Redis] Connecting to Redis server...');

  if (!redisInstance) {
    redisInstance = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2500,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 5) {
          isRedisAvailable = false;
          return null; // Stop retrying after 5 attempts
        }
        return Math.min(times * 500, 2000);
      },
    });

    redisInstance.on('connect', () => {
      console.log('[Redis] Connected successfully to Redis server.');
      isRedisAvailable = true;
    });

    redisInstance.on('error', (err) => {
      isRedisAvailable = false;
      if (process.env.NODE_ENV === 'production') {
        console.error('[Redis] Connection error in production:', err.message);
      } else {
        console.warn('[Redis] Connection warning (dev memory fallback active):', err.message);
      }
    });
  }

  if (isRedisAvailable) {
    return true;
  }

  try {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`[Redis] Connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const connectPromise = (async () => {
      if (redisInstance!.status === 'wait') {
        await redisInstance!.connect();
      }
      const pong = await redisInstance!.ping();
      if (pong === 'PONG') {
        isRedisAvailable = true;
        return true;
      }
      throw new Error(`[Redis] Unexpected ping response: ${pong}`);
    })();

    await Promise.race([connectPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);
    return true;
  } catch (err: unknown) {
    isRedisAvailable = false;
    const msg = err instanceof Error ? err.message : String(err);
    if (isProd) {
      console.error(`[Redis] CRITICAL: Failed to connect to Redis in production: ${msg}`);
      throw new Error(`[Redis] Failed to connect to Redis in production: ${msg}`);
    } else {
      console.warn(`[Redis] Connection warning (dev memory fallback active): ${msg}`);
      return false;
    }
  }
}

export function getRedisClient(): Redis | null {
  if (redisInstance) return isRedisAvailable ? redisInstance : null;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Redis] CRITICAL: REDIS_URL is mandatory in production. No silent fallback permitted.');
    } else {
      console.warn('[Redis] No REDIS_URL configured; using in-memory store for development session caching.');
    }
    return null;
  }

  try {
    redisInstance = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2500,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 5) {
          isRedisAvailable = false;
          return null; // Stop retrying after 5 attempts
        }
        return Math.min(times * 500, 2000);
      },
    });

    redisInstance.on('connect', () => {
      console.log('[Redis] Connected successfully to Redis server.');
      isRedisAvailable = true;
    });

    redisInstance.on('error', (err) => {
      isRedisAvailable = false;
      if (process.env.NODE_ENV === 'production') {
        console.error('[Redis] Connection error in production:', err.message);
      } else {
        console.warn('[Redis] Connection warning (dev memory fallback active):', err.message);
      }
    });

    redisInstance.connect().catch((err: Error) => {
      isRedisAvailable = false;
      if (process.env.NODE_ENV === 'production') {
        console.error('[Redis] Failed to connect to Redis server in production:', err.message);
      } else {
        console.warn('[Redis] Failed to connect to Redis (dev fallback active):', err.message);
      }
    });
  } catch (err: unknown) {
    isRedisAvailable = false;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Redis] Initialization error:', message);
  }

  return isRedisAvailable ? redisInstance : null;
}

export async function isRedisHealthy(): Promise<boolean> {
  // In development, if Redis is omitted, local dev is allowed
  if (process.env.NODE_ENV !== 'production' && !process.env.REDIS_URL) {
    return true;
  }

  const client = getRedisClient();
  if (!client) return false;

  try {
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const client = getRedisClient();

  if (client && isRedisAvailable) {
    try {
      await client.setex(key, ttlSeconds, value);
      return;
    } catch (err: unknown) {
      if (isProd) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[Redis] Failed to set key '${key}' in production: ${msg}`);
      }
    }
  }

  if (isProd) {
    throw new Error(`[Redis] Redis unavailable in production. Refusing silent fallback for key '${key}'.`);
  }

  // Development only fallback
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function cacheGet(key: string): Promise<string | null> {
  const isProd = process.env.NODE_ENV === 'production';
  const client = getRedisClient();

  if (client && isRedisAvailable) {
    try {
      return await client.get(key);
    } catch (err: unknown) {
      if (isProd) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[Redis] Failed to get key '${key}' in production: ${msg}`);
      }
    }
  }

  if (isProd) {
    throw new Error(`[Redis] Redis unavailable in production. Refusing silent fallback for key '${key}'.`);
  }

  // Development only fallback
  const item = memoryStore.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return item.value;
}

export async function cacheDel(key: string): Promise<void> {
  const client = getRedisClient();
  if (client && isRedisAvailable) {
    try {
      await client.del(key);
      return;
    } catch {
      // Ignore deletion errors on cleanup
    }
  }
  memoryStore.delete(key);
}

export async function disconnectRedis(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch {
      // Ignore on exit
    }
    redisInstance = null;
    isRedisAvailable = false;
  }
}

// Periodic cleanup for expired keys in fallback memory store (dev only)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memoryStore.entries()) {
    if (now > v.expiresAt) {
      memoryStore.delete(k);
    }
  }
}, 30000);
