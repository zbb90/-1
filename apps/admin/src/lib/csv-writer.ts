import { appendFile, readFile } from "node:fs/promises";

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * 将一行数据追加到 CSV 文件末尾。
 * headers 参数决定字段顺序，与 CSV 表头保持一致。
 */
export async function appendCsvRow(
  filePath: string,
  headers: string[],
  row: Record<string, string>,
) {
  const raw = await readFile(filePath, "utf-8").catch(() => "");
  const endsWithNewline = raw.endsWith("\n") || raw.endsWith("\r\n");

  const line =
    (endsWithNewline || raw.length === 0 ? "" : "\n") +
    headers.map((h) => escapeCsvField(row[h] ?? "")).join(",") +
    "\n";

  await appendFile(filePath, line, "utf-8");
}

/**
 * 从 CSV 文件的第一行（表头行）读取字段名列表。
 */
export async function readCsvHeaders(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, "utf-8").catch(() => "");
  const firstLine = raw.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";
  return firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
}
