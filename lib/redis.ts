/**
 * Redis client for cache. Only created when REDIS_URL is set.
 * Used by lib/cache.ts for shared cache across instances.
 */
import Redis from 'ioredis';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client !== null) return client;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        if (times > 2) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });
    return client;
  } catch {
    return null;
  }
}

export async function pingRedis(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
