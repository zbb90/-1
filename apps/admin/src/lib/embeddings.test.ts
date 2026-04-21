import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetEmbeddingCacheForTests, embedTexts } from "./embeddings";

describe("embedTexts caching and concurrency", () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.DASHSCOPE_API_KEY;
  const originalDisable = process.env.EMBEDDING_CACHE_DISABLE;

  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-key";
    delete process.env.EMBEDDING_CACHE_DISABLE;
    __resetEmbeddingCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalApiKey;
    if (originalDisable === undefined) delete process.env.EMBEDDING_CACHE_DISABLE;
    else process.env.EMBEDDING_CACHE_DISABLE = originalDisable;
  });

  it("caches identical text and skips network on second call", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [1, 2, 3], index: 0 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const first = await embedTexts(["hello"]);
    const second = await embedTexts(["hello"]);

    expect(first).toEqual([[1, 2, 3]]);
    expect(second).toEqual([[1, 2, 3]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when EMBEDDING_CACHE_DISABLE=1", async () => {
    process.env.EMBEDDING_CACHE_DISABLE = "1";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [9, 9], index: 0 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await embedTexts(["abc"]);
    await embedTexts(["abc"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when network fails", async () => {
    const fetchMock = vi.fn(async () => new Response("fail", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const result = await embedTexts(["x"]);
    expect(result).toBeNull();
  });
});
