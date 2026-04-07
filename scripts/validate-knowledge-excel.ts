/**
 * 校验知识库 Excel 首行表头是否与系统约定一致（不连 Redis）。
 * 用法: npx tsx --tsconfig apps/admin/tsconfig.json scripts/validate-knowledge-excel.ts <文件.xlsx> [表名]
 * 表名: rules | consensus | external-purchases | old-items（缺省则从文件名推断）
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import type { KbTableName } from "../apps/admin/src/lib/kb-schema";
import {
  KB_TABLE_HEADERS,
  validateKnowledgeRowKeys,
} from "../apps/admin/src/lib/kb-schema";

const VALID: KbTableName[] = ["rules", "consensus", "external-purchases", "old-items"];

function inferTable(filePath: string): KbTableName | null {
  const lower = filePath.toLowerCase();
  if (lower.includes("规则") || lower.includes("rule") || lower.includes("03"))
    return "rules";
  if (lower.includes("共识") || lower.includes("consensus") || lower.includes("02"))
    return "consensus";
  if (lower.includes("外购") || lower.includes("external") || lower.includes("05"))
    return "external-purchases";
  if (lower.includes("旧品") || lower.includes("old") || lower.includes("04"))
    return "old-items";
  return null;
}

function main() {
  const fileArg = process.argv[2];
  const tableArg = process.argv[3] as KbTableName | undefined;

  if (!fileArg) {
    console.error(
      "用法: npx tsx --tsconfig apps/admin/tsconfig.json scripts/validate-knowledge-excel.ts <文件.xlsx> [表名]\n" +
        "表名: rules | consensus | external-purchases | old-items",
    );
    process.exit(1);
  }

  const filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    process.exit(1);
  }

  const lowerPath = filePath.toLowerCase();
  if (!lowerPath.endsWith(".xlsx") && !lowerPath.endsWith(".xls")) {
    console.error(
      "请提供 Excel 文件（.xlsx 或 .xls）。CSV 请先在表格软件中另存为 Excel。",
    );
    process.exit(1);
  }

  const table = tableArg && VALID.includes(tableArg) ? tableArg : inferTable(filePath);

  if (!table) {
    console.error(
      "无法从文件名推断表名，请显式传入第二个参数：rules | consensus | external-purchases | old-items",
    );
    process.exit(1);
  }

  const buffer = readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    console.error("Excel 无工作表");
    process.exit(1);
  }
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error("工作表为空");
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
  });
  if (rows.length === 0) {
    console.error("Excel 无数据行（或无法解析首行表头）");
    process.exit(1);
  }

  const headers = Object.keys(rows[0] ?? {}).map((k) => k.trim());
  const result = validateKnowledgeRowKeys(table, headers);

  console.log(`文件: ${filePath}`);
  console.log(`判定表: ${table}`);
  console.log(`期望列数: ${KB_TABLE_HEADERS[table].length}`);

  if (result.ok) {
    console.log("校验通过：表头与系统约定一致。");
    process.exit(0);
  }

  console.error("校验失败：缺少列：", result.missing.join(", "));
  if ("extraNote" in result && result.extraNote) console.error(result.extraNote);
  process.exit(1);
}

main();
