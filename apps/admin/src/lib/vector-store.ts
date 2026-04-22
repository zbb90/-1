import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { embedTexts, isEmbeddingConfigured } from "@/lib/embeddings";
import type {
  ConsensusRow,
  KnowledgeRecallKind,
  RegularQuestionIntentParse,
  RegularQuestionRequest,
  RuleRow,
  SemanticConsensusRecallCandidate,
  SemanticRuleRecallCandidate,
} from "@/lib/types";

const DEFAULT_COLLECTION_NAME = "audit-regular-question-rules";
const DEFAULT_RECALL_LIMIT = 12;

type RuleVectorPayload = {
  kind: "rule";
  ruleId: string;
  category: string;
  clauseTitle: string;
  clauseNo: string;
  consensusSource: string;
  status: string;
  document: string;
};

type ConsensusVectorPayload = {
  kind: "consensus";
  consensusId: string;
  title: string;
  applicableScene: string;
  relatedClauseNo: string;
  status: string;
  document: string;
};

type KnowledgeVectorPayload = RuleVectorPayload | ConsensusVectorPayload;

let qdrantClient: QdrantClient | null = null;

function getQdrantUrl() {
  return process.env.QDRANT_URL?.trim();
}

function getQdrantApiKey() {
  return process.env.QDRANT_API_KEY?.trim();
}

export function getQdrantCollectionName() {
  return process.env.QDRANT_COLLECTION_NAME?.trim() || DEFAULT_COLLECTION_NAME;
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
    `问题分类:${rule.问题分类 || "-"}`,
    `关键词:${rule.问题子类或关键词 || "-"}`,
    `场景描述:${rule.场景描述 || "-"}`,
    `触发条件:${rule.触发条件 || "-"}`,
    `条款标题:${rule.条款标题 || "-"}`,
    `条款编号:${rule.条款编号 || "-"}`,
    `条款片段:${rule.条款关键片段 || "-"}`,
    `条款解释:${rule.条款解释 || "-"}`,
    `示例问法:${rule.示例问法 || "-"}`,
  ].join("\n");
}

export function buildConsensusVectorDocument(consensus: ConsensusRow) {
  return [
    `共识标题:${consensus.标题 || "-"}`,
    `适用场景:${consensus.适用场景 || "-"}`,
    `关联条款编号:${consensus.关联条款编号 || "-"}`,
    `判定结果:${consensus.判定结果 || "-"}`,
    `关键词:${consensus.关键词 || "-"}`,
    `示例问题:${consensus.示例问题 || "-"}`,
    `解释内容:${consensus.解释内容 || "-"}`,
  ].join("\n");
}

export function buildRegularQuestionQueryText(
  request: RegularQuestionRequest,
  intent?: RegularQuestionIntentParse,
) {
  const lines = [
    `问题分类:${request.category?.trim() || "-"}`,
    `门店问题:${request.issueTitle?.trim() || "-"}`,
    `问题描述:${request.description?.trim() || "-"}`,
    `自行判断:${request.selfJudgment?.trim() || "-"}`,
  ];

  if (intent) {
    lines.push(`结构化分类:${intent.normalizedCategory || "-"}`);
    lines.push(`场景标签:${intent.sceneTags.join("、") || "-"}`);
    lines.push(`对象标签:${intent.objectTags.join("、") || "-"}`);
    lines.push(`问题标签:${intent.issueTags.join("、") || "-"}`);
    lines.push(`主张标签:${intent.claimTags.join("、") || "-"}`);
    lines.push(`排除标签:${intent.exclusionTags.join("、") || "-"}`);
    lines.push(`否定标签:${intent.negationTags.join("、") || "-"}`);
  }

  return lines.join("\n");
}

function buildRulePayload(rule: RuleRow): RuleVectorPayload {
  return {
    kind: "rule",
    ruleId: rule.rule_id,
    category: rule.问题分类,
    clauseTitle: rule.条款标题,
    clauseNo: rule.条款编号,
    consensusSource: rule.共识来源,
    status: rule.状态,
    document: buildRuleVectorDocument(rule),
  };
}

function buildConsensusPayload(consensus: ConsensusRow): ConsensusVectorPayload {
  return {
    kind: "consensus",
    consensusId: consensus.consensus_id,
    title: consensus.标题,
    applicableScene: consensus.适用场景,
    relatedClauseNo: consensus.关联条款编号,
    status: consensus.状态,
    document: buildConsensusVectorDocument(consensus),
  };
}

function buildPointId(namespace: "rule" | "consensus", id: string) {
  const normalized = `${namespace}:${id.trim()}`;
  const hex = createHash("md5").update(normalized).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function buildRulePointId(ruleId: string) {
  return buildPointId("rule", ruleId);
}

function buildConsensusPointId(consensusId: string) {
  return buildPointId("consensus", consensusId);
}

async function ensureCollection(vectorSize: number) {
  const client = getQdrantClient();
  if (!client) {
    return false;
  }

  try {
    await client.getCollection(getQdrantCollectionName());
  } catch {
    await client.createCollection(getQdrantCollectionName(), {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  }

  for (const field of ["status", "kind"] as const) {
    try {
      await client.createPayloadIndex(getQdrantCollectionName(), {
        wait: true,
        field_name: field,
        field_schema: "keyword",
      });
    } catch {
      // 索引已存在或短暂不可用时忽略，避免影响主流程
    }
  }

  return true;
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
      id: buildRulePointId(rule.rule_id),
      vector: embeddings[index],
      payload: buildRulePayload(rule),
    })),
  });

  return { ok: true, count: normalizedRules.length };
}

export async function upsertConsensusVectors(rows: ConsensusRow[]) {
  if (!isSemanticSearchConfigured()) {
    return { ok: false, reason: "semantic search not configured", count: 0 };
  }

  const normalized = rows.filter((row) => row.consensus_id?.trim());
  if (normalized.length === 0) {
    return { ok: true, count: 0 };
  }

  const documents = normalized.map(buildConsensusVectorDocument);
  const embeddings = await embedTexts(documents);
  if (!embeddings || embeddings.length !== normalized.length) {
    return { ok: false, reason: "embedding failed", count: 0 };
  }

  const client = getQdrantClient();
  if (!client) {
    return { ok: false, reason: "qdrant not configured", count: 0 };
  }

  await ensureCollection(embeddings[0].length);
  await client.upsert(getQdrantCollectionName(), {
    wait: true,
    points: normalized.map((row, index) => ({
      id: buildConsensusPointId(row.consensus_id),
      vector: embeddings[index],
      payload: buildConsensusPayload(row),
    })),
  });

  return { ok: true, count: normalized.length };
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

/**
 * 重建整张知识向量库（rules + consensus）。线上首次启用 B 档（双源召回）时务必跑一次。
 */
export async function rebuildKnowledgeVectorIndex(
  rules: RuleRow[],
  consensus: ConsensusRow[],
) {
  if (!isSemanticSearchConfigured()) {
    return {
      ok: false,
      reason: "semantic search not configured",
      rules: 0,
      consensus: 0,
    };
  }

  const client = getQdrantClient();
  if (!client) {
    return { ok: false, reason: "qdrant not configured", rules: 0, consensus: 0 };
  }

  try {
    await client.deleteCollection(getQdrantCollectionName());
  } catch {
    // 集合不存在时忽略
  }

  const enabledRules = rules.filter((rule) => rule.状态 !== "停用");
  const enabledConsensus = consensus.filter((row) => row.状态 !== "停用");

  const ruleResult = await upsertRuleVectors(enabledRules);
  const consensusResult = await upsertConsensusVectors(enabledConsensus);

  return {
    ok: ruleResult.ok && consensusResult.ok,
    rules: ruleResult.count ?? 0,
    consensus: consensusResult.count ?? 0,
    ruleReason: ruleResult.ok ? undefined : ruleResult.reason,
    consensusReason: consensusResult.ok ? undefined : consensusResult.reason,
  };
}

type SearchKnowledgeVectorsOptions = {
  limit?: number;
  // 默认两类都召回；外部可指定 ["rule"] 或 ["consensus"] 强制单源。
  kinds?: KnowledgeRecallKind[];
};

export type KnowledgeRecallHit =
  | { kind: "rule"; rule: SemanticRuleRecallCandidate }
  | { kind: "consensus"; consensus: SemanticConsensusRecallCandidate };

export type KnowledgeRecallResult = {
  queryText: string;
  hits: KnowledgeRecallHit[];
  ruleHits: SemanticRuleRecallCandidate[];
  consensusHits: SemanticConsensusRecallCandidate[];
  fallbackReason?: string;
};

/**
 * 双源（rules + consensus）语义召回。后续阶段 2 引入 FAQ 时只需在 collection 里增加 kind="faq"
 * 的 payload 并扩展过滤即可。
 */
export async function searchKnowledgeVectors(
  request: RegularQuestionRequest,
  intent?: RegularQuestionIntentParse,
  options: SearchKnowledgeVectorsOptions = {},
): Promise<KnowledgeRecallResult> {
  const queryText = buildRegularQuestionQueryText(request, intent);
  const limit = options.limit ?? getSemanticRecallLimit();
  const kinds =
    options.kinds && options.kinds.length > 0
      ? options.kinds
      : (["rule", "consensus"] as KnowledgeRecallKind[]);

  if (!isSemanticSearchConfigured()) {
    return {
      queryText,
      hits: [],
      ruleHits: [],
      consensusHits: [],
      fallbackReason: "未配置 DashScope Embedding 或 Qdrant，使用旧版规则扫描。",
    };
  }

  const queryEmbeddings = await embedTexts([queryText]);
  const queryVector = queryEmbeddings?.[0];
  if (!queryVector?.length) {
    return {
      queryText,
      hits: [],
      ruleHits: [],
      consensusHits: [],
      fallbackReason: "Embedding 生成失败，使用旧版规则扫描。",
    };
  }

  const client = getQdrantClient();
  if (!client) {
    return {
      queryText,
      hits: [],
      ruleHits: [],
      consensusHits: [],
      fallbackReason: "Qdrant 未配置，使用旧版规则扫描。",
    };
  }

  try {
    const must: Record<string, unknown>[] = [
      {
        key: "status",
        match: { value: "启用" },
      },
    ];
    if (kinds.length === 1) {
      must.push({ key: "kind", match: { value: kinds[0] } });
    }

    const results = await client.search(getQdrantCollectionName(), {
      vector: queryVector,
      limit,
      with_payload: true,
      filter: { must },
    });

    const hits: KnowledgeRecallHit[] = [];
    const ruleHits: SemanticRuleRecallCandidate[] = [];
    const consensusHits: SemanticConsensusRecallCandidate[] = [];

    for (const item of results) {
      const payload = (item.payload ?? {}) as Partial<KnowledgeVectorPayload>;
      // 旧数据没有 kind 字段，按 rule 兼容（rebuild 后会带上 kind）。
      const kind = (payload.kind as KnowledgeRecallKind | undefined) ?? "rule";

      if (kind === "consensus" && (payload as ConsensusVectorPayload).consensusId) {
        const cs = payload as Partial<ConsensusVectorPayload>;
        const candidate: SemanticConsensusRecallCandidate = {
          consensusId: cs.consensusId?.trim() || String(item.id),
          title: cs.title?.trim() || "-",
          applicableScene: cs.applicableScene?.trim() || "-",
          relatedClauseNo: cs.relatedClauseNo?.trim() || "",
          vectorScore: item.score ?? 0,
        };
        if (kinds.includes("consensus")) {
          consensusHits.push(candidate);
          hits.push({ kind: "consensus", consensus: candidate });
        }
      } else {
        const rl = payload as Partial<RuleVectorPayload>;
        const candidate: SemanticRuleRecallCandidate = {
          ruleId: rl.ruleId?.trim() || String(item.id),
          category: rl.category?.trim() || "-",
          clauseTitle: rl.clauseTitle?.trim() || "-",
          vectorScore: item.score ?? 0,
          kind: "rule",
        };
        if (kinds.includes("rule")) {
          ruleHits.push(candidate);
          hits.push({ kind: "rule", rule: candidate });
        }
      }
    }

    return {
      queryText,
      hits,
      ruleHits,
      consensusHits,
    };
  } catch (error) {
    console.error("Qdrant semantic search failed", error);
    return {
      queryText,
      hits: [],
      ruleHits: [],
      consensusHits: [],
      fallbackReason: "Qdrant 查询失败，已自动回退到旧版规则扫描。",
    };
  }
}

/**
 * 兼容旧调用：仅返回 rule 命中。新代码请优先使用 `searchKnowledgeVectors`。
 * @deprecated 将在阶段 2 后随调用方迁移完成移除。
 */
export async function searchRuleVectors(
  request: RegularQuestionRequest,
  intent?: RegularQuestionIntentParse,
  limit = getSemanticRecallLimit(),
) {
  const result = await searchKnowledgeVectors(request, intent, {
    limit,
    kinds: ["rule"],
  });
  return {
    queryText: result.queryText,
    hits: result.ruleHits,
    fallbackReason: result.fallbackReason,
  };
}
