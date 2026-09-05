import Redis from 'ioredis';

let redisInstance: Redis | null = null;
let isRedisAvailable = false;
const memoryStore = new Map<string, { value: string; expiresAt: number }>();

export function getRedisClient(): Redis | null {
  if (redisInstance) return isRedisAvailable ? redisInstance : null;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[Redis] No REDIS_URL configured; using in-memory store for session caching.');
    return null;
  }

  try {
    redisInstance = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) {
          isRedisAvailable = false;
          return null; // Stop retrying
        }
        return Math.min(times * 1000, 3000);
      },
    });

    redisInstance.on('connect', () => {
      console.log('[Redis] Connected successfully.');
      isRedisAvailable = true;
    });

    redisInstance.on('error', (err) => {
      console.warn('[Redis] Connection warning (using fallback memory store):', err.message);
      isRedisAvailable = false;
    });

    redisInstance.connect().catch((err) => {
      console.warn('[Redis] Failed to connect to Redis server (fallback active):', err.message);
      isRedisAvailable = false;
    });
  } catch (err: any) {
    console.warn('[Redis] Initialization error:', err?.message);
    isRedisAvailable = false;
  }

  return isRedisAvailable ? redisInstance : null;
}

// Key-Value with TTL helper (uses Redis or in-memory fallback)
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const client = getRedisClient();
  if (client && isRedisAvailable) {
    try {
      await client.setex(key, ttlSeconds, value);
      return;
    } catch {
      // fallback to memory
    }
  }

  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function cacheGet(key: string): Promise<string | null> {
  const client = getRedisClient();
  if (client && isRedisAvailable) {
    try {
      return await client.get(key);
    } catch {
      // fallback to memory
    }
  }

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
      // fallback to memory
    }
  }
  memoryStore.delete(key);
}

// Periodic cleanup for expired keys in fallback memory store
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memoryStore.entries()) {
    if (now > v.expiresAt) {
      memoryStore.delete(k);
    }
  }
}, 30000);
