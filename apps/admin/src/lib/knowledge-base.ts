import { matchExternalPurchase, matchOldItem } from "@/lib/catalog-matchers";
import { matchRegularQuestionFallback } from "@/lib/knowledge-base-fallback";
import {
  getKnowledgeSummary,
  loadKnowledgeBase,
  loadKnowledgeTable,
} from "@/lib/knowledge-loader";
import {
  recordRetrieved,
  recordSelected,
  recordUnmatchedQuery,
} from "@/lib/knowledge-quality";
import { matchOperationQuestion } from "@/lib/operation-matchers";
import {
  buildRegularQuestionMaterialText,
  detectMaterialMismatch,
} from "@/lib/rule-material-guard";
import { isSemanticSearchConfigured, searchRuleVectors } from "@/lib/vector-store";
import type {
  ConsensusRow,
  RegularQuestionMatchDebug,
  RegularQuestionMatchResult,
  RegularQuestionRequest,
  RuleRow,
} from "@/lib/types";

export {
  getKnowledgeSummary,
  loadKnowledgeBase,
  matchExternalPurchase,
  matchOldItem,
  matchOperationQuestion,
};

const RAG_CONFIDENCE_THRESHOLD = Number(process.env.RAG_CONFIDENCE_THRESHOLD || "55");

interface RagLlmResult {
  ruleId: string | null;
  reason: string;
  confidence: number;
  shouldDeduct: string;
  deductScore: string;
  answer: string;
}

function buildRagPrompt(
  request: RegularQuestionRequest,
  candidates: Array<{ rule: RuleRow; vectorScore: number }>,
) {
  const userBlock = [
    request.category ? `问题分类：${request.category}` : "",
    request.issueTitle ? `门店问题：${request.issueTitle}` : "",
    request.description ? `问题描述：${request.description}` : "",
    request.selfJudgment ? `自行判断：${request.selfJudgment}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const rulesBlock = candidates
    .map(
      (c, i) =>
        `### 规则 ${i + 1}（${c.rule.rule_id}，相似度 ${c.vectorScore.toFixed(3)}）\n` +
        `分类：${c.rule.问题分类}\n` +
        `场景描述：${c.rule.场景描述}\n` +
        `触发条件：${c.rule.触发条件}\n` +
        `条款标题：${c.rule.条款标题}\n` +
        `条款编号：${c.rule.条款编号}\n` +
        `条款解释：${c.rule.条款解释}\n` +
        `是否扣分：${c.rule.是否扣分}\n` +
        `扣分分值：${c.rule.扣分分值}\n` +
        `示例问法：${c.rule.示例问法}`,
    )
    .join("\n\n");

  return `## 用户问题\n${userBlock}\n\n## 候选规则（共 ${candidates.length} 条）\n${rulesBlock}`;
}

const RAG_SYSTEM_PROMPT = `你是茶饮稽核知识库助手。根据用户问题和检索到的候选规则，完成匹配和回答。

规则：
1. 从候选规则中选出最匹配用户问题的一条（输出 ruleId），如果都不匹配则输出 null
2. 判断理由（50 字以内）
3. 置信度（0-100，越高越确定）
4. 是否扣分和扣分分值（从命中规则直接读取）
5. 用通俗语言向一线稽核专员解释该共识要点（150 字以内，引用条款关键内容）

注意：
- 只能选候选列表中的规则，不能编造
- 如果用户问题与所有候选规则都不相关，confidence 设为 0，ruleId 设为 null
- 用户若明确提到具体物料/品名（如「木薯」「米麻薯」），所选规则必须针对同一物料或条款中同时覆盖该物料；「木薯」与「米麻薯」为不同物料，不得因复热/冷藏等流程相似而混用
- answer 要面向一线专员，简洁、实用、引用条款要点
- 若候选中同时存在健康证相关规则，必须严格区分：
  - H1.1 / R-0001：现场人员无健康证，或健康证本身已过期
  - H1.2 / R-0002：人员有健康证，但门店宝未录入、未上传、未更新，或人证/有效期信息不一致
- 选中 H1.2 时，answer 禁止写成“无健康证”“直接判定无证”等 H1.1 语义
- 选中 H1.1 时，answer 禁止写成“仅系统未录入/未上传”等 H1.2 语义

严格输出 JSON：
{"ruleId":"R-xxxx","reason":"...","confidence":85,"shouldDeduct":"是","deductScore":"2分","answer":"..."}`;

async function ragJudgeAndAnswer(
  request: RegularQuestionRequest,
  candidates: Array<{ rule: RuleRow; vectorScore: number }>,
): Promise<RagLlmResult | null> {
  if (candidates.length === 0) return null;

  const { requestDashScopeChat, parseJsonObject, getDashScopeComplexModelName } =
    await import("@/lib/dashscope-client");

  const userPrompt = buildRagPrompt(request, candidates);
  const raw = await requestDashScopeChat(RAG_SYSTEM_PROMPT, userPrompt, {
    maxTokens: 500,
    responseFormat: "json_object",
    modelName: getDashScopeComplexModelName(),
    timeoutMs: 15_000,
  });

  if (!raw) return null;

  const parsed = parseJsonObject<RagLlmResult>(raw);
  if (!parsed) return null;

  if (parsed.ruleId && !candidates.some((c) => c.rule.rule_id === parsed.ruleId)) {
    parsed.ruleId = null;
    parsed.confidence = 0;
  }

  return parsed;
}

export async function matchRegularQuestion(
  request: RegularQuestionRequest,
): Promise<RegularQuestionMatchResult> {
  if (!isSemanticSearchConfigured()) {
    return matchRegularQuestionFallback(request);
  }

  // 主路径只用到 rules / consensus 两张表，避免冷启动时全量加载五张表。
  const [rules, consensusRows, semanticResult] = await Promise.all([
    loadKnowledgeTable<RuleRow>("rules"),
    loadKnowledgeTable<ConsensusRow>("consensus"),
    searchRuleVectors(request),
  ]);

  if (semanticResult.hits.length === 0 && semanticResult.fallbackReason) {
    return matchRegularQuestionFallback(request);
  }

  const ruleMap = new Map(rules.map((r) => [r.rule_id, r]));
  const vectorHitsRaw = semanticResult.hits
    .map((hit) => {
      const rule = ruleMap.get(hit.ruleId);
      return rule ? { rule, vectorScore: hit.vectorScore } : null;
    })
    .filter((c): c is { rule: RuleRow; vectorScore: number } => c !== null)
    .slice(0, 8);

  const materialText = buildRegularQuestionMaterialText(request);
  const vectorHits = vectorHitsRaw.filter(
    (c) => !detectMaterialMismatch(materialText, c.rule).mismatch,
  );

  const debug: RegularQuestionMatchDebug = {
    retrievalMode: semanticResult.hits.length > 0 ? "semantic" : "fallback",
    semanticEnabled: isSemanticSearchConfigured(),
    queryText: semanticResult.queryText,
    fallbackReason:
      vectorHits.length > 0
        ? undefined
        : vectorHitsRaw.length > 0
          ? "语义候选与用户描述的具体物料不一致，已全部过滤。"
          : semanticResult.fallbackReason,
    recalled: semanticResult.hits,
    retrievalSources: vectorHits.length > 0 ? ["semantic"] : [],
  };

  if (vectorHits.length === 0) {
    const noHitReason =
      vectorHitsRaw.length > 0
        ? "语义召回与用户描述的具体物料不一致，已拒绝自动命中。"
        : "向量检索无候选";
    recordUnmatchedQuery(request.description || request.issueTitle || "", noHitReason);
    return {
      matched: false,
      rejectReason:
        vectorHitsRaw.length > 0
          ? "您描述的具体物料与检索到的条款范围不一致（例如不同小料不得混用），建议进入人工复核池。"
          : "未在知识库中找到与该问题相关的规则，建议进入人工复核池。",
      candidates: [],
      debug: { ...debug, rerankedTop: [] },
    };
  }

  recordRetrieved(vectorHits.map((c) => c.rule.rule_id));

  const rerankedTop = vectorHits.slice(0, 5).map((c) => ({
    ruleId: c.rule.rule_id,
    category: c.rule.问题分类,
    clauseNo: c.rule.条款编号,
    clauseTitle: c.rule.条款标题,
    score: Math.round(c.vectorScore * 100),
    vectorScore: c.vectorScore,
    vectorBoost: 0,
  }));

  const ragResult = await ragJudgeAndAnswer(request, vectorHits);

  if (
    !ragResult ||
    !ragResult.ruleId ||
    ragResult.confidence < RAG_CONFIDENCE_THRESHOLD
  ) {
    const reason = !ragResult
      ? "LLM 未返回有效结果，自动转人工复核。"
      : ragResult.confidence < RAG_CONFIDENCE_THRESHOLD
        ? `置信度 ${ragResult.confidence} 低于阈值 ${RAG_CONFIDENCE_THRESHOLD}，自动转人工复核。`
        : "未匹配到合适规则，自动转人工复核。";

    recordUnmatchedQuery(request.description || request.issueTitle || "", reason);
    return {
      matched: false,
      rejectReason: reason,
      candidates: rerankedTop,
      debug: {
        ...debug,
        rerankedTop,
        judgeMode: "llm" as const,
        judgeReason: ragResult?.reason || reason,
        judgeConfidence: ragResult?.confidence ?? 0,
        escalatedToReview: true,
        lowConfidenceReason: reason,
      },
    };
  }

  recordSelected(ragResult.ruleId);
  const best = vectorHits.find((c) => c.rule.rule_id === ragResult.ruleId)!;
  const linkedConsensus = best.rule.共识来源
    ? consensusRows.find((item) => item.consensus_id === best.rule.共识来源)
    : undefined;

  console.info("[regular-question-match] RAG", {
    queryText: debug.queryText,
    selectedRuleId: ragResult.ruleId,
    confidence: ragResult.confidence,
    reason: ragResult.reason,
  });

  return {
    matched: true,
    topScore: Math.round(best.vectorScore * 100),
    answer: {
      ruleId: best.rule.rule_id,
      category: best.rule.问题分类,
      shouldDeduct: ragResult.shouldDeduct || best.rule.是否扣分,
      deductScore: ragResult.deductScore || best.rule.扣分分值 || "待人工确认",
      clauseNo: best.rule.条款编号,
      clauseTitle: best.rule.条款标题,
      clauseSnippet: best.rule.条款关键片段,
      explanation: linkedConsensus?.解释内容 || best.rule.条款解释,
      source: linkedConsensus
        ? `${linkedConsensus.标题} / ${linkedConsensus.来源文件}`
        : best.rule.条款标题,
      matchedReasons: [ragResult.reason],
      consensusKeywords: linkedConsensus?.关键词?.trim() || "",
      consensusApplicableScene: linkedConsensus?.适用场景?.trim() || "",
      aiExplanation: ragResult.answer,
    },
    candidates: rerankedTop,
    debug: {
      ...debug,
      rerankedTop,
      judgeMode: "llm" as const,
      judgeSelectedRuleId: ragResult.ruleId,
      judgeReason: ragResult.reason,
      judgeConfidence: ragResult.confidence,
      usedComplexModel: true,
    },
  };
}
