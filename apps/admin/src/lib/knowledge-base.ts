import {
  judgeRegularQuestionCandidates,
  type RegularQuestionJudgeCandidate,
} from "@/lib/ai";
import { matchExternalPurchase, matchOldItem } from "@/lib/catalog-matchers";
import { getKnowledgeSummary, loadKnowledgeBase } from "@/lib/knowledge-loader";
import { matchOperationQuestion } from "@/lib/operation-matchers";
import { isSemanticSearchConfigured, searchRuleVectors } from "@/lib/vector-store";
import { analyzeRegularQuestionIntent } from "@/lib/llm-intent";
import type {
  ConsensusRow,
  ExternalPurchaseRequest,
  ExternalPurchaseRow,
  KnowledgeBase,
  OldItemRequest,
  OldItemRow,
  RegularQuestionIntentParse,
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
      .split(
        /(?:直接|放在|放置在|放置|发现|出现|使用|张贴|补打|后续|继续|进行|需要|门店|现场|并|且|以及|与|和|按要求|按标准|按照|仍在)/g,
      )
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
  return [item.物品名称, item.别名或常见叫法, item.命中的清单名称, item.识别备注]
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
    ) ||
    (/废弃/.test(combined) && /超过|已过|超|晚于|拖过/.test(combined));

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
    blob.includes("超过废弃") || blob.includes("废弃时间") || blob.includes("超废弃")
  );
}

function ruleEmphasizesShangweiWindow(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return blob.includes("赏味") || blob.includes("超赏味") || blob.includes("最佳赏味");
}

function detectDamageFocus(combined: string) {
  return /破损|破口|裂口|裂开|漏液|漏汁|漏包|胀包|包装破|袋子破|盒子破|破袋/.test(
    combined,
  );
}

function detectLabelTamperingFocus(combined: string) {
  return /篡改风味贴|纂改风味贴|撕旧贴新|补打风味贴|重打风味贴|重新打印风味贴|更换旧的风味贴|换旧的风味贴|风味贴造假|改风味贴/.test(
    combined,
  );
}

function detectGroundingFocus(combined: string) {
  const hasGroundingIntent =
    /未离地|没离地|没有离地|不离地|未离地储存|离地不足|未按离地|未上架|没上架|没有上架|落地|直接放地上|放在地上|放地上|放地面|放在地面|贴地|接触地面/.test(
      combined,
    ) ||
    (/离地/.test(combined) && /仓库|物料|包材|原物料|存放|储存/.test(combined));

  return hasGroundingIntent;
}

function detectStorageAreaFocus(combined: string) {
  return /仓储区|仓库|后仓|库房|储藏区|储物间/.test(combined);
}

function detectPrivateAreaFocus(combined: string) {
  if (
    /没有私人物品标识|无私人物品标识|未贴私人物品标识|未张贴私人物品标识|没有私人.*标识|没贴私人|未标注私人/.test(
      combined,
    )
  ) {
    return false;
  }
  return /私人物品区|私人物品|私人区域|私人区|个人食用|个人用品|个人物品/.test(
    combined,
  );
}

function detectMaterialIngredientFocus(combined: string) {
  return /原物料|物料|原料|干橙片|橙片|果干|干果/.test(combined);
}

function ruleEmphasizesMaterialDamage(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("原物料破损") ||
    blob.includes("出现破损") ||
    blob.includes("破损，进行扣分") ||
    blob.includes("物料本身") ||
    blob.includes("包装破损")
  );
}

function ruleEmphasizesLabelExpiryError(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("张贴了解冻效期") ||
    blob.includes("开封效期") ||
    blob.includes("效期错误") ||
    blob.includes("风味贴")
  );
}

function ruleEmphasizesGrounding(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("未离地") ||
    blob.includes("离地>5cm") ||
    blob.includes("离地储存") ||
    blob.includes("放置在阁楼") ||
    blob.includes("楼梯上") ||
    blob.includes("是否可行走活动")
  );
}

function ruleEmphasizesPrivateAreaOrPersonalUse(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("私人物品区") ||
    blob.includes("私人物品") ||
    blob.includes("个人食用") ||
    blob.includes("私人区域")
  );
}

function ruleEmphasizesGenericMaterialExpiry(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("物料无效期") ||
    blob.includes("效期缺失") ||
    blob.includes("原物料") ||
    blob.includes("仓库内")
  );
}

function ruleAllowsReminderOrVerification(rule: RuleRow) {
  return rule.是否扣分 === "否" || rule.是否扣分 === "按场景判定";
}

function ruleEmphasizesStorageDiscard(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("下架物料") || blob.includes("禁用标识") || blob.includes("仓库内")
  );
}

function ruleEmphasizesMachineFailure(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return blob.includes("效期机") || blob.includes("报修") || blob.includes("打印机");
}

const RULE_SPECIFIC_OBJECT_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "干橙片", pattern: /干橙片|橙片/ },
  { tag: "奶油", pattern: /淡奶油|奶油枪|奶油|奶盖/ },
  { tag: "麻薯", pattern: /麻薯/ },
  { tag: "生椰乳", pattern: /生椰乳/ },
  { tag: "奇亚籽", pattern: /奇亚籽/ },
  { tag: "草莓", pattern: /草莓/ },
  { tag: "洗手液", pattern: /洗手液/ },
];

function detectRuleSpecificObjects(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return RULE_SPECIFIC_OBJECT_RULES.filter((item) => item.pattern.test(blob)).map(
    (item) => item.tag,
  );
}

function applyIntentSignalScore(
  rule: RuleRow,
  intent: RegularQuestionIntentParse | undefined,
) {
  if (!intent) {
    return { score: 0, reasons: [] as string[] };
  }

  const scoreReasons: string[] = [];
  let score = 0;
  const blob = ruleTextBlob(rule);
  const requestSpecificObjects = intent.objectTags.filter((tag) =>
    RULE_SPECIFIC_OBJECT_RULES.some((item) => item.tag === tag),
  );
  const ruleSpecificObjects = detectRuleSpecificObjects(rule);

  if (
    requestSpecificObjects.length > 0 &&
    ruleSpecificObjects.length > 0 &&
    !requestSpecificObjects.some((tag) => ruleSpecificObjects.includes(tag))
  ) {
    score -= 20;
    scoreReasons.push("意图理解：规则聚焦的具体对象与当前提问不一致");
  }

  if (intent.sceneTags.includes("仓储区")) {
    if (rule.rule_id === "R-0064" || /仓储区|仓库|后仓|原物料|效期缺失/.test(blob)) {
      score += 16;
      scoreReasons.push("意图理解：仓储区场景更贴近原物料/无效期规则");
    }
    if (ruleEmphasizesPrivateAreaOrPersonalUse(rule)) {
      score -= 16;
      scoreReasons.push("意图理解：仓储区与私人物品区语义不一致");
    }
  }

  if (intent.sceneTags.includes("阁楼")) {
    if (/阁楼|楼梯/.test(blob) || rule.rule_id === "R-0052") {
      score += 28;
      scoreReasons.push("意图理解：已识别阁楼/楼梯具体场景，提升专属规则");
    }

    if (rule.rule_id === "R-0018") {
      score -= 18;
      scoreReasons.push("意图理解：存在更具体的阁楼场景，降低通用未离地规则");
    }
  }

  if (
    intent.sceneTags.includes("私人物品区") &&
    ruleEmphasizesPrivateAreaOrPersonalUse(rule)
  ) {
    score += 18;
    scoreReasons.push("意图理解：明确是私人物品区场景");
  }

  if (
    intent.objectTags.includes("原物料") &&
    ruleEmphasizesGenericMaterialExpiry(rule)
  ) {
    score += 12;
    scoreReasons.push("意图理解：对象为原物料，提升通用物料效期规则");
  }

  if (
    intent.issueTags.some((tag) => tag === "无效期" || tag === "过期") &&
    ruleEmphasizesGenericMaterialExpiry(rule)
  ) {
    score += 10;
    scoreReasons.push("意图理解：问题聚焦无效期/过期");
  }

  if (
    intent.exclusionTags.some((tag) => tag === "非私人物品" || tag === "非个人食用") &&
    ruleEmphasizesPrivateAreaOrPersonalUse(rule)
  ) {
    score -= 30;
    scoreReasons.push("意图理解：已明确排除私人物品/个人食用");
  }

  if (intent.exclusionTags.includes("非人为") && ruleEmphasizesMaterialDamage(rule)) {
    score += 8;
    scoreReasons.push("意图理解：描述提到非人为，更接近破损/个案核实类规则");
  }

  if (
    intent.issueTags.some((tag) => tag === "无效期" || tag === "过期") &&
    ruleEmphasizesMaterialDamage(rule) &&
    !ruleEmphasizesGenericMaterialExpiry(rule)
  ) {
    score -= 26;
    scoreReasons.push("意图理解：当前核心是效期问题，降低纯破损类规则优先级");
  }

  if (intent.sceneTags.includes("垃圾桶")) {
    if (rule.rule_id === "R-0064" || ruleEmphasizesGenericMaterialExpiry(rule)) {
      score += 14;
      scoreReasons.push("意图理解：垃圾桶/废弃回溯场景更贴近通用物料无效期规则");
    }

    if (ruleEmphasizesStorageDiscard(rule) && !intent.sceneTags.includes("仓储区")) {
      score -= 24;
      scoreReasons.push(
        "意图理解：当前不是仓库下架物料场景，降低禁用标识/下架物料规则",
      );
    }
  }

  if (
    intent.issueTags.includes("无效期") &&
    ruleEmphasizesMachineFailure(rule) &&
    !intent.exclusionTags.includes("已核实")
  ) {
    score -= 18;
    scoreReasons.push("意图理解：未提到效期机故障或报修，降低设备故障特例优先级");
  }

  if (
    intent.exclusionTags.includes("可提醒") &&
    ruleAllowsReminderOrVerification(rule)
  ) {
    score += 8;
    scoreReasons.push("意图理解：用户倾向提醒/核实，提升不扣分或按场景判定规则");
  }

  if (
    intent.needsHumanVerification &&
    ruleAllowsReminderOrVerification(rule) &&
    !ruleEmphasizesPrivateAreaOrPersonalUse(rule)
  ) {
    score += 6;
    scoreReasons.push("意图理解：该问题需要人工核实，适合保留提醒/按场景判定候选");
  }

  return { score, reasons: scoreReasons };
}

type SpecificSceneRuleConfig = {
  label: string;
  requestPattern: RegExp;
  rulePattern: RegExp;
  specificRuleIds?: string[];
};

const SPECIFIC_SCENE_RULES: SpecificSceneRuleConfig[] = [
  {
    label: "阁楼/楼梯",
    requestPattern: /阁楼|楼梯/,
    rulePattern: /阁楼|楼梯/,
    specificRuleIds: ["R-0052"],
  },
  {
    label: "平冷/凹槽",
    requestPattern: /平冷|凹槽|冷藏柜/,
    rulePattern: /平冷|凹槽|冷藏柜/,
  },
  {
    label: "水浴/解冻",
    requestPattern: /水浴|解冻|常温解冻/,
    rulePattern: /水浴|解冻|常温解冻/,
  },
  {
    label: "化学品专区",
    requestPattern: /化学品|消毒剂|清洁剂|化学品专区/,
    rulePattern: /化学品|消毒剂|清洁剂|化学品专区/,
  },
];

function ruleEmphasizesPureExpiry(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("过期") ||
    blob.includes("效期") ||
    blob.includes("赏味") ||
    blob.includes("废弃") ||
    blob.includes("禁用标识") ||
    blob.includes("风味贴")
  );
}

function calculateVectorBoost(vectorScore: number) {
  if (vectorScore >= 0.95) {
    return 36;
  }
  if (vectorScore >= 0.9) {
    return 30;
  }
  if (vectorScore >= 0.85) {
    return 24;
  }
  if (vectorScore >= 0.8) {
    return 18;
  }
  if (vectorScore >= 0.75) {
    return 12;
  }
  return 6;
}

function detectSemanticCategoryHint(
  hits: Array<{ ruleId: string; vectorScore: number }>,
  rules: RuleRow[],
  userCategory: string,
): string | null {
  if (hits.length < 3) return null;
  const topHits = hits.slice(0, 5);
  const ruleMap = new Map(rules.map((r) => [r.rule_id, r]));
  const counts: Record<string, number> = {};
  for (const hit of topHits) {
    const rule = ruleMap.get(hit.ruleId);
    if (rule) counts[rule.问题分类] = (counts[rule.问题分类] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  const [topCat, topCount] = sorted[0];
  if (topCat !== userCategory && topCount >= 3) return topCat;
  return null;
}

function ruleIsGenericGrounding(rule: RuleRow) {
  return rule.rule_id === "R-0018";
}

function detectSpecificSceneMentions(combined: string) {
  return SPECIFIC_SCENE_RULES.filter((item) => item.requestPattern.test(combined));
}

function ruleMatchesSpecificScene(rule: RuleRow, scene: SpecificSceneRuleConfig) {
  const blob = ruleTextBlob(rule);
  return (
    scene.rulePattern.test(blob) ||
    Boolean(scene.specificRuleIds?.includes(rule.rule_id))
  );
}

function scoreRuleMatch(
  rule: RuleRow,
  request: RegularQuestionRequest,
  intent?: RegularQuestionIntentParse,
  semanticCategoryHint?: string | null,
) {
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
    if (semanticCategoryHint && semanticCategoryHint !== request.category) {
      score += 10;
      reasons.push("命中用户选定分类（语义召回提示分类可能偏差，已降权）");
    } else {
      score += 30;
      reasons.push("命中同一问题分类");
    }
  }

  if (semanticCategoryHint && rule.问题分类 === semanticCategoryHint) {
    score += 20;
    reasons.push(`语义召回集中指向「${semanticCategoryHint}」，跨分类加权`);
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
  const damageFocus = detectDamageFocus(combined);
  const labelTamperingFocus = detectLabelTamperingFocus(combined);
  const groundingFocus = detectGroundingFocus(combined);
  const storageAreaFocus = detectStorageAreaFocus(combined);
  const privateAreaFocus = detectPrivateAreaFocus(combined);
  const materialIngredientFocus = detectMaterialIngredientFocus(combined);
  const specificScenes = detectSpecificSceneMentions(combined);
  const hasExpiryIssue =
    /无效期|效期缺失|过期/.test(combined) || expiryFocus !== "neutral";
  const machineFailureMentioned = /效期机|打印机|报修|机器坏|设备坏/.test(combined);
  const mislabeledMarkerFocus = /贴错|错贴|贴成|先用标识|禁用标识/.test(combined);

  if (expiryFocus === "shangwei") {
    if (ruleEmphasizesDiscardDeadline(rule) && !ruleEmphasizesShangweiWindow(rule)) {
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
      if (labelTamperingFocus) {
        score += 26;
        reasons.push("区分：明确提到篡改/补打风味贴，更贴近篡改风味贴规则");
      } else {
        score -= 28;
        reasons.push("区分：当前仅为超赏味期，降低篡改风味贴特殊条款优先级");
      }
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

  if (damageFocus) {
    if (rule.rule_id === "R-0114" || ruleEmphasizesMaterialDamage(rule)) {
      score += 46;
      reasons.push("区分：描述聚焦破损/漏液，更贴近原物料破损类共识");
    }

    if (rule.rule_id === "R-0069" || ruleEmphasizesLabelExpiryError(rule)) {
      score -= 36;
      reasons.push("区分：描述聚焦破损，降低纯效期张贴错误类规则优先级");
    }
  }

  if (damageFocus && hasExpiryIssue && storageAreaFocus) {
    if (rule.rule_id === "R-0064") {
      score += 24;
      reasons.push(
        "区分：仓储区原物料同时出现效期问题与附带破损，优先按物料无效期处理",
      );
    }

    if (rule.rule_id === "R-0114") {
      score -= 28;
      reasons.push("区分：当前核心仍是仓储区效期问题，降低纯破损共识优先级");
    }
  }

  if (groundingFocus) {
    if (rule.rule_id === "R-0018") {
      score += 58;
      reasons.push("区分：描述聚焦未离地/落地存放，与通用离地储存规则最一致");
    } else if (ruleEmphasizesGrounding(rule)) {
      score += 34;
      reasons.push("区分：描述聚焦未离地/落地存放，提升离地储存类规则优先级");
    }

    if (ruleEmphasizesPureExpiry(rule) && !ruleEmphasizesGrounding(rule)) {
      score -= 44;
      reasons.push("区分：当前问题核心是未离地，降低纯效期/过期类规则优先级");
    }

    if (rule.rule_id === "R-0052" && !/阁楼|楼梯/.test(combined)) {
      score -= 10;
      reasons.push("区分：当前未提到阁楼/楼梯，降低特定场景共识优先级");
    }
  }

  if (specificScenes.length > 0) {
    for (const scene of specificScenes) {
      const matchedSpecificScene = ruleMatchesSpecificScene(rule, scene);

      if (matchedSpecificScene) {
        score += 24;
        reasons.push(`区分：命中更具体场景「${scene.label}」，提升场景专属规则优先级`);
      }

      if (groundingFocus && ruleIsGenericGrounding(rule) && !matchedSpecificScene) {
        score -= 22;
        reasons.push(
          `区分：当前已明确具体场景「${scene.label}」，降低通用未离地规则优先级`,
        );
      }
    }
  }

  if (storageAreaFocus && (expiryFocus !== "neutral" || materialIngredientFocus)) {
    if (rule.rule_id === "R-0064" || ruleEmphasizesGenericMaterialExpiry(rule)) {
      score += 30;
      reasons.push(
        "区分：描述聚焦仓储区/仓库内原物料无效期，提升通用物料无效期规则优先级",
      );
    }

    if (ruleEmphasizesPrivateAreaOrPersonalUse(rule) && !privateAreaFocus) {
      score -= 42;
      reasons.push(
        "区分：当前描述未提到私人物品区/个人食用，降低私人物品类效期规则优先级",
      );
    }
  }

  if (
    hasExpiryIssue &&
    !machineFailureMentioned &&
    ruleEmphasizesMachineFailure(rule)
  ) {
    score -= 26;
    reasons.push("区分：描述未提到效期机故障/报修，降低设备故障特例优先级");
  }

  if (mislabeledMarkerFocus && hasExpiryIssue) {
    if (rule.rule_id === "R-0064") {
      score += 16;
      reasons.push("区分：禁用/先用标识贴错但现场仍在使用，更贴近通用物料无效期");
    }

    if (rule.rule_id === "R-0010" && !labelTamperingFocus) {
      score -= 22;
      reasons.push("区分：当前是标识贴错而非故意篡改风味贴，降低篡改规则优先级");
    }
  }

  if (intent?.sceneTags.includes("垃圾桶") && intent.exclusionTags.includes("可提醒")) {
    if (rule.rule_id === "R-0064") {
      score += 18;
      reasons.push("区分：垃圾桶废弃回溯且可提醒，优先按通用物料无效期处理");
    }

    if (
      (ruleEmphasizesDiscardDeadline(rule) || /篡改风味贴/.test(ruleTextBlob(rule))) &&
      !labelTamperingFocus
    ) {
      score -= 28;
      reasons.push("区分：当前是废弃回溯提醒场景，降低超废弃/篡改风味贴总则优先级");
    }
  }

  if (privateAreaFocus && ruleEmphasizesPrivateAreaOrPersonalUse(rule)) {
    score += 32;
    reasons.push("区分：描述明确提到私人物品区/个人食用，提升私人物品类规则优先级");
  }

  const noPrivateLabelMentioned =
    /没有私人物品标识|无私人物品标识|未贴私人|未张贴私人|没贴私人/.test(combined);
  const personalFoodClaim = /自己吃|伙伴.*吃|个人食用|反馈.*私人|门店反馈.*个人/.test(
    combined,
  );
  if (noPrivateLabelMentioned || (personalFoodClaim && !privateAreaFocus)) {
    const ruleBlob = ruleTextBlob(rule);
    if (/反馈.*个人食用|门店反馈.*个人|未张贴禁用标识/.test(ruleBlob)) {
      score += 45;
      reasons.push("区分：声称个人食用但无私人物品标识，强力提升'反馈个人食用'规则");
    }
    if (/私人物品区出现/.test(ruleBlob) && !/未张贴/.test(ruleBlob)) {
      score -= 35;
      reasons.push("区分：无私人物品标识不等于在私人物品区，降低纯私人物品区规则");
    }
    if (personalFoodClaim && !/个人食用|私人物品|门店反馈|禁用标识/.test(ruleBlob)) {
      score -= 16;
      reasons.push("区分：问题核心是个人食用+无标识，降低不涉及该场景的规则");
    }
  }

  const moldCleaningFocus = /发霉|霉变|积垢|霉斑|清洁不到位|器具脏|油垢/.test(combined);
  if (moldCleaningFocus) {
    const ruleBlob = ruleTextBlob(rule);
    if (/发霉|霉变|积垢|器具|清洁|霉斑|霉/.test(ruleBlob)) {
      score += 26;
      reasons.push("区分：描述聚焦发霉/霉变/积垢，提升器具清洁/霉变类规则");
    }
    if (ruleEmphasizesPureExpiry(rule) && !/发霉|霉变|积垢|霉/.test(ruleBlob)) {
      score -= 30;
      reasons.push("区分：当前问题核心是发霉/积垢，降低纯效期类规则");
    }
  }

  const intentSignal = applyIntentSignalScore(rule, intent);
  score += intentSignal.score;
  reasons.push(...intentSignal.reasons);

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

export async function matchRegularQuestion(
  request: RegularQuestionRequest,
): Promise<RegularQuestionMatchResult> {
  const intentParse = await analyzeRegularQuestionIntent(request);
  const [knowledgeBase, semanticResult] = await Promise.all([
    loadKnowledgeBase(),
    searchRuleVectors(request, intentParse),
  ]);
  const semanticRuleIds = semanticResult.hits.map((item) => item.ruleId);
  const semanticRuleLookup = new Set(semanticRuleIds);
  const semanticRules = knowledgeBase.rules.filter((rule) =>
    semanticRuleLookup.has(rule.rule_id),
  );
  const vectorScoreByRule = new Map(
    semanticResult.hits.map((item) => [item.ruleId, item.vectorScore]),
  );
  const usingSemanticRecall = semanticRules.length > 0;
  const candidatePool = usingSemanticRecall ? semanticRules : knowledgeBase.rules;
  const retrievalMode: RegularQuestionMatchDebug["retrievalMode"] = usingSemanticRecall
    ? "semantic"
    : "fallback";
  const debug: RegularQuestionMatchDebug = {
    retrievalMode,
    semanticEnabled: isSemanticSearchConfigured(),
    queryText: semanticResult.queryText,
    fallbackReason: usingSemanticRecall
      ? undefined
      : semanticResult.fallbackReason || "语义召回未返回候选，回退整表扫描。",
    recalled: semanticResult.hits,
    intentParse,
  };

  const semanticCategoryHint = usingSemanticRecall
    ? detectSemanticCategoryHint(
        semanticResult.hits,
        knowledgeBase.rules,
        request.category || "",
      )
    : null;

  const candidates = candidatePool
    .map((rule) => {
      const { score: baseScore, reasons: baseReasons } = scoreRuleMatch(
        rule,
        request,
        intentParse,
        semanticCategoryHint,
      );
      const vectorScore = vectorScoreByRule.get(rule.rule_id);
      const vectorBoost =
        vectorScore === undefined ? undefined : calculateVectorBoost(vectorScore);
      const score = baseScore + (vectorBoost ?? 0);
      const reasons =
        vectorScore === undefined
          ? baseReasons
          : [
              `语义召回命中：相似度 ${vectorScore.toFixed(3)}，向量加权 +${vectorBoost}`,
              ...baseReasons,
            ];
      return { rule, score, reasons, vectorScore, vectorBoost };
    })
    .filter((item) => item.score >= 20)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    console.info("[regular-question-match]", {
      retrievalMode: debug.retrievalMode,
      fallbackReason: debug.fallbackReason,
      queryText: debug.queryText,
      recalled: debug.recalled,
      rerankedTop: [],
      matched: false,
    });
    return {
      matched: false,
      rejectReason: "未在规则表中找到足够明确的依据，建议进入人工复核池。",
      candidates: [],
      debug: {
        ...debug,
        rerankedTop: [],
      },
    };
  }

  const rerankedTop = candidates.slice(0, 5).map((item) => ({
    ruleId: item.rule.rule_id,
    category: item.rule.问题分类,
    clauseNo: item.rule.条款编号,
    clauseTitle: item.rule.条款标题,
    score: item.score,
    vectorScore: item.vectorScore,
    vectorBoost: item.vectorBoost,
  }));

  const topGap =
    candidates.length >= 2 ? candidates[0].score - candidates[1].score : Infinity;
  const needsLlmJudge = candidates.length > 1 && topGap < 12;

  let judgeDecision = needsLlmJudge
    ? await judgeRegularQuestionCandidates(
        request,
        intentParse,
        candidates.slice(0, 5).map((item) => {
          const linkedConsensus = item.rule.共识来源
            ? knowledgeBase.consensus.find(
                (consensus) => consensus.consensus_id === item.rule.共识来源,
              )
            : undefined;

          const judgeCandidate: RegularQuestionJudgeCandidate = {
            ruleId: item.rule.rule_id,
            category: item.rule.问题分类,
            clauseNo: item.rule.条款编号,
            clauseTitle: item.rule.条款标题,
            score: item.score,
            vectorScore: item.vectorScore,
            vectorBoost: item.vectorBoost,
            shouldDeduct: item.rule.是否扣分,
            deductScore: item.rule.扣分分值 || "待人工确认",
            clauseSnippet: item.rule.条款关键片段,
            explanation: linkedConsensus?.解释内容 || item.rule.条款解释,
            matchedReasons: item.reasons,
          };

          return judgeCandidate;
        }),
      )
    : {
        judgeMode: topGap >= 12 ? ("score-gap" as const) : ("legacy" as const),
        selectedRuleId: candidates[0].rule.rule_id,
        confidence: topGap >= 12 ? 0.9 : 1,
        judgeReason:
          topGap >= 12
            ? `首位与次位分差 ${topGap} ≥ 12，跳过 LLM 裁判直接采用最高分。`
            : "仅有一个有效候选，沿用旧排序结果。",
        rejectedRuleIds: candidates.slice(1).map((item) => item.rule.rule_id),
      };

  const selectedCandidate =
    candidates.find((item) => item.rule.rule_id === judgeDecision.selectedRuleId) ??
    candidates[0];
  if (candidates[0].score - selectedCandidate.score >= 8) {
    judgeDecision = {
      judgeMode: "fallback",
      selectedRuleId: candidates[0].rule.rule_id,
      confidence: judgeDecision.confidence,
      judgeReason: `裁判结果与基础排序偏差过大，回退到最高分候选：${candidates[0].rule.rule_id}`,
      rejectedRuleIds: candidates
        .slice(1)
        .map((item) => item.rule.rule_id)
        .filter((ruleId) => ruleId !== candidates[0].rule.rule_id),
    };
  }

  const best =
    candidates.find((item) => item.rule.rule_id === judgeDecision.selectedRuleId) ??
    candidates[0];
  const linkedConsensus = best.rule.共识来源
    ? knowledgeBase.consensus.find((item) => item.consensus_id === best.rule.共识来源)
    : undefined;

  console.info("[regular-question-match]", {
    retrievalMode: debug.retrievalMode,
    fallbackReason: debug.fallbackReason,
    queryText: debug.queryText,
    recalled: debug.recalled,
    intentParse,
    rerankedTop,
    matched: true,
    bestRuleId: best.rule.rule_id,
    judgeMode: judgeDecision.judgeMode,
    judgeReason: judgeDecision.judgeReason,
  });

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
      consensusKeywords: linkedConsensus?.关键词?.trim() || "",
      consensusApplicableScene: linkedConsensus?.适用场景?.trim() || "",
    },
    candidates: rerankedTop,
    debug: {
      ...debug,
      rerankedTop,
      judgeMode: judgeDecision.judgeMode,
      judgeSelectedRuleId: judgeDecision.selectedRuleId,
      judgeReason: judgeDecision.judgeReason,
      judgeConfidence: judgeDecision.confidence,
      judgeRejectedRuleIds: judgeDecision.rejectedRuleIds,
    },
  };
}
