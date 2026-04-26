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
      /怎么做|如何做|怎么打|如何打|做法|步骤|操作|怎么处理|如何处理|想确认|确认|请问|是否|要不要|需不需要|可以吗|去冰|少冰|热饮|温饮|补水|加料|检核点|检查表|标准/g,
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

function extractOperationObjectHint(request: RegularQuestionRequest) {
  const issueObjects = extractQuestionObjects(request.issueTitle);
  const descObjects = extractQuestionObjects(request.description);
  return [...issueObjects, ...descObjects][0] ?? "";
}

const GENERIC_OPERATION_ANCHORS = new Set([
  "操作",
  "标准",
  "出品",
  "检查",
  "检核",
  "观察点",
  "稽核点",
  "扣分",
  "品质",
  "食安",
  "冰水",
  "热水",
  "水浴",
  "冰浴",
  "超时",
  "使用",
]);

function operationIdentityText(item: OperationRow) {
  return normalizeLooseText([item.标题, item.适用对象, item.关键词].join(" "));
}

function operationAnchorTerms(item: OperationRow) {
  const titleTerm = (item.标题 || "")
    .replace(/操作标准|打制标准|调制标准|出品标准|检查标准|扣分标准/g, "")
    .trim();
  const rawTerms = [
    item.适用对象,
    titleTerm,
    ...(item.关键词 || "").split(/[|｜,，、；;\s]+/g),
  ];

  return [
    ...new Set(
      rawTerms
        .map((term) => normalizeLooseText(term))
        .filter((term) => term.length >= 2)
        .filter((term) => !GENERIC_OPERATION_ANCHORS.has(term)),
    ),
  ];
}

function findExplicitOperationAnchors(
  operations: OperationRow[],
  request: RegularQuestionRequest,
) {
  const queryLoose = normalizeLooseText(buildOperationQueryText(request));
  if (!queryLoose) return [];

  const anchors = new Set<string>();
  for (const item of operations) {
    for (const term of operationAnchorTerms(item)) {
      if (queryLoose.includes(term)) {
        anchors.add(term);
      }
    }
  }
  return [...anchors].sort((left, right) => right.length - left.length);
}

function matchesAnyAnchor(item: OperationRow, anchors: string[]) {
  if (anchors.length === 0) return true;
  const identity = operationIdentityText(item);
  return anchors.some((anchor) => identity.includes(anchor));
}

function scoreOperationActionIntent(
  item: OperationRow,
  request: RegularQuestionRequest,
) {
  const queryLoose = normalizeLooseText(buildOperationQueryText(request));
  const searchLoose = normalizeLooseText(buildOperationSearchText(item));
  let score = 0;
  const reasons: string[] = [];

  const asksTimeout = /超时|过时|超过|超了|太久|未更换|没更换|没有更换/.test(
    queryLoose,
  );
  const asksBathBucket = /冰水浴桶|冰浴桶|水浴桶|冰水桶|浴桶/.test(queryLoose);
  const hasTimedReplacementEvidence = /小时|分钟|定时|计时|更换|换水|超时/.test(
    searchLoose,
  );
  const hasIceWaterEvidence = /冰水混合物|冰水|水浴|冰浴/.test(searchLoose);

  if (asksTimeout && hasTimedReplacementEvidence) {
    score += 34;
    reasons.push("问题在问超时/更换，命中带时间或更换要求的检查点");
  } else if (asksTimeout && !hasTimedReplacementEvidence) {
    score -= 28;
    reasons.push("问题在问超时，但该条未包含时间或更换要求");
  }

  if (asksBathBucket && hasIceWaterEvidence && hasTimedReplacementEvidence) {
    score += 24;
    reasons.push("问题在问冰水/水浴桶，命中冰水混合物更换要求");
  } else if (asksBathBucket && !hasTimedReplacementEvidence) {
    score -= 12;
    reasons.push("问题在问浴桶超时，该条仅泛化命中冰浴");
  }

  return { score, reasons };
}

function removeOperationLocationWords(text: string) {
  return text.replace(/操作台|操作区|操作间|操作区域|操作后台/g, "");
}

function shouldPreferRegularQuestionRoute(request: RegularQuestionRequest) {
  const combined = buildOperationQueryText(request);
  const loose = normalizeLooseText(combined);
  const hasRuleIssue =
    /无效期|效期缺失|未打效期|过期|超期|储存|存放|常温放置|冷藏|冷冻|离地|落地/.test(
      loose,
    );
  const hasPersonalUseClaim =
    /自己吃|自己喝|老板自用|员工自用|伙伴自用|个人食用|自带自食|私人物品|个人物品|私人用品|反馈自己吃|反馈.*个人食用/.test(
      loose,
    );

  return hasRuleIssue || hasPersonalUseClaim;
}

function isOperationQuestion(request: RegularQuestionRequest) {
  const combined = removeOperationLocationWords(buildOperationQueryText(request));
  if (shouldPreferRegularQuestionRoute(request)) {
    const hasStrongOperationIntent =
      /操作标准|操作流程|操作步骤|怎么操作|如何操作|配方|怎么做|如何做|怎么打|如何打|步骤|做法|出杯|出品|加料|奶露|奶芙|维也纳|抹茶液|茶汤|手泡|煮制|复热|打制|克数|多少克|多少ml|多少毫升|去冰|少冰|热饮|温饮|直饮盖|吸管|奶茶|果茶|拿铁|数据|配比|杯贴|杯型|SOP|标准糖|甜度|冰量|少糖|全糖|半糖/.test(
        combined,
      );
    if (!hasStrongOperationIntent) return false;
  }

  return /操作标准|操作流程|操作步骤|怎么操作|如何操作|配方|怎么做|如何做|怎么打|如何打|步骤|做法|出杯|出品|加料|奶露|奶芙|维也纳|抹茶液|茶汤|手泡|煮制|复热|打制|检核|检查表|检核点|检查点|观察点|扣分|食安|品质|器具|用量|克数|多少克|多少ml|多少毫升|几秒|去冰|少冰|热饮|温饮|直饮盖|吸管|风味贴|奶茶|果茶|拿铁|柠檬茶|饮品|数据|配比|杯贴|杯型|SOP|标准糖|甜度|冰量|少糖|全糖|半糖/.test(
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

  if (
    normalizeText(request.description) &&
    searchText.includes(normalizeText(request.description))
  ) {
    score += 28;
    reasons.push("问题描述与操作资料高度重合");
  }

  if (
    normalizeText(request.issueTitle) &&
    searchText.includes(normalizeText(request.issueTitle))
  ) {
    score += 18;
    reasons.push("门店问题标题命中操作资料");
  }

  if (queryLoose && searchLoose.includes(queryLoose)) {
    score += 24;
    reasons.push("完整提问可在操作资料中定位");
  }

  if (
    objectHint.length >= 2 &&
    normalizeLooseText([item.标题, item.适用对象, item.关键词].join(" ")).includes(
      objectHint,
    )
  ) {
    score += 22;
    reasons.push("命中具体产品或原料对象");
  }

  if (
    issueObjects.some((object) =>
      normalizeLooseText([item.标题, item.适用对象, item.关键词].join(" ")).includes(
        object,
      ),
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

  // 「奶茶」饮品 vs 后厨「奶露」原料：问句含「奶茶」且不是在问奶露工艺时，优先带「古茗奶茶」等茶饮名的条目，避免误命中奶露调制。
  if (queryLoose.includes("奶茶") && !queryLoose.includes("奶露")) {
    const titleLoose = normalizeLooseText(item.标题);
    if (
      titleLoose.includes("古茗奶茶") ||
      (titleLoose.includes("奶茶") && !titleLoose.includes("奶露"))
    ) {
      score += 30;
      reasons.push("问法指向调饮奶茶（非奶露原料工艺）");
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

  if (
    item.资料类型.includes("检查") &&
    /检核|检查|标准|关键项|食安|品质|出品|扣分|观察点/.test(queryText)
  ) {
    score += 18;
    reasons.push("问题更接近检查标准类资料");
  }

  if (
    item.资料类型.includes("配方") &&
    /配方|怎么做|如何做|怎么打|如何打|做法|步骤|出杯|加料|克数|ml|毫升|去冰|少冰|热饮|温饮|奶茶|果茶|拿铁|数据|配比|杯型|SOP/.test(
      queryText,
    )
  ) {
    score += 18;
    reasons.push("问题更接近配方/步骤类资料");
  }

  return { score, reasons };
}

function buildOperationCandidate(
  item: OperationRow,
  score: number,
): RegularQuestionCandidatePayload {
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
  const explicitAnchors = findExplicitOperationAnchors(
    knowledgeBase.operations,
    request,
  );
  const scoredCandidates = knowledgeBase.operations
    .map((item) => {
      const { score, reasons } = scoreOperationMatch(item, request);
      const actionIntent = scoreOperationActionIntent(item, request);
      const anchorMatched = matchesAnyAnchor(item, explicitAnchors);
      return {
        item,
        score:
          (anchorMatched && explicitAnchors.length > 0 ? score + 40 : score) +
          actionIntent.score,
        reasons:
          anchorMatched && explicitAnchors.length > 0
            ? [
                ...reasons,
                ...actionIntent.reasons,
                `命中明确产品对象：${explicitAnchors.join("、")}`,
              ]
            : [...reasons, ...actionIntent.reasons],
        anchorMatched,
      };
    })
    .filter((item) => item.score >= 18);

  const anchoredCandidates = explicitAnchors.length
    ? scoredCandidates.filter((item) => item.anchorMatched)
    : scoredCandidates;
  const candidates = (
    anchoredCandidates.length > 0 ? anchoredCandidates : scoredCandidates
  ).sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates[0];
  const operationContent = best.item.操作内容 || "";
  const checkPoints = best.item.检核要点 || "";
  const rerankedTop = candidates
    .slice(0, 5)
    .map((item) => buildOperationCandidate(item.item, item.score));

  return {
    matched: true,
    topScore: best.score,
    answer: {
      ruleId: best.item.op_id,
      category: "操作标准",
      shouldDeduct: "操作指引",
      deductScore: best.item.资料类型,
      clauseNo: best.item.资料类型,
      clauseTitle: best.item.标题,
      clauseSnippet: operationContent,
      explanation: checkPoints,
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
