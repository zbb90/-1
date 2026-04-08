import { loadKnowledgeBase } from "@/lib/knowledge-loader";
import type {
  OperationRow,
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

function splitTextFragments(text?: string) {
  return (text ?? "")
    .split(/[|,，。；;：:、/\\()（）[\]【】\s]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function extractQuestionObjects(text?: string) {
  return (text ?? "")
    .split(
      /怎么做|如何做|做法|步骤|操作|怎么处理|如何处理|想确认|确认|请问|是否|要不要|需不需要|可以吗|去冰|少冰|热饮|温饮|补水|加料|检核点|检查表|标准/g,
    )
    .flatMap((part) => splitTextFragments(part))
    .map((item) => normalizeLooseText(item))
    .filter((item) => item.length >= 2 && item.length <= 20);
}

function buildOperationSearchText(item: OperationRow) {
  return [
    item.资料类型,
    item.标题,
    item.适用对象,
    item.关键词,
    item.操作内容,
    item.检核要点,
    item.解释说明,
    item.来源文件,
  ]
    .join(" ")
    .toLowerCase();
}

function buildOperationQueryText(request: RegularQuestionRequest) {
  return [request.category, request.issueTitle, request.description, request.selfJudgment]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractOperationObjectHint(request: RegularQuestionRequest) {
  const issueObjects = extractQuestionObjects(request.issueTitle);
  const descObjects = extractQuestionObjects(request.description);
  return [...issueObjects, ...descObjects][0] ?? "";
}

function isOperationQuestion(request: RegularQuestionRequest) {
  const combined = buildOperationQueryText(request);
  return /操作|配方|怎么做|如何做|步骤|做法|出杯|加料|奶露|奶芙|维也纳|抹茶液|茶汤|手泡|煮制|复热|打制|检核|检查表|检核点|器具|用量|克数|多少克|多少ml|多少毫升|几秒|去冰|少冰|热饮|温饮|直饮盖|吸管|风味贴/.test(
    combined,
  );
}

function scoreOperationMatch(item: OperationRow, request: RegularQuestionRequest) {
  const queryText = buildOperationQueryText(request);
  const queryLoose = normalizeLooseText(queryText);
  const objectHint = extractOperationObjectHint(request);
  const issueObjects = extractQuestionObjects(request.issueTitle);
  const searchText = buildOperationSearchText(item);
  const searchLoose = normalizeLooseText(searchText);
  const fragments = splitTextFragments(queryText);
  const keywords = splitTextFragments(item.关键词);

  let score = 0;
  const reasons: string[] = [];

  if (normalizeText(request.description) && searchText.includes(normalizeText(request.description))) {
    score += 28;
    reasons.push("问题描述与操作资料高度重合");
  }

  if (normalizeText(request.issueTitle) && searchText.includes(normalizeText(request.issueTitle))) {
    score += 18;
    reasons.push("门店问题标题命中操作资料");
  }

  if (queryLoose && searchLoose.includes(queryLoose)) {
    score += 24;
    reasons.push("完整提问可在操作资料中定位");
  }

  if (
    objectHint.length >= 2 &&
    normalizeLooseText([item.标题, item.适用对象, item.关键词].join(" ")).includes(objectHint)
  ) {
    score += 22;
    reasons.push("命中具体产品或原料对象");
  }

  if (
    issueObjects.some((object) =>
      normalizeLooseText([item.标题, item.适用对象, item.关键词].join(" ")).includes(object),
    )
  ) {
    score += 18;
    reasons.push("标题中的产品对象与资料一致");
  }

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeLooseText(keyword);
    if (!normalizedKeyword) continue;
    if (queryLoose.includes(normalizedKeyword)) {
      score += 8;
    }
  }

  const matchedFragments = fragments.filter((fragment) => {
    const normalizedFragment = normalizeLooseText(fragment);
    return normalizedFragment && searchLoose.includes(normalizedFragment);
  });
  if (matchedFragments.length > 0) {
    score += Math.min(36, matchedFragments.length * 6);
    reasons.push("命中操作资料关键词片段");
  }

  if (item.资料类型.includes("检查") && /检核|检查|标准|关键项|食安|品质/.test(queryText)) {
    score += 18;
    reasons.push("问题更接近检查标准类资料");
  }

  if (
    item.资料类型.includes("配方") &&
    /配方|怎么做|做法|步骤|出杯|加料|克数|ml|毫升|去冰|少冰|热饮|温饮/.test(queryText)
  ) {
    score += 18;
    reasons.push("问题更接近配方/步骤类资料");
  }

  return { score, reasons };
}

function extractSnippet(item: OperationRow, request: RegularQuestionRequest) {
  const combined = buildOperationQueryText(request);
  const haystacks = [item.操作内容, item.检核要点, item.解释说明].filter(Boolean);
  const fragments = splitTextFragments(combined).sort((a, b) => b.length - a.length);

  for (const haystack of haystacks) {
    for (const fragment of fragments) {
      const index = haystack.indexOf(fragment);
      if (index >= 0) {
        const start = Math.max(0, index - 40);
        const end = Math.min(haystack.length, index + Math.max(fragment.length + 120, 140));
        return haystack.slice(start, end).replace(/\s+/g, " ").trim();
      }
    }
  }

  return (item.操作内容 || item.检核要点 || item.解释说明 || "").slice(0, 180).trim();
}

function buildOperationCandidate(item: OperationRow, score: number): RegularQuestionCandidatePayload {
  return {
    ruleId: item.op_id,
    category: "操作标准",
    clauseNo: item.资料类型,
    clauseTitle: item.标题,
    score,
  };
}

export async function matchOperationQuestion(
  request: RegularQuestionRequest,
): Promise<RegularQuestionMatchResult | null> {
  if (!isOperationQuestion(request)) {
    return null;
  }

  const knowledgeBase = await loadKnowledgeBase();
  const candidates = knowledgeBase.operations
    .map((item) => {
      const { score, reasons } = scoreOperationMatch(item, request);
      return { item, score, reasons };
    })
    .filter((item) => item.score >= 18)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates[0];
  const snippet = extractSnippet(best.item, request);
  const explanation =
    [best.item.检核要点, best.item.解释说明].filter(Boolean).join("；") ||
    best.item.操作内容 ||
    snippet;
  const rerankedTop = candidates.slice(0, 5).map((item) => buildOperationCandidate(item.item, item.score));

  return {
    matched: true,
    topScore: best.score,
    answer: {
      ruleId: best.item.op_id,
      category: "操作标准",
      shouldDeduct: "操作指引",
      deductScore: "-",
      clauseNo: best.item.资料类型,
      clauseTitle: best.item.标题,
      clauseSnippet: snippet,
      explanation,
      source: `${best.item.资料类型} / ${best.item.来源文件}`,
      matchedReasons: best.reasons,
      consensusKeywords: best.item.关键词,
      consensusApplicableScene: best.item.适用对象,
    },
    candidates: rerankedTop,
    debug: {
      retrievalMode: "operation",
      semanticEnabled: false,
      queryText: buildOperationQueryText(request),
      recalled: [],
      rerankedTop,
      fallbackReason: "识别为操作/配方/检核类提问，优先匹配操作知识表。",
    },
  };
}
