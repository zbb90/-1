import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readCsvAsObjects } from "@/lib/csv";
import type {
  ConsensusRow,
  ExternalPurchaseRequest,
  ExternalPurchaseRow,
  KnowledgeBase,
  OldItemRequest,
  OldItemRow,
  RegularQuestionRequest,
  RuleRow,
} from "@/lib/types";

let cache: KnowledgeBase | null = null;

function resolveTemplateDir() {
  const candidates = [
    resolve(process.cwd(), "../../data/templates"),
    resolve(process.cwd(), "../../../data/templates"),
    resolve(process.cwd(), "../../../问答机器人/数据模板"),
    resolve(process.cwd(), "../问答机器人/数据模板"),
  ];

  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    throw new Error(
      "未找到数据模板目录，请确认 `data/templates` 或 `问答机器人/数据模板` 存在。",
    );
  }

  return match;
}

function normalizeText(input?: string) {
  return (input ?? "").trim().toLowerCase();
}

function normalizeLooseText(input?: string) {
  return normalizeText(input).replace(
    /[\s,，。；;：:、|/\\()（）[\]【】'"“”‘’\-<>_=+*#@!！？%&~`^0-9a-z]+/gi,
    "",
  );
}

function splitKeywords(text: string) {
  return text
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitTextFragments(text?: string) {
  return (text ?? "")
    .split(/[|,，。；;：:、/\\()（）[\]【】\s]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function extractCorePhrases(text?: string) {
  const phrases = new Set<string>();

  for (const fragment of splitTextFragments(text)) {
    if (fragment.length >= 2) {
      phrases.add(fragment);
    }

    for (const part of fragment
      .split(/(?:直接|放在|放置在|放置|发现|出现|使用|张贴|补打|后续|继续|进行|需要|门店|现场|并|且|以及|与|和|按要求|按标准|按照|仍在)/g)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)) {
      phrases.add(part);
    }

    const negativeMatches = fragment.match(/(?:未|无|不)[^，。；;、]{1,8}/g) ?? [];
    for (const match of negativeMatches) {
      if (match.length >= 2) {
        phrases.add(match.trim());
      }
    }
  }

  return [...phrases];
}

function buildBigrams(text?: string) {
  const normalized = normalizeLooseText(text);
  const grams = new Set<string>();

  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }

  return grams;
}

function countBigramOverlap(left: Set<string>, right: Set<string>) {
  let overlap = 0;

  for (const gram of left) {
    if (right.has(gram)) {
      overlap += 1;
    }
  }

  return overlap;
}

function buildExternalPurchaseSearchText(item: ExternalPurchaseRow) {
  return [
    item.物品名称,
    item.别名或关键词,
    item.命中的清单或共识名称,
    item.依据来源,
    item.说明,
  ]
    .join(" ")
    .toLowerCase();
}

function buildOldItemSearchText(item: OldItemRow) {
  return [
    item.物品名称,
    item.别名或常见叫法,
    item.命中的清单名称,
    item.识别备注,
  ]
    .join(" ")
    .toLowerCase();
}

function buildRuleSearchText(rule: RuleRow) {
  return [
    rule.问题分类,
    rule.问题子类或关键词,
    rule.场景描述,
    rule.触发条件,
    rule.条款标题,
    rule.条款关键片段,
    rule.条款解释,
    rule.示例问法,
  ]
    .join(" ")
    .toLowerCase();
}

/** 区分「超赏味 / 赏味期」与「超废弃 / 废弃时间」两类表述，避免笼统「过期」误命中纯废弃条款 */
function detectMaterialExpiryFocus(combined: string): "shangwei" | "feiqi" | "neutral" {
  const hasShangwei =
    /赏味期|最佳赏味|超赏味|超出赏味|已过赏味|赏味过期|赏味已过|赏味过了|赏味到/.test(
      combined,
    );
  const hasFeiqi =
    /超废弃|废弃时间|超过废弃|已过废弃|废弃期|废弃日|到废弃|废弃后仍|废弃仍/.test(
      combined,
    ) || (/废弃/.test(combined) && /超过|已过|超|晚于|拖过/.test(combined));

  if (hasShangwei && !hasFeiqi) {
    return "shangwei";
  }

  if (hasFeiqi && !hasShangwei) {
    return "feiqi";
  }

  return "neutral";
}

function ruleTextBlob(rule: RuleRow) {
  return [
    rule.问题子类或关键词,
    rule.场景描述,
    rule.触发条件,
    rule.条款标题,
    rule.条款关键片段,
    rule.条款解释,
    rule.示例问法,
  ].join("");
}

function ruleEmphasizesDiscardDeadline(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("超过废弃") ||
    blob.includes("废弃时间") ||
    blob.includes("超废弃")
  );
}

function ruleEmphasizesShangweiWindow(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("赏味") ||
    blob.includes("超赏味") ||
    blob.includes("最佳赏味")
  );
}

function scoreRuleMatch(rule: RuleRow, request: RegularQuestionRequest) {
  const description = normalizeText(request.description);
  const issueTitle = normalizeText(request.issueTitle);
  const category = normalizeText(request.category);
  const selfJudgment = normalizeText(request.selfJudgment);
  const combined = `${issueTitle} ${description}`.trim();
  const combinedLoose = normalizeLooseText(combined);
  const searchText = buildRuleSearchText(rule);
  const keywords = splitKeywords(rule.问题子类或关键词).map((keyword) =>
    keyword.toLowerCase(),
  );
  const requestBigrams = buildBigrams(combined);
  const requestCorePhrases = extractCorePhrases(combined).map((phrase) =>
    normalizeLooseText(phrase),
  );

  let score = 0;
  const reasons: string[] = [];

  if (request.category && rule.问题分类 === request.category) {
    score += 30;
    reasons.push("命中同一问题分类");
  }

  for (const keyword of keywords) {
    if (combined.includes(keyword)) {
      score += 12;
      reasons.push(`命中关键词：${keyword}`);
    }
  }

  const keywordFragments = splitTextFragments(rule.问题子类或关键词);
  const matchedKeywordFragments = keywordFragments.filter((fragment) =>
    combinedLoose.includes(normalizeLooseText(fragment)),
  );

  if (matchedKeywordFragments.length > 0) {
    score += Math.min(18, matchedKeywordFragments.length * 6);
    reasons.push("命中规则关键词片段");
  }

  if (description && searchText.includes(description)) {
    score += 20;
    reasons.push("问题描述与规则高度重合");
  }

  if (issueTitle && issueTitle !== category && searchText.includes(issueTitle)) {
    score += 12;
    reasons.push("门店问题标题命中规则");
  }

  if (selfJudgment && rule.是否扣分 && rule.是否扣分.includes(selfJudgment)) {
    score += 5;
    reasons.push("自行判断与规则结论接近");
  }

  const textHits = [rule.场景描述, rule.触发条件, rule.示例问法].filter(
    (value) =>
      value &&
      (description.includes(value.toLowerCase()) ||
        value.toLowerCase().includes(description)),
  );

  if (textHits.length > 0) {
    score += 18;
    reasons.push("场景描述或示例问法接近");
  }

  const semanticFields = [
    rule.问题子类或关键词,
    rule.场景描述,
    rule.触发条件,
    rule.条款标题,
    rule.条款关键片段,
    rule.示例问法,
  ];
  const maxOverlap = semanticFields.reduce((currentMax, field) => {
    const overlap = countBigramOverlap(requestBigrams, buildBigrams(field));
    return Math.max(currentMax, overlap);
  }, 0);

  if (maxOverlap >= 2) {
    score += Math.min(24, maxOverlap * 3);
    reasons.push("问题描述与规则语义接近");
  }

  const matchedCorePhrases = requestCorePhrases.filter((phrase) => {
    if (phrase.length < 2) {
      return false;
    }

    return semanticFields.some((field) => {
      const normalizedField = normalizeLooseText(field);
      return (
        normalizedField.includes(phrase) ||
        (phrase.length >= 4 && phrase.includes(normalizedField))
      );
    });
  });

  if (matchedCorePhrases.length > 0) {
    score += Math.min(24, matchedCorePhrases.length * 8);
    reasons.push("命中问题核心短语");
  }

  const expiryFocus = detectMaterialExpiryFocus(combined);

  if (expiryFocus === "shangwei") {
    if (
      ruleEmphasizesDiscardDeadline(rule) &&
      !ruleEmphasizesShangweiWindow(rule)
    ) {
      score -= 52;
      reasons.push("区分：表述偏赏味期，降低纯「超废弃/废弃时间」类规则优先级");
    }

    if (rule.rule_id === "R-0019") {
      score += 42;
      reasons.push("区分：超赏味期规则与赏味期表述一致（跨分类加权）");
    } else if (ruleEmphasizesShangweiWindow(rule)) {
      score += 28;
      reasons.push("区分：规则条文含赏味期/超赏味，与当前表述更一致");
    }

    if (rule.rule_id === "R-0010") {
      score += 12;
      reasons.push("区分：涉及超出赏味期后处置的关联规则");
    }
  }

  if (expiryFocus === "feiqi") {
    if (
      rule.rule_id === "R-0019" &&
      ruleEmphasizesShangweiWindow(rule) &&
      !ruleEmphasizesDiscardDeadline(rule)
    ) {
      score -= 40;
      reasons.push("区分：表述偏废弃时间，降低纯「超赏味期」规则优先级");
    }

    if (ruleEmphasizesDiscardDeadline(rule)) {
      score += 24;
      reasons.push("区分：规则条文含废弃时间/超废弃，与当前表述更一致");
    }
  }

  return { score, reasons };
}

function scoreExternalPurchaseMatch(
  item: ExternalPurchaseRow,
  request: ExternalPurchaseRequest,
) {
  const name = normalizeText(request.name);
  const description = normalizeText(request.description);
  const combined = `${name} ${description}`.trim();
  const searchText = buildExternalPurchaseSearchText(item);
  const keywords = splitKeywords(item.别名或关键词).map((keyword) =>
    keyword.toLowerCase(),
  );

  let score = 0;
  const reasons: string[] = [];

  if (name && searchText.includes(name)) {
    score += 35;
    reasons.push("物品名称直接命中");
  }

  for (const keyword of keywords) {
    if (combined.includes(keyword)) {
      score += 16;
      reasons.push(`命中关键词：${keyword}`);
    }
  }

  if (description && searchText.includes(description)) {
    score += 18;
    reasons.push("描述与外购规则高度重合");
  }

  return { score, reasons };
}

function scoreOldItemMatch(item: OldItemRow, request: OldItemRequest) {
  const name = normalizeText(request.name);
  const remark = normalizeText(request.remark);
  const combined = `${name} ${remark}`.trim();
  const searchText = buildOldItemSearchText(item);
  const keywords = splitKeywords(item.别名或常见叫法).map((keyword) =>
    keyword.toLowerCase(),
  );

  let score = 0;
  const reasons: string[] = [];

  if (name && searchText.includes(name)) {
    score += 35;
    reasons.push("物品名称直接命中");
  }

  for (const keyword of keywords) {
    if (combined.includes(keyword)) {
      score += 16;
      reasons.push(`命中别名：${keyword}`);
    }
  }

  if (remark && searchText.includes(remark)) {
    score += 15;
    reasons.push("备注信息高度接近");
  }

  return { score, reasons };
}

export async function loadKnowledgeBase(forceRefresh = false) {
  if (cache && !forceRefresh) {
    return cache;
  }

  const templateDir = resolveTemplateDir();

  const [rules, consensus, externalPurchases, oldItems] = await Promise.all([
    readCsvAsObjects<RuleRow>(resolve(templateDir, "03_常规问题规则表.csv")),
    readCsvAsObjects<ConsensusRow>(resolve(templateDir, "02_共识解释表.csv")),
    readCsvAsObjects<ExternalPurchaseRow>(resolve(templateDir, "05_外购清单表.csv")),
    readCsvAsObjects<OldItemRow>(resolve(templateDir, "04_旧品清单表.csv")),
  ]);

  cache = {
    rules: rules.filter((item) => item.状态 !== "停用"),
    consensus: consensus.filter((item) => item.状态 !== "停用"),
    externalPurchases: externalPurchases.filter((item) => item.状态 !== "停用"),
    oldItems: oldItems.filter((item) => item.状态 !== "停用"),
  };

  return cache;
}

export async function getKnowledgeSummary() {
  const knowledgeBase = await loadKnowledgeBase();
  return {
    rules: knowledgeBase.rules.length,
    consensus: knowledgeBase.consensus.length,
    externalPurchases: knowledgeBase.externalPurchases.length,
    oldItems: knowledgeBase.oldItems.length,
    templateDir: resolveTemplateDir(),
  };
}

export async function matchRegularQuestion(request: RegularQuestionRequest) {
  const knowledgeBase = await loadKnowledgeBase();
  const candidates = knowledgeBase.rules
    .map((rule) => {
      const { score, reasons } = scoreRuleMatch(rule, request);
      return { rule, score, reasons };
    })
    .filter((item) => item.score >= 20)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return {
      matched: false,
      rejectReason: "未在规则表中找到足够明确的依据，建议进入人工复核池。",
      candidates: [],
    };
  }

  const best = candidates[0];
  const linkedConsensus = best.rule.共识来源
    ? knowledgeBase.consensus.find(
        (item) => item.consensus_id === best.rule.共识来源,
      )
    : undefined;

  return {
    matched: true,
    topScore: best.score,
    answer: {
      ruleId: best.rule.rule_id,
      category: best.rule.问题分类,
      shouldDeduct: best.rule.是否扣分,
      deductScore: best.rule.扣分分值 || "待人工确认",
      clauseNo: best.rule.条款编号,
      clauseTitle: best.rule.条款标题,
      clauseSnippet: best.rule.条款关键片段,
      explanation: linkedConsensus?.解释内容 || best.rule.条款解释,
      source: linkedConsensus
        ? `${linkedConsensus.标题} / ${linkedConsensus.来源文件}`
        : best.rule.条款标题,
      matchedReasons: best.reasons,
    },
    candidates: candidates.slice(0, 5).map((item) => ({
      ruleId: item.rule.rule_id,
      category: item.rule.问题分类,
      clauseNo: item.rule.条款编号,
      clauseTitle: item.rule.条款标题,
      score: item.score,
    })),
  };
}

export async function matchExternalPurchase(request: ExternalPurchaseRequest) {
  const knowledgeBase = await loadKnowledgeBase();
  const candidates = knowledgeBase.externalPurchases
    .map((item) => {
      const { score, reasons } = scoreExternalPurchaseMatch(item, request);
      return { item, score, reasons };
    })
    .filter((item) => item.score >= 16)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return {
      matched: false,
      rejectReason: "未找到明确外购依据，建议补充更具体名称或进入人工复核。",
      candidates: [],
    };
  }

  const best = candidates[0];
  return {
    matched: true,
    answer: {
      itemId: best.item.item_id,
      name: best.item.物品名称,
      canPurchase: best.item.是否允许外购,
      sourceName: best.item.命中的清单或共识名称,
      sourceFile: best.item.依据来源,
      explanation: best.item.说明,
      matchedReasons: best.reasons,
    },
    candidates: candidates.slice(0, 5).map((item) => ({
      itemId: item.item.item_id,
      name: item.item.物品名称,
      canPurchase: item.item.是否允许外购,
      score: item.score,
    })),
  };
}

export async function matchOldItem(request: OldItemRequest) {
  const knowledgeBase = await loadKnowledgeBase();
  const candidates = knowledgeBase.oldItems
    .map((item) => {
      const { score, reasons } = scoreOldItemMatch(item, request);
      return { item, score, reasons };
    })
    .filter((item) => item.score >= 16)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return {
      matched: false,
      rejectReason: "未在旧品清单中找到明确命中，请补充更清晰名称或图片说明。",
      candidates: [],
    };
  }

  const best = candidates[0];
  return {
    matched: true,
    answer: {
      itemId: best.item.item_id,
      name: best.item.物品名称,
      isOldItem: best.item.是否旧品,
      sourceName: best.item.命中的清单名称,
      remark: best.item.识别备注,
      imageRef: best.item.参考图片名称,
      matchedReasons: best.reasons,
    },
    candidates: candidates.slice(0, 5).map((item) => ({
      itemId: item.item.item_id,
      name: item.item.物品名称,
      isOldItem: item.item.是否旧品,
      score: item.score,
    })),
  };
}
