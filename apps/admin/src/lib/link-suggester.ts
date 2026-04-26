import {
  getDashScopeApiKey,
  getDashScopeComplexModelName,
  parseJsonObject,
  requestDashScopeChat,
} from "@/lib/dashscope-client";
import { embedTexts, isEmbeddingConfigured } from "@/lib/embeddings";
import type { KbTableName } from "@/lib/kb-schema";
import { loadKnowledgeTable } from "@/lib/knowledge-loader";
import type { KnowledgeLinkType } from "@/lib/knowledge-links";
import { listStoredLinkSignatures } from "@/lib/knowledge-links";
import {
  addSuggestions,
  listBlocklistSignatures,
  listSuggestions,
} from "@/lib/knowledge-link-suggestions";
import { normalizeTags } from "@/lib/knowledge-tags";
import type {
  ConsensusRow,
  FaqRow,
  OperationRow,
  ProductionCheckRow,
  RuleRow,
} from "@/lib/types";

/** 支持进入 Suggester 的条目。内部统一成这种结构，避免裸表类型扩散。 */
type Entry = {
  table: KbTableName;
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  doc: string;
  snippet: string;
};

export type GenerateSuggestionsOptions = {
  /** dryRun 时仅返回候选对数与预估 token；不调用 LLM。 */
  dryRun?: boolean;
  /** 只扫描与这些 ID 相关的候选（用于 CSV 导入后增量扫描）。 */
  changedIds?: Array<{ table: KbTableName; id: string }>;
  /** 上限：本次最多给 LLM 判几对（防成本）。默认 env KB_LINK_MAX_PAIRS 或 200。 */
  maxPairs?: number;
  /** 每个条目最多保留多少个向量邻居。默认 5。 */
  topKPerEntry?: number;
  /** 向量相似度入围门槛（0~1），默认 0.55。 */
  minVectorSimilarity?: number;
  /** LLM 采纳阈值（低于此置信度直接不入队）。默认 0.55。 */
  minAcceptConfidence?: number;
  /** 触发者身份（仅用于审计，写入 suggestions.reason 前缀）。 */
  actor?: string;
};

export type GenerateSuggestionsResult = {
  ok: boolean;
  dryRun: boolean;
  totalEntries: number;
  totalCandidates: number;
  deterministicPairs: number;
  judgedPairs: number;
  added: number;
  skippedByBlocklist: number;
  skippedByExisting: number;
  skippedByPending: number;
  rejectedByLlm: number;
  estimatedLlmCalls: number;
  /** 出现的警告：如 LLM 不可用、Embedding 失败等。 */
  warnings: string[];
  elapsedMs: number;
};

const DEFAULT_MAX_PAIRS = 200;
const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SIM = 0.55;
const DEFAULT_MIN_CONFIDENCE = 0.55;
const LLM_CONCURRENCY = (() => {
  const raw = process.env.KB_LINK_LLM_CONCURRENCY?.trim();
  if (!raw) return 4;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 4;
  return Math.min(n, 16);
})();

function envMaxPairs() {
  const raw = process.env.KB_LINK_MAX_PAIRS?.trim();
  if (!raw) return DEFAULT_MAX_PAIRS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_PAIRS;
  return Math.min(n, 2000);
}

export function isLinkSuggestionsEnabled() {
  return process.env.KB_LINK_SUGGESTIONS_ENABLED === "1";
}

function truncate(text: string, max: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max).trim()}...`;
}

function buildRuleEntry(rule: RuleRow): Entry | null {
  const id = rule.rule_id?.trim();
  if (!id) return null;
  const title = rule.条款标题?.trim() || "-";
  const subtitle = rule.条款编号?.trim() || "";
  const doc = [
    `问题分类：${rule.问题分类 || "-"}`,
    `关键词：${rule.问题子类或关键词 || "-"}`,
    `场景描述：${rule.场景描述 || "-"}`,
    `触发条件：${rule.触发条件 || "-"}`,
    `条款标题：${rule.条款标题 || "-"}`,
    `条款编号：${rule.条款编号 || "-"}`,
    `条款片段：${rule.条款关键片段 || "-"}`,
    `条款解释：${rule.条款解释 || "-"}`,
  ].join("\n");
  const snippet = truncate(
    [rule.条款关键片段, rule.条款解释, rule.场景描述].filter(Boolean).join("；"),
    180,
  );
  return {
    table: "rules",
    id,
    title,
    subtitle,
    tags: normalizeTags(rule.tags),
    doc,
    snippet,
  };
}

function buildConsensusEntry(row: ConsensusRow): Entry | null {
  const id = row.consensus_id?.trim();
  if (!id) return null;
  const title = row.标题?.trim() || "-";
  const subtitle = row.判定结果?.trim() || "";
  const doc = [
    `标题：${row.标题 || "-"}`,
    `关联条款编号：${row.关联条款编号 || "-"}`,
    `适用场景：${row.适用场景 || "-"}`,
    `解释内容：${row.解释内容 || "-"}`,
    `判定结果：${row.判定结果 || "-"}`,
    `关键词：${row.关键词 || "-"}`,
  ].join("\n");
  const snippet = truncate(
    [row.解释内容, row.适用场景, row.判定结果].filter(Boolean).join("；"),
    180,
  );
  return {
    table: "consensus",
    id,
    title,
    subtitle,
    tags: normalizeTags(row.tags),
    doc,
    snippet,
  };
}

function buildOperationEntry(row: OperationRow): Entry | null {
  const id = row.op_id?.trim();
  if (!id) return null;
  const meaningful = [
    row.资料类型,
    row.标题,
    row.适用对象,
    row.关键词,
    row.操作内容,
    row.检核要点,
    row.解释说明,
    row.来源文件,
  ].some((value) => value?.trim());
  if (!meaningful) return null;
  const title = row.标题?.trim() || row.适用对象?.trim() || "-";
  const subtitle = row.资料类型?.trim() || "";
  const doc = [
    `资料类型：${row.资料类型 || "-"}`,
    `标题：${row.标题 || "-"}`,
    `适用对象：${row.适用对象 || "-"}`,
    `关键词：${row.关键词 || "-"}`,
    `操作内容：${row.操作内容 || "-"}`,
    `检核要点：${row.检核要点 || "-"}`,
    `解释说明：${row.解释说明 || "-"}`,
    `来源文件：${row.来源文件 || "-"}`,
  ].join("\n");
  const snippet = truncate(
    [row.操作内容, row.检核要点, row.解释说明].filter(Boolean).join("；"),
    180,
  );
  return {
    table: "operations",
    id,
    title,
    subtitle,
    tags: normalizeTags(row.tags),
    doc,
    snippet,
  };
}

function buildFaqEntry(row: FaqRow): Entry | null {
  const id = row.faq_id?.trim();
  if (!id) return null;
  const title = row.问题?.trim() || "-";
  const subtitle = row.沉积来源?.trim() || "";
  const doc = [
    `问题：${row.问题 || "-"}`,
    `答案：${row.答案 || "-"}`,
    `关联条款编号：${row.关联条款编号 || "-"}`,
    `关联共识编号：${row.关联共识编号 || "-"}`,
    `命中关键词：${row.命中关键词 || "-"}`,
  ].join("\n");
  const snippet = truncate(
    [row.问题, row.答案, row.命中关键词].filter(Boolean).join("；"),
    180,
  );
  return {
    table: "faq",
    id,
    title,
    subtitle,
    tags: normalizeTags(row.tags),
    doc,
    snippet,
  };
}

function buildProductionCheckEntry(row: ProductionCheckRow): Entry | null {
  const id = row.check_id?.trim();
  if (!id) return null;
  const title =
    [row.产品名称, row.检核类型].filter(Boolean).join("｜") ||
    row.检查点?.trim() ||
    "-";
  const subtitle = row.风险分类?.trim() || row.区域?.trim() || "";
  const doc = [
    `区域：${row.区域 || "-"}`,
    `产品名称：${row.产品名称 || "-"}`,
    `产品别名：${row.产品别名 || "-"}`,
    `风险分类：${row.风险分类 || "-"}`,
    `检核类型：${row.检核类型 || "-"}`,
    `检查点：${row.检查点 || "-"}`,
    `违规表达：${row.违规表达 || "-"}`,
    `解释说明：${row.解释说明 || "-"}`,
    `判定口径：${row.判定口径 || "-"}`,
  ].join("\n");
  const snippet = truncate(
    [row.检查点, row.违规表达, row.解释说明].filter(Boolean).join("；"),
    180,
  );
  return {
    table: "production-checks",
    id,
    title,
    subtitle,
    tags: normalizeTags(row.tags),
    doc,
    snippet,
  };
}

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let la = 0;
  let lb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    la += a[i] * a[i];
    lb += b[i] * b[i];
  }
  if (la === 0 || lb === 0) return 0;
  return dot / (Math.sqrt(la) * Math.sqrt(lb));
}

function normalizeSim(v: number) {
  return Math.max(0, Math.min(1, (v + 1) / 2));
}

function entryKey(e: { table: KbTableName; id: string }) {
  return `${e.table}::${e.id}`;
}

type PairCandidate = {
  a: Entry;
  b: Entry;
  similarity: number;
  tagOverlap: string[];
  strongReason?: string;
  strongConfidence?: number;
  strongLinkType?: KnowledgeLinkType;
};

const BROAD_RELATION_TERMS = new Set([
  "操作",
  "标准",
  "出品",
  "检查",
  "检查表",
  "检核",
  "检核点",
  "观察点",
  "扣分",
  "品质",
  "食安",
  "关键项",
  "启用",
  "后厨",
  "调饮",
  "通用条款",
  "影响风味",
  "影响品质",
  "说明",
]);

function normalizeRelationTerm(value: string) {
  return value
    .replace(
      /^(资料类型|标题|适用对象|关键词|操作内容|检核要点|解释说明|适用场景|解释内容|问题|答案)：/g,
      "",
    )
    .replace(/操作标准|出品操作检查扣分标准|扣分标准/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function relationTerms(entry: Entry) {
  const raw = [
    entry.title,
    entry.subtitle,
    ...entry.tags,
    ...entry.doc.split(/[|｜，,。；;：:\n、/\\()（）[\]【】\s]+/g),
  ];
  return [
    ...new Set(
      raw
        .map(normalizeRelationTerm)
        .filter((term) => term.length >= 2 && term.length <= 16)
        .filter((term) => !BROAD_RELATION_TERMS.has(term)),
    ),
  ];
}

function sharedConcreteTerms(a: Entry, b: Entry) {
  const leftTerms = relationTerms(a);
  const rightTerms = relationTerms(b);
  const overlaps: string[] = [];

  for (const left of leftTerms) {
    for (const right of rightTerms) {
      if (left === right || left.includes(right) || right.includes(left)) {
        const token = left.length >= right.length ? left : right;
        if (!overlaps.includes(token)) overlaps.push(token);
      }
    }
  }

  return overlaps.filter((term) => term.length >= 3);
}

function isProductionChecklistOperation(entry: Entry) {
  return (
    entry.table === "production-checks" ||
    (entry.table === "operations" &&
      /出品操作检查|扣分标准|产品检核表/.test(
        [entry.subtitle, entry.title, entry.doc].join("\n"),
      ))
  );
}

function isStandardOperation(entry: Entry) {
  return entry.table === "operations" && !isProductionChecklistOperation(entry);
}

function strongOperationRelation(a: Entry, b: Entry) {
  if (
    a.table !== "operations" &&
    b.table !== "operations" &&
    a.table !== "production-checks" &&
    b.table !== "production-checks" &&
    a.table !== "rules" &&
    b.table !== "rules"
  )
    return null;
  const strongTokens = sharedConcreteTerms(a, b);
  if (strongTokens.length === 0) return null;

  const checklistToStandard =
    (isProductionChecklistOperation(a) && isStandardOperation(b)) ||
    (isProductionChecklistOperation(b) && isStandardOperation(a));
  if (checklistToStandard) {
    return {
      confidence: Math.min(0.92, 0.82 + strongTokens.length * 0.03),
      linkType: "supports" as KnowledgeLinkType,
      reason: `标准操作与出品检查表关联：共同对象/动作「${strongTokens.slice(0, 3).join("、")}」`,
    };
  }

  const operationToAuditRule =
    ((a.table === "operations" || a.table === "production-checks") &&
      b.table === "rules") ||
    (a.table === "rules" &&
      (b.table === "operations" || b.table === "production-checks"));
  if (
    operationToAuditRule &&
    (strongTokens.length >= 2 || strongTokens[0].length >= 4)
  ) {
    return {
      confidence: Math.min(0.88, 0.76 + strongTokens.length * 0.03),
      linkType: "related" as KnowledgeLinkType,
      reason: `操作知识与稽核表关联：共同对象/动作「${strongTokens.slice(0, 3).join("、")}」`,
    };
  }

  // 共识/FAQ 与操作知识仍可通过向量 + LLM 产生建议，但不走规则型强关联，
  // 避免"操作类共识 ↔ 出品检查点"刷屏，淹没 SOP/稽核表主线关系。
  return null;
}

function pairPriority(pair: PairCandidate) {
  let priority = pair.similarity;
  if (pair.a.table !== pair.b.table) priority += 0.08;
  if (
    (isProductionChecklistOperation(pair.a) && isStandardOperation(pair.b)) ||
    (isProductionChecklistOperation(pair.b) && isStandardOperation(pair.a))
  ) {
    priority += 0.18;
  } else if (
    (pair.a.table === "operations" && pair.b.table === "rules") ||
    (pair.a.table === "production-checks" && pair.b.table === "rules") ||
    (pair.a.table === "rules" &&
      (pair.b.table === "operations" || pair.b.table === "production-checks"))
  ) {
    priority += 0.14;
  } else if (
    pair.a.table === "operations" ||
    pair.b.table === "operations" ||
    pair.a.table === "production-checks" ||
    pair.b.table === "production-checks"
  ) {
    priority += 0.03;
  }
  if (pair.tagOverlap.length > 0)
    priority += Math.min(0.04, pair.tagOverlap.length * 0.01);
  return priority;
}

function buildPairCandidates(
  entries: Entry[],
  vectors: Map<string, number[]>,
  options: { topK: number; minSim: number; allowedEntryKeys?: Set<string> | null },
): PairCandidate[] {
  const { topK, minSim, allowedEntryKeys } = options;
  const tagIndex = new Map<string, Entry[]>();
  for (const e of entries) {
    for (const tag of e.tags) {
      const list = tagIndex.get(tag) ?? [];
      list.push(e);
      tagIndex.set(tag, list);
    }
  }

  const pairs = new Map<string, PairCandidate>();
  const pushPair = (
    a: Entry,
    b: Entry,
    similarity: number,
    strong?: { confidence: number; linkType: KnowledgeLinkType; reason: string },
  ) => {
    if (a.table === b.table && a.id === b.id) return;
    const ka = entryKey(a);
    const kb = entryKey(b);
    const [left, right, leftKey, rightKey] = ka < kb ? [a, b, ka, kb] : [b, a, kb, ka];
    const pairKey = `${leftKey}||${rightKey}`;
    const overlaps = left.tags.filter((t) => right.tags.includes(t));
    const existing = pairs.get(pairKey);
    if (existing) {
      if (strong && !existing.strongConfidence) {
        existing.strongReason = strong.reason;
        existing.strongConfidence = strong.confidence;
        existing.strongLinkType = strong.linkType;
      }
      if (similarity > existing.similarity) {
        existing.similarity = similarity;
        existing.tagOverlap = overlaps;
      }
      return;
    }
    pairs.set(pairKey, {
      a: left,
      b: right,
      similarity,
      tagOverlap: overlaps,
      strongReason: strong?.reason,
      strongConfidence: strong?.confidence,
      strongLinkType: strong?.linkType,
    });
  };

  // 1) 向量 top-K 邻居
  for (const e of entries) {
    const vec = vectors.get(entryKey(e));
    if (!vec) continue;
    const scored: Array<{ other: Entry; sim: number }> = [];
    for (const other of entries) {
      if (other === e) continue;
      const ov = vectors.get(entryKey(other));
      if (!ov) continue;
      const sim = normalizeSim(cosineSimilarity(vec, ov));
      if (sim < minSim) continue;
      scored.push({ other, sim });
    }
    scored.sort((x, y) => y.sim - x.sim);
    for (const { other, sim } of scored.slice(0, topK)) {
      if (
        allowedEntryKeys &&
        !allowedEntryKeys.has(entryKey(e)) &&
        !allowedEntryKeys.has(entryKey(other))
      ) {
        continue;
      }
      pushPair(e, other, sim);
    }
  }

  // 2) tag 交集兜底（即便向量召回不到，也把标签完全重合的条目拉进来）
  for (const [, list] of tagIndex) {
    if (list.length < 2 || list.length > 40) continue;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (
          allowedEntryKeys &&
          !allowedEntryKeys.has(entryKey(a)) &&
          !allowedEntryKeys.has(entryKey(b))
        ) {
          continue;
        }
        const va = vectors.get(entryKey(a));
        const vb = vectors.get(entryKey(b));
        const sim = va && vb ? normalizeSim(cosineSimilarity(va, vb)) : 0;
        pushPair(a, b, sim);
      }
    }
  }

  // 3) 操作知识强规则兜底：同产品/同原料/同关键动作时，不完全依赖 LLM。
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (
        allowedEntryKeys &&
        !allowedEntryKeys.has(entryKey(a)) &&
        !allowedEntryKeys.has(entryKey(b))
      ) {
        continue;
      }
      const strong = strongOperationRelation(a, b);
      if (!strong) continue;
      const va = vectors.get(entryKey(a));
      const vb = vectors.get(entryKey(b));
      const sim = va && vb ? normalizeSim(cosineSimilarity(va, vb)) : strong.confidence;
      pushPair(a, b, Math.max(sim, strong.confidence), strong);
    }
  }

  return [...pairs.values()];
}

type LlmVerdict = {
  verdict?: "accept" | "reject";
  linkType?: KnowledgeLinkType;
  direction?: "a_to_b" | "b_to_a" | "bidirectional";
  confidence?: number;
  reason?: string;
  evidenceSourceSpan?: string;
  evidenceTargetSpan?: string;
};

function buildLlmPrompt(pair: PairCandidate) {
  const labelA = `【${pair.a.table}｜${pair.a.id}｜${pair.a.title}${
    pair.a.subtitle ? `｜${pair.a.subtitle}` : ""
  }】`;
  const labelB = `【${pair.b.table}｜${pair.b.id}｜${pair.b.title}${
    pair.b.subtitle ? `｜${pair.b.subtitle}` : ""
  }】`;
  return `你将判断两条知识条目之间是否存在值得在知识图谱中显式关联的关系。

A 条目：
${labelA}
${pair.a.doc}

B 条目：
${labelB}
${pair.b.doc}

说明：
- 若 A 与 B 表达的是同一主题且相互佐证，用 "supports"
- 若其中一方引用另一方（如条款编号/共识编号互指），用 "references"
- 若 A 与 B 相互替代（新旧版本、通用/特殊规定覆盖关系），用 "supersedes"
- 若两者在同一情景给出相反结论，用 "contradicts"
- 若仅是话题相关、没有明显因果，用 "related"
- 若一条是操作/配方/SOP，另一条是出品检查/扣分标准，且对象或关键动作一致，应视为值得关联；检查标准可作为操作标准的检核依据
- 若一条是共识解释，另一条是操作/出品检查标准，且都在解释同一产品、原料、动作或扣分口径，应视为值得关联
- 若两者无显著关系或关系牵强（例如只是都来自"食品安全"这种宽泛领域），必须返回 verdict = "reject"
- supports/contradicts/related 属于对称关系，direction 请返回 "bidirectional"
- supersedes/references 属于有方向关系，需要判断是 a_to_b（A 指向/替代 B）还是 b_to_a

严格输出 JSON：
{
  "verdict": "accept" | "reject",
  "linkType": "references | supports | related | supersedes | contradicts",
  "direction": "a_to_b | b_to_a | bidirectional",
  "confidence": 0-1,
  "reason": "<=60 字中文理由，需指明触发关系的核心语义，不得编造条目外信息",
  "evidenceSourceSpan": "摘自 A 原文，<=40 字",
  "evidenceTargetSpan": "摘自 B 原文，<=40 字"
}`;
}

async function judgePair(pair: PairCandidate): Promise<LlmVerdict | null> {
  if (!getDashScopeApiKey()) return null;
  const raw = await requestDashScopeChat(
    "你是知识图谱关系判定助手。只能依据给定两条条目的原文判断，不得编造。返回严格 JSON。",
    buildLlmPrompt(pair),
    {
      responseFormat: "json_object",
      maxTokens: 360,
      timeoutMs: 15000,
      modelName: getDashScopeComplexModelName(),
    },
  );
  return parseJsonObject<LlmVerdict>(raw);
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Array<Promise<void>> = [];
  const runnerCount = Math.min(concurrency, items.length);
  for (let i = 0; i < runnerCount; i += 1) {
    runners.push(
      (async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= items.length) return;
          results[index] = await worker(items[index], index);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

export async function generateLinkSuggestions(
  options: GenerateSuggestionsOptions = {},
): Promise<GenerateSuggestionsResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  const maxPairs = options.maxPairs ?? envMaxPairs();
  const topKPerEntry = options.topKPerEntry ?? DEFAULT_TOP_K;
  const minSim = options.minVectorSimilarity ?? DEFAULT_MIN_SIM;
  const minAccept = options.minAcceptConfidence ?? DEFAULT_MIN_CONFIDENCE;

  const [ruleRows, consensusRows, operationRows, productionCheckRows, faqRows] =
    await Promise.all([
      loadKnowledgeTable<RuleRow>("rules"),
      loadKnowledgeTable<ConsensusRow>("consensus"),
      loadKnowledgeTable<OperationRow>("operations"),
      loadKnowledgeTable<ProductionCheckRow>("production-checks"),
      loadKnowledgeTable<FaqRow>("faq"),
    ]);

  const entries: Entry[] = [
    ...ruleRows.map(buildRuleEntry).filter((x): x is Entry => Boolean(x)),
    ...consensusRows.map(buildConsensusEntry).filter((x): x is Entry => Boolean(x)),
    ...operationRows.map(buildOperationEntry).filter((x): x is Entry => Boolean(x)),
    ...productionCheckRows
      .map(buildProductionCheckEntry)
      .filter((x): x is Entry => Boolean(x)),
    ...faqRows.map(buildFaqEntry).filter((x): x is Entry => Boolean(x)),
  ];

  if (entries.length < 2) {
    return {
      ok: true,
      dryRun: Boolean(options.dryRun),
      totalEntries: entries.length,
      totalCandidates: 0,
      deterministicPairs: 0,
      judgedPairs: 0,
      added: 0,
      skippedByBlocklist: 0,
      skippedByExisting: 0,
      skippedByPending: 0,
      rejectedByLlm: 0,
      estimatedLlmCalls: 0,
      warnings: ["可用条目不足以构成候选对。"],
      elapsedMs: Date.now() - startedAt,
    };
  }

  // 1) embed 全部条目（使用现有缓存/并发控制，增量调用基本命中缓存）
  const vectors = new Map<string, number[]>();
  if (!isEmbeddingConfigured()) {
    warnings.push("未配置 DashScope Embedding，候选生成依赖 Tag 交集。");
  } else {
    const docs = entries.map((e) => e.doc);
    const vecList = await embedTexts(docs);
    if (vecList && vecList.length === entries.length) {
      vecList.forEach((vec, i) => vectors.set(entryKey(entries[i]), vec));
    } else {
      warnings.push("Embedding 批量生成失败，回退到 Tag 交集召回。");
    }
  }

  // 2) 候选对生成
  const changedKeys = options.changedIds?.length
    ? new Set(options.changedIds.map((x) => entryKey(x)))
    : null;
  const pairs = buildPairCandidates(entries, vectors, {
    topK: topKPerEntry,
    minSim,
    allowedEntryKeys: changedKeys,
  }).sort((a, b) => pairPriority(b) - pairPriority(a));

  // 3) 过滤已存在 / blocklist / 已 pending
  const [existingSignatures, blocklist, pendingSuggestions] = await Promise.all([
    listStoredLinkSignatures(),
    listBlocklistSignatures(),
    listSuggestions({ status: "pending", limit: 10000 }),
  ]);
  const pendingPairKeys = new Set<string>();
  for (const p of pendingSuggestions.items) {
    const ka = entryKey({ table: p.sourceTable, id: p.sourceId });
    const kb = entryKey({ table: p.targetTable, id: p.targetId });
    pendingPairKeys.add(ka < kb ? `${ka}||${kb}` : `${kb}||${ka}`);
  }

  let skippedByBlocklist = 0;
  let skippedByExisting = 0;
  let skippedByPending = 0;
  const enqueued: PairCandidate[] = [];
  for (const pair of pairs) {
    const ka = entryKey(pair.a);
    const kb = entryKey(pair.b);
    const pairKey = ka < kb ? `${ka}||${kb}` : `${kb}||${ka}`;
    if (blocklist.has(pairKey)) {
      skippedByBlocklist += 1;
      continue;
    }
    if (pendingPairKeys.has(pairKey)) {
      skippedByPending += 1;
      continue;
    }
    // 同方向/同类型已存在的持久化链路 => 跳过（简单粗暴：只要任一类型的该方向已有，就视为已覆盖）
    let existsAny = false;
    for (const linkType of [
      "references",
      "supports",
      "related",
      "supersedes",
      "contradicts",
    ]) {
      if (
        existingSignatures.has(
          [pair.a.table, pair.a.id, pair.b.table, pair.b.id, linkType].join("::"),
        ) ||
        existingSignatures.has(
          [pair.b.table, pair.b.id, pair.a.table, pair.a.id, linkType].join("::"),
        )
      ) {
        existsAny = true;
        break;
      }
    }
    if (existsAny) {
      skippedByExisting += 1;
      continue;
    }
    enqueued.push(pair);
    if (enqueued.length >= maxPairs) break;
  }

  const deterministicPairs = enqueued.filter((pair) => pair.strongConfidence).length;
  const llmPairs = enqueued.filter((pair) => !pair.strongConfidence);
  const estimatedLlmCalls = llmPairs.length;

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      totalEntries: entries.length,
      totalCandidates: pairs.length,
      deterministicPairs,
      judgedPairs: 0,
      added: 0,
      skippedByBlocklist,
      skippedByExisting,
      skippedByPending,
      rejectedByLlm: 0,
      estimatedLlmCalls,
      warnings,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const drafts: Parameters<typeof addSuggestions>[0] = [];
  for (const pair of enqueued) {
    if (!pair.strongConfidence) continue;
    drafts.push({
      sourceTable: pair.a.table,
      sourceId: pair.a.id,
      targetTable: pair.b.table,
      targetId: pair.b.id,
      linkType: pair.strongLinkType ?? "related",
      confidence: pair.strongConfidence,
      reason: truncate(pair.strongReason ?? "操作知识强规则匹配", 200),
      evidenceSourceSpan: truncate(pair.a.snippet || pair.a.title, 200),
      evidenceTargetSpan: truncate(pair.b.snippet || pair.b.title, 200),
      model: "rule-based-operation-linker",
    });
  }

  if (!getDashScopeApiKey()) {
    warnings.push("未配置 DASHSCOPE_API_KEY，无法调用 LLM 裁判。");
    const saved = await addSuggestions(drafts);
    return {
      ok: saved.added > 0,
      dryRun: false,
      totalEntries: entries.length,
      totalCandidates: pairs.length,
      deterministicPairs,
      judgedPairs: 0,
      added: saved.added,
      skippedByBlocklist,
      skippedByExisting,
      skippedByPending,
      rejectedByLlm: 0,
      estimatedLlmCalls,
      warnings,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // 4) LLM 并发判决
  const verdicts = await runWithConcurrency(
    llmPairs,
    async (pair) => ({ pair, verdict: await judgePair(pair) }),
    LLM_CONCURRENCY,
  );

  let rejectedByLlm = 0;
  const modelName = getDashScopeComplexModelName();

  for (const { pair, verdict } of verdicts) {
    if (!verdict || verdict.verdict !== "accept") {
      rejectedByLlm += 1;
      continue;
    }
    const linkType =
      verdict.linkType &&
      ["references", "supports", "related", "supersedes", "contradicts"].includes(
        verdict.linkType,
      )
        ? (verdict.linkType as KnowledgeLinkType)
        : "related";
    const confidence =
      typeof verdict.confidence === "number"
        ? Math.max(0, Math.min(1, verdict.confidence))
        : 0.5;
    if (confidence < minAccept) {
      rejectedByLlm += 1;
      continue;
    }

    // 对齐方向：默认把 a 当 source；b_to_a 时交换。
    const directed = verdict.direction === "b_to_a";
    const source = directed ? pair.b : pair.a;
    const target = directed ? pair.a : pair.b;
    const evidenceSource = directed
      ? (verdict.evidenceTargetSpan ?? "")
      : (verdict.evidenceSourceSpan ?? "");
    const evidenceTarget = directed
      ? (verdict.evidenceSourceSpan ?? "")
      : (verdict.evidenceTargetSpan ?? "");

    drafts.push({
      sourceTable: source.table,
      sourceId: source.id,
      targetTable: target.table,
      targetId: target.id,
      linkType,
      confidence,
      reason: truncate(verdict.reason ?? "", 200),
      evidenceSourceSpan: truncate(evidenceSource, 200),
      evidenceTargetSpan: truncate(evidenceTarget, 200),
      model: modelName,
    });
  }

  const saved = await addSuggestions(drafts);

  return {
    ok: true,
    dryRun: false,
    totalEntries: entries.length,
    totalCandidates: pairs.length,
    deterministicPairs,
    judgedPairs: verdicts.length,
    added: saved.added,
    skippedByBlocklist,
    skippedByExisting,
    skippedByPending,
    rejectedByLlm,
    estimatedLlmCalls,
    warnings,
    elapsedMs: Date.now() - startedAt,
  };
}
