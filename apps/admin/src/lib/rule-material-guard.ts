import type { RuleRow } from "@/lib/types";

/**
 * 易混物料对：用户明确提到一侧物料时，不得自动命中仅针对另一侧物料的条款。
 * 可随业务补充（如不同小料、不同效期口径），避免仅靠向量相似度把「流程相近」混成「同一品」。
 */
const MATERIAL_CONFUSABLE_PAIRS: ReadonlyArray<{ left: string; right: string }> = [
  { left: "木薯", right: "米麻薯" },
];

export function buildRegularQuestionMaterialText(request: {
  category?: string;
  issueTitle?: string;
  description?: string;
  selfJudgment?: string;
}): string {
  return [
    request.category,
    request.issueTitle,
    request.description,
    request.selfJudgment,
  ]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function buildRuleMaterialBlob(rule: RuleRow): string {
  return [
    rule.问题分类,
    rule.问题子类或关键词,
    rule.场景描述,
    rule.触发条件,
    rule.条款标题,
    rule.条款编号,
    rule.条款关键片段,
    rule.条款解释,
    rule.示例问法,
  ]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

export interface MaterialMismatchResult {
  mismatch: boolean;
  reason?: string;
}

export function detectMaterialMismatch(
  userText: string,
  rule: RuleRow,
): MaterialMismatchResult {
  const normalizedUser = String(userText ?? "").trim();
  if (!normalizedUser) {
    return { mismatch: false };
  }

  const ruleBlob = buildRuleMaterialBlob(rule);

  for (const { left, right } of MATERIAL_CONFUSABLE_PAIRS) {
    const userHasLeft = normalizedUser.includes(left);
    const userHasRight = normalizedUser.includes(right);
    const ruleHasLeft = ruleBlob.includes(left);
    const ruleHasRight = ruleBlob.includes(right);

    if (userHasLeft && !userHasRight && ruleHasRight && !ruleHasLeft) {
      return {
        mismatch: true,
        reason: `用户描述涉及「${left}」，与仅针对「${right}」的条款范围不一致，已拒绝自动命中。`,
      };
    }

    if (userHasRight && !userHasLeft && ruleHasLeft && !ruleHasRight) {
      return {
        mismatch: true,
        reason: `用户描述涉及「${right}」，与仅针对「${left}」的条款范围不一致，已拒绝自动命中。`,
      };
    }
  }

  return { mismatch: false };
}
