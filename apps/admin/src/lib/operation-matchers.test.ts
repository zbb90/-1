import { beforeEach, describe, expect, it, vi } from "vitest";

const loadKnowledgeBaseMock = vi.fn();

vi.mock("./knowledge-loader", () => ({
  loadKnowledgeBase: loadKnowledgeBaseMock,
}));

describe("matchOperationQuestion", () => {
  beforeEach(() => {
    loadKnowledgeBaseMock.mockReset();
    loadKnowledgeBaseMock.mockResolvedValue({
      rules: [],
      consensus: [],
      externalPurchases: [],
      oldItems: [],
      operations: [
        {
          op_id: "OP-0001",
          资料类型: "调饮配方",
          标题: "生椰抹茶麻薯操作标准",
          适用对象: "生椰抹茶麻薯",
          关键词: "生椰抹茶麻薯|抹茶液|米麻薯|去冰|少冰",
          操作内容:
            "生椰抹茶麻薯需要按配方加入米麻薯、青团、生椰乳和抹茶液；去冰时需要补冰水至标准线。",
          检核要点: "重点检查加料顺序、抹茶液份量和去冰补水动作。",
          解释说明: "用于回答饮品怎么做、去冰少冰如何处理。",
          来源文件: "20260409_调饮配方汇总版简略版_全片区.pdf",
          状态: "启用",
          备注: "",
        },
      ],
    });
  });

  it("matches operation questions against operation knowledge", async () => {
    const { matchOperationQuestion } = await import("./operation-matchers");
    const result = await matchOperationQuestion({
      category: "物料效期问题",
      issueTitle: "生椰抹茶麻薯怎么做",
      description: "想确认这款饮品去冰时抹茶液和补水怎么操作",
    });

    expect(result?.matched).toBe(true);
    if (result?.matched) {
      expect(result.answer.ruleId).toBe("OP-0001");
      expect(result.answer.category).toBe("操作标准");
      expect(result.answer.shouldDeduct).toBe("操作指引");
    }
  });

  it("ignores non-operation questions", async () => {
    const { matchOperationQuestion } = await import("./operation-matchers");
    const result = await matchOperationQuestion({
      category: "物料效期问题",
      issueTitle: "干橙片无效期",
      description: "在仓储区发现一包干橙片无效期",
    });

    expect(result).toBeNull();
  });
});
