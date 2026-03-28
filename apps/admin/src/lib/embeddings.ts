const DASHSCOPE_EMBEDDING_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const DEFAULT_EMBEDDING_MODEL_NAME = "text-embedding-v4";
const REQUEST_TIMEOUT_MS = 12000;
const MAX_BATCH_SIZE = 10;

function getDashScopeApiKey() {
  return process.env.DASHSCOPE_API_KEY?.trim();
}

export function getEmbeddingModelName() {
  return (
    process.env.EMBEDDING_MODEL_NAME?.trim() || DEFAULT_EMBEDDING_MODEL_NAME
  );
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

async function requestDashScopeEmbeddingsBatch(input: string[]) {
  const apiKey = getDashScopeApiKey();
  if (!apiKey || input.length === 0) {
    return null;
  }

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
  }
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const allEmbeddings: number[][] = [];
  for (let index = 0; index < texts.length; index += MAX_BATCH_SIZE) {
    const batch = texts.slice(index, index + MAX_BATCH_SIZE);
    const embeddings = await requestDashScopeEmbeddingsBatch(batch);
    if (!embeddings || embeddings.length !== batch.length) {
      return null;
    }
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}
