import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseAuditWorkbook, parseConsensusWorkbook } from "@/lib/audit-match-excel";

function workbookToBuffer(rows: unknown[][], sheetName: string) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

describe("audit-match-excel", () => {
  it("parses audit workbook from the second header row", () => {
    const buffer = workbookToBuffer(
      [
        ["古茗门店稽核表"],
        ["维度", "分级说明", "分值", "ID", "标准条文"],
        ["Q", "章节", "", "", "门店形象"],
        ["Q", "观察点", "15", "H2.1.1", "使用非认可物料设备"],
      ],
      "Sheet1",
    );

    const result = parseAuditWorkbook(buffer);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0]).toMatchObject({
      auditId: "H2.1.1",
      dimension: "Q",
      level: "观察点",
      score: 15,
      clauseTitle: "使用非认可物料设备",
    });
  });

  it("parses consensus workbook and strips deleted rows", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      {
        id: "11",
        title: "外购物料管理",
        type: "4",
        consensus_desc_txt: "禁止使用未审批的外购物料",
        clause_id: "311",
        deleted: "0",
      },
      {
        id: "12",
        title: "已删除数据",
        type: "4",
        consensus_desc_txt: "不应被读取",
        clause_id: "312",
        deleted: "1",
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Export");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const result = parseConsensusWorkbook(buffer);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      consensusId: "11",
      title: "外购物料管理",
      clauseId: "311",
    });
  });
});
