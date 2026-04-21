import type { NextRequest } from "next/server";
import { getRedis, isRedisConfigured } from "@/lib/redis-client";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const REDIS_KEY_PREFIX = "audit:ratelimit:";

function cleanup(now: number) {
  if (buckets.size < 10_000) return;
  for (const [key, b] of buckets.entries()) {
    if (b.resetAt < now) buckets.delete(key);
  }
}

function clientKey(request: NextRequest, routeKey: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${routeKey}:${ip}`;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

function rateLimitMemory(key: string, maxPerWindow: number): RateLimitResult {
  const now = Date.now();
  cleanup(now);
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }
  if (b.count >= maxPerWindow) {
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  b.count += 1;
  return { ok: true };
}

async function rateLimitRedis(
  key: string,
  maxPerWindow: number,
): Promise<RateLimitResult | null> {
  if (!isRedisConfigured()) return null;
  try {
    const redis = await getRedis();
    const redisKey = `${REDIS_KEY_PREFIX}${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, WINDOW_MS);
    }
    if (count > maxPerWindow) {
      const ttl = await redis.pttl(redisKey);
      const retryAfterSec = Math.max(1, Math.ceil((ttl > 0 ? ttl : WINDOW_MS) / 1000));
      return { ok: false, retryAfterSec };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[rate-limit] redis backend unavailable, fallback to memory", err);
    return null;
  }
}

/**
 * 多实例安全的限流。优先走 Redis（INCR + PEXPIRE），Redis 不可用时自动回退到进程内 Map。
 * 单进程开发与生产 Redis 部署都可直接使用。
 */
export async function rateLimit(
  request: NextRequest,
  routeKey: string,
  maxPerWindow: number,
): Promise<RateLimitResult> {
  const key = clientKey(request, routeKey);
  const redisResult = await rateLimitRedis(key, maxPerWindow);
  if (redisResult) return redisResult;
  return rateLimitMemory(key, maxPerWindow);
}
