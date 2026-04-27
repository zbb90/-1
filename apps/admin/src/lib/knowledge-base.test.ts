import { describe, expect, it } from "vitest";
import { isConsensusCompatibleWithIntent } from "./knowledge-base";
import type { ConsensusRow, RegularQuestionIntentParse } from "./types";

function makeIntent(
  patch: Partial<RegularQuestionIntentParse>,
): RegularQuestionIntentParse {
  return {
    normalizedCategory: "",
    sceneTags: [],
    objectTags: [],
    issueTags: [],
    claimTags: [],
    exclusionTags: [],
    negationTags: [],
    complexitySignals: [],
    isComplex: false,
    needsHumanVerification: false,
    parseMode: "heuristic",
    summary: "",
    ...patch,
  };
}

function makeConsensus(patch: Partial<ConsensusRow>): ConsensusRow {
  return {
    consensus_id: "C-TEST",
    标题: "",
    关联条款编号: "",
    适用场景: "",
    解释内容: "",
    判定结果: "",
    扣分分值: "",
    关键词: "",
    示例问题: "",
    来源文件: "",
    状态: "启用",
    备注: "",
    tags: "",
    ...patch,
  };
}

describe("isConsensusCompatibleWithIntent", () => {
  it("blocks operation/proportion consensus from answering storage questions", () => {
    const result = isConsensusCompatibleWithIntent(
      makeConsensus({
        标题: "门店勺勺使用不正确",
        解释内容: "勺子可以从小变大，但不能大变小，最终看 CC 总量即可。",
        关键词: "勺子|用量|CC|配方",
      }),
      {
        category: "储存与离地问题",
        issueTitle: "摇杯内树番茄百香鲜榨汁未虚盖储存",
        description: "摇杯内装着的树番茄百香鲜榨汁未虚盖储存",
      },
      makeIntent({
        normalizedCategory: "储存与离地问题",
        sceneTags: ["吧台"],
        issueTags: ["离地"],
      }),
    );

    expect(result.allowed).toBe(false);
  });

  it("allows personal-use expiry consensus for matching personal-use expiry questions", () => {
    const result = isConsensusCompatibleWithIntent(
      makeConsensus({
        标题: "巡检发现公司物料过期/无效期，门店反馈是个人食用的",
        解释内容: "若未张贴禁用标识，仅扣过期/无效期。",
        关键词: "个人食用|自己吃|无效期|过期|禁用标识",
      }),
      {
        category: "物料效期问题",
        issueTitle: "苹果块无效期，老板反馈自己吃",
        description: "后厨操作台苹果块常温放置且无效期，老板反馈为自己吃",
      },
      makeIntent({
        normalizedCategory: "物料效期问题",
        sceneTags: ["吧台"],
        issueTags: ["无效期"],
        claimTags: ["个人食用主张", "门店反馈"],
      }),
    );

    expect(result.allowed).toBe(true);
  });
});
