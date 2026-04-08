import { describe, expect, it } from "vitest";
import { KB_TABLE_HEADERS, validateKnowledgeRowKeys } from "./kb-schema";

describe("validateKnowledgeRowKeys", () => {
  it("passes when all required columns exist for rules", () => {
    const keys = [...KB_TABLE_HEADERS.rules];
    expect(validateKnowledgeRowKeys("rules", keys)).toEqual({ ok: true });
  });

  it("passes when all required columns exist for operations", () => {
    const keys = [...KB_TABLE_HEADERS.operations];
    expect(validateKnowledgeRowKeys("operations", keys)).toEqual({ ok: true });
  });

  it("fails when a column is missing", () => {
    const keys = KB_TABLE_HEADERS.rules.filter((h) => h !== "条款标题");
    const r = validateKnowledgeRowKeys("rules", keys);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("条款标题");
  });

  it("allows extra columns from Excel exports", () => {
    const keys = [...KB_TABLE_HEADERS.consensus, "更新时间"];
    expect(validateKnowledgeRowKeys("consensus", keys)).toEqual({ ok: true });
  });
});
