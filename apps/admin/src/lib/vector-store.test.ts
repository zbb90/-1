import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildConsensusVectorDocument, buildRuleVectorDocument } from "./vector-store";
import type { ConsensusRow, RuleRow } from "./types";

vi.mock("@qdrant/js-client-rest", () => {
  const search = vi.fn();
  const upsert = vi.fn(async () => undefined);
  const ensureCollection = vi.fn(async () => undefined);

  const fakeClient = {
    search,
    upsert,
    getCollection: vi.fn(async () => undefined),
    createCollection: vi.fn(async () => undefined),
    createPayloadIndex: vi.fn(async () => undefined),
    deleteCollection: vi.fn(async () => undefined),
  };

  return {
    QdrantClient: vi.fn(() => fakeClient),
    __test__: { fakeClient, ensureCollection },
  };
});

vi.mock("@/lib/embeddings", () => ({
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((_, i) => Array.from({ length: 8 }, (_, j) => i + j * 0.01)),
  ),
  isEmbeddingConfigured: () => true,
}));

describe("vector-store helpers", () => {
  const baseRule: RuleRow = {
    rule_id: "R-0001",
    问题分类: "健康证",
    问题子类或关键词: "无证|过期",
    场景描述: "员工无健康证",
    触发条件: "现场无证",
    条款标题: "健康证缺失",
    条款编号: "H1.1",
    条款关键片段: "凡未取得健康证不得上岗",
    条款解释: "依据……",
    示例问法: "员工没有健康证怎么办",
    是否扣分: "是",
    扣分分值: "2",
    共识来源: "C-0001",
    备注: "",
    tags: "",
    状态: "启用",
  };

  const baseConsensus: ConsensusRow = {
    consensus_id: "C-0089",
    标题: "新品下架尺度",
    适用场景: "下架处罚",
    解释内容: "打烊前 1 小时下架不扣分",
    判定结果: "不扣分",
    扣分分值: "0",
    关键词: "下架|打烊",
    示例问题: "打烊前 1 小时下架要扣吗",
    来源文件: "运营共识",
    更新时间: "2026-04-01",
    状态: "启用",
    关联条款编号: "R-0050",
    备注: "",
    tags: "",
  };

  it("buildRuleVectorDocument 拼接所有关键字段", () => {
    const doc = buildRuleVectorDocument(baseRule);
    expect(doc).toContain("条款编号:H1.1");
    expect(doc).toContain("条款标题:健康证缺失");
    expect(doc).toContain("示例问法:员工没有健康证怎么办");
  });

  it("buildConsensusVectorDocument 包含共识专属字段", () => {
    const doc = buildConsensusVectorDocument(baseConsensus);
    expect(doc).toContain("共识标题:新品下架尺度");
    expect(doc).toContain("适用场景:下架处罚");
    expect(doc).toContain("关联条款编号:R-0050");
    expect(doc).toContain("解释内容:打烊前 1 小时下架不扣分");
  });
});

describe("searchKnowledgeVectors 双源召回", () => {
  const originalQdrantUrl = process.env.QDRANT_URL;
  const originalDashKey = process.env.DASHSCOPE_API_KEY;

  beforeEach(() => {
    process.env.QDRANT_URL = "http://localhost:6333";
    process.env.DASHSCOPE_API_KEY = "test";
  });

  afterEach(() => {
    if (originalQdrantUrl === undefined) delete process.env.QDRANT_URL;
    else process.env.QDRANT_URL = originalQdrantUrl;
    if (originalDashKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalDashKey;
    vi.resetModules();
  });

  it("按 payload.kind 拆分为 ruleHits 与 consensusHits；旧数据无 kind 当 rule", async () => {
    vi.resetModules();

    vi.doMock("@qdrant/js-client-rest", () => {
      const fakeClient = {
        search: vi.fn(async () => [
          {
            id: "rule-id-1",
            score: 0.91,
            payload: {
              kind: "rule",
              ruleId: "R-0001",
              category: "健康证",
              clauseTitle: "健康证缺失",
              clauseNo: "H1.1",
              consensusSource: "C-0001",
              status: "启用",
              document: "...",
            },
          },
          {
            id: "cs-id-1",
            score: 0.87,
            payload: {
              kind: "consensus",
              consensusId: "C-0089",
              title: "新品下架尺度",
              applicableScene: "下架处罚",
              relatedClauseNo: "R-0050",
              status: "启用",
              document: "...",
            },
          },
          {
            id: "legacy-id",
            score: 0.6,
            payload: {
              ruleId: "R-0010",
              category: "卫生",
              clauseTitle: "操作台清洁",
              clauseNo: "H2.1",
              status: "启用",
              document: "...",
            },
          },
        ]),
        getCollection: vi.fn(async () => undefined),
        createCollection: vi.fn(async () => undefined),
        createPayloadIndex: vi.fn(async () => undefined),
        upsert: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
      };
      return { QdrantClient: vi.fn(() => fakeClient) };
    });

    vi.doMock("@/lib/embeddings", () => ({
      embedTexts: vi.fn(async (texts: string[]) =>
        texts.map(() => Array.from({ length: 8 }, () => 0.1)),
      ),
      isEmbeddingConfigured: () => true,
    }));

    const mod = await import("./vector-store");
    const result = await mod.searchKnowledgeVectors({
      category: "健康证",
      issueTitle: "员工无健康证",
      description: "现场抽查",
      selfJudgment: "扣分",
    });

    expect(result.ruleHits).toHaveLength(2);
    expect(result.ruleHits.map((h) => h.ruleId)).toEqual(["R-0001", "R-0010"]);
    expect(result.consensusHits).toHaveLength(1);
    expect(result.consensusHits[0].consensusId).toBe("C-0089");
    expect(result.consensusHits[0].relatedClauseNo).toBe("R-0050");
    expect(result.hits.map((h) => h.kind)).toEqual(["rule", "consensus", "rule"]);
  });
});
