import { matchExternalPurchase, matchOldItem } from "@/lib/catalog-matchers";
import { getKnowledgeSummary, loadKnowledgeBase } from "@/lib/knowledge-loader";
import {
  recordRetrieved,
  recordSelected,
  recordUnmatchedQuery,
} from "@/lib/knowledge-quality";
import { matchOperationQuestion } from "@/lib/operation-matchers";
import { isSemanticSearchConfigured, searchRuleVectors } from "@/lib/vector-store";
import type {
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
- answer 要面向一线专员，简洁、实用、引用条款要点

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
  const [knowledgeBase, semanticResult] = await Promise.all([
    loadKnowledgeBase(),
    searchRuleVectors(request),
  ]);
  const ruleMap = new Map(knowledgeBase.rules.map((r) => [r.rule_id, r]));
  const vectorHits = semanticResult.hits
    .map((hit) => {
      const rule = ruleMap.get(hit.ruleId);
      return rule ? { rule, vectorScore: hit.vectorScore } : null;
    })
    .filter((c): c is { rule: RuleRow; vectorScore: number } => c !== null)
    .slice(0, 8);

  const debug: RegularQuestionMatchDebug = {
    retrievalMode: vectorHits.length > 0 ? "semantic" : "fallback",
    semanticEnabled: isSemanticSearchConfigured(),
    queryText: semanticResult.queryText,
    fallbackReason: vectorHits.length > 0 ? undefined : semanticResult.fallbackReason,
    recalled: semanticResult.hits,
    retrievalSources: vectorHits.length > 0 ? ["semantic"] : [],
  };

  if (vectorHits.length === 0) {
    recordUnmatchedQuery(
      request.description || request.issueTitle || "",
      "向量检索无候选",
    );
    return {
      matched: false,
      rejectReason: "未在知识库中找到与该问题相关的规则，建议进入人工复核池。",
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
    ? knowledgeBase.consensus.find((item) => item.consensus_id === best.rule.共识来源)
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
