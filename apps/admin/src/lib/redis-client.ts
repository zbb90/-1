import { Redis } from "ioredis";

type JsonLike = Record<string, unknown> | unknown[];

type ZaddInput = {
  score: number;
  member: string;
};

type ZrangeOptions = {
  rev?: boolean;
};

type ScanOptions = {
  match?: string;
  count?: number;
};

function looksLikeJson(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseStoredValue<T>(value: unknown): T | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return value as T;
  }

  if (looksLikeJson(value)) {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  return value as T;
}

function resolveRedisUrl() {
  const directUrl = process.env.REDIS_URL?.trim();
  if (directUrl) {
    return directUrl;
  }

  const host = process.env.REDIS_HOST?.trim();
  if (!host) {
    return null;
  }

  const protocol = process.env.REDIS_TLS?.trim() === "true" ? "rediss" : "redis";
  const port = process.env.REDIS_PORT?.trim() || "6379";
  const db = process.env.REDIS_DB?.trim() || "0";
  const username = process.env.REDIS_USERNAME?.trim();
  const password = process.env.REDIS_PASSWORD?.trim();

  const auth =
    username || password
      ? `${encodeURIComponent(username || "default")}:${encodeURIComponent(password || "")}@`
      : "";

  return `${protocol}://${auth}${host}:${port}/${db}`;
}

class CompatPipeline {
  constructor(private readonly pipelineImpl: ReturnType<Redis["pipeline"]>) {}

  set(key: string, value: string | JsonLike) {
    const payload = typeof value === "string" ? value : JSON.stringify(value);
    this.pipelineImpl.set(key, payload);
    return this;
  }

  get(key: string) {
    this.pipelineImpl.get(key);
    return this;
  }

  zadd(key: string, input: ZaddInput) {
    this.pipelineImpl.zadd(key, input.score, input.member);
    return this;
  }

  sadd(key: string, member: string) {
    this.pipelineImpl.sadd(key, member);
    return this;
  }

  srem(key: string, member: string) {
    this.pipelineImpl.srem(key, member);
    return this;
  }

  del(key: string) {
    this.pipelineImpl.del(key);
    return this;
  }

  async exec() {
    const results = await this.pipelineImpl.exec();
    return (results ?? []).map(([error, value]) => {
      if (error) {
        throw error;
      }
      return parseStoredValue(value as string | null);
    });
  }
}

class CompatRedis {
  constructor(private readonly client: Redis) {}

  async exists(key: string) {
    return this.client.exists(key);
  }

  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return parseStoredValue<T>(value);
  }

  async set(key: string, value: string | JsonLike) {
    const payload = typeof value === "string" ? value : JSON.stringify(value);
    return this.client.set(key, payload);
  }

  async del(...keys: string[]) {
    if (keys.length === 0) {
      return 0;
    }
    return this.client.del(...keys);
  }

  async smembers(key: string) {
    return this.client.smembers(key);
  }

  async scard(key: string) {
    return this.client.scard(key);
  }

  async scan(cursor: string, options: ScanOptions = {}) {
    if (options.match && options.count) {
      return this.client.scan(cursor, "MATCH", options.match, "COUNT", options.count);
    }
    if (options.match) {
      return this.client.scan(cursor, "MATCH", options.match);
    }
    if (options.count) {
      return this.client.scan(cursor, "COUNT", options.count);
    }
    return this.client.scan(cursor);
  }

  async sadd(key: string, ...members: string[]) {
    if (members.length === 0) {
      return 0;
    }
    return this.client.sadd(key, ...members);
  }

  async zrange(key: string, start: number, stop: number, options?: ZrangeOptions) {
    if (options?.rev) {
      return this.client.zrevrange(key, start, stop);
    }
    return this.client.zrange(key, start, stop);
  }

  async zcard(key: string) {
    return this.client.zcard(key);
  }

  pipeline() {
    return new CompatPipeline(this.client.pipeline());
  }
}

let redisInstance: CompatRedis | null = null;

export function isRedisConfigured() {
  return Boolean(resolveRedisUrl());
}

export async function getRedis() {
  if (redisInstance) {
    return redisInstance;
  }

  const url = resolveRedisUrl();
  if (!url) {
    throw new Error("缺少 REDIS_URL 或 REDIS_HOST，Redis 未配置。");
  }

  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });

  redisInstance = new CompatRedis(client);
  return redisInstance;
}
