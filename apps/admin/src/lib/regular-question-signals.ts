import type { RegularQuestionIntentParse, RuleRow } from "@/lib/types";

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

export function detectMaterialExpiryFocus(
  combined: string,
): "shangwei" | "feiqi" | "neutral" {
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

export function detectDamageFocus(combined: string) {
  return /破损|破口|裂口|裂开|漏液|漏汁|漏包|胀包|包装破|袋子破|盒子破|破袋/.test(
    combined,
  );
}

export function detectLabelTamperingFocus(combined: string) {
  return /篡改风味贴|纂改风味贴|撕旧贴新|补打风味贴|重打风味贴|重新打印风味贴|更换旧的风味贴|换旧的风味贴|风味贴造假|改风味贴/.test(
    combined,
  );
}

export function detectGroundingFocus(combined: string) {
  return (
    /未离地|没离地|没有离地|不离地|未离地储存|离地不足|未按离地|未上架|没上架|没有上架|落地|直接放地上|放在地上|放地上|放地面|放在地面|贴地|接触地面/.test(
      combined,
    ) ||
    (/离地/.test(combined) && /仓库|物料|包材|原物料|存放|储存/.test(combined))
  );
}

export function detectStorageAreaFocus(combined: string) {
  return /仓储区|仓库|后仓|库房|储藏区|储物间/.test(combined);
}

export function detectPrivateAreaFocus(combined: string) {
  return /私人物品区|私人物品|私人区域|私人区|个人食用|个人用品|个人物品/.test(
    combined,
  );
}

export function detectMaterialIngredientFocus(combined: string) {
  return /原物料|物料|原料|干橙片|橙片|果干|干果/.test(combined);
}

export function ruleEmphasizesDiscardDeadline(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("超过废弃") || blob.includes("废弃时间") || blob.includes("超废弃")
  );
}

export function ruleEmphasizesShangweiWindow(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return blob.includes("赏味") || blob.includes("超赏味") || blob.includes("最佳赏味");
}

export function ruleEmphasizesMaterialDamage(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("原物料破损") ||
    blob.includes("出现破损") ||
    blob.includes("破损，进行扣分") ||
    blob.includes("物料本身") ||
    blob.includes("包装破损")
  );
}

export function ruleEmphasizesLabelExpiryError(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("张贴了解冻效期") ||
    blob.includes("开封效期") ||
    blob.includes("效期错误") ||
    blob.includes("风味贴")
  );
}

export function ruleEmphasizesGrounding(rule: RuleRow) {
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

export function ruleEmphasizesPrivateAreaOrPersonalUse(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("私人物品区") ||
    blob.includes("私人物品") ||
    blob.includes("个人食用") ||
    blob.includes("私人区域")
  );
}

export function ruleEmphasizesGenericMaterialExpiry(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("物料无效期") ||
    blob.includes("效期缺失") ||
    blob.includes("原物料") ||
    blob.includes("仓库内")
  );
}

export function ruleAllowsReminderOrVerification(rule: RuleRow) {
  return rule.是否扣分 === "否" || rule.是否扣分 === "按场景判定";
}

export function ruleEmphasizesStorageDiscard(rule: RuleRow) {
  const blob = ruleTextBlob(rule);
  return (
    blob.includes("下架物料") || blob.includes("禁用标识") || blob.includes("仓库内")
  );
}

export function ruleEmphasizesMachineFailure(rule: RuleRow) {
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

export function applyIntentSignalScore(
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
