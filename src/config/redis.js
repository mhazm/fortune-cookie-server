import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisClient = null;
let isRedisConnected = false;
let hasLoggedDisconnect = false;

// In-Memory Fallback Map when Redis is unreachable / disabled
const memoryStore = new Map();
const memoryKeyExpiry = new Map();

/**
 * Initializes Redis connection with auto-reconnection and in-memory fallback.
 */
export function initRedis() {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis(REDIS_URL, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        // Exponential backoff up to 30s
        return Math.min(times * 1000, 30000);
      },
      lazyConnect: false,
      enableOfflineQueue: false,
    });

    redisClient.on("connect", () => {
      isRedisConnected = true;
      hasLoggedDisconnect = false;
      console.log(`[Redis] Connected successfully to ${REDIS_URL.replace(/:[^:]*@/, ":***@")}`);
    });

    redisClient.on("ready", () => {
      isRedisConnected = true;
    });

    redisClient.on("error", (err) => {
      isRedisConnected = false;
      if (!hasLoggedDisconnect) {
        console.warn(`[Redis] Connection warning: ${err.message}. Falling back to In-Memory Map store.`);
        hasLoggedDisconnect = true;
      }
    });

    redisClient.on("close", () => {
      isRedisConnected = false;
    });

    redisClient.on("reconnecting", () => {
      // Reconnecting silently
    });
  } catch (err) {
    isRedisConnected = false;
    console.warn(`[Redis] Init error (${err.message}). Using In-Memory Map store.`);
  }

  // Periodic cleanup for memory fallback store (every 30 seconds)
  setInterval(() => {
    const now = Date.now();
    for (const [key, exp] of memoryKeyExpiry.entries()) {
      if (exp <= now) {
        memoryStore.delete(key);
        memoryKeyExpiry.delete(key);
      }
    }
  }, 30000).unref();

  return redisClient;
}

export function isRedisReady() {
  return isRedisConnected && redisClient && redisClient.status === "ready";
}

/**
 * Saves live telemetry data with a TTL.
 * Uses Redis if available, otherwise transparently falls back to In-Memory Map.
 *
 * @param {string} driverKey e.g. "1:863959415702028318"
 * @param {object} telemetryData
 * @param {number} ttlSeconds Default 30s
 */
export async function setLiveTelemetry(driverKey, telemetryData, ttlSeconds = 30) {
  const jsonStr = JSON.stringify(telemetryData);

  if (isRedisReady()) {
    try {
      const pipeline = redisClient.pipeline();
      pipeline.set(`fleet:live:${driverKey}`, jsonStr, "EX", ttlSeconds);
      pipeline.sadd("fleet:active_drivers", driverKey);
      await pipeline.exec();
      return true;
    } catch (err) {
      // Fallback to in-memory on error
    }
  }

  // Fallback to memory
  const exp = Date.now() + ttlSeconds * 1000;
  memoryStore.set(`fleet:live:${driverKey}`, telemetryData);
  memoryKeyExpiry.set(`fleet:live:${driverKey}`, exp);
  return true;
}

/**
 * Retrieves all currently active live fleet telemetry objects.
 * Cleans up expired drivers automatically.
 */
export async function getAllLiveTelemetry() {
  const results = [];
  const now = Date.now();

  if (isRedisReady()) {
    try {
      const driverKeys = await redisClient.smembers("fleet:active_drivers");
      if (driverKeys && driverKeys.length > 0) {
        const pipeline = redisClient.pipeline();
        for (const k of driverKeys) {
          pipeline.get(`fleet:live:${k}`);
        }
        const replies = await pipeline.exec();
        const expiredKeys = [];

        replies.forEach(([err, rawVal], idx) => {
          const k = driverKeys[idx];
          if (!err && rawVal) {
            try {
              results.push(JSON.parse(rawVal));
            } catch {}
          } else {
            expiredKeys.push(k);
          }
        });

        if (expiredKeys.length > 0) {
          await redisClient.srem("fleet:active_drivers", ...expiredKeys);
        }
        return results;
      }
      return results;
    } catch (err) {
      // Fallback to memory on error
    }
  }

  // Memory fallback retrieval
  for (const [key, data] of memoryStore.entries()) {
    if (key.startsWith("fleet:live:")) {
      const exp = memoryKeyExpiry.get(key) || 0;
      if (exp > now) {
        results.push(data);
      } else {
        memoryStore.delete(key);
        memoryKeyExpiry.delete(key);
      }
    }
  }

  return results;
}

