import { parseJsonObject, requestDashScopeChat } from "@/lib/dashscope-client";
import type { RegularQuestionIntentParse, RegularQuestionRequest } from "@/lib/types";

type IntentTagRule = {
  tag: string;
  pattern: RegExp;
};

const SCENE_TAG_RULES: IntentTagRule[] = [
  { tag: "仓储区", pattern: /仓储区|仓库|后仓|库房|储藏区|储物间/ },
  { tag: "私人物品区", pattern: /私人物品区|私人区|私人物品|私人区域/ },
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
  { tag: "赏味期", pattern: /赏味期|最佳赏味/ },
  { tag: "废弃时间", pattern: /废弃时间|超废弃|废弃期/ },
  { tag: "破损", pattern: /破损|破口|裂口|漏液|漏汁|胀包/ },
  { tag: "离地", pattern: /未离地|没有离地|放在地上|落地|离地不足/ },
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

function normalizeText(value?: string) {
  return String(value ?? "").trim();
}

function normalizeCategory(request: RegularQuestionRequest, combined: string) {
  const category = normalizeText(request.category);
  if (category) return category;
  if (/离地|上架|落地|仓储/.test(combined)) return "储存与离地问题";
  if (/消杀|虫害|封堵/.test(combined)) return "虫害与消杀问题";
  if (/净水器|发霉|不洁|积垢/.test(combined)) return "设备器具清洁/霉变/积垢";
  return "物料效期问题";
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
    `排除=${intent.exclusionTags.join("、") || "无"}`,
    `需人工=${intent.needsHumanVerification ? "是" : "否"}`,
  ].join(" | ");
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

  if (exclusionTags.includes("无私人物品标识")) {
    sceneTags = sceneTags.filter((t) => t !== "私人物品区");
  }

  const baseIntent = {
    normalizedCategory: normalizeCategory(request, combined),
    sceneTags,
    objectTags: collectTags(combined, OBJECT_TAG_RULES),
    issueTags: collectTags(combined, ISSUE_TAG_RULES),
    exclusionTags,
    needsHumanVerification: /核实|监控|报备|非人为|需确认|待确认/.test(combined),
    parseMode: "heuristic" as const,
  };

  return {
    ...baseIntent,
    summary: buildSummary(baseIntent),
  };
}

type IntentLlmResult = {
  normalizedCategory?: string;
  sceneTags?: string[];
  objectTags?: string[];
  issueTags?: string[];
  exclusionTags?: string[];
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
    "你是茶饮稽核问题理解器。只负责把用户问题抽取成结构化标签，不输出最终扣分结论。严格输出 JSON。sceneTags 仅可从：仓储区、私人物品区、冰箱、垃圾桶、吧台、阁楼 中选择；objectTags 仅可从：原物料、干橙片、奶油、麻薯、生椰乳、奇亚籽 中选择；issueTags 仅可从：无效期、过期、赏味期、废弃时间、破损、离地 中选择；exclusionTags 仅可从：非私人物品、非个人食用、非人为、已核实、可提醒 中选择。",
    content,
    { maxTokens: 220, responseFormat: "json_object" },
  );
  return parseJsonObject<IntentLlmResult>(raw);
}

function mergeUnique(left: string[], right: string[]) {
  return [...new Set([...left, ...right])];
}

export async function analyzeRegularQuestionIntent(
  request: RegularQuestionRequest,
): Promise<RegularQuestionIntentParse> {
  return buildHeuristicIntent(request);
}
