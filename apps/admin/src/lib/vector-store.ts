import { QdrantClient } from "@qdrant/js-client-rest";
import { embedTexts, isEmbeddingConfigured } from "@/lib/embeddings";
import type {
  RegularQuestionRequest,
  RuleRow,
  SemanticRuleRecallCandidate,
} from "@/lib/types";

const DEFAULT_COLLECTION_NAME = "audit-regular-question-rules";
const DEFAULT_RECALL_LIMIT = 12;

type RuleVectorPayload = {
  ruleId: string;
  category: string;
  clauseTitle: string;
  clauseNo: string;
  consensusSource: string;
  status: string;
  document: string;
};

let qdrantClient: QdrantClient | null = null;

function getQdrantUrl() {
  return process.env.QDRANT_URL?.trim();
}

function getQdrantApiKey() {
  return process.env.QDRANT_API_KEY?.trim();
}

export function getQdrantCollectionName() {
  return (
    process.env.QDRANT_COLLECTION_NAME?.trim() || DEFAULT_COLLECTION_NAME
  );
}

export function getSemanticRecallLimit() {
  const raw = process.env.SEMANTIC_RECALL_LIMIT?.trim();
  const parsed = raw ? Number(raw) : DEFAULT_RECALL_LIMIT;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RECALL_LIMIT;
}

export function isSemanticSearchConfigured() {
  return Boolean(isEmbeddingConfigured() && getQdrantUrl());
}

function getQdrantClient() {
  if (qdrantClient) {
    return qdrantClient;
  }

  const url = getQdrantUrl();
  if (!url) {
    return null;
  }

  qdrantClient = new QdrantClient({
    url,
    apiKey: getQdrantApiKey(),
    checkCompatibility: false,
    timeout: 30_000,
  });
  return qdrantClient;
}

export function buildRuleVectorDocument(rule: RuleRow) {
  return [
    `问题分类：${rule.问题分类 || "-"}`,
    `关键词：${rule.问题子类或关键词 || "-"}`,
    `场景描述：${rule.场景描述 || "-"}`,
    `触发条件：${rule.触发条件 || "-"}`,
    `条款标题：${rule.条款标题 || "-"}`,
    `条款编号：${rule.条款编号 || "-"}`,
    `条款片段：${rule.条款关键片段 || "-"}`,
    `条款解释：${rule.条款解释 || "-"}`,
    `示例问法：${rule.示例问法 || "-"}`,
  ].join("\n");
}

export function buildRegularQuestionQueryText(
  request: RegularQuestionRequest,
) {
  return [
    `问题分类：${request.category?.trim() || "-"}`,
    `门店问题：${request.issueTitle?.trim() || "-"}`,
    `问题描述：${request.description?.trim() || "-"}`,
    `自行判断：${request.selfJudgment?.trim() || "-"}`,
  ].join("\n");
}

function buildRulePayload(rule: RuleRow): RuleVectorPayload {
  return {
    ruleId: rule.rule_id,
    category: rule.问题分类,
    clauseTitle: rule.条款标题,
    clauseNo: rule.条款编号,
    consensusSource: rule.共识来源,
    status: rule.状态,
    document: buildRuleVectorDocument(rule),
  };
}

async function ensureCollection(vectorSize: number) {
  const client = getQdrantClient();
  if (!client) {
    return false;
  }

  try {
    await client.getCollection(getQdrantCollectionName());
    return true;
  } catch {
    await client.createCollection(getQdrantCollectionName(), {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
    return true;
  }
}

export async function upsertRuleVectors(rules: RuleRow[]) {
  if (!isSemanticSearchConfigured()) {
    return { ok: false, reason: "semantic search not configured", count: 0 };
  }

  const normalizedRules = rules.filter((rule) => rule.rule_id?.trim());
  if (normalizedRules.length === 0) {
    return { ok: true, count: 0 };
  }

  const documents = normalizedRules.map(buildRuleVectorDocument);
  const embeddings = await embedTexts(documents);
  if (!embeddings || embeddings.length !== normalizedRules.length) {
    return { ok: false, reason: "embedding failed", count: 0 };
  }

  const client = getQdrantClient();
  if (!client) {
    return { ok: false, reason: "qdrant not configured", count: 0 };
  }

  await ensureCollection(embeddings[0].length);
  await client.upsert(getQdrantCollectionName(), {
    wait: true,
    points: normalizedRules.map((rule, index) => ({
      id: rule.rule_id,
      vector: embeddings[index],
      payload: buildRulePayload(rule),
    })),
  });

  return { ok: true, count: normalizedRules.length };
}

export async function rebuildRuleVectorIndex(rules: RuleRow[]) {
  if (!isSemanticSearchConfigured()) {
    return { ok: false, reason: "semantic search not configured", count: 0 };
  }

  const client = getQdrantClient();
  if (!client) {
    return { ok: false, reason: "qdrant not configured", count: 0 };
  }

  try {
    await client.deleteCollection(getQdrantCollectionName());
  } catch {
    // 集合不存在时忽略
  }

  const enabledRules = rules.filter((rule) => rule.状态 !== "停用");
  return upsertRuleVectors(enabledRules);
}

export async function searchRuleVectors(
  request: RegularQuestionRequest,
  limit = getSemanticRecallLimit(),
) {
  const queryText = buildRegularQuestionQueryText(request);

  if (!isSemanticSearchConfigured()) {
    return {
      queryText,
      hits: [] as SemanticRuleRecallCandidate[],
      fallbackReason: "未配置 DashScope Embedding 或 Qdrant，使用旧版规则扫描。",
    };
  }

  const queryEmbeddings = await embedTexts([queryText]);
  const queryVector = queryEmbeddings?.[0];
  if (!queryVector?.length) {
    return {
      queryText,
      hits: [] as SemanticRuleRecallCandidate[],
      fallbackReason: "Embedding 生成失败，使用旧版规则扫描。",
    };
  }

  const client = getQdrantClient();
  if (!client) {
    return {
      queryText,
      hits: [] as SemanticRuleRecallCandidate[],
      fallbackReason: "Qdrant 未配置，使用旧版规则扫描。",
    };
  }

  try {
    const results = await client.search(getQdrantCollectionName(), {
      vector: queryVector,
      limit,
      with_payload: true,
      filter: {
        must: [
          {
            key: "status",
            match: { value: "启用" },
          },
        ],
      },
    });

    const hits = results.map((item) => {
      const payload = (item.payload ?? {}) as Partial<RuleVectorPayload>;
      return {
        ruleId: payload.ruleId?.trim() || String(item.id),
        category: payload.category?.trim() || "-",
        clauseTitle: payload.clauseTitle?.trim() || "-",
        vectorScore: item.score ?? 0,
      };
    });

    return {
      queryText,
      hits,
    };
  } catch (error) {
    console.error("Qdrant semantic search failed", error);
    return {
      queryText,
      hits: [] as SemanticRuleRecallCandidate[],
      fallbackReason: "Qdrant 查询失败，已自动回退到旧版规则扫描。",
    };
  }
}
