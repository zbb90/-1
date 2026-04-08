let redisInstance: import("@upstash/redis").Redis | null = null;

export function isRedisConfigured() {
  return Boolean(
    process.env.KV_REST_API_URL?.trim() && process.env.KV_REST_API_TOKEN?.trim(),
  );
}

export async function getRedis() {
  if (redisInstance) {
    return redisInstance;
  }

  const { Redis } = await import("@upstash/redis");
  redisInstance = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
  return redisInstance;
}
