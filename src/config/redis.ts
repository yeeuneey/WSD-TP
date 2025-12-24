import { createClient } from "redis";
import { env } from "./env";

type RedisLike = {
  set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<number>;
  exists: (key: string) => Promise<number>;
  flushDb: () => Promise<unknown>;
  quit: () => Promise<unknown>;
};

type MemoryEntry = {
  value: string;
  expiresAt?: number;
};

const createInMemoryRedis = (): RedisLike => {
  const store = new Map<string, MemoryEntry>();

  const isExpired = (entry: MemoryEntry): boolean =>
    entry.expiresAt !== undefined && entry.expiresAt <= Date.now();

  return {
    set: async (key, value, options) => {
      const expiresAt =
        options?.EX !== undefined ? Date.now() + options.EX * 1000 : undefined;
      store.set(key, { value, expiresAt });
      return "OK";
    },
    get: async (key) => {
      const entry = store.get(key);
      if (!entry) {
        return null;
      }
      if (isExpired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    del: async (key) => {
      return store.delete(key) ? 1 : 0;
    },
    exists: async (key) => {
      const entry = store.get(key);
      if (!entry) {
        return 0;
      }
      if (isExpired(entry)) {
        store.delete(key);
        return 0;
      }
      return 1;
    },
    flushDb: async () => {
      store.clear();
    },
    quit: async () => {
      store.clear();
    },
  };
};

const redisUrl = `redis://${env.REDIS_HOST}:${env.REDIS_PORT}`;
const inMemoryRedis = createInMemoryRedis();

let redisImpl: RedisLike | null = null;
let initPromise: Promise<void> | null = null;

const initRedis = async (): Promise<void> => {
  if (redisImpl) {
    return;
  }

  if (process.env.REDIS_DISABLED === "true") {
    redisImpl = inMemoryRedis;
    return;
  }

  const client = createClient({ url: redisUrl });

  try {
    await client.connect();
    redisImpl = client;
  } catch (error) {
    if (env.NODE_ENV !== "production") {
      console.warn(
        "Redis unavailable; using in-memory session store for non-production.",
      );
      redisImpl = inMemoryRedis;
      return;
    }
    throw error;
  }
};

const getRedisImpl = async (): Promise<RedisLike> => {
  if (!redisImpl) {
    initPromise ??= initRedis();
    await initPromise;
  }
  return redisImpl ?? inMemoryRedis;
};

export const redis: RedisLike = {
  set: async (key, value, options) => {
    const impl = await getRedisImpl();
    return impl.set(key, value, options);
  },
  get: async (key) => {
    const impl = await getRedisImpl();
    return impl.get(key);
  },
  del: async (key) => {
    const impl = await getRedisImpl();
    return impl.del(key);
  },
  exists: async (key) => {
    const impl = await getRedisImpl();
    return impl.exists(key);
  },
  flushDb: async () => {
    const impl = await getRedisImpl();
    return impl.flushDb();
  },
  quit: async () => {
    const impl = await getRedisImpl();
    return impl.quit();
  },
};

export const ensureRedisConnection = async (): Promise<void> => {
  await getRedisImpl();
};
