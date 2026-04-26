import { loadKnowledgeTable } from "@/lib/knowledge-loader";
import type {
  ProductionCheckRow,
  RegularQuestionCandidatePayload,
  RegularQuestionMatchResult,
  RegularQuestionRequest,
} from "@/lib/types";

function normalizeText(input?: string) {
  return (input ?? "").trim().toLowerCase();
}

function normalizeLooseText(input?: string) {
  return normalizeText(input).replace(
    /[\s,，。；;：:、|/\\()（）[\]【】'"“”‘’\-<>_=+*#@!！？%&~`^0-9a-z]+/gi,
    "",
  );
}

function splitTerms(text?: string) {
  return (text ?? "")
    .split(/[|｜,，。；;：:、/\\()（）[\]【】\s]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function buildQueryText(request: RegularQuestionRequest) {
  return [
    request.category,
    request.issueTitle,
    request.description,
    request.selfJudgment,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildCheckSearchText(item: ProductionCheckRow) {
  return [
    item.区域,
    item.产品名称,
    item.产品别名,
    item.风险分类,
    item.检核类型,
    item.检查点,
    item.违规表达,
    item.解释说明,
    item.判定口径,
    item.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function checkIdentityTerms(item: ProductionCheckRow) {
  return [
    item.产品名称,
    ...splitTerms(item.产品别名),
    ...splitTerms(item.tags).filter((term) => term.length >= 3),
  ]
    .map(normalizeLooseText)
    .filter((term) => term.length >= 2)
    .filter(
      (term) =>
        !["出品", "操作", "检查", "检核", "扣分", "标准", "饮品", "调饮"].includes(
          term,
        ),
    );
}

function findExplicitProductAnchors(
  checks: ProductionCheckRow[],
  request: RegularQuestionRequest,
) {
  const queryLoose = normalizeLooseText(buildQueryText(request));
  if (!queryLoose) return [];

  const anchors = new Set<string>();
  for (const check of checks) {
    for (const term of checkIdentityTerms(check)) {
      if (queryLoose.includes(term)) anchors.add(term);
    }
  }
  return [...anchors].sort((left, right) => right.length - left.length);
}

function actionIntentScore(item: ProductionCheckRow, request: RegularQuestionRequest) {
  const queryLoose = normalizeLooseText(buildQueryText(request));
  const searchLoose = normalizeLooseText(buildCheckSearchText(item));
  let score = 0;
  const reasons: string[] = [];

  const asksTimeout = /超时|过时|超过|超了|太久|未更换|没更换|没有更换/.test(
    queryLoose,
  );
  const asksBathBucket = /冰水浴桶|冰浴桶|水浴桶|冰水桶|浴桶/.test(queryLoose);
  const hasTimedReplacement = /小时|分钟|定时|计时|更换|换水|超时/.test(searchLoose);
  const hasIceWater = /冰水混合物|冰水|水浴|冰浴/.test(searchLoose);

  if (asksTimeout && hasTimedReplacement) {
    score += 36;
    reasons.push("问题指向超时/更换，命中带时间或更换要求的出品检查点");
  } else if (asksTimeout && !hasTimedReplacement) {
    score -= 24;
  }

  if (asksBathBucket && hasIceWater && hasTimedReplacement) {
    score += 28;
    reasons.push("问题指向冰水/浴桶，命中冰水混合物更换检查点");
  } else if (asksBathBucket && !hasTimedReplacement) {
    score -= 10;
  }

  return { score, reasons };
}

function scoreProductionCheckMatch(
  item: ProductionCheckRow,
  request: RegularQuestionRequest,
  explicitAnchors: string[],
) {
  const queryText = buildQueryText(request);
  const queryLoose = normalizeLooseText(queryText);
  const searchLoose = normalizeLooseText(buildCheckSearchText(item));
  let score = 0;
  const reasons: string[] = [];

  const identityLoose = normalizeLooseText(
    [item.产品名称, item.产品别名, item.tags].join(" "),
  );
  const anchorMatched =
    explicitAnchors.length === 0 ||
    explicitAnchors.some((anchor) => identityLoose.includes(anchor));

  if (!anchorMatched) return { score: -999, reasons: [], anchorMatched: false };

  if (explicitAnchors.length > 0) {
    score += 42;
    reasons.push(`命中明确产品/对象：${explicitAnchors.join("、")}`);
  }

  if (queryLoose && searchLoose.includes(queryLoose)) {
    score += 24;
    reasons.push("完整提问可在出品检查标准中定位");
  }

  for (const term of splitTerms(queryText)) {
    const loose = normalizeLooseText(term);
    if (loose.length >= 2 && searchLoose.includes(loose)) {
      score += 5;
    }
  }

  const action = actionIntentScore(item, request);
  score += action.score;
  reasons.push(...action.reasons);

  if (/扣分|检查|检核|出品|观察点|是否/.test(queryText)) {
    score += 10;
    reasons.push("问题语义指向出品检查/扣分标准");
  }

  return { score, reasons, anchorMatched };
}

export async function matchProductionCheckQuestion(
  request: RegularQuestionRequest,
): Promise<RegularQuestionMatchResult | null> {
  const checks = await loadKnowledgeTable<ProductionCheckRow>("production-checks");
  if (checks.length === 0) return null;

  const queryText = buildQueryText(request);
  if (!/出品|检查|检核|扣分|观察点|是否|超时|浴桶/.test(queryText)) return null;

  const explicitAnchors = findExplicitProductAnchors(checks, request);
  const scored = checks
    .map((item) => ({
      item,
      ...scoreProductionCheckMatch(item, request, explicitAnchors),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = scored[0];
  if (!top || top.score < 28) return null;

  const explanation =
    top.item.解释说明 ||
    top.item.违规表达 ||
    top.item.检查点 ||
    "命中出品检查标准，请按检查点口径判定。";
  const clauseTitle = [
    top.item.产品名称,
    top.item.检核类型,
    top.item.检查点.replace(/\n+/g, " / "),
  ]
    .filter(Boolean)
    .join("｜");

  const candidatePayloads: RegularQuestionCandidatePayload[] = scored.map((c) => ({
    ruleId: c.item.check_id,
    category: c.item.风险分类 || "出品检查标准",
    clauseNo: c.item.关联条款编号 || c.item.check_id,
    clauseTitle: [
      c.item.产品名称,
      c.item.检核类型,
      c.item.检查点.replace(/\n+/g, " / "),
    ]
      .filter(Boolean)
      .join("｜"),
    score: Math.round(c.score),
  }));

  return {
    matched: true,
    topScore: Math.round(top.score),
    answer: {
      ruleId: top.item.check_id,
      category: "出品检查标准",
      shouldDeduct: "按出品检查表判定",
      deductScore: top.item.风险分类 || "按检查表扣分口径",
      clauseNo: top.item.关联条款编号 || top.item.check_id,
      clauseTitle,
      clauseSnippet: top.item.检查点.slice(0, 120),
      explanation,
      source: `${top.item.来源文件 || "出品检查标准"} / ${top.item.区域 || "出品检查"}`,
      matchedReasons: top.reasons,
      consensusKeywords: top.item.tags,
      consensusApplicableScene: top.item.区域,
      aiExplanation: explanation,
      sourceKind: "production-check",
    },
    candidates: candidatePayloads,
    debug: {
      retrievalMode: "production-check",
      semanticEnabled: false,
      queryText,
      recalled: [],
      retrievalSources: ["production-checks"],
      rerankedTop: candidatePayloads,
      judgeMode: "heuristic",
      judgeSelectedRuleId: top.item.check_id,
      judgeReason: top.reasons.join("；") || "命中出品检查标准",
      judgeConfidence: Math.round(top.score),
    },
  };
}
