import * as path from "node:path";
import * as XLSX from "xlsx";

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: tsx inspect-audit-xlsx.ts <path-to-xlsx>");
    process.exit(2);
  }
  const file = path.resolve(target);
  const wb = XLSX.readFile(file, { cellDates: true });
  console.log(`# 文件: ${file}`);
  console.log(`# Sheets (${wb.SheetNames.length}):`, wb.SheetNames.join(" | "));
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: "",
      raw: false,
    });
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    console.log("\n========================================");
    console.log(`# Sheet: ${sheetName}`);
    console.log(`# 范围: ${ws["!ref"]}  | 数据行数: ${json.length}`);

    // 打印前 30 行原始内容（带原始单元格行号）
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    });
    const headerCandidates = aoa.slice(0, Math.min(8, aoa.length));
    console.log("# 顶部 8 行原始单元格 (header 探测)：");
    headerCandidates.forEach((row, idx) => {
      console.log(`  L${idx + 1}:`, row.slice(0, range.e.c + 1));
    });

    if (json.length > 0) {
      const headers = Object.keys(json[0]);
      console.log(`# 列头 (${headers.length}):`);
      headers.forEach((h, i) => console.log(`  - [${i}] ${JSON.stringify(h)}`));

      console.log(`# 前 5 条样本（按列头解析后）：`);
      json.slice(0, 5).forEach((row, idx) => {
        console.log(`  --- row ${idx + 1} ---`);
        for (const k of headers) {
          const v = String(row[k] ?? "").trim();
          if (v) {
            console.log(`    ${k}: ${v.length > 200 ? v.slice(0, 200) + "…" : v}`);
          }
        }
      });
    }
  }
}

main();
