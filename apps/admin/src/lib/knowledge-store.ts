/**
 * Redis-backed knowledge store — enables online editing in production.
 *
 * Key schema per table (rules / consensus / external-purchases / old-items / operations):
 *   audit:kb:{table}:rows   — String (JSON array of row objects)
 *   audit:kb:{table}:ver    — Number (incremented on every write)
 *
 * Falls back to CSV files when Redis is unavailable (local dev).
 */

import type { KbTableName } from "@/lib/knowledge-csv";
import { KB_TABLE_HEADERS } from "@/lib/kb-schema";
import { readTable as readCsvTable, writeTableRows } from "@/lib/knowledge-csv";
import { invalidateKnowledgeBaseCache } from "@/lib/knowledge-loader";
import { getRedis, isRedisConfigured } from "@/lib/redis-client";
import type { RuleRow } from "@/lib/types";
import { rebuildRuleVectorIndex } from "@/lib/vector-store";

function rowsKey(table: KbTableName) {
  return `audit:kb:${table}:rows`;
}

type Row = Record<string, string>;

const KB_TABLES: KbTableName[] = [
  "rules",
  "consensus",
  "external-purchases",
  "old-items",
  "operations",
  "faq",
];

export type KnowledgeStorageDiagnostics = {
  redisConfigured: boolean;
  redisRowKeyCount: number;
  redisCounts: Record<KbTableName, number>;
  csvCounts: Record<KbTableName, number>;
};

export type KnowledgeRestoreReport = {
  restoredTables: Record<KbTableName, number>;
  vectorRebuild:
    | { status: "skipped"; reason: string }
    | { status: "done"; count: number };
};

/* ------------------------------------------------------------------ */
/*  Read                                                               */
/* ------------------------------------------------------------------ */

export async function readRows(table: KbTableName): Promise<Row[]> {
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      const raw = await redis.get<string>(rowsKey(table));
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) return parsed as Row[];
      }
      return [];
    } catch (error) {
      console.warn(`[knowledge-store] readRows failed for redis table ${table}`, error);
      return [];
    }
  }

  return (await readCsvTable(table)) as unknown as Row[];
}

/* ------------------------------------------------------------------ */
/*  Write helpers                                                      */
/* ------------------------------------------------------------------ */

export async function replaceTableRows(table: KbTableName, rows: Row[]) {
  await persistRows(table, rows);
}

async function persistRows(table: KbTableName, rows: Row[]) {
  if (isRedisConfigured()) {
    try {
      const redis = await getRedis();
      await redis.set(rowsKey(table), JSON.stringify(rows));
    } catch (error) {
      console.warn(`[knowledge-store] persistRows fallback to CSV for ${table}`, error);
      await writeTableRows(table, rows);
    }
  } else {
    await writeTableRows(table, rows);
  }
  invalidateKnowledgeBaseCache();
  try {
    const { rebuildKnowledgeTagIndex } = await import("@/lib/knowledge-tags");
    await rebuildKnowledgeTagIndex();
  } catch (error) {
    console.warn(
      `[knowledge-store] rebuildKnowledgeTagIndex skipped for ${table}`,
      error,
    );
  }
}

async function getRedisTableRowCount(table: KbTableName) {
  try {
    const redis = await getRedis();
    const raw = await redis.get<string>(rowsKey(table));
    if (!raw) return 0;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function idField(table: KbTableName): string {
  if (table === "rules") return "rule_id";
  if (table === "consensus") return "consensus_id";
  if (table === "operations") return "op_id";
  if (table === "faq") return "faq_id";
  return "item_id";
}

function nextId(table: KbTableName, rows: Row[]): string {
  const prefix =
    table === "rules"
      ? "R"
      : table === "consensus"
        ? "C"
        : table === "external-purchases"
          ? "EP"
          : table === "old-items"
            ? "OI"
            : table === "faq"
              ? "FAQ"
              : "OP";
  return `${prefix}-${String(rows.length + 1).padStart(4, "0")}`;
}

function hasMeaningfulImportContent(table: KbTableName, row: Row): boolean {
  const ignoredFields = new Set([idField(table), "状态", "备注", "tags", "更新时间"]);
  return KB_TABLE_HEADERS[table].some((header) => {
    if (ignoredFields.has(header)) return false;
    return Boolean(row[header]?.trim());
  });
}

export function getHeaders(table: KbTableName, rows: Row[]): string[] {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const merged = [...headers];
  for (const header of KB_TABLE_HEADERS[table]) {
    if (!merged.includes(header)) {
      merged.push(header);
    }
  }
  return merged.length > 0 ? merged : KB_TABLE_HEADERS[table];
}

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export async function appendRow(table: KbTableName, row: Row): Promise<Row> {
  const rows = await readRows(table);
  const field = idField(table);
  if (!row[field]) {
    row[field] = nextId(table, rows);
  }

  const headers = getHeaders(table, rows);
  const normalized: Row = {};
  for (const h of headers) {
    normalized[h] = row[h] ?? "";
  }
  if (!normalized["状态"]) normalized["状态"] = "启用";
  rows.push(normalized);
  await persistRows(table, rows);
  return normalized;
}

export async function patchRowStatus(
  table: KbTableName,
  id: string,
  status: string,
): Promise<Row | null> {
  const rows = await readRows(table);
  const field = idField(table);
  const idx = rows.findIndex((r) => r[field] === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], 状态: status };
  await persistRows(table, rows);
  return rows[idx];
}

export async function updateRow(
  table: KbTableName,
  id: string,
  patch: Row,
): Promise<Row | null> {
  const rows = await readRows(table);
  const field = idField(table);
  const idx = rows.findIndex((r) => r[field] === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch };
  await persistRows(table, rows);
  return rows[idx];
}

export async function importRows(
  table: KbTableName,
  incoming: Row[],
  mode: "append" | "replace" = "append",
): Promise<{ added: number; total: number; skipped: number }> {
  let rows = mode === "replace" ? [] : await readRows(table);
  const field = idField(table);
  const headers = getHeaders(table, rows.length > 0 ? rows : incoming);

  let added = 0;
  let skipped = 0;
  for (const raw of incoming) {
    const normalized: Row = {};
    for (const h of headers) {
      normalized[h] = raw[h] ?? "";
    }
    if (!hasMeaningfulImportContent(table, normalized)) {
      skipped++;
      continue;
    }
    if (!normalized[field]) {
      normalized[field] = nextId(table, rows);
    }
    if (!normalized["状态"]) normalized["状态"] = "启用";
    rows.push(normalized);
    added++;
  }

  if (incoming.length > 0 && added === 0) {
    throw new Error(
      `没有可导入的有效内容：上传文件未匹配到 ${table} 表的模板字段，请检查表头或使用专用导入入口。`,
    );
  }

  await persistRows(table, rows);
  return { added, total: rows.length, skipped };
}

export async function getKnowledgeStorageDiagnostics(): Promise<KnowledgeStorageDiagnostics> {
  const csvEntries = await Promise.all(
    KB_TABLES.map(
      async (table) =>
        [table, ((await readCsvTable(table)) as unknown as Row[]).length] as const,
    ),
  );
  const csvCounts = Object.fromEntries(csvEntries) as Record<KbTableName, number>;

  if (!isRedisConfigured()) {
    return {
      redisConfigured: false,
      redisRowKeyCount: 0,
      redisCounts: {
        rules: 0,
        consensus: 0,
        "external-purchases": 0,
        "old-items": 0,
        operations: 0,
        faq: 0,
      },
      csvCounts,
    };
  }

  const redis = await getRedis();
  const [scanResult, ...counts] = await Promise.all([
    redis.scan("0", { match: "audit:kb:*:rows", count: 100 }),
    ...KB_TABLES.map((table) => getRedisTableRowCount(table)),
  ]);

  // KB_TABLES 顺序与下面 redisCounts 字段一一对应。
  const redisCountsByTable = Object.fromEntries(
    KB_TABLES.map((table, idx) => [table, counts[idx] ?? 0]),
  ) as Record<KbTableName, number>;

  return {
    redisConfigured: true,
    redisRowKeyCount: scanResult[1].length,
    redisCounts: redisCountsByTable,
    csvCounts,
  };
}

export async function restoreKnowledgeBaseFromCsv(): Promise<KnowledgeRestoreReport> {
  const restoredTables = {
    rules: 0,
    consensus: 0,
    "external-purchases": 0,
    "old-items": 0,
    operations: 0,
    faq: 0,
  } as Record<KbTableName, number>;

  for (const table of KB_TABLES) {
    const rows = (await readCsvTable(table)) as unknown as Row[];
    await persistRows(table, rows);
    restoredTables[table] = rows.length;
  }

  const rules = ((await readCsvTable("rules")) as unknown as RuleRow[]) ?? [];
  const vectorResult = await rebuildRuleVectorIndex(rules);

  return {
    restoredTables,
    vectorRebuild: vectorResult.ok
      ? { status: "done", count: vectorResult.count }
      : { status: "skipped", reason: vectorResult.reason || "未配置向量能力" },
  };
}

/* ------------------------------------------------------------------ */
/*  CSV template & export                                              */
/* ------------------------------------------------------------------ */

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(escapeCsvField).join(",");
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCsvField(row[h] ?? "")).join(","),
  );
  return "\uFEFF" + [headerLine, ...dataLines].join("\n") + "\n";
}

export function templateCsv(table: KbTableName): string {
  const headers = getHeaders(table, []);
  return "\uFEFF" + headers.map(escapeCsvField).join(",") + "\n";
}
