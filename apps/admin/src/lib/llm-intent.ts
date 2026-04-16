import {
  getDashScopeApiKey,
  getDashScopeComplexModelName,
  parseJsonObject,
  requestDashScopeChat,
} from "@/lib/dashscope-client";
import type { RegularQuestionIntentParse, RegularQuestionRequest } from "@/lib/types";

type IntentTagRule = {
  tag: string;
  pattern: RegExp;
};

const SCENE_TAG_RULES: IntentTagRule[] = [
  { tag: "仓储区", pattern: /仓储区|仓库|后仓|库房|储藏区|储物间/ },
  { tag: "私人物品区", pattern: /私人物品区|私人区域|私人区|私人物品柜/ },
  { tag: "冰箱", pattern: /冰箱|冷藏柜|冷冻柜|平冷|冷柜/ },
  { tag: "垃圾桶", pattern: /垃圾桶|垃圾桶旁|垃圾桶边/ },
  { tag: "吧台", pattern: /吧台|操作台|操作区/ },
  { tag: "阁楼", pattern: /阁楼|楼梯/ },
];

const OBJECT_TAG_RULES: IntentTagRule[] = [
  { tag: "原物料", pattern: /原物料|原料|半成品|物料/ },
  { tag: "干橙片", pattern: /干橙片|橙片/ },
  { tag: "奶油", pattern: /淡奶油|奶油枪|奶油/ },
  { tag: "麻薯", pattern: /麻薯/ },
  { tag: "生椰乳", pattern: /生椰乳/ },
  { tag: "奇亚籽", pattern: /奇亚籽/ },
];

const ISSUE_TAG_RULES: IntentTagRule[] = [
  { tag: "无效期", pattern: /无效期|效期缺失|未打效期/ },
  { tag: "过期", pattern: /过期|超期|已过期/ },
  {
    tag: "无健康证",
    pattern:
      /无健康证|没有健康证|未办理健康证|未办健康证|未持有健康证|未取得健康证/,
  },
  {
    tag: "健康证过期",
    pattern:
      /健康证过期|健康证已过期|健康证到期|健康证失效|无证或健康证过期/,
  },
  {
    tag: "未录入系统",
    pattern:
      /未录入门店宝|没有录入门店宝|未录入系统|未录入架构|不在门店宝架构|未入录健康证/,
  },
  {
    tag: "未上传健康证",
    pattern: /未上传健康证|健康证未上传|门店宝未上传健康证|未上传门店宝/,
  },
  {
    tag: "健康证信息不一致",
    pattern:
      /人证不匹配|健康证有效日期与原证不一致|有效日期不一致|健康证照片无法识别|健康证未更新/,
  },
  { tag: "赏味期", pattern: /赏味期|最佳赏味/ },
  { tag: "废弃时间", pattern: /废弃时间|超废弃|废弃期/ },
  { tag: "破损", pattern: /破损|破口|裂口|漏液|漏汁|胀包/ },
  { tag: "离地", pattern: /未离地|没有离地|放在地上|落地|离地不足/ },
  { tag: "打卡考勤", pattern: /打卡|考勤|出勤|签到|迟到|早退|排班/ },
  { tag: "设备故障", pattern: /设备坏|机器坏|报修|设备故障|无法使用/ },
  { tag: "发霉积垢", pattern: /发霉|霉变|积垢|霉斑|油垢/ },
];

const CLAIM_TAG_RULES: IntentTagRule[] = [
  {
    tag: "个人食用主张",
    pattern:
      /自己吃|自己喝|伙伴自己|伙伴.*吃|个人食用|自带自食|门店反馈.*个人食用|反馈.*自己吃/,
  },
  {
    tag: "私人物品主张",
    pattern: /私人物品|私人带来|私人购买|伙伴自带|个人物品|个人用品/,
  },
  { tag: "门店反馈", pattern: /门店反馈|伙伴反馈|反馈称|反馈是|反馈说/ },
];

const EXCLUSION_TAG_RULES: IntentTagRule[] = [
  { tag: "非私人物品", pattern: /不是私人物品|非私人物品|属于门店原物料/ },
  { tag: "非个人食用", pattern: /不是个人食用|非个人食用/ },
  {
    tag: "无私人物品标识",
    pattern:
      /没有私人物品标识|无私人物品标识|未贴私人物品标识|未张贴私人物品标识|缺少私人物品标识|没有私人.*标识|没贴私人|未标注私人/,
  },
  { tag: "非人为", pattern: /非人为|不是人为|非人为原因/ },
  { tag: "已核实", pattern: /已核实|监控核实|经监控回溯|核实为/ },
  { tag: "可提醒", pattern: /可提醒|提醒|本次提醒|报备提醒|先报备/ },
];

const NEGATION_TAG_RULES: IntentTagRule[] = [
  {
    tag: "私人标识缺失",
    pattern:
      /没有私人物品标识|无私人物品标识|未贴私人物品标识|未张贴私人物品标识|缺少私人物品标识|未标注私人|没贴私人/,
  },
  { tag: "否定私人物品", pattern: /不是私人物品|非私人物品/ },
  { tag: "否定个人食用", pattern: /不是个人食用|非个人食用/ },
  { tag: "否定场景", pattern: /不是.*区域|不在.*区域|并非.*区域/ },
];

function normalizeText(value?: string) {
  return String(value ?? "").trim();
}

function normalizeCategory(request: RegularQuestionRequest, combined: string) {
  const category = normalizeText(request.category);
  if (category) return category;
  if (/离地|上架|落地|仓储/.test(combined)) return "储存与离地问题";
  if (/消杀|虫害|封堵/.test(combined)) return "虫害与消杀问题";
  if (/净水器|发霉|不洁|积垢/.test(combined)) return "设备器具清洁/霉变/积垢";
  if (/效期|过期|无效期|赏味|废弃/.test(combined)) return "物料效期问题";
  if (/证照|健康证|许可证|营业执照/.test(combined)) return "证照/记录/人员规范";
  if (/打卡|考勤|出勤|签到|排班|班次/.test(combined)) return "人员规范";
  return "";
}

function collectTags(combined: string, rules: IntentTagRule[]) {
  return rules.filter((item) => item.pattern.test(combined)).map((item) => item.tag);
}

function buildSummary(intent: Omit<RegularQuestionIntentParse, "summary">) {
  return [
    `分类=${intent.normalizedCategory || "-"}`,
    `场景=${intent.sceneTags.join("、") || "无"}`,
    `对象=${intent.objectTags.join("、") || "无"}`,
    `问题=${intent.issueTags.join("、") || "无"}`,
    `主张=${intent.claimTags.join("、") || "无"}`,
    `排除=${intent.exclusionTags.join("、") || "无"}`,
    `否定=${intent.negationTags.join("、") || "无"}`,
    `复杂=${intent.complexitySignals.join("、") || "无"}`,
    `需人工=${intent.needsHumanVerification ? "是" : "否"}`,
  ].join(" | ");
}

function detectComplexitySignals(
  combined: string,
  intent: Omit<
    RegularQuestionIntentParse,
    "summary" | "complexitySignals" | "isComplex"
  >,
) {
  const signals: string[] = [];
  if (/但是|但|不过|然而|实际|却|只是|只是说|虽然|仍然|反馈/.test(combined)) {
    signals.push("转折或反馈表述");
  }
  if (intent.negationTags.length > 0) {
    signals.push("包含否定语境");
  }
  if (intent.sceneTags.length >= 2) {
    signals.push("多场景混合");
  }
  if (intent.claimTags.length > 0) {
    signals.push("包含主张信息");
  }
  if (
    intent.claimTags.includes("个人食用主张") &&
    !intent.sceneTags.includes("私人物品区")
  ) {
    signals.push("个人食用但场景未明");
  }
  if (intent.issueTags.length >= 2) {
    signals.push("多问题标签");
  }
  return [...new Set(signals)];
}

function sanitizeIntent(intent: {
  normalizedCategory: string;
  sceneTags: string[];
  objectTags: string[];
  issueTags: string[];
  claimTags: string[];
  exclusionTags: string[];
  negationTags: string[];
  needsHumanVerification: boolean;
  parseMode: "llm" | "heuristic" | "fallback";
}) {
  let sceneTags = [...intent.sceneTags];
  if (intent.negationTags.includes("私人标识缺失")) {
    sceneTags = sceneTags.filter((tag) => tag !== "私人物品区");
  }

  const complexitySignals = detectComplexitySignals(
    [
      intent.normalizedCategory,
      ...sceneTags,
      ...intent.objectTags,
      ...intent.issueTags,
      ...intent.claimTags,
      ...intent.exclusionTags,
      ...intent.negationTags,
    ].join(" "),
    {
      ...intent,
      sceneTags,
    },
  );

  const normalized = {
    ...intent,
    sceneTags,
    complexitySignals,
    isComplex: complexitySignals.length > 0,
  };

  return {
    ...normalized,
    summary: buildSummary(normalized),
  };
}

function shouldUseLlmIntent(
  intent: RegularQuestionIntentParse,
  request: RegularQuestionRequest,
) {
  if (!getDashScopeApiKey()) {
    return false;
  }

  const combined = [
    normalizeText(request.issueTitle),
    normalizeText(request.description),
    normalizeText(request.selfJudgment),
  ].join(" ");

  if (intent.negationTags.length > 0) {
    return true;
  }
  if (intent.claimTags.length > 0 && !intent.sceneTags.includes("私人物品区")) {
    return true;
  }
  if (intent.sceneTags.length >= 2) {
    return true;
  }
  if (intent.issueTags.length >= 2) {
    return true;
  }
  return /但是|但|不过|然而|实际|却|虽然|反馈|不是|没有|未贴|未张贴/.test(combined);
}

function buildHeuristicIntent(
  request: RegularQuestionRequest,
): RegularQuestionIntentParse {
  const combined = [
    normalizeText(request.issueTitle),
    normalizeText(request.description),
    normalizeText(request.selfJudgment),
  ]
    .filter(Boolean)
    .join("\n");

  let sceneTags = collectTags(combined, SCENE_TAG_RULES);
  const exclusionTags = collectTags(combined, EXCLUSION_TAG_RULES);
  const negationTags = collectTags(combined, NEGATION_TAG_RULES);
  if (negationTags.includes("私人标识缺失")) {
    sceneTags = sceneTags.filter((tag) => tag !== "私人物品区");
  }

  const baseIntent = sanitizeIntent({
    normalizedCategory: normalizeCategory(request, combined),
    sceneTags,
    objectTags: collectTags(combined, OBJECT_TAG_RULES),
    issueTags: collectTags(combined, ISSUE_TAG_RULES),
    claimTags: collectTags(combined, CLAIM_TAG_RULES),
    exclusionTags,
    negationTags,
    needsHumanVerification:
      /核实|监控|报备|非人为|需确认|待确认/.test(combined) ||
      negationTags.length > 0 ||
      /反馈|但是|不过|虽然/.test(combined),
    parseMode: "heuristic" as const,
  });

  return baseIntent;
}

type IntentLlmResult = {
  normalizedCategory?: string;
  sceneTags?: string[];
  objectTags?: string[];
  issueTags?: string[];
  claimTags?: string[];
  exclusionTags?: string[];
  negationTags?: string[];
  needsHumanVerification?: boolean;
};

async function requestIntentFromLlm(
  request: RegularQuestionRequest,
): Promise<IntentLlmResult | null> {
  const content = [
    `问题分类：${normalizeText(request.category) || "未提供"}`,
    `门店问题：${normalizeText(request.issueTitle) || "未提供"}`,
    `问题描述：${normalizeText(request.description) || "未提供"}`,
    `自行判断：${normalizeText(request.selfJudgment) || "未提供"}`,
  ].join("\n");

  const raw = await requestDashScopeChat(
    "你是茶饮稽核问题理解器。只负责把用户问题抽取成结构化标签，不输出最终扣分结论。严格输出 JSON。sceneTags 仅可从：仓储区、私人物品区、冰箱、垃圾桶、吧台、阁楼 中选择；objectTags 仅可从：原物料、干橙片、奶油、麻薯、生椰乳、奇亚籽 中选择；issueTags 仅可从：无效期、过期、无健康证、健康证过期、未录入系统、未上传健康证、健康证信息不一致、赏味期、废弃时间、破损、离地 中选择；claimTags 仅可从：个人食用主张、私人物品主张、门店反馈 中选择；exclusionTags 仅可从：非私人物品、非个人食用、无私人物品标识、非人为、已核实、可提醒 中选择；negationTags 仅可从：私人标识缺失、否定私人物品、否定个人食用、否定场景 中选择。若问题是健康证场景，必须优先区分：1）无证/证件已过期；2）证件存在，但门店宝未录入、未上传、未更新或人证信息不一致。",
    content,
    {
      maxTokens: 260,
      responseFormat: "json_object",
      modelName: getDashScopeComplexModelName(),
      timeoutMs: 12_000,
    },
  );
  return parseJsonObject<IntentLlmResult>(raw);
}

function mergeUnique(left: string[], right: string[]) {
  return [...new Set([...left, ...right])];
}

export async function analyzeRegularQuestionIntent(
  request: RegularQuestionRequest,
): Promise<RegularQuestionIntentParse> {
  const heuristic = buildHeuristicIntent(request);
  if (!shouldUseLlmIntent(heuristic, request)) {
    return heuristic;
  }

  const llmResult = await requestIntentFromLlm(request);
  if (!llmResult) {
    return {
      ...heuristic,
      parseMode: "fallback",
      summary: buildSummary({
        ...heuristic,
        parseMode: "fallback",
      }),
    };
  }

  return sanitizeIntent({
    normalizedCategory:
      llmResult.normalizedCategory?.trim() || heuristic.normalizedCategory,
    sceneTags: mergeUnique(heuristic.sceneTags, llmResult.sceneTags ?? []),
    objectTags: mergeUnique(heuristic.objectTags, llmResult.objectTags ?? []),
    issueTags: mergeUnique(heuristic.issueTags, llmResult.issueTags ?? []),
    claimTags: mergeUnique(heuristic.claimTags, llmResult.claimTags ?? []),
    exclusionTags: mergeUnique(heuristic.exclusionTags, llmResult.exclusionTags ?? []),
    negationTags: mergeUnique(heuristic.negationTags, llmResult.negationTags ?? []),
    needsHumanVerification:
      heuristic.needsHumanVerification || Boolean(llmResult.needsHumanVerification),
    parseMode: "llm",
  });
}
