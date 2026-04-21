import { createHash } from "node:crypto";

const DASHSCOPE_EMBEDDING_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const DEFAULT_EMBEDDING_MODEL_NAME = "text-embedding-v4";
const REQUEST_TIMEOUT_MS = 12000;
const MAX_BATCH_SIZE = 10;

const DEFAULT_CACHE_CAPACITY = 2000;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = 8;

function getDashScopeApiKey() {
  return process.env.DASHSCOPE_API_KEY?.trim();
}

export function getEmbeddingModelName() {
  return process.env.EMBEDDING_MODEL_NAME?.trim() || DEFAULT_EMBEDDING_MODEL_NAME;
}

export function getEmbeddingDimensions() {
  const raw = process.env.EMBEDDING_DIMENSIONS?.trim();
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isEmbeddingConfigured() {
  return Boolean(getDashScopeApiKey());
}

function isCacheDisabled() {
  return process.env.EMBEDDING_CACHE_DISABLE === "1";
}

function getConcurrency() {
  const raw = process.env.EMBEDDING_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_CONCURRENCY;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONCURRENCY;
  return Math.min(n, 64);
}

interface CacheEntry {
  vector: number[];
  expireAt: number;
}

// 朴素 LRU + TTL：使用 Map 的插入顺序作为最近访问序，命中时 delete 再 set 把它放到末尾。
const embeddingCache = new Map<string, CacheEntry>();

function buildCacheKey(model: string, text: string) {
  const dim = getEmbeddingDimensions();
  const hash = createHash("sha1").update(text).digest("hex");
  return `${model}:${dim ?? "default"}:${hash}`;
}

function readCache(model: string, text: string): number[] | null {
  if (isCacheDisabled()) return null;
  const key = buildCacheKey(model, text);
  const entry = embeddingCache.get(key);
  if (!entry) return null;
  if (entry.expireAt <= Date.now()) {
    embeddingCache.delete(key);
    return null;
  }
  embeddingCache.delete(key);
  embeddingCache.set(key, entry);
  return entry.vector;
}

function writeCache(model: string, text: string, vector: number[]) {
  if (isCacheDisabled()) return;
  if (!vector?.length) return;
  const key = buildCacheKey(model, text);
  embeddingCache.set(key, {
    vector,
    expireAt: Date.now() + DEFAULT_CACHE_TTL_MS,
  });
  while (embeddingCache.size > DEFAULT_CACHE_CAPACITY) {
    const oldest = embeddingCache.keys().next().value;
    if (oldest === undefined) break;
    embeddingCache.delete(oldest);
  }
}

// 简易 semaphore：限制并发的对外 DashScope 调用数，防止突发流量打爆配额。
let activeRequests = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot() {
  const limit = getConcurrency();
  if (activeRequests < limit) {
    activeRequests += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
  activeRequests += 1;
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = waitQueue.shift();
  if (next) next();
}

async function requestDashScopeEmbeddingsBatch(input: string[]) {
  const apiKey = getDashScopeApiKey();
  if (!apiKey || input.length === 0) {
    return null;
  }

  await acquireSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(DASHSCOPE_EMBEDDING_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getEmbeddingModelName(),
        input,
        encoding_format: "float",
        dimensions: getEmbeddingDimensions(),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("DashScope embedding request failed", response.status);
      return null;
    }

    const data = (await response.json()) as {
      data?: Array<{
        embedding?: number[];
        index?: number;
      }>;
    };

    if (!data.data?.length) {
      return null;
    }

    const ordered = [...data.data].sort(
      (left, right) => (left.index ?? 0) - (right.index ?? 0),
    );
    return ordered.map((item) => item.embedding ?? []);
  } catch (error) {
    console.error("DashScope embedding error", error);
    return null;
  } finally {
    clearTimeout(timeout);
    releaseSlot();
  }
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const model = getEmbeddingModelName();
  const result: (number[] | null)[] = new Array(texts.length).fill(null);
  const missingIndexes: number[] = [];
  const missingTexts: string[] = [];

  for (let i = 0; i < texts.length; i += 1) {
    const cached = readCache(model, texts[i]);
    if (cached) {
      result[i] = cached;
    } else {
      missingIndexes.push(i);
      missingTexts.push(texts[i]);
    }
  }

  for (let offset = 0; offset < missingTexts.length; offset += MAX_BATCH_SIZE) {
    const batch = missingTexts.slice(offset, offset + MAX_BATCH_SIZE);
    const embeddings = await requestDashScopeEmbeddingsBatch(batch);
    if (!embeddings || embeddings.length !== batch.length) {
      return null;
    }
    embeddings.forEach((vector, idx) => {
      const targetIndex = missingIndexes[offset + idx];
      result[targetIndex] = vector;
      writeCache(model, missingTexts[offset + idx], vector);
    });
  }

  // 全部位置由缓存命中或本次请求填充。
  return result as number[][];
}

export function __resetEmbeddingCacheForTests() {
  embeddingCache.clear();
  activeRequests = 0;
  waitQueue.length = 0;
}
