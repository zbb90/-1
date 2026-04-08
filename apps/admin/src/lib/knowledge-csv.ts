/**
 * 知识库 CSV 读写的共用工具层。
 * 供知识库管理 CRUD API 调用。
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readCsvAsObjects } from "@/lib/csv";
import { invalidateKnowledgeBaseCache } from "@/lib/knowledge-loader";
import type {
  ConsensusRow,
  ExternalPurchaseRow,
  OperationRow,
  OldItemRow,
  RuleRow,
} from "@/lib/types";
import type { KbTableName } from "./kb-schema";

export type { KbTableName };

const CSV_FILES: Record<KbTableName, string> = {
  rules: "03_常规问题规则表.csv",
  consensus: "02_共识解释表.csv",
  "external-purchases": "05_外购清单表.csv",
  "old-items": "04_旧品清单表.csv",
  operations: "06_操作知识表.csv",
};

export function resolveTemplateDir(): string | null {
  const candidates = [
    resolve(process.cwd(), "../../data/templates"),
    resolve(process.cwd(), "../../../data/templates"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function getCsvPath(table: KbTableName): string | null {
  const dir = resolveTemplateDir();
  if (!dir) return null;
  return resolve(dir, CSV_FILES[table]);
}

export async function readTable(table: "rules"): Promise<RuleRow[]>;
export async function readTable(table: "consensus"): Promise<ConsensusRow[]>;
export async function readTable(
  table: "external-purchases",
): Promise<ExternalPurchaseRow[]>;
export async function readTable(table: "old-items"): Promise<OldItemRow[]>;
export async function readTable(table: "operations"): Promise<OperationRow[]>;
export async function readTable(
  table: KbTableName,
): Promise<
  RuleRow[] | ConsensusRow[] | ExternalPurchaseRow[] | OldItemRow[] | OperationRow[]
>;
export async function readTable(
  table: KbTableName,
): Promise<
  RuleRow[] | ConsensusRow[] | ExternalPurchaseRow[] | OldItemRow[] | OperationRow[]
> {
  const path = getCsvPath(table);
  if (!path) return [];
  switch (table) {
    case "rules":
      return readCsvAsObjects<RuleRow>(path);
    case "consensus":
      return readCsvAsObjects<ConsensusRow>(path);
    case "external-purchases":
      return readCsvAsObjects<ExternalPurchaseRow>(path);
    case "old-items":
      return readCsvAsObjects<OldItemRow>(path);
    case "operations":
      return readCsvAsObjects<OperationRow>(path);
  }
}

function idField(table: KbTableName): string {
  if (table === "rules") return "rule_id";
  if (table === "consensus") return "consensus_id";
  if (table === "operations") return "op_id";
  return "item_id";
}

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function serializeCsv(headers: string[], rows: Record<string, string>[]): string {
  const headerLine = headers.map(escapeCsvField).join(",");
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCsvField(row[h] ?? "")).join(","),
  );
  return [headerLine, ...dataLines].join("\n") + "\n";
}

async function readCsvHeaders(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, "utf-8").catch(() => "");
  const firstLine = raw.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";
  return firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
}

export async function patchRowStatus(
  table: KbTableName,
  id: string,
  status: string,
): Promise<Record<string, string> | null> {
  const path = getCsvPath(table);
  if (!path) return null;

  const headers = await readCsvHeaders(path);
  const rows = (await readTable(table)) as unknown as Record<string, string>[];
  const field = idField(table);
  const idx = rows.findIndex((r) => r[field] === id);
  if (idx === -1) return null;

  rows[idx] = { ...rows[idx], 状态: status };
  await writeFile(path, serializeCsv(headers, rows), "utf-8");
  invalidateKnowledgeBaseCache();
  return rows[idx];
}

export async function appendRow(
  table: KbTableName,
  row: Record<string, string>,
): Promise<Record<string, string>> {
  const path = getCsvPath(table);
  if (!path) throw new Error("当前部署环境无本地 CSV 文件，无法写入。");

  const headers = await readCsvHeaders(path);
  const rows = (await readTable(table)) as unknown as Record<string, string>[];

  const field = idField(table);
  if (!row[field]) {
    const prefix =
      table === "rules"
        ? "R"
        : table === "consensus"
          ? "C"
          : table === "external-purchases"
            ? "EP"
            : table === "old-items"
              ? "OI"
              : "OP";
    row[field] = `${prefix}-${String(rows.length + 1).padStart(4, "0")}`;
  }

  const normalizedRow: Record<string, string> = {};
  for (const h of headers) {
    normalizedRow[h] = row[h] ?? "";
  }
  rows.push(normalizedRow);

  await writeFile(path, serializeCsv(headers, rows), "utf-8");
  invalidateKnowledgeBaseCache();
  return normalizedRow;
}
