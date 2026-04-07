import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;

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

/**
 * 简单滑动窗口限流（单进程内存）。多实例部署时每个实例独立计数；
 * 若需全局限流可后续换 Upstash Ratelimit。
 */
export function rateLimit(
  request: NextRequest,
  routeKey: string,
  maxPerWindow: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  cleanup(now);
  const key = clientKey(request, routeKey);
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
