import { describe, expect, it } from "vitest";
import { detectMaterialMismatch } from "@/lib/rule-material-guard";
import type { RuleRow } from "@/lib/types";

function makeRule(partial: Partial<RuleRow>): RuleRow {
  return {
    rule_id: "R-test",
    状态: "启用",
    问题分类: "测试",
    问题子类或关键词: "",
    场景描述: "",
    触发条件: "",
    条款编号: "T1",
    条款标题: partial.条款标题 ?? "",
    条款关键片段: partial.条款关键片段 ?? "",
    条款解释: partial.条款解释 ?? "",
    是否扣分: "否",
    扣分分值: "",
    示例问法: partial.示例问法 ?? "",
    共识来源: "",
    备注: "",
    tags: "",
    ...partial,
  };
}

describe("detectMaterialMismatch", () => {
  it("flags 木薯 user vs 米麻薯-only rule", () => {
    const user =
      "复热后的木薯冷藏储存，古茗学院标准复热后若温度还是比较高，可以冷藏20分钟，门店冷藏了55分钟";
    const rule = makeRule({
      条款标题: "米麻薯复热标准",
      条款关键片段: "米麻薯复热后需按学院标准冷藏",
    });
    const r = detectMaterialMismatch(user, rule);
    expect(r.mismatch).toBe(true);
    expect(r.reason).toContain("木薯");
  });

  it("allows rule that mentions both materials", () => {
    const user = "木薯复热";
    const rule = makeRule({
      条款标题: "小料复热（木薯、米麻薯）",
    });
    expect(detectMaterialMismatch(user, rule).mismatch).toBe(false);
  });

  it("allows when user mentions both", () => {
    const user = "木薯和米麻薯一起复热";
    const rule = makeRule({ 条款标题: "米麻薯复热标准" });
    expect(detectMaterialMismatch(user, rule).mismatch).toBe(false);
  });
});
