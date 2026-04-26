import { beforeEach, describe, expect, it, vi } from "vitest";

const loadKnowledgeTableMock = vi.fn();

vi.mock("./knowledge-loader", () => ({
  loadKnowledgeTable: loadKnowledgeTableMock,
}));

describe("matchProductionCheckQuestion", () => {
  beforeEach(() => {
    loadKnowledgeTableMock.mockReset();
    loadKnowledgeTableMock.mockResolvedValue([
      {
        check_id: "PC-BUDDING",
        来源文件: "出品操作检查表.xlsx",
        区域: "后厨",
        产品名称: "布丁",
        产品别名: "",
        风险分类: "品质",
        检核类型: "稽核点",
        检查点: "布丁水浴或常温冷却时间过长。",
        违规表达: "布丁水浴或常温冷却时间过长。",
        解释说明: "保存环境出现偏差，效期不准确。",
        判定口径: "出品检查扣分标准",
        状态: "启用",
        tags: "布丁|冰浴|水浴|超时|品质",
      },
      {
        check_id: "PC-VIENNA-CREAM",
        来源文件: "出品操作检查表.xlsx",
        区域: "后厨",
        产品名称: "维也纳云顶",
        产品别名: "",
        风险分类: "品质",
        检核类型: "稽核点",
        检查点: "淡奶油必须冰浴。",
        违规表达: "淡奶油必须冰浴。",
        解释说明: "低温助于维也纳云顶打发。",
        判定口径: "出品检查扣分标准",
        状态: "启用",
        tags: "维也纳云顶|淡奶油|冰浴|品质",
      },
      {
        check_id: "PC-VIENNA",
        来源文件: "出品操作检查表.xlsx",
        区域: "后厨",
        产品名称: "维也纳云顶",
        产品别名: "",
        风险分类: "品质",
        检核类型: "稽核点",
        检查点: "冰水混合物必须2小时进行一次更换。",
        违规表达: "冰水混合物必须2小时进行一次更换。",
        解释说明: "影响风味，且存在食安风险。",
        判定口径: "出品检查扣分标准",
        状态: "启用",
        tags: "维也纳云顶|冰水混合物|2小时|更换|品质",
      },
    ]);
  });

  it("prioritizes the product-specific timed replacement check", async () => {
    const { matchProductionCheckQuestion } =
      await import("./production-check-matchers");
    const result = await matchProductionCheckQuestion({
      category: "操作扣分",
      issueTitle: "维也纳云顶冰水浴桶超时是否扣分",
      description: "维也纳云顶冰水浴桶超时是否扣分",
    });

    expect(result?.matched).toBe(true);
    if (result?.matched) {
      expect(result.answer.ruleId).toBe("PC-VIENNA");
      expect(result.answer.sourceKind).toBe("production-check");
    }
  });
});
