import { beforeEach, describe, expect, it, vi } from "vitest";

const loadKnowledgeTableMock = vi.fn();

vi.mock("./knowledge-loader", () => ({
  loadKnowledgeTable: loadKnowledgeTableMock,
}));

describe("matchScenarioPolicyQuestion", () => {
  beforeEach(() => {
    loadKnowledgeTableMock.mockReset();
    loadKnowledgeTableMock.mockResolvedValue([
      {
        consensus_id: "C-PERSONAL-FOOD",
        标题: "反馈个人食用的物料判定口径",
        关联条款编号: "R-0063",
        适用场景: "个人食用/私人物品争议",
        解释内容:
          "门店反馈为个人食用或自己吃时，应结合是否属于私人物品区、是否有私人物品标识、是否在营运区域、后厨或操作台使用等场景判定。",
        判定结果: "按场景判定",
        扣分分值: "按共识判定",
        关键词: "自己吃|个人食用|私人物品|员工自用|老板自用",
        示例问题: "老板反馈苹果块是自己吃，是否按私人物品或无效期判定？",
        来源文件: "业务共识",
        状态: "启用",
        备注: "",
        tags: "个人食用,私人物品",
      },
    ]);
  });

  it("matches personal-use claims such as self-consumption", async () => {
    const { matchScenarioPolicyQuestion } = await import("./scenario-policy-matchers");
    const result = await matchScenarioPolicyQuestion({
      category: "物料效期问题",
      issueTitle:
        "后厨操作台苹果块常温放置且无效期，老板反馈为自己吃，是仅落点无效期，还是需要叠加储存方式不合格",
      description:
        "后厨操作台苹果块常温放置且无效期，老板反馈为自己吃，是仅落点无效期，还是需要叠加储存方式不合格",
    });

    expect(result?.matched).toBe(true);
    if (result?.matched) {
      expect(result.answer.ruleId).toBe("C-PERSONAL-FOOD");
      expect(result.answer.sourceKind).toBe("consensus");
    }
  });
});
