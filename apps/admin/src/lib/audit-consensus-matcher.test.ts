import { describe, expect, it } from "vitest";
import { analyzeAuditConsensus } from "@/lib/audit-consensus-matcher";
import type { AuditClause, ConsensusEntry } from "@/lib/audit-match-types";

describe("audit-consensus-matcher", () => {
  it("finds the most relevant consensus using heuristic recall", async () => {
    const auditClauses: AuditClause[] = [
      {
        key: "audit:H2.1.1",
        rowIndex: 3,
        auditId: "H2.1.1",
        dimension: "Q",
        level: "观察点",
        score: 15,
        clauseTitle: "使用非认可物料设备",
        clauseDetail: "门店使用未经审批的外购物料和化学品",
        searchText:
          "Q 观察点 H2.1.1 使用非认可物料设备 门店使用未经审批的外购物料和化学品",
        rawRow: {},
      },
    ];
    const consensusEntries: ConsensusEntry[] = [
      {
        key: "consensus:11",
        rowIndex: 2,
        consensusId: "11",
        title: "外购物料管理共识",
        type: "4",
        clauseId: "311",
        contentText: "禁止使用未经审批的外购物料和化学品。",
        visibleRoles: "leader",
        searchText: "外购物料管理共识 禁止使用未经审批的外购物料和化学品 4",
        rawRow: {},
      },
      {
        key: "consensus:12",
        rowIndex: 3,
        consensusId: "12",
        title: "虫害防控共识",
        type: "2",
        clauseId: "99",
        contentText: "发现虫害时应立即处理。",
        visibleRoles: "leader",
        searchText: "虫害防控共识 发现虫害时应立即处理 2",
        rawRow: {},
      },
    ];

    const result = await analyzeAuditConsensus(auditClauses, consensusEntries);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].bestMatch?.consensusId).toBe("11");
    expect(result.results[0].candidates[0].title).toContain("外购物料");
  });
});
