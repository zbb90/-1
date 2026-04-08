/**
 * Redis-backed knowledge store — enables online editing in production (Vercel).
 *
 * Key schema per table (rules / consensus / external-purchases / old-items / operations):
 *   audit:kb:{table}:rows   — String (JSON array of row objects)
 *   audit:kb:{table}:ver    — Number (incremented on every write)
 *
 * Falls back to CSV files when Redis is unavailable (local dev).
 */

import type { KbTableName } from "@/lib/knowledge-csv";
import { KB_TABLE_HEADERS } from "@/lib/kb-schema";
import { readTable as readCsvTable, getCsvPath } from "@/lib/knowledge-csv";
import { invalidateKnowledgeBaseCache } from "@/lib/knowledge-loader";
import { getRedis, isRedisConfigured } from "@/lib/redis-client";

function rowsKey(table: KbTableName) {
  return `audit:kb:${table}:rows`;
}

type Row = Record<string, string>;

/* ------------------------------------------------------------------ */
/*  Read                                                               */
/* ------------------------------------------------------------------ */

export async function readRows(table: KbTableName): Promise<Row[]> {
  if (isRedisConfigured()) {
    const redis = await getRedis();
    const raw = await redis.get<string>(rowsKey(table));
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Row[];
    }
    // Redis empty → seed from CSV
    const csvRows = (await readCsvTable(table)) as unknown as Row[];
    if (csvRows.length > 0) {
      await redis.set(rowsKey(table), JSON.stringify(csvRows));
    }
    return csvRows;
  }

  return (await readCsvTable(table)) as unknown as Row[];
}

/* ------------------------------------------------------------------ */
/*  Write helpers                                                      */
/* ------------------------------------------------------------------ */

async function persistRows(table: KbTableName, rows: Row[]) {
  if (isRedisConfigured()) {
    const redis = await getRedis();
    await redis.set(rowsKey(table), JSON.stringify(rows));
  }
  invalidateKnowledgeBaseCache();
}

function idField(table: KbTableName): string {
  if (table === "rules") return "rule_id";
  if (table === "consensus") return "consensus_id";
  if (table === "operations") return "op_id";
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
            : "OP";
  return `${prefix}-${String(rows.length + 1).padStart(4, "0")}`;
}

export function getHeaders(table: KbTableName, rows: Row[]): string[] {
  if (rows.length > 0) return Object.keys(rows[0]);
  return KB_TABLE_HEADERS[table];
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
): Promise<{ added: number; total: number }> {
  let rows = mode === "replace" ? [] : await readRows(table);
  const field = idField(table);
  const headers = getHeaders(table, rows.length > 0 ? rows : incoming);

  let added = 0;
  for (const raw of incoming) {
    const normalized: Row = {};
    for (const h of headers) {
      normalized[h] = raw[h] ?? "";
    }
    if (!normalized[field]) {
      normalized[field] = nextId(table, rows);
    }
    if (!normalized["状态"]) normalized["状态"] = "启用";
    rows.push(normalized);
    added++;
  }

  await persistRows(table, rows);
  return { added, total: rows.length };
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
